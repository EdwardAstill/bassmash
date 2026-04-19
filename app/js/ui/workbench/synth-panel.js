// Workbench — Synth pane. Editor for the selected synth track's oscillator
// waveform, filter (type + cutoff + Q), and ADSR envelope.
//
// Activates when the selected clip points at a synth pattern (follows the
// same selection resolution used by piano-roll.js). Writes live to
// `track.synthParams`; the engine reads those when the pattern triggers
// a note.
//
// Layout — three side-by-side blocks inside the pane:
//
//   OSC                FILTER                         AMP ENV
//   [∿][▲][╱][█]       [LP][HP][BP][N]                (interactive ADSR graph)
//                      Cutoff (knob)  Q (knob)         A  D  S  R readouts
//
// Styles live in app/css/style.css under `/* === Synth tab === */`.

import { store } from '../../state.js';
import { attachKnobDrag, knobAngle } from '../knob.js';

const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'];

// Single-period icon glyphs for each oscillator shape (viewBox 40x16, 2px
// padding). Each renders ONE cycle so the shape reads at small sizes.
const WAVE_PATHS = {
  sine:     'M2 8 Q11 1 20 8 T38 8',
  triangle: 'M2 8 L11 2 L20 8 L29 14 L38 8',
  sawtooth: 'M2 14 L20 2 L20 14 L38 2 L38 14',
  square:   'M2 14 L2 2 L20 2 L20 14 L38 14',
};

const CUTOFF_MIN = 20;       // Hz
const CUTOFF_MAX = 22050;
const CUTOFF_DEFAULT = 22050;
const Q_MIN = 0.1;
const Q_MAX = 20;
const Q_DEFAULT = 0.7;

const ATTACK_MAX_S  = 2.0;
const DECAY_MAX_S   = 2.0;
const RELEASE_MAX_S = 3.0;
const SUSTAIN_DEFAULT = 0.7;

const ADSR_W = 240;
const ADSR_H = 90;
const ADSR_PAD = 6;  // px around the edge so handles don't clip

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Log-scale cutoff for knob mapping (20..22050 Hz) — matches how humans
// hear frequency.
function cutoffToPct(hz) {
  const n = Math.log(clamp(hz, CUTOFF_MIN, CUTOFF_MAX) / CUTOFF_MIN);
  const d = Math.log(CUTOFF_MAX / CUTOFF_MIN);
  return n / d;
}
function pctToCutoff(pct) {
  return CUTOFF_MIN * Math.pow(CUTOFF_MAX / CUTOFF_MIN, clamp(pct, 0, 1));
}

function formatHz(hz) {
  if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz';
  return Math.round(hz) + ' Hz';
}
function formatSeconds(s) {
  if (s < 0.01) return (s * 1000).toFixed(0) + ' ms';
  if (s < 1)    return (s * 1000).toFixed(0) + ' ms';
  return s.toFixed(2) + ' s';
}

// Resolve the selected track as a synth track. Follows the same rules as
// piano-roll: selected clip → track. Returns null for non-synth tracks.
function resolveSynthTrack() {
  const sel = store.selectedClip;
  let trackIdx = null;
  if (sel && typeof sel.trackIndex === 'number') trackIdx = sel.trackIndex;
  else if (typeof store.selectedTrack === 'number') trackIdx = store.selectedTrack;
  if (trackIdx == null) return null;
  const track = store.data.tracks?.[trackIdx];
  if (!track || track.type !== 'synth') return null;
  return { track, trackIndex: trackIdx };
}

function commit() {
  store.emit('change', { path: 'tracks' });
  if (typeof store._scheduleSave === 'function') store._scheduleSave();
}

export function initSynthPanel({ rootEl }) {
  if (!rootEl) return;

  function render() {
    rootEl.innerHTML = '';
    const sel = resolveSynthTrack();
    if (!sel) {
      const empty = document.createElement('div');
      empty.className = 'smp-empty';
      empty.textContent = 'Select a synth track to edit its sound';
      rootEl.appendChild(empty);
      return;
    }
    const { track } = sel;
    const params = track.synthParams = track.synthParams || {};

    const panel = document.createElement('div');
    panel.className = 'synth-panel';
    rootEl.appendChild(panel);

    // Header
    const header = document.createElement('div');
    header.className = 'synth-panel__header';
    header.textContent = `Synth · ${track.name || 'Untitled'}`;
    panel.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'synth-panel__grid';
    panel.appendChild(grid);

    grid.appendChild(buildOscBlock(params));
    grid.appendChild(buildFilterBlock(params));
    grid.appendChild(buildAdsrBlock(params));
  }

  // ── OSC block ──────────────────────────────────────────────
  function buildOscBlock(params) {
    const block = document.createElement('div');
    block.className = 'synth-panel__block';

    const label = document.createElement('div');
    label.className = 'synth-panel__label';
    label.textContent = 'OSC';
    block.appendChild(label);

    const row = document.createElement('div');
    row.className = 'synth-panel__wave-row';
    const active = params.waveform || 'sine';
    for (const wave of WAVEFORMS) {
      const btn = document.createElement('button');
      btn.className = 'synth-wave-btn';
      btn.type = 'button';
      btn.dataset.active = String(wave === active);
      btn.title = wave;
      btn.innerHTML = `<svg viewBox="0 0 40 16" width="40" height="16">
        <path d="${WAVE_PATHS[wave]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
      btn.addEventListener('click', () => {
        params.waveform = wave;
        commit();
        render();
      });
      row.appendChild(btn);
    }
    block.appendChild(row);

    const caption = document.createElement('div');
    caption.className = 'synth-panel__caption';
    caption.textContent = active;
    block.appendChild(caption);

    return block;
  }

  // ── FILTER block ──────────────────────────────────────────
  function buildFilterBlock(params) {
    const block = document.createElement('div');
    block.className = 'synth-panel__block';

    const label = document.createElement('div');
    label.className = 'synth-panel__label';
    label.textContent = 'FILTER';
    block.appendChild(label);

    // Type picker
    const types = document.createElement('div');
    types.className = 'synth-panel__filter-types';
    const activeType = params.filterType || 'lowpass';
    for (const t of FILTER_TYPES) {
      const btn = document.createElement('button');
      btn.className = 'synth-filter-btn';
      btn.type = 'button';
      btn.dataset.active = String(t === activeType);
      btn.textContent = t === 'lowpass' ? 'LP' : t === 'highpass' ? 'HP' : t === 'bandpass' ? 'BP' : 'N';
      btn.title = t;
      btn.addEventListener('click', () => {
        params.filterType = t;
        commit();
        render();
      });
      types.appendChild(btn);
    }
    block.appendChild(types);

    // Cutoff + Q knobs
    const knobs = document.createElement('div');
    knobs.className = 'synth-panel__knobs';
    knobs.appendChild(buildKnob('Cutoff', () => {
      const v = params.filterFreq == null ? CUTOFF_DEFAULT : params.filterFreq;
      return { value: cutoffToPct(v), display: formatHz(v) };
    }, (pct) => {
      params.filterFreq = pctToCutoff(pct);
      return formatHz(params.filterFreq);
    }, () => {
      params.filterFreq = CUTOFF_DEFAULT;
      return formatHz(CUTOFF_DEFAULT);
    }));
    knobs.appendChild(buildKnob('Q', () => {
      const v = params.filterQ == null ? Q_DEFAULT : params.filterQ;
      return { value: (clamp(v, Q_MIN, Q_MAX) - Q_MIN) / (Q_MAX - Q_MIN), display: v.toFixed(2) };
    }, (pct) => {
      params.filterQ = Q_MIN + pct * (Q_MAX - Q_MIN);
      return params.filterQ.toFixed(2);
    }, () => {
      params.filterQ = Q_DEFAULT;
      return Q_DEFAULT.toFixed(2);
    }));
    block.appendChild(knobs);

    return block;
  }

  // Knob wired to 0..1 value. getSeed returns { value, display } at render
  // time; write(pct) applies + returns new display text; reset() sets defaults.
  function buildKnob(labelText, getSeed, write, reset) {
    const group = document.createElement('div');
    group.className = 'synth-knob-group';
    const knob = document.createElement('div');
    knob.className = 'synth-knob';
    const seed = getSeed();
    knob.style.transform = `rotate(${knobAngle(seed.value, 0, 1).toFixed(1)}deg)`;
    group.appendChild(knob);
    const lbl = document.createElement('div');
    lbl.className = 'synth-knob__label';
    lbl.textContent = labelText;
    group.appendChild(lbl);
    const val = document.createElement('div');
    val.className = 'synth-knob__val';
    val.textContent = seed.display;
    group.appendChild(val);

    attachKnobDrag(knob, {
      min: 0, max: 1, reset: 0,
      getValue: () => getSeed().value,
      setValue: (v) => {
        const display = write(v);
        knob.style.transform = `rotate(${knobAngle(v, 0, 1).toFixed(1)}deg)`;
        val.textContent = display;
      },
      render: () => {},  // setValue already paints
      onDragEnd: commit,
    });
    knob.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const display = reset();
      const seed2 = getSeed();
      knob.style.transform = `rotate(${knobAngle(seed2.value, 0, 1).toFixed(1)}deg)`;
      val.textContent = display;
      commit();
    });
    return group;
  }

  // ── AMP ENVELOPE block ─────────────────────────────────────
  // SVG graph with 4 drag handles at the A/D/S/R control points. Times
  // are normalised to each param's max so the graph always stretches to
  // the full width.
  function buildAdsrBlock(params) {
    const block = document.createElement('div');
    block.className = 'synth-panel__block synth-panel__block--adsr';

    const label = document.createElement('div');
    label.className = 'synth-panel__label';
    label.textContent = 'AMP ENV';
    block.appendChild(label);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'synth-adsr');
    svg.setAttribute('viewBox', `0 0 ${ADSR_W} ${ADSR_H}`);
    svg.setAttribute('width',  String(ADSR_W));
    svg.setAttribute('height', String(ADSR_H));
    block.appendChild(svg);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'synth-adsr__path');
    svg.appendChild(path);
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    fill.setAttribute('class', 'synth-adsr__fill');
    svg.appendChild(fill);

    function makeHandle(cls) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      g.setAttribute('class', `synth-adsr__handle ${cls}`);
      g.setAttribute('r', '5');
      svg.appendChild(g);
      return g;
    }
    const peakHandle    = makeHandle('synth-adsr__handle--a');
    const sustainHandle = makeHandle('synth-adsr__handle--d');
    const endHandle     = makeHandle('synth-adsr__handle--r');

    const readout = document.createElement('div');
    readout.className = 'synth-adsr__readout';
    block.appendChild(readout);

    function read() {
      return {
        attack:  params.attack  == null ? 0.01 : clamp(params.attack,  0, ATTACK_MAX_S),
        decay:   params.decay   == null ? 0.2  : clamp(params.decay,   0, DECAY_MAX_S),
        sustain: params.sustain == null ? SUSTAIN_DEFAULT : clamp(params.sustain, 0, 1),
        release: params.release == null ? 0.3  : clamp(params.release, 0, RELEASE_MAX_S),
      };
    }

    // Map times to pixels. Give each section roughly a quarter of the graph
    // width at max, plus a fixed sustain plateau.
    const usableW = ADSR_W - ADSR_PAD * 2;
    const usableH = ADSR_H - ADSR_PAD * 2;
    const aMaxPx = usableW * 0.22;
    const dMaxPx = usableW * 0.22;
    const rMaxPx = usableW * 0.28;
    const sustainPx = usableW - aMaxPx - dMaxPx - rMaxPx;

    function paint() {
      const { attack, decay, sustain, release } = read();
      const aX = ADSR_PAD + aMaxPx * (attack / ATTACK_MAX_S);
      const dX = aX + dMaxPx * (decay / DECAY_MAX_S);
      const sX = dX + sustainPx;
      const rX = sX + rMaxPx * (release / RELEASE_MAX_S);
      const baseY = ADSR_PAD + usableH;
      const peakY = ADSR_PAD;
      const sustainY = ADSR_PAD + usableH * (1 - sustain);

      const d = `M ${ADSR_PAD} ${baseY} L ${aX} ${peakY} L ${dX} ${sustainY} L ${sX} ${sustainY} L ${rX} ${baseY}`;
      path.setAttribute('d', d);
      fill.setAttribute('d', `${d} L ${ADSR_PAD} ${baseY} Z`);

      peakHandle.setAttribute('cx', String(aX));
      peakHandle.setAttribute('cy', String(peakY));
      sustainHandle.setAttribute('cx', String(dX));
      sustainHandle.setAttribute('cy', String(sustainY));
      endHandle.setAttribute('cx', String(rX));
      endHandle.setAttribute('cy', String(baseY));

      readout.textContent =
        `A ${formatSeconds(attack)} · D ${formatSeconds(decay)} · ` +
        `S ${sustain.toFixed(2)} · R ${formatSeconds(release)}`;
    }
    paint();

    // ── drag wiring ─────────────────────────────────────────
    function attachHandleDrag(handle, onMove, onUp) {
      let active = false;
      function move(e) {
        if (!active) return;
        const r = svg.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width)  * ADSR_W;
        const y = ((e.clientY - r.top)  / r.height) * ADSR_H;
        onMove(x, y);
        paint();
      }
      function up() {
        if (!active) return;
        active = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        onUp?.();
        commit();
      }
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        active = true;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
    }

    attachHandleDrag(peakHandle, (x) => {
      const rel = clamp((x - ADSR_PAD) / aMaxPx, 0, 1);
      params.attack = rel * ATTACK_MAX_S;
    });
    attachHandleDrag(sustainHandle, (x, y) => {
      const { attack } = read();
      const aX = ADSR_PAD + aMaxPx * (attack / ATTACK_MAX_S);
      const rel = clamp((x - aX) / dMaxPx, 0, 1);
      params.decay = rel * DECAY_MAX_S;
      params.sustain = clamp(1 - (y - ADSR_PAD) / usableH, 0, 1);
    });
    attachHandleDrag(endHandle, (x) => {
      const { attack, decay } = read();
      const aX = ADSR_PAD + aMaxPx * (attack / ATTACK_MAX_S);
      const dX = aX + dMaxPx * (decay / DECAY_MAX_S);
      const sX = dX + sustainPx;
      const rel = clamp((x - sX) / rMaxPx, 0, 1);
      params.release = rel * RELEASE_MAX_S;
    });

    return block;
  }

  // ── lifecycle ──────────────────────────────────────────────
  render();
  store.on('loaded', render);
  store.on('trackSelected', render);
  store.on('clipSelected', render);
  store.on('change', ({ path } = {}) => {
    if (path === 'tracks' || path === 'patterns') render();
  });
}
