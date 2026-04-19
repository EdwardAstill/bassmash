// Workbench — Automation pane (P2 #5)
// Per-track breakpoint editor. One automation lane per track, volume
// parameter only for now. Breakpoints live on:
//   store.data.tracks[i].automation = { volume: [{beat, value}, ...] }
// where `value` ∈ [0, 1.5] (linear gain), `beat` in quarter notes.
// Points are kept sorted by beat; linear interpolation between points.
//
// Selection rule: if a clip is selected we follow its track + beat range;
// otherwise we use the selected track (store.selectedTrack) and the full
// arrangement length (or 1 bar fallback). Playback scheduling for these
// breakpoints lives in `app/js/audio/scheduler.js`.
//
// UI:
//   · click empty lane    → add breakpoint at that (beat, value)
//   · drag breakpoint dot → move (beat + value)
//   · right-click a dot   → delete
//   · axis labels + guide rail
//
// Persist: commit() calls store._scheduleSave(); scheduler + offline
// render read the data directly.
import { store } from '../../state.js';

const VALUE_MIN = 0;
const VALUE_MAX = 1.5;
const DEFAULT_VALUE = 1.0;
const LABEL_WIDTH = 56;   // left gutter for the y-axis labels
const TOP_PAD = 8;
const BOT_PAD = 8;
const HANDLE_RADIUS = 5;
const HIT_RADIUS = 10;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ensureAutomation(track) {
  if (!track.automation || typeof track.automation !== 'object') {
    track.automation = { volume: [] };
  }
  if (!Array.isArray(track.automation.volume)) {
    track.automation.volume = [];
  }
  return track.automation;
}

function sortPoints(points) {
  points.sort((a, b) => a.beat - b.beat);
}

// Given `store.data.arrangement`, compute the track-wide beat range when
// no clip is selected. Falls back to [0, 4] for an empty project.
function computeTrackRange(trackIndex) {
  const arrangement = store.data.arrangement || [];
  let maxEnd = 0;
  for (const clip of arrangement) {
    if (clip.trackIndex !== trackIndex) continue;
    const end = (clip.startBeat || 0) + (clip.lengthBeats || 0);
    if (end > maxEnd) maxEnd = end;
  }
  if (maxEnd <= 0) maxEnd = 4;
  return { startBeat: 0, lengthBeats: maxEnd };
}

// Resolve the current scope: which track + which beat window are we editing?
// Priority: explicit clip selection > selected track + arrangement span.
function resolveScope(clipSel) {
  let trackIndex = null;
  let range = null;

  if (clipSel && clipSel.trackIndex != null) {
    trackIndex = clipSel.trackIndex;
    if (clipSel.arrangementIdx != null) {
      const clip = store.data.arrangement?.[clipSel.arrangementIdx];
      if (clip) {
        range = {
          startBeat: clip.startBeat || 0,
          lengthBeats: clip.lengthBeats || 4,
        };
      }
    }
  }
  if (trackIndex == null && store.selectedTrack != null) {
    trackIndex = store.selectedTrack;
  }
  if (trackIndex == null) return null;

  const track = store.data.tracks?.[trackIndex];
  if (!track) return null;

  if (!range) range = computeTrackRange(trackIndex);
  return { trackIndex, track, range };
}

export function initAutomation({ rootEl }) {
  if (!rootEl) return;

  let clipSelection = null;
  let scope = null;         // { trackIndex, track, range }
  let dragState = null;     // { pointId, index, svgEl }

  function commit() {
    store.emit('change', { path: 'tracks' });
    if (typeof store._scheduleSave === 'function') store._scheduleSave();
  }

  // ── render ──────────────────────────────────────────────────────
  function render() {
    scope = resolveScope(clipSelection);
    rootEl.innerHTML = '';

    if (!scope) {
      const empty = document.createElement('div');
      empty.className = 'auto-empty';
      empty.innerHTML = `
        <h3>Automation</h3>
        <p>Select a track (or a clip) to edit its volume automation.</p>
      `;
      rootEl.appendChild(empty);
      return;
    }

    const { trackIndex, track, range } = scope;
    ensureAutomation(track);

    const container = document.createElement('div');
    container.className = 'auto-root';

    const header = document.createElement('div');
    header.className = 'auto-header';
    header.innerHTML = `
      <span class="auto-header__title">${track.name || `Track ${trackIndex + 1}`}</span>
      <span class="auto-header__meta">· Volume · ${range.lengthBeats.toFixed(2)} beats
        · ${track.automation.volume.length} point${track.automation.volume.length === 1 ? '' : 's'}</span>
      <button type="button" class="auto-clear" title="Remove all breakpoints">Clear</button>
    `;
    header.querySelector('.auto-clear').addEventListener('click', () => {
      track.automation.volume = [];
      commit();
      render();
    });
    container.appendChild(header);

    const laneWrap = document.createElement('div');
    laneWrap.className = 'auto-lane-wrap';

    // y-axis labels
    const yaxis = document.createElement('div');
    yaxis.className = 'auto-yaxis';
    yaxis.innerHTML = `
      <span class="auto-yaxis__tick" style="top:${TOP_PAD}px">${VALUE_MAX.toFixed(2)}</span>
      <span class="auto-yaxis__tick" style="top:50%">${((VALUE_MAX + VALUE_MIN) / 2).toFixed(2)}</span>
      <span class="auto-yaxis__tick" style="bottom:${BOT_PAD}px">${VALUE_MIN.toFixed(2)}</span>
    `;
    laneWrap.appendChild(yaxis);

    const lane = document.createElement('div');
    lane.className = 'auto-lane';
    lane.dataset.trackIndex = String(trackIndex);

    // Use an inline-sized SVG so clicks are easy to map (viewBox stays
    // in pixel units, sized by the parent div's getBoundingClientRect).
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'auto-lane__svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    lane.appendChild(svg);

    laneWrap.appendChild(lane);
    container.appendChild(laneWrap);

    // x-axis: beat ruler
    const xaxis = document.createElement('div');
    xaxis.className = 'auto-xaxis';
    // tick every whole beat up to 16, otherwise every N to keep under 16
    const tickCount = range.lengthBeats;
    const step = tickCount <= 16 ? 1 : Math.ceil(tickCount / 16);
    for (let b = 0; b <= tickCount; b += step) {
      const t = document.createElement('span');
      t.className = 'auto-xaxis__tick' + (b % 4 === 0 ? ' auto-xaxis__tick--strong' : '');
      t.style.left = `calc(${(b / tickCount) * 100}% + 0px)`;
      t.textContent = String(Math.round(range.startBeat + b));
      xaxis.appendChild(t);
    }
    container.appendChild(xaxis);

    const hint = document.createElement('div');
    hint.className = 'auto-hint';
    hint.textContent = 'Click empty space to add · drag to move · right-click to delete';
    container.appendChild(hint);

    rootEl.appendChild(container);

    // Paint the curve + handles once the DOM is laid out.
    requestAnimationFrame(() => repaint(lane, svg, track, range));

    // ── click-to-add on the lane ──────────────────────────────────
    lane.addEventListener('click', (e) => {
      if (dragState) return;                    // swallow the post-drag click
      if (e.target.closest('.auto-handle')) return;
      const rect = lane.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const beat = xToBeat(x, rect.width, range);
      const value = yToValue(y, rect.height);
      const points = track.automation.volume;
      points.push({ beat, value });
      sortPoints(points);
      commit();
      render();
    });
  }

  // Redraw the line + handles on the given svg / track data.
  function repaint(lane, svg, track, range) {
    const rect = lane.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;

    // Clear old contents.
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));

    const points = track.automation.volume;
    const pathD = buildPath(points, range, w, h);

    // Guide rail at value=1.0 (unity gain).
    const unityY = valueToY(1.0, h);
    const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    guide.setAttribute('x1', '0'); guide.setAttribute('x2', String(w));
    guide.setAttribute('y1', String(unityY)); guide.setAttribute('y2', String(unityY));
    guide.setAttribute('class', 'auto-svg__unity');
    svg.appendChild(guide);

    // Filled polygon under the curve for nicer chart feel.
    if (pathD) {
      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fill.setAttribute('d', `${pathD} L ${w},${h} L 0,${h} Z`);
      fill.setAttribute('class', 'auto-svg__fill');
      svg.appendChild(fill);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', pathD);
      line.setAttribute('class', 'auto-svg__line');
      svg.appendChild(line);
    }

    // Remove any DOM handles so we can rebuild them fresh. We use real
    // DOM buttons (overlaid on the SVG) rather than SVG circles so we
    // get pointer events + CSS hover treatment for free.
    lane.querySelectorAll('.auto-handle').forEach((el) => el.remove());

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = beatToX(p.beat, w, range);
      const y = valueToY(p.value, h);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'auto-handle';
      dot.style.left = `${x}px`;
      dot.style.top  = `${y}px`;
      dot.dataset.index = String(i);
      dot.title = `beat ${p.beat.toFixed(2)} · ${p.value.toFixed(2)}`;
      attachDragHandlers(dot, lane, svg);
      lane.appendChild(dot);
    }
  }

  function attachDragHandlers(dot, lane, svg) {
    dot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const idx = Number(dot.dataset.index);
      if (!Number.isFinite(idx) || !scope) return;
      scope.track.automation.volume.splice(idx, 1);
      commit();
      render();
    });

    dot.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const idx = Number(dot.dataset.index);
      if (!Number.isFinite(idx) || !scope) return;

      dragState = { pointerId: e.pointerId, index: idx };
      try { dot.setPointerCapture(e.pointerId); } catch (_) {}
      dot.classList.add('auto-handle--dragging');

      const onMove = (ev) => {
        if (!dragState) return;
        const rect = lane.getBoundingClientRect();
        const x = clamp(ev.clientX - rect.left, 0, rect.width);
        const y = clamp(ev.clientY - rect.top, 0, rect.height);
        const beat = xToBeat(x, rect.width, scope.range);
        const value = yToValue(y, rect.height);
        const points = scope.track.automation.volume;
        const p = points[dragState.index];
        if (!p) return;
        p.beat = beat;
        p.value = value;
        // Re-sort; but remember the current moving object so we can find
        // its new index after sorting.
        sortPoints(points);
        dragState.index = points.indexOf(p);
        dot.dataset.index = String(dragState.index);
        dot.style.left = `${beatToX(beat, rect.width, scope.range)}px`;
        dot.style.top  = `${valueToY(value, rect.height)}px`;
        dot.title = `beat ${beat.toFixed(2)} · ${value.toFixed(2)}`;
        // Repaint the line live.
        repaintLineOnly(lane, svg);
      };

      const onUp = () => {
        if (!dragState) return;
        try { dot.releasePointerCapture(dragState.pointerId); } catch (_) {}
        dot.classList.remove('auto-handle--dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        commit();
        // Delay the drag-clear until after the synthesized click fires
        // so the lane's click handler doesn't add a stray breakpoint.
        const stale = dragState;
        setTimeout(() => {
          if (dragState === stale) dragState = null;
        }, 0);
        render();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // Lightweight in-flight repaint — just redraw the path while dragging.
  function repaintLineOnly(lane, svg) {
    if (!scope) return;
    const rect = lane.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));

    const unityY = valueToY(1.0, h);
    const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    guide.setAttribute('x1', '0'); guide.setAttribute('x2', String(w));
    guide.setAttribute('y1', String(unityY)); guide.setAttribute('y2', String(unityY));
    guide.setAttribute('class', 'auto-svg__unity');
    svg.appendChild(guide);

    const points = scope.track.automation.volume;
    const pathD = buildPath(points, scope.range, w, h);
    if (pathD) {
      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fill.setAttribute('d', `${pathD} L ${w},${h} L 0,${h} Z`);
      fill.setAttribute('class', 'auto-svg__fill');
      svg.appendChild(fill);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', pathD);
      line.setAttribute('class', 'auto-svg__line');
      svg.appendChild(line);
    }
  }

  // ── coordinate helpers ──────────────────────────────────────────
  function beatToX(beat, w, range) {
    const t = (beat - range.startBeat) / range.lengthBeats;
    return clamp(t, 0, 1) * w;
  }
  function xToBeat(x, w, range) {
    const t = clamp(x / w, 0, 1);
    return range.startBeat + t * range.lengthBeats;
  }
  function valueToY(value, h) {
    const t = (VALUE_MAX - value) / (VALUE_MAX - VALUE_MIN);
    return TOP_PAD + clamp(t, 0, 1) * (h - TOP_PAD - BOT_PAD);
  }
  function yToValue(y, h) {
    const t = clamp((y - TOP_PAD) / (h - TOP_PAD - BOT_PAD), 0, 1);
    return VALUE_MAX - t * (VALUE_MAX - VALUE_MIN);
  }

  function buildPath(points, range, w, h) {
    if (!points || points.length === 0) return '';
    // Extend the curve to 0 and to range end using the first/last point
    // so the drawn line spans the full lane (scheduler does the same).
    const sorted = [...points].sort((a, b) => a.beat - b.beat);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const virt = [
      { beat: range.startBeat, value: first.value },
      ...sorted,
      { beat: range.startBeat + range.lengthBeats, value: last.value },
    ];
    let d = '';
    for (let i = 0; i < virt.length; i++) {
      const p = virt[i];
      const x = beatToX(p.beat, w, range);
      const y = valueToY(p.value, h);
      d += (i === 0 ? 'M ' : ' L ') + x.toFixed(2) + ',' + y.toFixed(2);
    }
    return d;
  }

  // ── event wiring ────────────────────────────────────────────────
  store.on('clipSelected', (payload) => {
    clipSelection = payload;
    render();
  });
  store.on('trackSelected', () => { render(); });
  store.on('change', (evt) => {
    if (!evt) return;
    if (evt.path === 'tracks' || evt.path === 'arrangement') render();
  });
  store.on('loaded', () => { clipSelection = null; render(); });

  // Repaint when the pane becomes visible (viewBox needs size).
  const zoneRoot = document.querySelector('.zone--workbench');
  if (zoneRoot) {
    const obs = new MutationObserver(() => {
      if (zoneRoot.getAttribute('data-active-tab') === 'Automation') render();
    });
    obs.observe(zoneRoot, { attributes: true, attributeFilter: ['data-active-tab'] });
  }

  render();
}
