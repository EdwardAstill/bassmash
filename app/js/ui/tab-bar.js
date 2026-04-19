// Generic tab-bar controller — Dock convention (.tab-bar / .tab-bar__tab / .tab-bar__tab--active)
// Usage: initTabBar(document.querySelector('.zone--browser .tab-bar'), (name) => { ... })

export function initTabBar(barEl, onSelect) {
  if (!barEl) return;
  const tabs = barEl.querySelectorAll('.tab-bar__tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('tab-bar__tab--active'));
      tab.classList.add('tab-bar__tab--active');
      const name = tab.textContent.trim();
      if (onSelect) onSelect(name, tab);
    });
  });
}
