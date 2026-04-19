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
      markers: [],
      tempoChanges: [],
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
    this._saveTimer = setTimeout(async () => {
      this.emit('saving');
      try {
        if (this._saveFn) await this._saveFn(this.data);
        this.emit('saved');
      } catch (err) {
        this.emit('saveFailed', err);
      }
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
  removeTrack(index) {
    if (index < 0 || index >= this.data.tracks.length) return;
    this.data.tracks.splice(index, 1);
    this.data.arrangement = this.data.arrangement
      .filter(c => c.trackIndex !== index)
      .map(c => c.trackIndex > index ? { ...c, trackIndex: c.trackIndex - 1 } : c);
    if (this.selectedTrack === index) this.selectedTrack = null;
    else if (this.selectedTrack != null && this.selectedTrack > index) this.selectedTrack--;
    this.emit('change', { path: 'tracks' });
    this.emit('trackSelected', this.selectedTrack);
    this._scheduleSave();
  }
  duplicateTrack(index) {
    const orig = this.data.tracks[index];
    if (!orig) return null;
    const copy = JSON.parse(JSON.stringify(orig));
    copy.name = `${orig.name} copy`;
    const newIdx = index + 1;
    this.data.tracks.splice(newIdx, 0, copy);
    for (const clip of this.data.arrangement) {
      if (clip.trackIndex >= newIdx) clip.trackIndex++;
    }
    const srcClips = this.data.arrangement.filter(c => c.trackIndex === index);
    for (const clip of srcClips) {
      const cloned = { ...clip, trackIndex: newIdx };
      if (clip.patternIndex != null) {
        const srcPat = this.data.patterns[clip.patternIndex];
        if (srcPat) {
          const newPat = JSON.parse(JSON.stringify(srcPat));
          newPat.name = `${srcPat.name} copy`;
          this.data.patterns.push(newPat);
          cloned.patternIndex = this.data.patterns.length - 1;
          cloned.patternName = newPat.name;
        }
      }
      this.data.arrangement.push(cloned);
    }
    this.emit('change', { path: 'tracks' });
    this._scheduleSave();
    return newIdx;
  }
}
export const store = new StateStore();
