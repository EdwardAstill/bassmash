// Track row +/×/right-click menu.
//
// Responsibilities:
//   - Append a persistent "+ Add track" row at the bottom of the
//     `.arrangement__track-list`. Re-append it after any re-render
//     that might dislodge it (we watch via MutationObserver).
//   - Inject a hover-visible delete "×" per `.track-row` (not the add row).
//   - Right-click context menu: Rename / Duplicate / Delete.

import { openContextMenu } from './context-menu.js';

const TRACK_COLORS = ['amber', 'red', 'zinc', 'emerald', 'cyan', 'blue', 'violet'];

export function initTrackManager({ store } = {}) {
  if (!store) return;

  injectStyle();

  const zone = document.querySelector('.zone--arrangement');
  if (!zone) return;
  const trackList = zone.querySelector('.arrangement__track-list');
  if (!trackList) return;

  // ── "+ Add track" row
  const addRow = document.createElement('div');
  addRow.className = 'track-row track-row--add';
  addRow.textContent = '＋ Add track';
  addRow.addEventListener('click', () => {
    const n = store.data.tracks.length;
    store.addTrack({
      name: `Track ${n + 1}`,
      type: 'drum',
      muted: false,
      color: TRACK_COLORS[n % TRACK_COLORS.length],
    });
  });

  function ensureAddRow() {
    // Append only if not already last child.
    if (trackList.lastElementChild !== addRow) {
      trackList.appendChild(addRow);
    }
  }

  // ── Per-row delete buttons
  function injectDeleteButtons() {
    const rows = Array.from(trackList.querySelectorAll('.track-row'))
      .filter((r) => r !== addRow && !r.classList.contains('track-row--add'));
    rows.forEach((row, i) => {
      if (row.querySelector('.track-row__delete')) return;
      const btn = document.createElement('button');
      btn.className = 'track-row__delete';
      btn.type = 'button';
      btn.title = 'Delete track';
      btn.textContent = '×';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        store.removeTrack(i);
      });
      row.appendChild(btn);
    });
  }

  function openTrackMenu(e, index) {
    openContextMenu(e, [
      { label: 'Rename', onClick: () => {
        const t = store.data.tracks[index];
        if (!t) return;
        const next = window.prompt('Rename track', t.name || '');
        if (next == null) return;
        const name = next.trim();
        if (!name || name === t.name) return;
        t.name = name;
        store.emit('change', { path: 'tracks' });
        if (typeof store._scheduleSave === 'function') store._scheduleSave();
      }},
      { label: 'Duplicate', onClick: () => store.duplicateTrack(index) },
      { label: 'Delete', variant: 'destructive', onClick: () => {
        if (!window.confirm('Delete track?')) return;
        store.removeTrack(index);
      }},
    ], { className: 'track-menu' });
  }

  trackList.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.track-row');
    if (!row || row === addRow || row.classList.contains('track-row--add')) return;
    const rows = Array.from(trackList.querySelectorAll('.track-row'))
      .filter((r) => r !== addRow && !r.classList.contains('track-row--add'));
    const index = rows.indexOf(row);
    if (index < 0) return;
    e.preventDefault();
    openTrackMenu(e, index);
  });

  // ── Sync on state/DOM changes
  function syncUI() {
    ensureAddRow();
    injectDeleteButtons();
  }

  store.on('change', ({ path } = {}) => {
    if (path === 'tracks' || path === 'undo' || (typeof path === 'string' && path.startsWith('tracks'))) {
      syncUI();
    }
  });
  store.on('loaded', syncUI);

  // Some zone re-renders might wipe/re-append rows; observe for safety.
  const observer = new MutationObserver(() => {
    // If add-row was pulled out of the DOM or is no longer last, fix it.
    // Also ensure new rows have delete buttons.
    syncUI();
  });
  observer.observe(trackList, { childList: true });

  // Initial paint
  syncUI();
}

function injectStyle() {
  if (document.getElementById('track-manager-style')) return;
  const style = document.createElement('style');
  style.id = 'track-manager-style';
  style.textContent = `
    .arrangement__track-list .track-row { position: relative; }
    .track-row__delete {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 16px; height: 16px; border-radius: 2px;
      border: 1px solid var(--border); background: var(--surface-raised);
      color: inherit; font-size: 10px; line-height: 1; padding: 0;
      cursor: pointer; opacity: 0; transition: opacity 0.1s;
      display: flex; align-items: center; justify-content: center;
    }
    .track-row:hover .track-row__delete { opacity: 1; }
    .track-row__delete:hover { background: var(--error-bg, var(--error)); color: var(--error); border-color: var(--error); }
    .track-row--add {
      border: 1px dashed var(--border); opacity: 0.6; cursor: pointer;
      padding: 4px 8px; font-size: 11px; text-align: center;
    }
    .track-row--add:hover { opacity: 1; background: var(--item-hover); }
    .track-menu {
      position: fixed; background: var(--surface-raised); border: 1px solid var(--border);
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
      list-style: none; padding: 2px 0; margin: 0; min-width: 120px; z-index: 1000; font-size: 11px;
    }
    .track-menu li { padding: 4px 12px; cursor: pointer; }
    .track-menu li:hover { background: var(--item-hover); }
    .track-menu li[data-variant="destructive"] { color: var(--error); }
  `;
  document.head.appendChild(style);
}
