// Zone 9 — Status bar: engine state, latency, CPU, autosave, project name
import { store } from '../../state.js';
import { engine } from '../../audio/engine.js';

export function initStatusBar() {
  const root = document.querySelector('.zone--status');
  if (!root) return;

  const engineEl   = root.querySelector('[data-field="engine-status"]');
  const latencyEl  = root.querySelector('[data-field="latency"]');
  const cpuEl      = root.querySelector('[data-field="cpu"]');
  const autosaveEl = root.querySelector('[data-field="autosave"]');
  const projectEl  = root.querySelector('[data-field="project-name"]');

  function renderEngine() {
    if (!engineEl) return;
    const ctx = engine.ctx;
    if (!ctx) {
      engineEl.textContent = '○ Audio Engine · click to start';
      engineEl.classList.remove('status-bar__chip--ok');
    } else if (ctx.state === 'running') {
      engineEl.textContent = '● Audio Engine OK';
      engineEl.classList.add('status-bar__chip--ok');
    } else {
      engineEl.textContent = `○ Audio Engine · ${ctx.state}`;
      engineEl.classList.remove('status-bar__chip--ok');
    }
  }

  function renderLatency() {
    if (!latencyEl || !engine.ctx) return;
    const sr = engine.ctx.sampleRate;
    const out = Math.round((engine.ctx.outputLatency ?? engine.ctx.baseLatency ?? 0) * 1000 * 10) / 10;
    latencyEl.textContent = `${sr / 1000 | 0}k · ${out} ms`;
  }

  function renderProject() {
    if (!projectEl) return;
    projectEl.textContent = store.projectName ? `▸ ${store.projectName}` : 'no project';
  }

  // ──────────────────────────────────────────────────────────────
  // CPU meter (P3 #8)
  //
  // Approach: sample wall-clock vs. AudioContext clock drift over a ~1s
  // window. When the audio thread is healthy, ctx.currentTime advances
  // ~1s per ~1s of wall-clock. When it can't keep up (glitches, xruns)
  // the audio clock lags and the ratio (1 - audioΔ / wallΔ) trends
  // positive — that's our crude CPU-load proxy.
  //
  // `renderCapacity` is the ideal signal but remains experimental
  // (Firefox Nightly only as of 2026), so we use it when present and
  // fall back to the drift heuristic, and finally to baseLatency*1000
  // if nothing else is available (rough-but-honest audio-headroom
  // proxy — documents itself as "lat").
  // ──────────────────────────────────────────────────────────────
  let _cpuTimer = null;
  let _prevWall = 0;
  let _prevAudio = 0;
  let _renderCap = null; // AudioRenderCapacity if supported

  function startCpuMeter() {
    if (!cpuEl || !engine.ctx) return;
    if (_cpuTimer) return; // already running

    // Prefer the official render-capacity API when the browser exposes it.
    if (typeof engine.ctx.renderCapacity === 'object' && engine.ctx.renderCapacity) {
      _renderCap = engine.ctx.renderCapacity;
      try {
        _renderCap.addEventListener('update', (ev) => {
          const pct = Math.round((ev.averageLoad ?? 0) * 100);
          cpuEl.textContent = `CPU ${pct}%`;
        });
        _renderCap.start({ updateInterval: 1 });
        return;
      } catch (_) { _renderCap = null; /* fall through */ }
    }

    _prevWall  = performance.now() / 1000;
    _prevAudio = engine.ctx.currentTime;
    _cpuTimer = setInterval(() => {
      const wall  = performance.now() / 1000;
      const audio = engine.ctx.currentTime;
      const dWall  = wall  - _prevWall;
      const dAudio = audio - _prevAudio;
      _prevWall  = wall;
      _prevAudio = audio;

      if (dWall <= 0) return;
      // Drift ratio: 0 when audio keeps up, positive when audio lags.
      const drift = Math.max(0, 1 - dAudio / dWall);
      let pct = Math.min(100, Math.round(drift * 100));

      // If drift is negligible (usually the case on healthy hardware),
      // show the baseLatency as an honest "you have this much headroom"
      // readout. This keeps the chip informative instead of stuck at 0%.
      if (pct < 2) {
        const latMs = Math.round((engine.ctx.baseLatency || 0) * 1000 * 10) / 10;
        cpuEl.textContent = `CPU · ${latMs} ms lat`;
      } else {
        cpuEl.textContent = `CPU ${pct}%`;
      }
    }, 1000);
  }

  // ──────────────────────────────────────────────────────────────
  // Autosave indicator (P3 #9)
  //
  // States driven by store events emitted from state.js::_scheduleSave:
  //   · idle    — "Saved"          (initial + after successful flush)
  //   · pending — "Saving…"        (emit 'saving' before the PUT)
  //   · fail    — "Save failed"    (emit 'saveFailed' when PUT rejects)
  // ──────────────────────────────────────────────────────────────
  function setAutosave(text, variant) {
    if (!autosaveEl) return;
    autosaveEl.textContent = text;
    autosaveEl.classList.remove('status-bar__chip--ok', 'status-bar__chip--warn', 'status-bar__chip--err');
    if (variant) autosaveEl.classList.add(`status-bar__chip--${variant}`);
  }

  store.on('engineReady', () => { renderEngine(); renderLatency(); startCpuMeter(); });
  store.on('loaded', renderProject);

  store.on('saving', () => setAutosave('Saving…', 'warn'));
  store.on('saved', () => {
    const now = new Date();
    setAutosave(`Saved ${now.toTimeString().slice(0, 5)}`, 'ok');
  });
  store.on('saveFailed', () => setAutosave('Save failed', 'err'));

  renderEngine();
  renderProject();
  setAutosave('Saved');
}
