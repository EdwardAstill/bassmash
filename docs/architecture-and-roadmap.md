# Bassmash Architecture Critique & Roadmap

> **Historical document — kept for context.** This was written before the 9-zone UI rewrite and before the 2026-04-19 session that landed P1–P3. Repo layout and module names below are stale (references to `app/js/ui/topbar.js`, `timeline.js`, `mixer-panel.js`, `step-sequencer.js`, `app/js/audio/export.js`, `app/js/audio/waveform.js` — all deleted). For the current architecture snapshot, see [../NEXT_STEPS.md](../NEXT_STEPS.md). Some of the structural concerns below still apply (no frontend build/types/tests, no domain-model classes, no command layer for undo); others have been addressed.

**Purpose.** Look honestly at how the code is structured today, call out what will bend or break as we add features, and lay out the work in phased order from "foundations we must fix before building much more" through to "parity with a professional DAW."

Read [performance-plan.md](./performance-plan.md) first for audio concepts and terminology. This document assumes you have read it.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [What Bassmash is today (architecture snapshot)](#2-what-bassmash-is-today-architecture-snapshot)
3. [Critical structural problems](#3-critical-structural-problems)
4. [Target architecture](#4-target-architecture)
5. [Roadmap — ten phases](#5-roadmap--ten-phases)
6. [Concept glossary for this document](#6-concept-glossary-for-this-document)

---

## 1. Executive summary

Bassmash works. It has play, record, patterns, synths, samples, mixer, export, and even an MCP server for AI-assisted beat generation. For ~1,800 lines of JavaScript and ~200 lines of Python it is remarkably functional.

It will not scale as-is. Five categories of structural problem will become blockers within the next handful of features:

1. **No domain model.** Project state is a loose JSON blob. Clips use ad-hoc fields; tracks know what they are via string comparison; there is no `Project` / `Track` / `Clip` class with invariants. Every new feature has to invent its own shape and the existing fields rot.
2. **No command layer.** State is mutated directly (`hit.clip.startBeat = newStart`). There is no undo/redo, no transaction, no audit trail. Adding these later requires touching every call site.
3. **The sequencer lives inside `main.js:91`.** The loop that turns beats into synth/sample/clip triggers is an event handler in the boot file. It is hard to extend (automation, swing, probability, triplets — all blocked), hard to test, and couples three different scheduling concerns.
4. **UI panels re-render by destroying and rebuilding DOM.** The mixer, channel rack, and browser all re-run `innerHTML = ...` on every state change. Fader state, scroll position, input focus, drag state all leak or go missing. Current workarounds (global `faderDragging` variable, `!important`-style `dataset` bookkeeping) are the smell of an absent component model.
5. **No build, no types, no tests on the frontend.** Modules load raw ES imports; there is no bundler, no minifier, no type checker, no linter, no unit or integration tests. As soon as a feature touches five files, regressions will sneak in.

Everything in this document is oriented around fixing those five things and then systematically extending the DAW feature surface.

---

## 2. What Bassmash is today (architecture snapshot)

### 2.1 Repo layout

```
bassmash/
├── app/                    # Frontend (browser)
│   ├── index.html          # Single page, four divs: toolbar, browser, channel rack, playlist, mixer
│   ├── css/style.css
│   └── js/
│       ├── main.js         # Boot + global event wiring + sequencer + project-picker (!)
│       ├── state.js        # Mutable store + event emitter + debounced autosave
│       ├── api.js          # HTTP calls to backend
│       ├── audio/          # engine, mixer, effects, sampler, synth, waveform, export
│       └── ui/             # timeline, piano-roll, step-sequencer, mixer-panel, browser, topbar, utils
├── server/                 # Python / FastAPI
│   ├── main.py             # App + middleware + static mount
│   └── routes.py           # REST endpoints
├── mcp-server/             # MCP server (Python) for AI-assisted beat generation
├── kit/                    # Built-in drum samples
└── docs/
```

### 2.2 Runtime flow

```
[ user clicks page ]
      │
      ▼
main.js#safeInit  ─→  engine.init()         creates AudioContext, masterGain, analyser
                  ─→  initTopbar / Timeline / MixerPanel / ChannelRack / Browser
                  ─→  showProjectPicker()
                           │
                           ▼  (user picks project)
                  ─→  loadProject(name)     store.load(data); preload samples; decode waveforms

[ user presses play ]
engine.play() starts setInterval(_schedule, 25ms)
      │
      ▼  every 25ms
engine._schedule()  emits 'beat' events with {beat, time}
      │
      ▼
main.js 'beat' handler   iterates arrangement/patterns
                         schedules sample & audio-clip playback
                         schedules synth voices
                         (directly, not via a dedicated scheduler module)
      │
      ▼
sampler.play / synth.playNote  →  channel.input  →  effects  →  gain  →  pan  →  masterGain  →  destination
```

### 2.3 The state model today

`store.data` is a plain object with five fields:

```js
{
  bpm: 140,
  timeSignature: '4/4',
  tracks:      [ { name, type, volume, pan, muted, soloed, synthParams?, effects: {...} } ],
  patterns:    [ { name, type: 'steps' | 'notes',
                   stepCount?, steps?: [ {name, sampleRef, cells:bool[], velocities:int[]} ],
                   length?, notes?: [ {pitch, start, duration, velocity} ] } ],
  arrangement: [ { trackIndex, patternIndex, patternName, startBeat, lengthBeats,
                   type?: 'audio', audioRef?, offset? } ],
}
```

Arrangement clips are a **discriminated union** by the presence of `audioRef` vs `patternIndex` rather than a proper `kind` field. Tracks are a discriminated union by `type`. Patterns are discriminated by `type`. Three different discriminator conventions in one data shape.

### 2.4 The "scheduler" is really two scheduler loops

1. **Beat scheduler** (`engine.js:_schedule`) — the only thing running ahead of time. Correct Chris-Wilson lookahead pattern.
2. **Beat handler** (`main.js:91`) — runs on each emitted `'beat'` event, iterates `store.data.arrangement` and `store.data.patterns` on the **main thread**, and calls `sampler.play(ref, time, ...)` / `synth.playNote(freq, time, ...)` with the future `time` so Web Audio will fire sample-accurately.

This works today because the beat handler runs at 25 ms intervals and the 100 ms lookahead absorbs any jitter. But as we add features (automation, clip offsets, swing, per-note probabilities, arbitrary time signatures), the handler will grow until a single beat's worth of logic no longer fits in the scheduler tick. At that point we need a real scheduler module — see §4.3.

---

## 3. Critical structural problems

Each problem below is evidenced with file:line references. Collectively these are the reasons the next six features will be harder than the last six.

### 3.1 Boot file does too much

`app/js/main.js:18-152` initialises the engine, wires global handlers, contains the entire sequencer logic, and embeds the project-picker markup as an inline HTML string. The file is 240 lines for ~9 distinct responsibilities.

*Evidence.*
- Project-picker chrome is a 35-line template literal (`main.js:160-192`).
- Piano-roll titlebar + drag handling is hand-wired (`main.js:30-73`).
- The `'beat'` event handler — ~60 lines (`main.js:91-151`) — is where the sequencer actually runs.
- `_activeAudioSources` is a closure-scoped array with no API for inspection, cleanup guarantees, or bounded size.

*Consequence.* Anything new that interacts with playback (automation, click metronome, count-in, pre-roll, tempo changes mid-song, MIDI input) has to be added to this handler, which is already difficult to reason about.

### 3.2 Direct state mutation everywhere

State is a plain object and is mutated in place from anywhere.

*Evidence.*
- `timeline.js:315` — `dragging.clip.lengthBeats = Math.max(...)`
- `timeline.js:325` — `dragging.clip.startBeat = Math.max(...)`
- `mixer-panel.js:39` — `store.data.tracks[idx].muted = !store.data.tracks[idx].muted`
- `piano-roll.js:76` — `hit.pattern.notes.push({...})`
- `step-sequencer.js:43` — `row.cells[s] = !row.cells[s]`

*Consequence.*
- **No undo/redo.** Adding undo later means replacing every one of these call sites with a command dispatch, or rewriting the state layer.
- **No diffing.** The save system has to serialise the whole project every 2 s because nothing knows what changed.
- **Race-prone.** If we ever run the engine off-thread, readers will see half-applied mutations (e.g. `splice` mid-iteration).
- **Emissions are noisy.** Every mutation then calls `store.emit('change', ...)` causing every listener to re-render.

### 3.3 UI is DOM-string-stamping, not a component tree

`mixer-panel.js:10-33`, `browser.js:7-25`, `step-sequencer.js:11-75`, `topbar.js:9-31` — each `render()` sets `innerHTML` to a full new string and re-attaches listeners.

*Evidence.*
- Fader drag state has to live **outside** `render()` in `mixer-panel.js:65` to survive re-renders — clear sign of the abstraction mismatch.
- Context menus are assembled with 12 lines of inline CSS strings (`timeline.js:371-390`).
- Re-render kills input focus (try typing in the BPM input while a save event emits).

*Consequence.* Every interactive element needs hand-rolled state preservation. Adding features like in-place rename, multi-select, drag-and-drop between panels is 5× the effort it should be.

### 3.4 No types, no linter, no bundler, no tests (frontend)

- All `.js`, no `.ts`, no `// @ts-check`, no JSDoc `@typedef`.
- No ESLint config, no Prettier config, no Biome config.
- No bundler — `app/index.html:18` loads `main.js` as a raw ES module; everything else is imported at runtime.
- No test runner for the frontend. (`server/test_routes.py` exists on the Python side.)

*Consequence.* `clip.audioRef` vs `clip.patternIndex` is checked manually in every caller. A field rename requires grep-and-pray. Refactors are unsafe. There is no CI gate.

### 3.5 The audio engine mutates shared state

`store.data` is read by the engine (`engine._schedule` reads `store.data.bpm` and `store.data.arrangement`), written by the UI, and saved to disk on a 2 s debounce. No snapshot, no immutability, no versioning.

Addressed by [performance-plan §5 item 10](./performance-plan.md#item-10--engine-side-state-snapshot-prep-for-threading).

### 3.6 `innerHTML` with string interpolation is an XSS vector

`timeline.js:183` — `ctx.fillText(clip.audioRef, ...)` is fine because canvas escapes. But `mixer-panel.js:13` — `${name}` — flows user-supplied track names into innerHTML. Today a track name is just a JS-side string with no persistence beyond one user's own machine. As soon as project sharing exists, this is a stored-XSS bug.

### 3.7 Autosave is not atomic

`state.js:44` — `setTimeout` debounce posts a PUT that overwrites `project.json` without versioning or tmp-file-rename. A crash mid-write corrupts the project. No history, no recovery.

### 3.8 Effects and instruments are non-pluggable

`EffectsChain` in `effects.js` hardcodes exactly four effects in a fixed order (EQ → distortion → delay → reverb). There is no registry, no "add compressor" surface, no per-slot enable/disable, no drag-to-reorder. `Synth` is one class.

*Consequence.* Every new effect or instrument is a file-touching operation in the core, not an extension point.

### 3.9 Inconsistent scheduling for audio clips vs patterns

Audio clips are triggered on the `'beat'` event exactly when `beat === clipStartStep` (`main.js:98`). Missed beats = missed clip start. Patterns loop on `pattern.stepCount` and work correctly. Fix covered by [performance-plan §5 item 6](./performance-plan.md#item-6--schedule-audio-clips-via-the-lookahead-scheduler).

### 3.10 Backend is intentionally thin — and must stay that way

`server/routes.py` is a file CRUD layer plus one `ffmpeg` shell-out for MP3 export. It has no auth, no schema validation on the project JSON, no migrations, no rate limiting. For local single-user use this is fine, but it means all non-trivial logic must live on the frontend forever (or we grow the backend). The roadmap assumes the backend stays thin and audio-critical work moves toward Rust/Tauri (see [performance-plan §6](./performance-plan.md#6-the-future-native-path-rust--tauri--wasm)).

---

## 4. Target architecture

What we want to converge on. Each piece maps to phases in §5.

### 4.1 Layered module structure

```
app/src/
├── domain/              # Pure data, no DOM, no audio — testable in isolation
│   ├── project.ts       # Project, Track, Pattern, Clip, Note, Automation classes
│   ├── ids.ts           # Typed IDs (TrackId, PatternId, ClipId) — no magic indices
│   └── validation.ts    # Schema check on load / after migration
│
├── commands/            # Mutations go through here; produces inverse for undo
│   ├── dispatch.ts
│   └── commands/
│       ├── add-track.ts
│       ├── move-clip.ts
│       ├── edit-note.ts
│       └── …
│
├── state/
│   ├── store.ts         # Holds current Project, history stack, selection
│   ├── selection.ts
│   └── events.ts        # Typed event bus
│
├── audio/
│   ├── engine.ts        # AudioContext, master, scheduler tick
│   ├── scheduler.ts     # Turns project state + currentTime into scheduled voice calls
│   ├── voice-pool.ts
│   ├── instruments/     # Registry of instrument types; each exposes voice-builder
│   ├── effects/         # Registry of effect nodes; each is an <Effect> interface
│   ├── render.ts        # Offline bounce, stem export
│   └── worklets/        # AudioWorkletProcessors (meter, WASM DSP hosts)
│
├── io/
│   ├── api.ts           # Typed wrapper over backend
│   ├── autosave.ts      # Atomic write + version history
│   └── import-export/   # MIDI file import, WAV/MP3/stems export
│
├── ui/
│   ├── panels/          # Each panel: timeline, mixer, piano-roll, browser, topbar
│   ├── widgets/         # Slider, Knob, NumberInput, ContextMenu — reusable, stateful
│   ├── canvas/          # Canvas-helper layer: offscreen buffers, dirty rects, rAF driver
│   ├── shortcuts.ts     # Keyboard handler
│   └── theme/
│
├── devtools/
│   ├── perf-hud.ts
│   └── telemetry.ts
│
└── main.ts              # Thin bootstrap only: build dependency graph, hand off
```

**Key rule.** `domain/` has no browser imports. `ui/` calls `commands/` to mutate. `audio/` reads an **engine snapshot** derived from current state, never `store.data` directly.

### 4.2 Domain model sketch

```ts
type TrackId     = string & { __brand: 'Track' }
type PatternId   = string & { __brand: 'Pattern' }
type ClipId      = string & { __brand: 'Clip' }
type NoteId      = string & { __brand: 'Note' }

type Project = {
  meta:        { name: string, bpm: number, timeSignature: [number, number], version: number }
  tracks:      Map<TrackId, Track>
  patterns:    Map<PatternId, Pattern>
  clips:       Map<ClipId, Clip>
  automations: Automation[]            // volume, pan, macro, plugin params over time
  markers:     Marker[]                // intro/verse/chorus/loop
}

type Track =
  | { kind: 'synth',  id: TrackId, name: string, instrument: InstrumentRef, mixer: MixerSettings }
  | { kind: 'sample', id: TrackId, name: string, kit: KitRef,               mixer: MixerSettings }
  | { kind: 'audio',  id: TrackId, name: string,                            mixer: MixerSettings }
  | { kind: 'bus',    id: TrackId, name: string, children: TrackId[],       mixer: MixerSettings }

type Clip =
  | { kind: 'pattern', id: ClipId, trackId: TrackId, patternId: PatternId, start: Beats, length: Beats }
  | { kind: 'audio',   id: ClipId, trackId: TrackId, audioRef: AudioRef,   start: Beats, length: Beats, offset: Beats, stretch?: number }

type Pattern =
  | { kind: 'steps', id: PatternId, stepCount: number, rows: StepRow[] }
  | { kind: 'notes', id: PatternId, length: Beats,     notes: Map<NoteId, Note> }

type Note = { id: NoteId, pitch: MidiNote, start: Beats, length: Beats, velocity: 0..127, probability?: number }
```

Written in TypeScript because that is where we are going (phase 0). The `Map<Id, _>` shape gives us O(1) lookup, stable IDs across moves, and immutable patch operations.

### 4.3 Scheduler that can actually grow

```
every 25 ms:
  currentTime = ctx.currentTime
  while nextEventTime < currentTime + lookahead:
    events = scheduler.eventsAt(project, nextEventTime, step)
    for event in events:
      voicePool.trigger(event, scheduleTime)
    nextEventTime += stepDuration
```

`scheduler.eventsAt(project, time, step)` is a pure function: given project state and a time, return the list of voice triggers (and automation-ramp events, and MIDI-out events, etc.) that happen at that instant. This is testable. It is where swing, probability, humanise, triplets, time-signature changes, tempo ramps, automation, send routing all live.

### 4.4 Command / undo architecture

Every mutation goes through `commands/dispatch(command)`. A command is a plain object with a `kind`, the data needed to apply, and a paired `inverse(prev)` function. The dispatch:

1. Produces a new immutable `Project` (via Immer or manual patches).
2. Pushes `{command, inverse}` on the history stack.
3. Fires typed events (`'project:changed'`, `'track:added'`, etc.).
4. Schedules autosave.

UI code calls `dispatch({kind: 'moveClip', clipId, to})` instead of `clip.startBeat = x`. Undo is `history.pop().inverse(project)`.

### 4.5 Panels as mount/update components

Each UI panel exposes:

```ts
type Panel = {
  mount(container: HTMLElement, deps: Deps): PanelHandle
}
type PanelHandle = {
  update(patch: Patch): void   // targeted updates only — no full re-stamp
  dispose(): void
}
```

The scaffolding is built once in `mount()`. State changes arrive as a `Patch` describing exactly what changed (e.g. `{track: id, field: 'muted', value: true}`); the panel updates the matching element. No `innerHTML = ...` after the first render. Reach for a small library (Lit, Solid, or Preact signals) rather than reinvent — the cost is one dependency; the saving is tens of hours of re-implementation.

### 4.6 Effects and instruments become registries

```ts
registerEffect('compressor', {
  displayName: 'Compressor',
  build: (ctx) => ({ input, output, setParam(name, value) {...} }),
  params: [ {name: 'threshold', range: [-60, 0], default: -18}, … ],
})
```

An effect chain becomes an **ordered list of effect instances**. Add any effect to any slot. Mixer panel reads the registry for its UI. Same story for instruments.

---

## 5. Roadmap — ten phases

Each phase produces a shippable increment and leaves the codebase in a better state than it started. Phases 0, 1, and 2 are the foundational rework and **must come before** the feature phases, or they will be far more painful to retrofit.

Phase numbering is not a total timeline — it is a priority order. Within a phase, items are listed in the order they should be tackled.

### Phase 0 — Foundations (no visible features, huge downstream payoff)

The "lock in the platform" phase. Nothing here changes what the app looks like; everything makes every subsequent phase cheaper.

- **F0-1. Switch to TypeScript + Vite.** Migrate `app/js/*.js` → `app/src/*.ts`, add `vite.config.ts`, add `tsconfig.json` (strict). Vite dev server replaces the FastAPI static-file serving in dev; prod build emits static assets that FastAPI serves as today.
- **F0-2. Add ESLint + Prettier + Husky pre-commit.** Style + lint gate.
- **F0-3. Add Vitest for unit tests, Playwright for E2E.** Establish `app/src/**/*.test.ts` convention. Start with `scheduler.eventsAt` tests.
- **F0-4. Add CI.** GitHub Actions (or equivalent) running `pnpm lint && pnpm typecheck && pnpm test && pytest`.
- **F0-5. Establish the layered folder structure (§4.1).** Move code; do not yet rewrite it. Every import now goes through the new structure.
- **F0-6. Introduce the domain model (§4.2).** Start with `Project` as a typed class holding the same JSON as today. Add validation on load (throw on malformed project). Convert `trackIndex` → `TrackId` gradually.
- **F0-7. Add atomic autosave.** Write to `project.json.tmp`, `fsync`, rename. Keep the last N versions in `project-history/` for crash recovery.
- **F0-8. Add schema versioning.** `project.meta.version = 1`. Load-time migrator between versions.

### Phase 1 — Command layer + undo/redo

- **F1-1. Build the command dispatch (§4.4).** Use Immer for structural sharing.
- **F1-2. Convert each mutation call site to a command.** ~40 sites; mechanical, do systematically file by file.
- **F1-3. Ctrl/Cmd+Z + Ctrl/Cmd+Shift+Z.** History stack with configurable depth.
- **F1-4. Edit history panel (dev aid).** Visual list of recent commands. Invaluable while building later features.
- **F1-5. Copy / cut / paste / delete for clips and notes.** Now trivial — they are just commands.

### Phase 2 — Sequencer extraction & performance plan items 1–10

The core of the performance plan from [performance-plan.md](./performance-plan.md) fits here once the foundations are laid. Items 11 (WASM DSP) and 12 (Tauri) are Phase 9.

- **F2-1. Extract `sequencer.ts` from `main.js:91`.** Pure function `eventsAt(project, time, step)`.
- **F2-2. Ship performance plan items 1–10.** In the order given there.
- **F2-3. Metronome click.** Trivial once the scheduler is a proper module.
- **F2-4. Count-in / pre-roll.** Same.

### Phase 3 — Core DAW UX parity (the things every DAW has)

Table stakes. Nothing here is exotic; their absence is what makes Bassmash feel like a toy.

- **F3-1. Keyboard shortcuts.** Space = play/stop, Delete = delete selection, Ctrl+A select all, Ctrl+S manual save, Ctrl+D duplicate, arrows nudge, +/- zoom. One `shortcuts.ts` module.
- **F3-2. Selection model.** Single + multi + range. Marquee select. Selection is state, lives in the store.
- **F3-3. Snap-to-grid + grid resolution.** 1/4, 1/8, 1/16, 1/32, triplet variants. Snap magnet toggle.
- **F3-4. Zoom.** Horizontal (Ctrl+scroll) and vertical (Alt+scroll) zoom on timeline and piano-roll. Follow-playhead mode.
- **F3-5. Real loop region.** Draggable start *and* end markers. Loop on/off toggle. Stop at end of loop option.
- **F3-6. Proper transport.** Play from cursor, play from start, play selection, rewind, fast-forward, record (arm later).
- **F3-7. Project picker polish.** Rename, delete, duplicate, open recent. Cover the current inline-HTML-in-main.js hole.
- **F3-8. Save-as and project export/import** (.zip containing `project.json` + `samples/` + `audio/`).

### Phase 4 — Instrument and sample maturity

- **F4-1. Instrument registry.** Refactor `Synth` into one implementation behind the registry. Add: FM synth (2-operator to start), wavetable (minimal), sampler-instrument (single-sample, pitchable, ADSR).
- **F4-2. Drum kit manager.** Tag samples (kick/snare/hat/perc). Browser filters by tag. Preview on click.
- **F4-3. MIDI input.** Web MIDI API. Record live performance into selected pattern. Device picker + channel filter.
- **F4-4. MIDI file import.** Drop a `.mid` onto a track → creates note pattern.
- **F4-5. MIDI file export.** Per-pattern or whole-project.
- **F4-6. Pattern-length independent of clip length.** Pattern repeats for the clip duration; clip can be shortened/extended without editing the pattern.
- **F4-7. Pattern variations.** A/B/C/D within a pattern slot.

### Phase 5 — Composition features

- **F5-1. Automation lanes.** Volume, pan, filter cutoff, any plugin param. Draw curves in the timeline; scheduler samples them per block.
- **F5-2. Send buses.** Each channel can send a copy to a bus channel (reverb bus, delay bus).
- **F5-3. Group channels.** Nested folder tracks with shared fader and optional effects.
- **F5-4. Sidechain.** Effect `input1` can accept signal from another channel.
- **F5-5. Swing / groove / humanise.** Per-pattern, per-row or per-instrument.
- **F5-6. Tempo + time signature changes.** Markers on a tempo track that the scheduler reads.
- **F5-7. Arrangement sections/markers.** Intro/verse/chorus; jump-to-section.
- **F5-8. Clip operations.** Slip (offset inside clip), reverse, pitch-shift in semitones, time-stretch to tempo (warp).

### Phase 6 — Effect architecture + built-ins

- **F6-1. Effect registry (§4.6).**
- **F6-2. Refactor existing EQ/distortion/delay/reverb as registry entries.** No behaviour change.
- **F6-3. Per-track ordered effect chain.** Drag-reorder, on/off per slot.
- **F6-4. New built-ins.** Compressor, limiter, gate, chorus, phaser, flanger, saturator, 2-band multi-effects, convolution reverb with user IRs.
- **F6-5. EQ spectrum analyser.** FFT display behind the EQ curve.
- **F6-6. Stereo width, mid/side.**
- **F6-7. Effect presets.** Save/load per-effect; shareable.

### Phase 7 — Export pipeline

- **F7-1. Chunked, cancellable, progress-reporting export** — already specified in [performance-plan.md item 9](./performance-plan.md#item-9--chunked-cancellable-offline-export-with-progress).
- **F7-2. Stem export.** One WAV per track, or per group.
- **F7-3. Multi-format output.** WAV (16/24/32-bit), FLAC, MP3, OGG, AAC. Depth/sample-rate conversion on the way out.
- **F7-4. Normalise / LUFS target on export.** Meter reading + optional gain match.
- **F7-5. Bounce-in-place.** Freeze a track to audio to free CPU.

### Phase 8 — Plugin hosting (browser edition)

Possible before going native. Not easy.

- **F8-1. Web Audio Modules (WAM) 2.0 host.** Open standard for browser DAW plugins. Load a `.js` WAM, mount inside an effect slot. Instant access to the existing ecosystem of WAM plugins.
- **F8-2. WAM instrument host.** Same mechanism but in an instrument slot.
- **F8-3. Plugin parameter automation.** Plugin params show up as automation targets.

### Phase 9 — Go native (Rust + Tauri + real plugin hosting)

Only worth doing once the browser has been squeezed dry. Covered in [performance-plan.md §6](./performance-plan.md#6-the-future-native-path-rust--tauri--wasm).

- **F9-1. Extract the DSP kernels to Rust.** Compile to WASM first, use from AudioWorklet. Zero user-visible change; unlocks measurable CPU savings.
- **F9-2. Tauri shell.** Desktop app packaging. Identical UI.
- **F9-3. Native audio engine via cpal.** Sub-3 ms round-trip latency. Real-time thread priority.
- **F9-4. VST3 / AU / CLAP hosting.** Via `clap-host` or `nih-plug`-style Rust bindings. Massive leap in capability; also massive stability surface area.
- **F9-5. Native MIDI I/O.** Sample-accurate MIDI out to hardware.
- **F9-6. Multi-channel audio I/O.** Record from external interfaces; send individual tracks to outputs.

### Phase 10 — Collaboration, cloud, AI

Long-term. Mostly backend work.

- **F10-1. Versioned project history.** Git-like per-project log; restore any prior save.
- **F10-2. Cloud projects.** Optional sync; conflict resolution via CRDT or OT for concurrent edits.
- **F10-3. Shared sample library.**
- **F10-4. Deep MCP integration.** Already started in `mcp-server/`. Grow the toolset: generate pattern, replicate a reference, suggest effect chain, arrange a full song from a sketch.
- **F10-5. Stem-aware AI tools.** Source separation on import; AI-driven mastering; groove matching.

---

## 6. Concept glossary for this document

**Autosave.** Saving the project on a timer without user action. Atomic autosave writes to a temp file then renames, so a crash mid-write can't corrupt the real file.

**Bus.** A virtual channel that several tracks send their audio into. A reverb bus lets multiple tracks share one reverb instance.

**CI.** Continuous Integration — automated checks that run on every commit (lint, typecheck, tests, build).

**Command pattern.** A design pattern where every state mutation is wrapped in an object (the command). Makes undo, redo, macros, audit logs, and remote sync possible. See §4.4.

**CRDT.** Conflict-free Replicated Data Type — a data structure that can be edited concurrently by multiple users and automatically merged without a server coordinating edits.

**Discriminated union.** A type that is one of several shapes, distinguished by a tag field. `{ kind: 'audio', … } | { kind: 'synth', … }`. Much safer than "check if this optional field exists."

**DOM.** The browser's tree of HTML elements.

**Group channel.** A container channel that holds other channels. Adjusting a group fader adjusts all children at once.

**Immer.** A JS library for structural-sharing immutability: you write code that looks like mutation, and it produces a new immutable version of the state.

**Immutable.** Cannot be changed after creation. You make "new versions" instead of mutating. Enables time-travel, undo, diffing, safe sharing between threads.

**Map.** JavaScript's `Map<K, V>` — a real hashmap, distinct from plain object. Has stable iteration order, any-type keys, and efficient insert/delete.

**Marker.** A named position in the song — intro, verse, chorus — usable for jump-to navigation.

**MCP.** Model Context Protocol — a standard for exposing tools to AI assistants. Bassmash has an MCP server in `mcp-server/`.

**MIDI.** Musical Instrument Digital Interface — a decades-old protocol for sending note-on / note-off / controller events between instruments.

**Registry pattern.** A lookup table of available implementations keyed by name. Lets the system be extended without changing the core.

**Send.** Routes a copy of a channel's audio to another channel (a send-bus). Unlike insert effects, send effects are shared — one reverb, many tracks.

**Sidechain.** A second input to an effect. Common use: a kick drum triggers the compressor on the bass, "ducking" the bass when the kick hits.

**Snap-to-grid.** Magnetic alignment of clip/note positions to beat subdivisions.

**Stem.** The isolated audio for one element of a mix. Stem export = render each track to its own file so they can be re-mixed elsewhere.

**Structural sharing.** Creating a new version of an immutable object while reusing unchanged sub-objects. Makes "immutable" affordable in memory and time.

**Swing.** A timing feel where every other subdivision is pushed slightly later, producing a shuffle groove.

**Time-stretch / warp.** Change the duration of an audio clip without changing its pitch (or vice versa).

**TypeScript.** JavaScript with a static type checker. Catches class mistakes (wrong argument types, missing fields) at edit time instead of runtime.

**Vite.** A fast modern frontend build tool. Dev server with instant hot-reload; production builds produce optimised static assets.

**Vitest / Playwright.** Vitest — unit test runner for Vite projects. Playwright — browser-automation E2E test framework.

**WAM (Web Audio Modules).** Open standard for browser-runnable audio plugins. See [webaudiomodules.org](https://www.webaudiomodules.org/).

**XSS.** Cross-Site Scripting — a vulnerability where user-supplied text is executed as HTML/JS. Solved by treating user input as data, never as markup. Affects Bassmash's `innerHTML = '<div>${trackName}</div>'` patterns once projects are shared.

---

*End of critique and roadmap. Start with Phase 0.*
