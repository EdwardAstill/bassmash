// Clamp automation values to the AudioParam's safe range.
// Shared between the live scheduler and the offline MP3 bounce so they can
// never diverge — any new paramKey must be added here once.

const EQ_KEYS = new Set(['fxEqLow', 'fxEqMid', 'fxEqHigh']);

export function clampAutomationValue(paramKey, v) {
  if (paramKey === 'pan') return Math.max(-1, Math.min(1, v));
  if (EQ_KEYS.has(paramKey)) return Math.max(-24, Math.min(24, v));
  return Math.max(0, v);
}
