// Zone 6 · Arrangement — split ownership:
//   · initArrangementDropTarget() → phase 1b (lanes accept drag-drops from browser)
//   · initArrangementPlayhead()   → phase 1c (playhead animates with engine)
// Both functions are independent; don't move logic across boundaries.
//
// Phase-4 update: track rows and lanes are now generated dynamically from
// store.data.tracks. index.html only supplies the containers and the
// playhead element. `renderTrackRows()` wipes and regenerates both lists
// on every change; drop-target listeners are re-attached per render so
// new lanes still accept drops.

import { audioCache } from '../../audio/audio-cache.js';
import { getPeaks, drawPeaks } from '../../audio/waveform-peaks.js';

import { TOTAL_BEATS } from './timeline-constants.js';

const DEFAULT_CLIP_LENGTH_BEATS = 4;
const AUDIO_FILE_RE = /\.(wav|mp3|ogg|flac|aiff?)$/i;

// ──────────────────────────────────────────────────────────────────
// Scoped CSS (one-shot)
// ──────────────────────────────────────────────────────────────────
let _dropStylesInjected = false;
function injectDropStyles() {
  if (_dropStylesInjected) return;
  _dropStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .lane--drop-target {
      outline: 2px dashed var(--accent, #60a5fa);
      outline-offset: -2px;
      background: color-mix(in srgb, var(--accent, #60a5fa) 10%, transparent);
    }
  `;
  document.head.appendChild(style);
}

// Track colors — fall back cycle for newly-created tracks
const TRACK_COLORS = ['amber', 'red', 'zinc', 'emerald', 'cyan', 'blue', 'violet'];

export function initArrangementDropTarget({ store, engine, api /* , mixer, sampler, ensureAudio */ } = {}) {
  injectDropStyles();

  const zone = document.querySelector('.zone--arrangement');
  if (!zone) return;
  const timeline = zone.querySelector('.arrangement__timeline');
  const trackList = zone.querySelector('.arrangement__track-list');
  if (!timeline || !trackList) return;

  // Preserve the single playhead element across full wipes.
  const playhead = timeline.querySelector('.playhead');

  function parsePayload(e) {
    const raw = e.dataTransfer?.getData('application/x-bassmash-sample');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // ── Drop-target wiring per lane ─────────────────────────────────
  // Re-invoked after every re-render so newly-created lanes receive
  // the same listeners. We attach directly (no delegation) because
  // the dragover/drop handlers need per-lane rect math, and listeners
  // die with the element on wipe so no manual cleanup is required.
  function wireLaneDropTargets() {
    const lanes = Array.from(timeline.querySelectorAll('.lane'));
    lanes.forEach((lane, index) => {
      if (lane._dropWired) return;
      lane._dropWired = true;

      lane.addEventListener('dragover', (e) => {
        const types = e.dataTransfer?.types;
        if (!types || !Array.from(types).includes('application/x-bassmash-sample')) {
          // Some browsers hide custom types during dragover; still accept conservatively.
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        lane.classList.add('lane--drop-target');
      });
      lane.addEventListener('dragleave', (e) => {
        if (e.target === lane) lane.classList.remove('lane--drop-target');
      });
      lane.addEventListener('drop', (e) => {
        e.preventDefault();
        lane.classList.remove('lane--drop-target');

        // Recompute the index at drop-time: earlier lanes may have been
        // deleted or inserted since this listener was attached.
        const liveIdx = Array.from(timeline.querySelectorAll('.lane')).indexOf(lane);
        const idx = liveIdx >= 0 ? liveIdx : index;

        // OS-file drop (phase 3b): take precedence over sample-payload parsing
        // so dragging a .wav from the desktop uploads + places an audio clip.
        const files = Array.from(e.dataTransfer?.files || []);
        const audioFiles = files.filter((f) => AUDIO_FILE_RE.test(f.name));
        if (audioFiles.length > 0) {
          const rect = lane.getBoundingClientRect();
          const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const startBeat = Math.max(0, Math.min(TOTAL_BEATS - 1, Math.round(x * TOTAL_BEATS)));
          handleFileDrop({ lane, index: idx, files: audioFiles, startBeat });
          return;
        }

        const payload = parsePayload(e);
        if (!payload || !payload.ref) return;

        const rect = lane.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const startBeat = Math.max(0, Math.min(TOTAL_BEATS - 1, Math.round(x * TOTAL_BEATS)));

        // Files tab drops are audio clips, not drum-track samples.
        // Kit / Sounds tab drops (kind:"sample" or missing for back-compat)
        // fall through to the drum-track path.
        if (payload.kind === 'audio') {
          handleAudioRefDrop({ index: idx, filename: payload.ref, startBeat });
          return;
        }

        handleDrop({ store, index: idx, payload, startBeat });
      });
    });
  }

  function handleDrop({ store, index, payload, startBeat }) {
    const { ref, name } = payload;

    // Ensure track exists at this DOM index
    let trackIndex = index;
    if (!store.data.tracks[index]) {
      while (store.data.tracks.length < index) {
        store.addTrack({
          name: `Track ${store.data.tracks.length + 1}`,
          type: 'drum',
          muted: false,
          color: TRACK_COLORS[store.data.tracks.length % TRACK_COLORS.length],
        });
      }
      store.addTrack({
        name,
        type: 'drum',
        muted: false,
        color: TRACK_COLORS[index % TRACK_COLORS.length],
      });
      trackIndex = store.data.tracks.length - 1;
    }

    // Create a 16-step pattern with the sample on step 0
    const cells = new Array(16).fill(false); cells[0] = true;
    const velocities = new Array(16).fill(100);
    const pattern = {
      name,
      stepCount: 16,
      steps: [{ sampleRef: ref, cells, velocities }],
    };
    store.addPattern(pattern);
    const patternIndex = store.data.patterns.length - 1;

    // Push clip into arrangement
    const clip = {
      trackIndex,
      patternIndex,
      type: 'pattern',
      startBeat,
      lengthBeats: DEFAULT_CLIP_LENGTH_BEATS,
    };
    store.data.arrangement.push(clip);
    store.emit('change', { path: 'arrangement' });
    if (typeof store._scheduleSave === 'function') store._scheduleSave();
  }

  // ── OS file drop (phase 3b) ────────────────────────────────
  async function handleFileDrop({ lane, index, files, startBeat }) {
    if (!api || !store) return;

    let cursorBeat = startBeat;

    for (const file of files) {
      let result;
      try {
        result = await api.uploadAudio(store.projectName, file);
      } catch (err) {
        console.warn('[arrangement] uploadAudio failed', err);
        continue;
      }
      if (!result || !result.filename) continue;

      try {
        store.audioFiles = await api.listAudio(store.projectName);
        store.emit('audioFilesChanged');
      } catch (_) { /* non-fatal */ }

      const placedLen = await placeAudioClip({
        index,
        filename: result.filename,
        displayName: file.name,
        startBeat: cursorBeat,
      });
      cursorBeat += placedLen;
    }
  }

  // Browser Files-tab drop: the audio file is already uploaded;
  // skip upload, share the clip-placement helper with OS drag.
  async function handleAudioRefDrop({ index, filename, startBeat }) {
    if (!api || !store) return;
    await placeAudioClip({ index, filename, displayName: filename, startBeat });
  }

  // Shared audio-clip placement used by both OS file drop and
  // Files-tab drag. Creates the audio-type track if the lane is
  // past the current track list, decodes the buffer for length,
  // and pushes the clip. Returns the lengthBeats actually used.
  async function placeAudioClip({ index, filename, displayName, startBeat }) {
    const secondsPerBeat = 60 / (store.data.bpm || 140);

    let trackIndex = index;
    if (!store.data.tracks[index]) {
      while (store.data.tracks.length < index) {
        store.addTrack({
          name: `Track ${store.data.tracks.length + 1}`,
          type: 'audio',
          muted: false,
          color: TRACK_COLORS[store.data.tracks.length % TRACK_COLORS.length],
        });
      }
      store.addTrack({
        name: displayName || filename,
        type: 'audio',
        muted: false,
        color: TRACK_COLORS[index % TRACK_COLORS.length],
      });
      trackIndex = store.data.tracks.length - 1;
    }

    let lengthBeats = DEFAULT_CLIP_LENGTH_BEATS;
    if (engine?.ctx) {
      const url = api.audioUrl(store.projectName, filename);
      try {
        const buffer = await audioCache.load(url, engine);
        lengthBeats = Math.max(1, Math.round(buffer.duration / secondsPerBeat));
      } catch (err) {
        console.warn('[arrangement] decode for length failed; using 4 beats', err);
      }
    }

    const clip = {
      trackIndex,
      type: 'audio',
      audioRef: filename,
      startBeat,
      lengthBeats,
      offset: 0,
    };
    store.data.arrangement.push(clip);
    store.emit('change', { path: 'arrangement' });
    if (typeof store._scheduleSave === 'function') store._scheduleSave();

    return lengthBeats;
  }

  // ── Rendering ───────────────────────────────────────────────
  // Full dynamic render: rebuild track rows + lanes from store.data.tracks,
  // then re-populate clips from store.data.arrangement. The old path kept
  // 10 static .track-row / .lane elements and mutated them in place, which
  // meant adding an 11th track produced no lane and deleting left zombie
  // DOM. Now both lists are pure functions of state.
  function renderTrackRows() {
    if (!trackList || !timeline) return;
    const tracks = store.data.tracks || [];

    // Wipe track list. Preserve nothing; track-manager re-appends its
    // "+ Add track" row via its own MutationObserver (see track-manager.js).
    trackList.replaceChildren();

    // Wipe timeline but KEEP the playhead. The playhead sits as a sibling
    // of .lane elements, positioned absolutely, and we need to preserve it
    // across re-renders so its state (left%) is stable.
    Array.from(timeline.children).forEach((child) => {
      if (child !== playhead) child.remove();
    });

    tracks.forEach((track, i) => {
      const color = track.color || TRACK_COLORS[i % TRACK_COLORS.length];

      // ── Track row ─────────────────────────────────────────
      const row = document.createElement('div');
      row.className = 'track-row';
      if (store.selectedTrack === i) row.classList.add('track-row--selected');
      row.setAttribute('data-color', color);

      const nameEl = document.createElement('span');
      nameEl.className = 'track-row__name';
      nameEl.textContent = `${String(i + 1).padStart(2, '0')} · ${track.name || `Track ${i + 1}`}`;
      row.appendChild(nameEl);

      const flagsEl = document.createElement('span');
      flagsEl.className = 'track-row__flags';
      flagsEl.textContent = 'M S R';
      row.appendChild(flagsEl);

      trackList.appendChild(row);

      // ── Matching lane ─────────────────────────────────────
      const lane = document.createElement('div');
      lane.className = 'lane';
      if (store.selectedTrack === i) lane.classList.add('lane--selected');
      lane.setAttribute('data-color', color);
      timeline.appendChild(lane);
    });

    // Re-wire drop targets for the freshly-created lanes.
    wireLaneDropTargets();
  }

  function renderAllClips() {
    const lanes = Array.from(timeline.querySelectorAll('.lane'));
    lanes.forEach((lane) => {
      // Wipe existing runtime-rendered clips. Unhook the shared
      // ResizeObserver first — otherwise it holds strong refs to
      // now-detached clip elements and they never get GC'd.
      lane.querySelectorAll('.clip').forEach((c) => {
        if (_resizeObs && c._waveObserved) {
          try { _resizeObs.unobserve(c); } catch { /* no-op */ }
        }
        const pending = _pendingPaint.get(c);
        if (pending != null) cancelAnimationFrame(pending);
        c.remove();
      });
    });
    const arr = store.data.arrangement || [];
    for (const clip of arr) {
      renderClip(clip, lanes);
    }
  }

  // ── Waveform painting ────────────────────────────────────────────
  // Paint on the next animation frame at the canvas's current CSS width.
  // Re-paints when the clip is resized (via a single shared ResizeObserver)
  // and when the AudioBuffer finally decodes. Skips redraw if width
  // hasn't changed since last paint for this clip element.
  const _lastPaintedWidth = new WeakMap(); // clipEl -> int widthPx
  const _pendingPaint     = new WeakMap(); // clipEl -> rAF handle
  const _resizeObs = (typeof ResizeObserver !== 'undefined')
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target;
          const canvas = el._waveCanvas;
          const clip = el._waveClip;
          if (!canvas || !clip) continue;
          const w = Math.round(entry.contentRect.width);
          if (_lastPaintedWidth.get(el) === w) continue;
          scheduleWaveformPaint(el, canvas, clip);
        }
      })
    : null;

  function paintWaveformNow(el, canvas, clip) {
    if (!el.isConnected) return;
    const widthPx = Math.max(1, Math.round(canvas.clientWidth || el.clientWidth || 0));
    if (widthPx <= 0) return;

    // Resolve the buffer. If not yet decoded, schedule a repaint once
    // the decode promise settles. We never block render on I/O.
    if (!engine?.ctx || !api || !store?.projectName || !clip.audioRef) return;
    const url = api.audioUrl(store.projectName, clip.audioRef);
    const buffer = audioCache.getSync(url);
    if (!buffer) {
      audioCache.load(url, engine)
        .then(() => {
          // Only repaint if this canvas is still attached to this clip.
          if (el.isConnected && el._waveCanvas === canvas) {
            scheduleWaveformPaint(el, canvas, clip);
          }
        })
        .catch(() => { /* cache already logged */ });
      return;
    }

    const secondsPerBeat = 60 / (store.data.bpm || 140);
    const offsetSec = Math.max(0, (clip.offset || 0));
    const durationSec = Math.max(0, (clip.lengthBeats || 0) * secondsPerBeat);

    // Use a high-contrast ink for the waveform itself. The clip
    // background is the track's tinted `--c-subtle`, so drawing the
    // waveform in the same `--c` hue produces near-zero contrast.
    // Pick `--text-primary` (tuned for readability) and fall back to
    // a dark neutral if the variable isn't defined on this element.
    const cs = getComputedStyle(el);
    const ink = cs.getPropertyValue('--text-primary').trim()
              || cs.getPropertyValue('color').trim()
              || 'rgba(0,0,0,0.85)';

    const peaks = getPeaks(buffer, clip.audioRef, widthPx, offsetSec, durationSec || null);
    drawPeaks(canvas, peaks, {
      color: `color-mix(in srgb, ${ink} 85%, transparent)`,
      midline: `color-mix(in srgb, ${ink} 25%, transparent)`,
    });
    _lastPaintedWidth.set(el, widthPx);
  }

  function scheduleWaveformPaint(el, canvas, clip) {
    el._waveCanvas = canvas;
    el._waveClip = clip;
    // Attach observer once per clip element — it fires on width changes
    // only, so this doubles as our "resize -> repaint" hook without us
    // listening to raw pointer events.
    if (_resizeObs && !el._waveObserved) {
      try { _resizeObs.observe(el); el._waveObserved = true; } catch { /* no-op */ }
    }
    const prev = _pendingPaint.get(el);
    if (prev != null) cancelAnimationFrame(prev);
    const handle = requestAnimationFrame(() => {
      _pendingPaint.delete(el);
      paintWaveformNow(el, canvas, clip);
    });
    _pendingPaint.set(el, handle);
  }

  function renderClip(clip, lanes) {
    const lane = lanes[clip.trackIndex];
    if (!lane) return;

    // Sync lane color from track if present
    const track = store.data.tracks?.[clip.trackIndex];
    if (track?.color) lane.setAttribute('data-color', track.color);

    const el = document.createElement('div');
    const isAudio = clip.type === 'audio';
    const isMidi = !isAudio && (clip.type === 'pattern' || clip.patternIndex != null);
    el.className = isMidi ? 'clip clip--midi' : 'clip';
    if (clip.muted) el.classList.add('clip--muted');
    el.style.left  = (clip.startBeat / TOTAL_BEATS * 100) + '%';
    el.style.width = (clip.lengthBeats / TOTAL_BEATS * 100) + '%';

    if (isAudio) {
      el.classList.add('clip--audio');
      const ref = clip.audioRef || 'audio';

      // Canvas underlay: painted once the AudioBuffer decodes. We
      // create it eagerly so layout is stable; peaks are drawn in an
      // async microtask when the buffer is available.
      const canvas = document.createElement('canvas');
      canvas.className = 'clip__waveform-canvas';
      el.appendChild(canvas);

      // Filename pill overlay — sits on top of the waveform so the
      // label stays legible regardless of waveform density.
      const label = document.createElement('span');
      label.className = 'clip__label';
      label.textContent = ref.length > 24 ? ref.slice(0, 21) + '…' : ref;
      el.appendChild(label);

      // Paint waveform — see scheduleWaveformPaint() below.
      scheduleWaveformPaint(el, canvas, clip);
    } else if (isMidi) {
      const midi = document.createElement('span');
      midi.className = 'clip__midi';
      midi.textContent = '▂▃▂▅';
      el.appendChild(midi);
    } else {
      el.textContent = (clip.patternIndex != null && store.data.patterns?.[clip.patternIndex]?.name) || 'Clip';
    }

    lane.appendChild(el);
  }

  // Full render — rows + lanes + clips. Use this whenever tracks change.
  function renderAll() {
    renderTrackRows();
    renderAllClips();
  }

  // ── Wire up rerender on changes ─────────────────────────────
  store.on('change', ({ path } = {}) => {
    if (path === 'tracks' || (typeof path === 'string' && path.startsWith('tracks'))) {
      // Tracks changed → full rebuild (rows + lanes + clips).
      renderAll();
    } else if (path === 'arrangement' || path === 'patterns') {
      // Clip content changed but row/lane DOM is still valid.
      renderAllClips();
    }
  });
  store.on('loaded', () => {
    renderAll();
  });
  store.on('trackSelected', () => {
    // Selection highlight only — cheap full row render.
    renderTrackRows();
    renderAllClips();
  });
  // Audio context is created lazily on first user gesture; any audio
  // clips rendered before that have bailed out of the waveform paint
  // path (engine.ctx was null). Re-paint them once the engine is live.
  store.on('engineReady', () => {
    timeline.querySelectorAll('.clip--audio').forEach((el) => {
      const canvas = el._waveCanvas;
      const clip = el._waveClip;
      if (canvas && clip) scheduleWaveformPaint(el, canvas, clip);
    });
  });

  // If already loaded before our subscription
  if (store.projectName) {
    renderAll();
  }
}
export function initArrangementPlayhead({ store, engine }) {
  const playhead = document.querySelector('.zone--arrangement .playhead');
  if (!playhead) return;

  // Keep the element mounted; we animate `left` rather than toggling
  // visibility so the idle state still shows the line at 0%.
  playhead.style.display = 'block';

  function render() {
    // Engine may not yet be initialised (no AudioContext until first
    // user gesture). Rest at 0% while idle.
    if (!store.playing || !engine.ctx) {
      playhead.style.left = '0%';
      return;
    }
    // Keep playhead math in the same coordinate system as clip rendering:
    // both denominators are TOTAL_BEATS (the 64-beat canvas). Previously the
    // playhead used `_getLoopLength()` (in 16th-note steps) which made it
    // visually race ahead of clips when the arrangement was shorter than
    // 64 beats.  `store.currentBeat` is in 16th-note steps; /4 → beats.
    const beats = (store.currentBeat || 0) / 4;
    const pct = (beats / TOTAL_BEATS) * 100;
    playhead.style.left = pct.toFixed(3) + '%';
  }

  // main.js emits 'tick' each rAF while playing — cheapest way to get
  // smooth animation without owning another rAF loop.
  store.on('tick', render);

  // Snap home on stop; paint immediately on play so the head jumps to
  // the starting position without waiting for the next tick.
  store.on('transport', (state) => {
    if (state === 'stop') playhead.style.left = '0%';
    else render();
  });

  // Initial paint.
  render();
}
