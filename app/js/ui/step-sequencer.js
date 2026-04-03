import { store } from '../state.js';
import { setupCanvas } from './utils.js';

const CELL_SIZE = 28, HEADER_WIDTH = 80, HEADER_HEIGHT = 24;

export function initStepSequencer(container) {
  container.innerHTML = `<canvas id="step-seq-canvas"></canvas>`;
  const canvas = document.getElementById('step-seq-canvas');
  canvas.style.width = '100%'; canvas.style.height = '100%';

  function getPattern() {
    if (store.selectedPattern == null) return null;
    return store.data.patterns[store.selectedPattern] || null;
  }
  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    const pattern = getPattern();
    ctx.fillStyle = '#0f3460'; ctx.fillRect(0, 0, width, height);
    if (!pattern || !pattern.steps) {
      ctx.fillStyle = '#7ec8e3'; ctx.font = '13px sans-serif'; ctx.fillText('No pattern selected', 20, 40); return;
    }
    const numSteps = pattern.stepCount || 16;
    const rows = pattern.steps;
    ctx.fillStyle = '#16213e'; ctx.fillRect(HEADER_WIDTH, 0, width, HEADER_HEIGHT);
    ctx.fillStyle = '#7ec8e3'; ctx.font = '10px sans-serif';
    for (let s = 0; s < numSteps; s++) { ctx.fillText(`${s + 1}`, HEADER_WIDTH + s * CELL_SIZE + 8, 16); }
    for (let r = 0; r < rows.length; r++) {
      const y = HEADER_HEIGHT + r * CELL_SIZE;
      const row = rows[r];
      ctx.fillStyle = '#16213e'; ctx.fillRect(0, y, HEADER_WIDTH, CELL_SIZE);
      ctx.fillStyle = '#7ec8e3'; ctx.font = '11px sans-serif'; ctx.fillText(row.name || `Row ${r + 1}`, 6, y + 18);
      for (let s = 0; s < numSteps; s++) {
        const x = HEADER_WIDTH + s * CELL_SIZE;
        const isOn = row.cells[s];
        ctx.fillStyle = isOn ? '#e94560' : (s % 4 === 0 ? '#1a1a2e' : '#16213e');
        ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        if (isOn && row.velocities && row.velocities[s]) {
          ctx.globalAlpha = row.velocities[s] / 127; ctx.fillStyle = '#ff6b81';
          ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 0.5; ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      }
    }
    if (store.playing) {
      const step = store.currentBeat % numSteps;
      ctx.fillStyle = 'rgba(233, 69, 96, 0.3)';
      ctx.fillRect(HEADER_WIDTH + step * CELL_SIZE, HEADER_HEIGHT, CELL_SIZE, rows.length * CELL_SIZE);
    }
  }
  canvas.addEventListener('click', (e) => {
    const pattern = getPattern(); if (!pattern || !pattern.steps) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (mx < HEADER_WIDTH || my < HEADER_HEIGHT) return;
    const step = Math.floor((mx - HEADER_WIDTH) / CELL_SIZE);
    const row = Math.floor((my - HEADER_HEIGHT) / CELL_SIZE);
    if (row < 0 || row >= pattern.steps.length) return;
    if (step < 0 || step >= (pattern.stepCount || 16)) return;
    pattern.steps[row].cells[step] = !pattern.steps[row].cells[step];
    if (!pattern.steps[row].velocities) pattern.steps[row].velocities = new Array(pattern.stepCount || 16).fill(100);
    store.emit('change', { path: 'patterns', value: store.data.patterns });
    store._scheduleSave(); render();
  });
  store.on('change', render); store.on('patternSelected', render); store.on('loaded', render); store.on('beat', render);
  render(); window.addEventListener('resize', render);
}
