// Bassmash — boot entry (phase 0)
// Responsibilities:
//   1. Load or create a project via the FastAPI backend
//   2. Initialize AudioContext on first user gesture (browser autoplay policy)
//   3. Wire each zone via its initZone() module
//   4. Expose a render tick for playhead / meters (stubbed for phase 0)

import { store } from './state.js';
import { api }   from './api.js';
import { engine }  from './audio/engine.js';
import { mixer }   from './audio/mixer.js';
import { sampler } from './audio/sampler.js';

import { initHeader }    from './ui/zones/header.js';
import { initToolbar }   from './ui/zones/toolbar.js';
import { initBrowser }   from './ui/zones/browser.js';
import { initWorkbench } from './ui/zones/workbench.js';
import { initUtility }   from './ui/zones/utility.js';
import { initStatusBar } from './ui/zones/status-bar.js';
import { initMixer }     from './ui/zones/mixer.js';
import { initArrangementDropTarget, initArrangementPlayhead } from './ui/zones/arrangement.js';
import { initScheduler } from './audio/scheduler.js';
import { initInspector }        from './ui/zones/inspector.js';
import { initClipInteractions } from './ui/zones/clip-interactions.js';
import { initGlobalStrip }      from './ui/zones/global-strip.js';
import { initUndoRedo }         from './undo.js';
import { initTrackManager }     from './ui/track-manager.js';
import { initExportMenu }       from './ui/export-menu.js';
import { initProjectPicker }    from './ui/project-picker.js';

// ──────────────────────────────────────────────────────────────────
// Audio-context init (deferred to first user gesture)
// ──────────────────────────────────────────────────────────────────
let _audioReady = false;
let _audioInitPromise = null;

async function ensureAudio() {
  if (_audioReady) return;
  if (_audioInitPromise) return _audioInitPromise;
  _audioInitPromise = (async () => {
    engine.init();
    if (engine.ctx.state === 'suspended') await engine.ctx.resume();
    _audioReady = true;
    store.emit('engineReady');
    console.info('[bassmash] audio ready · sr=' + engine.ctx.sampleRate);
  })();
  return _audioInitPromise;
}

// ──────────────────────────────────────────────────────────────────
// Project load (phase 0: pick first, or create default)
// ──────────────────────────────────────────────────────────────────
const DEFAULT_PROJECT = 'default';

async function loadInitialProject() {
  let names;
  try { names = await api.listProjects(); }
  catch (e) { console.warn('[bassmash] listProjects failed', e); names = []; }

  let name = names[0];
  if (!name) {
    await api.createProject(DEFAULT_PROJECT).catch((e) =>
      console.warn('[bassmash] createProject failed', e)
    );
    name = DEFAULT_PROJECT;
  }
  const data = await api.getProject(name);
  store.load(name, data);
  store.setSaveFn((d) => api.saveProject(name, d));
  console.info(`[bassmash] loaded project "${name}" · ${data.tracks?.length || 0} tracks`);
}

// ──────────────────────────────────────────────────────────────────
// Render tick — 60fps for playhead + meters (no-op until phase 1+)
// ──────────────────────────────────────────────────────────────────
function startRenderLoop() {
  function tick() {
    if (_audioReady && store.playing) {
      store.emit('tick', { time: engine.currentTime, beat: store.currentBeat });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ──────────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────────
async function boot() {
  const ctx = { store, api, engine, mixer, sampler, ensureAudio };

  // Restore last-used tool before toolbar initializes (it reads store.currentTool).
  try {
    const saved = localStorage.getItem('bassmash.currentTool');
    if (saved) store.currentTool = saved;
  } catch (e) { /* localStorage unavailable — ignore */ }
  store.on('toolChanged', (id) => {
    try { localStorage.setItem('bassmash.currentTool', id); } catch (e) { /* ignore */ }
  });

  initHeader(ctx);
  initToolbar(ctx);
  initBrowser(ctx);
  initWorkbench(ctx);
  initUtility(ctx);
  initStatusBar(ctx);

  // Phase 1 modules
  initMixer(ctx);
  initArrangementDropTarget(ctx);
  initArrangementPlayhead(ctx);

  // Phase 2 modules
  initInspector(ctx);
  initClipInteractions(ctx);
  initGlobalStrip(ctx);

  // Phase 3 modules
  initUndoRedo(ctx);
  initTrackManager(ctx);

  // P1 · Export MP3 (File menu → Export as MP3…)
  initExportMenu(ctx);

  // P3 · Project picker (File menu → Open/New Project…)
  initProjectPicker(ctx);

  // Scheduler needs AudioContext — wire after engineReady
  store.on('engineReady', () => initScheduler(ctx));

  const unlock = () => { ensureAudio().catch(console.error); };
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });

  await loadInitialProject();
  startRenderLoop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.bassmash = { store, api, engine, mixer, ensureAudio };
