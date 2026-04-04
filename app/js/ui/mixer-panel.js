import { mixer } from '../audio/mixer.js';
import { engine } from '../audio/engine.js';
import { store } from '../state.js';

export function initMixerPanel() {
  const el = document.getElementById('mixer');

  function render() {
    const channels = mixer.channels;
    const tracks = store.data.tracks;
    el.innerHTML = `
      <div class="panel-header">Mixer</div>
      <div class="mixer-strips">
        ${['Master', ...tracks.map(t => t.name || 'Track')].map((name, i) => {
          const isMaster = i === 0;
          const track = !isMaster ? tracks[i - 1] : null;
          const muted = track ? track.muted : false;
          const soloed = track ? track.soloed : false;
          return `
          <div class="mixer-strip" data-idx="${i - 1}">
            <div class="strip-ms">
              <button class="strip-btn mute-btn ${muted ? 'active' : ''}" data-idx="${i - 1}" title="Mute">M</button>
              <button class="strip-btn solo-btn ${soloed ? 'active' : ''}" data-idx="${i - 1}" title="Solo">S</button>
            </div>
            <div class="strip-fader-track">
              <div class="strip-fader-handle" style="bottom: ${(isMaster ? 1 : (track ? track.volume : 1)) * 65}px;"
                data-idx="${i - 1}"></div>
            </div>
            <div class="strip-db">0db</div>
            <div class="strip-name ${isMaster ? 'master' : ''}">${name}</div>
          </div>`;
        }).join('')}
      </div>
    `;

    el.querySelectorAll('.mute-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        if (idx < 0) return;
        store.data.tracks[idx].muted = !store.data.tracks[idx].muted;
        const ch = mixer.channels[idx];
        if (ch) ch.setMute(store.data.tracks[idx].muted);
        mixer.updateSoloState();
        store.emit('change', { path: 'tracks' });
        store._scheduleSave();
        render();
      });
    });

    el.querySelectorAll('.solo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        if (idx < 0) return;
        store.data.tracks[idx].soloed = !store.data.tracks[idx].soloed;
        mixer.updateSoloState();
        store.emit('change', { path: 'tracks' });
        store._scheduleSave();
        render();
      });
    });

    el.querySelectorAll('.strip-fader-handle').forEach(handle => {
      let dragging = false, startY = 0, startBottom = 0;
      handle.addEventListener('mousedown', (e) => {
        dragging = true;
        startY = e.clientY;
        startBottom = parseInt(handle.style.bottom);
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dy = startY - e.clientY;
        const newBottom = Math.max(0, Math.min(65, startBottom + dy));
        handle.style.bottom = newBottom + 'px';
        const idx = parseInt(handle.dataset.idx);
        const vol = newBottom / 65;
        if (idx >= 0 && store.data.tracks[idx]) {
          store.data.tracks[idx].volume = vol;
          const ch = mixer.channels[idx];
          if (ch) ch.setVolume(vol);
          store._scheduleSave();
        } else {
          engine.masterGain.gain.setValueAtTime(vol, engine.ctx.currentTime);
        }
      });
      window.addEventListener('mouseup', () => { dragging = false; });
    });
  }

  store.on('change', render);
  store.on('loaded', render);
  render();
}
