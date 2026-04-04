import { store } from '../state.js';
import { api } from '../api.js';

export function initBrowser(container) {
  function render() {
    const audioFiles = store.audioFiles || [];
    container.innerHTML = `
      <div class="panel-header">Browser</div>
      <div class="browser-section">
        <div class="browser-section-label">Audio</div>
        ${audioFiles.length === 0
          ? '<div style="padding:6px 10px 8px;color:var(--text-dim);font-size:9px;">No audio files yet</div>'
          : audioFiles.map(f => `
              <div class="browser-item" draggable="true" data-ref="${f}">
                <span>♪</span><span>${f}</span>
              </div>`).join('')}
      </div>
      <div class="browser-section">
        <div class="browser-section-label">Samples</div>
        <div style="padding:6px 10px;color:var(--text-dim);font-size:9px;">Kit samples built-in</div>
      </div>
      <div class="browser-drop-zone" id="browser-drop-zone">
        Drop MP3 / WAV<br>here to import
      </div>
    `;

    container.querySelectorAll('.browser-item[data-ref]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/bassmash-audio-ref', el.dataset.ref);
        e.dataTransfer.effectAllowed = 'copy';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });

    const dropZone = container.querySelector('#browser-drop-zone');
    dropZone.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault(); dropZone.classList.add('drag-over');
      }
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files)
        .filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac)$/i.test(f.name));
      for (const file of files) await api.uploadAudio(store.projectName, file);
      await refreshAudioFiles();
    });
  }

  async function refreshAudioFiles() {
    if (!store.projectName) return;
    store.audioFiles = await api.listAudio(store.projectName);
    render();
  }

  store.on('loaded', refreshAudioFiles);
  store.on('audioFilesChanged', render);
  render();
}
