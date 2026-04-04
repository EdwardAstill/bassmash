import { store } from '../state.js';
import { engine } from '../audio/engine.js';
import { mixer } from '../audio/mixer.js';
import { sampler } from '../audio/sampler.js';
import { api } from '../api.js';
import { exportMp3 } from '../audio/export.js';

export function initTopbar() {
  const el = document.getElementById('toolbar');
  el.innerHTML = `
    <div class="tb-logo">B</div>
    <div class="tb-menu">
      <span class="tb-menu-item">FILE</span>
      <span class="tb-menu-item">EDIT</span>
      <span class="tb-menu-item">ADD</span>
      <span class="tb-menu-item">VIEW</span>
    </div>
    <div class="tb-transport">
      <button id="btn-play" class="tb-btn" title="Play">&#9654;</button>
      <button id="btn-stop" class="tb-btn" title="Stop">&#9632;</button>
      <input id="bpm-input" class="tb-bpm" type="number" min="20" max="300" value="${store.data.bpm}">
    </div>
    <div class="tb-sep"></div>
    <span id="project-name" class="tb-project">${store.projectName || 'Untitled'}</span>
    <span id="save-indicator" class="tb-save-indicator"></span>
    <div class="tb-sep"></div>
    <button id="btn-add-audio" class="tb-add">+ Audio</button>
    <button id="btn-add-drums" class="tb-add">+ Drums</button>
    <button id="btn-add-synth" class="tb-add">+ Synth</button>
    <div class="tb-spacer"></div>
    <button id="btn-export" class="tb-export">Export MP3</button>
  `;

  document.getElementById('btn-play').addEventListener('click', () => engine.play());
  document.getElementById('btn-stop').addEventListener('click', () => engine.stop());

  document.getElementById('bpm-input').addEventListener('change', (e) => {
    const bpm = parseInt(e.target.value, 10);
    if (bpm >= 20 && bpm <= 300) store.update('bpm', bpm);
  });

  document.getElementById('btn-add-audio').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.multiple = true;
    input.addEventListener('change', async () => {
      for (const file of input.files) {
        store.emit('uploadAndCreateAudioTrack', file);
      }
    });
    input.click();
  });

  document.getElementById('btn-add-drums').addEventListener('click', async () => {
    const trackIdx = store.data.tracks.length;
    const drumRows = [
      { name: 'Kick',      sampleRef: 'kit://kick-punchy.wav' },
      { name: 'Snare',     sampleRef: 'kit://snare-crisp.wav' },
      { name: 'HH Closed', sampleRef: 'kit://hihat-closed.wav' },
      { name: 'HH Open',   sampleRef: 'kit://hihat-open.wav' },
    ];
    for (const row of drumRows) await sampler.load(row.sampleRef);
    const patternIdx = store.data.patterns.length;
    store.addPattern({
      name: `Drums ${patternIdx + 1}`, type: 'steps', stepCount: 16,
      steps: drumRows.map(r => ({
        name: r.name, sampleRef: r.sampleRef,
        cells: new Array(16).fill(false),
        velocities: new Array(16).fill(100),
      })),
    });
    store.addTrack({
      name: `Drums ${trackIdx + 1}`, type: 'sample',
      volume: 1, pan: 0, muted: false, soloed: false,
      effects: { eq: false, distortion: false, delay: false, reverb: false },
    });
    mixer.createChannel(`Drums ${trackIdx + 1}`);
    store.data.arrangement.push({
      trackIndex: trackIdx, patternIndex: patternIdx,
      patternName: `Drums ${patternIdx + 1}`,
      startBeat: 0, lengthBeats: 4,
    });
    store.selectedTrack = trackIdx;
    store.selectedPattern = patternIdx;
    store.emit('change', { path: 'arrangement' });
    store.emit('patternSelected', patternIdx);
    store.emit('trackSelected', trackIdx);
  });

  document.getElementById('btn-add-synth').addEventListener('click', () => {
    const trackIdx = store.data.tracks.length;
    const patternIdx = store.data.patterns.length;
    store.addPattern({ name: `Synth ${patternIdx + 1}`, type: 'notes', length: 64, notes: [] });
    store.addTrack({
      name: `Synth ${trackIdx + 1}`, type: 'synth',
      volume: 1, pan: 0, muted: false, soloed: false,
      synthParams: {},
      effects: { eq: false, distortion: false, delay: false, reverb: false },
    });
    mixer.createChannel(`Synth ${trackIdx + 1}`);
    store.data.arrangement.push({
      trackIndex: trackIdx, patternIndex: patternIdx,
      patternName: `Synth ${patternIdx + 1}`,
      startBeat: 0, lengthBeats: 4,
    });
    store.selectedTrack = trackIdx;
    store.selectedPattern = patternIdx;
    store.emit('change', { path: 'arrangement' });
    store.emit('patternSelected', patternIdx);
    store.emit('trackSelected', trackIdx);
    store.emit('openPianoRoll', patternIdx);
  });

  document.getElementById('btn-export').addEventListener('click', () => exportMp3());

  store.on('transport', (evt) => {
    document.getElementById('btn-play').classList.toggle('active', evt === 'play');
  });
  store.on('change', () => { document.getElementById('save-indicator').textContent = '●'; });
  store.on('saved', () => { document.getElementById('save-indicator').textContent = ''; });
  store.on('loaded', () => {
    document.getElementById('bpm-input').value = store.data.bpm;
    document.getElementById('project-name').textContent = store.projectName;
  });
}
