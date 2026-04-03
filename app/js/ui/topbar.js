import { store } from '../state.js';
import { engine } from '../audio/engine.js';

export function initTopbar() {
  const el = document.getElementById('topbar');
  el.innerHTML = `
    <div class="transport">
      <button id="btn-play" title="Play">&#9654;</button>
      <button id="btn-stop" title="Stop">&#9632;</button>
    </div>
    <div class="bpm-control">
      <label>BPM</label>
      <input id="bpm-input" type="number" min="20" max="300" value="${store.data.bpm}">
    </div>
    <div class="time-sig">
      <label>Time Sig</label>
      <span id="time-sig-display">${store.data.timeSignature}</span>
    </div>
    <div class="project-info">
      <span id="project-name">${store.projectName || 'Untitled'}</span>
      <span id="save-indicator"></span>
    </div>
    <div class="synth-mode">
      <label>Synth</label>
      <select id="synth-mode-select">
        <option value="simple" ${store.synthMode === 'simple' ? 'selected' : ''}>Simple</option>
        <option value="advanced" ${store.synthMode === 'advanced' ? 'selected' : ''}>Advanced</option>
      </select>
    </div>
    <div class="spacer"></div>
    <button id="btn-export" title="Export MP3">Export MP3</button>
  `;
  document.getElementById('btn-play').addEventListener('click', () => engine.play());
  document.getElementById('btn-stop').addEventListener('click', () => engine.stop());
  document.getElementById('bpm-input').addEventListener('change', (e) => {
    const bpm = parseInt(e.target.value, 10);
    if (bpm >= 20 && bpm <= 300) store.update('bpm', bpm);
  });
  document.getElementById('synth-mode-select').addEventListener('change', (e) => {
    store.synthMode = e.target.value;
    store.emit('synthModeChange', e.target.value);
  });
  store.on('change', () => { document.getElementById('save-indicator').textContent = '*'; });
  store.on('saved', () => { document.getElementById('save-indicator').textContent = ''; });
  store.on('loaded', () => {
    document.getElementById('bpm-input').value = store.data.bpm;
    document.getElementById('project-name').textContent = store.projectName;
    document.getElementById('time-sig-display').textContent = store.data.timeSignature;
  });
}
