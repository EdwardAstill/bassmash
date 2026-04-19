# Bassmash Performance Plan

> **Historical document.** Written before the 9-zone UI rewrite and the 2026-04-19 P1–P3 delivery. Module names in §4 ("The frontend") are stale: the listed `timeline.js`, `piano-roll.js`, `step-sequencer.js`, `mixer-panel.js`, `topbar.js`, `waveform.js`, `export.js` have been removed or replaced. Current audio architecture is documented in [../NEXT_STEPS.md](../NEXT_STEPS.md) — the perf concepts below (scheduler lookahead, offline render, Canvas redraw cost, worklet path) still apply.

**Goal.** Take Bassmash from "works in the browser" to "feels like a professional DAW" — predictable timing, zero audible glitches, smooth UI under load, fast export, and a clear path to native speed when we need it.

This document is written assuming **no prior audio or DSP knowledge**. Every term used is defined either inline or in the glossary at the end. Read top-to-bottom the first time; use the table of contents afterwards.

---

## Table of contents

1. [What "performance grade" actually means](#1-what-performance-grade-actually-means)
2. [Audio fundamentals — from scratch](#2-audio-fundamentals--from-scratch)
3. [How the browser plays audio](#3-how-the-browser-plays-audio)
4. [How Bassmash works today](#4-how-bassmash-works-today)
5. [The twelve work items, in order](#5-the-twelve-work-items-in-order)
6. [The future native path (Rust / Tauri / WASM)](#6-the-future-native-path-rust--tauri--wasm)
7. [Glossary](#7-glossary)

---

## 1. What "performance grade" actually means

A "performance grade" DAW (Digital Audio Workstation — the category that includes Ableton Live, FL Studio, Logic Pro, Bitwig) meets a short list of measurable promises:

| Promise | Target | How we measure |
|---|---|---|
| No audio glitches under normal load | 0 buffer underruns per hour | Console / perf HUD counter |
| Predictable timing | Scheduled notes play within ±1 ms of their beat time | Log `actualTime - scheduledTime` |
| Fast input response | Click-to-sound ≤ 20 ms | Log `pointerdown → voice.start` |
| Smooth UI | 60 fps sustained, no dropped frames during playback | `requestAnimationFrame` timestamps |
| Quick project load | ≤ 2 s for a 40-track project | `performance.now()` around load flow |
| Fast export | Offline render ≥ 5× realtime | Compare `renderDuration / songDuration` |
| Low idle cost | Audio engine uses < 5 % CPU when stopped | OS activity monitor |

"Performance grade" is not a vibe. It is these numbers. Everything in this plan exists to move one of these numbers.

---

## 2. Audio fundamentals — from scratch

### 2.1 Sound is a wave of air pressure

Hit a drum. The skin pushes air outward, then pulls back, then pushes again. The air molecules near the drum get briefly squeezed together, then briefly spread apart, in a pattern. That repeating squeeze-and-spread pattern is a **sound wave**. It travels through the air to your ear. Your eardrum is a tiny membrane that gets pushed and pulled by those pressure changes, and your brain interprets the pattern as sound.

Everything in audio software is just numbers that describe that pressure-over-time pattern.

### 2.2 Samples and sample rate

A computer can't store a continuous wave. It stores a list of numbers. Each number is the air pressure at one moment in time, measured as a value between −1.0 and +1.0. That single number is called a **sample**.

How often do we take a measurement? For CD quality, **44,100 times per second**. That number is the **sample rate**. Modern DAWs usually run at 44,100 Hz or 48,000 Hz.

So one second of stereo audio at 48 kHz is:

```
48,000 samples/second × 2 channels × 4 bytes/sample = 384,000 bytes ≈ 375 KB
```

An hour is about 1.3 GB per channel. That's why we care about efficiency.

### 2.3 Waveform

A **waveform** is the visual shape of that list of samples plotted on a graph — time on the x-axis, sample value (−1 to +1) on the y-axis. When you see the grey squiggly shape inside an audio clip in the timeline, you are looking at a **waveform**.

Because plotting 48,000 points per second would be unreadable, DAWs display a **downsampled** waveform: for every group of, say, 100 samples, store only the maximum value. That's the grey blob you see. Bassmash does this in `app/js/audio/waveform.js` — each cached file has a 500-point `Float32Array` used purely for drawing.

### 2.4 Frequency, pitch, and oscillators

If a wave repeats itself 440 times per second, we say it has a **frequency** of 440 Hz. That particular frequency is the note A above middle C. Higher frequency = higher pitch.

An **oscillator** is a software component that generates a repeating wave at a given frequency. The four classic shapes are:

- **sine** — pure, soft tone (a flute-ish sound)
- **square** — hollow, buzzy (old video games)
- **sawtooth** — bright, cutting (string-like synth lead)
- **triangle** — softer square, like a muted sine

Bassmash's `synth.js` creates oscillators via `ctx.createOscillator()` and picks the shape via `osc1.type = 'sawtooth'`.

### 2.5 Amplitude and envelope

**Amplitude** = loudness, i.e. how large the wave values are. Samples always stay between −1 and +1; to make something louder you multiply all samples by a gain factor (1.0 = same, 2.0 = twice as loud, 0.5 = half).

Every real musical note has a shape over time. A piano note is loud at the start (the hammer hit) and fades. A pad sound swells in slowly and falls away slowly. That volume-over-time shape is called an **envelope**, usually described by four stages:

- **Attack** — how long to ramp from silent to full volume after the key is pressed
- **Decay** — how long to drop from full volume down to the sustain level
- **Sustain** — the volume held while the key is still down
- **Release** — how long to fade to silence after the key is released

Together these four numbers are called **ADSR**. Bassmash applies ADSR using a chain of gain ramps (`ampEnv.gain.linearRampToValueAtTime(...)` in `synth.js`).

### 2.6 Filters and EQ

A **filter** lets certain frequencies pass through and blocks others.

- **Low-pass filter** — keeps low frequencies, removes highs (makes things muffled, "underwater")
- **High-pass filter** — keeps highs, removes lows (makes things thin, "telephone")
- **Band-pass** — keeps only a middle band
- **Notch** — removes a single narrow band

An **EQ** (short for **equaliser**) is several filters in a row, each with adjustable gain at different frequencies. A 3-band EQ — like the one in Bassmash's `effects.js` — has three bands: **low shelf** (boosts or cuts bass), **peaking mid** (boosts or cuts a middle band), **high shelf** (boosts or cuts treble). EQs are how you make a mix sound "balanced" — e.g. cut the mud around 300 Hz, add sparkle around 10 kHz.

### 2.7 Delay, reverb, distortion

- **Delay** — records the signal, plays it back a short time later, optionally feeding it back into itself. This is the echo effect.
- **Reverb** — simulates a real acoustic space (room, hall, cathedral). Mathematically it's a **convolution** of the input signal with an **impulse response** (IR): a short recording of a physical space that captures how it smears sound over time.
- **Distortion** — deliberately clips or warps the waveform so the shape is no longer a clean curve. Produces the crunchy, overdriven sound of rock guitar. Bassmash generates a distortion curve in `effects.js` using a function that softens clipping.

### 2.8 Stereo, pan, mix, master

**Stereo** = two channels, left and right. **Pan** = how much of a sound goes to left versus right (a hard-panned-left hi-hat only comes out the left speaker).

A **mixer channel** is the processing chain for one track: effects → volume → pan → sum into the master bus. The **master bus** is the final stereo output that goes to the speakers and the exported file. Bassmash's `mixer.js` builds exactly this: each `MixerChannel` has its own effects chain, gain node, and pan node, all connected to `engine.masterGain`.

### 2.9 DSP

**DSP** = **Digital Signal Processing**. It is the maths that turns one list of samples into another list of samples. A filter, a reverb, a compressor — all DSP. Whenever someone says "DSP code," they mean the innermost loop that reads samples and writes samples.

---

## 3. How the browser plays audio

### 3.1 The Web Audio API

Browsers provide **Web Audio**, a set of JavaScript APIs designed for real-time audio. You create an **AudioContext** and then build a **graph** of **nodes** that transform sound. Each node is a C++ implementation inside the browser engine — your JavaScript is just wiring them together.

```
OscillatorNode → BiquadFilterNode → GainNode → AudioContext.destination
```

Bassmash uses Web Audio heavily: `createOscillator`, `createBiquadFilter`, `createGain`, `createStereoPanner`, `createConvolver`, `createDelay`, `createWaveShaper`, `createBufferSource`, `createAnalyser`. All native to the browser.

### 3.2 The two threads — main vs audio

There are two separate threads involved.

- **Main thread** — runs your JavaScript, handles mouse clicks, updates the DOM, draws to canvas, runs React/Vue/whatever. This thread can be slow, blocked, garbage-collected, etc. If you block the main thread for 100 ms, the UI freezes.
- **Audio thread** — owned by the browser, runs at a high priority, pulls audio samples out of the node graph every few milliseconds and ships them to the sound card. It cannot be blocked. If it is blocked, you hear a **glitch**: a pop, click, or dropout.

The audio thread needs new samples on a strict schedule. Typically the sound card asks for about 128 samples at a time at 48 kHz, which is **~2.7 ms**. Miss that deadline and there is silence in that gap.

### 3.3 AudioWorklet — custom DSP on the audio thread

Sometimes you want custom DSP that Web Audio's built-in nodes don't provide. **AudioWorklet** is the API for that. You write a class with a `process(inputs, outputs)` method that the browser calls on the **audio thread** every 128 samples. Your code runs in that tight 2.7 ms window.

Bassmash does **not** currently use AudioWorklet. Everything is built from built-in nodes, which is fine for now but limits us when we need custom meters, analysers, or exotic effects.

### 3.4 Scheduling — the "lookahead" pattern

You cannot use `setTimeout` to fire a note "exactly on beat 2." JavaScript timers are only accurate to maybe ±10 ms, which is musically awful.

The trick — popularised by Chris Wilson's article *A Tale of Two Clocks* — is:

1. Every 25 ms, the main thread wakes up.
2. It asks the audio context "what time is it right now?" (via `AudioContext.currentTime`, which is accurate to the sample).
3. For every beat that will occur in the next 100 ms, call `source.start(scheduledTime)`. Web Audio nodes accept a precise start time and fire sample-accurately on the audio thread when that time arrives.

The gap between wake-up interval (25 ms) and lookahead window (100 ms) means it's OK if the main thread stalls for up to 75 ms without any audible effect — the audio thread already knows what to play.

Bassmash already does this (`engine.js:56-76`, `_lookahead = 0.1`, `_scheduleInterval = 25`). This is correct and does not need to change. It is one of the things Bassmash does right.

### 3.5 OfflineAudioContext — rendering faster than real time

`OfflineAudioContext` is a special context that runs the whole audio graph as fast as the CPU allows, writing the output to an `AudioBuffer` rather than the speakers. You use it to bounce (export) a project to a WAV file. Bassmash already uses this in `export.js:15` for export.

### 3.6 WASM — the escape hatch to native speed

**WASM** = **WebAssembly**. A binary format that browsers can execute at roughly C-level speed. You write code in Rust, C++, or AssemblyScript, compile it to `.wasm`, and call it from JavaScript. Inside an AudioWorklet, WASM DSP can be 5–20× faster than equivalent JavaScript.

Bassmash does not use WASM today. It is the future hot-path optimisation (see section 6).

---

## 4. How Bassmash works today

A snapshot of the current architecture so the plan makes sense in context.

### 4.1 Frontend layout

```
app/
├── index.html
├── css/
└── js/
    ├── main.js            # Boot sequence, event wiring
    ├── state.js           # In-memory project state + event bus
    ├── api.js             # HTTP calls to the Python backend
    ├── audio/
    │   ├── engine.js      # AudioContext, master gain, lookahead scheduler
    │   ├── mixer.js       # Per-track channels (effects → gain → pan → master)
    │   ├── effects.js     # EQ, distortion, delay, reverb chain
    │   ├── sampler.js     # Sample cache + play-at-time
    │   ├── synth.js       # Oscillator + filter + envelope voice builder
    │   ├── waveform.js    # decode + downsample, cached by URL
    │   └── export.js      # Offline render to WAV → POST to backend for MP3
    └── ui/
        ├── timeline.js    # Canvas-based playlist (476 LOC, full-redraw)
        ├── piano-roll.js  # Floating piano-roll editor
        ├── step-sequencer.js
        ├── mixer-panel.js
        ├── browser.js     # File browser panel
        ├── topbar.js
        └── utils.js
```

### 4.2 The backend

Python (FastAPI-style, see `server/routes.py` and `server/main.py`) serves project files, sample files, and handles MP3 encoding. Not on the audio hot path — not a performance concern for this plan.

### 4.3 What is already good

- **Scheduler.** `engine.js` already implements the two-clock lookahead pattern correctly.
- **Decode cache.** `sampler.js` caches decoded `AudioBuffer`s by URL so a sample only decodes once per session.
- **Canvas timeline.** `timeline.js` renders to a single `<canvas>` rather than one DOM element per clip. Good ceiling for large projects.
- **Offline export.** `export.js` uses `OfflineAudioContext`, so export is already faster-than-realtime.
- **Small codebase.** ~1,800 LOC of JS. Easy to refactor confidently.

### 4.4 What is missing or weak

1. No **performance instrumentation** — we can't see CPU, voice count, scheduler drift, or dropped frames.
2. Waveform **decode and downsample run on the main thread**, blocking UI while large samples load.
3. Timeline does a **full canvas redraw every animation frame** rather than dirty-rect redraws.
4. Mixer uses **vanilla `GainNode.gain.value =`** writes — these can cause zipper noise and aren't smoothed.
5. **No AudioWorklet** anywhere — everything is built-in nodes. No custom meters, no room for WASM DSP.
6. **State is a single shared mutable object** — UI and engine both read from `store.data`. Works now, but will race if we ever off-thread the engine.
7. **No lookahead budget for audio clips** — sample-based clips aren't scheduled via the same lookahead scheduler, they are triggered on the main thread.
8. **No OS-level low-latency flags** set on `AudioContext` (`latencyHint: 'interactive'`).
9. **No polyphony cap** on the synth — a runaway pattern can spawn hundreds of voices.
10. **Export blocks the UI** — `OfflineAudioContext.startRendering()` is called on the main thread without progress feedback.

---

## 5. The twelve work items, in order

Each item follows the same structure:

- **Problem** — the specific pain this fixes
- **Fix** — what we change
- **How it works** — enough detail to understand without reading code
- **Why it matters** — which "performance grade" number it moves
- **Effort** — S / M / L / XL (hours / half-day / day / multi-day)

The order is deliberate. Instrumentation first (you can't optimise what you can't see). Then correctness and architecture. Then optimisations that depend on the earlier work. Then WASM and native path.

---

### Item 1 — Performance HUD (dev only)

**Effort:** S

**Problem.** We have no live numbers. Every decision from here on is evidence-based, so we need the evidence first.

**Fix.** Add a small dev-only overlay in the top-right corner (toggled with `` ` `` key) that shows:

- Audio thread CPU %: use `AudioContext.renderCapacity` on Chromium, fall back to estimating from `baseLatency` / `outputLatency`.
- Active voice count: every `Synth.playNote` and `Sampler.play` increments a counter, the source's `onended` decrements it.
- Scheduler drift: in `_schedule`, log `ctx.currentTime - _nextBeatTime` rolling max over the last second.
- Frame time: difference between consecutive `requestAnimationFrame` timestamps; rolling max.
- Dropped frames: count of frames where delta > 20 ms.
- Voice limit: current `maxVoices` setting (see item 9).

Build as a single `PerfHud` class in `app/js/ui/perf-hud.js`, enabled via `?perf=1` query string or the `` ` `` key. Zero cost when disabled.

**Why it matters.** Gives us the measurement pipeline that every later item depends on.

---

### Item 2 — Low-latency AudioContext flags

**Effort:** S

**Problem.** Default `AudioContext` uses `latencyHint: 'balanced'`, which means the browser may use a larger buffer (e.g. 512 samples ≈ 10 ms) to reduce CPU. For a performance tool we want the lowest latency we can stably sustain.

**Fix.** Change `engine.js:16`:

```js
this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
```

`'interactive'` requests the smallest buffer (typically 128 samples ≈ 2.7 ms). Pinning the sample rate prevents device-switch surprises.

**Why it matters.** Directly lowers click-to-sound (input-response) latency.

---

### Item 3 — Move waveform decode off the main thread

**Effort:** M

**Problem.** In `waveform.js`, `audioCtx.decodeAudioData(arrayBuf)` is already asynchronous (good), but the follow-up `_downsample` loop runs on the main thread and scales with file length. A 10-minute sample causes a visible freeze.

**Fix.** Create `app/js/audio/waveform-worker.js`, a Web Worker that:

1. Receives a `Float32Array` of channel data.
2. Runs the downsample loop there.
3. Posts back the 500-point peaks array.

The main thread still calls `decodeAudioData` (must happen in an `AudioContext`, which lives on the main thread), then sends the raw samples to the worker via `postMessage` with a **transferable** `ArrayBuffer` (zero-copy — the buffer is moved, not cloned). The worker responds with the peaks. Cache the result in `_cache` as today.

**Why it matters.** Keeps the UI at 60 fps while loading large audio. Moves "quick project load" toward the 2 s target.

---

### Item 4 — Dirty-rect rendering in the timeline

**Effort:** M

**Problem.** `timeline.js:render()` clears the entire canvas and redraws every frame — tracks, clips, grid, waveforms, headers, playhead. On a 40-track project this burns CPU on things that did not change.

**Fix.** Split rendering into layers:

- **Background layer** — grid + track backgrounds + headers. Redrawn only on scroll, resize, or track-list change.
- **Clip layer** — clips with waveforms. Redrawn only when arrangement or waveforms change.
- **Playhead layer** — the moving vertical line. Redrawn every frame during playback, but only the thin vertical strip at the old and new positions is erased and redrawn.

Use separate `OffscreenCanvas` buffers for background and clip layers; composite onto the main canvas each frame. `OffscreenCanvas` also allows moving the clip rendering to a worker later if needed.

**Why it matters.** Sustains 60 fps during playback regardless of project size. Reduces idle-playback CPU to near zero.

---

### Item 5 — Smoothed parameter changes (no more zipper noise)

**Effort:** S

**Problem.** `MixerChannel.setVolume(v)` does `this.gain.gain.value = v`. Direct assignment to an `AudioParam` causes an **instantaneous** jump on the audio thread. A user dragging a fader 60 times a second creates a staircase of jumps; you hear a buzzy artefact called **zipper noise**.

**Fix.** Use `AudioParam.setTargetAtTime(target, currentTime, timeConstant)` for all user-facing parameter changes. A time constant of 0.01 s is imperceptibly smooth but still feels instant.

Apply to: channel volume, master volume, pan, EQ gain, distortion mix, delay mix, reverb mix, delay time, delay feedback.

Write a small helper:

```js
function smoothParam(param, value, timeConstant = 0.01) {
  const now = engine.ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}
```

Use it instead of `param.value =` throughout `mixer.js` and `effects.js`.

**Why it matters.** Removes clicks and buzz on knob drags. Zero glitches-per-hour target.

---

### Item 6 — Schedule audio clips via the lookahead scheduler

**Effort:** M

**Problem.** Sample-based clips (audio tracks) are triggered on beat events on the main thread. If the main thread stalls for 50 ms at the moment the clip should start, the clip starts late and audibly out of time.

**Fix.** Instead of playing on the `'beat'` event, subscribe the timeline's scheduler inside `_schedule` in `engine.js`. When the scheduler enqueues beat `N` at `t = _nextBeatTime`, iterate `store.data.arrangement` and for any clip whose `startBeat * 4 === N`, call `sampler.play(ref, t, destination, ...)` with the **future** scheduled time. `AudioBufferSourceNode.start(t)` fires sample-accurately on the audio thread.

This unifies synth/drum and audio-clip scheduling into a single correct path.

**Why it matters.** Brings scheduled-note-vs-beat drift for audio clips to ±1 ms, matching our target.

---

### Item 7 — Voice pool and polyphony cap

**Effort:** M

**Problem.** `Synth.playNote` creates fresh `OscillatorNode`/`BiquadFilterNode`/`GainNode` instances on every note. Creating and tearing down nodes has real cost — GC pressure on the main thread, allocator churn in the audio engine. A runaway pattern with a 1/64 note synth over 8 bars can spawn 500+ voices in a second.

**Fix.** Two changes:

1. **Voice pool.** Pre-allocate a pool of `N` voice objects (default 64). Each voice owns its node chain, reset between uses via `setValueAtTime`. Reuse the oldest released voice for the next note. `OscillatorNode` can only `start()` once per lifetime — we work around this by disconnecting and recreating only the oscillators inside a persistent envelope/filter chain, or simply cap reuse count and drop to fresh creation past that.
2. **Polyphony cap.** When all voices are in use, **voice-steal** the oldest: ramp its amp envelope to zero over 5 ms, then reuse. Cap is a config setting, default 64, exposed in the perf HUD.

**Why it matters.** Bounds CPU in pathological cases and reduces GC pauses. Keeps `glitches/hour = 0` under heavy patterns.

---

### Item 8 — AudioWorklet-based metering

**Effort:** M

**Problem.** `mixer.getMeterData()` uses `AnalyserNode`, which only exposes a single FFT — useful for a master meter but not for per-channel peak/RMS metering. Per-channel metering today would cost one `AnalyserNode` per track, all polled from the main thread at UI rate, which is both wasteful and coarse.

**Fix.** Add an `AudioWorklet` called `meter-processor.js` that computes per-channel **peak** (max absolute sample in the last block) and **RMS** (root-mean-square, a loudness proxy) on the audio thread. Every ~50 ms it posts `{peak, rms}` to the main thread.

Insert one `MeterWorklet` at the end of each `MixerChannel`'s chain (after pan, pre-master). The mixer panel reads the posted values directly.

**Why it matters.** Accurate, cheap, per-channel meters. Also proves out the AudioWorklet pipeline for item 11 (WASM DSP).

---

### Item 9 — Chunked, cancellable offline export with progress

**Effort:** M

**Problem.** `OfflineAudioContext.startRendering()` on a long project can take several seconds during which the UI is frozen and there is no way to cancel. It also blocks because the WAV encoding loop in `audioBufferToWav` (`export.js:22-48`) runs synchronously on the main thread.

**Fix.**

1. Chunk the render. Break the song into 4-bar segments, render each into its own short `OfflineAudioContext`, then concatenate the resulting `Float32Array`s. Emit a progress event per chunk (`{done, total}`).
2. Move WAV serialisation into a worker so it can't freeze the UI even on long songs.
3. Allow cancellation via `AbortController`; abort drops the pending chunks and discards partial output.

**Why it matters.** Export stays ≥ 5× realtime while the UI stays responsive. Cancelling a mistake no longer requires a page reload.

---

### Item 10 — Engine-side state snapshot (prep for threading)

**Effort:** L

**Problem.** Today both UI code and engine code read/write the same `store.data` object. That's fine now, but it blocks two future moves: (a) running the engine in a worker, and (b) WASM DSP that expects a flat, stable data layout.

**Fix.** Introduce a **snapshot** step:

- `store.data` remains the mutable UI source of truth.
- On every scheduler tick (every 25 ms), the engine reads whatever fields it needs and produces a plain, flat, immutable **engine snapshot** — a small object containing `{bpm, loopLen, arrangement, patterns[ref]}`, referenced by integer indices only.
- The scheduler operates on the snapshot, never on `store.data` directly.

This is a small refactor today and an enormous win later. It also makes it obvious which state is "hot" (read by audio) vs "cold" (UI only).

**Why it matters.** Prerequisite for items 11 and 12. Also eliminates a class of race conditions where mutating an array while iterating causes skipped notes.

---

### Item 11 — WASM hot-path DSP (mixer sum + EQ + compressor)

**Effort:** L

**Problem.** Even with Web Audio's native nodes, the overhead of many `GainNode` and `BiquadFilterNode` instances adds up. A project with 40 tracks × 3 EQ bands × stereo = 240 biquad filters processed per 128-sample block. Each is fast individually, but node graph traversal and parameter automation have real per-node cost.

**Fix.** Write a small Rust crate `dsp/` that exposes:

- `mix_sum(inputs: &[&[f32]], gains: &[f32], out: &mut [f32])` — sum N channels with gains.
- `biquad(block: &mut [f32], coeffs: &[f32], state: &mut [f32])` — apply an IIR biquad.
- `compressor(block: &mut [f32], params: &CompressorParams, state: &mut CompressorState)` — simple feed-forward compressor.

Compile with `wasm-pack build --target web`. Load from an `AudioWorkletProcessor` that owns a single Rust instance per track, replacing the long native-node chain with one worklet call per block.

Kept lean — just the kernels. Not every effect needs to move.

**Why it matters.** Cuts per-track CPU significantly on large projects. Keeps headroom for more tracks, better reverbs, and eventually plugin hosting.

---

### Item 12 — Native path evaluation (Tauri + cpal)

**Effort:** XL (only if measurements warrant)

**Problem.** Some classes of DAW feature are impossible in a browser: sample-accurate MIDI I/O, VST/AU plugin hosting, integration with OS audio routers like JACK or CoreAudio aggregate devices, buffer sizes below 128 samples.

**Fix.** If — and only if — items 1–11 close the measured gaps and we still want those browser-impossible features, port to **Tauri**:

- Tauri shell replaces the browser. Same HTML/CSS/JS frontend runs inside a webview.
- Audio engine moves to Rust, using **cpal** for direct CoreAudio / WASAPI / ALSA access.
- Scheduler moves to a dedicated Rust thread with real-time priority.
- Frontend talks to the engine via `tauri::invoke` commands and a broadcast channel for events.
- The dsp/ crate from item 11 is reused directly.

This is a multi-month effort. Do not start until items 1–11 are done and measurements show we need it.

**Why it matters.** Unlocks sub-3 ms round-trip latency, plugin hosting, and professional I/O — the features that separate "browser DAW" from "studio DAW."

---

## 6. The future native path (Rust / Tauri / WASM)

### 6.1 What these things are

- **Rust.** A systems programming language with the performance of C++ and memory safety guarantees. Excellent fit for audio code because it has no garbage collector (so no pauses), predictable memory layout, and strong concurrency primitives.
- **WASM (WebAssembly).** A compact binary format that runs in the browser at near-native speed. You write code in Rust (or C, or AssemblyScript), compile to `.wasm`, and call it from JavaScript. Useful inside `AudioWorklet` where the JS `process()` method is too slow.
- **Tauri.** A framework for packaging a web frontend as a native desktop app, with a Rust backend. The frontend is still HTML/CSS/JS inside a webview (like a mini browser), but the backend has full OS access and can link C libraries. Much smaller and faster than Electron (which ships a whole Chrome instance per app).
- **cpal.** A Rust library for low-level cross-platform audio I/O. Gives you raw access to the sound card at the smallest buffer sizes the OS allows.

### 6.2 Why not jump straight to Rust + Tauri now?

Three reasons.

1. **The browser is already fast enough for 80 % of what Bassmash wants to be.** Web Audio + `AudioWorklet` + WASM is within 20 % of native for pure DSP throughput. Most of our current performance problems are scheduling, state, and UI concerns — not DSP throughput. Porting the backend to Rust solves none of them.
2. **Rewriting costs months, with no user-visible benefit during that time.** Items 1–11 each ship a visible improvement the same week they land.
3. **The work is not wasted.** The DSP kernels from item 11 are pure Rust and port directly to the Tauri native audio thread. The engine-snapshot refactor from item 10 makes the Tauri port a small wiring exercise rather than an architectural rewrite.

The real question is not "Rust?" but "when?" Answer: after item 11, if measurements still show we need it, and if we want features that require it.

### 6.3 If we do go Tauri, the UI framework question

Two choices.

- **Keep the existing JS/HTML/CSS frontend unchanged.** Tauri renders it inside a webview. Smallest possible migration — you only rewrite the engine. Recommended.
- **Rewrite the UI in a Rust GUI framework.** Candidates: **egui** (immediate-mode, widely used in audio plugins, good custom-draw story for timelines and piano rolls), **iced** (Elm-like, clean but less mature for complex DAW UIs), **gpui** (Zed's framework, very fast but tied to Zed's ecosystem). Only worth doing if the webview itself becomes a performance bottleneck, which it won't for a long time.

Default to Tauri + existing JS UI if we go native.

---

## 7. Glossary

**ADSR.** Attack, Decay, Sustain, Release — the four stages of a volume envelope. See §2.5.

**AudioBuffer.** An in-memory `Float32Array` of audio samples, decoded from an MP3/WAV file. Created by `AudioContext.decodeAudioData`. Bassmash caches them in `sampler.js` and `waveform.js`.

**AudioContext.** The root object in Web Audio. Owns the audio thread, the master output, and all node instances. Bassmash has one, created in `engine.js:init`.

**AudioParam.** A property on a Web Audio node (like `GainNode.gain`) that can be set instantly (`param.value = x`), scheduled (`param.setValueAtTime(x, t)`), or smoothed (`param.setTargetAtTime(x, t, τ)`).

**AudioWorklet.** API for running custom JavaScript (or WASM) DSP on the audio thread. See §3.3.

**Beat.** In Bassmash, a quarter note. The scheduler works in 16th notes (so 4 scheduler ticks per beat). BPM 120 means 120 beats (= 480 scheduler ticks) per minute.

**BPM.** Beats per minute. Tempo.

**Buffer.** A chunk of samples the sound card expects at once. Smaller buffer = lower latency, higher CPU demand. Typical values: 128, 256, 512 samples.

**Canvas.** An HTML element that gives you a 2D (or WebGL) drawing surface. Bassmash's timeline is one `<canvas>` that redraws itself every frame.

**Convolution.** The maths behind reverb. Multiplies the input signal with an impulse response across all points in time. Web Audio's `ConvolverNode` does it in hardware-accelerated C++.

**CPU %.** The fraction of a block period (e.g. 2.7 ms at 128-sample buffers) spent actually computing audio. If this reaches 100 %, the audio thread misses its deadline and you hear a glitch.

**Decode.** Turning a compressed file (MP3, OGG, AAC) into raw `Float32Array` samples. Expensive once, free forever after — hence the cache in `sampler.js`.

**DOM.** Document Object Model — the tree of HTML elements. Changing DOM is comparatively slow; use canvas for things that change every frame.

**DSP.** Digital Signal Processing. See §2.9.

**Envelope.** See ADSR, §2.5.

**EQ (Equaliser).** A chain of filters that boosts or cuts specific frequency bands. See §2.6.

**FFT.** Fast Fourier Transform — an algorithm that decomposes a signal into its frequency components. Used by `AnalyserNode` for spectrum displays.

**Frame.** One redraw of the screen, typically 60 per second. Budget: 16.7 ms. If a frame takes longer, the user sees a stutter.

**Garbage collection (GC).** The JS runtime periodically pausing to reclaim unused memory. A GC pause on the audio thread = a glitch. One reason to avoid allocations in hot audio code.

**Graph.** The network of Web Audio nodes connected by `.connect()` calls. Samples flow through it every block.

**Impulse response (IR).** A short recording (a few seconds) of how a physical space responds to a click. Convolving a dry signal with an IR makes the signal sound like it was played in that space. Bassmash generates a synthetic noise-decay IR as a default reverb (`effects.js:45-54`).

**Latency.** The time between cause and effect. Types:
- *Output latency.* Sample generated → sound out of speaker.
- *Input latency.* User action → first sample of new sound.
- *Round-trip latency.* Input → processing → output.

**Lookahead.** See §3.4. How far into the future the scheduler queues notes. Bassmash uses 100 ms.

**Main thread.** The JavaScript thread that runs UI code. Cannot be blocked for more than ~16 ms without user-visible stutter.

**Mixer.** Combines multiple tracks into a stereo output, with per-channel volume, pan, and effects. See §2.8.

**Node (audio node).** A unit of DSP in Web Audio — oscillator, gain, filter, etc. They form a graph.

**OfflineAudioContext.** A non-realtime `AudioContext` that renders to an `AudioBuffer` as fast as the CPU allows. Used for export.

**Oscillator.** A node that produces a repeating waveform at a given frequency. See §2.4.

**Pan.** Left/right balance. Range −1 (full left) to +1 (full right).

**Peak meter.** A meter showing the maximum absolute sample value over the last short window. "Peak" measures how close you are to clipping.

**Pitch.** How high or low a note is. Determined by fundamental frequency. See §2.4.

**Polyphony.** How many notes can play simultaneously. Finite because each voice costs CPU.

**Release.** The fade-out stage of an envelope. See §2.5.

**requestAnimationFrame (rAF).** Browser API that calls a callback before the next screen repaint. The right way to drive canvas animation.

**RMS.** Root Mean Square. The square root of the average of squared sample values over a window. Better correlate of perceived loudness than peak.

**Sample.** A single numerical measurement of air pressure. See §2.2.

**Sample rate.** Samples per second. Usually 44.1 kHz or 48 kHz. See §2.2.

**Sampler.** A component that plays back pre-recorded audio samples (drum hits, field recordings, etc.) at scheduled times.

**Scheduler.** The thing that decides what to play when. Bassmash's lives in `engine.js`.

**Stereo.** Two-channel audio, left + right.

**Synth.** A component that generates sound from scratch using oscillators, filters, and envelopes.

**Tauri.** Desktop-app framework with a Rust backend and a webview frontend. See §6.1.

**Transferable.** A JavaScript value that can be moved (not copied) between main thread and workers — usually `ArrayBuffer`. Zero-copy communication.

**Voice.** One playing note. A 64-voice synth can play up to 64 notes at once.

**Voice stealing.** When all voices are in use, forcibly ending the oldest to free one for the new note.

**WASM.** See §6.1.

**Waveform.** The visible shape of an audio signal. See §2.3.

**Web Audio API.** The browser's audio engine. See §3.1.

**Web Worker.** A JavaScript thread other than the main one. Can run arbitrary JS without blocking UI. Communicates via `postMessage`.

**Zipper noise.** The audible buzz produced by applying parameter changes in discrete steps. Fix with `setTargetAtTime`. See item 5.

---

*End of plan. Start with item 1.*
