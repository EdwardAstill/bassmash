// Shared vertical-drag knob helper. Used by the inspector knobs, the sampler
// pads, and the mixer bus FX knobs — all three were near-identical copies
// before this module existed.

export function knobAngle(value, min, max) {
  const range = max - min;
  const t = range === 0 ? 0 : Math.max(0, Math.min(1, (value - min) / range));
  return -135 + t * 270;
}

// Attach pointer-drag + dblclick-reset behavior to an element.
//
//   el:              DOM node to drag on
//   getValue:        () => current value (called at drag start)
//   setValue:        (v) => write value (v is already clamped to [min, max])
//   min, max, reset: value range + reset value for dblclick
//   render:          optional (v) => void for visual update separate from setValue
//   dragPx:          pixels of vertical travel for full-range sweep (default 200)
//   onDragStart:     optional callback at pointerdown
//   onDragEnd:       optional callback at pointerup AND on dblclick (so callers
//                    can treat dblclick as a "commit" point)
//   stopPropagation: if true, swallow bubbling pointerdown/click/dblclick
//                    (needed when the knob sits on a clickable parent).
export function attachKnobDrag(el, opts) {
  if (!el) return;
  const {
    getValue, setValue, min, max, reset, render,
    dragPx = 200, onDragStart, onDragEnd, stopPropagation = false,
  } = opts;
  let active = false, dragY = 0, dragStart = 0;

  function onMove(e) {
    if (!active) return;
    const dy = dragY - e.clientY;
    const range = max - min;
    const v = Math.max(min, Math.min(max, dragStart + (dy / dragPx) * range));
    setValue(v);
    if (render) render(v);
  }
  function onUp() {
    if (!active) return;
    active = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (onDragEnd) onDragEnd();
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (stopPropagation) e.stopPropagation();
    active = true;
    dragY = e.clientY;
    dragStart = getValue();
    if (onDragStart) onDragStart();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  if (stopPropagation) {
    el.addEventListener('click', (e) => e.stopPropagation());
  }
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (stopPropagation) e.stopPropagation();
    setValue(reset);
    if (render) render(reset);
    if (onDragEnd) onDragEnd();
  });
}
