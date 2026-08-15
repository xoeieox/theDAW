/**
 * encodeWav — interleave an AudioBuffer to a 16-bit PCM WAV Blob.
 *
 * Shared by the editor mixdown/bounce paths and the Metamorph "send to editor"
 * render, so the same encoder produces every clip that lands on the timeline.
 *
 * encodeWavFloat32 — the 32-bit IEEE-float sibling for the repaint round-trip:
 * the operating table repaints the same material repeatedly, and a 16-bit
 * encode on every submit would quantise the untouched audio once per pass.
 */
export function encodeWav(audioBuf: AudioBuffer): Blob {
  const numCh = audioBuf.numberOfChannels;
  const sr = audioBuf.sampleRate;
  const len = audioBuf.length;
  const buffer = new ArrayBuffer(44 + len * numCh * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len * numCh * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, len * numCh * 2, true);
  // Interleave + 16-bit PCM.
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c += 1) channels.push(audioBuf.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < len; i += 1) {
    for (let c = 0; c < numCh; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Interleave an AudioBuffer to a 32-bit IEEE-float WAV Blob (format 3) —
 *  lossless for Web Audio's native float32 samples. */
export function encodeWavFloat32(audioBuf: AudioBuffer): Blob {
  const numCh = audioBuf.numberOfChannels;
  const sr = audioBuf.sampleRate;
  const len = audioBuf.length;
  const bytesPerFrame = numCh * 4;
  const buffer = new ArrayBuffer(44 + len * bytesPerFrame);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len * bytesPerFrame, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);          // IEEE float
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 32, true);
  writeStr(36, 'data');
  view.setUint32(40, len * bytesPerFrame, true);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c += 1) channels.push(audioBuf.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < len; i += 1) {
    for (let c = 0; c < numCh; c += 1) {
      view.setFloat32(offset, channels[c][i], true);
      offset += 4;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
