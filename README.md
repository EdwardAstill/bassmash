# m8s

**m8s** — *music 80s session*. A browser-based DAW with a text-editable project format and an MCP server so AI agents can compose alongside you.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    your browser  ·  localhost:8000                   │
│  ┌───┬──────────────────────────────────────────────────┬─────────┐  │
│  │ ① │ ② toolbar · ruler · markers                       │ ④ insp. │  │
│  │ h │ ──────────────────────────────────────────────── │         │  │
│  │ d │ ⑤ track lanes / clips / playhead                 │         │  │
│  │ r │                                                   │         │  │
│  ├───┼──────────────────────────────────────────────────┼─────────┤  │
│  │ ③ │ ⑦ workbench: mixer / piano-roll / synth /        │ ⑧ util. │  │
│  │ b │     automation / sampler                         │         │  │
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
           ~/m8s-projects/<name>/project.json
```

Three authors, one filesystem:

- **Browser** — drag, drop, draw. Autosaves every 2 s (10 s max delay).
- **CLI** (`m8s-cli`) — `bpm set`, `track add`, `pattern step-row …`. Shell-scriptable.
- **MCP server** — structured tool calls for AI agents. `generate_beat`, `replicate_from_audio`, `set_track_automation`, `set_synth_params`, and 18 more.

Every write atomically lands in `project.json` via `cli/store.py` (tempfile + fsync + os.replace). Every edit propagates back to the open browser tab within ~500 ms via server-sent events. No reload button.

---

## Quickstart

```bash
git clone https://github.com/EdwardAstill/m8s.git
cd m8s
uv sync                               # installs Python deps
uv tool install --editable .          # puts m8s-cli on PATH
bun install                           # optional — only for bun run dev
bun run dev                           # starts FastAPI on :8000
# or: uv run uvicorn server.main:app --reload --port 8000
open http://localhost:8000
```

Click anywhere in the page to unlock audio (browser autoplay policy). Drag a kit sample from the left panel onto a lane. Hit space — kick plays.

From another terminal:

```bash
m8s-cli project list
m8s-cli bpm set demo-beat 160
```

The browser tab updates in place — no refresh needed.

### MCP client setup (optional — for AI agents)

```bash
cd mcp-server && uv sync
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "m8s-mcp": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/m8s/mcp-server",
               "run", "python", "server.py"]
    }
  }
}
```

Restart the client. Tools appear as `mcp__m8s-mcp__<name>` — see [`docs/mcp.md`](docs/mcp.md) for the full 22-tool catalog.

---

## Project layout on disk

```
~/m8s-projects/<name>/
├── project.json            # the whole project — see docs/project-format.md
├── samples/                # drum one-shots (drop files here; addressable as filename)
├── audio/                  # uploaded audio clips — .mp3 .wav .ogg .flac .aif .aiff
└── export.mp3              # most recent File → Export render
```

The built-in drum kit ships in `kit/` under the repo and is served at `kit://<filename>`. Every IO goes through `cli/store.py` — atomic tempfile + fsync + rename, so a crash mid-save never leaves a half-written project.

### Environment overrides

```bash
M8S_PROJECTS_DIR=/path/to/projects   # defaults to ~/m8s-projects
M8S_KIT_DIR=/path/to/kit             # defaults to <repo>/kit
```

The backend, CLI, and MCP server all honor these — set them in one place and everyone agrees.

---

## Browser features

Open `http://localhost:8000`. File menu → Open Project to switch.

- **Arrangement timeline** with dynamic track lanes, per-clip drag / resize / split / erase / mute, real decimated waveforms on audio clips
- **Mixer** with faders, M/S/R, per-track EQ / distortion / delay / reverb, and two global buses (A = reverb, B = delay) with real send routing and per-send gain knobs
- **Piano-roll** 16-step drum grid with velocity drag and Alt-click ghost-note mutes
- **Synth tab** — oscillator waveform picker (sine/triangle/saw/square), filter (type + cutoff + Q), interactive ADSR envelope graph with drag handles
- **Automation lanes** for 9 params: volume, pan, sends, FX wet, EQ bands
- **Sampler tab** — per-pad gain / pitch / loop knobs, sample picker, audition button
- **Markers and tempo changes** on the global strip (drag to move, right-click for Rename / Delete / Change BPM)
- **MP3 export** — `File → Export as MP3` does an OfflineAudioContext render → server-side ffmpeg → download
- **Undo/redo** — Ctrl/Cmd+Z, Shift+Z, 50-deep snapshot stack, 250 ms debounce
- **Live reload** from CLI / MCP edits — within ~500 ms, inspector focus preserved

---

## CLI

Direct filesystem edits. See [`docs/cli.md`](docs/cli.md) for the full reference.

```bash
m8s-cli project create my-song
m8s-cli bpm set my-song 140
m8s-cli track add my-song --name Kick --kind sample
m8s-cli pattern add-drums my-song --name Beat --steps 16
m8s-cli pattern step-row my-song 0 --name Kick \
    --sample kit://kick-deep.wav --cells "1000 0000 1000 0000"
m8s-cli arrange add my-song --track 0 --pattern 0 --start 0 --length 4
```

---

## MCP (AI session)

`mcp-server/server.py` exposes 22 structured tools. Highlights:

- `generate_beat` — full multi-track beat from a text prompt (genre, BPM, elements)
- `replicate_from_audio` — analyses an MP3 and recreates the drum pattern + tempo
- `edit_drum_pattern`, `edit_notes`, `mix_track`, `set_effects`, `set_arrangement` — core editing
- `set_track_sends`, `set_track_automation`, `set_synth_params` — routing, breakpoint lanes, synth osc/filter/ADSR
- `set_tempo_changes`, `set_markers`, `rename_track`, `delete_track`, `duplicate_project` — structure
- `list_projects`, `get_project`, `list_kit_samples` — read-only inspection

See [`docs/mcp.md`](docs/mcp.md) for every signature + example.

### When to reach for what

| Surface | Best for |
|---|---|
| Browser | Human, live, mouse + keyboard. |
| CLI | Humans at a terminal, shell scripts, CI. |
| MCP | AI agents — validated args, high-level ops (`generate_beat`). |
| HTTP API | External tooling. Same endpoints the browser uses. |
| Raw `Edit` on `project.json` | Escape hatch. All three surfaces above are preferred. |

All five end at the same atomic write and the same SSE stream.

---

## Architecture at a glance

```
app/                      # frontend (vanilla ES modules, no bundler)
  index.html
  css/style.css
  js/
    main.js               # boot: audio init, project load, zone wiring
    state.js              # StateStore + event bus
    api.js                # typed HTTP client + SSE subscription
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
        piano-roll.js, automation.js, sampler-panel.js, synth-panel.js
      zones/
        header.js, toolbar.js, browser.js, inspector.js,
        global-strip.js, arrangement.js, clip-interactions.js,
        workbench.js, mixer.js, utility.js, status-bar.js

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
  server.py               # 22 tools wired to cli/store + cli/project_ops
  pyproject.toml

kit/                      # built-in drum kit (served as kit://<filename>)
docs/
  cli.md                  # full CLI reference
  mcp.md                  # full MCP tool catalog with signatures + examples
  api.md                  # HTTP endpoints + SSE format
  project-format.md       # project.json schema (tracks / patterns / arrangement / …)
  development.md          # setup, tests, conventions, contributing
```

See [`NEXT_STEPS.md`](NEXT_STEPS.md) for a session-style snapshot of what's recently landed and what's deferred.

---

## Testing

```bash
uv run pytest              # 119 tests, ~1 s
```

- `server/test_routes.py` — HTTP + SSE headers + path traversal + rename/delete + atomic-write delegation
- `cli/test_store.py` — store atomicity under simulated crashes
- `cli/test_project_ops.py` — pure-function invariants
- `cli/test_main.py` — end-to-end Typer CLI integration

Frontend has no automated suite. Use the headless Playwright smoke documented in [`docs/development.md`](docs/development.md) before merging UI changes.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser silent even after clicking ▶ | Click anywhere in the page *first* — browser autoplay policy requires a user gesture before the `AudioContext` is allowed to `resume()`. |
| CLI edits don't show in browser | Confirm the browser + server + CLI all resolve the same `$M8S_PROJECTS_DIR`. Default is `~/m8s-projects`. |
| MCP tool not found after code changes | MCP stdio servers don't hot-reload. Restart your MCP client (Claude Desktop / Code) to reload the tool catalog. |
| "ffmpeg not found" on export | Install ffmpeg system-wide (`sudo apt install ffmpeg`, `brew install ffmpeg`, etc). |
| Port 8000 in use | `uv run uvicorn server.main:app --port 8001` and open http://localhost:8001. |
| File menu dropdown clipped | Should not happen on current main — both export-menu and project-picker use `position: fixed` + `z-index: 1200`. Hard-reload to ensure latest JS. |
| Tests hang on SSE | Use `asyncio.wait_for` to bound — in-process SSE concurrent reader + writer is awkward over the ASGI transport. The `project-updated` flow is exercised via the headless browser smoke instead. |

---

## Licence

No licence file yet — treat as "all rights reserved" until one is added.
