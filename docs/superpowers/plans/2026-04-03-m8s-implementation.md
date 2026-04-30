# M8S Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based lite DAW for hip-hop/trap production with a Python companion server for file I/O.

**Architecture:** Three layers — Python FastAPI server for project file management, Web Audio API engine for all audio processing, and Vanilla JS + Canvas UI. The UI state store is the single source of truth at runtime, syncing to disk via the server.

**Tech Stack:** Vanilla JS (ES modules), Web Audio API, Canvas, Python FastAPI, ffmpeg

---

## File Structure

### Server (`server/`)
- `server/main.py` — FastAPI app, CORS, static file serving, app startup
- `server/routes.py` — all API route handlers
- `server/test_routes.py` — API endpoint tests

### Frontend (`app/`)
- `app/index.html` — single HTML page, loads all modules
- `app/css/style.css` — all styles (layout, panels, controls, dark theme)
- `app/js/state.js` — central state store with event emitter
- `app/js/audio/engine.js` — audio context, master bus, transport, scheduling
- `app/js/audio/synth.js` — subtractive synth (simple + advanced modes)
- `app/js/audio/sampler.js` — sample loading and playback
- `app/js/audio/effects.js` — EQ, distortion, delay, reverb per track
- `app/js/audio/mixer.js` — per-track gain/pan, master bus, metering
- `app/js/audio/export.js` — offline render to WAV, upload to server
- `app/js/ui/topbar.js` — transport controls, BPM, project name, save indicator
- `app/js/ui/timeline.js` — Canvas arrangement view
- `app/js/ui/piano-roll.js` — Canvas piano roll editor
- `app/js/ui/step-sequencer.js` — step sequencer grid
- `app/js/ui/mixer-panel.js` — mixer faders, knobs, effect toggles
- `app/js/ui/utils.js` — shared Canvas helpers (grid drawing, snapping)
- `app/js/api.js` — fetch wrapper for companion server

### Starter Kit (`kit/`)
- `kit/` — directory of bundled .wav sample files

---

### Task 1: Project Scaffolding & Server Skeleton

**Files:**
- Create: `server/main.py`
- Create: `server/routes.py`
- Create: `server/test_routes.py`
- Create: `server/requirements.txt`
- Create: `app/index.html`
- Create: `app/css/style.css`

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.115.0
uvicorn==0.30.0
python-multipart==0.0.9
httpx==0.27.0
pytest==8.3.0
```

- [ ] **Step 2: Create server skeleton**

`server/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from routes import router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Serve frontend static files
app.mount("/", StaticFiles(directory=str(Path(__file__).parent.parent / "app"), html=True), name="static")
```

`server/routes.py`:
```python
from fastapi import APIRouter

router = APIRouter()
```

- [ ] **Step 3: Create minimal index.html**

`app/index.html`:
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
  <div id="topbar"></div>
  <div id="timeline"></div>
  <div id="bottom">
    <div id="editor"></div>
    <div id="mixer"></div>
  </div>
  <script type="module" src="/js/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create base CSS with dark theme and Ableton-style layout**

`app/css/style.css`:
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-panel: #0f3460;
  --accent: #e94560;
  --text-primary: #e0e0e0;
  --text-secondary: #7ec8e3;
  --border: #2b2d42;
}

html, body {
  height: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  overflow: hidden;
}

#topbar {
  height: 48px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
}

#timeline {
  flex: 1;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  position: relative;
}

#bottom {
  height: 280px;
  display: flex;
  border-top: 1px solid var(--border);
}

#editor {
  flex: 1;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
  position: relative;
}

#mixer {
  width: 280px;
  background: var(--bg-panel);
  overflow-x: auto;
  padding: 8px;
}

body {
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 5: Write server test — verify static files served**

`server/test_routes.py`:
```python
import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_index_served(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    assert "M8S" in resp.text
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd server && pip install -r requirements.txt && python -m pytest test_routes.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/ app/
git commit -m "feat: project scaffolding — server skeleton and base HTML/CSS"
```

---

### Task 2: Project CRUD API

**Files:**
- Modify: `server/routes.py`
- Modify: `server/main.py`
- Modify: `server/test_routes.py`

- [ ] **Step 1: Write failing tests for project endpoints**

Append to `server/test_routes.py`:
```python
import json
from pathlib import Path
import tempfile


@pytest.fixture
def projects_dir(tmp_path):
    """Create a temp directory for projects and patch the app."""
    import routes
    original = routes.PROJECTS_DIR
    routes.PROJECTS_DIR = tmp_path
    yield tmp_path
    routes.PROJECTS_DIR = original


@pytest.mark.asyncio
async def test_list_projects_empty(client, projects_dir):
    resp = await client.get("/api/projects")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_project(client, projects_dir):
    resp = await client.post("/api/projects", json={"name": "my-beat"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "my-beat"
    assert (projects_dir / "my-beat" / "project.json").exists()
    assert (projects_dir / "my-beat" / "samples").is_dir()


@pytest.mark.asyncio
async def test_list_projects_after_create(client, projects_dir):
    await client.post("/api/projects", json={"name": "beat-1"})
    await client.post("/api/projects", json={"name": "beat-2"})
    resp = await client.get("/api/projects")
    names = resp.json()
    assert "beat-1" in names
    assert "beat-2" in names


@pytest.mark.asyncio
async def test_get_project(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.get("/api/projects/my-beat")
    assert resp.status_code == 200
    data = resp.json()
    assert data["bpm"] == 140
    assert data["tracks"] == []


@pytest.mark.asyncio
async def test_update_project(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    update = {"bpm": 160, "timeSignature": "3/4", "tracks": []}
    resp = await client.put("/api/projects/my-beat", json=update)
    assert resp.status_code == 200
    resp2 = await client.get("/api/projects/my-beat")
    assert resp2.json()["bpm"] == 160


@pytest.mark.asyncio
async def test_get_nonexistent_project(client, projects_dir):
    resp = await client.get("/api/projects/nope")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && python -m pytest test_routes.py -v`
Expected: FAIL — routes not implemented

- [ ] **Step 3: Implement project routes**

`server/routes.py`:
```python
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api")

PROJECTS_DIR = Path.home() / "m8s-projects"


def _ensure_projects_dir():
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


DEFAULT_PROJECT = {
    "bpm": 140,
    "timeSignature": "4/4",
    "tracks": [],
    "patterns": [],
    "arrangement": [],
}


class CreateProject(BaseModel):
    name: str


@router.get("/projects")
def list_projects():
    _ensure_projects_dir()
    return [
        d.name for d in sorted(PROJECTS_DIR.iterdir())
        if d.is_dir() and (d / "project.json").exists()
    ]


@router.post("/projects", status_code=201)
def create_project(body: CreateProject):
    _ensure_projects_dir()
    project_dir = PROJECTS_DIR / body.name
    if project_dir.exists():
        raise HTTPException(400, "Project already exists")
    project_dir.mkdir()
    (project_dir / "samples").mkdir()
    (project_dir / "project.json").write_text(json.dumps(DEFAULT_PROJECT, indent=2))
    return {"name": body.name}


@router.get("/projects/{name}")
def get_project(name: str):
    project_file = PROJECTS_DIR / name / "project.json"
    if not project_file.exists():
        raise HTTPException(404, "Project not found")
    return json.loads(project_file.read_text())


@router.put("/projects/{name}")
def update_project(name: str, body: dict):
    project_file = PROJECTS_DIR / name / "project.json"
    if not project_file.exists():
        raise HTTPException(404, "Project not found")
    project_file.write_text(json.dumps(body, indent=2))
    return {"status": "saved"}
```

- [ ] **Step 4: Update main.py to mount API before static files**

`server/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from routes import router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

app.mount("/", StaticFiles(directory=str(Path(__file__).parent.parent / "app"), html=True), name="static")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && python -m pytest test_routes.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat: project CRUD API — list, create, get, update projects"
```

---

### Task 3: Sample Upload & Serving API

**Files:**
- Modify: `server/routes.py`
- Modify: `server/test_routes.py`

- [ ] **Step 1: Write failing tests for sample endpoints**

Append to `server/test_routes.py`:
```python
@pytest.mark.asyncio
async def test_upload_sample(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    files = {"file": ("kick.wav", b"RIFF fake wav data", "audio/wav")}
    resp = await client.post("/api/projects/my-beat/samples", files=files)
    assert resp.status_code == 201
    assert (projects_dir / "my-beat" / "samples" / "kick.wav").exists()


@pytest.mark.asyncio
async def test_get_sample(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    sample_path = projects_dir / "my-beat" / "samples" / "kick.wav"
    sample_path.write_bytes(b"RIFF fake wav data")
    resp = await client.get("/api/projects/my-beat/samples/kick.wav")
    assert resp.status_code == 200
    assert resp.content == b"RIFF fake wav data"


@pytest.mark.asyncio
async def test_get_sample_not_found(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    resp = await client.get("/api/projects/my-beat/samples/nope.wav")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && python -m pytest test_routes.py -v -k sample`
Expected: FAIL

- [ ] **Step 3: Implement sample routes**

Append to `server/routes.py`:
```python
from fastapi import UploadFile, File
from fastapi.responses import FileResponse


@router.post("/projects/{name}/samples", status_code=201)
async def upload_sample(name: str, file: UploadFile = File(...)):
    samples_dir = PROJECTS_DIR / name / "samples"
    if not samples_dir.exists():
        raise HTTPException(404, "Project not found")
    dest = samples_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"filename": file.filename}


@router.get("/projects/{name}/samples/{filename}")
def get_sample(name: str, filename: str):
    sample_path = PROJECTS_DIR / name / "samples" / filename
    if not sample_path.exists():
        raise HTTPException(404, "Sample not found")
    return FileResponse(sample_path, media_type="audio/wav")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && python -m pytest test_routes.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat: sample upload and serving endpoints"
```

---

### Task 4: Starter Kit API

**Files:**
- Modify: `server/routes.py`
- Modify: `server/test_routes.py`
- Create: `kit/` (directory with placeholder samples for testing)

- [ ] **Step 1: Create a placeholder kit sample for testing**

```bash
mkdir -p kit
# Create a minimal valid WAV file (44 bytes) for testing
python3 -c "
import struct, wave, io
buf = io.BytesIO()
with wave.open(buf, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(44100)
    w.writeframes(struct.pack('<h', 0) * 100)
open('kit/kick-punchy.wav', 'wb').write(buf.getvalue())
"
```

- [ ] **Step 2: Write failing tests for kit endpoints**

Append to `server/test_routes.py`:
```python
@pytest.fixture
def kit_dir(tmp_path):
    import routes
    original = routes.KIT_DIR
    kit = tmp_path / "kit"
    kit.mkdir()
    (kit / "kick-punchy.wav").write_bytes(b"RIFF fake wav")
    (kit / "snare-crisp.wav").write_bytes(b"RIFF fake wav")
    routes.KIT_DIR = kit
    yield kit
    routes.KIT_DIR = original


@pytest.mark.asyncio
async def test_list_kit(client, kit_dir):
    resp = await client.get("/api/kit")
    assert resp.status_code == 200
    names = resp.json()
    assert "kick-punchy.wav" in names
    assert "snare-crisp.wav" in names


@pytest.mark.asyncio
async def test_get_kit_sample(client, kit_dir):
    resp = await client.get("/api/kit/kick-punchy.wav")
    assert resp.status_code == 200
    assert resp.content == b"RIFF fake wav"


@pytest.mark.asyncio
async def test_get_kit_sample_not_found(client, kit_dir):
    resp = await client.get("/api/kit/nope.wav")
    assert resp.status_code == 404
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && python -m pytest test_routes.py -v -k kit`
Expected: FAIL

- [ ] **Step 4: Implement kit routes**

Append to `server/routes.py`:
```python
KIT_DIR = Path(__file__).parent.parent / "kit"


@router.get("/kit")
def list_kit():
    if not KIT_DIR.exists():
        return []
    return [f.name for f in sorted(KIT_DIR.iterdir()) if f.suffix in (".wav", ".mp3")]


@router.get("/kit/{filename}")
def get_kit_sample(filename: str):
    sample_path = KIT_DIR / filename
    if not sample_path.exists():
        raise HTTPException(404, "Kit sample not found")
    return FileResponse(sample_path, media_type="audio/wav")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && python -m pytest test_routes.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/ kit/
git commit -m "feat: starter kit list and serve endpoints"
```

---

### Task 5: API Client (Frontend)

**Files:**
- Create: `app/js/api.js`

- [ ] **Step 1: Create the API client module**

`app/js/api.js`:
```javascript
const BASE = '/api';

export const api = {
  async listProjects() {
    const res = await fetch(`${BASE}/projects`);
    return res.json();
  },

  async createProject(name) {
    const res = await fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return res.json();
  },

  async getProject(name) {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Project not found: ${name}`);
    return res.json();
  },

  async saveProject(name, data) {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async uploadSample(projectName, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/samples`, {
      method: 'POST',
      body: form,
    });
    return res.json();
  },

  sampleUrl(projectName, filename) {
    if (filename.startsWith('kit://')) {
      return `${BASE}/kit/${encodeURIComponent(filename.slice(6))}`;
    }
    return `${BASE}/projects/${encodeURIComponent(projectName)}/samples/${encodeURIComponent(filename)}`;
  },

  async listKit() {
    const res = await fetch(`${BASE}/kit`);
    return res.json();
  },

  async exportMp3(projectName, wavBlob) {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wavBlob,
    });
    return res.json();
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add app/js/api.js
git commit -m "feat: frontend API client for companion server"
```

---

### Task 6: State Store

**Files:**
- Create: `app/js/state.js`

- [ ] **Step 1: Create the central state store with event emitter**

`app/js/state.js`:
```javascript
class StateStore {
  constructor() {
    this._listeners = {};
    this._saveTimer = null;
    this._saveFn = null;

    this.projectName = null;
    this.data = {
      bpm: 140,
      timeSignature: '4/4',
      tracks: [],
      patterns: [],
      arrangement: [],
    };

    // Transport state (not persisted)
    this.playing = false;
    this.currentBeat = 0;
    this.selectedTrack = null;
    this.selectedPattern = null;
    this.synthMode = 'simple'; // 'simple' | 'advanced'
  }

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  }

  emit(event, detail) {
    const list = this._listeners[event];
    if (list) list.forEach(fn => fn(detail));
  }

  update(path, value) {
    const keys = path.split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.emit('change', { path, value });
    this._scheduleSave();
  }

  setSaveFn(fn) {
    this._saveFn = fn;
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (this._saveFn) this._saveFn(this.data);
      this.emit('saved');
    }, 2000);
  }

  load(projectName, data) {
    this.projectName = projectName;
    this.data = data;
    this.emit('loaded', data);
  }

  addTrack(track) {
    this.data.tracks.push(track);
    this.emit('change', { path: 'tracks', value: this.data.tracks });
    this._scheduleSave();
  }

  addPattern(pattern) {
    this.data.patterns.push(pattern);
    this.emit('change', { path: 'patterns', value: this.data.patterns });
    this._scheduleSave();
  }
}

export const store = new StateStore();
```

- [ ] **Step 2: Commit**

```bash
git add app/js/state.js
git commit -m "feat: central state store with event emitter and auto-save"
```

---

### Task 7: Audio Engine Core — Context, Transport, Scheduling

**Files:**
- Create: `app/js/audio/engine.js`

- [ ] **Step 1: Create the audio engine with transport and lookahead scheduler**

`app/js/audio/engine.js`:
```javascript
import { store } from '../state.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this._schedulerTimer = null;
    this._nextBeatTime = 0;
    this._currentBeat = 0;
    this._lookahead = 0.1;   // seconds ahead to schedule
    this._scheduleInterval = 25; // ms between scheduler runs
  }

  init() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    return this;
  }

  get sampleRate() {
    return this.ctx.sampleRate;
  }

  get currentTime() {
    return this.ctx.currentTime;
  }

  _secondsPerBeat() {
    return 60 / store.data.bpm;
  }

  play() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._currentBeat = store.currentBeat;
    this._nextBeatTime = this.ctx.currentTime;
    store.playing = true;
    store.emit('transport', 'play');
    this._startScheduler();
  }

  stop() {
    store.playing = false;
    store.currentBeat = 0;
    this._currentBeat = 0;
    store.emit('transport', 'stop');
    this._stopScheduler();
  }

  _startScheduler() {
    this._stopScheduler();
    this._schedulerTimer = setInterval(() => this._schedule(), this._scheduleInterval);
  }

  _stopScheduler() {
    if (this._schedulerTimer) {
      clearInterval(this._schedulerTimer);
      this._schedulerTimer = null;
    }
  }

  _schedule() {
    while (this._nextBeatTime < this.ctx.currentTime + this._lookahead) {
      store.currentBeat = this._currentBeat;
      store.emit('beat', { beat: this._currentBeat, time: this._nextBeatTime });
      this._currentBeat++;
      this._nextBeatTime += this._secondsPerBeat() / 4; // 16th notes
    }
  }

  // Connect a source node to a track's chain or directly to master
  connectToMaster(node) {
    node.connect(this.masterGain);
  }
}

export const engine = new AudioEngine();
```

- [ ] **Step 2: Commit**

```bash
git add app/js/audio/engine.js
git commit -m "feat: audio engine core — context, transport, lookahead scheduler"
```

---

### Task 8: Synth Engine

**Files:**
- Create: `app/js/audio/synth.js`

- [ ] **Step 1: Create the subtractive synth with simple/advanced modes**

`app/js/audio/synth.js`:
```javascript
import { engine } from './engine.js';
import { store } from '../state.js';

export class Synth {
  constructor() {
    this.voices = [];
  }

  /**
   * Play a note at a scheduled time.
   * @param {number} frequency - Hz
   * @param {number} time - AudioContext time to start
   * @param {number} duration - seconds
   * @param {object} params - synth parameters
   * @param {AudioNode} destination - node to connect to
   */
  playNote(frequency, time, duration, params, destination) {
    const ctx = engine.ctx;
    const p = Object.assign({
      waveform: 'sawtooth',
      filterType: 'lowpass',
      filterFreq: 2000,
      filterQ: 1,
      attack: 0.01,
      decay: 0.1,
      sustain: 0.7,
      release: 0.2,
      // Advanced mode
      osc2Waveform: 'square',
      osc2Detune: 7,
      filterEnvAmount: 1000,
      filterAttack: 0.01,
      filterDecay: 0.3,
      filterSustain: 0.4,
      filterRelease: 0.2,
      lfoRate: 4,
      lfoAmount: 0,
      lfoTarget: 'pitch', // 'pitch' | 'filter' | 'amplitude'
    }, params);

    const endTime = time + duration;
    const releaseStart = endTime - p.release;

    // Oscillator 1
    const osc1 = ctx.createOscillator();
    osc1.type = p.waveform;
    osc1.frequency.setValueAtTime(frequency, time);

    // Filter
    const filter = ctx.createBiquadFilter();
    filter.type = p.filterType;
    filter.frequency.setValueAtTime(p.filterFreq, time);
    filter.Q.setValueAtTime(p.filterQ, time);

    // Amplitude envelope
    const ampEnv = ctx.createGain();
    ampEnv.gain.setValueAtTime(0, time);
    ampEnv.gain.linearRampToValueAtTime(1, time + p.attack);
    ampEnv.gain.linearRampToValueAtTime(p.sustain, time + p.attack + p.decay);
    ampEnv.gain.setValueAtTime(p.sustain, releaseStart);
    ampEnv.gain.linearRampToValueAtTime(0, endTime);

    osc1.connect(filter);

    // Advanced mode: oscillator 2
    let osc2 = null;
    if (store.synthMode === 'advanced') {
      osc2 = ctx.createOscillator();
      osc2.type = p.osc2Waveform;
      osc2.frequency.setValueAtTime(frequency, time);
      osc2.detune.setValueAtTime(p.osc2Detune, time);
      osc2.connect(filter);

      // Filter envelope
      filter.frequency.setValueAtTime(p.filterFreq, time);
      filter.frequency.linearRampToValueAtTime(
        p.filterFreq + p.filterEnvAmount, time + p.filterAttack
      );
      filter.frequency.linearRampToValueAtTime(
        p.filterFreq + p.filterEnvAmount * p.filterSustain,
        time + p.filterAttack + p.filterDecay
      );
      filter.frequency.linearRampToValueAtTime(p.filterFreq, endTime);

      // LFO
      if (p.lfoAmount > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.setValueAtTime(p.lfoRate, time);
        const lfoGain = ctx.createGain();
        lfoGain.gain.setValueAtTime(p.lfoAmount, time);
        lfo.connect(lfoGain);

        if (p.lfoTarget === 'pitch') {
          lfoGain.connect(osc1.frequency);
          lfoGain.connect(osc2.frequency);
        } else if (p.lfoTarget === 'filter') {
          lfoGain.connect(filter.frequency);
        } else if (p.lfoTarget === 'amplitude') {
          lfoGain.connect(ampEnv.gain);
        }

        lfo.start(time);
        lfo.stop(endTime);
      }

      osc2.start(time);
      osc2.stop(endTime);
    }

    filter.connect(ampEnv);
    ampEnv.connect(destination);

    osc1.start(time);
    osc1.stop(endTime);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/js/audio/synth.js
git commit -m "feat: subtractive synth with simple/advanced modes"
```

---

### Task 9: Sample Playback

**Files:**
- Create: `app/js/audio/sampler.js`

- [ ] **Step 1: Create the sampler — load, cache, and play samples**

`app/js/audio/sampler.js`:
```javascript
import { engine } from './engine.js';
import { api } from '../api.js';
import { store } from '../state.js';

class Sampler {
  constructor() {
    this._cache = new Map(); // url -> AudioBuffer
  }

  /**
   * Load a sample into the cache.
   * @param {string} ref - sample reference (relative path or kit://name)
   * @returns {Promise<AudioBuffer>}
   */
  async load(ref) {
    const url = api.sampleUrl(store.projectName, ref);
    if (this._cache.has(url)) return this._cache.get(url);

    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await engine.ctx.decodeAudioData(arrayBuf);
    this._cache.set(url, audioBuf);
    return audioBuf;
  }

  /**
   * Preload all samples referenced in the current project.
   */
  async preloadProject() {
    const refs = new Set();
    for (const track of store.data.tracks) {
      if (track.type === 'sample' && track.sampleRef) {
        refs.add(track.sampleRef);
      }
    }
    await Promise.all([...refs].map(ref => this.load(ref)));
  }

  /**
   * Play a sample at a scheduled time.
   * @param {string} ref - sample reference
   * @param {number} time - AudioContext time
   * @param {AudioNode} destination - node to connect to
   * @param {object} [options]
   * @param {boolean} [options.loop] - loop playback
   * @param {number} [options.playbackRate] - speed/pitch (default 1)
   */
  play(ref, time, destination, options = {}) {
    const url = api.sampleUrl(store.projectName, ref);
    const buffer = this._cache.get(url);
    if (!buffer) {
      console.warn(`Sample not loaded: ${ref}`);
      return null;
    }

    const source = engine.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop || false;
    source.playbackRate.setValueAtTime(options.playbackRate || 1, time);
    source.connect(destination);
    source.start(time);
    return source;
  }

  clearCache() {
    this._cache.clear();
  }
}

export const sampler = new Sampler();
```

- [ ] **Step 2: Commit**

```bash
git add app/js/audio/sampler.js
git commit -m "feat: sample loader with caching and scheduled playback"
```

---

### Task 10: Effects Chain

**Files:**
- Create: `app/js/audio/effects.js`

- [ ] **Step 1: Create per-track effects chain**

`app/js/audio/effects.js`:
```javascript
import { engine } from './engine.js';

/**
 * Creates a per-track effects chain:
 * input -> EQ -> distortion -> delay -> reverb -> output
 * Each effect has a bypass switch and wet/dry mix.
 */
export class EffectsChain {
  constructor() {
    this.input = null;
    this.output = null;
    this.eq = null;
    this.distortion = null;
    this.delay = null;
    this.reverb = null;
    this._nodes = {};
  }

  init() {
    const ctx = engine.ctx;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // EQ: 3-band (low, mid, high)
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 200;
    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1;
    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 4000;

    this.eq = { low: eqLow, mid: eqMid, high: eqHigh, enabled: false };

    // Distortion
    const distCurve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      distCurve[i] = (Math.PI + 20) * x / (Math.PI + 20 * Math.abs(x));
    }
    const distShaper = ctx.createWaveShaper();
    distShaper.curve = distCurve;
    distShaper.oversample = '2x';
    const distDry = ctx.createGain();
    const distWet = ctx.createGain();
    distDry.gain.value = 1;
    distWet.gain.value = 0;

    this.distortion = { shaper: distShaper, dry: distDry, wet: distWet, enabled: false };

    // Delay
    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.375; // dotted eighth at 140bpm approx
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.4;
    const delayDry = ctx.createGain();
    const delayWet = ctx.createGain();
    delayDry.gain.value = 1;
    delayWet.gain.value = 0;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    this.delay = {
      node: delayNode, feedback: delayFeedback,
      dry: delayDry, wet: delayWet, enabled: false,
    };

    // Reverb (convolver — needs impulse response loaded later)
    const convolver = ctx.createConvolver();
    const reverbDry = ctx.createGain();
    const reverbWet = ctx.createGain();
    reverbDry.gain.value = 1;
    reverbWet.gain.value = 0;

    this.reverb = {
      convolver, dry: reverbDry, wet: reverbWet, enabled: false,
      setImpulse(buffer) { convolver.buffer = buffer; },
    };

    // Wire the chain: input -> EQ -> distortion split -> delay split -> reverb split -> output
    this.input.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);

    // Distortion: dry/wet split
    const postEq = eqHigh;
    postEq.connect(distDry);
    postEq.connect(distShaper);
    distShaper.connect(distWet);

    // Merge distortion -> delay split
    const distMerge = ctx.createGain();
    distDry.connect(distMerge);
    distWet.connect(distMerge);

    distMerge.connect(delayDry);
    distMerge.connect(delayNode);
    delayNode.connect(delayWet);

    // Merge delay -> reverb split
    const delayMerge = ctx.createGain();
    delayDry.connect(delayMerge);
    delayWet.connect(delayMerge);

    delayMerge.connect(reverbDry);
    delayMerge.connect(convolver);
    convolver.connect(reverbWet);

    // Merge reverb -> output
    reverbDry.connect(this.output);
    reverbWet.connect(this.output);

    // Generate a simple impulse response for default reverb
    this._generateDefaultIR();

    return this;
  }

  _generateDefaultIR() {
    const ctx = engine.ctx;
    const length = ctx.sampleRate * 1.5;
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.4));
      }
    }
    this.reverb.convolver.buffer = ir;
  }

  setDistortionMix(wet) {
    this.distortion.dry.gain.value = 1 - wet;
    this.distortion.wet.gain.value = wet;
  }

  setDelayMix(wet) {
    this.delay.dry.gain.value = 1 - wet;
    this.delay.wet.gain.value = wet;
  }

  setReverbMix(wet) {
    this.reverb.dry.gain.value = 1 - wet;
    this.reverb.wet.gain.value = wet;
  }

  setDelayTime(seconds) {
    this.delay.node.delayTime.value = seconds;
  }

  setDelayFeedback(value) {
    this.delay.feedback.gain.value = value;
  }

  setEQ(band, gain) {
    this.eq[band].gain.value = gain;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/js/audio/effects.js
git commit -m "feat: per-track effects chain — EQ, distortion, delay, reverb"
```

---

### Task 11: Mixer

**Files:**
- Create: `app/js/audio/mixer.js`

- [ ] **Step 1: Create the mixer — per-track gain/pan, master bus, metering**

`app/js/audio/mixer.js`:
```javascript
import { engine } from './engine.js';
import { EffectsChain } from './effects.js';

/**
 * A mixer channel: effects chain -> gain -> pan -> output
 */
export class MixerChannel {
  constructor(name) {
    this.name = name;
    this.effects = new EffectsChain();
    this.gain = null;
    this.pan = null;
    this.muted = false;
    this.soloed = false;
    this._preMuteGain = 1;
  }

  init() {
    const ctx = engine.ctx;
    this.effects.init();
    this.gain = ctx.createGain();
    this.pan = ctx.createStereoPanner();

    this.effects.output.connect(this.gain);
    this.gain.connect(this.pan);
    this.pan.connect(engine.masterGain);

    return this;
  }

  /** The node that audio sources should connect to */
  get input() {
    return this.effects.input;
  }

  setVolume(value) {
    this._preMuteGain = value;
    if (!this.muted) this.gain.gain.value = value;
  }

  setPan(value) {
    this.pan.pan.value = value;
  }

  setMute(muted) {
    this.muted = muted;
    this.gain.gain.value = muted ? 0 : this._preMuteGain;
  }
}


class Mixer {
  constructor() {
    this.channels = [];
  }

  createChannel(name) {
    const ch = new MixerChannel(name);
    ch.init();
    this.channels.push(ch);
    return ch;
  }

  removeChannel(index) {
    const ch = this.channels.splice(index, 1)[0];
    if (ch) {
      ch.pan.disconnect();
      ch.gain.disconnect();
      ch.effects.output.disconnect();
    }
  }

  setMasterVolume(value) {
    engine.masterGain.gain.value = value;
  }

  /**
   * Get master level data for metering.
   * @returns {Uint8Array}
   */
  getMeterData() {
    const data = new Uint8Array(engine.analyser.frequencyBinCount);
    engine.analyser.getByteTimeDomainData(data);
    return data;
  }

  /**
   * Handle solo logic: if any channel is soloed, mute all non-soloed channels.
   */
  updateSoloState() {
    const anySoloed = this.channels.some(ch => ch.soloed);
    for (const ch of this.channels) {
      if (anySoloed) {
        ch.gain.gain.value = ch.soloed ? ch._preMuteGain : 0;
      } else {
        ch.gain.gain.value = ch.muted ? 0 : ch._preMuteGain;
      }
    }
  }
}

export const mixer = new Mixer();
```

- [ ] **Step 2: Commit**

```bash
git add app/js/audio/mixer.js
git commit -m "feat: mixer with per-track channels, gain, pan, mute, solo"
```

---

### Task 12: MP3 Export

**Files:**
- Create: `app/js/audio/export.js`
- Modify: `server/routes.py`
- Modify: `server/test_routes.py`

- [ ] **Step 1: Write failing test for export endpoint**

Append to `server/test_routes.py`:
```python
@pytest.mark.asyncio
async def test_export_mp3(client, projects_dir):
    await client.post("/api/projects", json={"name": "my-beat"})
    # Send fake WAV data
    resp = await client.post(
        "/api/projects/my-beat/export",
        content=b"RIFF fake wav for export test",
        headers={"Content-Type": "audio/wav"},
    )
    # Should fail gracefully if ffmpeg not installed, or succeed with 200
    assert resp.status_code in (200, 500)
```

- [ ] **Step 2: Implement export endpoint**

Append to `server/routes.py`:
```python
import subprocess
import tempfile
from fastapi import Request
from fastapi.responses import JSONResponse


@router.post("/projects/{name}/export")
async def export_mp3(name: str, request: Request):
    project_dir = PROJECTS_DIR / name
    if not project_dir.exists():
        raise HTTPException(404, "Project not found")

    wav_data = await request.body()
    wav_path = project_dir / "export.wav"
    mp3_path = project_dir / "export.mp3"

    wav_path.write_bytes(wav_data)

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path), "-b:a", "192k", str(mp3_path)],
            check=True, capture_output=True,
        )
    except FileNotFoundError:
        raise HTTPException(500, "ffmpeg not found — install ffmpeg to export MP3")
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"ffmpeg error: {e.stderr.decode()}")
    finally:
        wav_path.unlink(missing_ok=True)

    return {"path": str(mp3_path), "filename": "export.mp3"}
```

- [ ] **Step 3: Create frontend export module**

`app/js/audio/export.js`:
```javascript
import { engine } from './engine.js';
import { store } from '../state.js';
import { api } from '../api.js';

/**
 * Offline-render the arrangement and upload WAV to server for MP3 encoding.
 * @param {function} renderCallback - called with (offlineCtx, duration) to build the audio graph
 * @returns {Promise<{path: string, filename: string}>}
 */
export async function exportMp3(renderCallback) {
  const bpm = store.data.bpm;
  const arrangement = store.data.arrangement;

  // Calculate total duration from arrangement
  let maxEnd = 0;
  for (const clip of arrangement) {
    const clipEnd = (clip.startBeat + clip.lengthBeats) * (60 / bpm);
    if (clipEnd > maxEnd) maxEnd = clipEnd;
  }
  if (maxEnd === 0) maxEnd = 4 * (60 / bpm); // default 4 beats

  const sampleRate = engine.sampleRate;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * maxEnd), sampleRate);

  // Let the caller build the audio graph on the offline context
  await renderCallback(offlineCtx, maxEnd);

  const renderedBuffer = await offlineCtx.startRendering();

  // Encode to WAV
  const wavBlob = audioBufferToWav(renderedBuffer);

  // Upload to server
  return api.exportMp3(store.projectName, wavBlob);
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Interleave channels
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channels[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
```

- [ ] **Step 4: Run server tests**

Run: `cd server && python -m pytest test_routes.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add app/js/audio/export.js server/
git commit -m "feat: MP3 export — offline render to WAV, server encodes via ffmpeg"
```

---

### Task 13: Canvas Utilities

**Files:**
- Create: `app/js/ui/utils.js`

- [ ] **Step 1: Create shared Canvas helpers**

`app/js/ui/utils.js`:
```javascript
/**
 * Set up a Canvas element to fill its container with correct DPI scaling.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ ctx: CanvasRenderingContext2D, width: number, height: number }}
 */
export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, width: rect.width, height: rect.height };
}

/**
 * Draw a grid on a Canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} cellW - cell width in pixels
 * @param {number} cellH - cell height in pixels
 * @param {string} color - grid line color
 * @param {number} [scrollX=0]
 * @param {number} [scrollY=0]
 */
export function drawGrid(ctx, width, height, cellW, cellH, color, scrollX = 0, scrollY = 0) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;

  const startX = -(scrollX % cellW);
  for (let x = startX; x <= width; x += cellW) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  const startY = -(scrollY % cellH);
  for (let y = startY; y <= height; y += cellH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

/**
 * Snap a value to the nearest grid line.
 */
export function snap(value, gridSize) {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Convert MIDI note number to frequency.
 */
export function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Convert MIDI note number to name (e.g., 60 -> "C4").
 */
export function midiToName(note) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  return names[note % 12] + octave;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/js/ui/utils.js
git commit -m "feat: shared Canvas utilities — grid, snapping, MIDI helpers"
```

---

### Task 14: Top Bar — Transport Controls

**Files:**
- Create: `app/js/ui/topbar.js`

- [ ] **Step 1: Create the top bar with transport, BPM, project controls**

`app/js/ui/topbar.js`:
```javascript
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

  // Transport
  document.getElementById('btn-play').addEventListener('click', () => {
    engine.play();
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    engine.stop();
  });

  // BPM
  document.getElementById('bpm-input').addEventListener('change', (e) => {
    const bpm = parseInt(e.target.value, 10);
    if (bpm >= 20 && bpm <= 300) {
      store.update('bpm', bpm);
    }
  });

  // Synth mode
  document.getElementById('synth-mode-select').addEventListener('change', (e) => {
    store.synthMode = e.target.value;
    store.emit('synthModeChange', e.target.value);
  });

  // Save indicator
  store.on('change', () => {
    document.getElementById('save-indicator').textContent = '*';
  });
  store.on('saved', () => {
    document.getElementById('save-indicator').textContent = '';
  });

  // Loaded
  store.on('loaded', () => {
    document.getElementById('bpm-input').value = store.data.bpm;
    document.getElementById('project-name').textContent = store.projectName;
    document.getElementById('time-sig-display').textContent = store.data.timeSignature;
  });
}
```

- [ ] **Step 2: Add topbar styles to style.css**

Append to `app/css/style.css`:
```css
/* Top bar */
.transport { display: flex; gap: 4px; }
.transport button {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text-primary);
  width: 32px; height: 32px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.transport button:hover { background: var(--accent); }

.bpm-control, .time-sig, .synth-mode {
  display: flex; align-items: center; gap: 6px;
}
.bpm-control label, .time-sig label, .synth-mode label {
  color: var(--text-secondary); font-size: 11px; text-transform: uppercase;
}
#bpm-input {
  width: 50px; background: var(--bg-primary); border: 1px solid var(--border);
  color: var(--text-primary); text-align: center; border-radius: 3px; padding: 4px;
}
#synth-mode-select {
  background: var(--bg-primary); border: 1px solid var(--border);
  color: var(--text-primary); border-radius: 3px; padding: 4px;
}
.project-info { display: flex; align-items: center; gap: 6px; }
#project-name { color: var(--text-secondary); }
#save-indicator { color: var(--accent); font-weight: bold; }
.spacer { flex: 1; }
#btn-export {
  background: var(--accent); border: none; color: white;
  padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
#btn-export:hover { opacity: 0.8; }
```

- [ ] **Step 3: Commit**

```bash
git add app/js/ui/topbar.js app/css/style.css
git commit -m "feat: top bar — transport controls, BPM, synth mode, export button"
```

---

### Task 15: Timeline / Arrangement View

**Files:**
- Create: `app/js/ui/timeline.js`

- [ ] **Step 1: Create the Canvas timeline with tracks and clip rendering**

`app/js/ui/timeline.js`:
```javascript
import { store } from '../state.js';
import { setupCanvas, drawGrid } from './utils.js';

const TRACK_HEIGHT = 40;
const BEAT_WIDTH = 30;
const HEADER_WIDTH = 100;
const COLORS = ['#533483', '#e94560', '#7ec8e3', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6', '#1abc9c'];

export function initTimeline() {
  const container = document.getElementById('timeline');
  container.innerHTML = `<canvas id="timeline-canvas"></canvas>`;
  const canvas = document.getElementById('timeline-canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  let scrollX = 0;
  let scrollY = 0;

  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    const tracks = store.data.tracks;
    const arrangement = store.data.arrangement;

    // Background
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(0, 0, width, height);

    // Track rows
    for (let i = 0; i < tracks.length; i++) {
      const y = i * TRACK_HEIGHT - scrollY;
      if (y + TRACK_HEIGHT < 0 || y > height) continue;

      // Track row background (alternate)
      ctx.fillStyle = i % 2 === 0 ? '#0f3460' : '#0d2d52';
      ctx.fillRect(0, y, width, TRACK_HEIGHT);

      // Track header
      ctx.fillStyle = '#16213e';
      ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);

      // Track name
      ctx.fillStyle = '#7ec8e3';
      ctx.font = '11px sans-serif';
      ctx.fillText(tracks[i].name || `Track ${i + 1}`, 8, y + 16);

      // Mute/Solo indicators
      ctx.fillStyle = tracks[i].muted ? '#e94560' : '#4a4a6a';
      ctx.fillText('M', 8, y + 32);
      ctx.fillStyle = tracks[i].soloed ? '#2ecc71' : '#4a4a6a';
      ctx.fillText('S', 22, y + 32);

      // Track border
      ctx.strokeStyle = '#2b2d42';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + TRACK_HEIGHT);
      ctx.lineTo(width, y + TRACK_HEIGHT);
      ctx.stroke();
    }

    // Grid lines (beats)
    drawGrid(ctx, width, height, BEAT_WIDTH, TRACK_HEIGHT, 'rgba(255,255,255,0.05)', scrollX, scrollY);

    // Beat numbers at top
    ctx.fillStyle = '#7ec8e3';
    ctx.font = '10px sans-serif';
    const startBeat = Math.floor(scrollX / BEAT_WIDTH);
    for (let b = startBeat; b < startBeat + Math.ceil(width / BEAT_WIDTH) + 1; b++) {
      const x = HEADER_WIDTH + b * BEAT_WIDTH - scrollX;
      if (b % 4 === 0) {
        ctx.fillText(`${Math.floor(b / 4) + 1}`, x + 2, 10);
      }
    }

    // Arrangement clips
    for (const clip of arrangement) {
      const trackIdx = clip.trackIndex;
      const y = trackIdx * TRACK_HEIGHT - scrollY;
      const x = HEADER_WIDTH + clip.startBeat * BEAT_WIDTH - scrollX;
      const w = clip.lengthBeats * BEAT_WIDTH;

      if (y + TRACK_HEIGHT < 0 || y > height) continue;
      if (x + w < HEADER_WIDTH || x > width) continue;

      const color = COLORS[trackIdx % COLORS.length];
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(Math.max(x, HEADER_WIDTH), y + 2, w - 1, TRACK_HEIGHT - 4);
      ctx.globalAlpha = 1;

      // Clip label
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      const label = clip.patternName || `P${clip.patternIndex}`;
      ctx.fillText(label, Math.max(x, HEADER_WIDTH) + 4, y + 14);
    }

    // Playhead
    if (store.playing) {
      const beatPos = store.currentBeat / 4; // currentBeat is in 16th notes
      const px = HEADER_WIDTH + beatPos * BEAT_WIDTH - scrollX;
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }

    // Header border
    ctx.strokeStyle = '#2b2d42';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEADER_WIDTH, 0);
    ctx.lineTo(HEADER_WIDTH, height);
    ctx.stroke();
  }

  // Scroll
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    scrollX = Math.max(0, scrollX + e.deltaX);
    scrollY = Math.max(0, scrollY + e.deltaY);
    render();
  });

  // Click to select track
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top + scrollY;
    const trackIdx = Math.floor(y / TRACK_HEIGHT);
    if (trackIdx >= 0 && trackIdx < store.data.tracks.length) {
      store.selectedTrack = trackIdx;
      store.emit('trackSelected', trackIdx);
      render();
    }
  });

  // Double-click to select pattern in clip
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - HEADER_WIDTH + scrollX;
    const y = e.clientY - rect.top + scrollY;
    const trackIdx = Math.floor(y / TRACK_HEIGHT);
    const beat = x / BEAT_WIDTH;

    for (const clip of store.data.arrangement) {
      if (clip.trackIndex === trackIdx && beat >= clip.startBeat && beat < clip.startBeat + clip.lengthBeats) {
        store.selectedPattern = clip.patternIndex;
        store.emit('patternSelected', clip.patternIndex);
        break;
      }
    }
  });

  // Re-render on changes
  store.on('change', render);
  store.on('beat', render);
  store.on('loaded', render);

  // Animation loop for playhead
  function animate() {
    if (store.playing) render();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // Initial render
  render();

  // Resize
  window.addEventListener('resize', render);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/js/ui/timeline.js
git commit -m "feat: timeline/arrangement view — Canvas tracks, clips, playhead"
```

---

### Task 16: Piano Roll

**Files:**
- Create: `app/js/ui/piano-roll.js`

- [ ] **Step 1: Create the Canvas piano roll editor**

`app/js/ui/piano-roll.js`:
```javascript
import { store } from '../state.js';
import { setupCanvas, drawGrid, snap, midiToName } from './utils.js';

const NOTE_HEIGHT = 12;
const STEP_WIDTH = 20;
const KEY_WIDTH = 40;
const MIN_NOTE = 36; // C2
const MAX_NOTE = 96; // C7
const NOTE_RANGE = MAX_NOTE - MIN_NOTE;

export function initPianoRoll(container) {
  container.innerHTML = `
    <div class="editor-tabs">
      <button class="tab active" data-tab="piano-roll">Piano Roll</button>
      <button class="tab" data-tab="step-seq">Step Sequencer</button>
    </div>
    <div class="editor-content">
      <canvas id="piano-roll-canvas"></canvas>
    </div>
  `;

  const canvas = document.getElementById('piano-roll-canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  let scrollX = 0;
  let scrollY = (NOTE_RANGE / 2) * NOTE_HEIGHT; // Start centered
  let isDragging = false;
  let dragNote = null;

  function getPattern() {
    if (store.selectedPattern == null) return null;
    return store.data.patterns[store.selectedPattern] || null;
  }

  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    const pattern = getPattern();

    // Background
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(0, 0, width, height);

    // Piano keys
    for (let note = MAX_NOTE; note >= MIN_NOTE; note--) {
      const y = (MAX_NOTE - note) * NOTE_HEIGHT - scrollY;
      if (y + NOTE_HEIGHT < 0 || y > height) continue;

      const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
      ctx.fillStyle = isBlack ? '#1a1a2e' : '#16213e';
      ctx.fillRect(0, y, KEY_WIDTH, NOTE_HEIGHT);

      // Key label (C notes)
      if (note % 12 === 0) {
        ctx.fillStyle = '#7ec8e3';
        ctx.font = '9px sans-serif';
        ctx.fillText(midiToName(note), 4, y + 10);
      }

      // Key border
      ctx.strokeStyle = '#2b2d42';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + NOTE_HEIGHT);
      ctx.lineTo(width, y + NOTE_HEIGHT);
      ctx.stroke();
    }

    // Grid
    const gridArea = { x: KEY_WIDTH, y: 0, w: width - KEY_WIDTH, h: height };
    ctx.save();
    ctx.beginPath();
    ctx.rect(gridArea.x, gridArea.y, gridArea.w, gridArea.h);
    ctx.clip();

    drawGrid(ctx, width, height, STEP_WIDTH, NOTE_HEIGHT, 'rgba(255,255,255,0.05)', scrollX - KEY_WIDTH, scrollY);

    // Beat emphasis lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    const startStep = Math.floor(scrollX / STEP_WIDTH);
    for (let s = startStep; s < startStep + Math.ceil(width / STEP_WIDTH) + 1; s++) {
      if (s % 4 === 0) {
        const x = KEY_WIDTH + s * STEP_WIDTH - scrollX;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Notes
    if (pattern && pattern.notes) {
      for (const note of pattern.notes) {
        const x = KEY_WIDTH + note.start * STEP_WIDTH - scrollX;
        const y = (MAX_NOTE - note.pitch) * NOTE_HEIGHT - scrollY;
        const w = note.duration * STEP_WIDTH;

        if (y + NOTE_HEIGHT < 0 || y > height) continue;
        if (x + w < KEY_WIDTH || x > width) continue;

        // Note rectangle with velocity-based opacity
        const alpha = 0.4 + (note.velocity / 127) * 0.6;
        ctx.fillStyle = `rgba(233, 69, 96, ${alpha})`;
        ctx.fillRect(x, y + 1, w - 1, NOTE_HEIGHT - 2);

        // Note border
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y + 1, w - 1, NOTE_HEIGHT - 2);
      }
    }

    ctx.restore();

    // Key column border
    ctx.strokeStyle = '#2b2d42';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(KEY_WIDTH, 0);
    ctx.lineTo(KEY_WIDTH, height);
    ctx.stroke();
  }

  // Scroll
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    scrollX = Math.max(0, scrollX + e.deltaX);
    scrollY = Math.max(0, scrollY + e.deltaY);
    render();
  });

  // Click to add/remove notes
  canvas.addEventListener('mousedown', (e) => {
    const pattern = getPattern();
    if (!pattern) return;
    if (!pattern.notes) pattern.notes = [];

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (mx < KEY_WIDTH) return;

    const step = Math.floor((mx - KEY_WIDTH + scrollX) / STEP_WIDTH);
    const pitch = MAX_NOTE - Math.floor((my + scrollY) / NOTE_HEIGHT);

    if (pitch < MIN_NOTE || pitch > MAX_NOTE) return;

    // Check if clicking on an existing note
    const existing = pattern.notes.findIndex(n => n.pitch === pitch && step >= n.start && step < n.start + n.duration);

    if (existing >= 0) {
      // Remove note
      pattern.notes.splice(existing, 1);
    } else {
      // Add note
      pattern.notes.push({
        pitch,
        start: step,
        duration: 1,
        velocity: 100,
      });
    }

    store.emit('change', { path: 'patterns', value: store.data.patterns });
    store._scheduleSave();
    render();
  });

  // Tab switching
  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      store.emit('editorTabChange', tab.dataset.tab);
    });
  });

  store.on('change', render);
  store.on('patternSelected', render);
  store.on('loaded', render);

  render();
  window.addEventListener('resize', render);
}
```

- [ ] **Step 2: Add editor tab styles**

Append to `app/css/style.css`:
```css
/* Editor tabs */
.editor-tabs {
  display: flex; gap: 2px; padding: 4px 4px 0;
  background: var(--bg-secondary);
}
.tab {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-bottom: none; color: var(--text-secondary);
  padding: 4px 12px; border-radius: 4px 4px 0 0;
  cursor: pointer; font-size: 11px;
}
.tab.active { background: var(--bg-panel); color: var(--accent); border-color: var(--accent); }
.editor-content {
  flex: 1; position: relative; overflow: hidden;
}
#editor {
  display: flex; flex-direction: column;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/js/ui/piano-roll.js app/css/style.css
git commit -m "feat: piano roll — Canvas note editor with velocity, scrolling"
```

---

### Task 17: Step Sequencer

**Files:**
- Create: `app/js/ui/step-sequencer.js`

- [ ] **Step 1: Create the step sequencer grid**

`app/js/ui/step-sequencer.js`:
```javascript
import { store } from '../state.js';
import { setupCanvas } from './utils.js';

const CELL_SIZE = 28;
const HEADER_WIDTH = 80;
const HEADER_HEIGHT = 24;

export function initStepSequencer(container) {
  container.innerHTML = `<canvas id="step-seq-canvas"></canvas>`;
  const canvas = document.getElementById('step-seq-canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  function getPattern() {
    if (store.selectedPattern == null) return null;
    return store.data.patterns[store.selectedPattern] || null;
  }

  function render() {
    const { ctx, width, height } = setupCanvas(canvas);
    const pattern = getPattern();

    ctx.fillStyle = '#0f3460';
    ctx.fillRect(0, 0, width, height);

    if (!pattern || !pattern.steps) {
      ctx.fillStyle = '#7ec8e3';
      ctx.font = '13px sans-serif';
      ctx.fillText('No pattern selected', 20, 40);
      return;
    }

    const numSteps = pattern.stepCount || 16;
    const rows = pattern.steps; // array of { name, cells: boolean[] }

    // Step number header
    ctx.fillStyle = '#16213e';
    ctx.fillRect(HEADER_WIDTH, 0, width, HEADER_HEIGHT);
    ctx.fillStyle = '#7ec8e3';
    ctx.font = '10px sans-serif';
    for (let s = 0; s < numSteps; s++) {
      const x = HEADER_WIDTH + s * CELL_SIZE;
      ctx.fillText(`${s + 1}`, x + 8, 16);
    }

    // Rows
    for (let r = 0; r < rows.length; r++) {
      const y = HEADER_HEIGHT + r * CELL_SIZE;
      const row = rows[r];

      // Row header
      ctx.fillStyle = '#16213e';
      ctx.fillRect(0, y, HEADER_WIDTH, CELL_SIZE);
      ctx.fillStyle = '#7ec8e3';
      ctx.font = '11px sans-serif';
      ctx.fillText(row.name || `Row ${r + 1}`, 6, y + 18);

      // Cells
      for (let s = 0; s < numSteps; s++) {
        const x = HEADER_WIDTH + s * CELL_SIZE;
        const isOn = row.cells[s];
        const isGroupStart = s % 4 === 0;

        // Cell background
        ctx.fillStyle = isOn ? '#e94560' : (isGroupStart ? '#1a1a2e' : '#16213e');
        ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

        // Velocity indicator (brighter = louder)
        if (isOn && row.velocities && row.velocities[s]) {
          const vel = row.velocities[s] / 127;
          ctx.globalAlpha = vel;
          ctx.fillStyle = '#ff6b81';
          ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          ctx.globalAlpha = 1;
        }

        // Border
        ctx.strokeStyle = '#2b2d42';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      }

      // Row border
      ctx.strokeStyle = '#2b2d42';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + CELL_SIZE);
      ctx.lineTo(width, y + CELL_SIZE);
      ctx.stroke();
    }

    // Playhead
    if (store.playing) {
      const step = store.currentBeat % numSteps;
      const x = HEADER_WIDTH + step * CELL_SIZE;
      ctx.fillStyle = 'rgba(233, 69, 96, 0.3)';
      ctx.fillRect(x, HEADER_HEIGHT, CELL_SIZE, rows.length * CELL_SIZE);
    }
  }

  // Click to toggle cells
  canvas.addEventListener('click', (e) => {
    const pattern = getPattern();
    if (!pattern || !pattern.steps) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (mx < HEADER_WIDTH || my < HEADER_HEIGHT) return;

    const step = Math.floor((mx - HEADER_WIDTH) / CELL_SIZE);
    const row = Math.floor((my - HEADER_HEIGHT) / CELL_SIZE);

    if (row < 0 || row >= pattern.steps.length) return;
    if (step < 0 || step >= (pattern.stepCount || 16)) return;

    pattern.steps[row].cells[step] = !pattern.steps[row].cells[step];
    if (!pattern.steps[row].velocities) {
      pattern.steps[row].velocities = new Array(pattern.stepCount || 16).fill(100);
    }

    store.emit('change', { path: 'patterns', value: store.data.patterns });
    store._scheduleSave();
    render();
  });

  store.on('change', render);
  store.on('patternSelected', render);
  store.on('loaded', render);
  store.on('beat', render);

  render();
  window.addEventListener('resize', render);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/js/ui/step-sequencer.js
git commit -m "feat: step sequencer — toggleable grid with velocity, playhead"
```

---

### Task 18: Mixer Panel

**Files:**
- Create: `app/js/ui/mixer-panel.js`

- [ ] **Step 1: Create the mixer panel with faders, pan knobs, effect toggles**

`app/js/ui/mixer-panel.js`:
```javascript
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
                value="${Math.round((track.volume ?? 1) * 100)}"
                data-action="volume" data-index="${i}">
            </div>
            <div class="pan-container">
              <label>Pan</label>
              <input type="range" class="pan" min="-100" max="100"
                value="${Math.round((track.pan ?? 0) * 100)}"
                data-action="pan" data-index="${i}">
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
            <input type="range" class="fader" orient="vertical" min="0" max="100"
              value="100" data-action="master-volume">
          </div>
          <canvas id="meter-canvas" width="30" height="120"></canvas>
        </div>
      </div>
    `;

    // Event delegation
    container.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const action = e.target.dataset.action;

      if (action === 'volume') {
        const vol = parseInt(e.target.value, 10) / 100;
        store.data.tracks[idx].volume = vol;
        if (mixer.channels[idx]) mixer.channels[idx].setVolume(vol);
        store._scheduleSave();
      } else if (action === 'pan') {
        const pan = parseInt(e.target.value, 10) / 100;
        store.data.tracks[idx].pan = pan;
        if (mixer.channels[idx]) mixer.channels[idx].setPan(pan);
        store._scheduleSave();
      } else if (action === 'master-volume') {
        mixer.setMasterVolume(parseInt(e.target.value, 10) / 100);
      }
    });

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.index, 10);
      const action = btn.dataset.action;

      if (action === 'mute') {
        store.data.tracks[idx].muted = !store.data.tracks[idx].muted;
        if (mixer.channels[idx]) mixer.channels[idx].setMute(store.data.tracks[idx].muted);
        mixer.updateSoloState();
        store._scheduleSave();
        render();
      } else if (action === 'solo') {
        store.data.tracks[idx].soloed = !store.data.tracks[idx].soloed;
        mixer.updateSoloState();
        store._scheduleSave();
        render();
      }
    });

    // Meter animation
    const meterCanvas = document.getElementById('meter-canvas');
    if (meterCanvas) {
      const mCtx = meterCanvas.getContext('2d');
      function drawMeter() {
        const data = mixer.getMeterData();
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const val = (data[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, rms * 3);

        mCtx.fillStyle = '#1a1a2e';
        mCtx.fillRect(0, 0, 30, 120);

        const h = level * 120;
        const gradient = mCtx.createLinearGradient(0, 120 - h, 0, 120);
        gradient.addColorStop(0, level > 0.8 ? '#e94560' : '#2ecc71');
        gradient.addColorStop(1, '#533483');
        mCtx.fillStyle = gradient;
        mCtx.fillRect(4, 120 - h, 22, h);

        requestAnimationFrame(drawMeter);
      }
      drawMeter();
    }
  }

  store.on('change', render);
  store.on('loaded', render);
  render();
}
```

- [ ] **Step 2: Add mixer panel styles**

Append to `app/css/style.css`:
```css
/* Mixer panel */
.mixer-channels {
  display: flex; gap: 6px; height: 100%; padding: 4px;
}
.mixer-channel {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 50px; padding: 4px;
  background: var(--bg-secondary); border-radius: 4px;
}
.mixer-channel.master { background: #1a1a2e; }
.channel-name { font-size: 10px; color: var(--text-secondary); text-align: center; }
.channel-controls { display: flex; gap: 2px; }
.mute-btn, .solo-btn {
  width: 20px; height: 18px; border: 1px solid var(--border);
  background: var(--bg-primary); color: var(--text-secondary);
  font-size: 10px; cursor: pointer; border-radius: 2px;
}
.mute-btn.active { background: var(--accent); color: white; }
.solo-btn.active { background: #2ecc71; color: white; }
.fader-container { flex: 1; display: flex; align-items: center; }
.fader {
  writing-mode: vertical-lr;
  direction: rtl;
  height: 80px; width: 20px;
  accent-color: var(--accent);
}
.pan-container { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.pan-container label { font-size: 9px; color: var(--text-secondary); }
.pan { width: 44px; accent-color: var(--text-secondary); }
.fx-toggles { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; }
.fx-btn {
  font-size: 8px; padding: 2px 4px; border: 1px solid var(--border);
  background: var(--bg-primary); color: var(--text-secondary);
  cursor: pointer; border-radius: 2px;
}
.fx-btn.active { background: var(--accent); color: white; }
```

- [ ] **Step 3: Commit**

```bash
git add app/js/ui/mixer-panel.js app/css/style.css
git commit -m "feat: mixer panel — faders, pan, mute/solo, effect toggles, meter"
```

---

### Task 19: Main Entry Point — Wire Everything Together

**Files:**
- Create: `app/js/main.js`

- [ ] **Step 1: Create main.js that initializes all modules**

`app/js/main.js`:
```javascript
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
  // Initialize audio engine
  engine.init();

  // Set up auto-save
  store.setSaveFn(async (data) => {
    if (store.projectName) {
      await api.saveProject(store.projectName, data);
    }
  });

  // Initialize UI
  initTopbar();
  initTimeline();
  initMixerPanel();

  // Editor: show piano roll by default, switch on tab change
  const editorEl = document.getElementById('editor');
  initPianoRoll(editorEl);

  store.on('editorTabChange', (tab) => {
    if (tab === 'piano-roll') {
      initPianoRoll(editorEl);
    } else if (tab === 'step-seq') {
      initStepSequencer(editorEl);
    }
  });

  // Beat handler: play notes/samples on each 16th note
  store.on('beat', ({ beat, time }) => {
    for (let t = 0; t < store.data.tracks.length; t++) {
      const track = store.data.tracks[t];
      if (track.muted) continue;

      const channel = mixer.channels[t];
      if (!channel) continue;

      // Check arrangement for active clips at this beat
      for (const clip of store.data.arrangement) {
        if (clip.trackIndex !== t) continue;

        const clipStartStep = clip.startBeat * 4; // convert beats to 16th notes
        const clipEndStep = (clip.startBeat + clip.lengthBeats) * 4;
        if (beat < clipStartStep || beat >= clipEndStep) continue;

        const localStep = beat - clipStartStep;
        const pattern = store.data.patterns[clip.patternIndex];
        if (!pattern) continue;

        // Step sequencer pattern
        if (pattern.steps) {
          const stepIdx = localStep % (pattern.stepCount || 16);
          for (const row of pattern.steps) {
            if (row.cells[stepIdx]) {
              const velocity = (row.velocities && row.velocities[stepIdx]) || 100;
              const gain = velocity / 127;
              if (row.sampleRef) {
                sampler.play(row.sampleRef, time, channel.input, { playbackRate: gain });
              }
            }
          }
        }

        // Piano roll pattern
        if (pattern.notes) {
          const spb = engine._secondsPerBeat() / 4; // seconds per 16th note
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

  // Load project or show project picker
  await showProjectPicker();
}

async function showProjectPicker() {
  const projects = await api.listProjects();

  const dialog = document.createElement('div');
  dialog.id = 'project-picker';
  dialog.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);
    display:flex;align-items:center;justify-content:center;z-index:1000;
  `;
  dialog.innerHTML = `
    <div style="background:var(--bg-secondary);padding:24px;border-radius:8px;min-width:300px;">
      <h2 style="color:var(--accent);margin-bottom:16px;">M8S</h2>
      <div style="margin-bottom:16px;">
        <input id="new-project-name" placeholder="New project name..."
          style="width:100%;padding:8px;background:var(--bg-primary);border:1px solid var(--border);
          color:var(--text-primary);border-radius:4px;">
      </div>
      <button id="create-project-btn" style="background:var(--accent);color:white;border:none;
        padding:8px 16px;border-radius:4px;cursor:pointer;margin-bottom:16px;">Create New Project</button>
      ${projects.length > 0 ? `
        <h3 style="color:var(--text-secondary);margin-bottom:8px;">Open Existing</h3>
        <div style="max-height:200px;overflow-y:auto;">
          ${projects.map(name => `
            <div class="project-item" data-name="${name}" style="padding:8px;cursor:pointer;
              border-bottom:1px solid var(--border);color:var(--text-primary);">
              ${name}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
  document.body.appendChild(dialog);

  // Create new project
  document.getElementById('create-project-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-project-name').value.trim();
    if (!name) return;
    await api.createProject(name);
    await loadProject(name);
    dialog.remove();
  });

  // Open existing project
  dialog.querySelectorAll('.project-item').forEach(el => {
    el.addEventListener('click', async () => {
      await loadProject(el.dataset.name);
      dialog.remove();
    });
    el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-panel)');
    el.addEventListener('mouseleave', () => el.style.background = 'transparent');
  });
}

async function loadProject(name) {
  const data = await api.getProject(name);
  store.load(name, data);

  // Create mixer channels for existing tracks
  for (const track of data.tracks) {
    mixer.createChannel(track.name);
  }

  // Preload samples
  await sampler.preloadProject();
}

// Start on user interaction (AudioContext requires gesture)
document.addEventListener('click', function firstClick() {
  document.removeEventListener('click', firstClick);
  init();
}, { once: true });

// Fallback: init immediately if no audio context restrictions
init();
```

- [ ] **Step 2: Commit**

```bash
git add app/js/main.js
git commit -m "feat: main entry point — wires all modules, project picker, beat playback"
```

---

### Task 20: Generate Starter Kit Samples

**Files:**
- Create: `scripts/generate-kit.py`

- [ ] **Step 1: Create a Python script that generates basic drum samples using synthesis**

`scripts/generate-kit.py`:
```python
"""Generate starter kit samples using synthesis. No external dependencies."""
import struct
import math
import os
import wave

KIT_DIR = os.path.join(os.path.dirname(__file__), '..', 'kit')
SAMPLE_RATE = 44100


def write_wav(filename, samples, sample_rate=SAMPLE_RATE):
    path = os.path.join(KIT_DIR, filename)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for s in samples:
            clamped = max(-1.0, min(1.0, s))
            w.writeframes(struct.pack('<h', int(clamped * 32767)))


def kick_punchy():
    duration = 0.4
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 150 * math.exp(-t * 10) + 40
        env = math.exp(-t * 8)
        samples.append(math.sin(2 * math.pi * freq * t) * env * 0.9)
    return samples


def kick_deep():
    duration = 0.5
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 80 * math.exp(-t * 6) + 30
        env = math.exp(-t * 5)
        samples.append(math.sin(2 * math.pi * freq * t) * env * 0.95)
    return samples


def kick_acoustic():
    duration = 0.35
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 200 * math.exp(-t * 15) + 50
        env = math.exp(-t * 10)
        noise = (hash(i) % 2000 - 1000) / 1000.0
        samples.append((math.sin(2 * math.pi * freq * t) * 0.8 + noise * 0.2 * math.exp(-t * 30)) * env)
    return samples


def snare_crisp():
    duration = 0.25
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        tone = math.sin(2 * math.pi * 200 * t) * math.exp(-t * 20)
        noise = (hash(i * 7) % 2000 - 1000) / 1000.0 * math.exp(-t * 12)
        samples.append((tone * 0.4 + noise * 0.6) * 0.9)
    return samples


def snare_clap():
    duration = 0.3
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        noise = (hash(i * 13) % 2000 - 1000) / 1000.0
        env = math.exp(-t * 10)
        # Multiple short bursts for clap texture
        burst = sum(math.exp(-(t - d) * 100) for d in [0, 0.01, 0.02] if t >= d)
        samples.append(noise * env * min(burst, 1) * 0.8)
    return samples


def snare_rimshot():
    duration = 0.15
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        tone = math.sin(2 * math.pi * 400 * t) * math.exp(-t * 30)
        click = math.exp(-t * 200)
        samples.append((tone * 0.5 + click * 0.5) * 0.9)
    return samples


def hihat_closed():
    duration = 0.08
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        noise = (hash(i * 17) % 2000 - 1000) / 1000.0
        env = math.exp(-t * 60)
        # Bandpass-like by mixing high freq tones
        hp = math.sin(2 * math.pi * 8000 * t) + math.sin(2 * math.pi * 10000 * t)
        samples.append((noise * 0.6 + hp * 0.4) * env * 0.5)
    return samples


def hihat_open():
    duration = 0.4
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        noise = (hash(i * 19) % 2000 - 1000) / 1000.0
        env = math.exp(-t * 6)
        hp = math.sin(2 * math.pi * 8000 * t) + math.sin(2 * math.pi * 11000 * t)
        samples.append((noise * 0.6 + hp * 0.4) * env * 0.5)
    return samples


def hihat_pedal():
    duration = 0.12
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        noise = (hash(i * 23) % 2000 - 1000) / 1000.0
        env = math.exp(-t * 35)
        samples.append(noise * env * 0.4)
    return samples


def bass_808(freq=55):
    duration = 0.8
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        pitch = freq * (1 + 0.5 * math.exp(-t * 20))
        env = math.exp(-t * 3)
        # Slight distortion
        s = math.sin(2 * math.pi * pitch * t) * env
        s = max(-0.8, min(0.8, s * 1.5))
        samples.append(s)
    return samples


def shaker():
    duration = 0.1
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        noise = (hash(i * 31) % 2000 - 1000) / 1000.0
        env = math.exp(-t * 30) * math.sin(math.pi * t / duration)
        samples.append(noise * env * 0.3)
    return samples


def cowbell():
    duration = 0.3
    n = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        tone = (math.sin(2 * math.pi * 587 * t) + math.sin(2 * math.pi * 845 * t)) * 0.5
        env = math.exp(-t * 12)
        samples.append(tone * env * 0.6)
    return samples


if __name__ == '__main__':
    os.makedirs(KIT_DIR, exist_ok=True)

    kit = {
        'kick-punchy.wav': kick_punchy(),
        'kick-deep.wav': kick_deep(),
        'kick-acoustic.wav': kick_acoustic(),
        'snare-crisp.wav': snare_crisp(),
        'snare-clap.wav': snare_clap(),
        'snare-rimshot.wav': snare_rimshot(),
        'hihat-closed.wav': hihat_closed(),
        'hihat-open.wav': hihat_open(),
        'hihat-pedal.wav': hihat_pedal(),
        '808-bass-C1.wav': bass_808(32.7),
        '808-bass-E1.wav': bass_808(41.2),
        '808-bass-A1.wav': bass_808(55),
        'perc-shaker.wav': shaker(),
        'perc-cowbell.wav': cowbell(),
    }

    for filename, samples in kit.items():
        write_wav(filename, samples)
        print(f'  Generated {filename} ({len(samples)} samples)')

    print(f'\nDone — {len(kit)} samples in {KIT_DIR}')
```

- [ ] **Step 2: Run the script to generate samples**

Run: `cd /home/eastill/projects/m8s && python3 scripts/generate-kit.py`
Expected: 14 .wav files in `kit/`

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-kit.py kit/
git commit -m "feat: starter kit — synthesized drum and 808 samples"
```

---

### Task 21: Smoke Test — Full Startup

**Files:** none new — integration verification

- [ ] **Step 1: Install server dependencies and start the server**

```bash
cd /home/eastill/projects/m8s/server
pip install -r requirements.txt
```

- [ ] **Step 2: Run all server tests**

Run: `cd /home/eastill/projects/m8s/server && python -m pytest test_routes.py -v`
Expected: All PASS

- [ ] **Step 3: Start the server and verify the app loads**

```bash
cd /home/eastill/projects/m8s/server
python -m uvicorn main:app --port 8000 &
sleep 2
curl -s http://localhost:8000/ | head -5
curl -s http://localhost:8000/api/kit | python -m json.tool
kill %1
```

Expected: HTML page with "M8S" in title, and kit listing JSON with sample filenames.

- [ ] **Step 4: Add .gitignore and commit**

Create `.gitignore`:
```
__pycache__/
*.pyc
.superpowers/
node_modules/
```

```bash
git add .gitignore
git commit -m "chore: add .gitignore, verify full startup works"
```
