// Shared tempo helpers. Wiring tempo-change playback (P3 #11) touches three
// places — live engine/scheduler, offline render, and the global-strip UI —
// so the lookup lives here and everyone imports the same implementation.
//
// Data shape:
//   store.data.bpm          → fallback / default tempo (number)
//   store.data.tempoChanges → sorted-by-beat list of { beat: int, bpm: number }
//                             `beat` is in 16th-note steps to match the
//                             rest of the code base (engine fires per 16th,
//                             arrangement stores `startBeat` in quarters —
//                             global-strip records tempo changes in 16ths).
//
// `bpmAtBeat(data, beat)` returns the active bpm at the given 16th-note
// step. If no changes precede the beat, it falls back to `data.bpm || 140`.
// Negative beats in the tempoChanges list are ignored.

const DEFAULT_BPM = 140;

export function bpmAtBeat(data, beat) {
  const fallback = (data && data.bpm) || DEFAULT_BPM;
  const tc = data && data.tempoChanges;
  if (!Array.isArray(tc) || tc.length === 0) return fallback;

  // Tempo changes are kept sorted on insert (see global-strip.js), but a
  // linear scan tolerant of unsorted data is still cheap and robust.
  let cur = null;
  for (const entry of tc) {
    if (!entry || typeof entry.beat !== 'number' || entry.beat < 0) continue;
    if (!Number.isFinite(entry.bpm) || entry.bpm <= 0) continue;
    if (entry.beat <= beat && (cur == null || entry.beat > cur.beat)) cur = entry;
  }
  return cur ? cur.bpm : fallback;
}

export function secondsPerBeatAt(data, beat) {
  return 60 / bpmAtBeat(data, beat);
}

// secondsPerStep = quarter-note seconds / 4. `beat` argument is the current
// 16th-note index (same as store.currentBeat / the `beat` param the engine
// emits on 'beat' events).
export function secondsPerStepAt(data, beat) {
  return secondsPerBeatAt(data, beat) / 4;
}
