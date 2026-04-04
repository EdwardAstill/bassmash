class StateStore {
  constructor() {
    this._listeners = {};
    this._saveTimer = null;
    this._saveFn = null;
    this.projectName = null;
    this.data = {
      bpm: 140,
      timeSignature: '4/4',
      tracks: [],
      patterns: [],
      arrangement: [],
    };
    this.audioFiles = [];
    this.playing = false;
    this.currentBeat = 0;
    this.selectedTrack = null;
    this.selectedPattern = null;
    this.synthMode = 'simple';
  }
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  }
  emit(event, detail) {
    const list = this._listeners[event];
    if (list) list.forEach(fn => fn(detail));
  }
  update(path, value) {
    const keys = path.split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = value;
    this.emit('change', { path, value });
    this._scheduleSave();
  }
  setSaveFn(fn) { this._saveFn = fn; }
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (this._saveFn) this._saveFn(this.data);
      this.emit('saved');
    }, 2000);
  }
  load(projectName, data) {
    this.projectName = projectName;
    this.data = data;
    this.emit('loaded', data);
  }
  addTrack(track) {
    this.data.tracks.push(track);
    this.emit('change', { path: 'tracks', value: this.data.tracks });
    this._scheduleSave();
  }
  addPattern(pattern) {
    this.data.patterns.push(pattern);
    this.emit('change', { path: 'patterns', value: this.data.patterns });
    this._scheduleSave();
  }
}
export const store = new StateStore();
