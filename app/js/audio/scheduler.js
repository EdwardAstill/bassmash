// Phase 1c · Audio scheduler — bridges engine 'beat' events to sampler + mixer
// Owner: phase-1c agent. Phase 3b extends this to also trigger audio-type
// clips (full-file playback routed via the shared audio-cache).
//
// Responsibilities:
//   · listen for engine 'beat' events and fire sampler triggers for any
//     pattern clip whose span covers the current 16th-note step
//   · trigger audio clips at the 16th-note boundary where they start, with
//     a hard stop at clip.lengthBeats so long samples get truncated
//   · route each trigger to the appropriate mixer channel.input node
//   · retain active BufferSources so transport 'stop' can hard-kill them
//   · warm both the sampler cache and the audio-cache on project load +
//     arrangement / pattern edits

import { api } from '../api.js';
import { audioCache } from './audio-cache.js';
import { bpmAtBeat } from './tempo.js';

export function initScheduler({ store, sampler, mixer, engine }) {
  const _activeAudioSources = [];
  // Clips we've already warned about missing-buffer for, so we don't spam
  // the console on every 16th-note tick while a decode is in flight.
  const _warnedAudioRefs = new Set();

  // ── Automation (P2 #5) ────────────────────────────────────────────
  // Per-track volume breakpoints live on `track.automation.volume` as
  // { beat, value } entries (beat = quarter notes). We interpolate
  // linearly between points and drive the mixer channel's gain via
  // setValueAtTime + linearRampToValueAtTime at each 16th-note tick.
  //
  // Strategy: on every `beat` event, schedule a short ramp from the
  // interpolated value at the current step to the value one 16th-note
  // later. This keeps us reading only a local window and is immune to
  // looping + on-the-fly edits. On transport:stop we cancel scheduled
  // values so the mixer strip fader isn't left stuck.
  const _baselineGain = new Map();       // trackIndex -> pre-automation gain

  function interpolateAutomation(points, beat) {
    if (!Array.isArray(points) || points.length === 0) return null;
    // Sorted by convention (UI sorts on commit); bail to linear scan.
    let prev = null;
    for (const p of points) {
      if (p.beat <= beat) {
        if (!prev || p.beat > prev.beat) prev = p;
      } else {
        // First point strictly after `beat`.
        if (!prev) return p.value;   // before first point — hold first
        const span = p.beat - prev.beat;
        if (span <= 0) return p.value;
        const t = (beat - prev.beat) / span;
        return prev.value + (p.value - prev.value) * t;
      }
    }
    // Past the last point — hold last.
    return prev ? prev.value : null;
  }

  function precacheAudioClips() {
    if (!engine?.ctx) return; // no AudioContext yet → skip; we'll retry on next change
    const arrangement = store.data.arrangement || [];
    for (const clip of arrangement) {
      if (clip.type !== 'audio' || !clip.audioRef) continue;
      const url = api.audioUrl(store.projectName, clip.audioRef);
      audioCache.load(url, engine).catch(() => { /* already logged in cache */ });
    }
  }

  // Preload whatever is already in the project (engineReady fires after
  // the project load handler, so 'loaded' may have already passed).
  sampler.preloadProject().catch((err) =>
    console.warn('[scheduler] preloadProject failed', err)
  );
  precacheAudioClips();

  // Refresh the sampler cache whenever arrangement / patterns / tracks
  // change. Sampler.load() is a no-op for already-cached refs.
  store.on('change', ({ path }) => {
    if (path === 'arrangement' || path === 'patterns' || path === 'tracks') {
      sampler.preloadProject().catch((err) =>
        console.warn('[scheduler] preloadProject failed', err)
      );
    }
    if (path === 'arrangement') {
      precacheAudioClips();
    }
  });

  // In case a fresh project gets loaded after the engine is up.
  store.on('loaded', () => {
    sampler.preloadProject().catch((err) =>
      console.warn('[scheduler] preloadProject failed', err)
    );
    precacheAudioClips();
  });

  // Core scheduling — fires per 16th-note beat from the engine.
  store.on('beat', ({ beat, time }) => {
    const tracks = store.data.tracks || [];
    const arrangement = store.data.arrangement || [];
    const patterns = store.data.patterns || [];
    // P3 #11 — honor tempo changes at playback time. `beat` is the current
    // 16th-note step; bpmAtBeat looks up the active tempo entry. On every
    // tick we re-read so a user editing a tempo marker mid-playback takes
    // effect on the next 16th.
    const secondsPerBeat = 60 / bpmAtBeat(store.data, beat);
    const secondsPerStep = secondsPerBeat / 4;   // 16th note

    for (let t = 0; t < tracks.length; t++) {
      const track = tracks[t];
      if (!track || track.muted === true) continue;

      // Mixer agent may not yet have created a channel for this track
      // (race during boot, or track added before mixer noticed it). Skip
      // gracefully — the sampler trigger requires a real destination node.
      const channel = mixer.channels[t];
      if (!channel) continue;

      // Automation — schedule a 16th-note ramp on this channel's gain
      // param every tick. Reading only the current + next step's value
      // keeps this O(points) per tick without planning the full arrangement.
      const autoPts = track.automation?.volume;
      if (Array.isArray(autoPts) && autoPts.length > 0 && channel.gain) {
        const curBeat = beat / 4;                      // step -> quarter notes
        const nextBeat = (beat + 1) / 4;
        const curVal = interpolateAutomation(autoPts, curBeat);
        const nextVal = interpolateAutomation(autoPts, nextBeat);
        if (curVal != null && nextVal != null) {
          // Remember the pre-automation gain once so we can restore it
          // on transport stop.
          if (!_baselineGain.has(t)) {
            _baselineGain.set(t, channel._preMuteGain ?? channel.gain.gain.value ?? 1);
          }
          try {
            channel.gain.gain.cancelScheduledValues(time);
            channel.gain.gain.setValueAtTime(Math.max(0, curVal), time);
            channel.gain.gain.linearRampToValueAtTime(
              Math.max(0, nextVal),
              time + secondsPerStep,
            );
          } catch (err) {
            console.warn('[scheduler] automation schedule failed', err);
          }
        }
      }

      for (const clip of arrangement) {
        if (clip.trackIndex !== t) continue;
        // Per-clip mute (phase 2b data, phase 4 scheduler) — silence
        // this entry regardless of type without affecting siblings.
        if (clip.muted === true) continue;

        // ── Audio clips (phase 3b) ──────────────────────────────
        if (clip.type === 'audio') {
          // Fire once, at the clip's starting 16th-note boundary. Don't
          // retrigger mid-clip.
          const clipStartStep = Math.round(clip.startBeat * 4);
          if (beat !== clipStartStep) continue;
          if (!clip.audioRef) continue;

          const url = api.audioUrl(store.projectName, clip.audioRef);
          const buffer = audioCache.getSync(url);
          if (!buffer) {
            if (!_warnedAudioRefs.has(clip.audioRef)) {
              console.info(`[scheduler] audio buffer not ready: ${clip.audioRef} (will skip this trigger)`);
              _warnedAudioRefs.add(clip.audioRef);
            }
            // Kick off / continue a decode so future triggers land.
            audioCache.load(url, engine).catch(() => { /* handled in cache */ });
            continue;
          }

          const src = engine.ctx.createBufferSource();
          src.buffer = buffer;
          try { src.connect(channel.input); } catch (_) { continue; }
          const offset = Math.max(0, clip.offset || 0);
          const stopAt = time + (clip.lengthBeats || 0) * secondsPerBeat;
          try {
            src.start(time, offset);
            if (clip.lengthBeats > 0) src.stop(stopAt);
          } catch (err) {
            console.warn('[scheduler] audio clip start/stop failed', err);
            continue;
          }
          _activeAudioSources.push(src);
          src.onended = () => {
            const idx = _activeAudioSources.indexOf(src);
            if (idx !== -1) _activeAudioSources.splice(idx, 1);
          };
          continue;
        }

        // ── Pattern clips (original behaviour) ──────────────────
        const clipStartStep = clip.startBeat * 4;
        const clipEndStep = (clip.startBeat + clip.lengthBeats) * 4;
        if (beat < clipStartStep || beat >= clipEndStep) continue;

        const localStep = beat - clipStartStep;
        const pattern = patterns[clip.patternIndex];
        if (!pattern) continue;

        // Drum/sample pattern — step grid.
        if (Array.isArray(pattern.steps)) {
          const stepCount = pattern.stepCount || 16;
          const stepIdx = localStep % stepCount;
          for (const row of pattern.steps) {
            if (!row || !row.cells) continue;
            if (!row.cells[stepIdx]) continue;
            // P2 #7 — ghost-note / mute support. Cell stays "on" in the
            // UI but the scheduler drops the trigger so the hit is
            // silent. Projects without `muted` see undefined → no skip.
            if (row.muted && row.muted[stepIdx] === true) continue;
            if (!row.sampleRef) continue;

            // Per-row gain: wrap the trigger in a local gain node so
            // sampler.play stays untouched (it has no gain option).
            const rowGain = (row.gain == null ? 1 : Number(row.gain));
            let dest = channel.input;
            let gainNode = null;
            if (isFinite(rowGain) && rowGain !== 1) {
              try {
                gainNode = engine.ctx.createGain();
                gainNode.gain.value = rowGain;
                gainNode.connect(channel.input);
                dest = gainNode;
              } catch (_) { dest = channel.input; gainNode = null; }
            }

            // Per-row pitch (semitones → playbackRate).
            const semi = Number(row.pitch) || 0;
            const playbackRate = semi === 0 ? 1 : Math.pow(2, semi / 12);

            const src = sampler.play(row.sampleRef, time, dest, {
              playbackRate,
              loop: !!row.loop,
            });
            if (src) {
              _activeAudioSources.push(src);
              src.onended = () => {
                const idx = _activeAudioSources.indexOf(src);
                if (idx !== -1) _activeAudioSources.splice(idx, 1);
                if (gainNode) { try { gainNode.disconnect(); } catch (_) {} }
              };
            } else if (gainNode) {
              try { gainNode.disconnect(); } catch (_) {}
            }
          }
        }
        // Synth / note patterns are deferred to a later phase.
      }
    }
  });

  // Hard-stop everything on transport stop.
  store.on('transport', (state) => {
    if (state !== 'stop') return;
    for (const src of _activeAudioSources) {
      try { src.stop(); } catch (_) { /* already stopped */ }
    }
    _activeAudioSources.length = 0;

    // Restore any automated channels to their pre-automation gain so the
    // mixer fader doesn't look stuck at the last breakpoint value.
    const now = engine?.ctx?.currentTime ?? 0;
    for (const [t, baseline] of _baselineGain) {
      const ch = mixer.channels[t];
      if (!ch?.gain) continue;
      try {
        ch.gain.gain.cancelScheduledValues(now);
        ch.gain.gain.setValueAtTime(ch.muted ? 0 : baseline, now);
      } catch (_) { /* best-effort */ }
    }
    _baselineGain.clear();
  });
}
