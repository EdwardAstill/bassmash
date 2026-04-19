// Phase-4 P1 · Waveform peak decimation + caching
// Turns an AudioBuffer into an Nx2 Float32 array of [min, max] pairs,
// one pair per pixel column of a rendered clip. Peaks are computed in
// a single O(samples) stride pass and memoized by a composite key so
// repeat renders (same width / same clip range) are instant.
//
// The cache is keyed by (audioRef, widthPx, offsetSec, durationSec).
// Entries are naturally invalidated when the clip changes width or
// gets a new audioRef; audio buffers themselves are identity-keyed via
// the URL so a re-decoded buffer would still match so long as sample
// layout is stable. Memory is bounded by MAX_ENTRIES via LRU eviction.

const MAX_ENTRIES = 256; // ~256 clip widths/offsets combined
const _peakCache = new Map();

function cacheKey(audioRef, widthPx, offsetSec, durationSec) {
  // Bucket floats at 1e-3s so sub-ms drift doesn't break memo hits.
  const o = Math.round(offsetSec * 1000);
  const d = Math.round(durationSec * 1000);
  return `${audioRef}|${widthPx}|${o}|${d}`;
}

function touch(key, value) {
  // Simple LRU: re-insert to move to the end, evict oldest over cap.
  if (_peakCache.has(key)) _peakCache.delete(key);
  _peakCache.set(key, value);
  if (_peakCache.size > MAX_ENTRIES) {
    const oldestKey = _peakCache.keys().next().value;
    if (oldestKey !== undefined) _peakCache.delete(oldestKey);
  }
}

/**
 * Compute (or fetch cached) [min, max] peaks for a slice of an AudioBuffer.
 *
 * @param {AudioBuffer} buffer   — decoded buffer, source of truth for samples
 * @param {string} audioRef      — stable string id used for cache key
 * @param {number} widthPx       — number of peak columns to produce (>= 1)
 * @param {number} offsetSec     — start offset into the buffer, in seconds
 * @param {number} durationSec   — span to decimate, in seconds (null = to end)
 * @returns {Float32Array}       — interleaved [min0,max0,min1,max1,…] length 2*widthPx
 */
export function getPeaks(buffer, audioRef, widthPx, offsetSec = 0, durationSec = null) {
  if (!buffer || widthPx <= 0) return new Float32Array(0);
  const sr = buffer.sampleRate;
  const totalFrames = buffer.length;
  const offFrame = Math.max(0, Math.min(totalFrames, Math.floor((offsetSec || 0) * sr)));
  const endFrame = durationSec == null
    ? totalFrames
    : Math.max(offFrame, Math.min(totalFrames, Math.floor((offsetSec + durationSec) * sr)));
  const spanFrames = endFrame - offFrame;
  if (spanFrames <= 0) return new Float32Array(widthPx * 2);

  const key = cacheKey(audioRef, widthPx, offsetSec || 0, (durationSec == null ? (spanFrames / sr) : durationSec));
  const hit = _peakCache.get(key);
  if (hit) { touch(key, hit); return hit; }

  // Fold stereo → mono by taking channel-wise max(|L|,|R|) per sample.
  // We scan channel 0 and channel 1 in lockstep and drive min/max via
  // both (signed) so the visible waveform still swings above/below 0.
  const chCount = Math.min(2, buffer.numberOfChannels);
  const c0 = buffer.getChannelData(0);
  const c1 = chCount > 1 ? buffer.getChannelData(1) : null;

  const peaks = new Float32Array(widthPx * 2);
  // samplesPerPixel may be fractional — walk with a float stride accumulator
  // so we don't bias toward the left edge on short clips.
  const stride = spanFrames / widthPx;

  for (let x = 0; x < widthPx; x++) {
    const a = offFrame + Math.floor(x * stride);
    const b = offFrame + Math.floor((x + 1) * stride);
    const lo = a;
    const hi = Math.max(a + 1, Math.min(endFrame, b)); // ensure at least 1 sample
    let mn = Infinity;
    let mx = -Infinity;
    if (c1) {
      for (let i = lo; i < hi; i++) {
        const l = c0[i];
        const r = c1[i];
        // Keep the signed sample with the largest magnitude between channels
        // so sign info survives into the waveform shape.
        const s = Math.abs(l) >= Math.abs(r) ? l : r;
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
    } else {
      for (let i = lo; i < hi; i++) {
        const s = c0[i];
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
    }
    if (!isFinite(mn)) mn = 0;
    if (!isFinite(mx)) mx = 0;
    peaks[x * 2] = mn;
    peaks[x * 2 + 1] = mx;
  }

  touch(key, peaks);
  return peaks;
}

/**
 * Paint peaks onto a 2d canvas. Filled-poly mirror style: mid-line centered,
 * peaks extend up (max) and down (min). Uses devicePixelRatio for crisp
 * rendering on HiDPI displays.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} peaks     — output of getPeaks()
 * @param {object} [opts]
 * @param {string} [opts.color]    — fill color CSS string
 * @param {string} [opts.midline]  — optional midline stroke color
 */
export function drawPeaks(canvas, peaks, opts = {}) {
  const color = opts.color || 'rgba(0,0,0,0.55)';
  const midline = opts.midline || null;
  const dpr = window.devicePixelRatio || 1;

  const cssW = canvas.clientWidth || parseInt(canvas.style.width, 10) || canvas.width;
  const cssH = canvas.clientHeight || parseInt(canvas.style.height, 10) || canvas.height;
  if (cssW <= 0 || cssH <= 0) return;

  // Match backing store to CSS size * dpr so 1 CSS pixel == 1 peak column.
  const targetW = Math.max(1, Math.floor(cssW * dpr));
  const targetH = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== targetW)  canvas.width  = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const cols = Math.min(cssW, Math.floor(peaks.length / 2));
  if (cols <= 0) return;

  const mid = cssH / 2;
  const amp = cssH / 2;

  // Single path, one vertical line per column. Faster than fillRect()
  // per column and still renders a true "bar-style" waveform.
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let x = 0; x < cols; x++) {
    const mn = peaks[x * 2];
    const mx = peaks[x * 2 + 1];
    // Guarantee at least 1px tall so near-silent regions still show a seam.
    const y1 = mid - mx * amp;
    const y2 = mid - mn * amp;
    const top = Math.min(y1, y2);
    const bot = Math.max(y1, y2);
    const h = Math.max(1, bot - top);
    ctx.rect(x, top, 1, h);
  }
  ctx.fill();

  if (midline) {
    ctx.strokeStyle = midline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.floor(mid) + 0.5);
    ctx.lineTo(cssW, Math.floor(mid) + 0.5);
    ctx.stroke();
  }
}

export function clearPeakCache() { _peakCache.clear(); }
