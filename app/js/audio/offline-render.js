// Offline render — rebuilds the live mixer + scheduler logic inside an
// OfflineAudioContext so the whole arrangement can be bounced to a WAV
// blob without the real-time engine running.
//
// Design notes:
//   · We mirror (but do NOT reuse) the live `MixerChannel` / `EffectsChain`
//     classes because they bind to the singleton live `engine.ctx`. For the
//     bounce we need identical nodes built against the offline ctx, with
//     current gain/pan/effect wet values copied from the live channel.
//   · We replay the same per-16th-note beat math the scheduler uses
//     (`app/js/audio/scheduler.js`) but run it once synchronously over the
//     full arrangement length ahead of `startRendering()`.
//   · Samples / audio clips are fetched and decoded *again* against the
//     offline ctx (AudioBuffers can't be shared across contexts).
//
// Additive: the live scheduler and mixer modules are untouched.

import { engine } from './engine.js';
import { mixer as liveMixer } from './mixer.js';
import { store } from '../state.js';
import { api } from '../api.js';
import { bpmAtBeat } from './tempo.js';
import { clampAutomationValue } from './automation-util.js';

const REVERB_TAIL_SECONDS = 2.5;

// ─── mixer mirror ──────────────────────────────────────────────────────
// Rebuilds the MixerChannel effects graph inside the offline context and
// copies every mutable parameter off the matching live channel. Returns
// `{ input }` — the scheduler wires buffer sources into `.input` exactly
// like it does live.

function buildOfflineChannel(offCtx, destination, liveChannel, options = {}) {
  const { isBus = false } = options;
  const input  = offCtx.createGain();
  const output = offCtx.createGain();

  // Rebuild the 3-band EQ from the live settings.
  const live = liveChannel && liveChannel.effects;
  const eqLow  = offCtx.createBiquadFilter(); eqLow.type  = 'lowshelf';
  const eqMid  = offCtx.createBiquadFilter(); eqMid.type  = 'peaking';
  const eqHigh = offCtx.createBiquadFilter(); eqHigh.type = 'highshelf';
  eqLow.frequency.value  = live?.eq?.low?.frequency?.value  ?? 200;
  eqMid.frequency.value  = live?.eq?.mid?.frequency?.value  ?? 1000;
  eqMid.Q.value          = live?.eq?.mid?.Q?.value          ?? 1;
  eqHigh.frequency.value = live?.eq?.high?.frequency?.value ?? 4000;
  eqLow.gain.value  = live?.eq?.low?.gain?.value  ?? 0;
  eqMid.gain.value  = live?.eq?.mid?.gain?.value  ?? 0;
  eqHigh.gain.value = live?.eq?.high?.gain?.value ?? 0;

  // Distortion — identical curve-building logic as `effects.js`.
  const distCurve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1;
    distCurve[i] = (Math.PI + 20) * x / (Math.PI + 20 * Math.abs(x));
  }
  const distShaper = offCtx.createWaveShaper();
  distShaper.curve = distCurve;
  distShaper.oversample = '2x';
  const distDry = offCtx.createGain();
  const distWet = offCtx.createGain();
  distDry.gain.value = live?.distortion?.dry?.gain?.value ?? 1;
  distWet.gain.value = live?.distortion?.wet?.gain?.value ?? 0;

  // Delay.
  const delayNode     = offCtx.createDelay(2.0);
  const delayFeedback = offCtx.createGain();
  const delayDry      = offCtx.createGain();
  const delayWet      = offCtx.createGain();
  delayNode.delayTime.value   = live?.delay?.node?.delayTime?.value ?? 0.375;
  delayFeedback.gain.value    = live?.delay?.feedback?.gain?.value  ?? 0.4;
  delayDry.gain.value         = live?.delay?.dry?.gain?.value       ?? 1;
  delayWet.gain.value         = live?.delay?.wet?.gain?.value       ?? 0;
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);

  // Reverb — reuse the live convolver's IR buffer if available. If the
  // buffer was generated at a different sample rate it's still valid as
  // ConvolverNode will resample internally.
  const convolver  = offCtx.createConvolver();
  if (live?.reverb?.convolver?.buffer) {
    try { convolver.buffer = live.reverb.convolver.buffer; } catch (_) { /* ignore */ }
  }
  const reverbDry = offCtx.createGain();
  const reverbWet = offCtx.createGain();
  reverbDry.gain.value = live?.reverb?.dry?.gain?.value ?? 1;
  reverbWet.gain.value = live?.reverb?.wet?.gain?.value ?? 0;

  // Wire: input -> EQ -> dist split -> delay split -> reverb split -> output
  input.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
  eqHigh.connect(distDry);
  eqHigh.connect(distShaper); distShaper.connect(distWet);
  const distMerge = offCtx.createGain();
  distDry.connect(distMerge); distWet.connect(distMerge);
  distMerge.connect(delayDry);
  distMerge.connect(delayNode); delayNode.connect(delayWet);
  const delayMerge = offCtx.createGain();
  delayDry.connect(delayMerge); delayWet.connect(delayMerge);
  delayMerge.connect(reverbDry);
  delayMerge.connect(convolver); convolver.connect(reverbWet);
  reverbDry.connect(output); reverbWet.connect(output);

  // Gain + pan, copied off the live channel.
  const chGain = offCtx.createGain();
  const chPan  = offCtx.createStereoPanner();
  const liveGain = liveChannel?.gain?.gain?.value ?? liveChannel?._preMuteGain ?? 1;
  chGain.gain.value = liveChannel?.muted ? 0 : liveGain;
  chPan.pan.value   = liveChannel?.pan?.pan?.value ?? 0;

  output.connect(chGain);
  chGain.connect(chPan);
  chPan.connect(destination);

  // For non-bus channels, `chPan` is the post-fader send tap — matches the
  // `MixerChannel.sendTap` getter in the live mixer. For buses we never
  // tap, but we return it all the same for structural parity.
  //
  // Expose every node the offline automation loop may want to ramp —
  // matches the live `mixer.getAutomationParam` taxonomy so the two
  // renderers stay in lockstep. Per-bus sends live on a sibling map
  // (built out in `renderArrangementToWav`) rather than here.
  return {
    input,
    sendTap: chPan,
    isBus,
    gain: chGain,
    pan: chPan,
    baselineGain: chGain.gain.value,
    effects: {
      eq: { low: eqLow, mid: eqMid, high: eqHigh },
      reverb: { wet: reverbWet, dry: reverbDry },
      delay: { wet: delayWet, dry: delayDry, node: delayNode, feedback: delayFeedback },
      distortion: { wet: distWet, dry: distDry },
    },
  };
}

// Resolve an AudioParam on the offline graph. Mirrors
// `mixer.getAutomationParam` for live playback but reads the offline
// channels + the offline send-gain map (`sendGainsByTrack[t][busIdx]`).
// Returns null if the target doesn't exist in the offline graph (e.g.
// a send that wasn't wired).
function getOfflineAutomationParam(channels, sendGainsByTrack, trackIdx, paramKey) {
  const ch = channels[trackIdx];
  if (!ch) return null;
  switch (paramKey) {
    case 'volume':   return ch.gain?.gain ?? null;
    case 'pan':      return ch.pan?.pan ?? null;
    case 'sendA':    return sendGainsByTrack?.[trackIdx]?.[0]?.gain ?? null;
    case 'sendB':    return sendGainsByTrack?.[trackIdx]?.[1]?.gain ?? null;
    case 'fxReverb': return ch.effects?.reverb?.wet?.gain ?? null;
    case 'fxDelay':  return ch.effects?.delay?.wet?.gain ?? null;
    case 'fxEqLow':  return ch.effects?.eq?.low?.gain ?? null;
    case 'fxEqMid':  return ch.effects?.eq?.mid?.gain ?? null;
    case 'fxEqHigh': return ch.effects?.eq?.high?.gain ?? null;
    default:         return null;
  }
}

const OFFLINE_AUTOMATION_KEYS = [
  'volume', 'pan', 'sendA', 'sendB',
  'fxReverb', 'fxDelay', 'fxEqLow', 'fxEqMid', 'fxEqHigh',
];

// ─── sample fetch/decode for the offline ctx ───────────────────────────

async function decodeAt(offCtx, url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${resp.status} ${url}`);
  const ab = await resp.arrayBuffer();
  return offCtx.decodeAudioData(ab);
}

function collectSampleRefs(arrangement, patterns) {
  const refs = new Set();
  for (const clip of arrangement) {
    if (clip.type === 'audio') continue;
    const pat = patterns[clip.patternIndex];
    if (!pat || !Array.isArray(pat.steps)) continue;
    for (const row of pat.steps) {
      if (row && row.sampleRef) refs.add(row.sampleRef);
    }
  }
  return [...refs];
}

function collectAudioRefs(arrangement) {
  const refs = new Set();
  for (const clip of arrangement) {
    if (clip.type === 'audio' && clip.audioRef) refs.add(clip.audioRef);
  }
  return [...refs];
}

// ─── total length ──────────────────────────────────────────────────────

// Build a cumulative-time lookup table over 16th-note steps, honoring
// tempoChanges. cumTimeAtStep[i] = seconds elapsed at the *start* of step i.
// Pass `maxSteps` for the largest index you intend to probe (inclusive), or
// leave unset and supply it later. Stored in 16ths because the engine fires
// per-16th and tempoChanges are also recorded in 16ths.
function buildCumulativeStepTimes(data, maxSteps) {
  const out = new Float64Array(maxSteps + 1);
  out[0] = 0;
  for (let i = 0; i < maxSteps; i++) {
    const spb = 60 / bpmAtBeat(data, i);
    out[i + 1] = out[i] + spb / 4;
  }
  return out;
}

function computeLengthSeconds() {
  const arrangement = store.data.arrangement || [];
  let maxEndBeats = 0;
  for (const clip of arrangement) {
    const end = (clip.startBeat || 0) + (clip.lengthBeats || 0);
    if (end > maxEndBeats) maxEndBeats = end;
  }
  // Always render at least one bar so an empty project produces a valid
  // (near-silent) MP3 rather than a zero-length buffer.
  if (maxEndBeats === 0) maxEndBeats = 4;
  const maxEndSteps = Math.ceil(maxEndBeats * 4);
  const cum = buildCumulativeStepTimes(store.data, maxEndSteps);
  return cum[maxEndSteps] + REVERB_TAIL_SECONDS;
}

// ─── scheduler replay ──────────────────────────────────────────────────

// Linear interpolate a value between sorted breakpoints (mirrors the
// implementation used by `app/js/audio/scheduler.js`).
function interpolateAutomation(points, beat) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let prev = null;
  for (const p of points) {
    if (p.beat <= beat) {
      if (!prev || p.beat > prev.beat) prev = p;
    } else {
      if (!prev) return p.value;
      const span = p.beat - prev.beat;
      if (span <= 0) return p.value;
      const t = (beat - prev.beat) / span;
      return prev.value + (p.value - prev.value) * t;
    }
  }
  return prev ? prev.value : null;
}

// Offline-capable mirror of Synth.playNote — mirrors single-osc + filter + ADSR
// AND advanced mode (osc2, LFO, filter envelope) so MP3 bounces match live
// playback.  Kept inline rather than reusing Synth because Synth binds to the
// singleton engine.ctx.
function renderOfflineNote(offCtx, frequency, time, duration, params, destination) {
  const p = Object.assign({
    waveform: 'sawtooth', filterType: 'lowpass', filterFreq: 2000, filterQ: 1,
    attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2,
    osc2Waveform: 'square', osc2Detune: 7,
    filterEnvAmount: 1000, filterAttack: 0.01, filterDecay: 0.3,
    filterSustain: 0.4, filterRelease: 0.2,
    lfoRate: 4, lfoAmount: 0, lfoTarget: 'pitch',
  }, params);
  const endTime = time + duration;
  const releaseStart = Math.max(time, endTime - p.release);
  const decayEnd     = Math.min(time + p.attack + p.decay, releaseStart);
  const attackEnd    = Math.min(time + p.attack, decayEnd);

  const osc1 = offCtx.createOscillator();
  osc1.type = p.waveform;
  osc1.frequency.setValueAtTime(frequency, time);
  const filter = offCtx.createBiquadFilter();
  filter.type = p.filterType;
  filter.frequency.setValueAtTime(p.filterFreq, time);
  filter.Q.setValueAtTime(p.filterQ, time);
  const amp = offCtx.createGain();
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(1, attackEnd);
  amp.gain.linearRampToValueAtTime(p.sustain, decayEnd);
  amp.gain.setValueAtTime(p.sustain, releaseStart);
  amp.gain.linearRampToValueAtTime(0, endTime);
  osc1.connect(filter);

  let osc2 = null;
  if (store.synthMode === 'advanced') {
    osc2 = offCtx.createOscillator();
    osc2.type = p.osc2Waveform;
    osc2.frequency.setValueAtTime(frequency, time);
    osc2.detune.setValueAtTime(p.osc2Detune, time);
    osc2.connect(filter);

    const filterReleaseStart = Math.max(time, endTime - p.filterRelease);
    const filterDecayEnd     = Math.min(time + p.filterAttack + p.filterDecay, filterReleaseStart);
    const filterAttackEnd    = Math.min(time + p.filterAttack, filterDecayEnd);
    const sustainHz = p.filterFreq + p.filterEnvAmount * p.filterSustain;
    filter.frequency.linearRampToValueAtTime(p.filterFreq + p.filterEnvAmount, filterAttackEnd);
    filter.frequency.linearRampToValueAtTime(sustainHz, filterDecayEnd);
    filter.frequency.setValueAtTime(sustainHz, filterReleaseStart);
    filter.frequency.linearRampToValueAtTime(p.filterFreq, endTime);

    if (p.lfoAmount > 0) {
      const lfo = offCtx.createOscillator();
      lfo.frequency.setValueAtTime(p.lfoRate, time);
      const lfoGain = offCtx.createGain();
      lfoGain.gain.setValueAtTime(p.lfoAmount, time);
      lfo.connect(lfoGain);
      if (p.lfoTarget === 'pitch') {
        lfoGain.connect(osc1.frequency);
        lfoGain.connect(osc2.frequency);
      } else if (p.lfoTarget === 'filter') {
        lfoGain.connect(filter.frequency);
      } else if (p.lfoTarget === 'amplitude') {
        lfoGain.connect(amp.gain);
      }
      lfo.start(time); lfo.stop(endTime);
    }
    osc2.start(time); osc2.stop(endTime);
  }

  filter.connect(amp); amp.connect(destination);
  osc1.start(time); osc1.stop(endTime);
}

function scheduleArrangement(offCtx, channels, sampleBuffers, audioBuffers, sendGainsByTrack = []) {
  const tracks      = store.data.tracks      || [];
  const arrangement = store.data.arrangement || [];
  const patterns    = store.data.patterns    || [];

  // Walk every 16th-note step up to the last clip boundary. This mirrors
  // `scheduler.js` exactly, minus the real-time timer — we feed the same
  // (beat, time) pairs straight to buffer-source creation.
  let maxEndSteps = 0;
  for (const clip of arrangement) {
    const end = ((clip.startBeat || 0) + (clip.lengthBeats || 0)) * 4;
    if (end > maxEndSteps) maxEndSteps = end;
  }
  maxEndSteps = Math.ceil(maxEndSteps);

  // P3 #11 — precompute the elapsed-time at the start of every 16th step so
  // tempoChanges affect offline bounces identically to live playback.
  // cumTime[i] is the seconds-from-start at the start of step i.
  // We size it to one past maxEndSteps so a clip ending exactly at the last
  // step has a valid stop time.
  const cumTime = buildCumulativeStepTimes(store.data, maxEndSteps + 1);
  // Local helpers that match the live scheduler naming.
  const stepTime = (step) => {
    if (step <= 0) return 0;
    if (step >= cumTime.length) return cumTime[cumTime.length - 1];
    return cumTime[step];
  };

  // ── Automation pass ───────────────────────────────────────────────
  // Replay every automated param on each track's offline graph. Uses
  // the same per-16th-note ramp strategy as the live scheduler, but with
  // offline times (starting at t=0) instead of engine.ctx.currentTime.
  // Missing targets (e.g. a send that was never wired) are skipped so
  // offline bounces don't throw on sparse data.
  for (let t = 0; t < tracks.length; t++) {
    const track = tracks[t];
    if (!track || track.muted === true) continue;
    const automation = track.automation;
    if (!automation || typeof automation !== 'object') continue;

    for (const paramKey of OFFLINE_AUTOMATION_KEYS) {
      const autoPts = automation[paramKey];
      if (!Array.isArray(autoPts) || autoPts.length === 0) continue;
      const param = getOfflineAutomationParam(channels, sendGainsByTrack, t, paramKey);
      if (!param) continue;

      const clampV = (v) => clampAutomationValue(paramKey, v);

      for (let beat = 0; beat < maxEndSteps; beat++) {
        const time = stepTime(beat);
        const curBeat = beat / 4;
        const nextBeat = (beat + 1) / 4;
        const curVal = interpolateAutomation(autoPts, curBeat);
        const nextVal = interpolateAutomation(autoPts, nextBeat);
        if (curVal == null || nextVal == null) continue;
        try {
          param.setValueAtTime(clampV(curVal), time);
          param.linearRampToValueAtTime(clampV(nextVal), stepTime(beat + 1));
        } catch (err) {
          console.warn('[offline-render] automation schedule failed', { t, paramKey, beat, err });
          break;
        }
      }
    }
  }

  for (let beat = 0; beat < maxEndSteps; beat++) {
    const time = stepTime(beat);

    for (let t = 0; t < tracks.length; t++) {
      const track = tracks[t];
      if (!track || track.muted === true) continue;
      const channel = channels[t];
      if (!channel) continue;

      for (const clip of arrangement) {
        if (clip.trackIndex !== t) continue;
        if (clip.muted === true) continue;

        // ─ Audio clips ─
        if (clip.type === 'audio') {
          const clipStartStep = Math.round((clip.startBeat || 0) * 4);
          if (beat !== clipStartStep) continue;
          if (!clip.audioRef) continue;
          const buf = audioBuffers.get(clip.audioRef);
          if (!buf) continue;
          const src = offCtx.createBufferSource();
          src.buffer = buf;
          try { src.connect(channel.input); } catch (_) { continue; }
          const offset = Math.max(0, clip.offset || 0);
          // Stop-time spans tempo-change zones: convert the clip's end step
          // via the cumulative lookup rather than a single bpm multiply.
          const clipEndStep = Math.round(
            ((clip.startBeat || 0) + (clip.lengthBeats || 0)) * 4
          );
          const stopAt = stepTime(clipEndStep);
          try {
            src.start(time, offset);
            if ((clip.lengthBeats || 0) > 0) src.stop(stopAt);
          } catch (err) {
            // Shouldn't happen in offline, but keep parity with live scheduler.
            console.warn('[offline-render] audio clip start/stop failed', err);
          }
          continue;
        }

        // ─ Pattern clips ─
        const clipStartStep = (clip.startBeat || 0) * 4;
        const clipEndStep   = ((clip.startBeat || 0) + (clip.lengthBeats || 0)) * 4;
        if (beat < clipStartStep || beat >= clipEndStep) continue;

        const localStep = beat - clipStartStep;
        const pattern = patterns[clip.patternIndex];
        if (!pattern) continue;

        // Synth / note patterns — mirror the live scheduler.
        if (Array.isArray(pattern.notes)) {
          const params = track?.synthParams || {};
          const secondsPerStep = (stepTime(beat + 1) - stepTime(beat));
          for (const note of pattern.notes) {
            if (typeof note?.start !== 'number') continue;
            if (note.start !== localStep) continue;
            const dur = Math.max(1, note.duration || 1) * secondsPerStep;
            const freq = 440 * Math.pow(2, ((note.pitch || 60) - 69) / 12);
            const vel = (note.velocity != null ? note.velocity : 100) / 127;
            const velGain = offCtx.createGain();
            velGain.gain.value = vel;
            try { velGain.connect(channel.input); } catch (_) { continue; }
            renderOfflineNote(offCtx, freq, time, dur, params, velGain);
          }
          continue;
        }

        if (!Array.isArray(pattern.steps)) continue;
        const stepCount = pattern.stepCount || 16;
        const stepIdx = localStep % stepCount;

        for (const row of pattern.steps) {
          if (!row || !row.cells) continue;
          if (!row.cells[stepIdx]) continue;
          // Mirror live scheduler: ghost-note mute drops the trigger
          // entirely so the bounced MP3 matches realtime playback.
          if (row.muted && row.muted[stepIdx] === true) continue;
          if (!row.sampleRef) continue;
          const buf = sampleBuffers.get(row.sampleRef);
          if (!buf) continue;

          // Per-row gain — wrap in an offline GainNode when != 1 so the
          // bounce matches the live scheduler's behaviour.
          const rowGain = (row.gain == null ? 1 : Number(row.gain));
          let dest = channel.input;
          let gainNode = null;
          if (isFinite(rowGain) && rowGain !== 1) {
            try {
              gainNode = offCtx.createGain();
              gainNode.gain.value = rowGain;
              gainNode.connect(channel.input);
              dest = gainNode;
            } catch (_) { dest = channel.input; gainNode = null; }
          }

          const src = offCtx.createBufferSource();
          src.buffer = buf;

          // Per-row pitch (semitones → playbackRate).
          const semi = Number(row.pitch) || 0;
          if (semi !== 0) {
            try { src.playbackRate.value = Math.pow(2, semi / 12); } catch (_) {}
          }

          // Per-row loop flag.
          if (row.loop) {
            try { src.loop = true; } catch (_) {}
          }

          try { src.connect(dest); } catch (_) { continue; }
          try { src.start(time); } catch (err) {
            console.warn('[offline-render] sample start failed', err);
          }
        }
      }
    }
  }
}

// ─── WAV encoder (16-bit PCM, interleaved) ─────────────────────────────

function audioBufferToWav(buffer) {
  const numChannels   = buffer.numberOfChannels;
  const sampleRate    = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign    = numChannels * bytesPerSample;
  const dataLength    = buffer.length * blockAlign;
  const totalLength   = 44 + dataLength;
  const arrayBuffer   = new ArrayBuffer(totalLength);
  const view          = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);           // fmt chunk size
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);           // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
}

// ─── public entrypoint ─────────────────────────────────────────────────

/**
 * Renders the whole arrangement to a WAV blob using an OfflineAudioContext.
 * Does NOT touch live engine state. The returned blob matches the engine's
 * sample rate, stereo, 16-bit PCM.
 *
 * @param {(msg:string)=>void} [onProgress] — optional status callback
 * @returns {Promise<Blob>}
 */
export async function renderArrangementToWav(onProgress = () => {}) {
  if (!engine.ctx) throw new Error('audio engine not ready');
  const sampleRate = engine.ctx.sampleRate;
  const lengthSeconds = computeLengthSeconds();
  const frames = Math.max(1, Math.ceil(sampleRate * lengthSeconds));

  onProgress('Preparing offline context…');
  const offCtx = new OfflineAudioContext(2, frames, sampleRate);

  // Build offline channels + buses that mirror the live mixer.
  const tracks = store.data.tracks || [];
  const channels = tracks.map((_, i) =>
    buildOfflineChannel(offCtx, offCtx.destination, liveMixer.channels[i])
  );

  // Mirror every live bus so reverb/delay sends survive the bounce. Each
  // offline bus is a regular offline channel whose `.input` carries the
  // summed send signal through the bus's effect chain and on to master.
  const liveBuses = Array.isArray(liveMixer.buses) ? liveMixer.buses : [];
  const offlineBuses = liveBuses.map((liveBus) =>
    buildOfflineChannel(offCtx, offCtx.destination, liveBus, { isBus: true })
  );

  // Wire post-fader sends per track. Source of truth: live mixer state;
  // fall back to persisted `track.sends[]` if the live mixer hasn't
  // replayed them yet. We also collect the created offline gain nodes
  // into `sendGainsByTrack[t][busIdx]` so the automation pass can ramp
  // `sendA` / `sendB` breakpoints against them. If a send isn't wired
  // but the track has automation for it, we still create a gain node so
  // the breakpoints take effect during the bounce (matches the live
  // path once the user enables the send).
  const sendGainsByTrack = tracks.map(() => []);
  const hasSendAutomation = (t, b) => {
    const auto = tracks[t]?.automation;
    if (!auto) return false;
    const key = b === 0 ? 'sendA' : b === 1 ? 'sendB' : null;
    return !!(key && Array.isArray(auto[key]) && auto[key].length > 0);
  };

  for (let t = 0; t < tracks.length; t++) {
    const srcCh = channels[t];
    if (!srcCh) continue;
    const storedSends = Array.isArray(tracks[t]?.sends) ? tracks[t].sends : null;
    for (let b = 0; b < offlineBuses.length; b++) {
      const enabled = liveMixer.hasSend
        ? liveMixer.hasSend(t, b)
        : !!(storedSends && storedSends[b]);
      const needForAutomation = hasSendAutomation(t, b);
      if (!enabled && !needForAutomation) continue;
      const bus = offlineBuses[b];
      if (!bus) continue;
      // channel.sendTap -> sendGain -> bus.input, matching the live graph.
      const g = offCtx.createGain();
      const liveSendGain = liveMixer.getSendGain?.(t, b) ?? (enabled ? 1.0 : 0.0);
      g.gain.value = liveSendGain;
      try {
        srcCh.sendTap.connect(g);
        g.connect(bus.input);
        sendGainsByTrack[t][b] = g;
      } catch (err) {
        console.warn('[offline-render] send wiring failed', { t, b, err });
      }
    }
  }

  // Decode every sample + audio clip into the offline ctx.
  onProgress('Loading samples…');
  const sampleRefs = collectSampleRefs(store.data.arrangement || [], store.data.patterns || []);
  const audioRefs  = collectAudioRefs(store.data.arrangement || []);
  const sampleBuffers = new Map();
  const audioBuffers  = new Map();

  await Promise.all([
    ...sampleRefs.map(async (ref) => {
      try {
        const url = api.sampleUrl(store.projectName, ref);
        sampleBuffers.set(ref, await decodeAt(offCtx, url));
      } catch (err) {
        console.warn('[offline-render] sample decode failed', ref, err);
      }
    }),
    ...audioRefs.map(async (ref) => {
      try {
        const url = api.audioUrl(store.projectName, ref);
        audioBuffers.set(ref, await decodeAt(offCtx, url));
      } catch (err) {
        console.warn('[offline-render] audio decode failed', ref, err);
      }
    }),
  ]);

  // Lay every buffer-source down ahead of the render.
  onProgress('Scheduling clips…');
  scheduleArrangement(offCtx, channels, sampleBuffers, audioBuffers, sendGainsByTrack);

  onProgress('Rendering…');
  const rendered = await offCtx.startRendering();

  onProgress('Encoding WAV…');
  return audioBufferToWav(rendered);
}

// Expose the WAV helper too in case a caller needs it independently.
export { audioBufferToWav };
