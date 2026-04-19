# Bassmash — Session Checkpoint 2026-04-19 (post-delivery)

Supersedes the earlier checkpoint that listed P1–P3 as pending.

All P1/P2/P3 items from the prior checkpoint are now delivered. Verified with 117 backend tests + a headless Firefox walkthrough showing zero console errors across every feature (transport, all 4 workbench tabs, all 3 browser tabs, File menu, project picker, send toggle, autosave, status chips).

---

## What landed this session

### Backend
- `server/routes.py` consolidated on `cli/store.py` for atomic project IO (tmp + fsync + os.replace).
- Path-traversal guards on every user-controlled path param (`_safe_name` + `_resolve_inside`).
- `PUT /api/projects/{n}/audio/{filename}` (rename) and `DELETE /api/projects/{n}/audio/{filename}` endpoints.
- `.aif/.aiff` added to the supported audio-extension set (backend/frontend match).
- Pytest: `asyncio_mode=auto` + deprecation filters. 19 → 117 tests: `server/test_routes.py` (46), `cli/test_store.py` (17), `cli/test_project_ops.py` (35), `cli/test_main.py` (19).

### Frontend — P1
- **MP3 export** (`app/js/audio/offline-render.js` + `app/js/ui/export-menu.js`) — OfflineAudioContext bounce → WAV → POST → server ffmpeg → MP3 download. Status chip progress.
- **Real waveforms on audio clips** (`app/js/audio/waveform-peaks.js`) — O(N) peak decimation, LRU cache, HiDPI canvas.

### Frontend — P2
- **Send routing** — real `mixer.connectSend/disconnectSend/setSendGain`, bus A (reverb) + bus B (delay), persisted as `track.sends[]` + `track.sendGains[]`. Mirrored in offline-render.
- **Automation tab** (`app/js/ui/workbench/automation.js`) — breakpoint editor for track volume, scheduler ramps per 16th with `setValueAtTime`/`linearRampToValueAtTime`, offline-render mirrors via cumulative step-time table.
- **Sampler tab** (`app/js/ui/workbench/sampler-panel.js`) — drum-rack editor, per-pad gain/pitch/loop knobs, sample picker, audition.
- **Piano-roll velocity drag + Alt-click mute** — draggable handle per cell, `row.muted[]` ghost notes honored in scheduler + offline-render.

### Frontend — P3
- **File tab in browser** — list + rename + delete + picker-upload, with drag payload carrying `kind: "audio" | "sample"` so arrangement drop handler branches correctly.
- **Markers + tempo drag** (`app/js/ui/zones/global-strip.js`) — drag markers, double/shift+click to rename, click tempo row to add tempo change.
- **Tempo-change scheduler wire-up** (`app/js/audio/tempo.js`) — shared `bpmAtBeat(data, beat)` consumed by engine + scheduler + offline-render; engine retimes per 16th.
- **CPU meter + autosave chip** in status bar.
- **Project picker** — File → Open Project… / New Project… modal.
- **Send gain knob** in inspector with live ramp.
- **Fader/knob automation sync** — mixer fader + inspector volume knob read live `gain.value` during playback; user drag wins while pointer down (`mixer.cancelAutomationAfter`).
- **P-key → Piano Roll**, **EQ bypass** (`setEqEnabled`), **Routing display** (Master + Bus A/B), **currentTool localStorage persistence**.
- **Dynamic lanes + track rows** and **dynamic mixer strips** (was already delivered pre-session — confirmed in the initial audit).

### Cleanup
- Deleted 1159 lines of pre-9-zone orphans: `app/js/ui/{topbar,timeline,mixer-panel,step-sequencer}.js`, `app/js/audio/{export,waveform}.js`. Zero importers confirmed first.

---

## Architecture today

```
app/
  index.html                 9-zone Dock-style layout
  css/style.css              design tokens, per-track `data-color` palette
  js/
    main.js                  boot: audio init, project load, zone wiring, window.bassmash shim
    state.js                 StateStore + event bus (change/loaded/saved/saving/saveFailed/beat/tick/…)
    api.js                   typed HTTP client
    undo.js                  50-deep JSON snapshot stack, 250 ms debounce
    audio/
      engine.js              AudioContext + tick loop — emits 'beat' at variable tempo
      tempo.js               bpmAtBeat / secondsPerBeatAt — shared helper
      mixer.js               MixerChannel graph + buses[] + connectSend/setSendGain
      sampler.js             buffer playback
      effects.js             EQ/dist/delay/reverb chain + setEqEnabled bypass
      scheduler.js           pattern + audio clip triggers, automation ramps, tempo-aware
      offline-render.js      mirror of scheduler for OfflineAudioContext → WAV
      audio-cache.js         shared Promise<AudioBuffer> cache
      waveform-peaks.js      decimated peaks for audio-clip canvases
    ui/
      tab-bar.js             generic tab helper
      track-manager.js       + Add track / × delete / right-click menu
      project-picker.js      File → Open/New modal
      export-menu.js         File → Export as MP3
      workbench/
        piano-roll.js        16-step drum grid, velocity drag, Alt-mute
        automation.js        track volume breakpoints
        sampler-panel.js     drum-rack per pattern row
      zones/
        header.js            transport, BPM, time (zone 1)
        toolbar.js           tool registry, V/B/C/G/M/E/Z/P (zone 2)
        browser.js           Sounds / Plugins / Files (zone 3)
        inspector.js         selected-track focus panel (zone 4)
        global-strip.js      ruler, markers, tempo (zone 5)
        arrangement.js       lanes, clips, drop targets, playhead (zone 6)
        clip-interactions.js pointer-driven select/move/resize/split/erase (zone 6 layer)
        workbench.js         tab swap orchestration (zone 7)
        mixer.js             channel strips, sends, live gain read (zone 7 Mixer)
        utility.js           Notes/Help/History tabs (zone 8)
        status-bar.js        engine/latency/CPU/autosave/project chips (zone 9)

server/
  main.py                    FastAPI + static mount
  routes.py                  /api/{projects,kit,samples,audio,export} — routes delegate IO to cli.store
  test_routes.py             46 tests

cli/
  store.py                   single source of truth for disk IO (atomic writes, env overrides)
  project_ops.py             pure-function mutations (bpm, tracks, patterns, arrangement)
  main.py                    Typer CLI — bassmash-cli project/bpm/track/pattern/arrange/…
  analysis.py                librosa-based BPM/key analysis
  test_store.py              17 tests
  test_project_ops.py        35 tests
  test_main.py               19 tests
```

### Filesystem layout (shared by CLI + server)
```
$BASSMASH_PROJECTS_DIR/<name>/
├── project.json             whole serialized project
├── samples/                 drum one-shots
├── audio/                   uploaded audio (.mp3 .wav .ogg .flac .aif .aiff)
└── export.mp3               last MP3 render
$BASSMASH_KIT_DIR/           built-in drum kit served at kit://<filename>
```

### Store event bus
`change`, `loaded`, `saved`, `saving`, `saveFailed`, `transport`, `beat`, `tick`, `engineReady`, `trackSelected`, `clipSelected`, `toolChanged`, `seek`, `audioFilesChanged`, `sendChanged`, `trackSendsChanged`, `mixerLiveGain`.

### `store.data` shape
```
{
  bpm, timeSignature,
  tracks: [{ name, type, muted, soloed, color, volume, pan, effects, sends, sendGains, automation, width }],
  patterns: [{ name, type, stepCount | length, steps: [{ sampleRef, cells, velocities, muted, gain, pitch, loop }] | notes: [{pitch,start,duration,velocity}] }],
  arrangement: [{ trackIndex, patternIndex?, type: 'pattern'|'audio', startBeat, lengthBeats, audioRef?, offset?, muted? }],
  markers: [{ name, beat }],
  tempoChanges: [{ beat, bpm }],
}
```
`store` (non-serialized runtime): `selectedTrack`, `selectedClip`, `currentBeat`, `playing`, `currentTool`, `audioFiles[]`, `projectName`.

---

## Known deferred items (not bugs, scoped-out during implementation)

- **Automation beyond volume** — pan, sends, FX mix use the same breakpoint shape but the UI only exposes volume.
- **In-DAW confirm/prompt dialogs** — rename and delete currently use `window.prompt` / `window.confirm`. Fine UX but not on-brand.
- **Bus FX wet/dry UI** — bus A / bus B strips can't adjust their reverb/delay amount from the UI (baked to 1.0 / 0.5 by `ensureBuses()`).
- **Marker/tempo delete UI** — only add flow exists. Right-click an existing entry would be natural.
- **Legacy drum-pattern shape question** — `pattern.steps[]` with per-row `sampleRef` vs one-sample-per-track; open design question.
- **Undo across `store.load` boundary** — history resets on load by design. May want a "restore session" path.
- **No build pipeline / frontend tests** — raw ES modules, no bundler, no Vitest/Jest. Regressions rely on manual walkthrough + backend tests.
- **`track.effects.eqEnabled` persistence** — EQ bypass works at runtime but isn't persisted; matches the existing no-persist pattern for dist/delay/reverb toggles. If added, do all four together.
- **Header mock meters** (CPU/DISK/RAM in zone 1) still show hardcoded 34/12/58. The real CPU signal lives in the status-bar chip now.

---

## Next phase candidates

1. **Extend automation to more params** — param selector in the automation tab, `setValueAtTime` on pan/send/FX-mix nodes.
2. **In-DAW confirm dialog** — replace `window.prompt`/`confirm` with a styled modal.
3. **Bus FX UI** — wet/dry knobs on the bus strips.
4. **Marker/tempo right-click menu** — delete + edit on existing entries.
5. **Front-end test harness** — Vitest + Playwright smokes for scheduler, offline-render, automation parity.
6. **Real-time recording** — no audio input yet; requires decision on Record button semantics.

---

## Dev workflow

```bash
cd ~/projects/bassmash
bun run dev              # uvicorn :8000, mounts app/ as static
uv run pytest            # backend: 117 green, ~1s
```

Headless screenshot:
```
firefox --headless --screenshot /tmp/check.png --window-size=1600,1000 http://localhost:8000/
```

Playwright walkthrough (requires `uv pip install playwright && uv run playwright install firefox`):
```
/tmp/bm_smoke.py  /tmp/bm_deep2.py  # session verification scripts
```
