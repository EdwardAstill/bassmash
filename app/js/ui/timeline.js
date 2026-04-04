import { store } from '../state.js';
import { setupCanvas, drawGrid } from './utils.js';
import { getCached, loadWaveform } from '../audio/waveform.js';
import { api } from '../api.js';
import { engine } from '../audio/engine.js';
import { mixer } from '../audio/mixer.js';

const TRACK_HEIGHT = 44;
const BEAT_WIDTH = 32;
const HEADER_WIDTH = 130;
const RESIZE_HANDLE = 8;

// Colors
const C_BG         = '#000';
const C_BG_ALT     = '#080808';
const C_HEADER     = '#0c0c0c';
const C_BORDER     = 'rgba(255,255,255,0.04)';
const C_TEXT       = '#aaaaaa';
const C_TEXT_DIM   = '#555555';
const C_CLIP       = '#1a1a1a';
const C_CLIP_BORDER= '#2a2a2a';
const C_CLIP_ACTIVE= '#222222';
const C_PLAYHEAD   = '#ffffff';
const C_LOOP       = 'rgba(255,255,255,0.3)';

export function initTimeline() {
  const container = document.getElementById('playlist');
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
    ctx.fillStyle = C_BG; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < tracks.length; i++) {
      const y = i * TRACK_HEIGHT - scrollY;
      if (y + TRACK_HEIGHT < 0 || y > height) continue;
      ctx.fillStyle = i % 2 === 0 ? C_BG : C_BG_ALT;
      ctx.fillRect(0, y, width, TRACK_HEIGHT);
      // Track header
      ctx.fillStyle = C_HEADER; ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.fillStyle = C_TEXT; ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
      ctx.fillText(tracks[i].name || `Track ${i + 1}`, 8, y + 16);
      ctx.fillStyle = tracks[i].muted ? '#fff' : C_TEXT_DIM; ctx.font = '700 9px "JetBrains Mono", monospace'; ctx.fillText('M', 8, y + 30);
      ctx.fillStyle = tracks[i].soloed ? '#fff' : C_TEXT_DIM; ctx.fillText('S', 22, y + 30);
      ctx.strokeStyle = C_BORDER; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y + TRACK_HEIGHT); ctx.lineTo(width, y + TRACK_HEIGHT); ctx.stroke();
    }
    drawGrid(ctx, width, height, BEAT_WIDTH, TRACK_HEIGHT, C_BORDER, scrollX, scrollY);
    // Bar numbers
    const startBeat = Math.floor(scrollX / BEAT_WIDTH);
    for (let b = startBeat; b < startBeat + Math.ceil(width / BEAT_WIDTH) + 1; b++) {
      const x = HEADER_WIDTH + b * BEAT_WIDTH - scrollX;
      if (b % 4 === 0) {
        ctx.fillStyle = C_TEXT_DIM; ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(`${Math.floor(b / 4) + 1}`, x + 3, 12);
        // Bar line
        ctx.strokeStyle = C_BORDER; ctx.lineWidth = 1;
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

      if (clip.type === 'audio') {
        _renderAudioClip(ctx, clip, clippedX, clippedW, y);
      } else {
        _renderPatternClip(ctx, clip, clippedX, clippedW, y);
      }
    }
    // Loop region indicator
    const loopLen = _getLoopLen();
    const loopX = HEADER_WIDTH + loopLen * BEAT_WIDTH - scrollX;
    // Dashed line
    ctx.strokeStyle = C_LOOP; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(loopX, 16); ctx.lineTo(loopX, height); ctx.stroke();
    ctx.setLineDash([]);
    // Draggable handle at top
    ctx.fillStyle = C_PLAYHEAD;
    ctx.beginPath();
    ctx.roundRect(loopX - 16, 1, 32, 14, 3);
    ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = '700 8px "JetBrains Mono", monospace';
    const loopText = 'LOOP';
    const tw = ctx.measureText(loopText).width;
    ctx.fillText(loopText, loopX - tw / 2, 11);

    if (store.playing) {
      const beatPos = store.currentBeat / 4;
      const px = HEADER_WIDTH + beatPos * BEAT_WIDTH - scrollX;
      // Playhead glow
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
      ctx.strokeStyle = C_PLAYHEAD; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
      // Playhead triangle
      ctx.fillStyle = C_PLAYHEAD;
      ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.fill();
    }
    // Header divider
    ctx.strokeStyle = C_BORDER; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(HEADER_WIDTH, 0); ctx.lineTo(HEADER_WIDTH, height); ctx.stroke();
  }

  function _renderPatternClip(ctx, clip, cx, cw, y) {
    const isSelected = clip.trackIndex === store.selectedTrack;
    ctx.fillStyle = C_CLIP;
    ctx.fillRect(cx, y + 3, cw - 1, TRACK_HEIGHT - 6);
    ctx.fillStyle = isSelected ? '#fff' : '#333';
    ctx.fillRect(cx, y + 3, 2, TRACK_HEIGHT - 6);
    ctx.fillStyle = isSelected ? '#fff' : C_TEXT;
    ctx.font = '500 9px "DM Sans", system-ui, sans-serif';
    ctx.fillText(clip.patternName || `P${clip.patternIndex}`, cx + 8, y + 16);
    ctx.strokeStyle = isSelected ? '#444' : C_CLIP_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx, y + 3, cw - 1, TRACK_HEIGHT - 6);
  }

  function _renderAudioClip(ctx, clip, cx, cw, y) {
    ctx.fillStyle = '#161616';
    ctx.fillRect(cx, y + 3, cw - 1, TRACK_HEIGHT - 6);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(cx, y + 3, 2, TRACK_HEIGHT - 6);
    const url = api.audioUrl(store.projectName, clip.audioRef);
    const cached = getCached(url);
    if (cached && cached.points) {
      const { points } = cached;
      const midY = y + TRACK_HEIGHT / 2;
      const ampH = (TRACK_HEIGHT - 12) / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const px = cx + (i / points.length) * cw;
        if (px > cx + cw) break;
        const py = midY - points[i] * ampH;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#777';
    ctx.font = '500 8px "DM Sans", system-ui, sans-serif';
    ctx.save();
    ctx.beginPath(); ctx.rect(cx + 4, y + 3, cw - 8, TRACK_HEIGHT - 6); ctx.clip();
    ctx.fillText(clip.audioRef, cx + 5, y + 13);
    ctx.restore();
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
    ctx.strokeRect(cx, y + 3, cw - 1, TRACK_HEIGHT - 6);
  }

  const playlistEl = document.getElementById('playlist');

  playlistEl.addEventListener('dragover', (e) => {
    const hasBrowserRef = e.dataTransfer.types.includes('text/bassmash-audio-ref');
    const hasFiles = e.dataTransfer.types.includes('Files');
    if (hasBrowserRef || hasFiles) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  playlistEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const dropBeat = Math.max(0, Math.floor((mx - HEADER_WIDTH + scrollX) / BEAT_WIDTH));

    const audioRef = e.dataTransfer.getData('text/bassmash-audio-ref');
    if (audioRef) {
      await _createAudioTrack(audioRef, dropBeat);
      return;
    }

    const files = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac)$/i.test(f.name));
    for (const file of files) {
      const result = await api.uploadAudio(store.projectName, file);
      store.audioFiles = await api.listAudio(store.projectName);
      store.emit('audioFilesChanged');
      await _createAudioTrack(result.filename, dropBeat);
    }
  });

  async function _createAudioTrack(audioRef, startBeat) {
    const trackIdx = store.data.tracks.length;
    const name = audioRef.replace(/\.(mp3|wav|ogg|flac)$/i, '');
    store.addTrack({
      name, type: 'audio',
      volume: 1, pan: 0, muted: false, soloed: false,
      effects: { eq: false, distortion: false, delay: false, reverb: false },
    });
    mixer.createChannel(name);

    const url = api.audioUrl(store.projectName, audioRef);
    const { audioBuf } = await loadWaveform(url, engine.ctx);
    const secondsPerBeat = 60 / (store.data.bpm * 4);
    const durationBeats = Math.ceil(audioBuf.duration / secondsPerBeat);

    store.data.arrangement.push({
      type: 'audio', trackIndex: trackIdx,
      audioRef, startBeat, lengthBeats: durationBeats, offset: 0,
    });
    store.emit('change', { path: 'arrangement' });
    store._scheduleSave();
  }

  store.on('createAudioTrackFromRef', async ({ audioRef, startBeat }) => {
    await _createAudioTrack(audioRef, startBeat);
  });

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
