import { engine } from './engine.js';
import { store } from '../state.js';

export class Synth {
  constructor() { this.voices = []; }
  playNote(frequency, time, duration, params, destination) {
    const ctx = engine.ctx;
    const p = Object.assign({
      waveform: 'sawtooth', filterType: 'lowpass', filterFreq: 2000, filterQ: 1,
      attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2,
      osc2Waveform: 'square', osc2Detune: 7,
      filterEnvAmount: 1000, filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.2,
      lfoRate: 4, lfoAmount: 0, lfoTarget: 'pitch',
    }, params);
    const endTime = time + duration;
    const releaseStart = endTime - p.release;
    const osc1 = ctx.createOscillator();
    osc1.type = p.waveform;
    osc1.frequency.setValueAtTime(frequency, time);
    const filter = ctx.createBiquadFilter();
    filter.type = p.filterType;
    filter.frequency.setValueAtTime(p.filterFreq, time);
    filter.Q.setValueAtTime(p.filterQ, time);
    const ampEnv = ctx.createGain();
    ampEnv.gain.setValueAtTime(0, time);
    ampEnv.gain.linearRampToValueAtTime(1, time + p.attack);
    ampEnv.gain.linearRampToValueAtTime(p.sustain, time + p.attack + p.decay);
    ampEnv.gain.setValueAtTime(p.sustain, releaseStart);
    ampEnv.gain.linearRampToValueAtTime(0, endTime);
    osc1.connect(filter);
    let osc2 = null;
    if (store.synthMode === 'advanced') {
      osc2 = ctx.createOscillator();
      osc2.type = p.osc2Waveform;
      osc2.frequency.setValueAtTime(frequency, time);
      osc2.detune.setValueAtTime(p.osc2Detune, time);
      osc2.connect(filter);
      filter.frequency.setValueAtTime(p.filterFreq, time);
      filter.frequency.linearRampToValueAtTime(p.filterFreq + p.filterEnvAmount, time + p.filterAttack);
      filter.frequency.linearRampToValueAtTime(p.filterFreq + p.filterEnvAmount * p.filterSustain, time + p.filterAttack + p.filterDecay);
      filter.frequency.linearRampToValueAtTime(p.filterFreq, endTime);
      if (p.lfoAmount > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.setValueAtTime(p.lfoRate, time);
        const lfoGain = ctx.createGain();
        lfoGain.gain.setValueAtTime(p.lfoAmount, time);
        lfo.connect(lfoGain);
        if (p.lfoTarget === 'pitch') { lfoGain.connect(osc1.frequency); lfoGain.connect(osc2.frequency); }
        else if (p.lfoTarget === 'filter') { lfoGain.connect(filter.frequency); }
        else if (p.lfoTarget === 'amplitude') { lfoGain.connect(ampEnv.gain); }
        lfo.start(time); lfo.stop(endTime);
      }
      osc2.start(time); osc2.stop(endTime);
    }
    filter.connect(ampEnv);
    ampEnv.connect(destination);
    osc1.start(time); osc1.stop(endTime);
  }
}
