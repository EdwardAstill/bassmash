# `project.json` Schema

The on-disk project file. One per project, at `$M8S_PROJECTS_DIR/<name>/project.json`. Read by the browser, the CLI, the MCP server, and the headless MP3 render — they all round-trip through `cli/store.py`'s atomic write (`tempfile + fsync + os.replace`).

The authoritative default shape lives in [`cli/store.py::DEFAULT_PROJECT`](../cli/store.py) and matches the TypeScript-ish sketch below.

```ts
{
  bpm: number,                    // base tempo, 20..300
  timeSignature: string,          // "4/4" (only 4/4 wired today)
  tracks: Track[],
  patterns: Pattern[],
  arrangement: Clip[],
  markers?: Marker[],
  tempoChanges?: TempoChange[],
  busMix?: BusMix,                // wet amounts on the global buses
}
```

Missing top-level keys default to empty arrays / sensible values — older projects survive forward compatibility via lazy fill-in on first write.

---

## Track

```ts
{
  name: string,                           // display name
  type: "drums" | "sample" | "synth" | "audio",
  muted: boolean,
  soloed: boolean,
  volume: number,                         // 0..100 fader percent (unity ≈ 70)
  pan: number,                            // -100 (L) .. 100 (R)
  width?: number,                         // 0..100 stereo width (default 100)
  color?: string,                         // token: amber | red | zinc | emerald | cyan | blue | violet
  effects: {
    eq: boolean,
    distortion: boolean,
    delay: boolean,
    reverb: boolean,
  },
  sends?: [boolean, boolean],             // [bus A on, bus B on]
  sendGains?: [number, number],           // [bus A gain 0..1.5, bus B gain 0..1.5]
  automation?: {                          // per-param breakpoint lanes
    volume?:    [{ beat: number, value: number }],
    pan?:       [...],  sendA?:    [...], sendB?:    [...],
    fxReverb?:  [...],  fxDelay?:  [...],
    fxEqLow?:   [...],  fxEqMid?:  [...], fxEqHigh?: [...],
  },
  synthParams?: SynthParams,              // only for type: "synth"
}
```

### `SynthParams`

```ts
{
  waveform?: "sine" | "square" | "sawtooth" | "triangle",
  filterType?: "lowpass" | "highpass" | "bandpass" | "notch",
  filterFreq?: number,     // 20..22050 Hz
  filterQ?: number,        // 0.1..20
  attack?: number,         // seconds
  decay?: number,          // seconds
  sustain?: number,        // 0..1
  release?: number,        // seconds
}
```

### Automation `value` ranges per `param`

| param | range | unity |
|---|---|---|
| `volume`   | 0 .. 1.5   | 1.0 |
| `pan`      | -1 .. 1    | 0.0 |
| `sendA`    | 0 .. 1.5   | 1.0 |
| `sendB`    | 0 .. 1.5   | 1.0 |
| `fxReverb` | 0 .. 1     | 0.5 |
| `fxDelay`  | 0 .. 1     | 0.5 |
| `fxEqLow`  | -24 .. 24  | 0 dB |
| `fxEqMid`  | -24 .. 24  | 0 dB |
| `fxEqHigh` | -24 .. 24  | 0 dB |

`beat` is in quarter-note beats for automation; scheduler + offline render interpolate linearly between adjacent points.

---

## Pattern

Two shapes coexist — drum / step patterns and synth / note patterns. They discriminate on the `type` field.

### Drum / step pattern

```ts
{
  name: string,
  type: "drums" | "steps",            // "drums" is the canonical spelling today
  stepCount: number,                  // typically 16 (1 bar of 16ths)
  steps: [                            // one entry per pad / row in the rack
    {
      name: string,                   // "Kick", "Snare", "HH Closed", …
      sampleRef: string,              // "kit://kick-808.wav" | "project-sample-name.wav"
      cells: boolean[stepCount],      // active step mask
      velocities: number[stepCount],  // 0..127 per step (0 for inactive steps)
      muted?: boolean[stepCount],     // ghost-note mask — active but silent
      gain?: number,                  // 0..2 per-pad sample gain (default 1)
      pitch?: number,                 // -12..+12 semitones (default 0)
      loop?: boolean,                 // one-shot vs loop playback
    }
  ]
}
```

### Synth / note pattern

```ts
{
  name: string,
  type: "notes" | "synth",            // either spelling; UI treats them the same
  stepCount?: number,                 // 16 for display snapping
  length: number,                     // total steps the pattern spans
  notes: [
    {
      pitch: number,                  // MIDI 0..127 (60 = C4)
      start: number,                  // 16th-note step, 0-indexed
      duration: number,               // 16th-note steps
      velocity: number,               // 1..127
    }
  ]
}
```

---

## Clip (arrangement entry)

A clip places a pattern or audio file on the timeline.

### Pattern clip (drums or synth)

```ts
{
  trackIndex: number,                 // index into tracks[]
  patternIndex: number,               // index into patterns[]
  patternName?: string,               // cached for display
  startBeat: number,                  // in quarter-note beats (integer or 0.5 etc.)
  lengthBeats: number,                // total span in quarter-note beats
  muted?: boolean,                    // per-clip mute — scheduler skips it, other clips play
}
```

If `lengthBeats > pattern.stepCount / 4`, the pattern loops internally for the full clip length (step index modulo `stepCount`).

### Audio clip

```ts
{
  type: "audio",
  trackIndex: number,
  audioRef: string,                   // filename under <project>/audio/
  startBeat: number,
  lengthBeats: number,                // 0 means "play to natural end"; hard-stop on loop wrap
  offset?: number,                    // seconds into the audio buffer to start from
  muted?: boolean,
}
```

---

## Marker

Labeled beat positions rendered on the global strip.

```ts
{
  name: string,                       // "Intro", "Drop", …
  beat: number,                       // 16th-note step (0-indexed)
}
```

---

## TempoChange

```ts
{
  beat: number,                       // 16th-note step
  bpm: number,                        // 20..300
}
```

Resolution helper: [`audio/tempo.js::bpmAtBeat(data, beat)`](../app/js/audio/tempo.js). Looks up the max-beat entry `<=` the current beat, falls back to `data.bpm`. Engine reads this per 16th-note, so tempo ramps are step-quantised; fine-grained ramping would need a scheduler change.

---

## BusMix

Wet amounts / delay params on the global bus strips, persisted with the project.

```ts
{
  busA?: {
    reverb?: number,                  // 0..1 wet
  },
  busB?: {
    delay?: number,                   // 0..1 wet
    delayTime?: number,               // 0.05..1.5 seconds
    delayFeedback?: number,           // 0..0.95
  }
}
```

On project load the browser calls `mixer.setBusFx(busIdx, paramKey, value)` for each field so the live graph matches what's on disk.

---

## Writing project.json by hand

You *can* hand-edit the JSON (it's pretty-printed with 2-space indent). The browser picks up changes via SSE within ~500 ms. Two things to know:

1. **`cli.store.write_project` is atomic** — temp file + rename. Running `m8s-cli` or the MCP while you also have a `$EDITOR` session open is safe; the browser will reload to the last-written version.
2. **Indices are load-bearing.** Deleting a track via hand-edit doesn't renumber arrangement `trackIndex` fields. Use `m8s-cli track rm <project> <idx>` or MCP `delete_track` — both reindex.

---

## Related files

- [`cli/store.py`](../cli/store.py) — atomic IO, env-var roots, DEFAULT_PROJECT.
- [`cli/project_ops.py`](../cli/project_ops.py) — pure-function mutations shared across CLI + MCP.
- [`app/js/state.js`](../app/js/state.js) — frontend StateStore, keeps `store.data` matching this shape.
- [`app/js/audio/scheduler.js`](../app/js/audio/scheduler.js) — the reader-of-truth during playback.
- [`app/js/audio/offline-render.js`](../app/js/audio/offline-render.js) — scheduler mirror for MP3 bounce.
