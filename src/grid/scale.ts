/** A global key/scale quantization layer sitting above the existing
 * cell/row/column note cascade (see resolveCellConfig in config.ts) --
 * unlike everything in that cascade, this isn't per-row/column/cell state,
 * it's a single global constraint applied to whatever note the cascade
 * already resolved, right before it reaches a source's noteOn (see
 * GridModel.fireTick). Notes stay plain MIDI integers throughout (60 =
 * middle C), same as everywhere else in this app. */
export type ScaleType =
  | "chromatic"
  | "major"
  | "naturalMinor"
  | "harmonicMinor"
  | "dorian"
  | "majorPentatonic"
  | "minorPentatonic";

/** Semitone offsets from the root (0-11) that are "in scale" -- always
 * includes 0 (the root itself is always in its own scale). "chromatic"
 * includes every semitone, making it an identity/off state. */
export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

export const SCALE_LABELS: Record<ScaleType, string> = {
  chromatic: "Chromatic (off)",
  major: "Major",
  naturalMinor: "Natural minor",
  harmonicMinor: "Harmonic minor",
  dorian: "Dorian",
  majorPentatonic: "Major pentatonic",
  minorPentatonic: "Minor pentatonic",
};

/** Index = semitone offset from C (0-11), for the Key select. */
export const KEY_LABELS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** Snaps `note` to the nearest MIDI pitch in `scaleType` relative to
 * `root` (0-11, C=0) -- ties break toward the lower note. "chromatic" is
 * a no-op (every semitone is legal already). Searches a two-octave window
 * centered on `note`: every scale includes its own root pitch class,
 * which recurs every 12 semitones, so that window always contains a
 * match regardless of how far `note` is from `root` in absolute terms. */
export function quantizeToScale(
  note: number,
  root: number,
  scaleType: ScaleType,
): number {
  const intervals = SCALE_INTERVALS[scaleType];
  if (intervals.length === 12) return note;

  let best = note;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let candidate = note - 12; candidate <= note + 12; candidate++) {
    if (candidate < 0 || candidate > 127) continue;
    const semitone = (((candidate - root) % 12) + 12) % 12;
    if (!intervals.includes(semitone)) continue;
    const distance = Math.abs(candidate - note);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
