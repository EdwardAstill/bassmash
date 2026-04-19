// Zone 6 · Clip interactions — phase 2b
// Event-delegated pointer interactions for .clip elements inside
// .zone--arrangement: click = select, drag-middle = move, drag-edge = resize,
// Delete/Backspace = remove. Respects store.currentTool ('select' | 'split' |
// 'erase' | 'mute' | …). Renders nothing — arrangement.js owns clip DOM.

// Timeline horizon in beats. MUST match arrangement.js (copied, not imported,
// to avoid cross-agent coupling).
const TOTAL_BEATS = 64;

// Edge hit-zone width (px) for resize handle detection.
const EDGE_PX = 8;

// ──────────────────────────────────────────────────────────────────
// Scoped CSS (one-shot)
// ──────────────────────────────────────────────────────────────────
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .clip--selected { box-shadow: inset 0 0 0 2px var(--accent, #60a5fa); }
    .clip--muted    { opacity: 0.35; }
    .clip           { cursor: grab; }
    .clip.clip--dragging { cursor: grabbing; user-select: none; }
    .clip[data-edge] { cursor: ew-resize; }
  `;
  document.head.appendChild(style);
}

export function initClipInteractions({ store } = {}) {
  if (!store) return;
  injectStyles();

  const timeline = document.querySelector('.zone--arrangement .arrangement__timeline');
  if (!timeline) return;

  // ── Selection bookkeeping ──────────────────────────────────────
  // We key the "which arrangement entry is this DOM clip?" lookup
  // on (trackIndex, startBeat). startBeat is read from the clip's
  // inline `left: N%` style, which arrangement.js sets. This avoids
  // DOM data-attributes and survives re-renders.
  let selectedEl = null;
  let selectedArrIdx = null;

  function laneIndexOf(clipEl) {
    const lane = clipEl.parentElement;
    if (!lane || !lane.classList.contains('lane')) return -1;
    const lanes = Array.from(timeline.querySelectorAll('.lane'));
    return lanes.indexOf(lane);
  }

  function startBeatOfClipEl(clipEl) {
    // Inline `left` is `N%`. Convert back to beat integer.
    const leftPct = parseFloat(clipEl.style.left) || 0;
    return Math.round(leftPct / 100 * TOTAL_BEATS);
  }

  function lengthBeatsOfClipEl(clipEl) {
    const widthPct = parseFloat(clipEl.style.width) || 0;
    return Math.max(1, Math.round(widthPct / 100 * TOTAL_BEATS));
  }

  function findArrIndex(clipEl) {
    const trackIndex = laneIndexOf(clipEl);
    if (trackIndex < 0) return -1;
    const startBeat = startBeatOfClipEl(clipEl);
    const arr = store.data.arrangement || [];
    // Prefer exact match on (trackIndex, startBeat); fall back to
    // nearest startBeat within the same lane in case of rounding.
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c.trackIndex !== trackIndex) continue;
      const d = Math.abs(c.startBeat - startBeat);
      if (d < bestDelta) { bestDelta = d; bestIdx = i; }
    }
    return bestIdx;
  }

  function clearSelection() {
    if (selectedEl) selectedEl.classList.remove('clip--selected');
    selectedEl = null;
    selectedArrIdx = null;
    store.emit('clipSelected', null);
  }

  function selectClip(clipEl) {
    if (selectedEl && selectedEl !== clipEl) {
      selectedEl.classList.remove('clip--selected');
    }
    // Also clear any stale selection siblings (post re-render).
    timeline.querySelectorAll('.clip--selected').forEach((el) => {
      if (el !== clipEl) el.classList.remove('clip--selected');
    });
    clipEl.classList.add('clip--selected');
    selectedEl = clipEl;
    const arrIdx = findArrIndex(clipEl);
    selectedArrIdx = arrIdx >= 0 ? arrIdx : null;
    const trackIndex = laneIndexOf(clipEl);
    // Also focus the owning track so the inspector reflects it.
    // Mirror mixer-strip pattern: set store field AND emit event.
    if (trackIndex >= 0 && store.selectedTrack !== trackIndex) {
      store.selectedTrack = trackIndex;
      store.emit('trackSelected', trackIndex);
    }
    store.emit('clipSelected', { trackIndex, arrangementIdx: selectedArrIdx });
  }

  // ── Tool helpers ──────────────────────────────────────────────
  function currentTool() {
    return store.currentTool || 'select';
  }

  function commitChange() {
    store.emit('change', { path: 'arrangement' });
    if (typeof store._scheduleSave === 'function') store._scheduleSave();
  }

  function splitClip(clipEl, clientX) {
    const arrIdx = findArrIndex(clipEl);
    if (arrIdx < 0) return;
    const clip = store.data.arrangement[arrIdx];
    const rect = clipEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const splitOffset = Math.round(frac * clip.lengthBeats);
    if (splitOffset <= 0 || splitOffset >= clip.lengthBeats) return;
    const right = {
      ...clip,
      startBeat: clip.startBeat + splitOffset,
      lengthBeats: clip.lengthBeats - splitOffset,
    };
    clip.lengthBeats = splitOffset;
    store.data.arrangement.push(right);
    commitChange();
  }

  function eraseClip(clipEl) {
    const arrIdx = findArrIndex(clipEl);
    if (arrIdx < 0) return;
    store.data.arrangement.splice(arrIdx, 1);
    if (selectedEl === clipEl) {
      selectedEl = null;
      selectedArrIdx = null;
    }
    commitChange();
  }

  function toggleMute(clipEl) {
    const arrIdx = findArrIndex(clipEl);
    if (arrIdx < 0) return;
    const clip = store.data.arrangement[arrIdx];
    clip.muted = !clip.muted;
    // Reflect immediately (arrangement.js won't re-render on mute alone).
    clipEl.classList.toggle('clip--muted', !!clip.muted);
    // Persist without forcing a full re-render that would wipe class.
    if (typeof store._scheduleSave === 'function') store._scheduleSave();
  }

  // ── Pointer interaction state machine ─────────────────────────
  let drag = null;
  // drag = { mode: 'move'|'resize-l'|'resize-r', clipEl, arrIdx,
  //          startX, origStart, origLength, timelineWidth, pointerId }

  function beginDrag(clipEl, mode, e) {
    const arrIdx = findArrIndex(clipEl);
    if (arrIdx < 0) return;
    const clip = store.data.arrangement[arrIdx];
    const lane = clipEl.parentElement;
    const laneRect = lane.getBoundingClientRect();
    drag = {
      mode,
      clipEl,
      arrIdx,
      startX: e.clientX,
      origStart: clip.startBeat,
      origLength: clip.lengthBeats,
      newStart: clip.startBeat,
      newLength: clip.lengthBeats,
      timelineWidth: laneRect.width,
      pointerId: e.pointerId,
      moved: false,
    };
    clipEl.classList.add('clip--dragging');
    try { clipEl.setPointerCapture(e.pointerId); } catch { /* some elements refuse */ }
  }

  function updateDrag(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const beatsDelta = Math.round(dx / drag.timelineWidth * TOTAL_BEATS);
    if (beatsDelta !== 0) drag.moved = true;

    let newStart = drag.origStart;
    let newLength = drag.origLength;

    if (drag.mode === 'move') {
      newStart = drag.origStart + beatsDelta;
      newStart = Math.max(0, Math.min(TOTAL_BEATS - newLength, newStart));
    } else if (drag.mode === 'resize-l') {
      // Anchor the right edge. Left edge moves with pointer.
      const origRight = drag.origStart + drag.origLength;
      newStart = drag.origStart + beatsDelta;
      newStart = Math.max(0, Math.min(origRight - 1, newStart));
      newLength = origRight - newStart;
    } else if (drag.mode === 'resize-r') {
      newLength = drag.origLength + beatsDelta;
      newLength = Math.max(1, Math.min(TOTAL_BEATS - drag.origStart, newLength));
    }

    drag.newStart = newStart;
    drag.newLength = newLength;

    drag.clipEl.style.left  = (newStart  / TOTAL_BEATS * 100) + '%';
    drag.clipEl.style.width = (newLength / TOTAL_BEATS * 100) + '%';
  }

  function endDrag(/* e */) {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.clipEl.classList.remove('clip--dragging');
    try { d.clipEl.releasePointerCapture(d.pointerId); } catch { /* ignore */ }

    if (!d.moved) return; // pure click; selection handled elsewhere

    const clip = store.data.arrangement[d.arrIdx];
    if (!clip) return;
    clip.startBeat = d.newStart;
    clip.lengthBeats = d.newLength;
    commitChange();
  }

  // ── Hit-test edge vs. middle ──────────────────────────────────
  function edgeHit(clipEl, e) {
    const rect = clipEl.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (localX < EDGE_PX) return 'l';
    if (localX > rect.width - EDGE_PX) return 'r';
    return null;
  }

  // ── Delegated pointerdown ─────────────────────────────────────
  timeline.addEventListener('pointerdown', (e) => {
    // Left button only.
    if (e.button !== 0) return;

    const clipEl = e.target.closest('.clip');
    if (!clipEl || !timeline.contains(clipEl)) {
      // Empty-click on timeline background clears selection.
      if (selectedEl) clearSelection();
      return;
    }

    const tool = currentTool();

    if (tool === 'split') {
      e.preventDefault();
      splitClip(clipEl, e.clientX);
      return;
    }
    if (tool === 'erase') {
      e.preventDefault();
      eraseClip(clipEl);
      return;
    }
    if (tool === 'mute') {
      e.preventDefault();
      toggleMute(clipEl);
      return;
    }

    // Default: select tool (or anything unknown).
    e.preventDefault();
    selectClip(clipEl);

    const edge = edgeHit(clipEl, e);
    if (edge === 'l')      beginDrag(clipEl, 'resize-l', e);
    else if (edge === 'r') beginDrag(clipEl, 'resize-r', e);
    else                   beginDrag(clipEl, 'move',     e);
  });

  // Pointermove / pointerup / cancel on window so we follow the
  // pointer even if it leaves the clip element mid-drag.
  window.addEventListener('pointermove', (e) => {
    if (drag) updateDrag(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (drag) endDrag(e);
  });
  window.addEventListener('pointercancel', (e) => {
    if (drag) endDrag(e);
  });

  // ── Cursor hinting on hover (no drag active) ──────────────────
  timeline.addEventListener('pointermove', (e) => {
    if (drag) return;
    const clipEl = e.target.closest?.('.clip');
    if (!clipEl) return;
    const tool = currentTool();
    if (tool !== 'select') {
      clipEl.removeAttribute('data-edge');
      clipEl.style.cursor = '';
      return;
    }
    const edge = edgeHit(clipEl, e);
    if (edge) clipEl.setAttribute('data-edge', edge);
    else      clipEl.removeAttribute('data-edge');
  });

  // ── Re-apply muted class and clear stale selection on re-render
  store.on('change', ({ path } = {}) => {
    if (path !== 'arrangement' && path !== 'tracks' && path !== 'patterns') return;
    // arrangement.js wipes and re-renders clips; our selection DOM is gone.
    selectedEl = null;
    // selectedArrIdx may still be valid (indices stable unless we spliced).
    // Re-apply .clip--muted from data where applicable.
    const arr = store.data.arrangement || [];
    const lanes = Array.from(timeline.querySelectorAll('.lane'));
    // For each lane, map its .clip children to arrangement entries in DOM
    // order. arrangement.js renders in arrangement-array order, so clips
    // of the same lane appear in the same order they do in the array.
    const perLane = new Map();
    arr.forEach((c) => {
      if (!perLane.has(c.trackIndex)) perLane.set(c.trackIndex, []);
      perLane.get(c.trackIndex).push(c);
    });
    lanes.forEach((lane, laneIdx) => {
      const clipEls = Array.from(lane.querySelectorAll('.clip'));
      const clips = perLane.get(laneIdx) || [];
      clipEls.forEach((el, i) => {
        const c = clips[i];
        if (c?.muted) el.classList.add('clip--muted');
      });
    });
  });

  // ── Delete / Backspace removes selected clip ──────────────────
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const ae = document.activeElement;
    if (ae) {
      const tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ae.isContentEditable) return;
    }
    if (selectedArrIdx == null) return;
    const idx = selectedArrIdx;
    if (idx < 0 || idx >= store.data.arrangement.length) {
      clearSelection();
      return;
    }
    e.preventDefault();
    store.data.arrangement.splice(idx, 1);
    selectedEl = null;
    selectedArrIdx = null;
    store.emit('clipSelected', null);
    commitChange();
  });
}
