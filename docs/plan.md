# M8S Master Plan

**One list, one order.** Every unit of work from the two earlier docs merged into a single sequence with test gates between phases. The CLI appears early so we can exercise each phase programmatically, together.

Read alongside:
- [architecture-and-roadmap.md](./architecture-and-roadmap.md) — rationale for each item and deeper definitions.
- [performance-plan.md](./performance-plan.md) — audio fundamentals and the perf engineering work.

---

## Ground rules

1. **Test at every gate.** Each phase ends in a checklist. We don't start the next phase until the current one is green.
2. **Feature flags over branches.** New systems land behind flags, old path stays working until parity is proven.
3. **CLI-driven tests are the default.** If it can't be exercised from the CLI, it isn't done.
4. **One thing at a time.** No merging phases. Small phases ship fast and stay reversible.

---

## The CLI (`m8s-cli`)

A Python CLI (uv-managed, consistent with the rest of the backend stack) that I (Claude) and you both drive.

### What it does

Two layers:

- **Layer 1 — Project-data layer (filesystem-direct).** The CLI edits project files directly in `~/m8s-projects/<name>/`. No HTTP, no backend needed. Create/delete projects, add/remove tracks, edit patterns, set BPM, manipulate arrangement, copy in samples/audio. The files are the source of truth; the CLI, the backend, and the frontend all read and write the same bytes. Available at the very start of the plan.
- **Layer 2 — Live-app layer.** Backend exposes a `/ws/control` WebSocket. When the frontend is open, it connects. The CLI sends commands (`play`, `stop`, `open-piano-roll`, `click-clip 2`, `set-zoom 1.5`, `snapshot-perf`) to the frontend, which executes them and streams back state + perf HUD numbers. **Requires the frontend running.** Lands in Phase 2, alongside the performance HUD.

**Why filesystem-direct, not HTTP.** Going through FastAPI for file-shape operations is unnecessary ceremony — the backend's job for projects is just "read file, mutate, write file." The CLI can do that itself, faster and with the server off. Backend keeps doing the one thing it genuinely has to do: serve files to the browser and run `ffmpeg` for MP3 export.

### Why not MCP

The existing `mcp-server/` stays — it's the AI-facing surface. The CLI is the developer-facing surface. Same verbs, different framing. The CLI can import and reuse the MCP tools' implementations so there is no duplicated logic.

### Why CLI over browser automation

Playwright would work but would be a heavy second runtime, and we'd still need a way to peek at engine-internal state. A WebSocket control channel is lighter, testable, and forces us to build a clean internal API — which we want anyway.

### Example session

```
$ m8s-cli project create "test-plan-phase-1"
Created project: test-plan-phase-1
$ m8s-cli track add-synth --project test-plan-phase-1 --name "Lead"
Added track 0: Lead (synth)
$ m8s-cli pattern edit-notes --project test-plan-phase-1 --pattern 0 \
    --notes "60:0:4,64:4:4,67:8:4"
Wrote 3 notes to pattern 0
# — frontend open —
$ m8s-cli live play
Play from beat 0
$ m8s-cli live perf
{"cpu": 4.2, "voices": 3, "drift_ms": 0.3, "fps": 60, "dropped": 0}
$ m8s-cli live export --out /tmp/out.wav --cancel-after 5s
Progress: 100%  | Real-time ratio 8.4x
Written: /tmp/out.wav (1.2 MB)
```

---

## The master list

Phases run in order. Sub-items within a phase can be parallelised if you want, but the gate at the end of a phase is all-or-nothing.

### Phase 0 — Foundations & CLI v1

Goal: a platform we can reliably build on, and a tool we can test with.

1. **CLI v0 — filesystem-direct editor + audio analysis.** Python `cli/` package. Edits `~/m8s-projects/<name>/` directly: project CRUD, tracks, patterns (drum rows + notes), arrangement, BPM, sample/audio file management. Atomic writes (tmp + rename). Analysis subcommands (librosa-backed): `bpm`, `key`, `loudness`, `spectrum`, `full`, `batch`, `compare` — detect tempo/key/loudness of any audio file and side-by-side compare our renders against references. Installable via `uv pip install -e .`.
2. **Switch frontend to TypeScript + Vite.** `app/js/*.js` → `app/src/*.ts` with `tsconfig.json` set to strict. Vite dev server in dev; prod build emits static `dist/` that FastAPI serves. `index.html` moves to `app/src/`.
3. **Add ESLint + Prettier (or Biome, one tool).** Lint + format gate.
4. **Add Vitest + Playwright.** `app/src/**/*.test.ts`. One smoke E2E test: open the app, click-create project, assert DOM.
5. **Add CI (GitHub Actions).** Runs `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pytest && ruff check`.
6. **Establish layered folder structure.** Move code into `domain/`, `commands/`, `state/`, `audio/`, `io/`, `ui/`, `devtools/`, `main.ts`. No behaviour changes.
7. **Introduce the domain model.** `Project`, `Track`, `Pattern`, `Clip`, `Note` classes with typed IDs. Same JSON on disk; new structured view in memory.
8. **Load-time validation + schema version.** `project.meta.version = 1`. Throw on malformed; auto-migrate future versions.
9. **Atomic autosave.** Write to `project.json.tmp`, fsync, rename. Keep last 10 versions in `.history/`.
10. **CLI v1 — typed.** Regenerate a typed Python client from the domain model (generate TS types ➞ JSON Schema ➞ pydantic). All CLI ops validate input.

**Gate 0 — manual tests.**

- [ ] `pnpm build` succeeds with zero errors.
- [ ] `pnpm typecheck` passes strict-mode TS.
- [ ] `pnpm test` runs and the smoke test passes.
- [ ] `m8s-cli project create foo` creates a valid project.
- [ ] Open `foo` in the browser — identical UX to pre-migration.
- [ ] Kill the server mid-save — `project.json` is either the old or the new content, never half.
- [ ] Corrupt `project.json` manually — load gives a clear error, not a crash.
- [ ] CI is green on main.

---

### Phase 0.5 — Folder-of-text-files project format

Move projects from a single `project.json` blob to a folder of human-editable, git-friendly text files. Domain model (Phase 0 item 7) must exist first; types drive the serialiser.

1. **Layout.** `project.yaml` for meta + track list + arrangement; one `patterns/<name>.pattern` per drum pattern; one `patterns/<name>.notes` per synth pattern; `samples/`, `audio/`, `.history/` unchanged.
2. **Pattern DSL.** `row Kick kit://kick-punchy.wav 1000 0000 1000 0000` style — far nicer than JSON for drum grids.
3. **Notes DSL.** One note per line: `pitch start duration velocity`, optional comments.
4. **Load/save functions** on the typed domain model. Unit-tested round-trip: load → save → load returns identical object.
5. **CLI learns the new format.** Same commands, new files on disk. Old `project.json` projects auto-migrate on first load.
6. **Schema version bumps** to `2`. Migrator from version `1`.

### Phase 1 — Command layer & undo/redo

Goal: every mutation is a first-class, reversible command.

1. **Command dispatch.** `commands/dispatch.ts`. Uses Immer for structural-sharing immutability.
2. **Write every command.** `addTrack`, `removeTrack`, `renameTrack`, `moveClip`, `resizeClip`, `addClip`, `deleteClip`, `duplicateClip`, `addNote`, `removeNote`, `editNote`, `toggleStep`, `setVolume`, `setPan`, `setMute`, `setSolo`, `setBpm`, `setLoopEnd`, `addPattern`, `duplicatePattern`, `renamePattern`, `setSynthParam`, `setEffectParam`, `toggleEffect`. Each has a paired `inverse`.
3. **Migrate every mutation site** (timeline, mixer panel, piano roll, step sequencer, topbar) to dispatch a command. No more direct `obj.field = x`.
4. **History stack.** Max-depth config. `Ctrl+Z` / `Ctrl+Shift+Z`. Clears on project load.
5. **Typed event bus.** Replaces the untyped `store.emit(name, detail)`. Events are ADTs. Panels subscribe to exactly what they care about.
6. **Dev history panel** (debug only, behind `?debug=1`). Live list of recent commands.
7. **CLI extension — commands.** `m8s-cli cmd add-track --kind synth --name "Lead"` etc. Dispatches the same commands; works whether or not the frontend is running (layer 1). Round-trip validation: apply commands via CLI, assert the resulting `project.json` matches expected.

**Gate 1 — manual + automated tests.**

- [ ] Every mutation in the UI is reversible with `Ctrl+Z`.
- [ ] Redo works after undo, up to the latest action.
- [ ] Undo stack persists across panel focus changes and panel re-renders.
- [ ] Run 100 random commands via the CLI, then undo 100 times — state exactly matches the starting project.
- [ ] Copy / cut / paste / delete works for selected clips.
- [ ] No `obj.x = y` mutations remain outside `commands/`. (Enforced by ESLint rule forbidding direct `store.data.*` writes.)
- [ ] Saving a project, loading it, and running `m8s-cli project diff` against the pre-save version reports zero differences.

---

### Phase 2 — Sequencer extraction, performance HUD, CLI live layer

Goal: the audio engine becomes testable and measurable, and we can drive the running app from the CLI.

1. **Extract `scheduler.ts`** from `main.js:91`. Pure function `eventsAt(project, time, step)` → list of voice triggers.
2. **Unit-test the scheduler.** Golden tests for common patterns: 4/4 kick, 1/8 hi-hat, clip offset, clip length shorter than pattern, loop boundary.
3. **Perf HUD** (performance-plan item 1). Toggle with backtick.
4. **Low-latency `AudioContext` flags** (performance-plan item 2).
5. **Decode/downsample in a worker** (item 3).
6. **Dirty-rect timeline rendering** (item 4).
7. **Smoothed parameter automation** (item 5).
8. **Unified scheduler for audio clips** (item 6).
9. **Voice pool + polyphony cap** (item 7).
10. **WebSocket control channel.** Backend exposes `/ws/control`. Frontend connects on load and registers a small verb handler (`play`, `stop`, `snapshot`, `perf`, `click`, `dispatch-command`).
11. **CLI v2 — live.** `m8s-cli live play`, `m8s-cli live perf`, `m8s-cli live snapshot`, `m8s-cli live dispatch '{"kind":"addTrack",...}'`.

**Gate 2 — measurement.**

- [ ] Scheduler drift ≤ 1 ms sustained over 5 minutes of playback (CLI: `m8s-cli live perf --watch 5m`).
- [ ] No audible glitches through a full-project playback.
- [ ] Timeline stays at 60 fps during playback on a 40-track test project.
- [ ] Fader drag produces no zipper noise.
- [ ] Voice-pool limit holds: firing 1,000 notes in 1 second never allocates above the pool cap.
- [ ] `m8s-cli live play` starts audio exactly as clicking play does (state is identical after).
- [ ] Scheduler tests pass. 100 % of the public scheduler API is covered.

---

### Phase 3 — Core DAW UX parity

Goal: the app feels like a real DAW, not a toy.

1. **Keyboard shortcuts module.** Space = play, Delete = delete selection, Ctrl+A, Ctrl+S, Ctrl+D, arrows = nudge, `+` / `-` = zoom.
2. **Selection model** in the store. Single / multi / range. Marquee select.
3. **Snap-to-grid.** 1/4, 1/8, 1/16, 1/32, triplets. Global toggle and per-drag override (Alt = ignore snap).
4. **Zoom.** Horizontal + vertical, timeline + piano-roll. Follow-playhead mode.
5. **Real loop region.** Draggable start *and* end. Loop on/off toggle.
6. **Proper transport.** Play from cursor, play-selection, rewind, fast-forward.
7. **Project-picker polish.** Rename, delete, duplicate, open-recent. Stop inline-HTML-in-main.js.
8. **Save-as** + export-as-zip / import-from-zip.
9. **Panels become components.** Replace `innerHTML = ...` patterns with a small reactive layer (Solid or Preact signals — pick one, document why). Fader state no longer lives outside its panel.
10. **XSS fix.** Escape user strings everywhere they flow into markup. Covered automatically by the component layer.

**Gate 3 — UX testing.**

- [ ] Every common action has a keyboard shortcut and the shortcut is listed in Help / `?` overlay.
- [ ] Marquee-select + delete works on clips and notes.
- [ ] Zoom in / out is smooth, gridlines stay readable, playhead stays visible in follow mode.
- [ ] Loop region visible as a highlighted band with two handles.
- [ ] Save-as to a new name, reopen, identical content.
- [ ] A track named `<img src=x onerror=alert(1)>` renders as literal text, never executes.
- [ ] Pa­nel re-render no longer loses fader drag state or input focus.
- [ ] Full Playwright E2E suite green (~25 happy-path flows).

---

### Phase 4 — Instruments & samples

Goal: more than one synth, real MIDI, real samples.

1. **Instrument registry.** Refactor `Synth` into a registered entry.
2. **New instruments.** FM 2-op, wavetable minimal, single-sample sampler-instrument.
3. **Drum kit manager.** Sample tagging (kick/snare/hat/perc), browser filter, click-to-preview.
4. **MIDI input (Web MIDI API).** Device picker, live record into selected pattern.
5. **MIDI file import / export.**
6. **Pattern length independent of clip length.** Pattern repeats to fill clip.
7. **Pattern variations** — A/B/C/D slots per pattern.
8. **CLI extension — instruments.** `m8s-cli inst list`, `m8s-cli inst set-param ...`.

**Gate 4.**

- [ ] Three distinct synth kinds available; each has its own parameter UI.
- [ ] Dropping a `.mid` file onto a track creates a pattern with matching notes (verified by CLI note-dump).
- [ ] A MIDI controller plays the selected instrument with < 20 ms input-to-sound latency (measure with the perf HUD).
- [ ] Exported MIDI file, re-imported, gives an identical pattern.

---

### Phase 5 — Composition

Goal: the tools needed to arrange a full song rather than a 4-bar loop.

1. **Automation lanes.** Any scheduler-visible parameter (volume, pan, filter cutoff, plugin param). Scheduler samples per block.
2. **Send buses.** Per-channel send levels into designated bus channels.
3. **Group channels.** Nested folder tracks with shared fader + optional group effects.
4. **Sidechain inputs.** Any effect can accept a signal from another channel.
5. **Swing / groove / humanise.** Per-pattern and per-row.
6. **Tempo + time-signature changes.** Tempo track with ramp + step changes.
7. **Arrangement sections / markers.** Named regions, jump-to-section, loop-a-section.
8. **Clip ops.** Slip, reverse, pitch-shift, time-stretch-to-tempo (warp).

**Gate 5.**

- [ ] Automation curves on volume audibly affect playback and are sample-accurate.
- [ ] Sidechain ducking (kick → bass compressor) works.
- [ ] Tempo ramp from 120 → 140 over 8 bars plays smoothly, exports identically.
- [ ] Markers appear in the timeline header and can be jumped to by number shortcut.

---

### Phase 6 — Effect architecture + built-ins

1. **Effect registry.** Refactor existing four as entries. No behaviour change.
2. **Ordered per-track effect chain.** Drag-reorder, on/off per slot.
3. **New built-ins.** Compressor, limiter, gate, chorus, phaser, flanger, saturator, convolution reverb with user IR upload.
4. **EQ spectrum analyser** (FFT display behind the curve).
5. **Stereo width / mid-side.**
6. **Effect presets.** Save/load/share.

**Gate 6.**

- [ ] An effect chain of 10 effects works without dropping frames.
- [ ] Drag-reorder changes the audible result.
- [ ] User-uploaded IR produces the expected reverb.

---

### Phase 7 — Export pipeline

1. **Chunked, cancellable, progress-reporting export** (performance-plan item 9).
2. **Stem export** — one WAV per track.
3. **Multi-format.** WAV 16 / 24 / 32-bit, FLAC, MP3, OGG, AAC.
4. **Normalise / LUFS target.**
5. **Bounce-in-place.** Freeze a track to audio, disable its effects and instrument until unfrozen.

**Gate 7.**

- [ ] Export a 3-minute song at ≥ 5× realtime.
- [ ] Stem sum reconstructs the master mix within −96 dB.
- [ ] Cancel at 50 % leaves no partial file.
- [ ] Bounce-in-place drops CPU by ≥ 90 % for the frozen track.

---

### Phase 8 — Plugin hosting (browser)

1. **WAM 2.0 effect host.**
2. **WAM 2.0 instrument host.**
3. **Plugin parameters exposed as automation targets.**

**Gate 8.**

- [ ] Load a published WAM plugin, use it in a slot, automation works.
- [ ] Removing a plugin cleanly frees all its resources.

---

### Phase 9 — Go native (Rust + Tauri)

Only if measurements show the browser is limiting us. Covered in [performance-plan.md §6](./performance-plan.md#6-the-future-native-path-rust--tauri--wasm).

1. **Rust DSP crate** (mixer sum, biquad, compressor) behind WASM in an AudioWorklet.
2. **Tauri shell** — same UI, desktop packaging.
3. **Native engine via cpal** with real-time thread priority.
4. **VST3 / AU / CLAP plugin hosting.**
5. **Native MIDI I/O.**
6. **Multi-channel audio I/O.**

**Gate 9.**

- [ ] Round-trip latency < 3 ms on a 128-sample buffer.
- [ ] CLAP plugin hosts and renders correctly.
- [ ] Identical project opens in the Tauri build and sounds identical.

---

### Phase 10 — Collaboration, cloud, AI

1. **Versioned project history** (browse / restore any save).
2. **Cloud sync** (optional) — CRDT-based.
3. **Shared sample library.**
4. **Deep MCP integration.** Grow the existing MCP server: generate pattern, replicate a reference, suggest effect chain, arrange a full song.
5. **Stem-aware AI.** Source separation on import; AI mastering; groove matching.

---

## What to do right now

The next concrete step is Phase 0, item 1: the CLI v0.

Reasons to start there:

- Unblocks every later test gate.
- Small — a few hundred lines of Python.
- Zero risk to the existing app; the CLI only calls existing HTTP endpoints.
- Immediately useful: I can inspect state and make changes for you as you try things.

After CLI v0 lands, we pivot to the TypeScript + Vite migration (Phase 0 item 2) and proceed through Phase 0 in order.

---

*End of master plan.*
