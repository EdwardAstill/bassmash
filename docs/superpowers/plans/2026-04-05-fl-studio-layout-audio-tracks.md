# FL Studio Layout & Audio Tracks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild M8S's UI as a full FL Studio-style layout (Browser + Channel Rack + Playlist + Mixer) in black & white, and add audio clip track support so users can import vocals/instrumentals, place them on the playlist, and mix them.

**Architecture:** New `index.html` shell with 5 fixed panels replaces the current 3-panel layout. Existing audio/state logic is preserved — only the UI containers move. Audio clips are a new clip type in `store.data.arrangement` (`type: 'audio'`), backed by uploaded files served from `~/m8s-projects/<project>/audio/`.

**Tech Stack:** Vanilla JS ES modules, Web Audio API, FastAPI (Python), pytest + httpx for server tests. Run tests with `uv run pytest`. Run dev server with `uv run uvicorn server.main:app --reload`.

---

## File Map

**Rewrite:**
- `app/index.html` — 5-panel layout shell
- `app/css/style.css` — black/white theme + FL layout

**Create:**
- `app/js/ui/browser.js` — browser panel: audio file list, drag-to-playlist, drop-to-upload
- `app/js/audio/waveform.js` — decode audio → peak-point array, cache by URL

**Modify:**
- `app/js/ui/topbar.js` — adapt to new `#toolbar` container
- `app/js/ui/timeline.js` — black/white colors, add audio clip rendering, drop-to-create
- `app/js/ui/step-sequencer.js` — export `initChannelRack(container)`, HTML-based, remove tab chrome
- `app/js/ui/piano-roll.js` — remove tab chrome, standalone canvas content
- `app/js/ui/mixer-panel.js` — target `#mixer` container
- `app/js/state.js` — add `audioFiles` field
- `app/js/main.js` — wire all panels, audio clip playback, piano roll overlay
- `app/js/api.js` — add `uploadAudio`, `listAudio`, `audioUrl`
- `server/routes.py` — add audio upload/list/serve endpoints, create `audio/` on project create
- `server/test_routes.py` — add audio endpoint tests

---

## Task 1: New HTML Layout Shell

**Files:**
- Rewrite: `app/index.html`

- [ ] **Step 1: Rewrite index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>M8S</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div id="toolbar"></div>
  <div id="main">
    <div id="browser"></div>
    <div id="channel-rack"></div>
    <div id="playlist"></div>
    <div id="mixer"></div>
  </div>
  <div id="piano-roll-overlay" class="hidden"></div>
  <script type="module" src="/js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Start dev server and verify page loads without errors**

```bash
uv run uvicorn server.main:app --reload
```

Open `http://localhost:8000`. Expect: blank dark page, no JS errors in console.

- [ ] **Step 3: Commit**

```bash
git add app/index.html
git commit -m "feat: new FL Studio 5-panel HTML layout shell"
```

---

## Task 2: FL Studio CSS Theme

**Files:**
- Rewrite: `app/css/style.css`

- [ ] **Step 1: Rewrite style.css**

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg:              #000000;
  --bg-panel:        #0a0a0a;
  --bg-surface:      #111111;
  --bg-elevated:     #1a1a1a;
  --bg-hover:        #222222;
  --border:          #1c1c1c;
  --border-subtle:   #111111;
  --text:            #ffffff;
  --text-secondary:  #aaaaaa;
  --text-dim:        #555555;
  --font-mono:       'JetBrains Mono', monospace;
  --font-sans:       'DM Sans', system-ui, sans-serif;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12px;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

body { display: flex; flex-direction: column; }

/* ===== TOOLBAR ===== */
#toolbar {
  height: 38px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 0;
  z-index: 10;
}

.tb-logo {
  width: 38px; height: 38px;
  background: var(--text);
  display: flex; align-items: center; justify-content: center;
  color: var(--bg);
  font-weight: 700; font-size: 15px; font-family: var(--font-sans);
  flex-shrink: 0;
}

.tb-menu {
  display: flex;
  border-right: 1px solid var(--border);
  padding: 0 2px;
}

.tb-menu-item {
  color: var(--text-dim);
  font-size: 10px;
  padding: 0 8px;
  height: 38px;
  display: flex; align-items: center;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: color 0.1s;
}
.tb-menu-item:hover { color: var(--text-secondary); }

.tb-transport {
  display: flex; align-items: center; gap: 3px;
  padding: 0 10px;
  border-right: 1px solid var(--border);
}

.tb-btn {
  width: 28px; height: 28px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer; font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.1s;
}
.tb-btn:hover { background: var(--bg-hover); color: var(--text); }
.tb-btn.active { background: var(--text); color: var(--bg); }

.tb-bpm {
  width: 68px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  text-align: center; padding: 4px 0;
  font-family: var(--font-mono); font-size: 13px; font-weight: 700;
  border-radius: 3px; margin-left: 6px;
}
.tb-bpm::-webkit-outer-spin-button,
.tb-bpm::-webkit-inner-spin-button { -webkit-appearance: none; }
.tb-bpm { -moz-appearance: textfield; }
.tb-bpm:focus { outline: none; border-color: var(--text-dim); }

.tb-sep { width: 1px; height: 24px; background: var(--border); margin: 0 8px; }

.tb-project { color: var(--text-dim); font-size: 11px; padding: 0 8px; }

.tb-save-indicator { color: var(--text-dim); font-size: 14px; }

.tb-add {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  padding: 4px 10px; border-radius: 3px;
  font-size: 10px; font-family: var(--font-sans); font-weight: 600;
  cursor: pointer; transition: all 0.1s;
}
.tb-add:hover { color: var(--text-secondary); border-color: var(--text-dim); }

.tb-spacer { flex: 1; }

.tb-export {
  background: var(--text); border: none;
  color: var(--bg);
  padding: 5px 14px; border-radius: 3px;
  font-size: 10px; font-weight: 700; font-family: var(--font-sans);
  cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
  margin-right: 10px; transition: background 0.1s;
}
.tb-export:hover { background: var(--text-secondary); }

/* ===== MAIN LAYOUT ===== */
#main {
  flex: 1; display: flex; min-height: 0;
}

/* ===== BROWSER ===== */
#browser {
  width: 160px; flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow-y: auto; display: flex; flex-direction: column;
}

/* ===== CHANNEL RACK ===== */
#channel-rack {
  width: 220px; flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow-y: auto; display: flex; flex-direction: column;
}

/* ===== PLAYLIST ===== */
#playlist {
  flex: 1; background: var(--bg);
  min-width: 0; overflow: hidden; position: relative;
}

#playlist canvas { display: block; width: 100%; height: 100%; }

/* ===== MIXER ===== */
#mixer {
  width: 180px; flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  overflow-x: auto; overflow-y: hidden;
}

/* ===== SHARED PANEL ELEMENTS ===== */
.panel-header {
  height: 28px; flex-shrink: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 10px;
  color: var(--text-dim);
  font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
  font-family: var(--font-mono);
}

/* ===== BROWSER PANEL ===== */
.browser-section { border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px; }

.browser-section-label {
  color: var(--text-dim); font-size: 8px;
  letter-spacing: 1.5px; text-transform: uppercase;
  font-family: var(--font-mono); padding: 8px 10px 4px;
}

.browser-item {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px;
  color: var(--text-dim); font-size: 10px;
  cursor: grab; user-select: none;
  transition: all 0.1s;
}
.browser-item:hover { background: var(--bg-elevated); color: var(--text-secondary); }
.browser-item.dragging { opacity: 0.4; }

.browser-drop-zone {
  margin: 8px;
  border: 1px dashed var(--border);
  border-radius: 3px; padding: 12px 8px;
  text-align: center; color: var(--text-dim); font-size: 9px; line-height: 1.8;
  transition: all 0.1s;
}
.browser-drop-zone.drag-over { border-color: var(--text-dim); color: var(--text-secondary); }

/* ===== CHANNEL RACK ===== */
.rack-rows { flex: 1; }

.rack-row {
  display: flex; align-items: center;
  height: 32px; border-bottom: 1px solid var(--border-subtle);
  padding: 0 8px; gap: 4px;
}
.rack-row:hover { background: var(--bg-elevated); }

.rack-name-btn {
  width: 54px; height: 22px; flex-shrink: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border); border-radius: 2px;
  color: var(--text-secondary); font-size: 8px; font-family: var(--font-mono);
  cursor: pointer; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; padding: 0 4px; text-align: center;
  transition: all 0.1s;
}
.rack-name-btn.active { background: var(--text); color: var(--bg); border-color: var(--text); }

.rack-steps { display: flex; flex: 1; gap: 1px; }

.rack-step {
  flex: 1; height: 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle); border-radius: 1px;
  cursor: pointer; transition: background 0.05s;
}
.rack-step:hover { background: var(--bg-hover); }
.rack-step.on { background: var(--text); border-color: var(--text); }
.rack-step.group-start:not(.on) { background: var(--bg-hover); }

.rack-empty {
  padding: 16px 10px; color: var(--text-dim); font-size: 10px; text-align: center;
}

.rack-add-btn {
  margin: 6px 8px; background: transparent;
  border: 1px dashed var(--border); color: var(--text-dim);
  font-size: 9px; padding: 6px; border-radius: 3px;
  cursor: pointer; text-align: center; width: calc(100% - 16px);
  font-family: var(--font-sans); transition: all 0.1s;
}
.rack-add-btn:hover { color: var(--text-secondary); border-color: var(--text-dim); }

/* ===== MIXER PANEL ===== */
.mixer-strips {
  display: flex; height: 100%;
  padding: 4px; gap: 1px;
}

.mixer-strip {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 32px; padding: 6px 2px;
  border-right: 1px solid var(--border-subtle);
}

.strip-ms { display: flex; gap: 1px; }

.strip-btn {
  width: 15px; height: 13px;
  background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 1px;
  color: var(--text-dim); font-size: 6px; font-family: var(--font-mono); font-weight: 700;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.1s;
}
.strip-btn:hover { color: var(--text-secondary); }
.strip-btn.active { background: var(--text); color: var(--bg); border-color: var(--text); }

.strip-fader-track {
  width: 3px; flex: 1; min-height: 60px;
  background: var(--bg-elevated); border-radius: 2px; position: relative; cursor: pointer;
}

.strip-fader-handle {
  position: absolute; width: 20px; height: 6px;
  background: linear-gradient(180deg, #ddd, #777);
  border-radius: 1px; left: -9px; cursor: grab;
}
.strip-fader-handle:active { cursor: grabbing; }

.strip-db { font-size: 6px; color: var(--text-dim); font-family: var(--font-mono); }

.strip-name {
  font-size: 7px; color: var(--text-dim); font-family: var(--font-mono);
  writing-mode: vertical-rl; text-orientation: mixed; transform: rotate(180deg);
  letter-spacing: 0.5px; white-space: nowrap; overflow: hidden;
  max-height: 55px; text-overflow: ellipsis;
}
.strip-name.master { color: var(--text-secondary); }

/* ===== PIANO ROLL OVERLAY ===== */
#piano-roll-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
#piano-roll-overlay.hidden { display: none; }

.piano-roll-window {
  background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: 4px;
  width: 820px; height: 520px;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.8);
}

.piano-roll-titlebar {
  height: 32px; flex-shrink: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 12px;
  cursor: move; user-select: none;
}
.piano-roll-titlebar span { color: var(--text-secondary); font-size: 11px; flex: 1; font-family: var(--font-mono); }

.piano-roll-close {
  background: none; border: none; color: var(--text-dim);
  cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 6px;
}
.piano-roll-close:hover { color: var(--text); }

.piano-roll-content { flex: 1; position: relative; overflow: hidden; }
.piano-roll-content canvas { width: 100%; height: 100%; }

/* ===== SCROLLBAR ===== */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--bg-elevated); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--bg-hover); }

::selection { background: rgba(255,255,255,0.15); }
```

- [ ] **Step 2: Verify layout in browser**

Open `http://localhost:8000`. Expect: 5 panels visible (toolbar strip across top, 4 columns in body), all dark/black, no old CSS artifacts.

- [ ] **Step 3: Commit**

```bash
git add app/css/style.css
git commit -m "feat: black/white FL Studio CSS theme and layout"
```

---

## Task 3: Port Toolbar

**Files:**
- Modify: `app/js/ui/topbar.js`

- [ ] **Step 1: Rewrite topbar.js**

```js
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
```

- [ ] **Step 2: Verify toolbar renders**

Open `http://localhost:8000`, open a project. Expect: logo B, menu labels, transport buttons, BPM, project name, add buttons, export button — all in the top bar.

- [ ] **Step 3: Commit**

```bash
git add app/js/ui/topbar.js
git commit -m "feat: port toolbar to new FL Studio layout"
```

---

## Task 4: Migrate Mixer to Right Panel

**Files:**
- Modify: `app/js/ui/mixer-panel.js`

- [ ] **Step 1: Update initMixerPanel to target #mixer and use new CSS classes**

Replace the full content of `app/js/ui/mixer-panel.js`:

```js
import { mixer } from '../audio/mixer.js';
import { engine } from '../audio/engine.js';
import { store } from '../state.js';

export function initMixerPanel() {
  const el = document.getElementById('mixer');

  function render() {
    const channels = mixer.channels;
    const names = Object.keys(channels);
    el.innerHTML = `
      <div class="panel-header">Mixer</div>
      <div class="mixer-strips">
        ${['Master', ...names].map((name, i) => {
          const isMaster = i === 0;
          const track = !isMaster ? store.data.tracks[i - 1] : null;
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
        const ch = Object.values(mixer.channels)[idx];
        if (ch) ch.input.gain.setValueAtTime(store.data.tracks[idx].muted ? 0 : store.data.tracks[idx].volume, engine.ctx.currentTime);
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
          const ch = Object.values(mixer.channels)[idx];
          if (ch) ch.input.gain.setValueAtTime(vol, engine.ctx.currentTime);
          store._scheduleSave();
        } else {
          mixer.masterGain.gain.setValueAtTime(vol, engine.ctx.currentTime);
        }
      });
      window.addEventListener('mouseup', () => { dragging = false; });
    });
  }

  store.on('change', render);
  store.on('loaded', render);
  render();
}
```

- [ ] **Step 2: Verify mixer renders in right panel**

Open a project. Expect: vertical mixer strips in the rightmost panel with M/S buttons and faders.

- [ ] **Step 3: Commit**

```bash
git add app/js/ui/mixer-panel.js
git commit -m "feat: migrate mixer to right panel with new styling"
```

---

## Task 5: Update Playlist Colors and Container

**Files:**
- Modify: `app/js/ui/timeline.js`

- [ ] **Step 1: Update color constants and container target at top of timeline.js**

Replace the color constants and `initTimeline` container line (lines 1–14):

```js
import { store } from '../state.js';
import { setupCanvas, drawGrid } from './utils.js';

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
```

- [ ] **Step 2: Update render() to use new color constants**

In the `render()` function inside `initTimeline`, replace all hex color literals with the constants defined above. Key changes:

```js
function render() {
  const { ctx, width, height } = setupCanvas(canvas);
  const tracks = store.data.tracks;
  const arrangement = store.data.arrangement;

  // Background
  ctx.fillStyle = C_BG; ctx.fillRect(0, 0, width, height);

  // Track rows
  for (let i = 0; i < tracks.length; i++) {
    const y = i * TRACK_HEIGHT - scrollY;
    if (y + TRACK_HEIGHT < 0 || y > height) continue;
    ctx.fillStyle = i % 2 === 0 ? C_BG : C_BG_ALT;
    ctx.fillRect(0, y, width, TRACK_HEIGHT);
    // Track header
    ctx.fillStyle = C_HEADER; ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);
    ctx.fillStyle = C_TEXT; ctx.font = '500 10px "DM Sans", system-ui, sans-serif';
    ctx.fillText(tracks[i].name || `Track ${i + 1}`, 10, y + 16);
    ctx.fillStyle = tracks[i].muted ? '#fff' : C_TEXT_DIM;
    ctx.font = '700 8px "JetBrains Mono", monospace';
    ctx.fillText('M', 10, y + 30);
    ctx.fillStyle = tracks[i].soloed ? '#fff' : C_TEXT_DIM;
    ctx.fillText('S', 24, y + 30);
    ctx.strokeStyle = C_BORDER; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, y + TRACK_HEIGHT); ctx.lineTo(width, y + TRACK_HEIGHT); ctx.stroke();
  }

  drawGrid(ctx, width, height, BEAT_WIDTH, TRACK_HEIGHT, C_BORDER, scrollX, scrollY);

  // Bar numbers
  const startBeat = Math.floor(scrollX / BEAT_WIDTH);
  for (let b = startBeat; b < startBeat + Math.ceil(width / BEAT_WIDTH) + 1; b++) {
    const x = HEADER_WIDTH + b * BEAT_WIDTH - scrollX;
    if (b % 4 === 0) {
      ctx.fillStyle = C_TEXT_DIM; ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.fillText(`${Math.floor(b / 4) + 1}`, x + 3, 11);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
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

    ctx.fillStyle = C_CLIP; ctx.globalAlpha = 1;
    ctx.fillRect(clippedX, y + 3, clippedW - 1, TRACK_HEIGHT - 6);
    // Left stripe
    ctx.fillStyle = clip.trackIndex === store.selectedTrack ? '#fff' : '#333';
    ctx.fillRect(clippedX, y + 3, 2, TRACK_HEIGHT - 6);
    // Label
    ctx.fillStyle = clip.trackIndex === store.selectedTrack ? '#fff' : C_TEXT;
    ctx.font = '500 9px "DM Sans", system-ui, sans-serif';
    ctx.fillText(clip.patternName || `P${clip.patternIndex}`, clippedX + 8, y + 16);
    // Border
    ctx.strokeStyle = clip.trackIndex === store.selectedTrack ? '#333' : C_CLIP_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(clippedX, y + 3, clippedW - 1, TRACK_HEIGHT - 6);
  }

  // Loop marker
  const loopLen = _getLoopLen();
  const loopX = HEADER_WIDTH + loopLen * BEAT_WIDTH - scrollX;
  ctx.strokeStyle = C_LOOP; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(loopX, 16); ctx.lineTo(loopX, height); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(loopX - 14, 1, 28, 13, 2); ctx.fill();
  ctx.fillStyle = '#000'; ctx.font = '700 7px "JetBrains Mono", monospace';
  const lw = ctx.measureText('LOOP').width;
  ctx.fillText('LOOP', loopX - lw / 2, 10);

  // Playhead
  if (store.playing) {
    const beatPos = store.currentBeat / 4;
    const px = HEADER_WIDTH + beatPos * BEAT_WIDTH - scrollX;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
    ctx.strokeStyle = C_PLAYHEAD; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
    ctx.fillStyle = C_PLAYHEAD;
    ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 7); ctx.fill();
  }

  // Header divider
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(HEADER_WIDTH, 0); ctx.lineTo(HEADER_WIDTH, height); ctx.stroke();
}
```

- [ ] **Step 3: Verify playlist renders correctly**

Open a project with tracks. Expect: playlist fills the center, dark/black theme, clips visible with white text.

- [ ] **Step 4: Commit**

```bash
git add app/js/ui/timeline.js
git commit -m "feat: playlist black/white colors, new container and sizing"
```

---

## Task 6: Channel Rack (HTML-Based Step Grid)

**Files:**
- Modify: `app/js/ui/step-sequencer.js`

The channel rack replaces the old canvas step sequencer. It uses HTML buttons so steps are directly interactive without canvas hit-testing. The old `initStepSequencer` export is replaced by `initChannelRack`.

- [ ] **Step 1: Rewrite step-sequencer.js**

```js
import { store } from '../state.js';

export function initChannelRack(container) {
  function getPattern() {
    if (store.selectedPattern == null) return null;
    return store.data.patterns[store.selectedPattern] || null;
  }

  function render() {
    const pattern = getPattern();
    container.innerHTML = '<div class="panel-header">Channel Rack</div>';

    if (!pattern || !pattern.steps) {
      container.innerHTML += '<div class="rack-empty">No drum pattern selected.<br>Click "+ Drums" to add one.</div>';
      return;
    }

    const rowsEl = document.createElement('div');
    rowsEl.className = 'rack-rows';
    const stepCount = pattern.stepCount || 16;

    pattern.steps.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'rack-row';

      const nameBtn = document.createElement('button');
      nameBtn.className = 'rack-name-btn';
      nameBtn.textContent = row.name || `Row ${rowIdx + 1}`;
      rowEl.appendChild(nameBtn);

      const stepsEl = document.createElement('div');
      stepsEl.className = 'rack-steps';

      for (let s = 0; s < stepCount; s++) {
        const stepEl = document.createElement('div');
        let cls = 'rack-step';
        if (row.cells[s]) cls += ' on';
        if (s % 4 === 0 && !row.cells[s]) cls += ' group-start';
        stepEl.className = cls;

        stepEl.addEventListener('mousedown', (e) => {
          e.preventDefault();
          row.cells[s] = !row.cells[s];
          if (!row.velocities) row.velocities = new Array(stepCount).fill(100);
          store.emit('change', { path: 'patterns' });
          store._scheduleSave();
          // Toggle class directly without full re-render for responsiveness
          stepEl.className = 'rack-step' + (row.cells[s] ? ' on' : (s % 4 === 0 ? ' group-start' : ''));
        });

        stepsEl.appendChild(stepEl);
      }

      rowEl.appendChild(stepsEl);
      rowsEl.appendChild(rowEl);
    });

    container.appendChild(rowsEl);

    const addBtn = document.createElement('button');
    addBtn.className = 'rack-add-btn';
    addBtn.textContent = '+ Add row';
    addBtn.addEventListener('click', () => {
      if (!pattern || !pattern.steps) return;
      const stepCount = pattern.stepCount || 16;
      pattern.steps.push({
        name: `Row ${pattern.steps.length + 1}`,
        sampleRef: null,
        cells: new Array(stepCount).fill(false),
        velocities: new Array(stepCount).fill(100),
      });
      store.emit('change', { path: 'patterns' });
      store._scheduleSave();
      render();
    });
    container.appendChild(addBtn);
  }

  store.on('patternSelected', render);
  store.on('loaded', render);
  render();
}
```

- [ ] **Step 2: Update main.js to use initChannelRack**

In `app/js/main.js`, replace the import and call for `initStepSequencer` / `initPianoRoll` with `initChannelRack`:

```js
// Change this import:
import { initStepSequencer } from './ui/step-sequencer.js';
// To:
import { initChannelRack } from './ui/step-sequencer.js';

// In init(), replace initPianoRoll / initStepSequencer calls with:
initChannelRack(document.getElementById('channel-rack'));
```

Also remove the `store.on('editorTabChange', ...)` block — tabs no longer exist.

- [ ] **Step 3: Verify channel rack**

Add a drum track. Expect: channel rack panel shows rows (Kick, Snare, HH Closed, HH Open) with 16 step buttons each. Clicking a step toggles it white/dark.

- [ ] **Step 4: Commit**

```bash
git add app/js/ui/step-sequencer.js app/js/main.js
git commit -m "feat: channel rack replaces bottom step sequencer panel"
```

---

## Task 7: Browser Panel Scaffold

**Files:**
- Create: `app/js/ui/browser.js`
- Modify: `app/js/main.js`

- [ ] **Step 1: Create browser.js (static scaffold, no upload yet)**

```js
import { store } from '../state.js';

export function initBrowser(container) {
  function render() {
    const audioFiles = store.audioFiles || [];
    container.innerHTML = `
      <div class="panel-header">Browser</div>
      <div class="browser-section">
        <div class="browser-section-label">Audio</div>
        ${audioFiles.length === 0
          ? '<div style="padding:6px 10px 8px;color:var(--text-dim);font-size:9px;">No audio files yet</div>'
          : audioFiles.map(f => `
              <div class="browser-item" draggable="true" data-ref="${f}">
                <span>♪</span>
                <span>${f}</span>
              </div>`).join('')}
      </div>
      <div class="browser-section">
        <div class="browser-section-label">Samples</div>
        <div style="padding:6px 10px;color:var(--text-dim);font-size:9px;">Kit samples built-in</div>
      </div>
      <div class="browser-drop-zone" id="browser-drop-zone">
        Drop MP3 / WAV<br>here to import
      </div>
    `;

    container.querySelectorAll('.browser-item[data-ref]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/m8s-audio-ref', el.dataset.ref);
        e.dataTransfer.effectAllowed = 'copy';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });

    const dropZone = container.querySelector('#browser-drop-zone');
    dropZone.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      }
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files)
        .filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac)$/i.test(f.name));
      for (const file of files) store.emit('uploadAudioFile', file);
    });
  }

  store.on('loaded', render);
  store.on('audioFilesChanged', render);
  render();
}
```

- [ ] **Step 2: Wire initBrowser in main.js**

Add to imports in `app/js/main.js`:
```js
import { initBrowser } from './ui/browser.js';
```

In `init()`, add:
```js
initBrowser(document.getElementById('browser'));
```

- [ ] **Step 3: Verify browser panel renders**

Expect: browser panel shows "Audio" section (empty), "Samples" section, and a drop zone.

- [ ] **Step 4: Commit**

```bash
git add app/js/ui/browser.js app/js/main.js
git commit -m "feat: browser panel scaffold with drag-start support"
```

---

## Task 8: Server Audio Endpoints

**Files:**
- Modify: `server/routes.py`
- Modify: `server/test_routes.py`

- [ ] **Step 1: Write failing tests first**

Add to the end of `server/test_routes.py`:

```python
@pytest.mark.asyncio
async def test_create_project_creates_audio_dir(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    assert (projects_dir / "my-beat" / "audio").is_dir()


@pytest.mark.asyncio
async def test_upload_audio(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    files = {"file": ("vocals.mp3", b"fake mp3 data", "audio/mpeg")}
    resp = await client.post("/api/projects/my-beat/audio", files=files)
    assert resp.status_code == 201
    assert resp.json()["filename"] == "vocals.mp3"
    assert (projects_dir / "my-beat" / "audio" / "vocals.mp3").exists()


@pytest.mark.asyncio
async def test_list_audio(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    (projects_dir / "my-beat" / "audio" / "vocals.mp3").write_bytes(b"fake")
    (projects_dir / "my-beat" / "audio" / "beat.wav").write_bytes(b"fake")
    resp = await client.get("/api/projects/my-beat/audio")
    assert resp.status_code == 200
    names = resp.json()
    assert "vocals.mp3" in names
    assert "beat.wav" in names


@pytest.mark.asyncio
async def test_get_audio_file(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    (projects_dir / "my-beat" / "audio" / "vocals.mp3").write_bytes(b"fake mp3")
    resp = await client.get("/api/projects/my-beat/audio/vocals.mp3")
    assert resp.status_code == 200
    assert resp.content == b"fake mp3"


@pytest.mark.asyncio
async def test_get_audio_file_not_found(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.get("/api/projects/my-beat/audio/nope.mp3")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest server/test_routes.py::test_create_project_creates_audio_dir server/test_routes.py::test_upload_audio server/test_routes.py::test_list_audio server/test_routes.py::test_get_audio_file server/test_routes.py::test_get_audio_file_not_found -v
```

Expected: all 5 FAIL.

- [ ] **Step 3: Add audio endpoints to routes.py**

In `create_project`, add `(project_dir / "audio").mkdir()` after the `samples` mkdir:

```python
@router.post("/projects", status_code=201)
def create_project(body: CreateProject):
    _ensure_projects_dir()
    project_dir = PROJECTS_DIR / body.name
    if project_dir.exists():
        raise HTTPException(400, "Project already exists")
    project_dir.mkdir()
    (project_dir / "samples").mkdir()
    (project_dir / "audio").mkdir()
    (project_dir / "project.json").write_text(json.dumps(DEFAULT_PROJECT, indent=2))
    return {"name": body.name}
```

Then add three new routes after the existing `get_sample` route:

```python
@router.post("/projects/{name}/audio", status_code=201)
async def upload_audio(name: str, file: UploadFile = File(...)):
    audio_dir = PROJECTS_DIR / name / "audio"
    if not audio_dir.exists():
        raise HTTPException(404, "Project not found")
    dest = audio_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"filename": file.filename}


@router.get("/projects/{name}/audio")
def list_audio(name: str):
    audio_dir = PROJECTS_DIR / name / "audio"
    if not audio_dir.exists():
        raise HTTPException(404, "Project not found")
    return [
        f.name for f in sorted(audio_dir.iterdir())
        if f.suffix.lower() in (".mp3", ".wav", ".ogg", ".flac")
    ]


@router.get("/projects/{name}/audio/{filename}")
def get_audio_file(name: str, filename: str):
    audio_path = PROJECTS_DIR / name / "audio" / filename
    if not audio_path.exists():
        raise HTTPException(404, "Audio file not found")
    suffix = audio_path.suffix.lower()
    media_type = {"mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac"}.get(suffix, "audio/mpeg")
    return FileResponse(audio_path, media_type=media_type)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest server/test_routes.py::test_create_project_creates_audio_dir server/test_routes.py::test_upload_audio server/test_routes.py::test_list_audio server/test_routes.py::test_get_audio_file server/test_routes.py::test_get_audio_file_not_found -v
```

Expected: all 5 PASS.

- [ ] **Step 5: Run full test suite to verify nothing regressed**

```bash
uv run pytest server/test_routes.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes.py server/test_routes.py
git commit -m "feat: audio file upload/list/serve endpoints with tests"
```

---

## Task 9: API Client + State Changes

**Files:**
- Modify: `app/js/api.js`
- Modify: `app/js/state.js`

- [ ] **Step 1: Add audio methods to api.js**

Add after `exportMp3`:

```js
async uploadAudio(projectName, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/audio`, {
    method: 'POST',
    body: form,
  });
  return res.json(); // { filename }
},
async listAudio(projectName) {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/audio`);
  return res.json(); // string[]
},
audioUrl(projectName, filename) {
  return `${BASE}/projects/${encodeURIComponent(projectName)}/audio/${encodeURIComponent(filename)}`;
},
```

- [ ] **Step 2: Add audioFiles field to state.js**

In the `StateStore` constructor, add `this.audioFiles = [];` after `this.data = { ... }`.

- [ ] **Step 3: Commit**

```bash
git add app/js/api.js app/js/state.js
git commit -m "feat: audio API methods and audioFiles state field"
```

---

## Task 10: Browser Panel — Audio File List + Upload

**Files:**
- Modify: `app/js/ui/browser.js`
- Modify: `app/js/main.js`

- [ ] **Step 1: Wire upload and list in browser.js**

Add imports at the top of `app/js/ui/browser.js`:

```js
import { api } from '../api.js';
import { store } from '../state.js';
```

Add `refreshAudioFiles` and wire it to `store.on('loaded', ...)` and drop events. Replace the full file with:

```js
import { store } from '../state.js';
import { api } from '../api.js';

export function initBrowser(container) {
  function render() {
    const audioFiles = store.audioFiles || [];
    container.innerHTML = `
      <div class="panel-header">Browser</div>
      <div class="browser-section">
        <div class="browser-section-label">Audio</div>
        ${audioFiles.length === 0
          ? '<div style="padding:6px 10px 8px;color:var(--text-dim);font-size:9px;">No audio files yet</div>'
          : audioFiles.map(f => `
              <div class="browser-item" draggable="true" data-ref="${f}">
                <span>♪</span><span>${f}</span>
              </div>`).join('')}
      </div>
      <div class="browser-section">
        <div class="browser-section-label">Samples</div>
        <div style="padding:6px 10px;color:var(--text-dim);font-size:9px;">Kit samples built-in</div>
      </div>
      <div class="browser-drop-zone" id="browser-drop-zone">
        Drop MP3 / WAV<br>here to import
      </div>
    `;

    container.querySelectorAll('.browser-item[data-ref]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/m8s-audio-ref', el.dataset.ref);
        e.dataTransfer.effectAllowed = 'copy';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });

    const dropZone = container.querySelector('#browser-drop-zone');
    dropZone.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault(); dropZone.classList.add('drag-over');
      }
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files)
        .filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac)$/i.test(f.name));
      for (const file of files) await api.uploadAudio(store.projectName, file);
      await refreshAudioFiles();
    });
  }

  async function refreshAudioFiles() {
    if (!store.projectName) return;
    store.audioFiles = await api.listAudio(store.projectName);
    render();
  }

  store.on('loaded', refreshAudioFiles);
  store.on('audioFilesChanged', render);
  render();
}
```

- [ ] **Step 2: Wire uploadAudioFile event in main.js**

In `app/js/main.js`, inside `init()`, add:

```js
store.on('uploadAndCreateAudioTrack', async (file) => {
  await api.uploadAudio(store.projectName, file);
  store.audioFiles = await api.listAudio(store.projectName);
  store.emit('audioFilesChanged');
  store.emit('createAudioTrack', file.name);
});
```

- [ ] **Step 3: Verify**

Drop an MP3 onto the browser drop zone. Expect: file appears in the Audio section list.

- [ ] **Step 4: Commit**

```bash
git add app/js/ui/browser.js app/js/main.js
git commit -m "feat: browser panel audio file upload and listing"
```

---

## Task 11: Waveform Decode + Render

**Files:**
- Create: `app/js/audio/waveform.js`
- Modify: `app/js/ui/timeline.js`

- [ ] **Step 1: Create waveform.js**

```js
const _cache = new Map(); // url -> { points: Float32Array, audioBuf: AudioBuffer }

export async function loadWaveform(url, audioCtx) {
  if (_cache.has(url)) return _cache.get(url);
  const resp = await fetch(url);
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  const points = _downsample(audioBuf, 500);
  const entry = { points, audioBuf };
  _cache.set(url, entry);
  return entry;
}

export function getCached(url) {
  return _cache.get(url) || null;
}

export function clearCache() { _cache.clear(); }

function _downsample(audioBuffer, numPoints) {
  const data = audioBuffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / numPoints));
  const points = new Float32Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    let peak = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, data.length);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    points[i] = peak;
  }
  return points;
}
```

- [ ] **Step 2: Add audio clip rendering in timeline.js**

Add import at top of `app/js/ui/timeline.js`:

```js
import { getCached } from '../audio/waveform.js';
import { api } from '../api.js';
```

In the Clips section of `render()`, replace the existing clip loop with a version that branches on `clip.type`:

```js
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
```

Add helper functions after `render()` (before the event listeners):

```js
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
  // Body
  ctx.fillStyle = '#161616';
  ctx.fillRect(cx, y + 3, cw - 1, TRACK_HEIGHT - 6);
  // Left stripe
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(cx, y + 3, 2, TRACK_HEIGHT - 6);
  // Waveform
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
  // Filename label
  ctx.fillStyle = '#777';
  ctx.font = '500 8px "DM Sans", system-ui, sans-serif';
  ctx.save();
  ctx.beginPath(); ctx.rect(cx + 4, y + 3, cw - 8, TRACK_HEIGHT - 6); ctx.clip();
  ctx.fillText(clip.audioRef, cx + 5, y + 13);
  ctx.restore();
  // Border
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
  ctx.strokeRect(cx, y + 3, cw - 1, TRACK_HEIGHT - 6);
}
```

- [ ] **Step 3: Preload waveforms on project load in main.js**

In the `loadProject` function in `app/js/main.js`, add after `await sampler.preloadProject()`:

```js
import { loadWaveform } from './audio/waveform.js';

// Inside loadProject:
store.audioFiles = await api.listAudio(name);
for (const clip of data.arrangement) {
  if (clip.type === 'audio' && clip.audioRef) {
    const url = api.audioUrl(name, clip.audioRef);
    loadWaveform(url, engine.ctx).then(() => store.emit('change', {}));
  }
}
```

- [ ] **Step 4: Verify waveform rendering**

Upload an MP3 and place it on the playlist (manually via state, or wait for Task 12). Expect: audio clip shows a white waveform on a dark grey body.

- [ ] **Step 5: Commit**

```bash
git add app/js/audio/waveform.js app/js/ui/timeline.js app/js/main.js
git commit -m "feat: waveform decode/cache and audio clip rendering in playlist"
```

---

## Task 12: Drag Audio File onto Playlist

**Files:**
- Modify: `app/js/ui/timeline.js`
- Modify: `app/js/main.js`

Audio clips are created by dragging from the browser panel or directly from the OS onto the playlist canvas.

- [ ] **Step 1: Add drop handler to timeline.js**

In `initTimeline()`, after the canvas is created, add:

```js
import { loadWaveform } from '../audio/waveform.js';
import { mixer } from '../audio/mixer.js';

// Inside initTimeline(), after canvas setup:
const playlistEl = document.getElementById('playlist');

playlistEl.addEventListener('dragover', (e) => {
  const hasBrowserRef = e.dataTransfer.types.includes('text/m8s-audio-ref');
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

  const audioRef = e.dataTransfer.getData('text/m8s-audio-ref');
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
  const secondsPerBeat = engine._secondsPerBeat();
  const durationBeats = Math.ceil(audioBuf.duration / secondsPerBeat);

  store.data.arrangement.push({
    type: 'audio', trackIndex: trackIdx,
    audioRef, startBeat, lengthBeats: durationBeats, offset: 0,
  });
  store.emit('change', { path: 'arrangement' });
  store._scheduleSave();
}
```

Also add `import { engine } from '../audio/engine.js';` to timeline.js imports if not already present.

- [ ] **Step 2: Wire createAudioTrack event in main.js**

In `app/js/main.js`, in the `uploadAndCreateAudioTrack` handler added in Task 10, after uploading, emit `audioFilesChanged` then call a route to timeline:

The timeline's `_createAudioTrack` is self-contained, so for the `+ Audio` button in the toolbar, we need to emit an event the timeline picks up. Replace the `uploadAndCreateAudioTrack` handler in main.js with:

```js
store.on('uploadAndCreateAudioTrack', async (file) => {
  const result = await api.uploadAudio(store.projectName, file);
  store.audioFiles = await api.listAudio(store.projectName);
  store.emit('audioFilesChanged');
  store.emit('createAudioTrackFromRef', { audioRef: result.filename, startBeat: 0 });
});
```

In `initTimeline()`, add a listener for this event:

```js
store.on('createAudioTrackFromRef', async ({ audioRef, startBeat }) => {
  await _createAudioTrack(audioRef, startBeat);
});
```

- [ ] **Step 3: Verify drag to create audio track**

Drag an MP3 from the browser panel onto the playlist. Expect: new track row appears with an audio clip showing the waveform.

- [ ] **Step 4: Commit**

```bash
git add app/js/ui/timeline.js app/js/main.js
git commit -m "feat: drag audio from browser or OS onto playlist creates audio track"
```

---

## Task 13: Audio Clip Playback

**Files:**
- Modify: `app/js/main.js`

Audio clips are scheduled when the playhead reaches their `startBeat`. On stop, all active audio sources are stopped.

- [ ] **Step 1: Add audio clip scheduling in main.js**

In `app/js/main.js`, inside the `store.on('beat', ...)` handler, add after the existing drum/synth scheduling block:

```js
// Schedule audio clips that start on this beat
for (const clip of store.data.arrangement) {
  if (clip.type !== 'audio') continue;
  const track = store.data.tracks[clip.trackIndex];
  if (!track || track.muted) continue;
  const clipStartStep = clip.startBeat * 4;
  if (beat !== clipStartStep) continue;
  const channel = mixer.channels[track.name];
  if (!channel) continue;
  const url = api.audioUrl(store.projectName, clip.audioRef);
  const cached = getCached(url);
  if (!cached || !cached.audioBuf) continue;
  const source = engine.ctx.createBufferSource();
  source.buffer = cached.audioBuf;
  source.connect(channel.input);
  source.start(time, clip.offset || 0);
  const durationSecs = clip.lengthBeats * engine._secondsPerBeat();
  source.stop(time + durationSecs);
  _activeAudioSources.push(source);
  source.onended = () => {
    const idx = _activeAudioSources.indexOf(source);
    if (idx !== -1) _activeAudioSources.splice(idx, 1);
  };
}
```

- [ ] **Step 2: Add _activeAudioSources and stop handler**

At the top of the `init()` function in main.js, add:

```js
const _activeAudioSources = [];
```

Then add a transport stop handler:

```js
store.on('transport', (evt) => {
  if (evt === 'stop') {
    for (const src of _activeAudioSources) {
      try { src.stop(); } catch (_) {}
    }
    _activeAudioSources.length = 0;
  }
});
```

- [ ] **Step 3: Import getCached**

At the top of `app/js/main.js`, add:

```js
import { getCached } from './audio/waveform.js';
```

- [ ] **Step 4: Verify audio playback**

Drop a vocal MP3 and a beat MP3 onto the playlist. Press play. Expect: both audio files play back together from their respective start positions.

- [ ] **Step 5: Commit**

```bash
git add app/js/main.js
git commit -m "feat: audio clip playback scheduled via beat events"
```

---

## Task 14: Piano Roll Floating Overlay

**Files:**
- Modify: `app/js/ui/piano-roll.js`
- Modify: `app/js/main.js`

The piano roll is no longer in the bottom panel. It opens as a floating overlay when a synth pattern clip is double-clicked, and closes via X or Escape.

- [ ] **Step 1: Strip tab chrome from piano-roll.js**

In `app/js/ui/piano-roll.js`, replace the `container.innerHTML` setup block (currently lines 7–14 which set up the editor tabs) with:

```js
export function initPianoRoll(container) {
  container.innerHTML = `<canvas id="piano-roll-canvas"></canvas>`;
  const canvas = document.getElementById('piano-roll-canvas');
  canvas.style.width = '100%'; canvas.style.height = '100%';
  // ... rest of the function unchanged
```

(Remove the `.editor-tabs` div and `data-tab` buttons — the rest of the piano roll logic stays exactly the same.)

- [ ] **Step 2: Set up piano roll overlay in main.js**

In `init()` in `app/js/main.js`, after `initBrowser(...)`, add:

```js
// Piano roll overlay setup
const overlay = document.getElementById('piano-roll-overlay');
overlay.innerHTML = `
  <div class="piano-roll-window">
    <div class="piano-roll-titlebar">
      <span id="piano-roll-title">Piano Roll</span>
      <button class="piano-roll-close">✕</button>
    </div>
    <div class="piano-roll-content"></div>
  </div>
`;
const prContent = overlay.querySelector('.piano-roll-content');
const prTitle = overlay.querySelector('#piano-roll-title');

function openPianoRoll(patternIdx) {
  store.selectedPattern = patternIdx;
  const pattern = store.data.patterns[patternIdx];
  prTitle.textContent = pattern ? `Piano Roll — ${pattern.name}` : 'Piano Roll';
  overlay.classList.remove('hidden');
  initPianoRoll(prContent);
}

function closePianoRoll() {
  overlay.classList.add('hidden');
}

overlay.querySelector('.piano-roll-close').addEventListener('click', closePianoRoll);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePianoRoll(); });

// Draggable title bar
const titlebar = overlay.querySelector('.piano-roll-titlebar');
let dragState = null;
titlebar.addEventListener('mousedown', (e) => {
  const win = overlay.querySelector('.piano-roll-window');
  const rect = win.getBoundingClientRect();
  dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
  win.style.position = 'fixed';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const win = overlay.querySelector('.piano-roll-window');
  win.style.left = (dragState.origLeft + e.clientX - dragState.startX) + 'px';
  win.style.top  = (dragState.origTop  + e.clientY - dragState.startY) + 'px';
});
window.addEventListener('mouseup', () => { dragState = null; });

store.on('openPianoRoll', openPianoRoll);
```

- [ ] **Step 3: Emit openPianoRoll from timeline on double-click**

In `app/js/ui/timeline.js`, in the `dblclick` handler, replace the existing body:

```js
canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const hit = clipAt(mx, my);
  if (!hit) return;
  const pattern = store.data.patterns[hit.clip.patternIndex];
  if (pattern && pattern.type === 'notes') {
    store.emit('openPianoRoll', hit.clip.patternIndex);
  }
});
```

- [ ] **Step 4: Add initPianoRoll import to main.js**

```js
import { initPianoRoll } from './ui/piano-roll.js';
```

- [ ] **Step 5: Verify piano roll overlay**

Add a synth track, double-click its clip in the playlist. Expect: dark overlay appears with the piano roll, title shows the pattern name, Escape or X dismisses it.

- [ ] **Step 6: Commit**

```bash
git add app/js/ui/piano-roll.js app/js/main.js app/js/ui/timeline.js
git commit -m "feat: piano roll as floating overlay, opens on double-click synth clip"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| FL Studio 5-panel layout | Tasks 1–2 |
| Black & white color scheme | Task 2 |
| Toolbar with + Audio, + Drums, + Synth, Export | Task 3 |
| Browser panel with audio file list | Tasks 7, 10 |
| Browser drop zone for OS file upload | Task 10 |
| Channel rack (step sequencer moved) | Task 6 |
| Playlist center dominant view | Tasks 1–2 |
| Audio clip track type | Tasks 9, 12 |
| Waveform rendering on audio clips | Task 11 |
| Drag from browser to playlist | Task 12 |
| Drag from OS to playlist | Task 12 |
| Audio playback | Task 13 |
| Mixer right panel | Task 4 |
| Piano roll floating overlay | Task 14 |
| Piano roll draggable | Task 14 |
| Server audio upload/list/serve endpoints | Task 8 |
| Server tests | Task 8 |

**Type consistency check:** `_createAudioTrack(audioRef, startBeat)` is defined in Task 12 and called in Tasks 12 and 13. `getCached(url)` is defined in Task 11 and used in Tasks 11 and 13. `loadWaveform(url, audioCtx)` returns `{ points, audioBuf }` — used consistently in Tasks 11, 12, 13. `store.audioFiles` is a `string[]` set in Tasks 9, 10 and read in Task 7.

**Placeholder scan:** No TBDs. All code blocks are complete.
