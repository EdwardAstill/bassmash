// Zone 7 · Mixer — dynamic strips
// Track channel-strips are rebuilt from store.data.tracks on every sync.
// Bus strips (A/B) and the master strip are static in index.html.
// Preserves: fader drag + perceptual curve, M/S/R buttons, per-channel
// analyser meters, strip selection, insert/send slot toggles, track colors.
import { store } from '../../state.js';
import { BUS_COUNT } from '../../audio/mixer.js';

const UNITY_PCT = 70;
const TRACK_COLORS = ['amber', 'red', 'zinc', 'emerald', 'cyan', 'blue', 'violet'];

// -------- style injection (data-active for .mr-btn, etc.) ------------
let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-src', 'mixer-zone');
  el.textContent = `
    .mixer__tracks { display: contents; }
    .channel-strip__fader { cursor: ns-resize; user-select: none; touch-action: none; }
    .fader-cap { cursor: grab; }
    .fader-cap:active { cursor: grabbing; }
    .mr-btn { cursor: pointer; user-select: none; }
    .mr-btn[data-active="true"] {
      background: var(--accent); color: var(--accent-fg);
      border-color: var(--accent);
    }
    .mr-btn--solo[data-active="true"] {
      background: var(--accent-amber); color: var(--accent-fg);
      border-color: var(--accent-amber);
    }
    .mr-btn--rec[data-active="true"] {
      background: var(--error); color: var(--accent-fg);
      border-color: var(--error);
    }
    .channel-strip__inserts i,
    .channel-strip__sends i { cursor: pointer; }
    .channel-strip__inserts i[data-enabled="true"],
    .channel-strip__sends i[data-enabled="true"] {
      background: var(--accent); color: var(--accent-fg); border-color: var(--accent);
    }
  `;
  document.head.appendChild(el);
}

// -------- gain <-> fader-percent mapping -----------------------------
function pctToGain(pct) {
  if (pct <= 0) return 0;
  if (pct <= UNITY_PCT) return Math.pow(pct / UNITY_PCT, 2.5);
  const over = (pct - UNITY_PCT) / (100 - UNITY_PCT);
  return 1 + over * 0.5; // up to ~1.5 at 100%
}
function gainToPct(g) {
  if (g <= 0) return 0;
  if (g <= 1) return UNITY_PCT * Math.pow(g, 1 / 2.5);
  return UNITY_PCT + ((g - 1) / 0.5) * (100 - UNITY_PCT);
}
function gainToDb(g) {
  if (!g || g <= 0) return -Infinity;
  return 20 * Math.log10(g);
}
function formatDb(db) {
  if (!isFinite(db)) return '−∞';
  const sign = db < 0 ? '−' : (db > 0 ? '+' : '');
  return `${sign}${Math.abs(db).toFixed(1)}`;
}
function formatPan(p) {
  if (Math.abs(p) < 0.01) return 'C';
  const n = Math.round(Math.abs(p) * 100);
  return p < 0 ? `L ${n}` : `R ${n}`;
}

// -------- track-strip DOM builder ------------------------------------
function buildTrackStripHTML(track, index) {
  const color = (track && track.color) || TRACK_COLORS[index % TRACK_COLORS.length];
  const name  = (track && track.name) || `Track ${index + 1}`;
  return `
    <div class="channel-strip" data-color="${color}" data-role="track" data-channel-index="${index}">
      <div class="channel-strip__accent"></div>
      <div class="channel-strip__name">${escapeHtml(name)}</div>
      <div class="channel-strip__inserts"><i>EQ</i><i>Comp</i><i>+</i></div>
      <div class="channel-strip__sends"><i>A</i><i>B</i></div>
      <div class="channel-strip__pan">C</div>
      <div class="channel-strip__fader">
        <div class="fader-cap" style="bottom:${UNITY_PCT}%"></div>
        <div class="fader-meter fader-meter--l" style="height:0%"></div>
        <div class="fader-meter fader-meter--r" style="height:0%"></div>
      </div>
      <div class="channel-strip__db">0.0</div>
      <div class="channel-strip__mr">
        <span class="mr-btn">M</span>
        <span class="mr-btn mr-btn--solo">S</span>
        <span class="mr-btn mr-btn--rec">R</span>
      </div>
    </div>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// -------- main export ------------------------------------------------
export function initMixer(ctx) {
  const { engine, mixer } = ctx;
  const root = document.querySelector('.zone--workbench .mixer');
  if (!root) return;

  injectStyle();

  // Tag static buses/master with their roles so the channel-lookup works.
  const staticStrips = Array.from(root.querySelectorAll(':scope > .channel-strip'));
  staticStrips.forEach((s) => {
    if (s.classList.contains('channel-strip--master')) s.setAttribute('data-role', 'master');
    else if (s.classList.contains('channel-strip--bus')) s.setAttribute('data-role', 'bus');
  });

  let tracksHost = root.querySelector(':scope > .mixer__tracks');
  if (!tracksHost) {
    // Fallback if the container is missing: insert at start of .mixer.
    tracksHost = document.createElement('div');
    tracksHost.className = 'mixer__tracks';
    root.insertBefore(tracksHost, root.firstChild);
  }

  const busStrips   = staticStrips.filter((s) => s.dataset.role === 'bus');
  const masterStrip = staticStrips.find((s) => s.dataset.role === 'master') || null;

  // Buses live on the shared Mixer singleton (`mixer.buses`) so the
  // scheduler + offline render can see them too. We just mirror the
  // list here for the strip-lookup path.
  let buses = mixer.buses;
  let masterAdapter = null;
  const analysers = new Map();  // strip -> AnalyserNode
  const bufCache  = new Map();  // analyser -> Uint8Array
  const levels    = new Map();  // strip -> { l, r }

  // Current set of track strips (recomputed on each rebuild).
  let trackStrips = [];

  // ---- channel lookup -----------------------------------------------
  function channelForStrip(strip) {
    const role = strip.dataset.role;
    if (role === 'track')  return mixer.channels[Number(strip.dataset.channelIndex)] || null;
    if (role === 'bus')    return buses[busStrips.indexOf(strip)] || null;
    if (role === 'master') return masterAdapter;
    return null;
  }

  function buildMasterAdapter() {
    const gainParam = engine.masterGain.gain;
    return {
      name: 'MASTER',
      muted: false,
      soloed: false,
      _preMuteGain: gainParam.value || 1,
      setVolume(v) { this._preMuteGain = v; if (!this.muted) gainParam.value = v; },
      setMute(m)   { this.muted = m; gainParam.value = m ? 0 : this._preMuteGain; },
      effects: null,
    };
  }

  // Non-graph-breaking leaf tap for per-channel metering.
  function ensureAnalyser(strip, node) {
    if (!node) return null;
    if (analysers.has(strip)) return analysers.get(strip);
    try {
      const a = engine.ctx.createAnalyser();
      a.fftSize = 256;
      a.smoothingTimeConstant = 0;
      node.connect(a);
      analysers.set(strip, a);
      bufCache.set(a, new Uint8Array(a.fftSize));
      return a;
    } catch (e) {
      console.warn('[mixer] analyser tap failed', e);
      return null;
    }
  }

  // ---- rendering ----------------------------------------------------
  function renderStrip(strip) {
    const ch = channelForStrip(strip);
    const nameEl = strip.querySelector('.channel-strip__name');
    const capEl  = strip.querySelector('.fader-cap');
    const dbEl   = strip.querySelector('.channel-strip__db');
    const panEl  = strip.querySelector('.channel-strip__pan');
    const mBtn   = strip.querySelector('.mr-btn:not(.mr-btn--solo):not(.mr-btn--rec)');
    const sBtn   = strip.querySelector('.mr-btn--solo');
    const rBtn   = strip.querySelector('.mr-btn--rec');

    if (!ch) return;

    if (nameEl && ch.name) nameEl.textContent = ch.name;
    const g = ch._preMuteGain ?? 1;
    if (capEl) capEl.style.bottom = gainToPct(g).toFixed(1) + '%';
    if (dbEl)  dbEl.textContent   = formatDb(gainToDb(g));
    if (panEl && ch.pan && ch.pan.pan) panEl.textContent = formatPan(ch.pan.pan.value);
    if (mBtn) mBtn.setAttribute('data-active', ch.muted  ? 'true' : 'false');
    if (sBtn) sBtn.setAttribute('data-active', ch.soloed ? 'true' : 'false');
    if (rBtn && !rBtn.hasAttribute('data-active')) rBtn.setAttribute('data-active', 'false');
  }
  function renderAll() {
    trackStrips.forEach(renderStrip);
    busStrips.forEach(renderStrip);
    if (masterStrip) renderStrip(masterStrip);
  }

  // ---- fader drag ---------------------------------------------------
  function pctFromEvent(strip, evt) {
    const rail = strip.querySelector('.channel-strip__fader');
    const r = rail.getBoundingClientRect();
    let pct = (1 - (evt.clientY - r.top) / r.height) * 100;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct;
  }
  function applyFaderPct(strip, pct) {
    const ch = channelForStrip(strip);
    const capEl = strip.querySelector('.fader-cap');
    const dbEl  = strip.querySelector('.channel-strip__db');
    if (capEl) capEl.style.bottom = pct.toFixed(1) + '%';
    const g = pctToGain(pct);
    if (ch && typeof ch.setVolume === 'function') ch.setVolume(g);
    if (dbEl) dbEl.textContent = formatDb(gainToDb(g));
  }

  let _dragStrip = null;
  function onPointerDown(e) {
    const strip = e.currentTarget.closest('.channel-strip');
    if (!strip) return;
    _dragStrip = strip;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    _onStripDragStart(strip);
    applyFaderPct(strip, pctFromEvent(strip, e));
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!_dragStrip) return;
    applyFaderPct(_dragStrip, pctFromEvent(_dragStrip, e));
  }
  function onPointerUp() { _dragStrip = null; }

  // Wire all per-strip interactions. Track strips get re-wired on rebuild;
  // static strips are wired once (see bottom).
  function wireStrip(strip) {
    const faderEl = strip.querySelector('.channel-strip__fader');
    if (faderEl) {
      faderEl.addEventListener('pointerdown', onPointerDown);
      const cap = strip.querySelector('.fader-cap');
      if (cap) cap.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        applyFaderPct(strip, UNITY_PCT);
      });
    }

    // M / S / R
    const mBtn = strip.querySelector('.mr-btn:not(.mr-btn--solo):not(.mr-btn--rec)');
    const sBtn = strip.querySelector('.mr-btn--solo');
    const rBtn = strip.querySelector('.mr-btn--rec');
    if (mBtn) mBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ch = channelForStrip(strip);
      if (!ch) return;
      ch.setMute(!ch.muted);
      mBtn.setAttribute('data-active', ch.muted ? 'true' : 'false');
    });
    if (sBtn) sBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ch = channelForStrip(strip);
      if (!ch) return;
      if (strip.dataset.role === 'master') return;
      ch.soloed = !ch.soloed;
      sBtn.setAttribute('data-active', ch.soloed ? 'true' : 'false');
      if (typeof mixer.updateSoloState === 'function') mixer.updateSoloState();
    });
    if (rBtn) rBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = rBtn.getAttribute('data-active') !== 'true';
      rBtn.setAttribute('data-active', on ? 'true' : 'false');
      console.info('[mixer] record arm not wired', { strip: strip.dataset.channelIndex, on });
    });

    // Insert slot stubs — still cosmetic (phase-0 behaviour).
    strip.querySelectorAll('.channel-strip__inserts i').forEach((slot) => {
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        const on = slot.getAttribute('data-enabled') !== 'true';
        slot.setAttribute('data-enabled', on ? 'true' : 'false');
        console.info('[mixer] insert slot toggle (phase-0 stub)', { label: slot.textContent, on });
      });
    });

    // Send slots — real routing for track strips. Slot A == bus 0, B == bus 1.
    // Toggle flips the send on/off and persists to track.sends[busIndex].
    const sendSlots = strip.querySelectorAll('.channel-strip__sends i');
    sendSlots.forEach((slot, busIdx) => {
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (strip.dataset.role !== 'track') {
          // Buses / master don't feed other buses (no nested send routing).
          return;
        }
        const trackIdx = Number(strip.dataset.channelIndex);
        const on = slot.getAttribute('data-enabled') !== 'true';
        slot.setAttribute('data-enabled', on ? 'true' : 'false');
        if (on) {
          // Respect the track's persisted per-send gain so re-enabling
          // returns the send to the user's last chosen amount.
          const storedGains = store.data.tracks?.[trackIdx]?.sendGains;
          const g = Array.isArray(storedGains) && isFinite(Number(storedGains[busIdx]))
            ? Number(storedGains[busIdx])
            : 1.0;
          mixer.connectSend(trackIdx, busIdx, g);
        } else {
          mixer.disconnectSend(trackIdx, busIdx);
        }
        writeSendStateToStore(trackIdx);
        store.emit('sendChanged', { trackIdx, busIdx, enabled: on });
      });
    });

    // selection (track strips only emit trackSelected, others emit mixerStripSelected)
    strip.addEventListener('click', (e) => {
      const tgt = e.target;
      if (tgt.closest('.channel-strip__fader'))   return;
      if (tgt.closest('.channel-strip__mr'))      return;
      if (tgt.closest('.channel-strip__inserts')) return;
      if (tgt.closest('.channel-strip__sends'))   return;
      selectStrip(strip);
    });
  }

  function selectStrip(strip) {
    [...trackStrips, ...busStrips, masterStrip].forEach((s) => {
      if (s) s.classList.remove('channel-strip--selected');
    });
    strip.classList.add('channel-strip--selected');
    const role = strip.dataset.role;
    if (role === 'track') {
      const idx = Number(strip.dataset.channelIndex);
      store.selectedTrack = idx;
      store.emit('trackSelected', idx);
    } else {
      store.emit('mixerStripSelected', {
        role,
        index: role === 'bus' ? busStrips.indexOf(strip) : 0,
      });
    }
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup',   onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // ---- dynamic track-strip build -----------------------------------
  function rebuildTrackStrips() {
    const tracks = store.data.tracks || [];

    // Clear old strips and drop their analyser/level caches.
    trackStrips.forEach((s) => {
      const a = analysers.get(s);
      if (a) { try { a.disconnect(); } catch (_) {} }
      analysers.delete(s);
      levels.delete(s);
    });
    tracksHost.innerHTML = '';

    // Build new strips.
    const html = tracks.map((t, i) => buildTrackStripHTML(t, i)).join('');
    tracksHost.insertAdjacentHTML('beforeend', html);
    trackStrips = Array.from(tracksHost.querySelectorAll('.channel-strip'));
    trackStrips.forEach(wireStrip);

    // Restore selection highlight if applicable.
    const sel = store.selectedTrack;
    if (sel != null && sel >= 0 && sel < trackStrips.length) {
      trackStrips[sel].classList.add('channel-strip--selected');
    }

    // Paint the send slot states from the current store.data.tracks[i].sends.
    paintSendSlots();
  }

  // ---- send persistence / restore ----------------------------------
  function writeSendStateToStore(trackIdx) {
    const track = store.data.tracks && store.data.tracks[trackIdx];
    if (!track) return;
    const list = [];
    for (let b = 0; b < BUS_COUNT; b++) list.push(mixer.hasSend(trackIdx, b));
    track.sends = list;
    // Persist via autosave but do NOT emit `change:tracks` — that would
    // trigger syncChannels → rebuildTrackStrips and wipe our DOM mid-click.
    // The undo module snapshots on its own timers.
    store._scheduleSave?.();
    store.emit('trackSendsChanged', { trackIdx, sends: list });
  }
  function restoreSendsFromStore() {
    const tracks = store.data.tracks || [];
    for (let i = 0; i < tracks.length; i++) {
      const sends = Array.isArray(tracks[i]?.sends) ? tracks[i].sends : null;
      const gains = Array.isArray(tracks[i]?.sendGains) ? tracks[i].sendGains : null;
      for (let b = 0; b < BUS_COUNT; b++) {
        const want = !!(sends && sends[b]);
        const have = mixer.hasSend(i, b);
        const wantGain = (gains && isFinite(Number(gains[b]))) ? Number(gains[b]) : 1.0;
        if (want && !have) mixer.connectSend(i, b, wantGain);
        else if (!want && have) mixer.disconnectSend(i, b);
        else if (want && have) mixer.setSendGain(i, b, wantGain);
      }
    }
  }
  function paintSendSlots() {
    trackStrips.forEach((strip) => {
      const trackIdx = Number(strip.dataset.channelIndex);
      const slots = strip.querySelectorAll('.channel-strip__sends i');
      slots.forEach((slot, busIdx) => {
        const on = mixer.hasSend(trackIdx, busIdx);
        slot.setAttribute('data-enabled', on ? 'true' : 'false');
      });
    });
  }

  store.on('trackSelected', (idx) => {
    [...trackStrips, ...busStrips, masterStrip].forEach((s) => {
      if (s) s.classList.remove('channel-strip--selected');
    });
    if (idx == null || idx < 0 || idx >= trackStrips.length) return;
    trackStrips[idx].classList.add('channel-strip--selected');
  });

  // ---- engineReady / tracks-change syncing --------------------------
  function syncChannels() {
    if (!engine.ctx) return;

    const tracks = store.data.tracks || [];

    // Grow mixer.channels to match track count.
    for (let i = mixer.channels.length; i < tracks.length; i++) {
      mixer.createChannel(tracks[i].name || `Track ${i + 1}`);
    }
    // Shrink mixer.channels if tracks were removed.
    while (mixer.channels.length > tracks.length) {
      mixer.removeChannel(mixer.channels.length - 1);
    }
    // Sync names for existing channels.
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i] && tracks[i].name) mixer.channels[i].name = tracks[i].name;
    }

    // Rebuild the DOM strips to match tracks (NxN, no inert slots).
    rebuildTrackStrips();

    // Lazily init buses (owned by audio/mixer.js) and master adapter.
    mixer.ensureBuses();
    buses = mixer.buses;
    if (!masterAdapter) masterAdapter = buildMasterAdapter();

    // Replay persisted sends from store.data.tracks[i].sends[] so the
    // routing survives project load + track rebuilds. Idempotent — the
    // mixer dedupes duplicate connectSend calls by (src,bus). Repaint
    // after so the slot badges match the actual connection state.
    restoreSendsFromStore();
    paintSendSlots();

    // Hook analysers for track strips (freshly rebuilt DOM).
    trackStrips.forEach((strip) => {
      const ch = mixer.channels[Number(strip.dataset.channelIndex)];
      if (ch && ch.effects && ch.effects.output) ensureAnalyser(strip, ch.effects.output);
    });
    busStrips.forEach((strip, i) => {
      const ch = buses[i];
      if (ch && ch.effects && ch.effects.output) ensureAnalyser(strip, ch.effects.output);
    });
    if (masterStrip && engine.analyser) {
      analysers.set(masterStrip, engine.analyser);
      if (!bufCache.has(engine.analyser)) {
        bufCache.set(engine.analyser, new Uint8Array(engine.analyser.fftSize));
      }
    }

    renderAll();
  }

  store.on('engineReady', syncChannels);
  store.on('loaded', syncChannels);
  store.on('change', ({ path } = {}) => {
    if (path === 'tracks' || (typeof path === 'string' && path.startsWith('tracks'))) {
      syncChannels();
    }
  });
  // Reflect send toggles coming from elsewhere (inspector) in the strip slots.
  store.on('sendChanged', () => paintSendSlots());

  // Wire static (bus + master) strips once at init.
  staticStrips.forEach(wireStrip);

  // Pre-engine paint: build any existing track strips immediately so the
  // DOM count matches the project, even before the audio engine starts.
  // They'll become live (channels backed) once engineReady fires.
  if ((store.data.tracks || []).length) {
    rebuildTrackStrips();
  }

  // ---- meters loop --------------------------------------------------
  function rmsFromAnalyser(analyser) {
    const buf = bufCache.get(analyser);
    if (!buf) return 0;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }
  function meterTick() {
    requestAnimationFrame(meterTick);
    if (!engine.ctx) return;
    const playing = !!store.playing;
    const allStrips = [...trackStrips, ...busStrips];
    if (masterStrip) allStrips.push(masterStrip);
    allStrips.forEach((strip) => {
      const a = analysers.get(strip);
      const lEl = strip.querySelector('.fader-meter--l');
      const rEl = strip.querySelector('.fader-meter--r');
      if (!lEl || !rEl) return;
      let target = 0;
      if (a && playing) {
        const rms = rmsFromAnalyser(a);
        target = Math.min(1, rms * 2.2) * 100;
      }
      const prev = levels.get(strip) || { l: 0, r: 0 };
      const alpha = target > prev.l ? 0.55 : 0.2; // fast attack, slow release
      const nl = prev.l + (target - prev.l) * alpha;
      const nr = prev.r + (target * 0.97 - prev.r) * alpha;
      levels.set(strip, { l: nl, r: nr });
      lEl.style.height = nl.toFixed(1) + '%';
      rEl.style.height = nr.toFixed(1) + '%';
    });

    // Live-read fader from channel.gain.gain.value during playback so
    // automation ramps drive the visible fader position. While the user
    // is dragging a strip (_dragStrip), they take control back — we skip
    // the live read for that strip and let their drag value stand.
    if (playing) {
      trackStrips.forEach((strip) => {
        if (strip === _dragStrip) return;
        const ch = channelForStrip(strip);
        if (!ch || !ch.gain) return;
        // If the user-facing value was forced to 0 by mute, read the
        // baseline instead so the fader doesn't collapse.
        const live = ch.muted ? (ch._preMuteGain ?? 0) : ch.gain.gain.value;
        const capEl = strip.querySelector('.fader-cap');
        const dbEl  = strip.querySelector('.channel-strip__db');
        if (capEl) capEl.style.bottom = gainToPct(live).toFixed(1) + '%';
        if (dbEl)  dbEl.textContent   = formatDb(gainToDb(live));
      });
      // Selected track's inspector volume knob also mirrors the live
      // gain. Emit so the inspector can update without a render cycle.
      const selIdx = store.selectedTrack;
      if (selIdx != null && selIdx >= 0 && selIdx < mixer.channels.length) {
        const selCh = mixer.channels[selIdx];
        if (selCh && selCh.gain) {
          const live = selCh.muted ? (selCh._preMuteGain ?? 0) : selCh.gain.gain.value;
          store.emit('mixerLiveGain', { trackIdx: selIdx, value: live });
        }
      }
    }
  }

  // On drag-start we ask the audio mixer to cancel any scheduled ramps
  // on this channel so the user's drag isn't immediately undone by the
  // next setValueAtTime call from the scheduler. The scheduler will
  // re-schedule from the next beat — so the user's value holds until
  // then. That matches the "drag wins while pressed" UX.
  function _onStripDragStart(strip) {
    if (!engine.ctx) return;
    if (strip.dataset.role !== 'track') return;
    const t = Number(strip.dataset.channelIndex);
    if (Number.isFinite(t) && typeof mixer.cancelAutomationAfter === 'function') {
      mixer.cancelAutomationAfter(t, engine.ctx.currentTime);
    }
  }
  requestAnimationFrame(meterTick);
}
