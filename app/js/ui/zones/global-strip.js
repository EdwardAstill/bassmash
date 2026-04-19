// Zone 5 — Global strip: ruler seek, markers (click-jump / drag-move / rename),
// tempo row (click empty space to add tempo change).
//
// P3 item #11 extensions:
//   · drag existing marker horizontally → moves its beat position
//   · shift+drag (or double-click) marker → inline rename prompt
//   · click empty space in tempo row → add a tempo change at that beat
//   · scheduler wiring — live engine + offline render honor tempoChanges via
//     the shared `bpmAtBeat` helper in `../audio/tempo.js`.

import { bpmAtBeat as sharedBpmAtBeat } from '../../audio/tempo.js';
import { prompt as modalPrompt } from '../modal.js';

export function initGlobalStrip({ store, engine }) {
  const root = document.querySelector('.zone--global-strip');
  if (!root) return;

  const ruler   = root.querySelector('.global-strip__row--ruler');
  const markers = root.querySelector('.global-strip__row--markers');
  const tempo   = root.querySelector('.global-strip__row--tempo');
  if (!ruler) return;

  injectStyle();

  // ── Inline context menu (shared between markers + tempo tags).
  // Right-click on an existing element → show actions at cursor; empty-space
  // right-click still falls through to the add flow (element handlers
  // stopPropagation so the row-level add handler only fires on background).
  let openCtxMenu = null;
  function closeCtxMenu() {
    if (openCtxMenu) { openCtxMenu.remove(); openCtxMenu = null; }
    document.removeEventListener('pointerdown', onCtxOutsideDown, true);
    document.removeEventListener('keydown', onCtxKey, true);
  }
  function onCtxOutsideDown(e) {
    if (openCtxMenu && !openCtxMenu.contains(e.target)) closeCtxMenu();
  }
  function onCtxKey(e) {
    if (e.key === 'Escape') closeCtxMenu();
  }
  function openContextMenu(ev, items) {
    closeCtxMenu();
    const ul = document.createElement('ul');
    ul.className = 'global-strip-ctx-menu';
    ul.style.left = ev.clientX + 'px';
    ul.style.top  = ev.clientY + 'px';

    items.forEach((it) => {
      const li = document.createElement('li');
      li.textContent = it.label;
      if (it.variant) li.setAttribute('data-variant', it.variant);
      li.addEventListener('click', () => {
        try { it.onClick(); } finally { closeCtxMenu(); }
      });
      ul.appendChild(li);
    });

    document.body.appendChild(ul);
    openCtxMenu = ul;

    // Clamp to viewport.
    const r = ul.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.right > vw)  ul.style.left = Math.max(0, vw - r.width - 4) + 'px';
    if (r.bottom > vh) ul.style.top  = Math.max(0, vh - r.height - 4) + 'px';

    // Defer listener attach so the current right-click pointerdown doesn't
    // immediately close us.
    setTimeout(() => {
      document.addEventListener('pointerdown', onCtxOutsideDown, true);
      document.addEventListener('keydown', onCtxKey, true);
    }, 0);
  }

  function afterMutation(path) {
    store.emit('change', { path, value: store.data[path] });
    if (typeof store._scheduleSave === 'function') store._scheduleSave();
  }

  async function renameMarkerFlow(storeIdx) {
    if (storeIdx == null) return;
    const m = store.data.markers[storeIdx];
    if (!m) return;
    const next = await modalPrompt({
      title: 'Rename marker',
      message: 'Marker name:',
      defaultValue: String(m.name ?? ''),
      confirmLabel: 'Rename',
      validate: (v) => ((v || '').trim() ? '' : 'Name is required.'),
    });
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    store.data.markers[storeIdx].name = trimmed;
    afterMutation('markers');
    renderStoredMarkers();
  }

  async function changeTempoBpmFlow(storeIdx) {
    if (storeIdx == null) return;
    const t = store.data.tempoChanges[storeIdx];
    if (!t) return;
    const entered = await modalPrompt({
      title: 'Change tempo',
      message: 'Tempo (BPM):',
      defaultValue: String(t.bpm),
      confirmLabel: 'Apply',
      validate: (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0 ? '' : 'Enter a positive number.';
      },
    });
    if (entered == null) return;
    const bpm = parseFloat(entered);
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    store.data.tempoChanges[storeIdx].bpm = bpm;
    afterMutation('tempoChanges');
    renderTempoChanges();
  }

  function deleteMarkerFlow(storeIdx) {
    if (storeIdx == null) return;
    if (storeIdx < 0 || storeIdx >= (store.data.markers?.length ?? 0)) return;
    store.data.markers.splice(storeIdx, 1);
    afterMutation('markers');
    renderStoredMarkers();
  }

  function deleteTempoFlow(storeIdx) {
    if (storeIdx == null) return;
    if (storeIdx < 0 || storeIdx >= (store.data.tempoChanges?.length ?? 0)) return;
    store.data.tempoChanges.splice(storeIdx, 1);
    afterMutation('tempoChanges');
    renderTempoChanges();
  }

  // Seek marker (thin vertical line on ruler)
  const seekLine = document.createElement('div');
  seekLine.className = 'global-strip__seek';
  ruler.appendChild(seekLine);

  const getLoopLen = () => {
    try { return engine?._getLoopLength?.() || 16; }
    catch (_) { return 16; }
  };

  function fractionToStep(frac) {
    const clamped = Math.max(0, Math.min(1, frac));
    return Math.round(clamped * getLoopLen());
  }

  function updateSeekMarker() {
    const loopLen = getLoopLen() || 1;
    const pct = Math.max(0, Math.min(100, (store.currentBeat / loopLen) * 100));
    seekLine.style.left = pct + '%';
  }

  // Ruler click = seek
  ruler.addEventListener('click', (e) => {
    const rect = ruler.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const step = fractionToStep(frac);
    store.currentBeat = step;
    store.emit('seek', step);
    updateSeekMarker();
  });

  // ────────────────────────────────────────────────────────────────
  // Markers row
  // ────────────────────────────────────────────────────────────────
  if (markers) {
    if (!Array.isArray(store.data.markers)) store.data.markers = [];

    // Hardcoded markers in index.html don't have a data binding; treat the
    // stored markers array as the source of truth going forward. Wire every
    // `.marker` element we find to the unified interaction handler. Elements
    // created from store.data.markers carry a dataset index; legacy
    // hardcoded elements do not, and those can only click-jump (no drag /
    // rename) since there's nothing to persist back into.
    markers.querySelectorAll('.marker').forEach((el) => wireMarker(el, null));

    // Render stored custom markers (on top of hardcoded ones)
    renderStoredMarkers();

    // Right-click empty space = add marker
    markers.addEventListener('contextmenu', async (e) => {
      if (e.target.classList?.contains('marker')) return;
      e.preventDefault();
      const rect = markers.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      const step = fractionToStep(frac);
      const name = await modalPrompt({
        title: 'Add marker',
        message: 'Marker name:',
        placeholder: 'Verse',
        confirmLabel: 'Add',
        validate: (v) => ((v || '').trim() ? '' : 'Name is required.'),
      });
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      store.data.markers.push({ name: trimmed, beat: step });
      store.emit('change', { path: 'markers', value: store.data.markers });
      renderStoredMarkers();
    });
  }

  function renderStoredMarkers() {
    if (!markers) return;
    // Remove only the markers we previously rendered (ones with data-store-idx)
    markers.querySelectorAll('.marker[data-store-idx]').forEach((el) => el.remove());
    const loopLen = getLoopLen() || 1;
    store.data.markers.forEach((m, idx) => {
      const pct = Math.max(0, Math.min(100, (m.beat / loopLen) * 100));
      const el = document.createElement('div');
      el.className = 'marker';
      el.textContent = m.name;
      el.style.left = pct + '%';
      el.dataset.storeIdx = String(idx);
      markers.appendChild(el);
      wireMarker(el, idx);
    });
  }

  function wireMarker(el, storeIdx) {
    el.style.cursor = 'grab';

    // Right-click existing marker → context menu (Rename / Delete).
    // Stop propagation so the row-level "add" handler doesn't fire.
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (storeIdx == null) return; // legacy markers can't persist
      openContextMenu(e, [
        { label: 'Rename', onClick: () => renameMarkerFlow(storeIdx) },
        { label: 'Delete', variant: 'destructive', onClick: () => deleteMarkerFlow(storeIdx) },
      ]);
    });

    // Double-click = rename (also the alternative to shift+drag).
    el.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      if (storeIdx == null) return; // can't persist legacy markers
      const current = store.data.markers[storeIdx]?.name ?? el.textContent;
      const name = await modalPrompt({
        title: 'Rename marker',
        message: 'Marker name:',
        defaultValue: String(current ?? ''),
        confirmLabel: 'Rename',
        validate: (v) => ((v || '').trim() ? '' : 'Name is required.'),
      });
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      store.data.markers[storeIdx].name = trimmed;
      el.textContent = trimmed;
      store.emit('change', { path: 'markers', value: store.data.markers });
    });

    // Pointer-drag pattern — threshold-gated. Below threshold → click (jump).
    // Above threshold → drag (move, or shift-modifier → rename on release).
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (!markers) return;

      const rect = markers.getBoundingClientRect();
      const startX = e.clientX;
      const shiftHeld = e.shiftKey;
      let dragging = false;
      let moved = false;

      const onMove = (ev) => {
        if (!dragging && Math.abs(ev.clientX - startX) > 3) {
          dragging = true;
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          el.style.cursor = 'grabbing';
        }
        if (!dragging) return;
        moved = true;
        const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        el.style.left = (frac * 100) + '%';
      };

      const onUp = async (ev) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        el.style.cursor = 'grab';

        if (!moved) {
          // Pure click → jump to marker.
          const leftStr = (el.style.left || '0%').trim();
          const pct = parseFloat(leftStr);
          if (!Number.isFinite(pct)) return;
          const step = fractionToStep(pct / 100);
          store.currentBeat = step;
          store.emit('seek', step);
          updateSeekMarker();
          return;
        }

        // Drag completed.
        if (storeIdx == null) return; // legacy markers can't persist
        const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const step = fractionToStep(frac);
        store.data.markers[storeIdx].beat = step;

        if (shiftHeld) {
          // Shift+drag → also prompt rename on release.
          const current = store.data.markers[storeIdx].name ?? el.textContent;
          const name = await modalPrompt({
            title: 'Rename marker',
            message: 'Marker name:',
            defaultValue: String(current ?? ''),
            confirmLabel: 'Rename',
            validate: (v) => ((v || '').trim() ? '' : 'Name is required.'),
          });
          if (name != null && name.trim()) {
            store.data.markers[storeIdx].name = name.trim();
            el.textContent = name.trim();
          }
        }

        store.emit('change', { path: 'markers', value: store.data.markers });
        // Snap rendered position to the quantized step.
        const loopLen = getLoopLen() || 1;
        el.style.left = Math.max(0, Math.min(100, (step / loopLen) * 100)) + '%';
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Tempo row
  // ────────────────────────────────────────────────────────────────
  if (tempo) {
    if (!Array.isArray(store.data.tempoChanges)) store.data.tempoChanges = [];

    renderTempoChanges();

    // Click empty space → add tempo change at that beat.
    tempo.addEventListener('click', async (e) => {
      if (e.target.classList?.contains('tempo-tag')) return;
      const rect = tempo.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      const step = fractionToStep(frac);
      const defaultBpm = sharedBpmAtBeat(store.data, step) || store.data.bpm || 140;
      const entered = await modalPrompt({
        title: 'Add tempo change',
        message: 'Tempo (BPM) at this beat:',
        defaultValue: String(defaultBpm),
        placeholder: '140',
        confirmLabel: 'Add',
        validate: (v) => {
          const n = parseFloat(v);
          if (!Number.isFinite(n) || n <= 0) return 'Enter a positive number.';
          return '';
        },
      });
      if (entered == null) return;
      const bpm = parseFloat(entered);
      if (!Number.isFinite(bpm) || bpm <= 0) return;
      store.data.tempoChanges.push({ beat: step, bpm });
      store.data.tempoChanges.sort((a, b) => a.beat - b.beat);
      store.emit('change', { path: 'tempoChanges', value: store.data.tempoChanges });
      renderTempoChanges();
    });
  }

  function renderTempoChanges() {
    if (!tempo) return;
    // Wipe only our added tags — keep the hardcoded ones in index.html so
    // the placeholder visual stays intact until the project has its own.
    tempo.querySelectorAll('.tempo-tag[data-store-idx]').forEach((el) => el.remove());
    const loopLen = getLoopLen() || 1;
    (store.data.tempoChanges || []).forEach((t, idx) => {
      const pct = Math.max(0, Math.min(100, (t.beat / loopLen) * 100));
      const el = document.createElement('span');
      el.className = 'tempo-tag tempo-tag--user';
      el.textContent = `♩ ${t.bpm}`;
      el.style.left = pct + '%';
      el.dataset.storeIdx = String(idx);
      // Right-click user-added tempo tag → context menu (Change BPM / Delete).
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Dataset may drift if array is re-sorted; re-resolve idx by DOM pos.
        const storeIdx = Number(el.dataset.storeIdx);
        openContextMenu(e, [
          { label: 'Change BPM', onClick: () => changeTempoBpmFlow(storeIdx) },
          { label: 'Delete', variant: 'destructive', onClick: () => deleteTempoFlow(storeIdx) },
        ]);
      });
      tempo.appendChild(el);
    });
  }

  store.on('tick', updateSeekMarker);
  store.on('seek', updateSeekMarker);
  // Re-render when a new project loads (markers/tempoChanges may change out
  // from under us, and loopLen depends on the arrangement).
  store.on('loaded', () => {
    if (!Array.isArray(store.data.markers)) store.data.markers = [];
    if (!Array.isArray(store.data.tempoChanges)) store.data.tempoChanges = [];
    renderStoredMarkers();
    renderTempoChanges();
    updateSeekMarker();
  });
  updateSeekMarker();
}

function injectStyle() {
  if (document.getElementById('global-strip-zone-style')) return;
  const style = document.createElement('style');
  style.id = 'global-strip-zone-style';
  style.textContent = `
    /* === global-strip: P3 #11 marker drag + tempo change === */
    .global-strip__row--ruler { position: relative; cursor: pointer; }
    .global-strip__seek {
      position: absolute; top: 0; bottom: 0; width: 1px;
      background: var(--accent); pointer-events: none; left: 0;
    }
    .global-strip__row--markers .marker { user-select: none; touch-action: none; }
    .global-strip__row--tempo { cursor: copy; }
    .global-strip__row--tempo .tempo-tag { cursor: default; }
    .global-strip__row--tempo .tempo-tag--user {
      color: var(--accent);
      border-left: 2px solid var(--accent);
      padding-left: 4px;
      background: var(--surface-panel);
    }
    /* === end global-strip P3 #11 block === */
  `;
  document.head.appendChild(style);
}
