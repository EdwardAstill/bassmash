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
    return res.json();
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
};
