// Zone 2 — Toolbar: stateful tool switcher + keyboard shortcuts
import { store } from '../../state.js';

const TOOLS = [
  { key: 'v', label: '↖ Select', id: 'select' },
  { key: 'b', label: '✎ Pen',    id: 'pen' },
  { key: 'c', label: '✂ Split',  id: 'split' },
  { key: 'g', label: '⌘ Glue',   id: 'glue' },
  { key: 'm', label: '⊘ Mute',   id: 'mute' },
  { key: 'e', label: '⌫ Erase',  id: 'erase' },
  { key: 'z', label: '⎈ Zoom',   id: 'zoom' },
];

export function initToolbar() {
  const root = document.querySelector('.zone--toolbar');
  if (!root) return;

  // Respect an already-set tool (e.g. restored from localStorage in main.js).
  const validIds = TOOLS.map((t) => t.id);
  if (!validIds.includes(store.currentTool)) store.currentTool = 'select';

  // Track last-selected clip payload for the P shortcut (Piano Roll tab).
  // clip-interactions emits {trackIndex, arrangementIdx} or null on deselect.
  store.on('clipSelected', (payload) => { store.selectedClip = payload || null; });

  const groups = root.querySelectorAll('.toolbar__group');
  const toolGroup    = groups[0];
  const snapGroup    = groups[1];
  const historyGroup = groups[2];

  if (toolGroup) {
    const toolBtns = toolGroup.querySelectorAll('.toolbar__btn');
    toolBtns.forEach((btn) => {
      const raw = (btn.textContent || '').trim().toLowerCase();
      const tool = TOOLS.find((t) => raw.startsWith(t.label.toLowerCase()));
      if (!tool) return;
      btn.dataset.toolId = tool.id;
      btn.addEventListener('click', () => selectTool(tool.id, toolGroup));
    });
    const initial = toolGroup.querySelector(`[data-tool-id="${store.currentTool}"]`);
    if (initial) {
      toolGroup.querySelectorAll('.toolbar__btn--active').forEach((b) => b.classList.remove('toolbar__btn--active'));
      initial.classList.add('toolbar__btn--active');
    }
  }

  if (snapGroup) {
    snapGroup.querySelectorAll('.toolbar__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('data-active') === 'true';
        if (on) btn.removeAttribute('data-active');
        else btn.setAttribute('data-active', 'true');
      });
    });
  }

  if (historyGroup) {
    const [undoBtn, redoBtn] = historyGroup.querySelectorAll('.toolbar__btn');
    if (undoBtn) undoBtn.addEventListener('click', () => console.info('[toolbar] undo not wired'));
    if (redoBtn) redoBtn.addEventListener('click', () => console.info('[toolbar] redo not wired'));
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    const key = (e.key || '').toLowerCase();

    // P → switch workbench to Piano Roll when a MIDI/pattern clip is selected
    if (key === 'p') {
      const sel = store.selectedClip;
      const arrIdx = sel?.arrangementIdx;
      const clip = arrIdx != null ? store.data?.arrangement?.[arrIdx] : null;
      const isMidi = !!(clip && (clip.patternIndex != null || clip.type === 'pattern'));
      if (isMidi) {
        e.preventDefault();
        activateWorkbenchTab('Piano Roll');
        return;
      }
    }

    const tool = TOOLS.find((t) => t.key === key);
    if (!tool) return;
    e.preventDefault();
    selectTool(tool.id, toolGroup);
  });

  injectStyle();
}

// Activate a tab in the Workbench zone by visible name. Mirrors what
// ui/tab-bar.js does on click so workbench.js picks it up via its
// onSelect callback (which flips data-active-tab on .zone--workbench).
function activateWorkbenchTab(name) {
  const bar = document.querySelector('.zone--workbench .tab-bar');
  if (!bar) return;
  const tabs = bar.querySelectorAll('.tab-bar__tab');
  let found = null;
  tabs.forEach((t) => {
    if ((t.textContent || '').trim() === name) found = t;
  });
  if (!found) return;
  found.click();
}

function selectTool(id, group) {
  store.currentTool = id;
  if (group) {
    group.querySelectorAll('.toolbar__btn--active').forEach((b) => b.classList.remove('toolbar__btn--active'));
    const btn = group.querySelector(`[data-tool-id="${id}"]`);
    if (btn) btn.classList.add('toolbar__btn--active');
  }
  store.emit('toolChanged', id);
}

function injectStyle() {
  if (document.getElementById('toolbar-zone-style')) return;
  const style = document.createElement('style');
  style.id = 'toolbar-zone-style';
  style.textContent = `
    .zone--toolbar .toolbar__btn[data-active="true"] {
      background: var(--accent);
      color: var(--accent-contrast, #fff);
    }
  `;
  document.head.appendChild(style);
}
