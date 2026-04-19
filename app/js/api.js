const BASE = '/api';

export const api = {
  async listProjects() {
    const res = await fetch(`${BASE}/projects`);
    return res.json();
  },
  async createProject(name) {
    const res = await fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return res.json();
  },
  async getProject(name) {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Project not found: ${name}`);
    return res.json();
  },
  async saveProject(name, data) {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  async uploadSample(projectName, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/samples`, {
      method: 'POST',
      body: form,
    });
    return res.json();
  },
  sampleUrl(projectName, filename) {
    if (filename.startsWith('kit://')) {
      return `${BASE}/kit/${encodeURIComponent(filename.slice(6))}`;
    }
    return `${BASE}/projects/${encodeURIComponent(projectName)}/samples/${encodeURIComponent(filename)}`;
  },
  async listKit() {
    const res = await fetch(`${BASE}/kit`);
    return res.json();
  },
  async exportMp3(projectName, wavBlob) {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wavBlob,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`export failed ${res.status}${text ? ': ' + text : ''}`);
    }
    // Backend returns the encoded MP3 bytes directly as `audio/mpeg`.
    return res.blob();
  },
  async uploadAudio(projectName, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/audio`, {
      method: 'POST',
      body: form,
    });
    return res.json(); // { filename }
  },
  async listAudio(projectName) {
    const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectName)}/audio`);
    return res.json(); // string[]
  },
  audioUrl(projectName, filename) {
    return `${BASE}/projects/${encodeURIComponent(projectName)}/audio/${encodeURIComponent(filename)}`;
  },
  async renameAudio(projectName, filename, newName) {
    const res = await fetch(
      `${BASE}/projects/${encodeURIComponent(projectName)}/audio/${encodeURIComponent(filename)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName }),
      },
    );
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.detail || ''; } catch (_) { /* non-json */ }
      const err = new Error(detail || `rename failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.filename;
  },
  async deleteAudio(projectName, filename) {
    const res = await fetch(
      `${BASE}/projects/${encodeURIComponent(projectName)}/audio/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.detail || ''; } catch (_) { /* non-json */ }
      const err = new Error(detail || `delete failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json(); // { deleted: filename }
  },

  // Subscribe to server-sent events about a project. Fires `onMessage` with
  // the parsed JSON payload for every event (type: hello | project-updated |
  // project-deleted). Returns an unsubscribe function.
  subscribeProject(name, onMessage) {
    const es = new EventSource(`${BASE}/projects/${encodeURIComponent(name)}/events`);
    es.onmessage = (ev) => {
      try { onMessage(JSON.parse(ev.data)); } catch (_) { /* ignore malformed */ }
    };
    es.onerror = () => { /* browser auto-reconnects */ };
    return () => es.close();
  },
};
