export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, width: rect.width, height: rect.height };
}

export function drawGrid(ctx, width, height, cellW, cellH, color, scrollX = 0, scrollY = 0) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  const startX = -(scrollX % cellW);
  for (let x = startX; x <= width; x += cellW) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  const startY = -(scrollY % cellH);
  for (let y = startY; y <= height; y += cellH) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
}

export function snap(value, gridSize) {
  return Math.round(value / gridSize) * gridSize;
}

export function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function midiToName(note) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  return names[note % 12] + octave;
}
