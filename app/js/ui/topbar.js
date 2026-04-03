import { store } from '../state.js';
import { engine } from '../audio/engine.js';
import { mixer } from '../audio/mixer.js';
import { sampler } from '../audio/sampler.js';
import { api } from '../api.js';

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
    <button id="btn-add-drums" class="add-track-btn" title="Add Drum Track">+ Drums</button>
    <button id="btn-add-synth" class="add-track-btn" title="Add Synth Track">+ Synth</button>
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
  // Add drum track
  document.getElementById('btn-add-drums').addEventListener('click', async () => {
    const trackIdx = store.data.tracks.length;
    const kitSamples = await api.listKit();
    const drumRows = [
      { name: 'Kick', sampleRef: 'kit://kick-punchy.wav' },
      { name: 'Snare', sampleRef: 'kit://snare-crisp.wav' },
      { name: 'HH Closed', sampleRef: 'kit://hihat-closed.wav' },
      { name: 'HH Open', sampleRef: 'kit://hihat-open.wav' },
    ];
    // Preload samples
    for (const row of drumRows) {
      await sampler.load(row.sampleRef);
    }
    const patternIdx = store.data.patterns.length;
    store.addPattern({
      name: `Drums ${patternIdx + 1}`,
      type: 'steps',
      stepCount: 16,
      steps: drumRows.map(r => ({
        name: r.name,
        sampleRef: r.sampleRef,
        cells: new Array(16).fill(false),
        velocities: new Array(16).fill(100),
      })),
    });
    store.addTrack({
      name: `Drums ${trackIdx + 1}`,
      type: 'sample',
      volume: 1, pan: 0, muted: false, soloed: false,
      effects: { eq: false, distortion: false, delay: false, reverb: false },
    });
    mixer.createChannel(`Drums ${trackIdx + 1}`);
    // Place clip on timeline
    store.data.arrangement.push({
      trackIndex: trackIdx,
      patternIndex: patternIdx,
      patternName: `Drums ${patternIdx + 1}`,
      startBeat: 0,
      lengthBeats: 4,
    });
    store.selectedTrack = trackIdx;
    store.selectedPattern = patternIdx;
    store.emit('change', { path: 'arrangement' });
    store.emit('patternSelected', patternIdx);
    store.emit('trackSelected', trackIdx);
    store.emit('editorTabChange', 'step-seq');
  });

  // Add synth track
  document.getElementById('btn-add-synth').addEventListener('click', () => {
    const trackIdx = store.data.tracks.length;
    const patternIdx = store.data.patterns.length;
    store.addPattern({
      name: `Synth ${patternIdx + 1}`,
      type: 'notes',
      length: 64,
      notes: [],
    });
    store.addTrack({
      name: `Synth ${trackIdx + 1}`,
      type: 'synth',
      volume: 1, pan: 0, muted: false, soloed: false,
      synthParams: {},
      effects: { eq: false, distortion: false, delay: false, reverb: false },
    });
    mixer.createChannel(`Synth ${trackIdx + 1}`);
    store.data.arrangement.push({
      trackIndex: trackIdx,
      patternIndex: patternIdx,
      patternName: `Synth ${patternIdx + 1}`,
      startBeat: 0,
      lengthBeats: 4,
    });
    store.selectedTrack = trackIdx;
    store.selectedPattern = patternIdx;
    store.emit('change', { path: 'arrangement' });
    store.emit('patternSelected', patternIdx);
    store.emit('trackSelected', trackIdx);
    store.emit('editorTabChange', 'piano-roll');
  });

  store.on('change', () => { document.getElementById('save-indicator').textContent = '*'; });
  store.on('saved', () => { document.getElementById('save-indicator').textContent = ''; });
  store.on('loaded', () => {
    document.getElementById('bpm-input').value = store.data.bpm;
    document.getElementById('project-name').textContent = store.projectName;
    document.getElementById('time-sig-display').textContent = store.data.timeSignature;
  });
}
