import { store } from '../state.js';
import { setupCanvas, drawGrid } from './utils.js';

const TRACK_HEIGHT = 40;
const BEAT_WIDTH = 30;
const HEADER_WIDTH = 100;
const RESIZE_HANDLE = 8; // px from right edge to trigger resize
const COLORS = ['#6366f1', '#f0425d', '#34d399', '#fbbf24', '#a78bfa', '#f97316', '#06b6d4', '#ec4899'];

export function initTimeline() {
  const container = document.getElementById('timeline');
  container.innerHTML = `<canvas id="timeline-canvas"></canvas>`;
  const canvas = document.getElementById('timeline-canvas');
  canvas.style.width = '100%'; canvas.style.height = '100%';
  let scrollX = 0, scrollY = 0;

  // Drag state
  let dragging = null;

  function _getLoopLen() {
    if (store.loopEndOverride != null) return store.loopEndOverride;
    if (store.data.arrangement.length === 0) return 4;
    return Math.max(...store.data.arrangement.map(c => c.startBeat + c.lengthBeats));
  }

  function clipAt(mx, my) {
    const x = mx - HEADER_WIDTH + scrollX;
    const y = my + scrollY;
    const trackIdx = Math.floor(y / TRACK_HEIGHT);
    for (const clip of store.data.arrangement) {
      if (clip.trackIndex !== trackIdx) continue;
      const clipX = clip.startBeat * BEAT_WIDTH;
      const clipW = clip.lengthBeats * BEAT_WIDTH;
      if (x >= clipX && x < clipX + clipW) {
        const fromLeft = x - clipX;
        const fromRight = clipX + clipW - x;
        const edge = fromLeft <= RESIZE_HANDLE ? 'left' : fromRight <= RESIZE_HANDLE ? 'right' : null;
        return { clip, edge };
      }
    }
    return null;
  }

  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    const tracks = store.data.tracks;
    const arrangement = store.data.arrangement;
    ctx.fillStyle = '#141c2e'; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < tracks.length; i++) {
      const y = i * TRACK_HEIGHT - scrollY;
      if (y + TRACK_HEIGHT < 0 || y > height) continue;
      ctx.fillStyle = i % 2 === 0 ? '#141c2e' : '#121a2a';
      ctx.fillRect(0, y, width, TRACK_HEIGHT);
      // Track header
      ctx.fillStyle = '#111827'; ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.fillStyle = '#8b97b5'; ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
      ctx.fillText(tracks[i].name || `Track ${i + 1}`, 8, y + 16);
      ctx.fillStyle = tracks[i].muted ? '#f0425d' : '#4b5672'; ctx.font = '700 9px "JetBrains Mono", monospace'; ctx.fillText('M', 8, y + 30);
      ctx.fillStyle = tracks[i].soloed ? '#34d399' : '#4b5672'; ctx.fillText('S', 22, y + 30);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y + TRACK_HEIGHT); ctx.lineTo(width, y + TRACK_HEIGHT); ctx.stroke();
    }
    drawGrid(ctx, width, height, BEAT_WIDTH, TRACK_HEIGHT, 'rgba(255,255,255,0.03)', scrollX, scrollY);
    // Bar numbers
    const startBeat = Math.floor(scrollX / BEAT_WIDTH);
    for (let b = startBeat; b < startBeat + Math.ceil(width / BEAT_WIDTH) + 1; b++) {
      const x = HEADER_WIDTH + b * BEAT_WIDTH - scrollX;
      if (b % 4 === 0) {
        ctx.fillStyle = '#4b5672'; ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(`${Math.floor(b / 4) + 1}`, x + 3, 12);
        // Bar line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
    }
    // Clips
    for (const clip of arrangement) {
      const trackIdx = clip.trackIndex;
      const y = trackIdx * TRACK_HEIGHT - scrollY;
      const x = HEADER_WIDTH + clip.startBeat * BEAT_WIDTH - scrollX;
      const w = clip.lengthBeats * BEAT_WIDTH;
      if (y + TRACK_HEIGHT < 0 || y > height) continue;
      if (x + w < HEADER_WIDTH || x > width) continue;
      const clippedX = Math.max(x, HEADER_WIDTH);
      const clippedW = Math.min(x + w, width) - clippedX;
      const color = COLORS[trackIdx % COLORS.length];
      // Clip body
      ctx.fillStyle = color; ctx.globalAlpha = 0.55;
      ctx.fillRect(clippedX, y + 2, clippedW - 1, TRACK_HEIGHT - 4);
      // Left color stripe
      ctx.globalAlpha = 0.9;
      ctx.fillRect(clippedX, y + 2, 3, TRACK_HEIGHT - 4);
      ctx.globalAlpha = 1;
      // Clip name
      ctx.fillStyle = '#e8ecf4'; ctx.font = '600 10px "DM Sans", system-ui, sans-serif';
      ctx.fillText(clip.patternName || `P${clip.patternIndex}`, clippedX + 8, y + 16);
      // Subtle border
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      ctx.strokeRect(clippedX, y + 2, clippedW - 1, TRACK_HEIGHT - 4);
    }
    // Loop region indicator
    const loopLen = _getLoopLen();
    const loopX = HEADER_WIDTH + loopLen * BEAT_WIDTH - scrollX;
    // Dashed line
    ctx.strokeStyle = 'rgba(240, 66, 93, 0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(loopX, 16); ctx.lineTo(loopX, height); ctx.stroke();
    ctx.setLineDash([]);
    // Draggable handle at top
    ctx.fillStyle = '#f0425d';
    ctx.beginPath();
    ctx.roundRect(loopX - 16, 1, 32, 14, 3);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 8px "JetBrains Mono", monospace';
    const loopText = 'LOOP';
    const tw = ctx.measureText(loopText).width;
    ctx.fillText(loopText, loopX - tw / 2, 11);

    if (store.playing) {
      const beatPos = store.currentBeat / 4;
      const px = HEADER_WIDTH + beatPos * BEAT_WIDTH - scrollX;
      // Playhead glow
      ctx.strokeStyle = 'rgba(240, 66, 93, 0.2)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
      ctx.strokeStyle = '#f0425d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
      // Playhead triangle
      ctx.fillStyle = '#f0425d';
      ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.fill();
    }
    // Header divider
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(HEADER_WIDTH, 0); ctx.lineTo(HEADER_WIDTH, height); ctx.stroke();
  }

  canvas.addEventListener('wheel', (e) => { e.preventDefault(); scrollX = Math.max(0, scrollX + e.deltaX); scrollY = Math.max(0, scrollY + e.deltaY); render(); });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < HEADER_WIDTH) return;

    // Check if clicking near the loop marker
    const loopLen = _getLoopLen();
    const loopPx = HEADER_WIDTH + loopLen * BEAT_WIDTH - scrollX;
    if (Math.abs(mx - loopPx) < 10 && my < 20) {
      e.preventDefault();
      dragging = { mode: 'loop', startX: e.clientX, origLoop: loopLen };
      canvas.style.cursor = 'ew-resize';
      render();
      return;
    }

    const hit = clipAt(mx, my);
    if (hit && hit.edge) {
      e.preventDefault();
      dragging = { clip: hit.clip, mode: 'resize-' + hit.edge, startX: e.clientX, origLength: hit.clip.lengthBeats, origStart: hit.clip.startBeat };
    } else if (hit) {
      store.selectedPattern = hit.clip.patternIndex;
      store.emit('patternSelected', hit.clip.patternIndex);
      e.preventDefault();
      dragging = { clip: hit.clip, mode: 'move', startX: e.clientX, origStart: hit.clip.startBeat };
    } else {
      const y = my + scrollY;
      const trackIdx = Math.floor(y / TRACK_HEIGHT);
      if (trackIdx >= 0 && trackIdx < store.data.tracks.length) {
        store.selectedTrack = trackIdx;
        store.emit('trackSelected', trackIdx);
      }
    }
    render();
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Update cursor
    if (!dragging) {
      const loopLen = _getLoopLen();
      const loopPx = HEADER_WIDTH + loopLen * BEAT_WIDTH - scrollX;
      if (Math.abs(mx - loopPx) < 10 && my < 20) {
        canvas.style.cursor = 'ew-resize';
      } else {
        const hit = clipAt(mx, my);
        canvas.style.cursor = hit ? (hit.edge ? 'ew-resize' : 'grab') : 'default';
      }
    }

    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const dBeats = Math.round(dx / BEAT_WIDTH);

    if (dragging.mode === 'loop') {
      const newLoop = Math.max(1, dragging.origLoop + dBeats);
      store.loopEndOverride = newLoop;
      render();
      return;
    } else if (dragging.mode === 'resize-right') {
      dragging.clip.lengthBeats = Math.max(1, dragging.origLength + dBeats);
    } else if (dragging.mode === 'resize-left') {
      const newStart = Math.max(0, dragging.origStart + dBeats);
      const delta = newStart - dragging.origStart;
      const newLength = dragging.origLength - delta;
      if (newLength >= 1) {
        dragging.clip.startBeat = newStart;
        dragging.clip.lengthBeats = newLength;
      }
    } else if (dragging.mode === 'move') {
      dragging.clip.startBeat = Math.max(0, dragging.origStart + dBeats);
    }
    render();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    const wasLoop = dragging.mode === 'loop';
    dragging = null;
    canvas.style.cursor = 'default';
    if (!wasLoop) {
      store.emit('change', { path: 'arrangement', value: store.data.arrangement });
    }
    store._scheduleSave();
  });

  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = clipAt(mx, my);
    if (hit) {
      store.selectedPattern = hit.clip.patternIndex;
      store.emit('patternSelected', hit.clip.patternIndex);
    }
  });

  store.on('change', render); store.on('beat', render); store.on('loaded', render);
  function animate() { if (store.playing) render(); requestAnimationFrame(animate); }
  requestAnimationFrame(animate);
  render();
  window.addEventListener('resize', render);
}
