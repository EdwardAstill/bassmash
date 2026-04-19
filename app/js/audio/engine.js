import { store } from '../state.js';
import { bpmAtBeat } from './tempo.js';

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
  // Default / fallback quarter-note duration. Prefer _secondsPerBeatAt(beat)
  // inside the scheduler so tempo changes (P3 #11) are honored.
  _secondsPerBeat() { return 60 / (store.data.bpm || 140); }
  _secondsPerBeatAt(beat) { return 60 / bpmAtBeat(store.data, beat); }

  /** Get the loop length in 16th notes based on arrangement, or default 16 (1 bar) */
  _getLoopLength() {
    if (store.loopEndOverride != null) return store.loopEndOverride * 4;
    const arrangement = store.data.arrangement;
    if (arrangement.length === 0) return 16;
    let maxEnd = 0;
    for (const clip of arrangement) {
      const end = (clip.startBeat + clip.lengthBeats) * 4;
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
  setLooping(on) {
    this.looping = !!on;
    store.emit('loopChanged', this.looping);
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
      // Loop OFF + past end of arrangement → stop the transport. Otherwise
      // the engine would keep ticking silently forever.
      if (!this.looping && this._currentBeat >= loopLen) {
        this.stop();
        return;
      }
      const beat = this.looping ? (this._currentBeat % loopLen) : this._currentBeat;
      store.currentBeat = beat;
      store.emit('beat', { beat, time: this._nextBeatTime });
      this._currentBeat++;
      if (this.looping && this._currentBeat >= loopLen) {
        this._currentBeat = 0;
        // Hard-stop in-flight sources so clips with `lengthBeats: 0` (play
        // to natural end) don't bleed past the loop boundary.
        store.emit('loopWrap');
      }
      // P3 #11 — advance by the 16th-note duration at the step we just
      // emitted, so tempo changes take effect on the next beat boundary.
      this._nextBeatTime += this._secondsPerBeatAt(beat) / 4;
    }
  }
  connectToMaster(node) { node.connect(this.masterGain); }
}
export const engine = new AudioEngine();
