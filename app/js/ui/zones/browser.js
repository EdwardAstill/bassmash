// Zone 3 — Browser: sample library tree (phase 1b)
//   · Tabs: Sounds / Plugins / Files
//   · Sounds tab → kit samples (kit://) + project audio (plain filename)
//   · Files tab  → uploaded audio files for the current project, with an
//                  "Add audio…" picker for adding more without OS drag
//                  (P3 item #10 — rename/delete deferred, no backend routes)
//   · Search input live-filters tree items (case-insensitive substring)
//   · Click = audition via engine.masterGain (bypass mixer)
//   · Drag = starts a drop-payload the arrangement lanes consume
//
// Events consumed:
//   store.on('loaded')             → populate project samples
//   store.on('audioFilesChanged')  → re-render project-samples branch
//   store.on('engineReady')        → enables audition
import { initTabBar } from '../tab-bar.js';
import { store } from '../../state.js';
import { api } from '../../api.js';
import { sampler } from '../../audio/sampler.js';
import { engine } from '../../audio/engine.js';
import { audioCache } from '../../audio/audio-cache.js';

// ──────────────────────────────────────────────────────────────────
// One-time CSS (scoped)
// ──────────────────────────────────────────────────────────────────
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .tree-item[draggable="true"] { cursor: grab; }
    .tree-item--dragging { opacity: 0.5; }
    .tree-item--group { padding-left: 1.25rem; }
    .tree__section { cursor: pointer; user-select: none; }
  `;
  document.head.appendChild(style);
}

// ──────────────────────────────────────────────────────────────────
// Niceties
// ──────────────────────────────────────────────────────────────────
function displayNameFor(filename) {
  // "kick-deep.wav" → "Kick Deep"
  const base = filename.replace(/\.[^.]+$/, '');
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function groupKitSamples(filenames) {
  // Group by first token before '-' (kick, snare, hihat, perc, 808, …)
  const groups = new Map();
  for (const f of filenames) {
    const base = f.replace(/\.[^.]+$/, '');
    const token = (base.split(/[-_]/)[0] || 'misc').toLowerCase();
    const label = token.charAt(0).toUpperCase() + token.slice(1);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(f);
  }
  return groups;
}

// ──────────────────────────────────────────────────────────────────
// State held in closure (per init)
// ──────────────────────────────────────────────────────────────────
export function initBrowser(/* { store, api, engine, mixer, sampler, ensureAudio } */) {
  const root = document.querySelector('.zone--browser');
  if (!root) return;
  injectStyles();

  const treeEl    = root.querySelector('.tree');
  const searchEl  = root.querySelector('.search-input input');
  if (!treeEl) return;

  let kitFiles = [];
  let audioFiles = [];
  let engineReady = false;

  // ── Tabs ──────────────────────────────────────────────────────
  root.setAttribute('data-active-tab', 'Sounds');
  initTabBar(root.querySelector('.tab-bar'), (tabName) => {
    root.setAttribute('data-active-tab', tabName);
    render();
  });

  function currentTab() {
    return root.getAttribute('data-active-tab') || 'Sounds';
  }

  // ── Rendering ─────────────────────────────────────────────────
  function render() {
    treeEl.innerHTML = '';
    const tab = currentTab();
    if (tab === 'Sounds') {
      renderSounds();
    } else if (tab === 'Files') {
      renderFiles();
    } else {
      const empty = document.createElement('div');
      empty.className = 'tree__section';
      empty.textContent = '(none yet)';
      treeEl.appendChild(empty);
    }
    applyFilter();
  }

  function renderSounds() {
    // ── Drum Kit (built-in) ────────────────────────────────────
    const kitHeader = document.createElement('div');
    kitHeader.className = 'tree__section';
    kitHeader.textContent = '▾ Drum Kit (built-in)';
    treeEl.appendChild(kitHeader);

    if (kitFiles.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'tree-item';
      loading.textContent = '(loading…)';
      loading.style.opacity = '0.5';
      treeEl.appendChild(loading);
    } else {
      const groups = groupKitSamples(kitFiles);
      for (const [group, files] of groups) {
        const g = document.createElement('div');
        g.className = 'tree__section';
        g.textContent = `▾ ${group}`;
        g.style.paddingLeft = '0.75rem';
        g.style.opacity = '0.8';
        treeEl.appendChild(g);
        for (const f of files) {
          treeEl.appendChild(makeTreeItem({
            ref: `kit://${f}`,
            name: displayNameFor(f),
            group: true,
          }));
        }
      }
    }

    // ── Project Samples ────────────────────────────────────────
    const projHeader = document.createElement('div');
    projHeader.className = 'tree__section';
    projHeader.textContent = '▾ Project Samples';
    treeEl.appendChild(projHeader);

    if (audioFiles.length === 0) {
      const none = document.createElement('div');
      none.className = 'tree-item';
      none.textContent = '(none yet)';
      none.style.opacity = '0.5';
      treeEl.appendChild(none);
    } else {
      for (const f of audioFiles) {
        treeEl.appendChild(makeTreeItem({
          ref: f,
          name: displayNameFor(f),
        }));
      }
    }
  }

  // ── Files tab ─────────────────────────────────────────────────
  function renderFiles() {
    // Toolbar row: "+ Add audio…" picker
    const toolbar = document.createElement('div');
    toolbar.className = 'file-tab__toolbar';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'file-tab__add';
    addBtn.textContent = '+ Add audio…';
    addBtn.title = 'Upload audio files to this project';
    addBtn.addEventListener('click', () => pickerInput.click());
    toolbar.appendChild(addBtn);

    const pickerInput = document.createElement('input');
    pickerInput.type = 'file';
    pickerInput.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff';
    pickerInput.multiple = true;
    pickerInput.style.display = 'none';
    pickerInput.addEventListener('change', () => {
      const files = Array.from(pickerInput.files || []);
      if (files.length) uploadFiles(files);
      // Reset so the same file can be re-selected later.
      pickerInput.value = '';
    });
    toolbar.appendChild(pickerInput);

    treeEl.appendChild(toolbar);

    // Section header
    const header = document.createElement('div');
    header.className = 'tree__section';
    header.textContent = '▾ Audio Files';
    treeEl.appendChild(header);

    if (audioFiles.length === 0) {
      const none = document.createElement('div');
      none.className = 'tree-item';
      none.textContent = '(no files yet)';
      none.style.opacity = '0.5';
      treeEl.appendChild(none);
      return;
    }

    for (const f of audioFiles) {
      treeEl.appendChild(makeFileTabRow(f));
    }
  }

  // ── Files tab rows ───────────────────────────────────────────
  // Each row renders the filename plus inline "Rename" / "Delete"
  // action buttons. Also handles error surfacing: if the backend
  // rejects the mutation (409 conflict, 400 invalid, 404 missing)
  // the error message is rendered inline below the row until the
  // next successful render wipes the tree.
  function makeFileTabRow(filename) {
    const row = document.createElement('div');
    row.className = 'tree-item tree-item--file';
    row.title = filename;
    row.setAttribute('draggable', 'true');
    row.dataset.ref = filename;
    row.dataset.name = filename;

    const label = document.createElement('span');
    label.className = 'tree-item__label';
    label.textContent = filename;
    row.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'file-tab__actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'file-tab__action';
    renameBtn.textContent = 'Rename';
    renameBtn.title = 'Rename file';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRename(filename, row);
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'file-tab__action file-tab__action--danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.title = 'Delete file';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDelete(filename, row);
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);

    // Click on the row body = audition
    label.addEventListener('click', () => {
      auditionAudioFile(filename).catch((e) =>
        console.warn('[browser] audition failed', e),
      );
    });

    // Drag source — payload kind:"audio" so arrangement branches correctly
    row.addEventListener('dragstart', (e) => {
      row.classList.add('tree-item--dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(
        'application/x-bassmash-sample',
        JSON.stringify({ ref: filename, name: filename, kind: 'audio' }),
      );
      e.dataTransfer.setData('text/plain', filename);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('tree-item--dragging');
    });

    return row;
  }

  function showRowError(rowEl, message) {
    // Remove any previous error
    const prev = rowEl.nextSibling;
    if (prev && prev.classList?.contains('file-tab__error')) prev.remove();
    const err = document.createElement('div');
    err.className = 'file-tab__error';
    err.textContent = message;
    rowEl.after(err);
  }

  async function handleRename(filename, rowEl) {
    if (!store.projectName) return;
    const suggestion = filename;
    const next = window.prompt(`Rename "${filename}" to:`, suggestion);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === filename) return;
    try {
      const updated = await api.renameAudio(store.projectName, filename, trimmed);
      // Evict the stale decoded buffer under the old URL so later plays
      // don't re-hit a dead fetch / serve outdated audio for a reused name.
      try {
        audioCache.clear(api.audioUrl(store.projectName, filename));
      } catch (_) { /* non-fatal */ }
      // Refresh list + notify mirrors (scheduler, workbench).
      audioFiles = await api.listAudio(store.projectName);
      store.audioFiles = audioFiles;
      store.emit('audioFilesChanged');
      render();
      console.info('[browser] renamed', filename, '->', updated);
    } catch (err) {
      console.warn('[browser] renameAudio failed', err);
      showRowError(rowEl, err?.message || 'Rename failed');
    }
  }

  async function handleDelete(filename, rowEl) {
    if (!store.projectName) return;
    const ok = window.confirm(`Delete "${filename}"? This removes the file from disk.`);
    if (!ok) return;
    try {
      await api.deleteAudio(store.projectName, filename);
      try {
        audioCache.clear(api.audioUrl(store.projectName, filename));
      } catch (_) { /* non-fatal */ }
      audioFiles = await api.listAudio(store.projectName);
      store.audioFiles = audioFiles;
      store.emit('audioFilesChanged');
      render();
    } catch (err) {
      console.warn('[browser] deleteAudio failed', err);
      showRowError(rowEl, err?.message || 'Delete failed');
    }
  }

  async function uploadFiles(files) {
    if (!store.projectName) return;
    for (const file of files) {
      try {
        await api.uploadAudio(store.projectName, file);
      } catch (err) {
        console.warn('[browser] uploadAudio failed', file.name, err);
      }
    }
    // Refresh the list; fetchProjectAudio emits nothing itself, so also
    // emit audioFilesChanged so scheduler/workbench mirrors update.
    try {
      audioFiles = await api.listAudio(store.projectName);
      store.audioFiles = audioFiles;
      store.emit('audioFilesChanged');
    } catch (e) {
      console.warn('[browser] listAudio after upload failed', e);
    }
    render();
  }

  function makeTreeItem({ ref, name, group, displayFull }) {
    const el = document.createElement('div');
    el.className = 'tree-item';
    if (group) el.classList.add('tree-item--group');
    el.textContent = name;
    el.title = ref;
    el.setAttribute('draggable', 'true');
    el.dataset.ref = ref;
    el.dataset.name = name;

    // Click = audition
    el.addEventListener('click', () => {
      const useAudioCache = currentTab() === 'Files';
      const task = useAudioCache ? auditionAudioFile(ref) : audition(ref);
      task.catch((e) => console.warn('[browser] audition failed', e));
    });

    // Drag source — Sounds tab always emits kind:"sample" so the
    // arrangement drop handler maps to a drum track + 16-step pattern.
    // The Files tab uses makeFileTabRow(), which emits kind:"audio".
    el.addEventListener('dragstart', (e) => {
      el.classList.add('tree-item--dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(
        'application/x-bassmash-sample',
        JSON.stringify({ ref, name, kind: 'sample' }),
      );
      e.dataTransfer.setData('text/plain', name);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('tree-item--dragging');
    });

    return el;
  }

  // ── Filter (search) ───────────────────────────────────────────
  function applyFilter() {
    const q = (searchEl?.value || '').trim().toLowerCase();
    for (const item of treeEl.querySelectorAll('.tree-item')) {
      const text = (item.textContent || '').toLowerCase();
      item.style.display = !q || text.includes(q) ? '' : 'none';
    }
  }
  if (searchEl) searchEl.addEventListener('input', applyFilter);

  // ── Audition ──────────────────────────────────────────────────
  async function audition(ref) {
    if (!engineReady) return; // no-op until audio is live
    if (!engine.ctx || !engine.masterGain) return;
    try {
      const buffer = await sampler.load(ref);
      const src = engine.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(engine.masterGain);
      src.start(engine.ctx.currentTime);
    } catch (e) {
      console.warn('[browser] audition error', ref, e);
    }
  }

  async function auditionAudioFile(filename) {
    if (!engineReady) return;
    if (!engine.ctx || !engine.masterGain) return;
    if (!store.projectName) return;
    try {
      const url = api.audioUrl(store.projectName, filename);
      const buffer = await audioCache.load(url, engine);
      const src = engine.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(engine.masterGain);
      src.start(engine.ctx.currentTime);
    } catch (e) {
      console.warn('[browser] audition (audio file) error', filename, e);
    }
  }

  // ── Data fetching ─────────────────────────────────────────────
  async function fetchKit() {
    try {
      kitFiles = await api.listKit();
    } catch (e) {
      console.warn('[browser] listKit failed', e);
      kitFiles = [];
    }
    render();
  }

  async function fetchProjectAudio() {
    if (!store.projectName) return;
    try {
      audioFiles = await api.listAudio(store.projectName);
    } catch (e) {
      console.warn('[browser] listAudio failed', e);
      audioFiles = [];
    }
    render();
  }

  // ── Event wiring ──────────────────────────────────────────────
  store.on('loaded', () => { fetchProjectAudio(); });
  store.on('audioFilesChanged', () => { fetchProjectAudio(); });
  store.on('engineReady', () => { engineReady = true; });

  // If already loaded before we subscribed
  if (store.projectName) fetchProjectAudio();

  // Initial load
  fetchKit();
  render();
}
