import { store } from '../state.js';

export function initChannelRack(container) {
  function getPattern() {
    if (store.selectedPattern == null) return null;
    return store.data.patterns[store.selectedPattern] || null;
  }

  function render() {
    const pattern = getPattern();
    container.innerHTML = '<div class="panel-header">Channel Rack</div>';

    if (!pattern || !pattern.steps) {
      container.innerHTML += '<div class="rack-empty">No drum pattern selected.<br>Click "+ Drums" to add one.</div>';
      return;
    }

    const rowsEl = document.createElement('div');
    rowsEl.className = 'rack-rows';
    const stepCount = pattern.stepCount || 16;

    pattern.steps.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'rack-row';

      const nameBtn = document.createElement('button');
      nameBtn.className = 'rack-name-btn';
      nameBtn.textContent = row.name || `Row ${rowIdx + 1}`;
      rowEl.appendChild(nameBtn);

      const stepsEl = document.createElement('div');
      stepsEl.className = 'rack-steps';

      for (let s = 0; s < stepCount; s++) {
        const stepEl = document.createElement('div');
        let cls = 'rack-step';
        if (row.cells[s]) cls += ' on';
        if (s % 4 === 0 && !row.cells[s]) cls += ' group-start';
        stepEl.className = cls;

        stepEl.addEventListener('mousedown', (e) => {
          e.preventDefault();
          row.cells[s] = !row.cells[s];
          if (!row.velocities) row.velocities = new Array(stepCount).fill(100);
          store.emit('change', { path: 'patterns' });
          store._scheduleSave();
          stepEl.className = 'rack-step' + (row.cells[s] ? ' on' : (s % 4 === 0 ? ' group-start' : ''));
        });

        stepsEl.appendChild(stepEl);
      }

      rowEl.appendChild(stepsEl);
      rowsEl.appendChild(rowEl);
    });

    container.appendChild(rowsEl);

    const addBtn = document.createElement('button');
    addBtn.className = 'rack-add-btn';
    addBtn.textContent = '+ Add row';
    addBtn.addEventListener('click', () => {
      if (!pattern || !pattern.steps) return;
      const stepCount = pattern.stepCount || 16;
      pattern.steps.push({
        name: `Row ${pattern.steps.length + 1}`,
        sampleRef: null,
        cells: new Array(stepCount).fill(false),
        velocities: new Array(stepCount).fill(100),
      });
      store.emit('change', { path: 'patterns' });
      store._scheduleSave();
      render();
    });
    container.appendChild(addBtn);
  }

  store.on('patternSelected', render);
  store.on('loaded', render);
  render();
}
