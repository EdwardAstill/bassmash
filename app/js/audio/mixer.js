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
  /** Post-fader, post-pan send tap. Sends branch off .pan so volume + pan shape the send. */
  get sendTap() { return this.pan; }
  setVolume(value) { this._preMuteGain = value; if (!this.muted) this.gain.gain.value = value; }
  setPan(value) { this.pan.pan.value = value; }
  setMute(muted) { this.muted = muted; this.gain.gain.value = muted ? 0 : this._preMuteGain; }
}

// Bus count + fixed effect config for the default two buses (A = reverb, B = delay).
// Kept here (not in the UI zone) so the audio graph owns the buses and anyone
// who imports `mixer` — scheduler, offline-render, inspector — can reach them.
const BUS_NAMES = ['BUS A · Reverb', 'BUS B · Delay'];
export const BUS_COUNT = BUS_NAMES.length;

class Mixer {
  constructor() {
    this.channels = [];
    this.buses = [];
    // sends[srcIdx] = Map<busIdx, GainNode>. Sparse by design — only
    // enabled sends carry entries so disconnectSend can drop the node.
    this._sends = [];
  }
  createChannel(name) { const ch = new MixerChannel(name); ch.init(); this.channels.push(ch); return ch; }
  insertChannel(index, name) {
    const ch = new MixerChannel(name); ch.init();
    this.channels.splice(index, 0, ch);
    // Shift any existing per-track send maps to keep indices aligned.
    this._sends.splice(index, 0, null);
    return ch;
  }
  removeChannel(index) {
    // Tear down any sends rooted at this channel before we drop the nodes.
    this._teardownSendsFor(index);
    this._sends.splice(index, 1);
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

  // ── Bus lifecycle ────────────────────────────────────────────────
  /**
   * Lazily create the fixed reverb + delay buses. Safe to call more than once.
   * Buses live outside `channels[]` so track-solo + rebuild logic ignores them.
   */
  ensureBuses() {
    if (!engine.ctx) return;
    for (let i = this.buses.length; i < BUS_COUNT; i++) {
      const bus = new MixerChannel(BUS_NAMES[i]); bus.init();
      // Bake each bus's signature effect on by default. Users can still
      // toggle the wet amount via the bus strip's FX UI if we wire it.
      if (i === 0 && bus.effects?.setReverbMix) {
        bus.effects.setReverbMix(1);
        if (bus.effects.reverb) bus.effects.reverb.enabled = true;
      }
      if (i === 1 && bus.effects?.setDelayMix) {
        bus.effects.setDelayMix(0.5);
        if (bus.effects.delay) bus.effects.delay.enabled = true;
      }
      this.buses.push(bus);
    }
    return this.buses;
  }

  // ── Sends ────────────────────────────────────────────────────────
  /**
   * Wire a post-fader send from channel `srcIdx` into bus `busIdx` at `gain`.
   * Signal path: channel.pan -> sendGain -> bus.input (bus FX -> master).
   * If a send already exists between the pair we just update its gain.
   */
  connectSend(srcIdx, busIdx, gain = 1.0) {
    this.ensureBuses();
    const src = this.channels[srcIdx];
    const bus = this.buses[busIdx];
    if (!src || !bus) return null;
    let map = this._sends[srcIdx];
    if (!map) { map = new Map(); this._sends[srcIdx] = map; }
    const existing = map.get(busIdx);
    if (existing) { existing.gain.value = gain; return existing; }
    const g = engine.ctx.createGain();
    g.gain.value = gain;
    try {
      src.sendTap.connect(g);
      g.connect(bus.input);
    } catch (err) {
      console.warn('[mixer] connectSend failed', { srcIdx, busIdx, err });
      try { g.disconnect(); } catch (_) {}
      return null;
    }
    map.set(busIdx, g);
    return g;
  }

  disconnectSend(srcIdx, busIdx) {
    const map = this._sends[srcIdx];
    if (!map) return false;
    const g = map.get(busIdx);
    if (!g) return false;
    try { g.disconnect(); } catch (_) {}
    map.delete(busIdx);
    if (map.size === 0) this._sends[srcIdx] = null;
    return true;
  }

  setSendGain(srcIdx, busIdx, gain) {
    const map = this._sends[srcIdx];
    const g = map && map.get(busIdx);
    if (!g) return false;
    g.gain.value = gain;
    return true;
  }

  getSendGain(srcIdx, busIdx) {
    const map = this._sends[srcIdx];
    const g = map && map.get(busIdx);
    return g ? g.gain.value : null;
  }

  /**
   * Cancel scheduled AudioParam values on a channel's gain after the given
   * time and pin the current value there. Used by the UI when the user
   * grabs a fader mid-automation — lets the drag take control back without
   * waiting for the next scheduler tick to clobber their value.
   */
  cancelAutomationAfter(channelIdx, time) {
    const ch = this.channels[channelIdx];
    if (!ch || !ch.gain) return false;
    const param = ch.gain.gain;
    try {
      const cur = param.value;
      param.cancelScheduledValues(time);
      param.setValueAtTime(cur, time);
    } catch (_) { return false; }
    return true;
  }

  hasSend(srcIdx, busIdx) {
    const map = this._sends[srcIdx];
    return !!(map && map.get(busIdx));
  }

  _teardownSendsFor(srcIdx) {
    const map = this._sends[srcIdx];
    if (!map) return;
    for (const g of map.values()) { try { g.disconnect(); } catch (_) {} }
    map.clear();
  }
}
export const mixer = new Mixer();
