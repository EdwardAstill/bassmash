import { api } from './api.js';
import { store } from './state.js';
import { engine } from './audio/engine.js';
import { sampler } from './audio/sampler.js';
import { mixer } from './audio/mixer.js';
import { Synth } from './audio/synth.js';
import { initTopbar } from './ui/topbar.js';
import { initTimeline } from './ui/timeline.js';
import { initPianoRoll } from './ui/piano-roll.js';
import { initStepSequencer } from './ui/step-sequencer.js';
import { initMixerPanel } from './ui/mixer-panel.js';
import { midiToFreq } from './ui/utils.js';

const synth = new Synth();

async function init() {
  engine.init();
  store.setSaveFn(async (data) => {
    if (store.projectName) await api.saveProject(store.projectName, data);
  });
  initTopbar();
  initTimeline();
  initMixerPanel();
  const editorEl = document.getElementById('editor');
  initPianoRoll(editorEl);
  store.on('editorTabChange', (tab) => {
    if (tab === 'piano-roll') initPianoRoll(editorEl);
    else if (tab === 'step-seq') initStepSequencer(editorEl);
  });
  store.on('beat', ({ beat, time }) => {
    for (let t = 0; t < store.data.tracks.length; t++) {
      const track = store.data.tracks[t];
      if (track.muted) continue;
      const channel = mixer.channels[t];
      if (!channel) continue;
      for (const clip of store.data.arrangement) {
        if (clip.trackIndex !== t) continue;
        const clipStartStep = clip.startBeat * 4;
        const clipEndStep = (clip.startBeat + clip.lengthBeats) * 4;
        if (beat < clipStartStep || beat >= clipEndStep) continue;
        const localStep = beat - clipStartStep;
        const pattern = store.data.patterns[clip.patternIndex];
        if (!pattern) continue;
        if (pattern.steps) {
          const stepIdx = localStep % (pattern.stepCount || 16);
          for (const row of pattern.steps) {
            if (row.cells[stepIdx]) {
              const velocity = (row.velocities && row.velocities[stepIdx]) || 100;
              const gain = velocity / 127;
              if (row.sampleRef) sampler.play(row.sampleRef, time, channel.input, { playbackRate: gain });
            }
          }
        }
        if (pattern.notes) {
          const spb = engine._secondsPerBeat() / 4;
          for (const note of pattern.notes) {
            if (note.start === localStep % (pattern.length || 64)) {
              const duration = note.duration * spb;
              const freq = midiToFreq(note.pitch);
              synth.playNote(freq, time, duration, track.synthParams || {}, channel.input);
            }
          }
        }
      }
    }
  });
  await showProjectPicker();
}

async function showProjectPicker() {
  const projects = await api.listProjects();
  const dialog = document.createElement('div');
  dialog.id = 'project-picker';
  dialog.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';
  dialog.innerHTML = `
    <div style="background:var(--bg-secondary);padding:24px;border-radius:8px;min-width:300px;">
      <h2 style="color:var(--accent);margin-bottom:16px;">Bassmash</h2>
      <div style="margin-bottom:16px;">
        <input id="new-project-name" placeholder="New project name..."
          style="width:100%;padding:8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;">
      </div>
      <button id="create-project-btn" style="background:var(--accent);color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-bottom:16px;">Create New Project</button>
      ${projects.length > 0 ? `
        <h3 style="color:var(--text-secondary);margin-bottom:8px;">Open Existing</h3>
        <div style="max-height:200px;overflow-y:auto;">
          ${projects.map(name => `
            <div class="project-item" data-name="${name}" style="padding:8px;cursor:pointer;border-bottom:1px solid var(--border);color:var(--text-primary);">${name}</div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
  document.body.appendChild(dialog);
  document.getElementById('create-project-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-project-name').value.trim();
    if (!name) return;
    await api.createProject(name);
    await loadProject(name);
    dialog.remove();
  });
  dialog.querySelectorAll('.project-item').forEach(el => {
    el.addEventListener('click', async () => { await loadProject(el.dataset.name); dialog.remove(); });
    el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-panel)');
    el.addEventListener('mouseleave', () => el.style.background = 'transparent');
  });
}

async function loadProject(name) {
  const data = await api.getProject(name);
  store.load(name, data);
  for (const track of data.tracks) mixer.createChannel(track.name);
  await sampler.preloadProject();
}

// AudioContext requires user gesture in most browsers
let initialized = false;
async function safeInit() {
  if (initialized) return;
  initialized = true;
  await init();
}

document.addEventListener('click', safeInit, { once: true });
// Also try on DOMContentLoaded in case AudioContext is allowed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
