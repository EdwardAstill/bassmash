import { engine } from './engine.js';
import { EffectsChain } from './effects.js';

export class MixerChannel {
  constructor(name) {
    this.name = name; this.effects = new EffectsChain();
    this.gain = null; this.pan = null; this.muted = false; this.soloed = false; this._preMuteGain = 1;
  }
  init() {
    const ctx = engine.ctx;
    this.effects.init();
    this.gain = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.effects.output.connect(this.gain);
    this.gain.connect(this.pan);
    this.pan.connect(engine.masterGain);
    return this;
  }
  get input() { return this.effects.input; }
  setVolume(value) { this._preMuteGain = value; if (!this.muted) this.gain.gain.value = value; }
  setPan(value) { this.pan.pan.value = value; }
  setMute(muted) { this.muted = muted; this.gain.gain.value = muted ? 0 : this._preMuteGain; }
}

class Mixer {
  constructor() { this.channels = []; }
  createChannel(name) { const ch = new MixerChannel(name); ch.init(); this.channels.push(ch); return ch; }
  removeChannel(index) {
    const ch = this.channels.splice(index, 1)[0];
    if (ch) { ch.pan.disconnect(); ch.gain.disconnect(); ch.effects.output.disconnect(); }
  }
  setMasterVolume(value) { engine.masterGain.gain.value = value; }
  getMeterData() {
    const data = new Uint8Array(engine.analyser.frequencyBinCount);
    engine.analyser.getByteTimeDomainData(data);
    return data;
  }
  updateSoloState() {
    const anySoloed = this.channels.some(ch => ch.soloed);
    for (const ch of this.channels) {
      if (anySoloed) ch.gain.gain.value = ch.soloed ? ch._preMuteGain : 0;
      else ch.gain.gain.value = ch.muted ? 0 : ch._preMuteGain;
    }
  }
}
export const mixer = new Mixer();
