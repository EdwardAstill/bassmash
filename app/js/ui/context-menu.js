// Shared right-click context menu. Used by track-manager (track row menu)
// and global-strip (marker / tempo tag menu) — both had near-identical
// open/close + viewport-clamp code before this.
//
//   items: [{ label, onClick, variant?: 'destructive' | ... }]
//
// The menu closes on outside-click, Esc, or after an item's onClick runs.

let _openMenu = null;
let _onOutsideDown = null;
let _onKey = null;

export function closeContextMenu() {
  if (_openMenu) { _openMenu.remove(); _openMenu = null; }
  if (_onOutsideDown) {
    document.removeEventListener('pointerdown', _onOutsideDown, true);
    _onOutsideDown = null;
  }
  if (_onKey) {
    document.removeEventListener('keydown', _onKey, true);
    _onKey = null;
  }
}

export function openContextMenu(ev, items, { className = 'context-menu' } = {}) {
  closeContextMenu();

  const ul = document.createElement('ul');
  ul.className = className;
  ul.style.left = ev.clientX + 'px';
  ul.style.top  = ev.clientY + 'px';

  items.forEach((it) => {
    const li = document.createElement('li');
    li.textContent = it.label;
    if (it.variant) li.setAttribute('data-variant', it.variant);
    li.addEventListener('click', () => {
      try { it.onClick(); } finally { closeContextMenu(); }
    });
    ul.appendChild(li);
  });

  document.body.appendChild(ul);
  _openMenu = ul;

  // Clamp to viewport (menu may have opened past the right/bottom edge).
  const r = ul.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (r.right  > vw) ul.style.left = Math.max(0, vw - r.width  - 4) + 'px';
  if (r.bottom > vh) ul.style.top  = Math.max(0, vh - r.height - 4) + 'px';

  // Defer listener attach so the current right-click pointerdown doesn't
  // immediately dismiss us.
  _onOutsideDown = (e) => {
    if (_openMenu && !_openMenu.contains(e.target)) closeContextMenu();
  };
  _onKey = (e) => {
    if (e.key === 'Escape') closeContextMenu();
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', _onOutsideDown, true);
    document.addEventListener('keydown', _onKey, true);
  }, 0);
}
