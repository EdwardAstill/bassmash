// Snapshot-based undo/redo.
//
// Architecture:
//   - Listen to store.emit('change') and debounce 250ms, then push a
//     JSON-stringified deep snapshot of store.data onto past[].
//   - Cap past at 50 entries.
//   - future[] is cleared on every new push, populated by undo().
//   - _suppressNextSnapshot guards against recording the restoration
//     itself (otherwise undo would push a snapshot that matches the
//     current past top and immediately clear future).
//   - Initial snapshot is pushed on 'loaded'. Stacks are reset there
//     so that a project switch doesn't leak cross-project history.
//   - Toolbar.js wires "undo not wired" / "redo not wired" console
//     loggers on the same buttons. We attach our listener too; both
//     fire (addEventListener is additive). The logger is harmless.

const MAX_DEPTH = 50;
const DEBOUNCE_MS = 250;

export function initUndoRedo({ store } = {}) {
  if (!store) return;

  const past = [];
  const future = [];
  let suppressNext = false;
  let debounceTimer = null;

  // Toolbar buttons (resolved lazily so we don't race the toolbar init).
  let undoBtn = null;
  let redoBtn = null;

  function snapshot() {
    try { return JSON.stringify(store.data); }
    catch (e) { console.warn('[undo] snapshot failed', e); return null; }
  }

  function pushSnapshot() {
    const snap = snapshot();
    if (snap == null) return;
    // Avoid duplicates back-to-back (common when multiple events coalesce).
    if (past.length && past[past.length - 1] === snap) return;
    past.push(snap);
    if (past.length > MAX_DEPTH) past.shift();
    future.length = 0;
    updateButtons();
  }

  function scheduleSnapshot() {
    if (suppressNext) { suppressNext = false; return; }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      pushSnapshot();
    }, DEBOUNCE_MS);
  }

  function restore(json) {
    let parsed;
    try { parsed = JSON.parse(json); }
    catch (e) { console.warn('[undo] parse failed', e); return; }
    store.data = parsed;
    suppressNext = true;
    store.emit('change', { path: 'undo' });
    store.emit('loaded', store.data);
  }

  function undo() {
    if (past.length <= 1) return;
    // Flush any pending debounced snapshot first so we don't skip a state.
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; pushSnapshot(); }
    if (past.length <= 1) return;
    const current = past.pop();
    future.push(current);
    restore(past[past.length - 1]);
    updateButtons();
  }

  function redo() {
    if (!future.length) return;
    const snap = future.pop();
    past.push(snap);
    restore(snap);
    updateButtons();
  }

  function updateButtons() {
    if (undoBtn) {
      if (past.length > 1) undoBtn.removeAttribute('data-disabled');
      else undoBtn.setAttribute('data-disabled', 'true');
    }
    if (redoBtn) {
      if (future.length) redoBtn.removeAttribute('data-disabled');
      else redoBtn.setAttribute('data-disabled', 'true');
    }
  }

  // ── wire store events
  store.on('change', scheduleSnapshot);
  store.on('saved', () => {
    // Flush debounced snapshot at save boundaries so we coalesce bursts.
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; pushSnapshot(); }
  });
  store.on('loaded', () => {
    past.length = 0;
    future.length = 0;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    const snap = snapshot();
    if (snap != null) past.push(snap);
    updateButtons();
  });

  // ── keyboard
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = (e.key || '').toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (key === 'z' && e.shiftKey)  { e.preventDefault(); redo(); return; }
    if (key === 'y' && !e.shiftKey) { e.preventDefault(); redo(); return; }
  });

  // ── toolbar buttons (query from DOM; toolbar.js is untouchable)
  function findToolbarButtons() {
    const root = document.querySelector('.zone--toolbar');
    if (!root) return;
    const groups = root.querySelectorAll('.toolbar__group');
    const history = groups[2];
    if (!history) return;
    const btns = history.querySelectorAll('.toolbar__btn');
    btns.forEach((btn) => {
      const label = (btn.textContent || '').trim().toLowerCase();
      if (label.includes('undo')) undoBtn = btn;
      else if (label.includes('redo')) redoBtn = btn;
    });
    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);
    updateButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', findToolbarButtons, { once: true });
  } else {
    findToolbarButtons();
  }

  injectStyle();

  // Expose for debugging
  window.m8sUndo = { undo, redo, past, future };
}

function injectStyle() {
  if (document.getElementById('undo-redo-style')) return;
  const style = document.createElement('style');
  style.id = 'undo-redo-style';
  style.textContent = `
    .zone--toolbar .toolbar__btn[data-disabled="true"] {
      opacity: 0.35;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}
