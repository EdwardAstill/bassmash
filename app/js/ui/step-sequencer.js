import { store } from '../state.js';
import { setupCanvas } from './utils.js';

const CELL_SIZE = 32, HEADER_WIDTH = 90, HEADER_HEIGHT = 28;

export function initStepSequencer(container) {
  container.innerHTML = `
    <div class="editor-tabs">
      <button class="tab" data-tab="piano-roll">Piano Roll</button>
      <button class="tab active" data-tab="step-seq">Step Sequencer</button>
    </div>
    <div class="editor-content"><canvas id="step-seq-canvas"></canvas></div>
  `;
  const canvas = document.getElementById('step-seq-canvas');
  canvas.style.width = '100%'; canvas.style.height = '100%';

  function getPattern() {
    if (store.selectedPattern == null) return null;
    return store.data.patterns[store.selectedPattern] || null;
  }
  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    if (width === 0 || height === 0) return;
    const pattern = getPattern();
    ctx.fillStyle = '#141c2e'; ctx.fillRect(0, 0, width, height);
    if (!pattern || !pattern.steps) {
      ctx.fillStyle = '#4b5672'; ctx.font = '600 13px "DM Sans", system-ui, sans-serif';
      ctx.fillText('No pattern selected \u2014 click "+ Drums" to add a track', 20, 44);
      return;
    }
    const numSteps = pattern.stepCount || 16;
    const rows = pattern.steps;
    // Header row
    ctx.fillStyle = '#111827'; ctx.fillRect(HEADER_WIDTH, 0, width, HEADER_HEIGHT);
    ctx.fillStyle = '#4b5672'; ctx.font = '600 10px "JetBrains Mono", monospace';
    for (let s = 0; s < numSteps; s++) {
      ctx.fillStyle = s % 4 === 0 ? '#8b97b5' : '#4b5672';
      ctx.fillText(`${s + 1}`, HEADER_WIDTH + s * CELL_SIZE + (CELL_SIZE - ctx.measureText(`${s + 1}`).width) / 2, 18);
    }
    for (let r = 0; r < rows.length; r++) {
      const y = HEADER_HEIGHT + r * CELL_SIZE;
      const row = rows[r];
      // Row label
      ctx.fillStyle = '#111827'; ctx.fillRect(0, y, HEADER_WIDTH, CELL_SIZE);
      ctx.fillStyle = '#8b97b5'; ctx.font = '600 11px "DM Sans", system-ui, sans-serif'; ctx.fillText(row.name || `Row ${r + 1}`, 8, y + 20);
      // Cells
      for (let s = 0; s < numSteps; s++) {
        const x = HEADER_WIDTH + s * CELL_SIZE;
        const isOn = row.cells[s];
        const isGroupStart = s % 4 === 0;
        // Cell background
        ctx.fillStyle = isOn ? '#f0425d' : (isGroupStart ? '#0a0e1a' : '#111827');
        const r2 = 3;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, r2);
        ctx.fill();
        // Velocity overlay
        if (isOn && row.velocities && row.velocities[s]) {
          ctx.globalAlpha = 0.3 + (row.velocities[s] / 127) * 0.4;
          ctx.fillStyle = '#ff8fa3';
          ctx.beginPath(); ctx.roundRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, r2); ctx.fill();
          ctx.globalAlpha = 1;
        }
        // Subtle border
        ctx.strokeStyle = isOn ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.roundRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, r2); ctx.stroke();
      }
      // Row separator
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + CELL_SIZE); ctx.lineTo(width, y + CELL_SIZE); ctx.stroke();
    }
    // Beat group separators
    for (let s = 4; s < numSteps; s += 4) {
      const x = HEADER_WIDTH + s * CELL_SIZE;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, HEADER_HEIGHT); ctx.lineTo(x, HEADER_HEIGHT + rows.length * CELL_SIZE); ctx.stroke();
    }
    // Playhead
    if (store.playing) {
      const step = store.currentBeat % numSteps;
      ctx.fillStyle = 'rgba(240, 66, 93, 0.15)';
      ctx.fillRect(HEADER_WIDTH + step * CELL_SIZE, HEADER_HEIGHT, CELL_SIZE, rows.length * CELL_SIZE);
      // Playhead line
      ctx.strokeStyle = '#f0425d'; ctx.lineWidth = 2;
      const px = HEADER_WIDTH + step * CELL_SIZE;
      ctx.beginPath(); ctx.moveTo(px, HEADER_HEIGHT); ctx.lineTo(px, HEADER_HEIGHT + rows.length * CELL_SIZE); ctx.stroke();
    }
  }
  let dragging = false, paintValue = null, visited = new Set();
  function cellAt(e) {
    const pattern = getPattern(); if (!pattern || !pattern.steps) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (mx < HEADER_WIDTH || my < HEADER_HEIGHT) return null;
    const step = Math.floor((mx - HEADER_WIDTH) / CELL_SIZE);
    const row = Math.floor((my - HEADER_HEIGHT) / CELL_SIZE);
    if (row < 0 || row >= pattern.steps.length) return null;
    if (step < 0 || step >= (pattern.stepCount || 16)) return null;
    return { pattern, row, step };
  }
  function paintCell(hit) {
    const key = `${hit.row},${hit.step}`;
    if (visited.has(key)) return;
    visited.add(key);
    const rowData = hit.pattern.steps[hit.row];
    rowData.cells[hit.step] = paintValue;
    if (!rowData.velocities) rowData.velocities = new Array(hit.pattern.stepCount || 16).fill(100);
    render();
  }
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const hit = cellAt(e); if (!hit) return;
    dragging = true;
    visited = new Set();
    paintValue = !hit.pattern.steps[hit.row].cells[hit.step];
    paintCell(hit);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const hit = cellAt(e); if (!hit) return;
    paintCell(hit);
  });
  canvas.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    store.emit('change', { path: 'patterns', value: store.data.patterns });
    store._scheduleSave();
  });

  // Tab switching
  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      store.emit('editorTabChange', tab.dataset.tab);
    });
  });

  store.on('change', render); store.on('patternSelected', render); store.on('loaded', render); store.on('beat', render);
  // Use requestAnimationFrame to ensure layout is computed before first render
  requestAnimationFrame(render);
  window.addEventListener('resize', render);
}
