// Workbench — Piano Roll pane (Phase 3a, velocity+mute extension P2 #7)
// Scoped to the currently selected clip in the arrangement. For MVP,
// every clip is a 16-step drum pattern:
//   pattern.steps     = [{ sampleRef, cells: bool[], velocities: int[],
//                          muted: bool[] }, ...]
//   pattern.stepCount = 16
//
// Interactions:
//   · click           → toggle cell on/off (unless drag started)
//   · drag in cell    → drag velocity 1..127 (after ~4px threshold)
//   · shift+click     → cycle velocity 64 → 100 → 127 (quick alternative)
//   · alt+click       → toggle mute (ghost note) on active cell
//   · right-click     → reset velocity to 100 (keep cell state)
//   · + Add row       → append empty row; label is a drop target for
//                       browser tree items (application/x-bassmash-sample)
import { store } from '../../state.js';

const STEP_COUNT = 16;
const VELOCITY_STEPS = [64, 100, 127];
const DRAG_PX = 140;         // full-scale 1..127 over this many px of drag
const CLICK_VS_DRAG_PX = 4;  // movement threshold to commit to "drag"

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .pr-root { display: flex; flex-direction: column; gap: var(--space-1); height: 100%; }
    .pr-header { display: flex; align-items: center; gap: var(--space-1); color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
    .pr-header__title { color: var(--text); font-weight: 600; letter-spacing: 0.3px; text-transform: none; font-size: 12px; }
    .pr-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 12px; text-align: center; padding: var(--space-3); }
    .pr-grid { display: flex; flex-direction: column; gap: 2px; }
    .pr-row, .pr-ticks { display: grid; grid-template-columns: 120px repeat(16, 1fr); gap: 2px; align-items: center; }
    .pr-ticks { color: var(--text-muted); font-family: 'JetBrains Mono', monospace; font-size: 10px; }
    .pr-ticks__num { text-align: center; padding: 2px 0; }
    .pr-ticks__num--strong { color: var(--text); font-weight: 600; }
    .pr-ticks__spacer { }
    .pr-row__label { padding: 4px 6px; font-size: 11px; color: var(--text); background: var(--surface-raised); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-height: 20px; display: flex; align-items: center; }
    .pr-row__label--placeholder { color: var(--text-muted); font-style: italic; }
    .pr-row__label--drop { outline: 2px dashed var(--accent); }
    .pr-cell { aspect-ratio: 1; border: 1px solid var(--border); background: var(--surface-raised); border-radius: 2px; padding: 0; cursor: pointer; position: relative; overflow: hidden; }
    .pr-cell[data-col="0"], .pr-cell[data-col="4"], .pr-cell[data-col="8"], .pr-cell[data-col="12"] { border-left-color: var(--text-muted); }
    .pr-cell--active { background: var(--accent); border-color: var(--accent); }
    .pr-add { align-self: flex-start; margin-top: var(--space-1); padding: 4px 10px; background: var(--surface-raised); border: 1px solid var(--border); border-radius: 3px; color: var(--text); font-size: 11px; cursor: pointer; }
    .pr-add:hover { background: var(--accent); color: var(--bg, #fff); border-color: var(--accent); }
  `;
  document.head.appendChild(style);
}

function displayNameFor(ref) {
  if (!ref) return '(drop a sample)';
  // strip scheme + extension, then prettify
  const bare = String(ref).replace(/^[a-z]+:\/\//i, '').replace(/\.[^.]+$/, '');
  const base = bare.split('/').pop() || bare;
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function resolveSelection(selection) {
  // clipSelected payload: { trackIndex, arrangementIdx } or null
  if (!selection || selection.arrangementIdx == null) return null;
  const clip = store.data.arrangement?.[selection.arrangementIdx];
  if (!clip || clip.patternIndex == null) return null;
  const pattern = store.data.patterns?.[clip.patternIndex];
  if (!pattern || !Array.isArray(pattern.steps)) return null;
  return { clip, pattern };
}

// Ensure cells/velocities/muted arrays are present and stepCount-sized.
function ensureRowArrays(row, stepCount) {
  if (!Array.isArray(row.cells)) row.cells = new Array(stepCount).fill(false);
  if (!Array.isArray(row.velocities)) row.velocities = new Array(stepCount).fill(100);
  if (!Array.isArray(row.muted)) row.muted = new Array(stepCount).fill(false);
  while (row.cells.length < stepCount) row.cells.push(false);
  while (row.velocities.length < stepCount) row.velocities.push(100);
  while (row.muted.length < stepCount) row.muted.push(false);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function initPianoRoll({ rootEl }) {
  if (!rootEl) return;
  injectStyles();

  let selection = null;

  function commit() {
    store.emit('change', { path: 'patterns' });
    if (typeof store._scheduleSave === 'function') store._scheduleSave();
  }

  function render() {
    const resolved = resolveSelection(selection);
    if (!resolved) {
      rootEl.innerHTML = `<div class="pianoroll-empty pr-empty">Select a MIDI clip in the arrangement to edit its pattern</div>`;
      return;
    }
    const { pattern } = resolved;
    const stepCount = pattern.stepCount || STEP_COUNT;

    const container = document.createElement('div');
    container.className = 'pr-root';

    const header = document.createElement('div');
    header.className = 'pr-header';
    header.innerHTML = `<span class="pr-header__title">${pattern.name || 'Pattern'}</span><span>· ${pattern.steps.length} rows · ${stepCount} steps</span>`;
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'pr-grid';

    // Step-number tick row
    const ticks = document.createElement('div');
    ticks.className = 'pr-ticks';
    const spacer = document.createElement('div');
    spacer.className = 'pr-ticks__spacer';
    ticks.appendChild(spacer);
    for (let j = 0; j < stepCount; j++) {
      const t = document.createElement('div');
      t.className = 'pr-ticks__num' + (j % 4 === 0 ? ' pr-ticks__num--strong' : '');
      t.textContent = String(j + 1);
      ticks.appendChild(t);
    }
    grid.appendChild(ticks);

    pattern.steps.forEach((row, i) => {
      ensureRowArrays(row, stepCount);

      const rowEl = document.createElement('div');
      rowEl.className = 'pr-row';

      const label = document.createElement('div');
      label.className = 'pr-row__label' + (row.sampleRef ? '' : ' pr-row__label--placeholder');
      label.textContent = displayNameFor(row.sampleRef);

      // Drop target for browser samples
      label.addEventListener('dragover', (e) => {
        if (!e.dataTransfer) return;
        if (Array.from(e.dataTransfer.types || []).includes('application/x-bassmash-sample')) {
          e.preventDefault();
          label.classList.add('pr-row__label--drop');
        }
      });
      label.addEventListener('dragleave', () => label.classList.remove('pr-row__label--drop'));
      label.addEventListener('drop', (e) => {
        label.classList.remove('pr-row__label--drop');
        const raw = e.dataTransfer?.getData('application/x-bassmash-sample');
        if (!raw) return;
        e.preventDefault();
        try {
          const payload = JSON.parse(raw);
          if (payload?.ref) {
            row.sampleRef = payload.ref;
            if (payload.name && !row.name) row.name = payload.name;
            commit();
            render();
          }
        } catch { /* ignore malformed payload */ }
      });

      rowEl.appendChild(label);

      for (let j = 0; j < stepCount; j++) {
        const cell = buildCell(row, i, j);
        rowEl.appendChild(cell);
      }

      grid.appendChild(rowEl);
    });

    container.appendChild(grid);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'pr-add';
    addBtn.textContent = '+ Add row';
    addBtn.addEventListener('click', () => {
      pattern.steps.push({
        sampleRef: null,
        cells: new Array(stepCount).fill(false),
        velocities: new Array(stepCount).fill(100),
        muted: new Array(stepCount).fill(false),
      });
      commit();
      render();
    });
    container.appendChild(addBtn);

    rootEl.replaceChildren(container);
  }

  // Build a single cell button with velocity-handle + mute rendering and
  // click/drag/alt/shift/contextmenu behaviour wired up.
  function buildCell(row, i, j) {
    const cell = document.createElement('button');
    cell.type = 'button';
    const active = !!row.cells[j];
    const muted = !!row.muted[j];
    cell.className =
      'pr-cell pr-vel-cell' +
      (active ? ' pr-cell--active pr-vel-cell--active' : '') +
      (active && muted ? ' pr-vel-cell--muted' : '');
    cell.dataset.row = String(i);
    cell.dataset.col = String(j);

    if (active) {
      const v = clamp(row.velocities[j] || 100, 1, 127);
      const fill = document.createElement('span');
      fill.className = 'pr-cell__fill pr-vel-fill';
      fill.style.height = `${(v / 127) * 100}%`;
      cell.appendChild(fill);

      // Hidden-by-default value readout shown during drag.
      const readout = document.createElement('span');
      readout.className = 'pr-vel-readout';
      readout.textContent = String(v);
      cell.appendChild(readout);
    }

    // Pointer-level state — click-vs-drag disambiguation.
    let pointerDown = false;
    let didDrag = false;
    let suppressNextClick = false;
    let startY = 0;
    let startVel = 0;
    let pointerId = 0;

    function endDrag() {
      pointerDown = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    function onMove(e) {
      if (!pointerDown) return;
      const dy = startY - e.clientY; // up = positive
      if (!didDrag && Math.abs(dy) < CLICK_VS_DRAG_PX) return;
      if (!didDrag) {
        didDrag = true;
        // First movement past threshold — if the cell wasn't active, turn
        // it on so the drag edits a real velocity (rare — drag normally
        // only starts on an active cell).
        if (!row.cells[j]) {
          row.cells[j] = true;
          if (!row.velocities[j]) row.velocities[j] = 100;
          startVel = row.velocities[j];
        }
        cell.classList.add('pr-vel-cell--dragging');
      }
      const delta = (dy / DRAG_PX) * 127;
      const nextVel = Math.round(clamp(startVel + delta, 1, 127));
      row.velocities[j] = nextVel;

      const fill = cell.querySelector('.pr-vel-fill');
      if (fill) fill.style.height = `${(nextVel / 127) * 100}%`;
      const readout = cell.querySelector('.pr-vel-readout');
      if (readout) readout.textContent = String(nextVel);
    }

    function onUp(e) {
      if (!pointerDown) return;
      const wasDrag = didDrag;
      endDrag();
      cell.classList.remove('pr-vel-cell--dragging');
      try { cell.releasePointerCapture?.(pointerId); } catch (_) { /* ignore */ }
      if (wasDrag) {
        suppressNextClick = true;   // swallow the synthesized click
        // Commit final velocity.
        commit();
        render();
      }
    }

    cell.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;                  // only left button
      if (e.altKey || e.shiftKey) return;          // modifiers go via click
      pointerDown = true;
      didDrag = false;
      startY = e.clientY;
      startVel = clamp(row.velocities[j] || 100, 1, 127);
      pointerId = e.pointerId;
      try { cell.setPointerCapture?.(pointerId); } catch (_) { /* ignore */ }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    cell.addEventListener('click', (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.altKey) {
        // Alt+click → toggle mute on an active cell. If cell is off, turn
        // it on AND mark muted so the user can paint ghost notes in one
        // motion.
        if (!row.cells[j]) {
          row.cells[j] = true;
          if (!row.velocities[j]) row.velocities[j] = 100;
          row.muted[j] = true;
        } else {
          row.muted[j] = !row.muted[j];
        }
        commit();
        render();
        return;
      }
      if (e.shiftKey) {
        const cur = row.velocities[j] || 100;
        const idx = VELOCITY_STEPS.indexOf(cur);
        const next = VELOCITY_STEPS[(idx + 1) % VELOCITY_STEPS.length];
        row.velocities[j] = next;
        row.cells[j] = true;
        commit();
        render();
        return;
      }
      // Plain click → toggle on/off. Clearing a cell also clears mute.
      row.cells[j] = !row.cells[j];
      if (row.cells[j]) {
        if (!row.velocities[j]) row.velocities[j] = 100;
      } else {
        row.muted[j] = false;
      }
      commit();
      render();
    });

    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Right-click no longer clears the cell — reset velocity to 100 and
      // drop any mute flag. Drag + plain-click cover the erase path.
      row.velocities[j] = 100;
      row.muted[j] = false;
      if (!row.cells[j]) row.cells[j] = true;
      commit();
      render();
    });

    return cell;
  }

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
