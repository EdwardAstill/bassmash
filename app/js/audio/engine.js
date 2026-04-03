import { store } from '../state.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this._schedulerTimer = null;
    this._nextBeatTime = 0;
    this._currentBeat = 0;
    this._lookahead = 0.1;
    this._scheduleInterval = 25;
    this.looping = true; // loop by default
  }
  init() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    return this;
  }
  get sampleRate() { return this.ctx.sampleRate; }
  get currentTime() { return this.ctx.currentTime; }
  _secondsPerBeat() { return 60 / store.data.bpm; }

  /** Get the loop length in 16th notes based on arrangement, or default 16 (1 bar) */
  _getLoopLength() {
    const arrangement = store.data.arrangement;
    if (arrangement.length === 0) return 16; // 1 bar default
    let maxEnd = 0;
    for (const clip of arrangement) {
      const end = (clip.startBeat + clip.lengthBeats) * 4; // beats to 16th notes
      if (end > maxEnd) maxEnd = end;
    }
    return maxEnd || 16;
  }

  play() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._currentBeat = store.currentBeat;
    this._nextBeatTime = this.ctx.currentTime;
    store.playing = true;
    store.emit('transport', 'play');
    this._startScheduler();
  }
  stop() {
    store.playing = false;
    store.currentBeat = 0;
    this._currentBeat = 0;
    store.emit('transport', 'stop');
    this._stopScheduler();
  }
  _startScheduler() {
    this._stopScheduler();
    this._schedulerTimer = setInterval(() => this._schedule(), this._scheduleInterval);
  }
  _stopScheduler() {
    if (this._schedulerTimer) { clearInterval(this._schedulerTimer); this._schedulerTimer = null; }
  }
  _schedule() {
    const loopLen = this._getLoopLength();
    while (this._nextBeatTime < this.ctx.currentTime + this._lookahead) {
      // Wrap beat for looping
      const beat = this.looping ? (this._currentBeat % loopLen) : this._currentBeat;
      store.currentBeat = beat;
      store.emit('beat', { beat, time: this._nextBeatTime });
      this._currentBeat++;
      if (this.looping && this._currentBeat >= loopLen) {
        this._currentBeat = 0;
      }
      this._nextBeatTime += this._secondsPerBeat() / 4;
    }
  }
  connectToMaster(node) { node.connect(this.masterGain); }
}
export const engine = new AudioEngine();
