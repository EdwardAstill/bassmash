# Bassmash

A browser-based DAW with a text-editable project format and an MCP server so AI agents can compose alongside you.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    your browser  ·  localhost:8000                   │
│  ┌───┬──────────────────────────────────────────────────┬─────────┐  │
│  │ ① │ ② toolbar · ruler · markers                       │ ④ insp. │  │
│  │ h │ ──────────────────────────────────────────────── │         │  │
│  │ d │ ⑤ track lanes / clips / playhead                 │         │  │
│  │ r │                                                   │         │  │
│  ├───┼──────────────────────────────────────────────────┼─────────┤  │
│  │ ③ │ ⑦ workbench: mixer / piano-roll / automation     │ ⑧ util. │  │
│  │ b │     / sampler                                    │         │  │
│  ├───┴───────────────────────────────────────────────────┴─────────┤  │
│  │ ⑨ status: engine · latency · cpu · autosave · project           │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
             │                   │                   │
       PUT / GET           edits files         polls mtime
             │                   │                   │
             ▼                   ▼                   ▼
        FastAPI          cli/store.py           SSE stream
             │                   │                   │
             └─────────┬─────────┴───────────────────┘
                       ▼
           ~/bassmash-projects/<name>/project.json
```

Three authors, one filesystem:

- **Browser** — drag, drop, draw. Autosaves every 2 s.
- **CLI** (`bassmash-cli`) — `bpm set`, `track add`, `pattern step-row …`. Shell-scriptable.
- **MCP server** — structured tool calls for AI agents. `generate_beat`, `replicate_from_audio`, `edit_drum_pattern`.

Every write goes through the same atomic `cli/store.py`. Every edit propagates back to the open browser tab within ~500 ms via server-sent events.

---

## Quickstart

```bash
git clone https://github.com/EdwardAstill/bassmash.git
cd bassmash
uv sync                               # installs Python deps
uv tool install --editable .          # puts bassmash-cli on PATH
bun install                           # optional — only for `bun run dev`
bun run dev                           # starts FastAPI on :8000
open http://localhost:8000
```

Click anywhere in the page to unlock audio. Drag a kit sample from the left panel onto a lane. Hit space. You should hear a kick.

From another terminal:

```bash
bassmash-cli project list
bassmash-cli bpm set demo-beat 160
```

The browser tab updates in place — no reload.

---

## Project layout

```
~/bassmash-projects/<name>/
├── project.json            # full serialized project (bpm, tracks, patterns, arrangement, markers, tempoChanges, …)
├── samples/                # drum one-shots (kit-style samples referenced as sample://<filename>)
├── audio/                  # uploaded audio files — .mp3 .wav .ogg .flac .aif .aiff
└── export.mp3              # most recent File → Export render
```

The built-in drum kit ships in `kit/` under the repo and is served at `kit://<filename>`. Both directories are atomically written via `cli/store.py` (tempfile + fsync + os.replace), so a crash mid-save never leaves a half-written project.

### Environment overrides

```bash
BASSMASH_PROJECTS_DIR=/path/to/projects   # defaults to ~/bassmash-projects
BASSMASH_KIT_DIR=/path/to/kit             # defaults to <repo>/kit
```

---

## Authoring paths

### Browser

Open `http://localhost:8000`. File → Open Project to switch. Features:

- Arrangement timeline with dynamic track lanes and per-clip drag / resize / split / erase / mute
- Mixer with faders, M/S/R, per-track EQ / distortion / delay / reverb, and two buses (A=reverb, B=delay) with real send routing
- Piano-roll style 16-step drum grid with velocity drag and Alt-click ghost-note mutes
- Automation lanes for volume, pan, sends, FX wet mix, and EQ bands
- Sampler tab — per-pad gain / pitch / loop knobs, sample picker
- Markers and tempo changes on the global strip (drag to move, right-click for menu)
- MP3 export (File → Export as MP3) via offline render + server-side ffmpeg
- Undo/redo — Ctrl/Cmd+Z / Shift+Z, 50-deep snapshot stack

### CLI

Direct filesystem edits. See [`docs/cli.md`](docs/cli.md) for the full reference.

```bash
bassmash-cli project create my-song
bassmash-cli bpm set my-song 140
bassmash-cli track add my-song --name Kick --kind sample
bassmash-cli pattern add-drums my-song --name Beat --steps 16
bassmash-cli pattern step-row my-song 0 --name Kick \
    --sample kit://kick-deep.wav --cells "1000 0000 1000 0000"
bassmash-cli arrange add my-song --track 0 --pattern 0 --start 0 --length 4
```

### MCP (AI session)

Bassmash ships an MCP server so Claude (or any MCP client) can compose with structured tool calls instead of raw file edits. See [`docs/mcp.md`](docs/mcp.md) for the full tool catalog. Headline:

- `generate_beat` — produces a full multi-track beat from a text prompt (genre, BPM, elements)
- `replicate_from_audio` — analyses an MP3 and recreates its drum pattern + tempo
- `edit_drum_pattern`, `edit_notes`, `mix_track`, `set_effects`, `set_arrangement` — core editing
- `set_track_sends`, `set_track_automation`, `set_synth_params` — routing, breakpoint lanes, synth config
- `set_tempo_changes`, `set_markers`, `rename_track` — arrangement metadata
- …and the rest (22 tools total)

Connect your MCP client to `mcp-server/server.py` — see the MCP doc for config details.

### HTTP API

The browser uses a small REST surface. See [`docs/api.md`](docs/api.md). External tooling can use the same endpoints if it prefers HTTP over files.

---

## Architecture at a glance

```
app/                      # frontend (vanilla ES modules, no bundler)
  index.html
  css/style.css
  js/
    main.js               # boot: audio init, project load, zone wiring
    state.js              # StateStore + event bus
    api.js                # typed HTTP client
    undo.js               # 50-deep JSON snapshot stack
    audio/
      engine.js           # AudioContext + beat scheduler
      tempo.js            # bpmAtBeat(data, beat) — shared
      mixer.js            # MixerChannel graph, buses, sends
      sampler.js          # buffer playback
      effects.js          # EQ / dist / delay / reverb chain
      scheduler.js        # pattern + audio clip triggers, automation ramps
      offline-render.js   # mirror of scheduler for OfflineAudioContext → WAV
      audio-cache.js      # Promise<AudioBuffer> cache
      waveform-peaks.js   # decimated peaks for audio clip canvases
      automation-util.js  # clampAutomationValue(paramKey, v) — shared
    ui/
      knob.js             # shared vertical-drag knob helper
      context-menu.js     # shared right-click menu
      modal.js            # async confirm/prompt
      tab-bar.js, track-manager.js, project-picker.js, export-menu.js
      workbench/
        piano-roll.js, automation.js, sampler-panel.js
      zones/
        header.js         # transport, BPM, time
        toolbar.js        # tool registry, V/B/C/G/M/E/Z/P shortcuts
        browser.js        # sample tree, Files tab, drag source
        inspector.js      # selected-track focus panel
        global-strip.js   # ruler, markers, tempo
        arrangement.js    # lanes, clips, drop targets, playhead
        clip-interactions.js
        workbench.js      # tab swap
        mixer.js          # channel strips, sends, live gain read
        utility.js        # notes / help / history
        status-bar.js     # engine / latency / CPU / autosave / project chips

server/                   # FastAPI
  main.py                 # app + static mount at /
  routes.py               # /api/projects, /api/kit, /api/samples, /api/audio, /api/export
                          # plus SSE /api/projects/{name}/events

cli/                      # Python — filesystem-direct project IO
  store.py                # single source of truth for disk IO (atomic writes, env overrides)
  project_ops.py          # pure-function mutations
  main.py                 # Typer CLI entrypoint
  analysis.py             # librosa BPM/key/loudness analysis

mcp-server/               # Model Context Protocol wrapper
  server.py               # ~16 tools wired to cli/project_ops + cli/store

kit/                      # built-in drum kit (served as kit://<filename>)
docs/                     # full references: cli.md, mcp.md, api.md, development.md
```

See [`NEXT_STEPS.md`](NEXT_STEPS.md) for the full store shape, event bus catalog, and deferred items. See [`docs/development.md`](docs/development.md) for dev setup, testing, and contributing notes.

---

## Testing

```bash
uv run pytest                          # 119 tests, ~1 s
uv run pytest server/                  # HTTP + SSE endpoint coverage
uv run pytest cli/                     # store + project_ops + Typer CLI integration
```

Frontend is exercised via a headless Playwright walkthrough — see `docs/development.md`.

---

## Licence

No licence file yet. Treat as "all rights reserved" until one is added.
