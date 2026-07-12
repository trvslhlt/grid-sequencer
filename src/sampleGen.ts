/** Synthesizes a short percussive blip in-memory so the proof harness (and
 * later the real grid) has something to play without shipping a binary
 * sample asset. A decaying sine over a few dozen ms, close enough to a
 * plucked/mallet hit for exercising SamplePlayer's pitch/gate/trigger-mode
 * behavior. */
export function generateBlipBuffer(
  audioContext: BaseAudioContext,
  frequencyHz = 440,
  durationSeconds = 0.3,
): AudioBuffer {
  const length = Math.round(audioContext.sampleRate * durationSeconds);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / audioContext.sampleRate;
    const envelope = (1 - t / durationSeconds) ** 3;
    data[i] = Math.sin(2 * Math.PI * frequencyHz * t) * envelope;
  }
  return buffer;
}
