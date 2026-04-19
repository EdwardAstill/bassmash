// Zone 8 — Utility: Notes | Help | History (phase 0: just tab switching)
import { initTabBar } from '../tab-bar.js';

export function initUtility() {
  const root = document.querySelector('.zone--utility');
  if (!root) return;
  initTabBar(root.querySelector('.tab-bar'), (tabName) => {
    root.setAttribute('data-active-tab', tabName);
  });
}
