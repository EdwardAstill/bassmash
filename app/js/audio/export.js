import { engine } from './engine.js';
import { store } from '../state.js';
import { api } from '../api.js';

export async function exportMp3(renderCallback) {
  const bpm = store.data.bpm;
  const arrangement = store.data.arrangement;
  let maxEnd = 0;
  for (const clip of arrangement) {
    const clipEnd = (clip.startBeat + clip.lengthBeats) * (60 / bpm);
    if (clipEnd > maxEnd) maxEnd = clipEnd;
  }
  if (maxEnd === 0) maxEnd = 4 * (60 / bpm);
  const sampleRate = engine.sampleRate;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * maxEnd), sampleRate);
  await renderCallback(offlineCtx, maxEnd);
  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = audioBufferToWav(renderedBuffer);
  return api.exportMp3(store.projectName, wavBlob);
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const totalLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);
  writeString(view, 0, 'RIFF'); view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  writeString(view, 36, 'data'); view.setUint32(40, dataLength, true);
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample * 0x7FFF, true); offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
}
