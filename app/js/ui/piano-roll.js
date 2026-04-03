import { store } from '../state.js';
import { setupCanvas, drawGrid, midiToName } from './utils.js';

const NOTE_HEIGHT = 12, STEP_WIDTH = 20, KEY_WIDTH = 40, MIN_NOTE = 36, MAX_NOTE = 96;
const NOTE_RANGE = MAX_NOTE - MIN_NOTE;

export function initPianoRoll(container) {
  container.innerHTML = `
    <div class="editor-tabs">
      <button class="tab active" data-tab="piano-roll">Piano Roll</button>
      <button class="tab" data-tab="step-seq">Step Sequencer</button>
    </div>
    <div class="editor-content"><canvas id="piano-roll-canvas"></canvas></div>
  `;
  const canvas = document.getElementById('piano-roll-canvas');
  canvas.style.width = '100%'; canvas.style.height = '100%';
  let scrollX = 0, scrollY = (NOTE_RANGE / 2) * NOTE_HEIGHT;

  function getPattern() {
    if (store.selectedPattern == null) return null;
    return store.data.patterns[store.selectedPattern] || null;
  }
  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    const pattern = getPattern();
    ctx.fillStyle = '#0f3460'; ctx.fillRect(0, 0, width, height);
    for (let note = MAX_NOTE; note >= MIN_NOTE; note--) {
      const y = (MAX_NOTE - note) * NOTE_HEIGHT - scrollY;
      if (y + NOTE_HEIGHT < 0 || y > height) continue;
      const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
      ctx.fillStyle = isBlack ? '#1a1a2e' : '#16213e';
      ctx.fillRect(0, y, KEY_WIDTH, NOTE_HEIGHT);
      if (note % 12 === 0) { ctx.fillStyle = '#7ec8e3'; ctx.font = '9px sans-serif'; ctx.fillText(midiToName(note), 4, y + 10); }
      ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y + NOTE_HEIGHT); ctx.lineTo(width, y + NOTE_HEIGHT); ctx.stroke();
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(KEY_WIDTH, 0, width - KEY_WIDTH, height); ctx.clip();
    drawGrid(ctx, width, height, STEP_WIDTH, NOTE_HEIGHT, 'rgba(255,255,255,0.05)', scrollX - KEY_WIDTH, scrollY);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    const startStep = Math.floor(scrollX / STEP_WIDTH);
    for (let s = startStep; s < startStep + Math.ceil(width / STEP_WIDTH) + 1; s++) {
      if (s % 4 === 0) { const x = KEY_WIDTH + s * STEP_WIDTH - scrollX; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    }
    if (pattern && pattern.notes) {
      for (const note of pattern.notes) {
        const x = KEY_WIDTH + note.start * STEP_WIDTH - scrollX;
        const y = (MAX_NOTE - note.pitch) * NOTE_HEIGHT - scrollY;
        const w = note.duration * STEP_WIDTH;
        if (y + NOTE_HEIGHT < 0 || y > height) continue;
        if (x + w < KEY_WIDTH || x > width) continue;
        const alpha = 0.4 + (note.velocity / 127) * 0.6;
        ctx.fillStyle = `rgba(233, 69, 96, ${alpha})`; ctx.fillRect(x, y + 1, w - 1, NOTE_HEIGHT - 2);
        ctx.strokeStyle = '#e94560'; ctx.lineWidth = 1; ctx.strokeRect(x, y + 1, w - 1, NOTE_HEIGHT - 2);
      }
    }
    ctx.restore();
    ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(KEY_WIDTH, 0); ctx.lineTo(KEY_WIDTH, height); ctx.stroke();
  }
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); scrollX = Math.max(0, scrollX + e.deltaX); scrollY = Math.max(0, scrollY + e.deltaY); render(); });
  canvas.addEventListener('mousedown', (e) => {
    const pattern = getPattern(); if (!pattern) return;
    if (!pattern.notes) pattern.notes = [];
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (mx < KEY_WIDTH) return;
    const step = Math.floor((mx - KEY_WIDTH + scrollX) / STEP_WIDTH);
    const pitch = MAX_NOTE - Math.floor((my + scrollY) / NOTE_HEIGHT);
    if (pitch < MIN_NOTE || pitch > MAX_NOTE) return;
    const existing = pattern.notes.findIndex(n => n.pitch === pitch && step >= n.start && step < n.start + n.duration);
    if (existing >= 0) pattern.notes.splice(existing, 1);
    else pattern.notes.push({ pitch, start: step, duration: 1, velocity: 100 });
    store.emit('change', { path: 'patterns', value: store.data.patterns });
    store._scheduleSave(); render();
  });
  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active'); store.emit('editorTabChange', tab.dataset.tab);
    });
  });
  store.on('change', render); store.on('patternSelected', render); store.on('loaded', render);
  requestAnimationFrame(render); window.addEventListener('resize', render);
}
