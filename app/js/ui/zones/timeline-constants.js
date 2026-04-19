// Timeline coordinate constants — shared by arrangement.js, clip-interactions.js,
// and global-strip.js so clip rendering, the playhead, markers, and tempo tags
// all speak the same coordinate system.
//
// TOTAL_BEATS — width of the arrangement canvas in quarter-notes. The ruler,
// clips, and the markers row all span this range.
// TOTAL_STEPS — the same canvas in 16th-note steps (engine.currentBeat units).
// markers[].beat and tempoChanges[].beat are stored in 16th-note steps; render
// them against TOTAL_STEPS for visual consistency with clips.

export const TOTAL_BEATS = 64;
export const STEPS_PER_BEAT = 4;
export const TOTAL_STEPS = TOTAL_BEATS * STEPS_PER_BEAT;
