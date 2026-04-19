// Zone 1 — Header: transport, time display, BPM/key/sig, meters
import { store } from '../../state.js';
import { engine } from '../../audio/engine.js';

export function initHeader({ ensureAudio }) {
  const root = document.querySelector('.zone--header');
  if (!root) return;

  // Transport buttons — data-action attributes
  root.querySelectorAll('.transport-bar__btn[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await ensureAudio();
      const action = btn.dataset.action;
      handleTransport(action);
    });
  });

  // BPM input (contenteditable span)
  const bpmEl = root.querySelector('[data-field="bpm"]');
  if (bpmEl) {
    bpmEl.textContent = String(store.data.bpm ?? 140);
    bpmEl.addEventListener('blur', () => commitBpm(bpmEl));
    bpmEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); bpmEl.blur(); }
      if (e.key === 'Escape') {
        bpmEl.textContent = String(store.data.bpm);
        bpmEl.blur();
      }
    });
  }

  // Sync play-button active state to transport
  store.on('transport', (state) => {
    const playBtn = root.querySelector('[data-action="play"]');
    if (!playBtn) return;
    if (state === 'play') playBtn.setAttribute('data-active', 'true');
    else playBtn.removeAttribute('data-active');
  });

  // Re-render on BPM change from elsewhere
  store.on('change', ({ path }) => {
    if (path === 'bpm' && bpmEl) bpmEl.textContent = String(store.data.bpm);
  });
}

function handleTransport(action) {
  switch (action) {
    case 'play':
      if (store.playing) engine.stop(); else engine.play();
      break;
    case 'stop':
      engine.stop();
      break;
    case 'rewind-to-start':
      store.currentBeat = 0;
      break;
    case 'rewind':
      store.currentBeat = Math.max(0, (store.currentBeat || 0) - 4);
      break;
    case 'loop':
      engine.looping = !engine.looping;
      break;
    case 'record':
      // stub for phase 0
      console.info('[header] record not yet wired');
      break;
  }
}

function commitBpm(el) {
  const raw = (el.textContent || '').trim();
  const parsed = Math.max(20, Math.min(300, Math.round(Number(raw) || store.data.bpm)));
  store.update('bpm', parsed);
  el.textContent = String(parsed);
}
