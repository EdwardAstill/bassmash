// Workbench — Sampler pane (drum-rack editor, P2 #6).
//
// Shows one pad per row in the selected drum pattern's `pattern.steps[]`.
// Per pad:
//   · sample name label (click = open picker of kit + project samples)
//   · drop target for `application/x-bassmash-sample` from the browser
//   · gain knob (0..2, default 1) — writes row.gain
//   · pitch knob (-12..+12 semitones, default 0) — writes row.pitch
//   · loop toggle (one-shot vs loop) — writes row.loop
//   · audition button — plays row.sampleRef with current gain/pitch/loop
//
// Selection resolution follows piano-roll.js: the selected arrangement clip
// → its referenced pattern. If the pattern has no `steps[]`, show empty state.
import { store } from '../../state.js';
import { api } from '../../api.js';
import { sampler } from '../../audio/sampler.js';
import { engine } from '../../audio/engine.js';
import { attachKnobDrag, knobAngle } from '../knob.js';

const GAIN_MIN = 0;
const GAIN_MAX = 2;
const GAIN_DEFAULT = 1;
const PITCH_MIN = -12;
const PITCH_MAX = 12;
const PITCH_DEFAULT = 0;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function displayNameFor(ref) {
  if (!ref) return '(empty)';
  const bare = String(ref).replace(/^[a-z]+:\/\//i, '');
  return bare.split('/').pop() || bare;
}

function prettyNameFor(ref) {
  if (!ref) return '(drop sample)';
  const base = displayNameFor(ref).replace(/\.[^.]+$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function semitonesToRate(semi) {
  return Math.pow(2, (Number(semi) || 0) / 12);
}

function formatSemi(v) {
  const n = Math.round(Number(v) || 0);
  if (n === 0) return '0';
  return (n > 0 ? '+' : '') + String(n);
}

function formatGain(v) {
  const g = Number(v);
  if (!isFinite(g)) return '1.00';
  return g.toFixed(2);
}

function resolveSelection(selection) {
  if (!selection || selection.arrangementIdx == null) return null;
  const clip = store.data.arrangement?.[selection.arrangementIdx];
  if (!clip || clip.patternIndex == null) return null;
  const pattern = store.data.patterns?.[clip.patternIndex];
  if (!pattern || !Array.isArray(pattern.steps)) return null;
  return { clip, pattern, patternIndex: clip.patternIndex };
}

// Styles live in app/css/style.css under `/* === Sampler tab === */`.

// ── picker popover ───────────────────────────────────────────────
let _openPicker = null;
function closePicker() {
  if (_openPicker) {
    _openPicker.el.remove();
    document.removeEventListener('pointerdown', _openPicker.dismiss, true);
    _openPicker = null;
  }
}

function openPicker(anchor, { kitFiles, audioFiles, currentRef, onPick }) {
  closePicker();
  const pop = document.createElement('div');
  pop.className = 'smp-picker';

  function addGroup(title) {
    const h = document.createElement('div');
    h.className = 'smp-picker__group';
    h.textContent = title;
    pop.appendChild(h);
  }
  function addItem(ref, label) {
    const it = document.createElement('div');
    it.className = 'smp-picker__item' + (ref === currentRef ? ' smp-picker__item--active' : '');
    it.textContent = label;
    it.title = ref;
    it.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(ref);
      closePicker();
    });
    pop.appendChild(it);
  }

  addGroup('Kit');
  if (!kitFiles || kitFiles.length === 0) {
    const e = document.createElement('div');
    e.className = 'smp-picker__empty';
    e.textContent = '(loading…)';
    pop.appendChild(e);
  } else {
    for (const f of kitFiles) addItem(`kit://${f}`, f);
  }

  addGroup('Project Samples');
  if (!audioFiles || audioFiles.length === 0) {
    const e = document.createElement('div');
    e.className = 'smp-picker__empty';
    e.textContent = '(none)';
    pop.appendChild(e);
  } else {
    for (const f of audioFiles) addItem(f, f);
  }

  document.body.appendChild(pop);
  // position below the anchor, clamp into viewport
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 20, rect.bottom + 4);
  const left = Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left);
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.max(8, left)}px`;

  const dismiss = (e) => {
    if (!pop.contains(e.target)) closePicker();
  };
  // register next tick so the click that opened it doesn't close it
  setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
  _openPicker = { el: pop, dismiss };
}

// ── main export ──────────────────────────────────────────────────
export function initSamplerPanel({ rootEl }) {
  if (!rootEl) return;

  let selection = null;
  let kitFiles = [];
  let audioFiles = [];

  // background fetch of sample lists for the picker
  api.listKit()
    .then((list) => { kitFiles = Array.isArray(list) ? list : []; })
    .catch((err) => console.warn('[sampler-panel] listKit failed', err));
  function refreshAudioList() {
    if (!store.projectName) return;
    api.listAudio(store.projectName).then((list) => {
      audioFiles = Array.isArray(list) ? list : [];
    }).catch((err) => {
      audioFiles = [];
      console.warn('[sampler-panel] listAudio failed', err);
    });
  }
  refreshAudioList();
  store.on('loaded', refreshAudioList);
  store.on('audioFilesChanged', refreshAudioList);

  function commit() {
    store.emit('change', { path: 'patterns' });
    if (typeof store._scheduleSave === 'function') store._scheduleSave();
  }

  // audition — route through master bus directly (matches browser.js pattern)
  function audition(row) {
    if (!row || !row.sampleRef) return;
    if (!engine.ctx || !engine.masterGain) return;
    sampler.load(row.sampleRef).then(() => {
      // Wrap in a GainNode so we can honour row.gain without touching sampler.
      const gainNode = engine.ctx.createGain();
      gainNode.gain.value = clamp(row.gain ?? GAIN_DEFAULT, GAIN_MIN, GAIN_MAX);
      gainNode.connect(engine.masterGain);
      sampler.play(row.sampleRef, engine.ctx.currentTime, gainNode, {
        playbackRate: semitonesToRate(row.pitch ?? PITCH_DEFAULT),
        loop: !!row.loop,
      });
    }).catch((e) => console.warn('[sampler-panel] audition failed', row.sampleRef, e));
  }

  function attachKnobWithCommit(el, opts) {
    attachKnobDrag(el, { ...opts, onDragEnd: commit, stopPropagation: true });
  }

  function render() {
    closePicker();
    const resolved = resolveSelection(selection);
    if (!resolved) {
      rootEl.innerHTML = `<div class="smp-empty">Select a drum clip to edit pads</div>`;
      return;
    }
    const { pattern } = resolved;
    if (!Array.isArray(pattern.steps) || pattern.steps.length === 0) {
      rootEl.innerHTML = `<div class="smp-empty">This pattern has no rows yet — add one from the Piano Roll tab</div>`;
      return;
    }

    const container = document.createElement('div');
    container.className = 'smp-root';

    const header = document.createElement('div');
    header.className = 'smp-header';
    header.innerHTML = `<span class="smp-header__title">${pattern.name || 'Pattern'}</span><span>· ${pattern.steps.length} pads</span>`;
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'smp-grid';

    pattern.steps.forEach((row, i) => {
      // defaults (don't mutate unless drag/edit)
      const gainVal  = row.gain  == null ? GAIN_DEFAULT  : Number(row.gain);
      const pitchVal = row.pitch == null ? PITCH_DEFAULT : Number(row.pitch);
      const loopOn   = !!row.loop;

      const pad = document.createElement('div');
      pad.className = 'smp-pad';
      pad.dataset.row = String(i);

      // Drop target — same payload the browser zone emits.
      pad.addEventListener('dragover', (e) => {
        if (!e.dataTransfer) return;
        const types = Array.from(e.dataTransfer.types || []);
        if (!types.includes('application/x-bassmash-sample')) return;
        e.preventDefault();
        pad.dataset.drop = 'over';
      });
      pad.addEventListener('dragleave', () => { delete pad.dataset.drop; });
      pad.addEventListener('drop', (e) => {
        delete pad.dataset.drop;
        const raw = e.dataTransfer?.getData('application/x-bassmash-sample');
        if (!raw) return;
        e.preventDefault();
        try {
          const payload = JSON.parse(raw);
          if (payload?.ref) {
            row.sampleRef = payload.ref;
            commit();
            render();
          }
        } catch { /* malformed */ }
      });

      // Sample name / picker
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'smp-pad__name' + (row.sampleRef ? '' : ' smp-pad__name--empty');
      nameBtn.textContent = prettyNameFor(row.sampleRef);
      nameBtn.title = row.sampleRef || 'Click to pick a sample';
      nameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPicker(nameBtn, {
          kitFiles,
          audioFiles,
          currentRef: row.sampleRef,
          onPick: (ref) => {
            row.sampleRef = ref;
            commit();
            render();
          },
        });
      });
      pad.appendChild(nameBtn);

      // Knobs
      const knobs = document.createElement('div');
      knobs.className = 'smp-pad__knobs';

      // Gain knob
      const gGroup = document.createElement('div');
      gGroup.className = 'smp-knob-group';
      const gKnob = document.createElement('div');
      gKnob.className = 'smp-knob';
      gKnob.style.transform = `rotate(${knobAngle(gainVal, GAIN_MIN, GAIN_MAX).toFixed(1)}deg)`;
      const gLabel = document.createElement('div');
      gLabel.className = 'smp-knob-label';
      gLabel.textContent = 'GAIN';
      const gVal = document.createElement('div');
      gVal.className = 'smp-knob-val';
      gVal.textContent = formatGain(gainVal);
      gGroup.appendChild(gKnob);
      gGroup.appendChild(gLabel);
      gGroup.appendChild(gVal);
      knobs.appendChild(gGroup);
      attachKnobWithCommit(gKnob, {
        min: GAIN_MIN, max: GAIN_MAX, reset: GAIN_DEFAULT,
        getValue: () => row.gain == null ? GAIN_DEFAULT : Number(row.gain),
        setValue: (v) => { row.gain = v; },
        render: (v) => {
          gKnob.style.transform = `rotate(${knobAngle(v, GAIN_MIN, GAIN_MAX).toFixed(1)}deg)`;
          gVal.textContent = formatGain(v);
        },
      });

      // Pitch knob
      const pGroup = document.createElement('div');
      pGroup.className = 'smp-knob-group';
      const pKnob = document.createElement('div');
      pKnob.className = 'smp-knob';
      pKnob.style.transform = `rotate(${knobAngle(pitchVal, PITCH_MIN, PITCH_MAX).toFixed(1)}deg)`;
      const pLabel = document.createElement('div');
      pLabel.className = 'smp-knob-label';
      pLabel.textContent = 'PITCH';
      const pVal = document.createElement('div');
      pVal.className = 'smp-knob-val';
      pVal.textContent = formatSemi(pitchVal);
      pGroup.appendChild(pKnob);
      pGroup.appendChild(pLabel);
      pGroup.appendChild(pVal);
      knobs.appendChild(pGroup);
      attachKnobWithCommit(pKnob, {
        min: PITCH_MIN, max: PITCH_MAX, reset: PITCH_DEFAULT,
        getValue: () => row.pitch == null ? PITCH_DEFAULT : Number(row.pitch),
        setValue: (v) => { row.pitch = Math.round(v); },
        render: (v) => {
          const snapped = Math.round(v);
          pKnob.style.transform = `rotate(${knobAngle(snapped, PITCH_MIN, PITCH_MAX).toFixed(1)}deg)`;
          pVal.textContent = formatSemi(snapped);
        },
      });

      pad.appendChild(knobs);

      // Loop + audition row
      const btnRow = document.createElement('div');
      btnRow.className = 'smp-pad__row';

      const loopBtn = document.createElement('button');
      loopBtn.type = 'button';
      loopBtn.className = 'smp-toggle';
      loopBtn.dataset.on = String(loopOn);
      loopBtn.textContent = 'Loop';
      loopBtn.title = 'Toggle one-shot / loop';
      loopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        row.loop = !row.loop;
        loopBtn.dataset.on = String(!!row.loop);
        commit();
      });
      btnRow.appendChild(loopBtn);

      const auditionBtn = document.createElement('button');
      auditionBtn.type = 'button';
      auditionBtn.className = 'smp-audition';
      auditionBtn.textContent = '▶ Play';
      auditionBtn.title = 'Audition pad';
      auditionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audition(row);
      });
      btnRow.appendChild(auditionBtn);

      pad.appendChild(btnRow);

      // Also allow clicking the pad itself (outside buttons) to audition.
      pad.addEventListener('click', (e) => {
        if (e.target === pad) audition(row);
      });

      grid.appendChild(pad);
    });

    container.appendChild(grid);
    rootEl.replaceChildren(container);
  }

  // ── event wiring ────────────────────────────────────────────────
  store.on('clipSelected', (payload) => {
    selection = payload;
    render();
  });
  store.on('change', (evt) => {
    if (!evt) return;
    if (evt.path === 'patterns' || evt.path === 'arrangement') render();
  });
  store.on('loaded', () => render());

  render();
}
