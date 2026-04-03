import { store } from '../state.js';
import { setupCanvas, drawGrid } from './utils.js';

const TRACK_HEIGHT = 40;
const BEAT_WIDTH = 30;
const HEADER_WIDTH = 100;
const COLORS = ['#533483', '#e94560', '#7ec8e3', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6', '#1abc9c'];

export function initTimeline() {
  const container = document.getElementById('timeline');
  container.innerHTML = `<canvas id="timeline-canvas"></canvas>`;
  const canvas = document.getElementById('timeline-canvas');
  canvas.style.width = '100%'; canvas.style.height = '100%';
  let scrollX = 0, scrollY = 0;

  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    const tracks = store.data.tracks;
    const arrangement = store.data.arrangement;
    ctx.fillStyle = '#0f3460'; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < tracks.length; i++) {
      const y = i * TRACK_HEIGHT - scrollY;
      if (y + TRACK_HEIGHT < 0 || y > height) continue;
      ctx.fillStyle = i % 2 === 0 ? '#0f3460' : '#0d2d52';
      ctx.fillRect(0, y, width, TRACK_HEIGHT);
      ctx.fillStyle = '#16213e'; ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.fillStyle = '#7ec8e3'; ctx.font = '11px sans-serif';
      ctx.fillText(tracks[i].name || `Track ${i + 1}`, 8, y + 16);
      ctx.fillStyle = tracks[i].muted ? '#e94560' : '#4a4a6a'; ctx.fillText('M', 8, y + 32);
      ctx.fillStyle = tracks[i].soloed ? '#2ecc71' : '#4a4a6a'; ctx.fillText('S', 22, y + 32);
      ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y + TRACK_HEIGHT); ctx.lineTo(width, y + TRACK_HEIGHT); ctx.stroke();
    }
    drawGrid(ctx, width, height, BEAT_WIDTH, TRACK_HEIGHT, 'rgba(255,255,255,0.05)', scrollX, scrollY);
    ctx.fillStyle = '#7ec8e3'; ctx.font = '10px sans-serif';
    const startBeat = Math.floor(scrollX / BEAT_WIDTH);
    for (let b = startBeat; b < startBeat + Math.ceil(width / BEAT_WIDTH) + 1; b++) {
      const x = HEADER_WIDTH + b * BEAT_WIDTH - scrollX;
      if (b % 4 === 0) ctx.fillText(`${Math.floor(b / 4) + 1}`, x + 2, 10);
    }
    for (const clip of arrangement) {
      const trackIdx = clip.trackIndex;
      const y = trackIdx * TRACK_HEIGHT - scrollY;
      const x = HEADER_WIDTH + clip.startBeat * BEAT_WIDTH - scrollX;
      const w = clip.lengthBeats * BEAT_WIDTH;
      if (y + TRACK_HEIGHT < 0 || y > height) continue;
      if (x + w < HEADER_WIDTH || x > width) continue;
      ctx.fillStyle = COLORS[trackIdx % COLORS.length]; ctx.globalAlpha = 0.7;
      ctx.fillRect(Math.max(x, HEADER_WIDTH), y + 2, w - 1, TRACK_HEIGHT - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif';
      ctx.fillText(clip.patternName || `P${clip.patternIndex}`, Math.max(x, HEADER_WIDTH) + 4, y + 14);
    }
    if (store.playing) {
      const beatPos = store.currentBeat / 4;
      const px = HEADER_WIDTH + beatPos * BEAT_WIDTH - scrollX;
      ctx.strokeStyle = '#e94560'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
    }
    ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(HEADER_WIDTH, 0); ctx.lineTo(HEADER_WIDTH, height); ctx.stroke();
  }

  canvas.addEventListener('wheel', (e) => { e.preventDefault(); scrollX = Math.max(0, scrollX + e.deltaX); scrollY = Math.max(0, scrollY + e.deltaY); render(); });
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top + scrollY;
    const trackIdx = Math.floor(y / TRACK_HEIGHT);
    if (trackIdx >= 0 && trackIdx < store.data.tracks.length) { store.selectedTrack = trackIdx; store.emit('trackSelected', trackIdx); render(); }
  });
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - HEADER_WIDTH + scrollX;
    const y = e.clientY - rect.top + scrollY;
    const trackIdx = Math.floor(y / TRACK_HEIGHT);
    const beat = x / BEAT_WIDTH;
    for (const clip of store.data.arrangement) {
      if (clip.trackIndex === trackIdx && beat >= clip.startBeat && beat < clip.startBeat + clip.lengthBeats) {
        store.selectedPattern = clip.patternIndex; store.emit('patternSelected', clip.patternIndex); break;
      }
    }
  });
  store.on('change', render); store.on('beat', render); store.on('loaded', render);
  function animate() { if (store.playing) render(); requestAnimationFrame(animate); }
  requestAnimationFrame(animate);
  render();
  window.addEventListener('resize', render);
}
