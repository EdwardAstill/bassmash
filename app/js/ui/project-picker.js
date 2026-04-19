// P3 #12 · Project picker dialog
// Triggered from File menu "Open Project…" and "New Project…" items.
// Lists existing projects from GET /api/projects, lets user click to
// load one, or create a new one via POST /api/projects.
//
// Load flow reuses the same code path as main.js::loadInitialProject():
//   api.getProject → store.load → store.setSaveFn → emit 'loaded'
// (Scheduler, mixer, track-manager, undo etc. all listen to 'loaded'
// so the downstream zones rebuild from the new project data.)
//
// Coexists with app/js/ui/export-menu.js — both append items to the
// same `.menu-popover[data-menu="file"]` dropdown built by export-menu.
// If export-menu hasn't built it yet we build it ourselves; the other
// module will reuse the same popover on init.

import { store } from '../state.js';
import { api } from '../api.js';
import { audioCache } from '../audio/audio-cache.js';

// ──────────────────────────────────────────────────────────────────
// Styles — demarcated in style.css too, but we inject a minimum here
// so the module is drop-in even if the stylesheet hasn't been updated.
// ──────────────────────────────────────────────────────────────────
let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-src', 'project-picker');
  el.textContent = `
    .menu-bar-button { position: relative; }
    .menu-popover {
      position: absolute;
      top: 100%;
      left: 0;
      min-width: 180px;
      z-index: 50;
      background: var(--surface-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 4px 18px rgba(0,0,0,.18);
      padding: 4px;
      display: none;
      font-size: var(--text-sm);
    }
    .menu-popover[data-open="true"] { display: block; }
    .menu-popover__item {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      border: 0;
      color: var(--text-primary);
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      font: inherit;
      cursor: pointer;
    }
    .menu-popover__item:hover:not([disabled]) {
      background: var(--item-hover, rgba(0,0,0,0.06));
    }
    .menu-popover__sep {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }
  `;
  document.head.appendChild(el);
}

// ──────────────────────────────────────────────────────────────────
// Find or create the File menu popover.
// export-menu.js builds one with data-menu="file"; if present we reuse
// it. Otherwise we build our own on the same File button.
// ──────────────────────────────────────────────────────────────────
function ensureFilePopover() {
  const header = document.querySelector('.zone--header');
  if (!header) return null;
  // Match on the first text node, not textContent — if export-menu has
  // already appended a popover inside this button, textContent will include
  // the popover text and fail an equality check against 'file'.
  const fileBtn = [...header.querySelectorAll('.menu-bar-button')]
    .find((b) => {
      const labelNode = [...b.childNodes].find((n) => n.nodeType === 3); // text node
      const label = (labelNode ? labelNode.textContent : b.textContent) || '';
      return label.trim().toLowerCase() === 'file';
    });
  if (!fileBtn) return null;

  let popover = fileBtn.querySelector('.menu-popover[data-menu="file"]');
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'menu-popover';
    popover.setAttribute('data-menu', 'file');
    fileBtn.appendChild(popover);

    // Wire open/close since export-menu isn't around to do it.
    fileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = popover.getAttribute('data-open') === 'true';
      popover.setAttribute('data-open', open ? 'false' : 'true');
    });
    document.addEventListener('click', (e) => {
      if (!popover.contains(e.target) && e.target !== fileBtn) {
        popover.setAttribute('data-open', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') popover.setAttribute('data-open', 'false');
    });
  }
  return { fileBtn, popover };
}

function closePopover(popover) {
  if (popover) popover.setAttribute('data-open', 'false');
}

// ──────────────────────────────────────────────────────────────────
// Modal dialog — built on demand, single instance reused.
// ──────────────────────────────────────────────────────────────────
let _dialogEl = null;
let _dialogMode = null; // 'open' | 'new'
let _resolveDialog = null;

function buildDialog() {
  if (_dialogEl) return _dialogEl;

  const overlay = document.createElement('div');
  overlay.className = 'project-picker-overlay';
  overlay.setAttribute('data-open', 'false');
  overlay.innerHTML = `
    <div class="project-picker" role="dialog" aria-modal="true" aria-labelledby="project-picker-title">
      <div class="project-picker__header">
        <h2 class="project-picker__title" id="project-picker-title">Open Project</h2>
        <button class="project-picker__close" data-action="close" title="Close (Esc)" aria-label="Close">×</button>
      </div>
      <div class="project-picker__body">
        <div class="project-picker__list" data-field="list">
          <div class="project-picker__empty">Loading…</div>
        </div>
        <div class="project-picker__new" data-field="new-row" hidden>
          <input class="project-picker__input" type="text" placeholder="Project name"
                 data-field="new-name" spellcheck="false" autocomplete="off" />
          <button class="project-picker__btn project-picker__btn--primary"
                  data-action="create-confirm">Create</button>
        </div>
        <div class="project-picker__error" data-field="error" hidden></div>
      </div>
      <div class="project-picker__footer">
        <button class="project-picker__btn" data-action="new-project">+ New Project</button>
        <span class="project-picker__spacer"></span>
        <button class="project-picker__btn" data-action="close">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Outside-click closes. Listen on the overlay itself (not inner dialog).
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideDialog();
  });

  // Action delegation.
  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'close') {
      hideDialog();
    } else if (action === 'new-project') {
      switchToNewMode();
    } else if (action === 'create-confirm') {
      handleCreate();
    } else if (action === 'load-project') {
      const name = btn.getAttribute('data-project-name');
      if (name) handleLoad(name);
    }
  });

  const input = overlay.querySelector('[data-field="new-name"]');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
    if (e.key === 'Escape') { e.preventDefault(); hideDialog(); }
  });

  _dialogEl = overlay;
  return overlay;
}

function showDialog(mode) {
  const el = buildDialog();
  _dialogMode = mode;
  el.setAttribute('data-open', 'true');
  el.querySelector('.project-picker__title').textContent =
    mode === 'new' ? 'New Project' : 'Open Project';
  const newRow = el.querySelector('[data-field="new-row"]');
  const listEl = el.querySelector('[data-field="list"]');
  setError(null);
  if (mode === 'new') {
    newRow.hidden = false;
    listEl.hidden = true;
    const input = el.querySelector('[data-field="new-name"]');
    input.value = '';
    setTimeout(() => input.focus(), 0);
  } else {
    newRow.hidden = true;
    listEl.hidden = false;
    refreshList();
  }

  // Module-scoped keydown for Esc — rebind each show so it disposes cleanly.
  document.addEventListener('keydown', escHandler, { capture: true });
}

function hideDialog() {
  if (!_dialogEl) return;
  _dialogEl.setAttribute('data-open', 'false');
  document.removeEventListener('keydown', escHandler, { capture: true });
  _dialogMode = null;
}

function escHandler(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    hideDialog();
  }
}

function switchToNewMode() {
  showDialog('new');
}

function setError(msg) {
  if (!_dialogEl) return;
  const errEl = _dialogEl.querySelector('[data-field="error"]');
  if (!msg) {
    errEl.hidden = true;
    errEl.textContent = '';
  } else {
    errEl.hidden = false;
    errEl.textContent = msg;
  }
}

async function refreshList() {
  const listEl = _dialogEl.querySelector('[data-field="list"]');
  listEl.innerHTML = '<div class="project-picker__empty">Loading…</div>';
  let names;
  try {
    names = await api.listProjects();
  } catch (err) {
    console.warn('[project-picker] listProjects failed', err);
    listEl.innerHTML = '<div class="project-picker__empty">Failed to load projects</div>';
    return;
  }
  if (!Array.isArray(names) || names.length === 0) {
    listEl.innerHTML = '<div class="project-picker__empty">No projects yet. Click "+ New Project".</div>';
    return;
  }
  const current = store.projectName;
  listEl.innerHTML = names.map((n) => {
    const isCurrent = n === current;
    const safe = escapeHtml(n);
    return `
      <button class="project-picker__item${isCurrent ? ' project-picker__item--current' : ''}"
              data-action="load-project"
              data-project-name="${safe}">
        <span class="project-picker__item-name">${safe}</span>
        ${isCurrent ? '<span class="project-picker__item-badge">current</span>' : ''}
      </button>
    `;
  }).join('');
}

async function handleLoad(name) {
  if (!name) return;
  if (name === store.projectName) { hideDialog(); return; }
  setError(null);
  try {
    const data = await api.getProject(name);
    // Reuse the exact same wiring main.js does for the initial load.
    // Clear the audio-cache so buffers from the old project don't leak
    // keyed by old URLs (audioUrl embeds projectName → new project's
    // same-named files would otherwise miss the cache anyway, but stale
    // entries pile up).
    try { audioCache.clear(); } catch (_) {}
    store.load(name, data);
    store.setSaveFn((d) => api.saveProject(name, d));
    console.info(`[project-picker] loaded "${name}" · ${data.tracks?.length || 0} tracks`);
    hideDialog();
  } catch (err) {
    console.error('[project-picker] load failed', err);
    setError(`Failed to load "${name}": ${err.message || err}`);
  }
}

async function handleCreate() {
  const input = _dialogEl.querySelector('[data-field="new-name"]');
  const raw = (input.value || '').trim();
  if (!raw) { setError('Enter a project name'); input.focus(); return; }
  // Backend allows only [A-Za-z0-9._-] — surface the same rule client-side
  // so users don't get an opaque 400.
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    setError('Name may only contain letters, digits, and . _ -');
    input.focus();
    return;
  }
  setError(null);
  try {
    await api.createProject(raw);
    // Created — treat the rest like a normal load.
    await handleLoad(raw);
  } catch (err) {
    console.error('[project-picker] create failed', err);
    setError(`Failed to create "${raw}": ${err.message || err}`);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ──────────────────────────────────────────────────────────────────
// Public: wire File menu items and expose imperative openers.
// ──────────────────────────────────────────────────────────────────
export function initProjectPicker() {
  injectStyle();

  const found = ensureFilePopover();
  if (!found) {
    console.warn('[project-picker] File menu not found');
    return;
  }
  const { popover } = found;

  // Add our two items to the top of the File dropdown. If they already
  // exist (e.g. hot reload) don't duplicate.
  if (!popover.querySelector('[data-action="open-project"]')) {
    const openBtn = document.createElement('button');
    openBtn.className = 'menu-popover__item';
    openBtn.setAttribute('data-action', 'open-project');
    openBtn.textContent = 'Open Project…';

    const newBtn = document.createElement('button');
    newBtn.className = 'menu-popover__item';
    newBtn.setAttribute('data-action', 'new-project');
    newBtn.textContent = 'New Project…';

    const sep = document.createElement('div');
    sep.className = 'menu-popover__sep';

    // Insert at top so project actions come before Export.
    popover.prepend(sep);
    popover.prepend(newBtn);
    popover.prepend(openBtn);

    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover(popover);
      showDialog('open');
    });
    newBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover(popover);
      showDialog('new');
    });
  }
}

// Expose imperative openers for anything that wants to trigger the
// dialog programmatically (e.g. future keyboard shortcut).
export const projectPicker = {
  openPicker() { showDialog('open'); },
  openNew()    { showDialog('new');  },
  close()      { hideDialog();        },
};

