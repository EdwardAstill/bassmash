// File → Export MP3
// Attaches a tiny dropdown to the existing "File" menu-bar button and
// orchestrates the offline-render → WAV → POST /api/projects/{n}/export
// → MP3 download flow. Also drives a small status-bar chip that shows
// the current phase while the render runs.

import { store } from '../state.js';
import { api } from '../api.js';
import { renderArrangementToWav } from '../audio/offline-render.js';

let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-src', 'export-menu');
  el.textContent = `
    .menu-bar-button { position: relative; }
    /* position: fixed + z-index > any zone so the dropdown escapes any
       ancestor overflow: hidden. Top/left set in JS from the button rect. */
    .menu-popover {
      position: fixed;
      min-width: 180px;
      z-index: 1200;
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
      background: var(--item-hover);
    }
    .menu-popover__item[disabled] {
      color: var(--text-muted);
      cursor: progress;
    }
    .status-bar__chip[data-state="busy"] {
      color: var(--accent);
      border-color: var(--accent);
    }
    .status-bar__chip[data-state="error"] {
      color: var(--error, #e66);
      border-color: var(--error, #e66);
    }
  `;
  document.head.appendChild(el);
}

function buildPopover(fileBtn) {
  const popover = document.createElement('div');
  popover.className = 'menu-popover';
  popover.setAttribute('data-menu', 'file');
  popover.innerHTML = `
    <button class="menu-popover__item" data-action="export-mp3">Export as MP3…</button>
  `;
  // Append to body (not fileBtn) so ancestor overflow: hidden can't clip us.
  document.body.appendChild(popover);
  popover._fileBtn = fileBtn;
  return popover;
}

function positionPopover(popover) {
  const r = popover._fileBtn.getBoundingClientRect();
  popover.style.top = (r.bottom + 2) + 'px';
  popover.style.left = r.left + 'px';
}

function setChip(chip, state, text) {
  if (!chip) return;
  if (!text) {
    chip.hidden = true;
    chip.removeAttribute('data-state');
    chip.textContent = '';
    return;
  }
  chip.hidden = false;
  chip.textContent = text;
  if (state) chip.setAttribute('data-state', state);
  else chip.removeAttribute('data-state');
}

function safeFilename(s) {
  return String(s || 'bassmash-export').replace(/[^\w\-.]+/g, '_');
}

export function initExportMenu() {
  injectStyle();

  // Locate the "File" menu-bar button — it's the first one in the nav.
  const header = document.querySelector('.zone--header');
  if (!header) return;
  const fileBtn = [...header.querySelectorAll('.menu-bar-button')]
    .find((b) => (b.textContent || '').trim().toLowerCase() === 'file');
  if (!fileBtn) return;

  const popover = buildPopover(fileBtn);
  const exportItem = popover.querySelector('[data-action="export-mp3"]');
  const chip = document.querySelector('.zone--status [data-field="export-status"]');

  let busy = false;

  function closePopover() { popover.setAttribute('data-open', 'false'); }
  function togglePopover() {
    const open = popover.getAttribute('data-open') === 'true';
    if (!open) positionPopover(popover);
    popover.setAttribute('data-open', open ? 'false' : 'true');
  }

  fileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover();
  });
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== fileBtn) closePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });

  exportItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (busy) return;
    closePopover();
    await runExport();
  });

  async function runExport() {
    if (!store.projectName) {
      setChip(chip, 'error', 'Export: no project loaded');
      setTimeout(() => setChip(chip, null, ''), 3000);
      return;
    }
    busy = true;
    exportItem.setAttribute('disabled', 'true');
    exportItem.textContent = 'Exporting…';

    try {
      const wav = await renderArrangementToWav((msg) => {
        setChip(chip, 'busy', `Export · ${msg}`);
      });

      setChip(chip, 'busy', 'Export · Encoding MP3 (server)…');
      const mp3Blob = await api.exportMp3(store.projectName, wav);
      triggerDownload(mp3Blob, `${safeFilename(store.projectName)}.mp3`);
      setChip(chip, null, 'Export · Done');
      setTimeout(() => setChip(chip, null, ''), 2500);
    } catch (err) {
      console.error('[export] failed', err);
      setChip(chip, 'error', `Export failed: ${err.message || err}`);
      setTimeout(() => setChip(chip, null, ''), 5000);
    } finally {
      busy = false;
      exportItem.removeAttribute('disabled');
      exportItem.textContent = 'Export as MP3…';
    }
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
