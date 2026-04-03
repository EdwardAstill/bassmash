import { engine } from './engine.js';

export class EffectsChain {
  constructor() {
    this.input = null; this.output = null;
    this.eq = null; this.distortion = null; this.delay = null; this.reverb = null;
  }
  init() {
    const ctx = engine.ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    const eqLow = ctx.createBiquadFilter(); eqLow.type = 'lowshelf'; eqLow.frequency.value = 200;
    const eqMid = ctx.createBiquadFilter(); eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 1;
    const eqHigh = ctx.createBiquadFilter(); eqHigh.type = 'highshelf'; eqHigh.frequency.value = 4000;
    this.eq = { low: eqLow, mid: eqMid, high: eqHigh, enabled: false };
    const distCurve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; distCurve[i] = (Math.PI + 20) * x / (Math.PI + 20 * Math.abs(x)); }
    const distShaper = ctx.createWaveShaper(); distShaper.curve = distCurve; distShaper.oversample = '2x';
    const distDry = ctx.createGain(); distDry.gain.value = 1;
    const distWet = ctx.createGain(); distWet.gain.value = 0;
    this.distortion = { shaper: distShaper, dry: distDry, wet: distWet, enabled: false };
    const delayNode = ctx.createDelay(2.0); delayNode.delayTime.value = 0.375;
    const delayFeedback = ctx.createGain(); delayFeedback.gain.value = 0.4;
    const delayDry = ctx.createGain(); delayDry.gain.value = 1;
    const delayWet = ctx.createGain(); delayWet.gain.value = 0;
    delayNode.connect(delayFeedback); delayFeedback.connect(delayNode);
    this.delay = { node: delayNode, feedback: delayFeedback, dry: delayDry, wet: delayWet, enabled: false };
    const convolver = ctx.createConvolver();
    const reverbDry = ctx.createGain(); reverbDry.gain.value = 1;
    const reverbWet = ctx.createGain(); reverbWet.gain.value = 0;
    this.reverb = { convolver, dry: reverbDry, wet: reverbWet, enabled: false,
      setImpulse(buffer) { convolver.buffer = buffer; } };
    // Wire: input -> EQ -> dist split -> delay split -> reverb split -> output
    this.input.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
    const postEq = eqHigh;
    postEq.connect(distDry); postEq.connect(distShaper); distShaper.connect(distWet);
    const distMerge = ctx.createGain(); distDry.connect(distMerge); distWet.connect(distMerge);
    distMerge.connect(delayDry); distMerge.connect(delayNode); delayNode.connect(delayWet);
    const delayMerge = ctx.createGain(); delayDry.connect(delayMerge); delayWet.connect(delayMerge);
    delayMerge.connect(reverbDry); delayMerge.connect(convolver); convolver.connect(reverbWet);
    reverbDry.connect(this.output); reverbWet.connect(this.output);
    this._generateDefaultIR();
    return this;
  }
  _generateDefaultIR() {
    const ctx = engine.ctx;
    const length = ctx.sampleRate * 1.5;
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.4));
    }
    this.reverb.convolver.buffer = ir;
  }
  setDistortionMix(wet) { this.distortion.dry.gain.value = 1 - wet; this.distortion.wet.gain.value = wet; }
  setDelayMix(wet) { this.delay.dry.gain.value = 1 - wet; this.delay.wet.gain.value = wet; }
  setReverbMix(wet) { this.reverb.dry.gain.value = 1 - wet; this.reverb.wet.gain.value = wet; }
  setDelayTime(seconds) { this.delay.node.delayTime.value = seconds; }
  setDelayFeedback(value) { this.delay.feedback.gain.value = value; }
  setEQ(band, gain) { this.eq[band].gain.value = gain; }
}
