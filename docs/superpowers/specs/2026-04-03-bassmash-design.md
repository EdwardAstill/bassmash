# Bassmash — Lite DAW Design Spec

A browser-based music production app (lite DAW) focused on hip-hop/trap production. Vanilla JS + Web Audio API frontend, Python companion server for file I/O.

## Architecture

Three layers:

1. **Companion Server** (Python) — localhost HTTP server. Handles project file I/O, serves static files, encodes MP3 exports.
2. **Audio Engine** (Web Audio API) — in-browser. Manages audio graph, transport, scheduling, synth, sample playback, effects, offline rendering.
3. **UI Layer** (Vanilla JS + Canvas) — DOM for controls/panels, Canvas for timeline/piano roll/step sequencer grids. Central state store drives both UI and audio engine.

### Data Flow

```
Project Folder <-> Companion Server <-> UI State Store <-> Audio Engine
                    (REST API)          (in-memory)       (Web Audio)
```

The UI state store is the single source of truth at runtime. It syncs to disk via the companion server on save. The audio engine reads from the store but never writes to it — UI actions update the store, which triggers audio graph changes.

## Project Structure

A project is a folder on disk:

```
my-track/
├── project.json        # All state: tracks, patterns, arrangement, BPM, etc.
└── samples/            # Audio files used in the project
    ├── kick.wav
    ├── 808-bass.wav
    └── hihat.wav
```

- `project.json` contains: track definitions, pattern data (step sequences and piano roll notes), arrangement (which patterns play where), mixer settings (volume, pan, effects per track), BPM, time signature.
- Samples referenced by relative path (`samples/kick.wav`).
- Importing a sample copies it into the project's `samples/` folder.
- Starter kit samples referenced by prefix (`kit://808-kick.wav`) to avoid duplication across projects.

## Companion Server API

Python (Flask or FastAPI), runs on localhost.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List project folders |
| POST | `/projects` | Create new project |
| GET | `/projects/:name` | Read project.json |
| PUT | `/projects/:name` | Write project.json (auto-save) |
| POST | `/projects/:name/samples` | Upload sample into project |
| GET | `/projects/:name/samples/:file` | Serve sample file |
| GET | `/kit` | List starter kit samples |
| GET | `/kit/:file` | Serve starter kit sample |
| POST | `/projects/:name/export` | Write MP3 (receives rendered audio buffer, encodes via ffmpeg) |
| GET | `/` | Serve web app static files |

Auto-save: UI debounces state changes and PUTs the full `project.json` every few seconds.

## Audio Engine

### Transport

Central clock using `AudioContext.currentTime`. Lookahead scheduling pattern: scheduler runs every ~25ms, schedules notes/events ~100ms ahead for gapless playback.

### Synth Engine

Subtractive synthesis with two modes (toggled in UI):

**Simple mode:**
- 1 oscillator (sine/saw/square/triangle)
- 1 filter (lowpass/highpass/bandpass)
- 1 amplitude envelope (ADSR)

**Advanced mode (adds):**
- 2nd oscillator with detune
- 2nd envelope for filter cutoff
- LFO routable to pitch/filter/amplitude

### Sample Playback

- `AudioBufferSourceNode` per hit
- Samples loaded into `AudioBuffer` cache on project open
- Supports one-shot (drums) and looped playback

### Effects Chain (per track)

```
Source -> EQ (3-band BiquadFilters) -> Distortion (WaveShaperNode) -> Delay (DelayNode + feedback) -> Reverb (ConvolverNode) -> Gain/Pan -> Master Bus
```

- Each effect has wet/dry mix
- Effects bypassed by default, enabled per track

### Mixer

- Per track: `GainNode` (volume) + `StereoPannerNode` (pan) -> master bus
- Master bus: `GainNode` + `AnalyserNode` for metering

### MP3 Export

`OfflineAudioContext` renders the full arrangement. Resulting buffer sent to companion server, which encodes to MP3 via ffmpeg.

## UI Layout (Ableton-style)

### Top Bar: Transport + Globals
- Play, stop, record (step input)
- BPM input, time signature
- Project name, save indicator
- Simple/Advanced synth mode toggle

### Top Panel: Timeline/Arrangement
- Horizontal tracks with track names + mute/solo buttons on left
- Colored blocks = pattern clips on timeline
- Click to select, double-click to open in editor
- Drag to move/resize clips, right-click for delete/duplicate
- Playhead cursor, loop region markers
- Rendered on Canvas

### Bottom-Left Panel: Editor
- Tabs: piano roll / step sequencer for selected track
- **Piano roll:** Canvas grid. Vertical = notes, horizontal = time. Click/drag to place/resize notes. Velocity = opacity/color intensity.
- **Step sequencer:** 16-step grid (expandable to 32/64). Toggle cells on/off. Velocity via click-drag up/down.

### Bottom-Right Panel: Mixer
- Vertical faders (volume), knob (pan) per track
- Effect enable/bypass toggles per track
- Click effect to open parameter popup with knobs
- Master fader + animated level meter (via AnalyserNode)

## Starter Kit

~30 royalty-free samples bundled with the server, hip-hop/trap focused:

**Drums:**
- Kicks: 3-4 variants (punchy, deep, acoustic)
- Snares: 3-4 variants (crisp, clap, rimshot)
- Hi-hats: closed, open, pedal
- 808 bass: 2-3 tuned sub bass one-shots
- Percussion: shaker, tambourine, cowbell

**Misc:**
- Vocal chops: 2-3 one-shots ("hey", "yeah")
- FX: riser, downlifter, vinyl scratch

## Tech Stack Summary

- **Frontend:** Vanilla JS (ES modules), Web Audio API, Canvas
- **Server:** Python (Flask or FastAPI)
- **MP3 encoding:** ffmpeg (called by server)
- **Browser support:** All modern browsers (Chrome, Firefox, Edge, Safari)
- **No build tooling** — ES modules loaded directly
