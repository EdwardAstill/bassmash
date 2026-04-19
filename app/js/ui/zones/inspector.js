// Zone 4 · Inspector. Reacts to store.on('trackSelected') by rendering the
// selected track's channel state (name, gain, pan, width, FX chain, bus sends).
import { store } from '../../state.js';
import { BUS_COUNT } from '../../audio/mixer.js';
import { attachKnobDrag } from '../knob.js';

const UNITY_PCT = 70;
const FX_NAMES = ['EQ', 'Distortion', 'Delay', 'Reverb'];
const FX_KEYS  = ['eq', 'distortion', 'delay', 'reverb'];

// ------------ style injection ------------------------------------
let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-src', 'inspector-zone');
  el.textContent = `
    .zone--inspector .knob { cursor: ns-resize; user-select: none; touch-action: none; transition: transform 80ms linear; }
    .zone--inspector .knob::after { transform: translate(-50%, -100%) rotate(0deg); }
    .zone--inspector[data-selection="none"] .inspector__section,
    .zone--inspector[data-selection="none"] .fader-block,
    .zone--inspector[data-selection="none"] .knob-row,
    .zone--inspector[data-selection="none"] .fx-chain { opacity: 0.5; }
    .zone--inspector .fx-chain__status { cursor: pointer; }
    .zone--inspector .fx-chain__empty { color: var(--text-muted); font-style: italic; padding: var(--space-1) var(--space-3); }
    .zone--inspector .fx-chain__send-controls { display: flex; align-items: center; gap: var(--space-2); }
    .zone--inspector .fx-chain__send-gain {
      width: 20px; height: 20px; position: relative;
      border-radius: 50%;
      background: radial-gradient(circle at 50% 40%, var(--surface-raised), var(--surface-panel));
      border: 1px solid var(--border-strong);
      cursor: ns-resize; user-select: none; touch-action: none;
      transition: transform 80ms linear, opacity 120ms linear;
    }
    .zone--inspector .fx-chain__send-gain::after {
      content: ""; position: absolute;
      left: 50%; top: 50%;
      width: 2px; height: 40%;
      background: var(--accent);
      transform: translate(-50%, -100%) rotate(0deg);
      transform-origin: 50% 100%;
      border-radius: 1px;
    }
    .zone--inspector .fx-chain__send-gain[data-disabled="true"] {
      opacity: 0.35; cursor: not-allowed; pointer-events: none;
    }
  `;
  document.head.appendChild(el);
}

// ------------ gain <-> pct <-> dB --------------------------------
function pctToGain(pct) {
  if (pct <= 0) return 0;
  if (pct <= UNITY_PCT) return Math.pow(pct / UNITY_PCT, 2.5);
  const over = (pct - UNITY_PCT) / (100 - UNITY_PCT);
  return 1 + over * 0.5;
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
  if (!isFinite(db)) return '−∞ dB';
  const sign = db < 0 ? '−' : (db > 0 ? '+' : '+');
  return `${sign}${Math.abs(db).toFixed(1)} dB`;
}
function formatPan(p) {
  if (Math.abs(p) < 0.005) return 'C';
  const n = Math.round(Math.abs(p) * 100);
  return p < 0 ? `L ${n}` : `R ${n}`;
}
function titleCase(s) {
  if (!s || typeof s !== 'string') return '—';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

const SEND_LABELS = ['Send A', 'Send B'];
const SEND_GAIN_MIN = 0;
const SEND_GAIN_MAX = 1.5;
const SEND_GAIN_DEFAULT = 1;

function sendGainAngle(g) {
  const pct = Math.max(0, Math.min(1, g / SEND_GAIN_MAX));
  return -135 + pct * 270;
}
function readSendGain(track, busIdx) {
  const list = track && Array.isArray(track.sendGains) ? track.sendGains : null;
  const v = list ? Number(list[busIdx]) : NaN;
  if (!isFinite(v)) return SEND_GAIN_DEFAULT;
  return Math.max(SEND_GAIN_MIN, Math.min(SEND_GAIN_MAX, v));
}
function writeSendGain(track, busIdx, v) {
  if (!track) return;
  if (!Array.isArray(track.sendGains)) track.sendGains = [];
  track.sendGains[busIdx] = v;
}

// ------------ main export ----------------------------------------
export function initInspector(ctx) {
  const { mixer } = ctx;
  const root = document.querySelector('.zone--inspector');
  if (!root) return;

  injectStyle();

  // -------- query once ----------
  const titleEl = root.querySelector('.panel__title');
  const rowEls  = root.querySelectorAll('.inspector__section .inspector__row');
  const rows    = root.querySelectorAll('.inspector__section .inspector__row .inspector__v');
  const trackValEl  = rows[0] || null;
  const typeValEl   = rows[1] || null;
  const outputValEl = rows[2] || null;
  const inputValEl  = rows[3] || null;
  const inputRowEl  = rowEls[3] || null;

  // No audio-input recording yet — hide the Input row until that arrives.
  if (inputRowEl) inputRowEl.style.display = 'none';

  // Rename the Output row's key to "Routing" since it now surfaces active sends.
  const outputRowEl = rowEls[2] || null;
  const outputKeyEl = outputRowEl ? outputRowEl.querySelector('.inspector__k') : null;
  if (outputKeyEl) outputKeyEl.textContent = 'Routing';

  const volKnob  = root.querySelector('.fader-block .knob--lg');
  const volValEl = root.querySelector('.fader-block__value');

  const knobGroups = root.querySelectorAll('.knob-row .knob-group');
  const panKnob    = knobGroups[0]?.querySelector('.knob') || null;
  const panLabelEl = knobGroups[0]?.querySelector('.knob-group__label') || null;
  const widthKnob  = knobGroups[1]?.querySelector('.knob') || null;
  const widthLabelEl = knobGroups[1]?.querySelector('.knob-group__label') || null;

  const fxListEl = root.querySelector('.fx-chain');
  const fxAddItem = fxListEl ? fxListEl.querySelector('.fx-chain__item--add') : null;

  // -------- helpers ----------
  // "Master" plus any active sends, e.g. "Master + Bus A" or "Master + Bus A + Bus B".
  function formatRouting(trackIdx) {
    const labels = ['Bus A', 'Bus B'];
    const parts = ['Master'];
    if (trackIdx != null && mixer && typeof mixer.hasSend === 'function') {
      for (let b = 0; b < BUS_COUNT; b++) {
        if (mixer.hasSend(trackIdx, b)) parts.push(labels[b] || `Bus ${b}`);
      }
    }
    return parts.join(' + ');
  }

  function currentTrackIndex() {
    const idx = store.selectedTrack;
    if (idx == null || idx < 0) return null;
    const tracks = store.data.tracks || [];
    if (idx >= tracks.length) return null;
    return idx;
  }
  function currentChannel(idx) {
    if (idx == null) return null;
    return mixer.channels[idx] || null;
  }
  function gainAngle(gain) {
    // map gain 0..1.5 -> -135..+135
    const pct = clamp(gainToPct(gain), 0, 100);
    return -135 + (pct / 100) * 270;
  }
  function panAngle(p) {
    return clamp(p, -1, 1) * 135;
  }
  function widthAngle(w) {
    return -135 + clamp(w, 0, 100) / 100 * 270;
  }
  function setKnobRotation(knob, deg) {
    if (!knob) return;
    knob.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }

  // -------- render ----------
  function render() {
    const idx = currentTrackIndex();
    const track = idx != null ? store.data.tracks[idx] : null;
    const ch = currentChannel(idx);

    if (!track) {
      root.setAttribute('data-selection', 'none');
      if (titleEl) titleEl.textContent = 'Inspector · (none)';
      if (trackValEl)  trackValEl.textContent  = '—';
      if (typeValEl)   typeValEl.textContent   = '—';
      if (outputValEl) outputValEl.textContent = '—';
      if (inputValEl)  inputValEl.textContent  = '—';
      if (volValEl)    volValEl.textContent    = '−∞ dB';
      setKnobRotation(volKnob,  -135);
      setKnobRotation(panKnob,   0);
      setKnobRotation(widthKnob, 135);
      if (panLabelEl)   panLabelEl.textContent   = 'C';
      if (widthLabelEl) widthLabelEl.textContent = '100';
      renderFx(null);
      return;
    }

    root.setAttribute('data-selection', 'track');
    const name = track.name || `Track ${idx + 1}`;
    if (titleEl)    titleEl.textContent    = `Inspector · ${name}`;
    if (trackValEl) trackValEl.textContent = name;
    if (typeValEl)  typeValEl.textContent  = titleCase(track.type);
    if (outputValEl) outputValEl.textContent = formatRouting(idx);
    if (inputValEl)  inputValEl.textContent  = 'None';

    const gain = ch ? (ch._preMuteGain ?? 1) : 1;
    setKnobRotation(volKnob, gainAngle(gain));
    if (volValEl) volValEl.textContent = formatDb(gainToDb(gain));

    const panVal = ch && ch.pan && ch.pan.pan ? ch.pan.pan.value : 0;
    setKnobRotation(panKnob, panAngle(panVal));
    if (panLabelEl) panLabelEl.textContent = formatPan(panVal);

    if (track.width == null) track.width = 100;
    const w = clamp(Number(track.width) || 0, 0, 100);
    setKnobRotation(widthKnob, widthAngle(w));
    if (widthLabelEl) widthLabelEl.textContent = String(Math.round(w));

    renderFx(ch);
  }

  // -------- FX chain render ----------
  function renderFx(ch) {
    if (!fxListEl) return;
    // remove all .fx-chain__item except the add row
    Array.from(fxListEl.querySelectorAll('.fx-chain__item')).forEach((el) => {
      if (!el.classList.contains('fx-chain__item--add')) el.remove();
    });

    if (!ch) {
      const li = document.createElement('li');
      li.className = 'fx-chain__empty';
      li.textContent = '(select a track)';
      if (fxAddItem) fxListEl.insertBefore(li, fxAddItem);
      else fxListEl.appendChild(li);
      return;
    }
    const chain = ch.effects || null;
    for (let i = 0; i < FX_NAMES.length; i++) {
      const name = FX_NAMES[i];
      const key = FX_KEYS[i];
      const fx  = chain ? chain[key] : null;
      const enabled = !!(fx && fx.enabled);
      const li = document.createElement('li');
      li.className = 'fx-chain__item';
      li.dataset.fxKey = key;
      const nameEl = document.createElement('span');
      nameEl.textContent = name;
      const statusEl = document.createElement('span');
      statusEl.className = `fx-chain__status fx-chain__status--${enabled ? 'on' : 'off'}`;
      statusEl.textContent = enabled ? 'ON' : 'OFF';
      statusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFx(ch, key, statusEl);
      });
      li.appendChild(nameEl);
      li.appendChild(statusEl);
      if (fxAddItem) fxListEl.insertBefore(li, fxAddItem);
      else fxListEl.appendChild(li);
    }

    // Bus sends, shown as two extra rows under the FX list. The mixer
    // zone is the source of truth for send state; we just mirror it.
    const trackIdx = currentTrackIndex();
    if (trackIdx != null) {
      const track = store.data.tracks[trackIdx] || null;
      for (let b = 0; b < BUS_COUNT; b++) {
        const enabled = mixer.hasSend ? mixer.hasSend(trackIdx, b) : false;
        const li = document.createElement('li');
        li.className = 'fx-chain__item';
        li.dataset.sendBus = String(b);

        const nameEl = document.createElement('span');
        nameEl.textContent = SEND_LABELS[b] || `Send ${b}`;

        const controlsEl = document.createElement('span');
        controlsEl.className = 'fx-chain__send-controls';

        // Send gain knob (small, 0..1.5, default 1). Only responsive when
        // the send is ON — disabled visually + guarded otherwise.
        const knob = document.createElement('span');
        knob.className = 'fx-chain__send-gain';
        knob.dataset.sendBus = String(b);
        knob.dataset.disabled = enabled ? 'false' : 'true';
        const initGain = readSendGain(track, b);
        knob.style.transform = `rotate(${sendGainAngle(initGain).toFixed(1)}deg)`;
        knob.title = `Send ${SEND_LABELS[b] || b} gain: ${initGain.toFixed(2)}`;

        const statusEl = document.createElement('span');
        statusEl.className = `fx-chain__status fx-chain__status--${enabled ? 'on' : 'off'}`;
        statusEl.textContent = enabled ? 'ON' : 'OFF';
        statusEl.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleSend(trackIdx, b, statusEl, knob);
        });

        controlsEl.appendChild(knob);
        controlsEl.appendChild(statusEl);

        li.appendChild(nameEl);
        li.appendChild(controlsEl);

        attachSendGainDrag(knob, trackIdx, b);

        if (fxAddItem) fxListEl.insertBefore(li, fxAddItem);
        else fxListEl.appendChild(li);
      }
    }
  }

  function attachSendGainDrag(knob, trackIdx, busIdx) {
    attachDrag(knob, {
      min: SEND_GAIN_MIN, max: SEND_GAIN_MAX, reset: SEND_GAIN_DEFAULT,
      getValue: () => {
        const track = store.data.tracks && store.data.tracks[trackIdx];
        // Prefer live node value if send is connected, else fall back to stored.
        if (mixer.hasSend && mixer.hasSend(trackIdx, busIdx) &&
            typeof mixer.getSendGain === 'function') {
          const live = mixer.getSendGain(trackIdx, busIdx);
          if (isFinite(live)) return live;
        }
        return readSendGain(track, busIdx);
      },
      setValue: (v) => {
        // Guard: ignore drag while disabled.
        if (knob.dataset.disabled === 'true') return;
        const track = store.data.tracks && store.data.tracks[trackIdx];
        if (!track) return;
        writeSendGain(track, busIdx, v);
        if (typeof mixer.setSendGain === 'function') {
          mixer.setSendGain(trackIdx, busIdx, v);
        }
        store._scheduleSave?.();
      },
      render: (v) => {
        knob.style.transform = `rotate(${sendGainAngle(v).toFixed(1)}deg)`;
        knob.title = `Send gain: ${v.toFixed(2)}`;
      },
    });
  }

  function toggleSend(trackIdx, busIdx, statusEl, knobEl) {
    if (!mixer || typeof mixer.connectSend !== 'function') return;
    const nowOn = !mixer.hasSend(trackIdx, busIdx);
    // Use the persisted per-send gain when re-enabling so the send
    // comes back at the user's last chosen amount, not a hard-coded 1.0.
    const track = store.data.tracks && store.data.tracks[trackIdx];
    if (nowOn) {
      const gain = readSendGain(track, busIdx);
      mixer.connectSend(trackIdx, busIdx, gain);
    } else {
      mixer.disconnectSend(trackIdx, busIdx);
    }
    // Persist to the track's serialized send list.
    if (track) {
      const list = [];
      for (let b = 0; b < BUS_COUNT; b++) list.push(mixer.hasSend(trackIdx, b));
      track.sends = list;
      store._scheduleSave?.();
    }
    statusEl.textContent = nowOn ? 'ON' : 'OFF';
    statusEl.classList.toggle('fx-chain__status--on',  nowOn);
    statusEl.classList.toggle('fx-chain__status--off', !nowOn);
    if (knobEl) knobEl.dataset.disabled = nowOn ? 'false' : 'true';
    // Let the mixer zone repaint its send slot badge.
    store.emit('sendChanged', { trackIdx, busIdx, enabled: nowOn });
  }

  function toggleFx(ch, key, statusEl) {
    const chain = ch && ch.effects;
    const fx = chain ? chain[key] : null;
    if (!fx) { console.info('[inspector] fx toggle (no target)', key); return; }
    const newEnabled = !fx.enabled;
    fx.enabled = newEnabled;
    // wet/dry: flip the matching mix setter when available
    try {
      if (key === 'distortion' && typeof chain.setDistortionMix === 'function') {
        chain.setDistortionMix(newEnabled ? 1 : 0);
      } else if (key === 'delay' && typeof chain.setDelayMix === 'function') {
        chain.setDelayMix(newEnabled ? 0.35 : 0);
      } else if (key === 'reverb' && typeof chain.setReverbMix === 'function') {
        chain.setReverbMix(newEnabled ? 0.3 : 0);
      } else if (key === 'eq' && typeof chain.setEqEnabled === 'function') {
        chain.setEqEnabled(newEnabled);
      }
    } catch (e) {
      console.warn('[inspector] fx mix setter failed', key, e);
    }
    statusEl.textContent = newEnabled ? 'ON' : 'OFF';
    statusEl.classList.toggle('fx-chain__status--on',  newEnabled);
    statusEl.classList.toggle('fx-chain__status--off', !newEnabled);
  }

  const attachDrag = attachKnobDrag;

  // During playback we mirror the live channel.gain.gain.value onto the
  // inspector volume knob. While the user is actively dragging the knob
  // we suppress that read so their drag value stands (see mixerLiveGain
  // listener below).
  let _volKnobDragging = false;

  // -------- interactive drags ----------
  attachDrag(volKnob, {
    min: 0, max: 1.5, reset: 1,
    getValue: () => {
      const idx = currentTrackIndex();
      const ch = currentChannel(idx);
      // When playing, drag-start should seed from the *live* ramping
      // value so the knob doesn't jump back to its pre-automation pos.
      if (ch && ch.gain && store.playing) {
        return ch.muted ? (ch._preMuteGain ?? 0) : ch.gain.gain.value;
      }
      return ch ? (ch._preMuteGain ?? 1) : 1;
    },
    setValue: (v) => {
      const idx = currentTrackIndex();
      const ch = currentChannel(idx);
      if (ch && typeof ch.setVolume === 'function') ch.setVolume(v);
    },
    render: (v) => {
      setKnobRotation(volKnob, gainAngle(v));
      if (volValEl) volValEl.textContent = formatDb(gainToDb(v));
    },
    onDragStart: () => {
      _volKnobDragging = true;
      // Cancel any scheduled ramp so user's drag isn't undone on the
      // next scheduler setValueAtTime call within this 16th-note window.
      const idx = currentTrackIndex();
      if (idx != null && typeof mixer.cancelAutomationAfter === 'function') {
        const now = mixer.channels[idx]?.gain?.context?.currentTime;
        if (isFinite(now)) mixer.cancelAutomationAfter(idx, now);
      }
    },
    onDragEnd: () => { _volKnobDragging = false; },
  });

  attachDrag(panKnob, {
    min: -1, max: 1, reset: 0,
    getValue: () => {
      const idx = currentTrackIndex();
      const ch = currentChannel(idx);
      return ch && ch.pan && ch.pan.pan ? ch.pan.pan.value : 0;
    },
    setValue: (v) => {
      const idx = currentTrackIndex();
      const ch = currentChannel(idx);
      if (ch && typeof ch.setPan === 'function') ch.setPan(v);
    },
    render: (v) => {
      setKnobRotation(panKnob, panAngle(v));
      if (panLabelEl) panLabelEl.textContent = formatPan(v);
    },
  });

  attachDrag(widthKnob, {
    min: 0, max: 100, reset: 100,
    getValue: () => {
      const idx = currentTrackIndex();
      const t = idx != null ? store.data.tracks[idx] : null;
      return t && t.width != null ? Number(t.width) : 100;
    },
    setValue: (v) => {
      const idx = currentTrackIndex();
      const t = idx != null ? store.data.tracks[idx] : null;
      if (!t) return;
      t.width = v;
      store._scheduleSave();
    },
    render: (v) => {
      setKnobRotation(widthKnob, widthAngle(v));
      if (widthLabelEl) widthLabelEl.textContent = String(Math.round(v));
    },
  });

  // -------- listeners ----------
  store.on('trackSelected', render);
  store.on('engineReady',   render);
  store.on('loaded',        render);
  store.on('change', ({ path }) => {
    if (path === 'tracks' || (typeof path === 'string' && path.startsWith('tracks'))) {
      render();
    }
  });
  // Re-render if the mixer zone toggled a send on the currently-selected track.
  store.on('sendChanged', ({ trackIdx } = {}) => {
    if (trackIdx === currentTrackIndex()) render();
  });

  // Live-fader read during playback. The mixer zone's meter loop emits
  // mixerLiveGain once per frame for the selected track with the current
  // AudioParam value. We repaint the volume knob + dB readout unless
  // the user is actively dragging the knob (their drag wins while pressed).
  store.on('mixerLiveGain', ({ trackIdx, value } = {}) => {
    if (_volKnobDragging) return;
    if (trackIdx !== currentTrackIndex()) return;
    if (!isFinite(value)) return;
    setKnobRotation(volKnob, gainAngle(value));
    if (volValEl) volValEl.textContent = formatDb(gainToDb(value));
  });

  // When playback stops, do one final render so the knob settles at the
  // restored baseline value (the scheduler pins gain back to baseline
  // on transport:stop).
  store.on('transport', (state) => {
    if (state === 'stop') {
      // Defer so the scheduler's stop-handler restores the baseline first.
      setTimeout(render, 0);
    }
  });

  // initial paint
  render();
}
