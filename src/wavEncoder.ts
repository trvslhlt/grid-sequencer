/** mono, 16-bit PCM -- matches every audio source and the master bus in
 * this app, which all stay mono throughout (see generateBlipBuffer's own
 * single-channel buffer). AudioBuffer has no native Blob export, so this
 * is the whole reason a hand-rolled encoder is needed at all -- ported
 * from docker_collab's frontend, which solved the identical problem for
 * both its sample uploads and its own "record the app's output" feature.
 * Shared by patchApi.ts (sample upload) and main.ts (recording download)
 * rather than living in either one specifically. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channelData = buffer.getChannelData(0);
  const dataSize = channelData.length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, text: string): void {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < channelData.length; i++) {
    const clamped = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}
