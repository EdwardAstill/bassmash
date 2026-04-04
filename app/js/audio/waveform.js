const _cache = new Map(); // url -> { points: Float32Array, audioBuf: AudioBuffer }

export async function loadWaveform(url, audioCtx) {
  if (_cache.has(url)) return _cache.get(url);
  const resp = await fetch(url);
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  const points = _downsample(audioBuf, 500);
  const entry = { points, audioBuf };
  _cache.set(url, entry);
  return entry;
}

export function getCached(url) {
  return _cache.get(url) || null;
}

export function clearCache() { _cache.clear(); }

function _downsample(audioBuffer, numPoints) {
  const data = audioBuffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / numPoints));
  const points = new Float32Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    let peak = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, data.length);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    points[i] = peak;
  }
  return points;
}
