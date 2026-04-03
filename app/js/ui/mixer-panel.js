import { store } from '../state.js';
import { mixer } from '../audio/mixer.js';
import { engine } from '../audio/engine.js';

export function initMixerPanel() {
  const container = document.getElementById('mixer');
  function render() {
    const tracks = store.data.tracks;
    container.innerHTML = `
      <div class="mixer-channels">
        ${tracks.map((track, i) => `
          <div class="mixer-channel" data-index="${i}">
            <div class="channel-name">${track.name || `Track ${i + 1}`}</div>
            <div class="channel-controls">
              <button class="mute-btn ${track.muted ? 'active' : ''}" data-action="mute" data-index="${i}">M</button>
              <button class="solo-btn ${track.soloed ? 'active' : ''}" data-action="solo" data-index="${i}">S</button>
            </div>
            <div class="fader-container">
              <input type="range" class="fader" orient="vertical" min="0" max="100"
                value="${Math.round((track.volume ?? 1) * 100)}" data-action="volume" data-index="${i}">
            </div>
            <div class="pan-container">
              <label>Pan</label>
              <input type="range" class="pan" min="-100" max="100"
                value="${Math.round((track.pan ?? 0) * 100)}" data-action="pan" data-index="${i}">
            </div>
            <div class="fx-toggles">
              <button class="fx-btn ${track.effects?.eq ? 'active' : ''}" data-action="fx" data-fx="eq" data-index="${i}">EQ</button>
              <button class="fx-btn ${track.effects?.distortion ? 'active' : ''}" data-action="fx" data-fx="dist" data-index="${i}">Dist</button>
              <button class="fx-btn ${track.effects?.delay ? 'active' : ''}" data-action="fx" data-fx="delay" data-index="${i}">Dly</button>
              <button class="fx-btn ${track.effects?.reverb ? 'active' : ''}" data-action="fx" data-fx="reverb" data-index="${i}">Rev</button>
            </div>
          </div>
        `).join('')}
        <div class="mixer-channel master">
          <div class="channel-name">Master</div>
          <div class="fader-container">
            <input type="range" class="fader" orient="vertical" min="0" max="100" value="100" data-action="master-volume">
          </div>
          <canvas id="meter-canvas" width="30" height="120"></canvas>
        </div>
      </div>
    `;
    container.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const action = e.target.dataset.action;
      if (action === 'volume') { const vol = parseInt(e.target.value, 10) / 100; store.data.tracks[idx].volume = vol; if (mixer.channels[idx]) mixer.channels[idx].setVolume(vol); store._scheduleSave(); }
      else if (action === 'pan') { const pan = parseInt(e.target.value, 10) / 100; store.data.tracks[idx].pan = pan; if (mixer.channels[idx]) mixer.channels[idx].setPan(pan); store._scheduleSave(); }
      else if (action === 'master-volume') { mixer.setMasterVolume(parseInt(e.target.value, 10) / 100); }
    });
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const idx = parseInt(btn.dataset.index, 10);
      if (btn.dataset.action === 'mute') { store.data.tracks[idx].muted = !store.data.tracks[idx].muted; if (mixer.channels[idx]) mixer.channels[idx].setMute(store.data.tracks[idx].muted); mixer.updateSoloState(); store._scheduleSave(); render(); }
      else if (btn.dataset.action === 'solo') { store.data.tracks[idx].soloed = !store.data.tracks[idx].soloed; mixer.updateSoloState(); store._scheduleSave(); render(); }
    });
    const meterCanvas = document.getElementById('meter-canvas');
    if (meterCanvas) {
      const mCtx = meterCanvas.getContext('2d');
      function drawMeter() {
        const data = mixer.getMeterData(); let sum = 0;
        for (let i = 0; i < data.length; i++) { const val = (data[i] - 128) / 128; sum += val * val; }
        const rms = Math.sqrt(sum / data.length); const level = Math.min(1, rms * 3);
        mCtx.fillStyle = '#1a1a2e'; mCtx.fillRect(0, 0, 30, 120);
        const h = level * 120;
        const gradient = mCtx.createLinearGradient(0, 120 - h, 0, 120);
        gradient.addColorStop(0, level > 0.8 ? '#e94560' : '#2ecc71'); gradient.addColorStop(1, '#533483');
        mCtx.fillStyle = gradient; mCtx.fillRect(4, 120 - h, 22, h);
        requestAnimationFrame(drawMeter);
      }
      drawMeter();
    }
  }
  store.on('change', render); store.on('loaded', render); render();
}
