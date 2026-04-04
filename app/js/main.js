import { api } from './api.js';
import { store } from './state.js';
import { engine } from './audio/engine.js';
import { sampler } from './audio/sampler.js';
import { mixer } from './audio/mixer.js';
import { Synth } from './audio/synth.js';
import { initTopbar } from './ui/topbar.js';
import { initTimeline } from './ui/timeline.js';
import { initChannelRack } from './ui/step-sequencer.js';
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
  initChannelRack(document.getElementById('channel-rack'));
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
  dialog.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(6,8,16,0.85);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;z-index:1000;';
  dialog.innerHTML = `
    <div style="background:linear-gradient(135deg, #1a2236, #141c2e);padding:32px;border-radius:12px;min-width:360px;max-width:420px;border:1px solid rgba(255,255,255,0.06);box-shadow:0 24px 64px rgba(0,0,0,0.5),0 0 0 1px rgba(240,66,93,0.1);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#f0425d,#b83349);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 12px rgba(240,66,93,0.3);">B</div>
        <div>
          <h2 style="color:#e8ecf4;font-family:'DM Sans',system-ui;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Bassmash</h2>
          <div style="color:#4b5672;font-size:10px;font-family:'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;">Beat Studio</div>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <input id="new-project-name" placeholder="Project name..."
          style="width:100%;padding:10px 14px;background:#0a0e1a;border:1px solid rgba(255,255,255,0.06);color:#e8ecf4;border-radius:6px;font-family:'DM Sans',system-ui;font-size:13px;outline:none;transition:border-color 0.15s;"
          onfocus="this.style.borderColor='#f0425d';this.style.boxShadow='0 0 12px rgba(240,66,93,0.2)'"
          onblur="this.style.borderColor='rgba(255,255,255,0.06)';this.style.boxShadow='none'">
      </div>
      <button id="create-project-btn" style="width:100%;background:linear-gradient(135deg,#f0425d,#b83349);color:white;border:none;padding:10px;border-radius:6px;cursor:pointer;font-family:'DM Sans',system-ui;font-size:13px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 16px rgba(240,66,93,0.25);transition:all 0.15s;"
        onmouseenter="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(240,66,93,0.35)'"
        onmouseleave="this.style.transform='none';this.style.boxShadow='0 4px 16px rgba(240,66,93,0.25)'"
      >Create New Project</button>
      ${projects.length > 0 ? `
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
          <div style="color:#4b5672;font-size:9px;font-family:'JetBrains Mono',monospace;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;">Recent Projects</div>
          <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;">
            ${projects.map(name => `
              <div class="project-item" data-name="${name}" style="padding:10px 12px;cursor:pointer;color:#8b97b5;border-radius:6px;font-weight:500;transition:all 0.1s;display:flex;align-items:center;gap:8px;">
                <span style="color:#4b5672;font-size:12px;">&#9835;</span> ${name}
              </div>
            `).join('')}
          </div>
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
    el.addEventListener('mouseenter', () => { el.style.background = '#1e2940'; el.style.color = '#e8ecf4'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; el.style.color = '#8b97b5'; });
  });
}

async function loadProject(name) {
  const data = await api.getProject(name);
  store.load(name, data);
  for (const track of data.tracks) mixer.createChannel(track.name);
  await sampler.preloadProject();
  if (data.patterns && data.patterns.length > 0) {
    store.selectedPattern = 0;
    store.emit('patternSelected', 0);
  }
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
