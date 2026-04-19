import { engine } from './engine.js';
import { api } from '../api.js';
import { store } from '../state.js';

class Sampler {
  constructor() { this._cache = new Map(); }
  async load(ref) {
    const url = api.sampleUrl(store.projectName, ref);
    if (this._cache.has(url)) return this._cache.get(url);
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await engine.ctx.decodeAudioData(arrayBuf);
    this._cache.set(url, audioBuf);
    return audioBuf;
  }
  async preloadProject() {
    const refs = new Set();
    for (const track of store.data.tracks) {
      if (track.type === 'sample' && track.sampleRef) refs.add(track.sampleRef);
    }
    for (const pattern of store.data.patterns || []) {
      for (const row of pattern.steps || []) {
        if (row.sampleRef) refs.add(row.sampleRef);
      }
    }
    await Promise.all([...refs].map(ref => this.load(ref)));
  }
  play(ref, time, destination, options = {}) {
    const url = api.sampleUrl(store.projectName, ref);
    const buffer = this._cache.get(url);
    if (!buffer) { console.warn(`Sample not loaded: ${ref}`); return null; }
    const source = engine.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop || false;
    source.playbackRate.setValueAtTime(options.playbackRate || 1, time);
    source.connect(destination);
    source.start(time);
    return source;
  }
  clearCache() { this._cache.clear(); }
}
export const sampler = new Sampler();
