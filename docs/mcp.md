# MCP Server — AI Tool Catalog

`mcp-server/server.py` exposes Bassmash's project operations as Model Context Protocol tools. Claude (or any MCP client) composes, edits, and inspects projects with structured tool calls instead of raw file edits.

Every write lands in the same `$BASSMASH_PROJECTS_DIR/<name>/project.json` via the same atomic write pattern `cli/store.py` uses (`tempfile + fsync + os.replace`). Any open browser tab reloads within ~500 ms via the SSE endpoint.

---

## Run it

```bash
cd mcp-server
uv sync
uv run python server.py            # stdio transport — for MCP clients
```

## Connect it

Add to your MCP client config (Claude Desktop, Claude Code, etc.):

```json
{
  "mcpServers": {
    "bassmash-mcp": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/bassmash/mcp-server", "run", "python", "server.py"],
      "env": {
        "BASSMASH_PROJECTS_DIR": "/home/you/bassmash-projects"
      }
    }
  }
}
```

Restart the client. Tools show up as `mcp__bassmash-mcp__<name>`.

The `env.BASSMASH_PROJECTS_DIR` is optional — defaults to `~/bassmash-projects`. If you set a custom path in the backend (e.g. when running tests against a temp dir), use the same value here so the MCP reads/writes the same files.

---

## Tool catalog (22 tools)

All tools are `stdio` functions returning a human-readable string (success or error message). The browser picks up every successful write via SSE — no extra notification step.

### Read-only — inspect state before acting

#### `list_projects()`

List every project in `$BASSMASH_PROJECTS_DIR` with track count and BPM.

```
Found 7 project(s):
  - a (5 tracks, 123 BPM)
  - demo-beat (3 tracks, 143 BPM)
  …
```

#### `get_project(project_name: str)`

Full dump of `project.json` — tracks, patterns, arrangement, markers, tempo changes. Call this before making surgical edits so you know the current indices.

#### `list_kit_samples()`

Every sample reference under `$BASSMASH_KIT_DIR`, grouped by category (Kicks / Snares / Hi-hats / 808 Bass / Percussion). Use when picking a `sample_ref` so you don't guess a missing filename.

---

### Generative — the flagship operations

#### `generate_beat(prompt: str, project_name: str, bars: int = 4)`

Creates a new multi-track project from a natural-language prompt.

- **Genres** — detected from keywords: `trap`, `boom bap`, `drill`, `lofi`. Falls back to a generic 120–140 BPM kit.
- **BPM** — include `"140bpm"` / `"85 BPM"` in the prompt to override the genre default.
- **Elements** — `"808s"`, `"hi-hat rolls"`, `"heavy kicks"`, `"sparse"`, `"minimal"` shift pattern density, velocities, and whether a secondary 808 synth is added.

```py
generate_beat(prompt="trap beat 140bpm with heavy 808s and hi-hat rolls",
              project_name="trap-demo")
# → "Created project 'trap-demo' … Tracks: Drums 1, 808 Bass"

generate_beat(prompt="lofi 85bpm boom bap sparse minimal",
              project_name="lofi-chill", bars=8)
```

Output is immediately playable — open the project in the browser.

#### `replicate_from_audio(audio_path: str, project_name: str, bars: int = 4)`

Analyses an MP3 / WAV (librosa onset detection per frequency band) and reconstructs an approximate drum pattern + tempo. Useful for "give me a starter template in the style of this reference track."

```py
replicate_from_audio(audio_path="/home/you/ref-beat.mp3",
                     project_name="ref-copy", bars=4)
```

Returned summary lists the detected BPM and the hit counts for kick / snare / hihat.

---

### Writes — every edit is atomic

#### `set_bpm(project_name: str, bpm: int)`

Base tempo. Accepts `20..300`. Combines with `set_tempo_changes` — `set_bpm` is the fallback when no tempo entry precedes the current beat.

#### `add_drum_track(project_name: str, track_name: str = "Drums", kick: str = "kit://kick-punchy.wav", snare: str = "kit://snare-crisp.wav", hihat_closed: str = "kit://hihat-closed.wav", hihat_open: str = "kit://hihat-open.wav", bars: int = 4)`

Adds a `type: drums` track with a pre-populated 4-row pattern (Kick / Snare / HH Closed / HH Open). All `kit://…` refs must exist in the kit — call `list_kit_samples()` first to pick valid names.

#### `add_synth_track(project_name: str, track_name: str = "Synth", bars: int = 4)`

Adds a `type: synth` track with an empty piano-roll pattern. Configure its sound with `set_synth_params` right after.

#### `rename_track(project_name: str, track_index: int, name: str)`

Rename in place. Doesn't affect any pattern or arrangement references.

#### `delete_track(project_name: str, track_index: int)`

Remove a track + every arrangement clip that references it. Higher track indices shift down by one — any subsequent `track_index` args account for that.

#### `edit_drum_pattern(project_name: str, pattern_index: int, row_name: str, steps: list[int], velocities: list[int] | None = None)`

Set which 16th-note steps are active for a single row of a drum pattern.

- `steps` is 1-indexed (1..16). Example: `[1, 5, 9, 13]` = every downbeat.
- `velocities` is optional, parallel-indexed with `steps`; defaults to 100 for every hit.
- `row_name` is matched case-insensitively; missing rows return an error listing available names.

```py
edit_drum_pattern(project_name="trap-demo", pattern_index=0,
                  row_name="Kick",
                  steps=[1, 4, 7, 11],
                  velocities=[120, 100, 100, 90])
```

#### `edit_notes(project_name: str, pattern_index: int, notes: list[dict], append: bool = False)`

Set or append notes on a synth pattern.

```py
edit_notes(project_name="trap-demo", pattern_index=2, notes=[
    {"pitch": 64, "start":  0, "duration": 3, "velocity":  90},  # E4
    {"pitch": 67, "start":  4, "duration": 3, "velocity": 100},  # G4
    {"pitch": 71, "start":  8, "duration": 3, "velocity": 110},  # B4
    {"pitch": 76, "start": 12, "duration": 3, "velocity": 115},  # E5
])
```

- `pitch` — MIDI 0..127 (60 = C4)
- `start` — 16th-note step, 0-indexed
- `duration` — steps (16 = one bar)
- `velocity` — 0..127
- `append=True` preserves existing notes; default `False` replaces the pattern.

#### `clear_pattern(project_name: str, pattern_index: int)`

Wipe all cells / notes on a pattern, keeping the row structure (sample refs remain). Useful when replacing a pattern wholesale.

#### `mix_track(project_name: str, track_index: int, volume: int | None = None, pan: int | None = None, muted: bool | None = None, soloed: bool | None = None)`

Per-track mixer settings.

- `volume` — 0..100 (unity ≈ 70 — this is the stored fader percent; the audio engine maps it through a perceptual curve)
- `pan` — -100 (full left) .. 100 (full right)
- `muted` / `soloed` — booleans
- Any `None` field is left unchanged.

#### `set_effects(project_name: str, track_index: int, eq: bool | None = None, distortion: bool | None = None, delay: bool | None = None, reverb: bool | None = None)`

Enable / disable the fixed 4-effect chain on a track. Current wiring treats these as wet-mix bypasses, not per-parameter tweaks.

#### `set_synth_params(project_name: str, track_index: int, waveform?, filter_type?, filter_freq?, filter_q?, attack?, decay?, sustain?, release?)`

Configure oscillator + filter + ADSR on a synth track.

| Arg | Type | Range / values |
|---|---|---|
| `waveform` | str | `sine` / `square` / `sawtooth` / `triangle` |
| `filter_type` | str | `lowpass` / `highpass` / `bandpass` / `notch` |
| `filter_freq` | float | 20 .. 22050 Hz |
| `filter_q` | float | 0.1 .. 20 |
| `attack` | float | >= 0 seconds |
| `decay` | float | >= 0 seconds |
| `sustain` | float | 0 .. 1 |
| `release` | float | >= 0 seconds |

Only the fields you pass are written; others remain untouched. The browser renders these in the **Workbench → Synth** tab with an interactive ADSR graph.

```py
set_synth_params(project_name="trap-demo", track_index=2,
                 waveform="triangle",
                 filter_type="lowpass", filter_freq=5500, filter_q=1.0,
                 attack=0.002, decay=0.45, sustain=0.10, release=0.60)
```

#### `set_track_sends(project_name: str, track_index: int, bus_a?, bus_b?, bus_a_gain?, bus_b_gain?)`

Wire a track into the global buses (A = reverb, B = delay) with per-pair gain.

- `bus_a` / `bus_b` — `bool | None` (None = leave unchanged)
- `bus_a_gain` / `bus_b_gain` — float 0 .. 1.5 (unity 1.0)

Persists as `track.sends: [bool, bool]` and `track.sendGains: [float, float]`. The live mixer graph replays both on load; the offline MP3 render mirrors the routing so bounces match playback.

```py
set_track_sends(project_name="trap-demo", track_index=2,
                bus_a=True, bus_a_gain=0.7)
```

#### `set_track_automation(project_name: str, track_index: int, param: str, points: list[dict])`

Breakpoint lane for one of nine automatable parameters. Scheduler + offline render interpolate linearly between points at 16th-note resolution.

| `param` | Range | Unity |
|---|---|---|
| `volume`   | 0 .. 1.5   | 1.0 |
| `pan`      | -1 .. 1    | 0.0 |
| `sendA`    | 0 .. 1.5   | 1.0 |
| `sendB`    | 0 .. 1.5   | 1.0 |
| `fxReverb` | 0 .. 1     | 0.5 |
| `fxDelay`  | 0 .. 1     | 0.5 |
| `fxEqLow`  | -24 .. 24  | 0 (dB) |
| `fxEqMid`  | -24 .. 24  | 0 (dB) |
| `fxEqHigh` | -24 .. 24  | 0 (dB) |

`points: [{beat: float, value: float}]`. `beat` is in quarter-note beats, sorted ascending on write. Pass `points=[]` to clear the lane.

```py
# Volume ramp 0 → 1 → 0.4 over the first 8 beats
set_track_automation(project_name="trap-demo", track_index=2, param="volume",
                     points=[{"beat": 0, "value": 0.2},
                             {"beat": 4, "value": 1.0},
                             {"beat": 8, "value": 0.4}])
```

#### `set_arrangement(project_name: str, track_index: int, pattern_index: int, start_beat: int = 0, length_beats: int = 16)`

Place or move a pattern clip on the timeline. Finds an existing clip with the same `(track_index, pattern_index)` and moves it, otherwise appends a new clip.

*For audio clips (not pattern), use the CLI `arrange add-audio` command — MCP doesn't currently expose audio-clip placement.*

#### `set_tempo_changes(project_name: str, changes: list[dict])`

Replace the tempo-change list.

```py
set_tempo_changes(project_name="trap-demo",
                  changes=[{"beat": 0,  "bpm": 140},
                           {"beat": 32, "bpm":  90},
                           {"beat": 64, "bpm": 170}])
```

- `beat` — 16th-note step (0-indexed)
- `bpm` — 20..300

Pass `changes=[]` to clear. Honored by the engine and the MP3 offline render via `audio/tempo.js::bpmAtBeat`.

#### `set_markers(project_name: str, markers: list[dict])`

Replace the global-strip marker list.

```py
set_markers(project_name="trap-demo",
            markers=[{"name": "Intro", "beat":  0},
                     {"name": "Drop",  "beat": 32},
                     {"name": "Outro", "beat": 64}])
```

Same 16th-note step indexing. Clears with `markers=[]`.

#### `duplicate_project(source_name: str, dest_name: str)`

Copy `project.json` to a new project name. Does NOT copy `samples/` or `audio/` on disk — only the data model. If you need full-fidelity snapshots (including uploaded audio), add a follow-up `cp -r` or equivalent.

---

## Typical session

```
User  : "make me a lofi beat called chill-demo"
Agent : generate_beat(prompt="lofi 85bpm", project_name="chill-demo")
      → "Created project 'chill-demo' · 1 drum track · 85 BPM"

User  : "make the kick pattern more sparse"
Agent : get_project(project_name="chill-demo")    # inspect current pattern
      → edit_drum_pattern(project_name="chill-demo", pattern_index=0,
                          row_name="Kick", steps=[1, 9], velocities=[110, 90])

User  : "add a pad on top"
Agent : add_synth_track(project_name="chill-demo", track_name="Pad")
      → set_synth_params(project_name="chill-demo", track_index=1,
                         waveform="triangle", attack=0.3, release=1.2)
      → edit_notes(project_name="chill-demo", pattern_index=1, notes=[
          {"pitch": 48, "start":  0, "duration": 16, "velocity": 90},
          {"pitch": 51, "start": 16, "duration": 16, "velocity": 90},
        ])

User  : "send the pad to reverb"
Agent : set_track_sends(project_name="chill-demo", track_index=1,
                        bus_a=True, bus_a_gain=0.6)

User  : "fade the pad in over the first 4 beats"
Agent : set_track_automation(project_name="chill-demo", track_index=1,
                             param="volume",
                             points=[{"beat": 0, "value": 0}, {"beat": 4, "value": 1}])
```

Every write triggers SSE → any open browser tab viewing `chill-demo` reloads in place, no manual refresh.

---

## When to prefer MCP vs CLI vs raw Edit

| Path | Best for |
|------|----------|
| **MCP** | Agent sessions — validated args, structured returns, high-level ops. |
| **CLI** | Humans at a terminal or in shell scripts. |
| **Raw `Edit` on `project.json`** | Escape hatch when neither surface covers the op. Rare — prefer adding a tool when an edit repeats. |

All three end at `cli/store.py`'s atomic write, so mixing freely is safe.

---

## Development — adding a new tool

1. Add a `@mcp.tool()` function to `mcp-server/server.py`. Use `Annotated[type, "description"]` for every arg so the schema surfaces in clients.
2. Route every write through `_save_project(name, proj)` — it's atomic and creates `samples/` + `audio/` dirs.
3. Keep invariants identical to `cli/project_ops.py` where shapes overlap. If you're adding a new shape (e.g. new automation param), mirror it in the frontend (`scheduler.js`, `offline-render.js`, `mixer.js::getAutomationParam`) and document it above.
4. Test end-to-end against a throwaway `BASSMASH_PROJECTS_DIR=/tmp/...` so you don't pollute your real projects.
5. Update this doc's tool catalog table + signatures.

## Known gaps

- No tool for audio-clip arrangement placement (only pattern clips). Use `bassmash-cli arrange add-audio` for those.
- No tool for uploading sample files — drop them into `<project>/samples/` or `<project>/audio/` manually, or use the browser File tab.
- Bus FX parameters (bus A reverb wet, bus B delay time / feedback / wet) are tweakable via the Mixer's bus-strip knobs only — no MCP tool yet. Planned.
