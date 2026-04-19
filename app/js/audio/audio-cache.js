// Phase 3b · Shared audio-buffer cache
// Keyed by URL so scheduler and arrangement agree on a single decoded copy.
// Stores the in-flight decode Promise plus a parallel map of resolved
// AudioBuffers so callers inside the beat loop can do a cheap sync lookup
// without awaiting.

const _cache = new Map();     // url -> Promise<AudioBuffer>
const _resolved = new Map();  // url -> AudioBuffer (settled buffers only)

export const audioCache = {
  /**
   * Kick off (or join) a decode for `url`. Always returns the same promise
   * for a given url so repeat calls are cheap.
   */
  async load(url, engine) {
    if (!engine?.ctx) throw new Error('no audio ctx');
    if (_cache.has(url)) return _cache.get(url);
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed ${r.status} ${url}`);
        return r.arrayBuffer();
      })
      .then((b) => engine.ctx.decodeAudioData(b));
    // Track resolution so getSync() can hand back the buffer from the hot path.
    p.then(
      (buf) => { _resolved.set(url, buf); },
      (err) => {
        // Drop the failed promise so a later load() can retry.
        _cache.delete(url);
        console.warn('[audio-cache] decode failed', url, err);
      }
    );
    _cache.set(url, p);
    return p;
  },

  /** Returns the in-flight or settled Promise (or undefined). */
  get(url) { return _cache.get(url); },

  /** Returns the resolved AudioBuffer, or null if not yet decoded. */
  getSync(url) { return _resolved.get(url) || null; },

  /**
   * Evict. `clear()` with no argument nukes the whole cache (used on
   * project swap). `clear(url)` evicts a single entry so a stale decode
   * doesn't linger after the underlying file has been renamed/deleted.
   */
  clear(url) {
    if (url == null) {
      _cache.clear();
      _resolved.clear();
    } else {
      _cache.delete(url);
      _resolved.delete(url);
    }
  },
};
