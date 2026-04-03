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
    while (this._nextBeatTime < this.ctx.currentTime + this._lookahead) {
      store.currentBeat = this._currentBeat;
      store.emit('beat', { beat: this._currentBeat, time: this._nextBeatTime });
      this._currentBeat++;
      this._nextBeatTime += this._secondsPerBeat() / 4;
    }
  }
  connectToMaster(node) { node.connect(this.masterGain); }
}
export const engine = new AudioEngine();
