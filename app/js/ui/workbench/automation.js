// Workbench — Automation pane (P2 #5, extended)
// Per-track breakpoint editor. Multiple automation lanes per track —
// volume, pan, sends, FX wet — each stored as its own array on:
//   store.data.tracks[i].automation = {
//     volume:    [{beat, value}, ...]   // 0 .. 1.5   (linear gain)
//     pan:       [{beat, value}, ...]   // -1 .. 1
//     sendA:     [{beat, value}, ...]   // 0 .. 1.5
//     sendB:     [{beat, value}, ...]   // 0 .. 1.5
//     fxReverb:  [{beat, value}, ...]   // 0 .. 1
//     fxDelay:   [{beat, value}, ...]   // 0 .. 1
//     fxEqLow:   [{beat, value}, ...]   // -12 .. 12 dB
//     fxEqMid:   [{beat, value}, ...]   // -12 .. 12 dB
//     fxEqHigh:  [{beat, value}, ...]   // -12 .. 12 dB
//   }
// `beat` is in quarter notes. Points are kept sorted by beat; linear
// interpolation between points.
//
// Selection rule: if a clip is selected we follow its track + beat range;
// otherwise we use the selected track (store.selectedTrack) and the full
// arrangement length (or 1 bar fallback). Playback scheduling lives in
// `app/js/audio/scheduler.js` — it reads every known param key.
//
// UI:
//   · param selector strip     → choose which AudioParam this lane edits
//   · click empty lane         → add breakpoint at that (beat, value)
//   · drag breakpoint dot      → move (beat + value)
//   · right-click a dot        → delete
//   · axis labels + guide rail
//
// Persist: commit() calls store._scheduleSave(); scheduler + offline
// render read the data directly.
import { store } from '../../state.js';

// ── Param registry ─────────────────────────────────────────────────
// Single source of truth for UI labels, value ranges, and defaults.
// Scheduler / offline-render iterate the same keys via their own
// `getAutomationTarget` helper so new entries here light up audio too.
export const AUTOMATION_PARAMS = [
  { key: 'volume',   label: 'Volume',      short: 'Vol',     min: 0,   max: 1.5,  unity: 1.0,  default: 1.0,  unit: '' },
  { key: 'pan',      label: 'Pan',         short: 'Pan',     min: -1,  max: 1,    unity: 0.0,  default: 0.0,  unit: '' },
  { key: 'sendA',    label: 'Send A',      short: 'SndA',    min: 0,   max: 1.5,  unity: 1.0,  default: 0.0,  unit: '' },
  { key: 'sendB',    label: 'Send B',      short: 'SndB',    min: 0,   max: 1.5,  unity: 1.0,  default: 0.0,  unit: '' },
  { key: 'fxReverb', label: 'FX · Reverb', short: 'Rvb',     min: 0,   max: 1,    unity: 0.5,  default: 0.0,  unit: '' },
  { key: 'fxDelay',  label: 'FX · Delay',  short: 'Dly',     min: 0,   max: 1,    unity: 0.5,  default: 0.0,  unit: '' },
  { key: 'fxEqLow',  label: 'EQ · Low',    short: 'Low',     min: -12, max: 12,   unity: 0.0,  default: 0.0,  unit: 'dB' },
  { key: 'fxEqMid',  label: 'EQ · Mid',    short: 'Mid',     min: -12, max: 12,   unity: 0.0,  default: 0.0,  unit: 'dB' },
  { key: 'fxEqHigh', label: 'EQ · High',   short: 'High',    min: -12, max: 12,   unity: 0.0,  default: 0.0,  unit: 'dB' },
];

export function getParamSpec(key) {
  return AUTOMATION_PARAMS.find((p) => p.key === key) || AUTOMATION_PARAMS[0];
}

const LABEL_WIDTH = 56;   // left gutter for the y-axis labels
const TOP_PAD = 8;
const BOT_PAD = 8;

// In-memory: which param the user was last viewing per track.
// Not persisted — reset on page reload.
const _selectedParamByTrack = new Map();

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ensureAutomation(track) {
  if (!track.automation || typeof track.automation !== 'object') {
    track.automation = {};
  }
  // Don't auto-create every key — the scheduler treats missing arrays as
  // "no automation, leave the param alone". Only guarantee the one we're
  // about to edit (see ensureParamArray).
  return track.automation;
}

function ensureParamArray(track, paramKey) {
  ensureAutomation(track);
  if (!Array.isArray(track.automation[paramKey])) {
    track.automation[paramKey] = [];
  }
  return track.automation[paramKey];
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
  let currentParamKey = 'volume';

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
        <p>Select a track (or a clip) to edit its automation lanes.</p>
      `;
      rootEl.appendChild(empty);
      return;
    }

    const { trackIndex, track, range } = scope;
    ensureAutomation(track);

    // Resolve the selected param for this track — remember across renders
    // within the same session (not persisted).
    currentParamKey = _selectedParamByTrack.get(trackIndex) || 'volume';
    if (!AUTOMATION_PARAMS.some((p) => p.key === currentParamKey)) {
      currentParamKey = 'volume';
    }
    const paramSpec = getParamSpec(currentParamKey);
    ensureParamArray(track, currentParamKey);
    const points = track.automation[currentParamKey];

    const container = document.createElement('div');
    container.className = 'auto-root';

    // ── param selector strip (new) ──────────────────────────────────
    const selector = document.createElement('div');
    selector.className = 'auto-param-selector';
    for (const p of AUTOMATION_PARAMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'auto-param-btn' + (p.key === currentParamKey ? ' auto-param-btn--active' : '');
      btn.dataset.paramKey = p.key;
      btn.textContent = p.short;
      btn.title = `${p.label}${p.unit ? ` (${p.unit})` : ''}`;
      const count = Array.isArray(track.automation[p.key]) ? track.automation[p.key].length : 0;
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'auto-param-btn__badge';
        badge.textContent = String(count);
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => {
        _selectedParamByTrack.set(trackIndex, p.key);
        render();
      });
      selector.appendChild(btn);
    }
    container.appendChild(selector);

    // ── header ──────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'auto-header';
    const rangeLabel = `${paramSpec.min} \u2192 ${paramSpec.max}${paramSpec.unit ? ' ' + paramSpec.unit : ''}`;
    header.innerHTML = `
      <span class="auto-header__title">${track.name || `Track ${trackIndex + 1}`}</span>
      <span class="auto-header__meta">\u00b7 ${paramSpec.label} (${rangeLabel}) \u00b7 ${range.lengthBeats.toFixed(2)} beats
        \u00b7 ${points.length} point${points.length === 1 ? '' : 's'}</span>
      <button type="button" class="auto-clear" title="Remove all breakpoints for this param">Clear</button>
    `;
    header.querySelector('.auto-clear').addEventListener('click', () => {
      track.automation[currentParamKey] = [];
      commit();
      render();
    });
    container.appendChild(header);

    const laneWrap = document.createElement('div');
    laneWrap.className = 'auto-lane-wrap';

    // y-axis labels — driven by the current param's range.
    const yaxis = document.createElement('div');
    yaxis.className = 'auto-yaxis';
    const mid = (paramSpec.min + paramSpec.max) / 2;
    const fmt = (v) => {
      if (Math.abs(v) >= 10) return v.toFixed(0);
      if (Math.abs(v) >= 1)  return v.toFixed(1);
      return v.toFixed(2);
    };
    yaxis.innerHTML = `
      <span class="auto-yaxis__tick" style="top:${TOP_PAD}px">${fmt(paramSpec.max)}</span>
      <span class="auto-yaxis__tick" style="top:50%">${fmt(mid)}</span>
      <span class="auto-yaxis__tick" style="bottom:${BOT_PAD}px">${fmt(paramSpec.min)}</span>
    `;
    laneWrap.appendChild(yaxis);

    const lane = document.createElement('div');
    lane.className = 'auto-lane';
    lane.dataset.trackIndex = String(trackIndex);
    lane.dataset.paramKey = currentParamKey;

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
    hint.textContent = 'Click empty space to add \u00b7 drag to move \u00b7 right-click to delete';
    container.appendChild(hint);

    rootEl.appendChild(container);

    // Paint the curve + handles once the DOM is laid out.
    requestAnimationFrame(() => repaint(lane, svg, track, range, paramSpec));

    // ── click-to-add on the lane ──────────────────────────────────
    lane.addEventListener('click', (e) => {
      if (dragState) return;                    // swallow the post-drag click
      if (e.target.closest('.auto-handle')) return;
      const rect = lane.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const beat = xToBeat(x, rect.width, range);
      const value = yToValue(y, rect.height, paramSpec);
      const pts = track.automation[currentParamKey];
      pts.push({ beat, value });
      sortPoints(pts);
      commit();
      render();
    });
  }

  // Redraw the line + handles on the given svg / track data.
  function repaint(lane, svg, track, range, paramSpec) {
    const rect = lane.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;

    // Clear old contents.
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));

    const points = track.automation[paramSpec.key] || [];
    const pathD = buildPath(points, range, w, h, paramSpec);

    // Guide rail at the param's unity / neutral value.
    const unityY = valueToY(paramSpec.unity, h, paramSpec);
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
      const y = valueToY(p.value, h, paramSpec);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'auto-handle';
      dot.style.left = `${x}px`;
      dot.style.top  = `${y}px`;
      dot.dataset.index = String(i);
      dot.title = `beat ${p.beat.toFixed(2)} \u00b7 ${p.value.toFixed(2)}`;
      attachDragHandlers(dot, lane, svg, paramSpec);
      lane.appendChild(dot);
    }
  }

  function attachDragHandlers(dot, lane, svg, paramSpec) {
    dot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const idx = Number(dot.dataset.index);
      if (!Number.isFinite(idx) || !scope) return;
      const pts = scope.track.automation[paramSpec.key];
      if (!Array.isArray(pts)) return;
      pts.splice(idx, 1);
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
        const value = yToValue(y, rect.height, paramSpec);
        const points = scope.track.automation[paramSpec.key];
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
        dot.style.top  = `${valueToY(value, rect.height, paramSpec)}px`;
        dot.title = `beat ${beat.toFixed(2)} \u00b7 ${value.toFixed(2)}`;
        // Repaint the line live.
        repaintLineOnly(lane, svg, paramSpec);
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
  function repaintLineOnly(lane, svg, paramSpec) {
    if (!scope) return;
    const rect = lane.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));

    const unityY = valueToY(paramSpec.unity, h, paramSpec);
    const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    guide.setAttribute('x1', '0'); guide.setAttribute('x2', String(w));
    guide.setAttribute('y1', String(unityY)); guide.setAttribute('y2', String(unityY));
    guide.setAttribute('class', 'auto-svg__unity');
    svg.appendChild(guide);

    const points = scope.track.automation[paramSpec.key] || [];
    const pathD = buildPath(points, scope.range, w, h, paramSpec);
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
  function valueToY(value, h, paramSpec) {
    const span = paramSpec.max - paramSpec.min;
    const t = span === 0 ? 0 : (paramSpec.max - value) / span;
    return TOP_PAD + clamp(t, 0, 1) * (h - TOP_PAD - BOT_PAD);
  }
  function yToValue(y, h, paramSpec) {
    const span = paramSpec.max - paramSpec.min;
    const t = clamp((y - TOP_PAD) / (h - TOP_PAD - BOT_PAD), 0, 1);
    return paramSpec.max - t * span;
  }

  function buildPath(points, range, w, h, paramSpec) {
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
      const y = valueToY(p.value, h, paramSpec);
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
  store.on('loaded', () => {
    clipSelection = null;
    // Reset per-track param memory — new project, new context.
    _selectedParamByTrack.clear();
    render();
  });

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
