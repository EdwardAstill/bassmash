// Zone 7 — Workbench: Mixer | Piano Roll | Automation | Sampler
// Phase 3a: tab bar actually swaps pane visibility.
//
// The .mixer element is pre-rendered by index.html and owned by
// ui/zones/mixer.js. We only inject sibling panes for the remaining
// three tabs and hide/show them via CSS keyed on data-active-tab.
import { initTabBar } from '../tab-bar.js';
import { initPianoRoll }    from '../workbench/piano-roll.js';
import { initAutomation }   from '../workbench/automation.js';
import { initSamplerPanel } from '../workbench/sampler-panel.js';
import { initSynthPanel }   from '../workbench/synth-panel.js';

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .zone--workbench .workbench-pane {
      display: none;
      overflow: auto;
      height: 100%;
      padding: var(--space-2);
      box-sizing: border-box;
    }
    .zone--workbench[data-active-tab="Piano Roll"] .mixer { display: none; }
    .zone--workbench[data-active-tab="Piano Roll"] .workbench-pane--pianoroll { display: block; }
    .zone--workbench[data-active-tab="Automation"] .mixer { display: none; }
    .zone--workbench[data-active-tab="Automation"] .workbench-pane--automation { display: block; }
    .zone--workbench[data-active-tab="Sampler"] .mixer { display: none; }
    .zone--workbench[data-active-tab="Sampler"] .workbench-pane--sampler { display: block; }
    .zone--workbench[data-active-tab="Synth"] .mixer { display: none; }
    .zone--workbench[data-active-tab="Synth"] .workbench-pane--synth { display: block; }
  `;
  document.head.appendChild(style);
}

export function initWorkbench(ctx) {
  const root = document.querySelector('.zone--workbench');
  if (!root) return;

  injectStyles();

  // Default to Mixer so the pre-rendered mixer stays visible.
  if (!root.hasAttribute('data-active-tab')) {
    root.setAttribute('data-active-tab', 'Mixer');
  }

  // Inject sibling panes next to .mixer (which remains for the Mixer tab).
  const mixerEl = root.querySelector('.mixer');
  const pianorollPane = document.createElement('div');
  pianorollPane.className = 'workbench-pane workbench-pane--pianoroll';
  const automationPane = document.createElement('div');
  automationPane.className = 'workbench-pane workbench-pane--automation';
  const samplerPane = document.createElement('div');
  samplerPane.className = 'workbench-pane workbench-pane--sampler';
  const synthPane = document.createElement('div');
  synthPane.className = 'workbench-pane workbench-pane--synth';

  // Append after mixer if present, otherwise at end of zone.
  const parent = mixerEl ? mixerEl.parentNode : root;
  if (mixerEl) {
    parent.insertBefore(pianorollPane,  mixerEl.nextSibling);
    parent.insertBefore(automationPane, pianorollPane.nextSibling);
    parent.insertBefore(samplerPane,    automationPane.nextSibling);
    parent.insertBefore(synthPane,      samplerPane.nextSibling);
  } else {
    root.appendChild(pianorollPane);
    root.appendChild(automationPane);
    root.appendChild(samplerPane);
    root.appendChild(synthPane);
  }

  initTabBar(root.querySelector('.tab-bar'), (tabName) => {
    root.setAttribute('data-active-tab', tabName);
  });

  // Wire the workbench panes.
  initPianoRoll({ ctx, rootEl: pianorollPane });
  initAutomation({ ctx, rootEl: automationPane });
  initSamplerPanel({ ctx, rootEl: samplerPane });
  initSynthPanel({ ctx, rootEl: synthPane });
}
