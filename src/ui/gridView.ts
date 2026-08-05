import type { EffectSpec, EffectType, EnvelopeParams } from "../grid/config";
import type { EffectLiveTarget, GridModel, Row } from "../grid/gridModel";
import { SOURCE_TYPE_LABELS, type SourceType } from "../grid/sourceFactory";
import {
  TRIGGER_MODE_LABELS,
  type TriggerModeKind,
} from "../grid/triggerModes";
import { type Field, renderFields } from "./fields";

interface EffectRangeParamSpec {
  key: string;
  label: string;
  kind: "range";
  min: number;
  max: number;
  step: number;
  default: number;
  /** `default`/the stored value are in the underlying effect class's own
   * native unit (e.g. compressor attack/release are seconds, the
   * DynamicsCompressorNode's own unit) -- `min`/`max`/`step` above are
   * already authored in whatever unit is actually UI-friendly (e.g.
   * milliseconds), so only the value itself needs converting: displayed
   * as `stored * scale`, written back as `display / scale`. Omitted (1)
   * for every param whose native unit is already UI-friendly. */
  scale?: number;
  /** Absolute ceiling a per-instance custom range (EffectSpec.paramRanges,
   * edited via this param's own clickable label -- see
   * openParamRangeModal) can never exceed -- only set here when a param
   * has a genuine constraint beyond "this was a comfortable slider
   * default" (see hardBoundFor's generic fallback for every param that
   * omits this). */
  hardMin?: number;
  hardMax?: number;
}

interface EffectSelectParamSpec {
  key: string;
  label: string;
  kind: "select";
  options: string[];
  default: string;
}

type EffectParamSpec = EffectRangeParamSpec | EffectSelectParamSpec;

/** Every persistent-chain effect type this UI exposes, and *all* of each
 * one's params -- not just the single headline param each used to get
 * (see effectsChain.ts's `instantiateEffect` and bruit-kit's individual
 * effect classes for the full param lists this mirrors). `wet` (dry/wet
 * mix) is included for every type: previously fixed at instantiation time
 * (1 for most, 0.35 for delay -- see the comment on delay's entry below)
 * and never user-adjustable at all. */
const EFFECT_TABLE: Array<{
  type: EffectType;
  label: string;
  params: EffectParamSpec[];
}> = [
  {
    type: "filter",
    label: "Filter",
    params: [
      {
        key: "type",
        label: "Filter type",
        kind: "select",
        options: [
          "lowpass",
          "highpass",
          "bandpass",
          "lowshelf",
          "highshelf",
          "peaking",
          "notch",
          "allpass",
        ],
        default: "lowpass",
      },
      {
        key: "frequency",
        label: "Cutoff (Hz)",
        kind: "range",
        min: 200,
        max: 8000,
        step: 50,
        default: 8000,
      },
      {
        key: "q",
        label: "Resonance (Q)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 0.7,
      },
      // Only audible for lowshelf/highshelf/peaking -- BiquadFilterNode
      // ignores it for every other type -- but shown unconditionally like
      // every other param here (see effectsFields' own doc: nothing
      // conditionally shows/hides based on another field's value).
      {
        key: "gain",
        label: "Gain (dB, shelf/peaking only)",
        kind: "range",
        min: -40,
        max: 40,
        step: 1,
        default: 0,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "gain",
    label: "Gain",
    params: [
      {
        key: "gainDb",
        label: "Gain (dB)",
        kind: "range",
        min: -24,
        max: 24,
        step: 0.5,
        default: 0,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "distortion",
    label: "Distortion",
    params: [
      {
        key: "amount",
        label: "Amount",
        kind: "range",
        min: 0,
        max: 100,
        step: 1,
        default: 20,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "delay",
    label: "Delay",
    params: [
      {
        key: "delayMs",
        label: "Time (ms)",
        kind: "range",
        min: 10,
        max: 1000,
        step: 10,
        default: 180,
      },
      {
        key: "feedback",
        label: "Feedback",
        kind: "range",
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.35,
      },
      // Not default 1 like the others -- see effectsChain.ts's
      // instantiateEffect for why full-wet is actually broken for delay
      // specifically (a short/percussive note can go fully silent until
      // an echo that may never arrive).
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.35,
      },
    ],
  },
  {
    type: "compressor",
    label: "Compressor",
    params: [
      {
        key: "threshold",
        label: "Threshold (dB)",
        kind: "range",
        min: -60,
        max: 0,
        step: 1,
        default: -24,
      },
      {
        key: "knee",
        label: "Knee (dB)",
        kind: "range",
        min: 0,
        max: 40,
        step: 1,
        default: 30,
      },
      {
        key: "ratio",
        label: "Ratio",
        kind: "range",
        min: 1,
        max: 20,
        step: 0.5,
        default: 12,
      },
      {
        key: "attack",
        label: "Attack (ms)",
        kind: "range",
        min: 0,
        max: 200,
        step: 1,
        default: 0.003,
        scale: 1000,
      },
      {
        key: "release",
        label: "Release (ms)",
        kind: "range",
        min: 0,
        max: 1000,
        step: 5,
        default: 0.25,
        scale: 1000,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "tremolo",
    label: "Tremolo",
    params: [
      {
        key: "rate",
        label: "Rate (Hz)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 5,
      },
      {
        key: "depth",
        label: "Depth",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "waveform",
        label: "LFO shape",
        kind: "select",
        options: ["sine", "square", "sawtooth", "triangle"],
        default: "sine",
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "ringMod",
    label: "Ring Mod",
    params: [
      {
        key: "frequency",
        label: "Frequency (Hz)",
        kind: "range",
        min: 1,
        max: 2000,
        step: 1,
        default: 30,
      },
      {
        key: "waveform",
        label: "Carrier shape",
        kind: "select",
        options: ["sine", "square", "sawtooth", "triangle"],
        default: "sine",
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "chorus",
    label: "Chorus",
    params: [
      {
        key: "rate",
        label: "Rate (Hz)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 0.8,
      },
      {
        key: "depth",
        label: "Depth (ms)",
        kind: "range",
        min: 0,
        max: 20,
        step: 0.5,
        default: 3,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "flanger",
    label: "Flanger",
    params: [
      {
        key: "rate",
        label: "Rate (Hz)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 0.25,
      },
      {
        key: "depth",
        label: "Depth (ms)",
        kind: "range",
        min: 0,
        max: 5,
        step: 0.1,
        default: 2,
      },
      {
        key: "feedback",
        label: "Feedback",
        kind: "range",
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "phaser",
    label: "Phaser",
    params: [
      {
        key: "rate",
        label: "Rate (Hz)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 0.3,
      },
      {
        key: "depth",
        label: "Depth",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "feedback",
        label: "Feedback",
        kind: "range",
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.3,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "autoWah",
    label: "Auto-Wah",
    params: [
      {
        key: "baseFrequency",
        label: "Base frequency (Hz)",
        kind: "range",
        min: 100,
        max: 3000,
        step: 10,
        default: 500,
      },
      {
        key: "q",
        label: "Resonance (Q)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 6,
      },
      {
        key: "sensitivity",
        label: "Sensitivity",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "attackHz",
        label: "Attack speed (Hz)",
        kind: "range",
        min: 1,
        max: 50,
        step: 1,
        default: 15,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "bitcrusher",
    label: "Bitcrusher",
    params: [
      {
        key: "bits",
        label: "Bit depth",
        kind: "range",
        min: 1,
        max: 16,
        step: 1,
        default: 6,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "reverb",
    label: "Reverb",
    params: [
      {
        key: "decaySeconds",
        label: "Decay (s)",
        kind: "range",
        min: 0.1,
        max: 8,
        step: 0.1,
        default: 2.2,
      },
      {
        key: "preDelayMs",
        label: "Pre-delay (ms)",
        kind: "range",
        min: 0,
        max: 200,
        step: 1,
        default: 20,
      },
      {
        key: "dampingHz",
        label: "Damping (Hz)",
        kind: "range",
        min: 500,
        max: 12000,
        step: 100,
        default: 6000,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "pitchShift",
    label: "Pitch shift",
    params: [
      {
        key: "octave",
        label: "Octave",
        kind: "range",
        min: -2,
        max: 2,
        step: 1,
        default: 0,
        hardMin: -4,
        hardMax: 4,
      },
      {
        key: "semitones",
        label: "Semitones",
        kind: "range",
        min: -12,
        max: 12,
        step: 1,
        default: 0,
        hardMin: -24,
        hardMax: 24,
      },
      {
        key: "cents",
        label: "Cents",
        kind: "range",
        min: -50,
        max: 50,
        step: 1,
        default: 0,
        // A full semitone is 100 cents -- beyond that, "fine tune" is just
        // a worse-labeled semitone shift, so this stays capped there even
        // as a custom range rather than sharing the generic 3x-widened
        // fallback every other param without an explicit hard bound gets.
        hardMin: -100,
        hardMax: 100,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "softClip",
    label: "Soft Clip",
    params: [
      {
        key: "drive",
        label: "Drive",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 3,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "hardClip",
    label: "Hard Clip",
    params: [
      {
        key: "threshold",
        label: "Threshold",
        kind: "range",
        min: 0.01,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "overdrive",
    label: "Overdrive",
    params: [
      {
        key: "drive",
        label: "Drive",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 5,
      },
      {
        key: "asymmetry",
        label: "Asymmetry",
        kind: "range",
        min: -1,
        max: 1,
        step: 0.01,
        default: 0.3,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "waveFolder",
    label: "Wave Folder",
    params: [
      {
        key: "fold",
        label: "Fold",
        kind: "range",
        min: 0.1,
        max: 15,
        step: 0.1,
        default: 3,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "fuzz",
    label: "Fuzz",
    params: [
      {
        key: "drive",
        label: "Drive",
        kind: "range",
        min: 0.1,
        max: 30,
        step: 0.1,
        default: 10,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "foldbackDistortion",
    label: "Foldback Distortion",
    params: [
      {
        key: "threshold",
        label: "Threshold",
        kind: "range",
        min: 0.02,
        max: 1,
        step: 0.01,
        default: 0.5,
        // Matches the effect's own internal clamp (see
        // foldbackDistortionEffect.ts's makeFoldbackCurve) -- below 0.02
        // the reflection math degenerates, not just "an extreme setting."
        hardMin: 0.02,
        hardMax: 1,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "rectifier",
    label: "Rectifier",
    params: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: ["full", "half"],
        default: "full",
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "tapeSaturation",
    label: "Tape Saturation",
    params: [
      {
        key: "warmth",
        label: "Warmth",
        kind: "range",
        min: 0,
        max: 3,
        step: 0.05,
        default: 1,
      },
      {
        key: "tone",
        label: "Tone",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.7,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "sampleRateReducer",
    label: "Sample Rate Reducer",
    params: [
      {
        key: "holdSamples",
        label: "Hold (samples)",
        kind: "range",
        min: 1,
        max: 32,
        step: 1,
        default: 4,
        hardMin: 1,
        hardMax: 128,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "parametricWaveshaper",
    label: "Parametric Waveshaper",
    params: [
      {
        key: "pointAtNegOne",
        label: "Point @ -1",
        kind: "range",
        min: -1,
        max: 1,
        step: 0.01,
        default: -1,
      },
      {
        key: "pointAtNegHalf",
        label: "Point @ -0.5",
        kind: "range",
        min: -1,
        max: 1,
        step: 0.01,
        default: -0.5,
      },
      {
        key: "pointAtZero",
        label: "Point @ 0",
        kind: "range",
        min: -1,
        max: 1,
        step: 0.01,
        default: 0,
      },
      {
        key: "pointAtHalf",
        label: "Point @ 0.5",
        kind: "range",
        min: -1,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "pointAtOne",
        label: "Point @ 1",
        kind: "range",
        min: -1,
        max: 1,
        step: 0.01,
        default: 1,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
];

/** The absolute min/max a per-instance custom range (EffectSpec.
 * paramRanges) can never exceed, regardless of what the user sets --
 * "there should still be limits" (see config.ts's EffectSpec doc). Two
 * named special cases with a genuine constraint behind them, then a
 * generic fallback for every other param, whose default min/max was
 * always just a comfortable slider range rather than a physical limit:
 * - `wet`: every effect's dry/wet crossfade is a 0..1 ratio by
 *   definition (see bruit-kit's createDryWet) -- never anything else.
 * - `feedback`: must stay under 1 or a delay/flanger/chorus's feedback
 *   loop runs away into unbounded self-oscillation instead of decaying.
 * - everything else: widened 3x outward from the table's own default
 *   span, floored at 0 for params whose default range never goes
 *   negative (Hz, ms, seconds, counts) -- generous enough to "flex
 *   beyond arbitrary hardcoded limits" without being unbounded.
 */
function hardBoundFor(param: EffectRangeParamSpec): {
  min: number;
  max: number;
} {
  if (param.hardMin !== undefined && param.hardMax !== undefined) {
    return { min: param.hardMin, max: param.hardMax };
  }
  if (param.key === "wet") return { min: 0, max: 1 };
  if (param.key === "feedback") return { min: 0, max: 0.98 };
  const span = param.max - param.min;
  const hardMin = param.min - span;
  return {
    min: param.min >= 0 ? Math.max(0, hardMin) : hardMin,
    max: param.max + span,
  };
}

/** The range currently in effect for one param of one effect instance --
 * `spec.paramRanges[key]` if the user has customized it, otherwise the
 * table's own default `{min, max}`. */
function activeRangeFor(
  spec: EffectSpec,
  param: EffectRangeParamSpec,
): { min: number; max: number } {
  return spec.paramRanges?.[param.key] ?? { min: param.min, max: param.max };
}

// Shared across every effectsFields call (row/cell/master alike) rather
// than scoped per-chain -- effectsFields is a plain module-level function
// called fresh from 3 different places, with no closure of its own that
// would survive across renders the way rowPanel's per-row Maps used to.
// A single "what to add next" pick leaking between panels is a harmless
// cosmetic quirk (a freshly-opened panel might show the last-picked type
// pre-selected instead of the first one) worth accepting for how much
// simpler it keeps this over threading a unique key through every caller.
let pendingEffectType: EffectType = EFFECT_TABLE[0].type;

/** A small popup (min/max for exactly one param) opened by clicking that
 * param's own label -- see fields.ts's onLabelClick/labelCustomized on
 * the "range" field kind. Appended straight to document.body, outside
 * whatever panel container the caller re-renders on every edit (see
 * effectsFields' own doc on why every handler re-reads getEffects()
 * fresh): a commit here triggers that outer re-render same as any other
 * effectsFields edit, but this popup's own DOM isn't part of that
 * container, so it needs its own local re-render (renderBody) to reflect
 * the just-committed, possibly-hard-bound-clamped values instead of just
 * whatever was last typed. */
function openParamRangeModal(
  label: string,
  getActive: () => { min: number; max: number },
  hard: { min: number; max: number },
  step: number,
  onCommit: (min: number, max: number) => void,
  onReset: () => void,
  // Only present for a param that has a persistent chain to nudge live
  // (row/master/send-bus, not a per-cell override -- see effectsFields'
  // own driftTarget doc). Drift wanders within whatever range this same
  // modal edits, so it lives in this popup rather than a separate control.
  // Speed is per-param (see EffectSpec.drift's own doc on why), shown
  // only while Drift itself is checked -- meaningless otherwise, and
  // this is a self-contained popup rather than the main panel, so a
  // field that appears/disappears with a sibling checkbox here doesn't
  // run into the "never conditionally hide a field" rule that applies to
  // the always-visible panel body.
  drift?: {
    enabled: () => boolean;
    onToggle: (enabled: boolean) => void;
    speed: () => number;
    onSpeedChange: (speed: number) => void;
  },
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal param-range-modal";
  overlay.appendChild(modal);

  function close(): void {
    overlay.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("span");
  title.className = "modal-title";
  title.textContent = `${label} — range`;
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.className = "modal-close-button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  function renderBody(): void {
    const active = getActive();
    renderFields(body, [
      {
        key: "range-min",
        label: "Min",
        kind: "number",
        value: active.min,
        min: hard.min,
        max: hard.max,
        step,
        onChange: (v) => {
          onCommit(v, getActive().max);
          renderBody();
        },
      },
      {
        key: "range-max",
        label: "Max",
        kind: "number",
        value: active.max,
        min: hard.min,
        max: hard.max,
        step,
        onChange: (v) => {
          onCommit(getActive().min, v);
          renderBody();
        },
      },
      ...(drift
        ? [
            {
              key: "drift-enabled",
              label: "Drift within this range",
              kind: "checkbox" as const,
              value: drift.enabled(),
              onChange: (v: boolean) => {
                drift.onToggle(v);
                renderBody();
              },
            },
            ...(drift.enabled()
              ? [
                  {
                    key: "drift-speed",
                    label: "Speed",
                    kind: "range" as const,
                    value: drift.speed(),
                    min: 0,
                    max: 1,
                    step: 0.01,
                    onChange: (v: number) => drift.onSpeedChange(v),
                  },
                ]
              : []),
          ]
        : []),
    ]);
  }
  renderBody();

  const footer = document.createElement("div");
  footer.className = "modal-footer";
  const resetButton = document.createElement("button");
  resetButton.textContent = "Reset to default";
  resetButton.addEventListener("click", () => {
    onReset();
    renderBody();
  });
  footer.appendChild(resetButton);
  modal.appendChild(footer);

  document.body.appendChild(overlay);
}

/** The "+" cell's own popup (see render()'s grid-corner-column cell
 * appended right after the last row) -- collects a source type + name
 * for a new row, same two fields the old always-visible add-row form
 * used to keep permanently on screen below the grid. */
function openAddRowModal(
  onAdd: (sourceType: SourceType, name: string) => void,
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal param-range-modal";
  overlay.appendChild(modal);

  function close(): void {
    overlay.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("span");
  title.className = "modal-title";
  title.textContent = "Add row";
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.className = "modal-close-button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  const sourceTypes = Object.keys(SOURCE_TYPE_LABELS) as SourceType[];
  let sourceType: SourceType = sourceTypes[0];
  let name = "";

  renderFields(body, [
    {
      key: "sourceType",
      label: "Type",
      kind: "select",
      value: sourceType,
      options: sourceTypes.map((type) => ({
        value: type,
        label: SOURCE_TYPE_LABELS[type],
      })),
      onChange: (v) => {
        sourceType = v as SourceType;
      },
    },
    {
      key: "name",
      label: "Name",
      kind: "text",
      value: name,
      onChange: (v) => {
        name = v;
      },
    },
  ]);

  const footer = document.createElement("div");
  footer.className = "modal-footer";
  const addButton = document.createElement("button");
  addButton.textContent = "Add";
  addButton.addEventListener("click", () => {
    onAdd(sourceType, name.trim() || SOURCE_TYPE_LABELS[sourceType]);
    close();
  });
  footer.appendChild(addButton);
  modal.appendChild(footer);

  document.body.appendChild(overlay);
}

/** A chain is a plain ordered list now, not six fixed on/off slots: each
 * entry already in `getEffects()` renders as its own removable block (a
 * "Remove" button doubling as that instance's own heading, same
 * "no separate label needed" reasoning the old checkbox-as-heading had),
 * followed by "+ Add effect" (append a fresh default instance of the
 * chosen type -- nothing stops the same type being added twice, unlike
 * before) and, once there's anything to save, "Save chain as preset...".
 *
 * `getEffects` is called fresh inside every handler, not just once up
 * front: none of this panel's continuous controls trigger a rebuild on
 * their own "input" events (see fields.ts's top comment for why), so a
 * remove followed by a value drag with no render in between would
 * otherwise have the value handler still closing over the pre-removal
 * array and silently undoing the removal when it fires. */
export function effectsFields(
  getEffects: () => EffectSpec[],
  onUpdate: (next: EffectSpec[]) => void,
  onSaveAsPreset?: (effects: EffectSpec[], name: string) => void,
  // Only set by callers backed by one of the three persistent chains
  // (row/master/send-bus) -- see gridModel.ts's EffectLiveTarget. Omitted
  // for a cell's own effects override, which has no persistent chain to
  // nudge (a fresh one-shot instance per hit, see
  // fireSamplePlayerOverride), so no Drift control is offered there.
  driftTarget?: EffectLiveTarget,
): Field[] {
  const effects = getEffects();
  const fields: Field[] = [];

  // Swaps effect `from` with whichever neighbor is at `to`, a no-op past
  // either end of the chain -- shared by every instance's ▲/▼ buttons
  // below rather than redefined per iteration.
  function moveEffect(from: number, to: number): void {
    const current = getEffects();
    if (to < 0 || to >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onUpdate(next);
  }

  effects.forEach((spec, index) => {
    const table = EFFECT_TABLE.find((e) => e.type === spec.type);
    if (!table) return;
    // ▲/▼ reorder this instance within the chain (disabled at either
    // end), "Remove" deletes it -- doubles as this instance's own
    // heading (table.label as the row's label) the same way the old
    // lone "Remove" button used to, just with two more compact controls
    // alongside it instead of a second full-width button each.
    fields.push({
      key: `${index}-header`,
      label: table.label,
      kind: "buttonRow",
      buttons: [
        {
          label: "▲",
          disabled: index === 0,
          onClick: () => moveEffect(index, index - 1),
        },
        {
          label: "▼",
          disabled: index === effects.length - 1,
          onClick: () => moveEffect(index, index + 1),
        },
        {
          label: "Remove",
          onClick: () => {
            const current = getEffects();
            onUpdate(current.filter((_, i) => i !== index));
          },
        },
      ],
    });
    for (const param of table.params) {
      // No "Effect: " prefix -- the Remove button above already reads as
      // this instance's own heading (see table.label there), so repeating
      // the effect's name on every param below it is redundant. Right-
      // aligning the row (see fields.ts's `indented`) is what gives the
      // group its visual separation from the heading instead.
      const key = `${index}-${param.key}`;
      const stored = spec.params[param.key];
      const onChange = (v: number | string) => {
        const current = getEffects();
        onUpdate(
          current.map((e, i) =>
            i === index ? { ...e, params: { ...e.params, [param.key]: v } } : e,
          ),
        );
      };
      if (param.kind === "select") {
        fields.push({
          key,
          label: param.label,
          kind: "select",
          value: typeof stored === "string" ? stored : param.default,
          options: param.options,
          indented: true,
          onChange,
        });
      } else {
        // min/max/step are already authored in display units (e.g.
        // compressor attack's 0..200 ms) -- only `default`/`stored` are in
        // the effect class's own native units (seconds), so scale applies
        // to the value conversion alone, not the range bounds. The
        // slider's own min/max come from activeRangeFor, not the table's
        // param.min/max directly, so a per-instance custom range (set via
        // this same field's own clickable label, see below) actually
        // takes effect on the control itself.
        const scale = param.scale ?? 1;
        const storedNumber =
          typeof stored === "number" ? stored : param.default;
        const active = activeRangeFor(spec, param);
        const hard = hardBoundFor(param);

        // Shared by the label-click popup's two number inputs (see
        // openParamRangeModal) -- clamps both to this param's hard
        // bound, then clamps the currently-stored value into whatever
        // range results so a widened-then-narrowed range can't leave the
        // slider showing a value outside its own min/max.
        const commitRange = (nextMin: number, nextMax: number): void => {
          const clampedMin = Math.min(Math.max(nextMin, hard.min), hard.max);
          const clampedMax = Math.min(Math.max(nextMax, hard.min), hard.max);
          const finalMin = Math.min(clampedMin, clampedMax);
          const finalMax = Math.max(clampedMin, clampedMax);
          const current = getEffects();
          onUpdate(
            current.map((e, i) => {
              if (i !== index) return e;
              const storedValue = e.params[param.key];
              const storedDisplay =
                typeof storedValue === "number"
                  ? storedValue * scale
                  : undefined;
              const clampedDisplay =
                storedDisplay === undefined
                  ? undefined
                  : Math.min(Math.max(storedDisplay, finalMin), finalMax);
              return {
                ...e,
                params:
                  clampedDisplay === undefined
                    ? e.params
                    : { ...e.params, [param.key]: clampedDisplay / scale },
                paramRanges: {
                  ...e.paramRanges,
                  [param.key]: { min: finalMin, max: finalMax },
                },
              };
            }),
          );
        };

        const resetRange = (): void => {
          const current = getEffects();
          onUpdate(
            current.map((e, i) => {
              if (i !== index || !e.paramRanges) return e;
              const { [param.key]: _dropped, ...restRanges } = e.paramRanges;
              return { ...e, paramRanges: restRanges };
            }),
          );
        };

        const isDrifting = (): boolean =>
          getEffects()[index]?.drift?.[param.key] !== undefined;

        const driftSpeed = (): number =>
          getEffects()[index]?.drift?.[param.key]?.speed ?? 0.5;

        const toggleDrift = (enabled: boolean): void => {
          const current = getEffects();
          onUpdate(
            current.map((e, i) => {
              if (i !== index) return e;
              if (!enabled) {
                const { [param.key]: _dropped, ...rest } = e.drift ?? {};
                return {
                  ...e,
                  drift: Object.keys(rest).length > 0 ? rest : undefined,
                };
              }
              return {
                ...e,
                drift: {
                  ...e.drift,
                  [param.key]: { speed: e.drift?.[param.key]?.speed ?? 0.5 },
                },
              };
            }),
          );
        };

        const setDriftSpeed = (speed: number): void => {
          const current = getEffects();
          onUpdate(
            current.map((e, i) => {
              if (i !== index || !e.drift?.[param.key]) return e;
              return {
                ...e,
                drift: { ...e.drift, [param.key]: { speed } },
              };
            }),
          );
        };

        fields.push({
          key,
          label: param.label,
          kind: "range",
          value: storedNumber * scale,
          min: active.min,
          max: active.max,
          step: param.step,
          indented: true,
          labelCustomized: spec.paramRanges?.[param.key] !== undefined,
          labelDrifting: driftTarget !== undefined && isDrifting(),
          onLabelClick: () =>
            openParamRangeModal(
              param.label,
              () => activeRangeFor(getEffects()[index], param),
              hard,
              param.step,
              commitRange,
              resetRange,
              driftTarget === undefined
                ? undefined
                : {
                    enabled: isDrifting,
                    onToggle: toggleDrift,
                    speed: driftSpeed,
                    onSpeedChange: setDriftSpeed,
                  },
            ),
          onChange: (v) => onChange(v / scale),
        });
      }
    }
  });

  fields.push({
    key: "add-effect-type",
    label: "Add effect…",
    kind: "select",
    value: pendingEffectType,
    options: EFFECT_TABLE.map((e) => ({ value: e.type, label: e.label })),
    onChange: (v) => {
      pendingEffectType = v as EffectType;
    },
  });
  fields.push({
    key: "add-effect-button",
    label: "Add",
    kind: "button",
    onClick: () => {
      const table = EFFECT_TABLE.find((e) => e.type === pendingEffectType);
      if (!table) return;
      const current = getEffects();
      onUpdate([
        ...current,
        {
          type: table.type,
          params: Object.fromEntries(
            table.params.map((p) => [p.key, p.default]),
          ),
        },
      ]);
    },
  });

  if (effects.length > 0) {
    fields.push({
      // Fresh random value per param, within whatever range is currently
      // active for it (activeRangeFor -- a per-instance custom range if
      // one's set, else the table default) -- reusing the exact same
      // bounds Drift already wanders within, so "reroll" can never jump
      // further than a user-set custom range already allows. Unlike
      // more-like-this's small nudges, this also re-picks each select
      // param (e.g. filter type) since a full reroll is meant to be a
      // bigger jump, not a nudge.
      key: "reroll-chain",
      label: "Reroll chain",
      kind: "button",
      onClick: () => {
        const current = getEffects();
        onUpdate(
          current.map((spec) => {
            const table = EFFECT_TABLE.find((e) => e.type === spec.type);
            if (!table) return spec;
            const nextParams: Record<string, number | string> = {
              ...spec.params,
            };
            for (const param of table.params) {
              if (param.kind === "select") {
                nextParams[param.key] =
                  param.options[
                    Math.floor(Math.random() * param.options.length)
                  ];
              } else {
                const active = activeRangeFor(spec, param);
                const display =
                  active.min + Math.random() * (active.max - active.min);
                nextParams[param.key] = display / (param.scale ?? 1);
              }
            }
            return { ...spec, params: nextParams };
          }),
        );
      },
    });
  }

  if (effects.length > 0 && onSaveAsPreset) {
    fields.push({
      key: "save-chain-preset",
      label: "Save chain as preset…",
      kind: "button",
      onClick: () => {
        const name = window.prompt("Name this effect chain preset:");
        if (!name?.trim()) return;
        onSaveAsPreset(getEffects(), name.trim());
      },
    });
  }

  return fields;
}

interface DriftState {
  target: EffectLiveTarget;
  index: number;
  type: EffectType;
  key: string;
  scale: number;
  /** Display units (matches activeRangeFor/hardBoundFor's own unit --
   * see EffectRangeParamSpec's own doc on why min/max/step are display
   * units while stored/default are the effect class's native unit). */
  current: number;
  wanderTarget: number;
  nextRetargetAt: number;
  min: number;
  max: number;
}

const DRIFT_TICK_MS = 150;

// speed is 0..1 (EffectSpec.drift's own unit, default 0.5) -- higher
// retargets more often (shorter delay) and glides faster toward each new
// target (bigger lerp factor); both scale off the same knob so "Speed"
// reads as one coherent pace rather than two independently-tunable
// numbers a user would have to reconcile by ear.
function retargetDelayMsFor(speed: number): number {
  const baseMs = 8000 - speed * 7000; // 8000ms (speed 0) .. 1000ms (speed 1)
  const spanMs = 5000 - speed * 4000; // 5000ms (speed 0) .. 1000ms (speed 1)
  return baseMs + Math.random() * spanMs;
}

function lerpFactorFor(speed: number): number {
  return 0.01 + speed * 0.09; // 0.01 (speed 0) .. 0.10 (speed 1)
}

function driftTargetKey(target: EffectLiveTarget): string {
  return target.kind === "row" ? `row:${target.rowId}` : target.kind;
}

/** Runs for the lifetime of the view (started once by createGridView,
 * never stopped -- matches main.ts's own dirty-check interval; this
 * app's SPA session has no explicit teardown). Independently re-reads
 * the model's current effects data every tick rather than caching
 * anything about "what's drifting" across ticks beyond each param's own
 * wander position, so toggling Drift on/off, editing a chain, or
 * removing/reordering an effect all just fall out of always reading
 * fresh state -- no separate invalidation path needed.
 *
 * Bypasses setRowEffects/setMasterEffects/setSendBusEffects's normal
 * rebuild-the-whole-chain path entirely (see
 * BuiltEffectsChain.setParamsAt) -- this fires several times a second,
 * and a full disconnect/reconnect rebuild at that rate would both waste
 * work and risk an audible click on every tick. */
function startDriftEngine(model: GridModel): void {
  const states = new Map<string, DriftState>();

  function collectTargets(): Array<{
    target: EffectLiveTarget;
    effects: EffectSpec[];
  }> {
    return [
      { target: { kind: "master" }, effects: model.getMasterEffects() },
      { target: { kind: "sendBus" }, effects: model.getSendBusEffects() },
      ...model.getRows().map((row) => ({
        target: { kind: "row", rowId: row.id } as const,
        effects: row.config.effects,
      })),
    ];
  }

  setInterval(() => {
    const targets = collectTargets();
    const seen = new Set<string>();

    for (const { target, effects } of targets) {
      effects.forEach((spec, index) => {
        const drift = spec.drift;
        if (!drift) return;
        const table = EFFECT_TABLE.find((e) => e.type === spec.type);
        if (!table) return;
        for (const key of Object.keys(drift)) {
          const param = table.params.find(
            (p): p is EffectRangeParamSpec =>
              p.key === key && p.kind === "range",
          );
          if (!param) continue;
          const speed = drift[key]?.speed ?? 0.5;

          const stateKey = `${driftTargetKey(target)}:${index}:${spec.type}:${key}`;
          seen.add(stateKey);
          const scale = param.scale ?? 1;
          const active = activeRangeFor(spec, param);
          let state = states.get(stateKey);
          if (!state) {
            const stored = spec.params[key];
            const baseDisplay =
              (typeof stored === "number" ? stored : param.default) * scale;
            state = {
              target,
              index,
              type: spec.type,
              key,
              scale,
              current: baseDisplay,
              wanderTarget: baseDisplay,
              nextRetargetAt: Date.now() + retargetDelayMsFor(speed),
              min: active.min,
              max: active.max,
            };
            states.set(stateKey, state);
          } else {
            // The active range may have been (re)customized since the
            // last tick -- keep wandering, just within whatever bounds
            // are current now.
            state.min = active.min;
            state.max = active.max;
          }

          const now = Date.now();
          if (now >= state.nextRetargetAt) {
            state.wanderTarget =
              state.min + Math.random() * (state.max - state.min);
            state.nextRetargetAt = now + retargetDelayMsFor(speed);
          }
          const delta =
            (state.wanderTarget - state.current) * lerpFactorFor(speed);
          // Once settled near its current wander target, skip pushing an
          // effectively-unchanged value every 150ms until the next
          // retarget actually moves it -- (state.max - state.min) scales
          // the "close enough" threshold to each param's own range instead
          // of one fixed number working for a 0..1 param and a 200..8000Hz
          // one equally badly.
          if (Math.abs(delta) > (state.max - state.min) * 0.0005) {
            state.current += delta;
            model.applyLiveEffectParam(
              target,
              index,
              key,
              state.current / scale,
            );
          }
        }
      });
    }

    for (const [stateKey, state] of states) {
      if (seen.has(stateKey)) continue;
      // No longer drifting (toggled off, effect removed, or reordered
      // out from under this index) -- snap back to whatever's actually
      // saved there now, but only if this index still holds the same
      // effect type this state was tracking; if some other effect has
      // since taken that slot, touching it here would misapply this
      // reset to the wrong instance entirely, so it's skipped instead.
      const currentSpec = targets.find(
        (t) => driftTargetKey(t.target) === driftTargetKey(state.target),
      )?.effects[state.index];
      if (currentSpec?.type === state.type) {
        const stored = currentSpec.params[state.key];
        if (typeof stored === "number") {
          model.applyLiveEffectParam(
            state.target,
            state.index,
            state.key,
            stored,
          );
        }
      }
      states.delete(stateKey);
    }
  }, DRIFT_TICK_MS);
}

/** Sidechain-style ducking (see RowConfig.duck's own doc): the target-row
 * select is the only enable/disable gate -- "(None)" clears the whole
 * relationship, any other row sets one up (creating it with sensible
 * defaults if this is the first time). No section-level toggle the way
 * Envelope/Effects use one: a second on/off control alongside "(None)"
 * would just be two ways to say the same thing. Amount/attack/release
 * stay visible and interactive even at "(None)" (this file's usual "never
 * conditionally hide a field based on another field's value" rule --
 * see the Filter effect's own gain param for the same reasoning) --
 * adjusting them pre-selects values a target choice will pick up, rather
 * than being disabled dead weight until one exists. None of these four
 * fields call render(): none of them change *which* fields exist, just
 * their values (same reasoning as e.g. Playback mode's own select just
 * above in rowPanel), so fields.ts's own local live-readout is enough. */
function duckFields(row: Row, model: GridModel): Field[] {
  const defaults = {
    targetRowName: "",
    amount: 0.6,
    attackMs: 5,
    releaseMs: 200,
  };
  // For the fields' own initial displayed values only -- render() isn't
  // called after any of these fields commit (see this function's own
  // top doc), so `current` here would otherwise go stale the moment a
  // sibling field's own update() ran, e.g. picking a target then
  // dragging Amount with no render in between would still close over
  // "no target" and silently clear the very selection just made. update()
  // re-reads model.getRow fresh instead, same reasoning as effectsFields'
  // own getEffects()-called-inside-every-handler.
  const current = row.config.duck ?? defaults;
  const update = (patch: Partial<typeof defaults>): void => {
    const latest = model.getRow(row.id)?.config.duck ?? defaults;
    const next = { ...latest, ...patch };
    model.setRowDuck(row, next.targetRowName ? next : undefined);
  };

  return [
    {
      key: "duck-target",
      label: "Duck target row",
      kind: "select",
      value: current.targetRowName,
      options: [
        { value: "", label: "(None)" },
        ...model
          .getRows()
          .filter((r) => r.id !== row.id)
          .map((r) => ({ value: r.config.name, label: r.config.name })),
      ],
      onChange: (v) => update({ targetRowName: v }),
    },
    {
      key: "duck-amount",
      label: "Amount",
      kind: "range",
      value: current.amount,
      min: 0,
      max: 1,
      step: 0.01,
      indented: true,
      onChange: (v) => update({ amount: v }),
    },
    {
      key: "duck-attack",
      label: "Attack (ms)",
      kind: "range",
      value: current.attackMs,
      min: 0,
      max: 50,
      step: 1,
      indented: true,
      onChange: (v) => update({ attackMs: v }),
    },
    {
      key: "duck-release",
      label: "Release (ms)",
      kind: "range",
      value: current.releaseMs,
      min: 10,
      max: 1000,
      step: 10,
      indented: true,
      onChange: (v) => update({ releaseMs: v }),
    },
  ];
}

/** Duck's sibling section -- same shape and same stale-closure fix as
 * duckFields (see its own top comment): update() re-reads
 * model.getRow fresh instead of trusting the `current` snapshot, since
 * no render() happens between two fields committed back to back. */
function callResponseFields(row: Row, model: GridModel): Field[] {
  const defaults = {
    targetRowName: "",
    probability: 0.5,
    delaySeconds: 0,
  };
  const current = row.config.callResponse ?? defaults;
  const update = (patch: Partial<typeof defaults>): void => {
    const latest = model.getRow(row.id)?.config.callResponse ?? defaults;
    const next = { ...latest, ...patch };
    model.setRowCallResponse(row, next.targetRowName ? next : undefined);
  };

  return [
    {
      key: "call-response-target",
      label: "Response target row",
      kind: "select",
      value: current.targetRowName,
      options: [
        { value: "", label: "(None)" },
        ...model
          .getRows()
          .filter((r) => r.id !== row.id)
          .map((r) => ({ value: r.config.name, label: r.config.name })),
      ],
      onChange: (v) => update({ targetRowName: v }),
    },
    {
      key: "call-response-probability",
      label: "Probability",
      kind: "range",
      value: current.probability,
      min: 0,
      max: 1,
      step: 0.01,
      indented: true,
      onChange: (v) => update({ probability: v }),
    },
    {
      key: "call-response-delay",
      label: "Delay (ms)",
      kind: "range",
      value: current.delaySeconds * 1000,
      min: 0,
      max: 1000,
      step: 5,
      indented: true,
      onChange: (v) => update({ delaySeconds: v / 1000 }),
    },
  ];
}

/** Envelope is always a single consolidated override (like row/column
 * Defaults, unlike note/gain/gate/time-shift's per-field checkboxes) -- a
 * single breakpoint-curve editor (see fields.ts's "automation" kind),
 * always interactive, gated by one section-level toggle the caller
 * supplies via the section's own `toggle` wiring. */
function envelopeFields(
  envelope: EnvelopeParams,
  onChange: (points: EnvelopeParams["points"]) => void,
): Field[] {
  return [
    {
      key: "envelope",
      label: "Shape (drag points, double-click to add/remove)",
      kind: "automation",
      points: envelope.points,
      onChange,
    },
  ];
}

/** Everything about "what does this row sound like" -- source-specific
 * params, samplePlayer's own playback-mode toggles, envelope, sample
 * assignment/trim, and the pre-effects default-gain cascade fallback --
 * all of which apply to (or inside) the source's own voice before this
 * row's effects chain ever sees the signal. Launched from a button
 * labeled with the row's own source type (see rowPanel); everything
 * else about a row (sequencing, effects, output level, cross-row
 * interactions) stays in the main panel behind it.
 *
 * Re-reads model.getRow(row.id) fresh at the top of every renderBody()
 * call rather than trusting the `row` param across the popup's whole
 * lifetime -- same staleness reasoning as duckFields' own update(): this
 * row's config can already be stale by the time the button that opened
 * this popup was clicked (a continuous control edited just before with
 * no render() in between), and once open, every toggle inside the popup
 * itself re-renders the same way. If the row's gone by the time a
 * refresh happens (removed from behind the popup -- can't happen through
 * this app's own UI today since the modal overlay blocks the row's own
 * trash-icon button, but cheap to guard anyway), the popup just closes
 * instead of rendering a stale/broken body. */
function openInstrumentModal(
  row: Row,
  model: GridModel,
  options: GridViewOptions,
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal instrument-modal";
  overlay.appendChild(modal);

  function close(): void {
    overlay.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("span");
  title.className = "modal-title";
  title.textContent = `Instrument: ${SOURCE_TYPE_LABELS[row.config.sourceType]}`;
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.className = "modal-close-button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "modal-footer";
  // Leftmost -- "try it" reads before "commit it", same left-to-right
  // ordering as patchModal's own New/Load/Save. Fires one voice with
  // whatever's currently set (source params, envelope, effects) right
  // now, independent of the sequencer -- see GridModel.previewRow's own
  // doc for why it always fires regardless of this row's mute/solo state.
  const previewButton = document.createElement("button");
  previewButton.textContent = "Preview";
  previewButton.addEventListener("click", () => {
    const current = model.getRow(row.id);
    if (current) model.previewRow(current);
  });
  footer.appendChild(previewButton);
  if (row.source.needsSample && options.onSwapSample) {
    const swapButton = document.createElement("button");
    swapButton.textContent = "Swap sample";
    swapButton.title = "Assign a random other sample from the same category";
    swapButton.addEventListener("click", async () => {
      const current = model.getRow(row.id);
      if (!current) return;
      await options.onSwapSample?.(current);
      renderBody();
    });
    footer.appendChild(swapButton);
  }
  const savePresetButton = document.createElement("button");
  savePresetButton.textContent = "Save as instrument preset…";
  savePresetButton.addEventListener("click", () => {
    const current = model.getRow(row.id);
    if (!current) return;
    const name = window.prompt("Name this instrument preset:");
    if (!name?.trim()) return;
    options.onSaveInstrumentPreset?.(current, name.trim());
  });
  footer.appendChild(savePresetButton);
  modal.appendChild(footer);

  function renderBody(): void {
    const current = model.getRow(row.id);
    if (!current) {
      close();
      return;
    }

    const fields: Field[] = [];

    if (current.config.sourceType === "samplePlayer") {
      fields.push({
        key: "playbackMode",
        label: "Playback",
        kind: "select",
        value: current.config.playbackMode,
        options: ["direct", "pitched"],
        onChange: (v) => {
          model.setRowPlaybackMode(current, v as "direct" | "pitched");
          renderBody();
        },
      });
      // Non-destructive -- flips playback direction of whatever sample's
      // loaded (or the next one assigned), leaves the library file alone.
      // See the Manage Library page's own "Reverse" for the permanent,
      // destructive version.
      fields.push({
        key: "reversed",
        label: "Reverse playback",
        kind: "checkbox",
        value: current.config.reversed,
        onChange: (v) => model.setRowReversed(current, v),
      });
      // Every hit starts from wherever a virtual scan position has
      // advanced to since this row's last one -- see
      // RowConfig.continuePlayback's own doc. No renderBody() needed:
      // toggling this doesn't change which fields exist, just future
      // firing behavior.
      fields.push({
        key: "continuePlayback",
        label: "Continue from last position",
        kind: "checkbox",
        value: current.config.continuePlayback,
        onChange: (v) => model.setRowContinuePlayback(current, v),
      });
    }

    const sourceParams = current.source.getParams();
    for (const field of current.source.paramFields) {
      const value = sourceParams[field.key] ?? field.default;
      if (field.kind === "select") {
        fields.push({
          key: field.key,
          label: field.label,
          kind: "select",
          value: String(value),
          options: field.options ?? [],
          onChange: (v) => current.source.setParams({ [field.key]: v }),
        });
      } else {
        fields.push({
          key: field.key,
          label: field.label,
          kind: "range",
          value: Number(value),
          min: field.min ?? 0,
          max: field.max ?? 1,
          step: field.step ?? 0.01,
          onChange: (v) => current.source.setParams({ [field.key]: v }),
        });
      }
    }

    if (current.source.needsSample) {
      // Sample assignment happens via the main-page Sample Library panel
      // now (select this row, click a sample there) -- this just shows
      // what's already loaded. See GridViewOptions.getCurrentSampleName.
      fields.push({
        key: "currentSample",
        label: "Sample",
        kind: "text",
        value: options.getCurrentSampleName?.(current) ?? "(none)",
        readOnly: true,
        onChange: () => {},
      });
    }

    if (current.config.sourceType === "samplePlayer") {
      const buffer = model.getRowSampleBuffer(current);
      if (buffer) {
        fields.push({
          key: "sampleRange",
          label: "Playback range (drag handles to trim)",
          kind: "waveformRange",
          buffer,
          range: current.config.sampleRange,
          onChange: (range) => model.setRowSampleRange(current, range),
        });
      }
    }

    body.innerHTML = "";
    renderPanelSections(body, fields, [
      {
        title: "Envelope",
        toggle: {
          // Disabled (and forced on) while this row already wins the
          // global Row/column precedence race -- see
          // RowConfig.defaultsOverride's own doc for why toggling a
          // winning side's own Override can't change an outcome it
          // already controls; only the column's own Override (in the
          // column panel) can flip this row's envelope in that case.
          active: model.precedence === "row" || current.config.envelopeOverride,
          disabled: model.precedence === "row",
          onClick: () => {
            model.setRowEnvelopeOverride(
              current,
              !current.config.envelopeOverride,
            );
            renderBody();
          },
        },
        fields: envelopeFields(current.config.envelope, (points) =>
          model.setRowEnvelope(current, points),
        ),
      },
      {
        // Scales envelopeGain, the same pre-effects node Envelope above
        // drives -- see RowConfig.defaultGainOverride's own doc for why
        // this lives here instead of the main panel's Output section
        // alongside Send/Pan/Level.
        title: "Default gain",
        toggle: {
          active: model.precedence === "row" || current.config.defaultGainOverride,
          disabled: model.precedence === "row",
          onClick: () => {
            model.setRowDefaultGainOverride(
              current,
              !current.config.defaultGainOverride,
            );
            renderBody();
          },
        },
        fields: [
          {
            key: "defaultGain",
            label: "Default gain",
            kind: "range",
            value: current.config.defaultGain,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: (v) => model.setRowDefaultGain(current, v),
          },
        ],
      },
    ]);
  }

  renderBody();
  document.body.appendChild(overlay);
}

export interface PanelSection {
  title: string;
  fields: Field[];
  toggle?: { active: boolean; disabled?: boolean; onClick: () => void };
}

interface PanelContent {
  title: string;
  fields: Field[];
  sections: PanelSection[];
  /** Only rowPanel sets this -- master/column/cell selections have no
   * equivalent single "delete the thing I'm looking at" action (a column
   * or cell isn't a discrete object to remove, and Master isn't
   * removable at all). Rendered as a trash-icon button at the far right
   * of the panel's own title row (see render()). */
  onRemove?: () => void;
  /** Only rowPanel sets this too, same reasoning as onRemove -- "make an
   * independent copy of the thing I'm looking at" is meaningless for
   * Master/a column/a cell (a cell's own copy-elsewhere concept, if it
   * ever existed, wouldn't be this). Rendered as a second title-row icon
   * button, left of Remove. Async since it goes through model.addRow
   * (awaits a source's own init, see GridModel's doc) via main.ts's
   * duplicateRow, same as the "+" row's onAddRow. */
  onDuplicate?: () => Promise<void>;
}

/** Renders a flat fields body (if any) followed by every titled,
 * optionally toggle-gated section -- shared by render()'s own row/column/
 * cell/master panel and openInstrumentModal's popup body, which needs the
 * exact same fields-then-sections shape (Envelope, Default gain) inside a
 * modal instead of the side panel. Appends into `container`, doesn't clear
 * it first -- callers own their own container's lifecycle (render() tears
 * down and rebuilds the whole panel every call; the modal's own
 * renderBody() clears its body div before calling this). */
function renderPanelSections(
  container: HTMLElement,
  fields: Field[],
  sections: PanelSection[],
): void {
  if (fields.length > 0) {
    const body = document.createElement("div");
    body.className = "panel-body";
    renderFields(body, fields);
    container.appendChild(body);
  }

  for (const section of sections) {
    const sectionEl = document.createElement("div");
    sectionEl.className = "panel-section";

    const sectionHeading = document.createElement("div");
    sectionHeading.className = "panel-section-title-row";
    const sectionTitle = document.createElement("span");
    sectionTitle.className = "panel-section-title";
    sectionTitle.textContent = section.title;
    sectionHeading.appendChild(sectionTitle);
    if (section.toggle) {
      const button = document.createElement("button");
      button.className = `panel-header-button${section.toggle.active ? " active" : ""}`;
      button.textContent = "Override";
      button.disabled = section.toggle.disabled ?? false;
      button.title = button.disabled
        ? "Already wins by the global row/column precedence setting, so its values apply automatically -- to use the other side's values instead, turn on its own Override there."
        : "";
      button.addEventListener("click", section.toggle.onClick);
      sectionHeading.appendChild(button);
    }
    sectionEl.appendChild(sectionHeading);

    const sectionBody = document.createElement("div");
    const dimmed = section.toggle ? !section.toggle.active : false;
    sectionBody.className = `panel-body dimmed-section${dimmed ? " dimmed" : ""}`;
    renderFields(sectionBody, section.fields);
    sectionEl.appendChild(sectionBody);

    container.appendChild(sectionEl);
  }
}

type Selection =
  | { kind: "row"; rowId: string }
  | { kind: "column"; columnIndex: number }
  | { kind: "cell"; rowId: string; columnIndex: number }
  | { kind: "master" }
  | null;

export interface GridViewOptions {
  buildMasterFields: () => Field[];
  /** Titled sections for the Master panel -- currently just "Effects"
   * (the master bus's own insert chain, applied to everything) and "Send
   * Bus" (an arbitrary chain fed by each row's own Send level, see
   * config.ts's RowConfig.sendLevel doc). Kept as titled PanelSections
   * rather than flat fields specifically so the two chains' "Add
   * effect…"/param blocks read as visually distinct groups instead of
   * one confusing run-on list. */
  buildMasterSections: () => PanelSection[];
  /** Sample assignment now happens entirely through the main-page Sample
   * Library panel (select a row, click a sample there) -- this file no
   * longer does any loading/browsing UI itself, just shows what's already
   * loaded. Synchronous, mirrors getSelectedRow's own "render is sync,
   * can't await here" reasoning. */
  getCurrentSampleName?: (row: Row) => string | undefined;
  /** Row panel's "Save as instrument preset..." button -- prompts for a
   * name itself (a row-panel-local UI action, same as the old "Load
   * sample..." button opening its own file picker), then hands the
   * row's current sourceType/params/envelope to main.ts to persist. */
  onSaveInstrumentPreset?: (row: Row, name: string) => Promise<void>;
  /** effectsFields' own "Save chain as preset..." button, for the row
   * and cell panels' Effects sections -- same reasoning as
   * onSaveInstrumentPreset, just for a chain instead of a source's
   * params/envelope. The master panel's own Effects section is built
   * directly in main.ts, which already has its own save function in
   * scope with no need for this indirection. */
  onSaveEffectChainPreset?: (
    effects: EffectSpec[],
    name: string,
  ) => Promise<void>;
  /** Fired whenever the selection changes (including to/from null) --
   * main.ts's own library panels need to know when to re-render their
   * "does this match the selected row" state, which nothing else here
   * tells them about. */
  onSelectionChange?: (row: Row | null) => void;
  /** The "+" cell's own popup (see openAddRowModal) -- main.ts owns
   * actually creating the row (model.addRow, auto-loading a placeholder
   * sample, its own view.render()), this file just collects sourceType/
   * name and hands them off. */
  onAddRow?: (sourceType: SourceType, name: string) => Promise<void>;
  /** Row panel's own Duplicate button (see PanelContent.onDuplicate) --
   * same "this file collects the request, main.ts owns actually doing
   * it" split as onAddRow. main.ts builds the copy (config, cells,
   * source params, loaded sample -- see patch.ts's duplicateRow) and
   * selects it afterward via selectRow so the new copy is what's open
   * for editing next, not left on the original. */
  onDuplicateRow?: (row: Row) => Promise<void>;
  /** Instrument popup's "Swap sample" button (samplePlayer rows only) --
   * this file has no notion of the sample library itself (see
   * getCurrentSampleName's own doc), so main.ts picks a random other
   * sample sharing the row's current category and assigns it. */
  onSwapSample?: (row: Row) => Promise<void>;
}

export interface GridViewHandle {
  render(): void;
  refreshPlayhead(): void;
  selectMaster(): void;
  /** Selects a row by id -- used after onDuplicateRow builds a copy, so
   * the newly duplicated row is what's open in the panel next, not left
   * on whichever row was selected when Duplicate was clicked. A stale/
   * unknown id is the same as any other selection of a since-removed
   * row (see getSelectedRow's own null fallback in panelContent) --
   * silently resolves to nothing selected, not an error. */
  selectRow(rowId: string): void;
  /** The currently-selected row, if any -- main.ts's own library panels
   * (outside this file entirely) need this to know which row a library
   * click should target. */
  getSelectedRow(): Row | null;
  /** Read/write access to whatever's currently selected own effects
   * chain, if it has one -- unlike samples/instrument presets (row-only),
   * effect chains apply uniformly at row/cell/master, so the Effect
   * Library panel needs this broader accessor instead of getSelectedRow.
   * null for a column selection or nothing selected (columns have no
   * effects chain), and for a cell selection on a non-samplePlayer row
   * (cell effect overrides only exist for sample rows, see cellPanel). */
  getSelectedEffectsTarget(): {
    /** Same wording as the panel's own title ("Row: Kick", "Cell: Kick ×
     * col 5", "Master") -- so a caller confirming an action against this
     * target (e.g. the Effect Library's replace/add prompt) can name it
     * without re-deriving that format itself. */
    label: string;
    getEffects: () => EffectSpec[];
    setEffects: (next: EffectSpec[]) => void;
  } | null;
  /** Nudges every row's own knobs (defaults, pan/level/send, effect
   * params), a fraction of each row's steps, and the master/send-bus
   * chains -- all a little, all at once, from wherever they currently
   * sit (not fresh random draws) -- see its own doc above
   * createGridView's return statement for exactly what moves and by how
   * much. One click = one small step away from the current patch;
   * clicking repeatedly wanders further, same as nothing stops clicking
   * a "reroll" button twice. No Amount knob -- undo/redo is the walk-
   * back mechanism instead of a dial to get right in advance. */
  moreLikeThis(): void;
}

export function createGridView(
  container: HTMLElement,
  model: GridModel,
  options: GridViewOptions,
): GridViewHandle {
  let selection: Selection = null;
  let cellEls: HTMLDivElement[][] = [];

  // Click-and-drag paint (see the cell mousedown/mouseenter handlers
  // below): the cell under the pointer at mousedown toggles immediately,
  // then every *other* cell the pointer enters while the button is still
  // down toggles once each -- dragPaintedCells guards against re-toggling
  // a cell the drag re-crosses (e.g. a wobbly diagonal drag). A window-
  // level mouseup (rather than one on each cell) is what actually ends the
  // drag, since the button can be released anywhere, not just over a cell.
  let isDragPainting = false;
  let dragPaintedCells = new Set<string>();
  window.addEventListener("mouseup", () => {
    isDragPainting = false;
  });

  function select(next: Selection): void {
    selection = next;
    render();
    options.onSelectionChange?.(getSelectedRow());
  }

  function getSelectedRow(): Row | null {
    if (selection?.kind !== "row") return null;
    return model.getRow(selection.rowId) ?? null;
  }

  function getSelectedEffectsTarget(): {
    label: string;
    getEffects: () => EffectSpec[];
    setEffects: (next: EffectSpec[]) => void;
  } | null {
    if (selection?.kind === "row") {
      const row = model.getRow(selection.rowId);
      if (!row) return null;
      return {
        label: `Row: ${row.config.name}`,
        getEffects: () => model.getRow(row.id)?.config.effects ?? [],
        setEffects: (next) => model.setRowEffects(row, next),
      };
    }
    if (selection?.kind === "cell") {
      const row = model.getRow(selection.rowId);
      if (!row || row.config.sourceType !== "samplePlayer") return null;
      const columnIndex = selection.columnIndex;
      return {
        label: `Cell: ${row.config.name} × col ${columnIndex + 1}`,
        getEffects: () => row.cells[columnIndex]?.effects ?? [],
        setEffects: (next) => {
          // Applying a chain preset to a cell whose own override is off
          // would otherwise change nothing visible -- it'd just sit
          // unused under the row's own chain until someone remembers to
          // flip the override separately, which reads as "nothing
          // happened" from the library panel's own click.
          model.setCell(row, columnIndex, {
            effects: next,
            effectsOverride: true,
          });
        },
      };
    }
    if (selection?.kind === "master") {
      return {
        label: "Master",
        getEffects: () => model.getMasterEffects(),
        setEffects: (next) => model.setMasterEffects(next),
      };
    }
    return null;
  }

  function rowPanel(row: Row): PanelContent {
    // Enabled (mute) and Solo are both already reachable outside this
    // panel -- clicking a row's own header toggles mute, and its "S"
    // button toggles solo (see render()'s rowMaster/soloButton click
    // handlers) -- so they don't need a redundant copy of the same
    // control in here too.
    const fields: Field[] = [
      {
        key: "name",
        label: "Name",
        kind: "text",
        value: row.config.name,
        onChange: (v) => {
          model.setRowName(row, v);
          render();
        },
      },
    ];

    fields.push({
      key: "triggerMode",
      label: "Trigger mode",
      kind: "select",
      value: row.config.triggerMode.kind,
      options: Object.keys(TRIGGER_MODE_LABELS),
      onChange: (v) => {
        const kind = v as TriggerModeKind;
        model.setRowTriggerMode(
          row,
          kind === "explicitDuration"
            ? { kind, steps: 1, loop: false }
            : { kind },
        );
        render();
      },
    });

    if (row.config.triggerMode.kind === "explicitDuration") {
      fields.push({
        key: "explicitSteps",
        label: "Duration (steps)",
        kind: "number",
        value: row.config.triggerMode.steps,
        min: 0.1,
        max: 32,
        step: 0.1,
        onChange: (v) => {
          if (row.config.triggerMode.kind !== "explicitDuration") return;
          model.setRowTriggerMode(row, {
            ...row.config.triggerMode,
            steps: v,
          });
          render();
        },
      });
    }

    // Everything about what this row actually sounds like (source
    // params, envelope, sample assignment/trim, the pre-effects default-
    // gain fallback) lives behind this button instead of cluttering the
    // main panel -- see openInstrumentModal's own doc. Labeled with the
    // row's own source type so it reads as "configure the instrument,"
    // not a generic settings button -- plus the current sample name for
    // samplePlayer rows, since otherwise there's no way to tell whether
    // one's actually assigned without opening the popup.
    const instrumentLabel = row.source.needsSample
      ? options.getCurrentSampleName?.(row)
      : undefined;
    fields.push({
      key: "openInstrument",
      label: instrumentLabel
        ? `${SOURCE_TYPE_LABELS[row.config.sourceType]}: ${instrumentLabel}…`
        : `${SOURCE_TYPE_LABELS[row.config.sourceType]}…`,
      kind: "button",
      preserveCase: true,
      onClick: () => {
        // Not the `row` param directly -- same staleness reasoning as
        // onDuplicate below (a continuous control edited just before this
        // button was clicked, with no render() in between, would leave
        // `row` stale). openInstrumentModal re-reads model.getRow(row.id)
        // again itself on every internal render too, this first read is
        // just to seed the modal with an id that's confirmed to exist.
        const current = model.getRow(row.id);
        if (current) openInstrumentModal(current, model, options);
      },
    });

    return {
      title: `Row: ${row.config.name}`,
      fields,
      // Rendered as a trash icon at the far right of the panel's own
      // title row (see render()'s heading), not a field in the body --
      // "remove this row" reads as a title-bar action (same place a
      // window's own close button lives), not one more setting in a
      // list of them, and it's now reachable without scrolling down
      // through every section below to find it.
      onRemove: () => {
        model.removeRow(row);
        select(null);
      },
      onDuplicate: options.onDuplicateRow
        ? async () => {
            // Not the `row` param directly -- it's a snapshot from
            // whenever this panel was last rendered, and continuous
            // controls (the envelope editor's drag, every plain slider)
            // deliberately don't re-render on every edit (see fields.ts's
            // own top comment), so `row.config` here can be stale by the
            // time Duplicate is actually clicked. model.getRow re-reads
            // the live current config, same reasoning as effectsFields'
            // own getEffects()-called-fresh-in-every-handler.
            const current = model.getRow(row.id);
            if (current) await options.onDuplicateRow?.(current);
          }
        : undefined,
      sections: [
        {
          // Note/nudge only now -- defaultGain has its own override flag
          // and lives in the Instrument popup instead (see
          // RowConfig.defaultGainOverride's own doc). These two stay here
          // since they're sequencer/cascade concerns, independent of the
          // instrument, same category as Trigger mode above.
          title: "Defaults",
          toggle: {
            // Disabled (and forced on) while this row already wins the
            // global Row/column precedence race -- an override here
            // can't change an outcome it already controls; only the
            // column's own Override (in the column panel) can flip
            // this row's note/nudge default in that case. See
            // RowConfig.defaultsOverride's own doc.
            active: model.precedence === "row" || row.config.defaultsOverride,
            disabled: model.precedence === "row",
            onClick: () => {
              model.setRowDefaultsOverride(row, !row.config.defaultsOverride);
              render();
            },
          },
          fields: [
            {
              key: "defaultNote",
              label: "Default note",
              kind: "number",
              value: row.config.defaultNote,
              min: 0,
              max: 127,
              step: 1,
              onChange: (v) => model.setRowDefaultNote(row, v),
            },
            {
              key: "timeShift",
              label: "Default nudge (ms)",
              kind: "range",
              value: row.config.defaultTimeShiftSeconds * 1000,
              min: -100,
              max: 100,
              step: 5,
              onChange: (v) => model.setRowDefaultTimeShift(row, v / 1000),
            },
            {
              // Unlike its two siblings above, not gated by this
              // section's own Override toggle -- see
              // RowConfig.probability's own doc for why: it's a per-tick
              // firing gate applied to every armed cell, not a cascade
              // fallback for cells with no value of their own, so tying
              // it to "does my default note/nudge apply" would silently
              // change how often hand-set cells fire. Grouped here
              // visually anyway since it's still a row-level default.
              key: "probability",
              label: "Probability",
              kind: "range",
              value: row.config.probability,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setRowProbability(row, v),
            },
            {
              // Shuffles which steps are on, not how many -- a Fisher-
              // Yates permutation of this row's own on/off flags, so a
              // busy row stays busy and a sparse one stays sparse, just
              // rearranged. Only touches `on`; a step's own note/gain/
              // gate/time-shift overrides (if any) stay put and travel
              // with their column index, not with wherever their "on"
              // flag ends up.
              key: "rerollPattern",
              label: "Reroll pattern",
              kind: "button",
              onClick: () => {
                const current = model.getRow(row.id);
                if (!current) return;
                const flags = current.cells.map((c) => c.on);
                for (let i = flags.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [flags[i], flags[j]] = [flags[j], flags[i]];
                }
                flags.forEach((on, i) => model.setCell(current, i, { on }));
                render();
              },
            },
          ],
        },
        {
          title: "Effects",
          fields: effectsFields(
            () => model.getRow(row.id)?.config.effects ?? [],
            // Unlike a checkbox/range's own value, adding or removing a
            // whole effect instance changes *which fields exist at all*
            // -- fields.ts's controls only echo their own value locally
            // (see its own top comment), so this needs an explicit
            // render() to show the new/removed block, not just update it.
            (next) => {
              model.setRowEffects(row, next);
              render();
            },
            options.onSaveEffectChainPreset,
            { kind: "row", rowId: row.id },
          ),
        },
        {
          // Everything here is downstream of the effects chain (duckGain
          // -> panNode -> levelNode -> master/send, see addRow) -- a
          // channel-strip mixer group, not an insert effect.
          title: "Output",
          fields: [
            {
              key: "sendLevel",
              label: "Send",
              kind: "range",
              value: row.config.sendLevel,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setRowSendLevel(row, v),
            },
            {
              key: "pan",
              label: "Pan (L -1 .. 1 R)",
              kind: "range",
              value: row.config.pan,
              min: -1,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setRowPan(row, v),
            },
            {
              key: "level",
              label: "Level",
              kind: "range",
              value: row.config.level,
              min: 0,
              max: 1.5,
              step: 0.01,
              onChange: (v) => model.setRowLevel(row, v),
            },
          ],
        },
        {
          // Duck and Call & Response together -- neither touches this
          // row's own signal or its instrument, both are "when I fire,
          // do something to a different row" behaviors, so they share one
          // section instead of the mixer/instrument split above.
          title: "Interaction",
          fields: [...duckFields(row, model), ...callResponseFields(row, model)],
        },
      ],
    };
  }

  function columnPanel(columnIndex: number): PanelContent {
    const column = model.columns[columnIndex];
    return {
      title: `Column ${columnIndex + 1}`,
      fields: [
        {
          key: "enabled",
          label: "Enabled (not skipped)",
          kind: "checkbox",
          value: column.enabled,
          onChange: (v) => {
            model.setColumn(columnIndex, { enabled: v });
            render();
          },
        },
      ],
      sections: [
        {
          title: "Defaults",
          toggle: {
            // Disabled (and forced on) while this column already wins
            // the global Row/column precedence race -- see
            // RowConfig.defaultsOverride's own doc for the row-side
            // equivalent; only a row's own Override (in that row's
            // panel) can flip this column's note/gain/nudge default in
            // that case. Doesn't gate Default gate below -- see
            // ColumnConfig.defaultGateOverride's own doc for why that
            // one's independent of precedence entirely.
            active: model.precedence === "column" || column.defaultsOverride,
            disabled: model.precedence === "column",
            onClick: () => {
              model.setColumn(columnIndex, {
                defaultsOverride: !column.defaultsOverride,
              });
              render();
            },
          },
          fields: [
            {
              key: "defaultNote",
              label: "Default note",
              kind: "number",
              value: column.defaultNote,
              min: 0,
              max: 127,
              step: 1,
              onChange: (v) => model.setColumn(columnIndex, { defaultNote: v }),
            },
            {
              key: "defaultGain",
              label: "Default gain",
              kind: "range",
              value: column.defaultGain,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setColumn(columnIndex, { defaultGain: v }),
            },
            {
              // Its own independent toggle, not part of the section's
              // shared one -- a row has no gate default of its own to
              // race against (see ColumnConfig.defaultGateOverride's own
              // doc), so unlike note/gain/nudge above, this is never
              // disabled by precedence and needs its own on/off state
              // instead of inheriting the section's.
              key: "defaultGate",
              label: "Default gate",
              kind: "override",
              overridden: column.defaultGateOverride,
              value: column.defaultGate,
              min: 0,
              max: 4,
              step: 0.05,
              onToggle: (on) =>
                model.setColumn(columnIndex, { defaultGateOverride: on }),
              onChange: (v) => model.setColumn(columnIndex, { defaultGate: v }),
            },
            {
              key: "defaultShift",
              label: "Default nudge (ms)",
              kind: "range",
              value: column.defaultTimeShiftSeconds * 1000,
              min: -100,
              max: 100,
              step: 5,
              onChange: (v) =>
                model.setColumn(columnIndex, {
                  defaultTimeShiftSeconds: v / 1000,
                }),
            },
          ],
        },
        {
          title: "Envelope",
          toggle: {
            active: model.precedence === "column" || column.envelopeOverride,
            disabled: model.precedence === "column",
            onClick: () => {
              model.setColumn(columnIndex, {
                envelopeOverride: !column.envelopeOverride,
              });
              render();
            },
          },
          fields: envelopeFields(column.envelope, (points) =>
            model.setColumn(columnIndex, { envelope: { points } }),
          ),
        },
      ],
    };
  }

  function cellPanel(row: Row, columnIndex: number): PanelContent {
    const cell = row.cells[columnIndex];
    const resolved = model.resolveCell(row, columnIndex);
    const fields: Field[] = [
      {
        key: "on",
        label: "On",
        kind: "checkbox",
        value: cell.on,
        onChange: (v) => {
          model.setCell(row, columnIndex, { on: v });
          render();
        },
      },
      {
        key: "note",
        label: "Note",
        kind: "override",
        overridden: cell.note !== undefined,
        value: cell.note ?? resolved.note,
        min: 0,
        max: 127,
        step: 1,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            note: on ? resolved.note : undefined,
          });
          render();
        },
        onChange: (v) => model.setCell(row, columnIndex, { note: v }),
      },
      {
        key: "gain",
        label: "Gain",
        kind: "override",
        overridden: cell.gain !== undefined,
        value: cell.gain ?? resolved.gain,
        min: 0,
        max: 1,
        step: 0.01,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            gain: on ? resolved.gain : undefined,
          });
          render();
        },
        onChange: (v) => model.setCell(row, columnIndex, { gain: v }),
      },
      {
        key: "gate",
        label: "Gate",
        kind: "override",
        overridden: cell.gate !== undefined,
        value: cell.gate ?? resolved.gate,
        min: 0,
        max: 4,
        step: 0.05,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            gate: on ? resolved.gate : undefined,
          });
          render();
        },
        onChange: (v) => model.setCell(row, columnIndex, { gate: v }),
      },
      {
        key: "shift",
        label: "Time-shift (ms)",
        kind: "override",
        overridden: cell.timeShiftSeconds !== undefined,
        value: (cell.timeShiftSeconds ?? resolved.timeShiftSeconds) * 1000,
        min: -100,
        max: 100,
        step: 5,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            timeShiftSeconds: on ? resolved.timeShiftSeconds : undefined,
          });
          render();
        },
        onChange: (v) =>
          model.setCell(row, columnIndex, { timeShiftSeconds: v / 1000 }),
      },
    ];

    const sections: PanelSection[] = [
      {
        title: "Envelope",
        toggle: {
          active: cell.envelopeOverride,
          onClick: () => {
            model.setCell(row, columnIndex, {
              envelopeOverride: !cell.envelopeOverride,
            });
            render();
          },
        },
        fields: envelopeFields(cell.envelope, (points) =>
          model.setCell(row, columnIndex, { envelope: { points } }),
        ),
      },
    ];

    if (row.config.sourceType === "samplePlayer") {
      sections.push({
        title: "Effects",
        toggle: {
          active: cell.effectsOverride,
          onClick: () => {
            model.setCell(row, columnIndex, {
              effectsOverride: !cell.effectsOverride,
            });
            render();
          },
        },
        // Always shown and always interactive, even while inactive -- so
        // a cell's chain can be dialed in ahead of time, silently, and
        // switched on later with a single click instead of building it
        // from scratch under time pressure. Dimming is purely visual
        // (main.css's .dimmed-section); it never disables the controls.
        fields: effectsFields(
          () => row.cells[columnIndex].effects,
          (next) => {
            model.setCell(row, columnIndex, { effects: next });
            render();
          },
          options.onSaveEffectChainPreset,
        ),
      });
    }

    return {
      title: `Cell: ${row.config.name} × col ${columnIndex + 1}`,
      fields,
      sections,
    };
  }

  function panelContent(rows: Row[]): PanelContent {
    if (selection === null) {
      return { title: "Nothing selected", fields: [], sections: [] };
    }
    if (selection.kind === "master") {
      return {
        title: "Master",
        fields: options.buildMasterFields(),
        sections: options.buildMasterSections(),
      };
    }
    if (selection.kind === "column") {
      return columnPanel(selection.columnIndex);
    }
    const targetRowId = selection.rowId;
    const row = rows.find((r) => r.id === targetRowId);
    if (!row) {
      selection = null;
      return { title: "Nothing selected", fields: [], sections: [] };
    }
    if (selection.kind === "row") {
      return rowPanel(row);
    }
    return cellPanel(row, selection.columnIndex);
  }

  function render(): void {
    container.innerHTML = "";
    const rows = model.getRows();

    const layout = document.createElement("div");
    layout.className = "grid-layout";

    const grid = document.createElement("div");
    grid.className = "grid-table";
    grid.style.gridTemplateColumns = `120px repeat(${model.columnCount}, 34px)`;

    const corner = document.createElement("div");
    corner.className = "grid-corner";
    grid.appendChild(corner);
    model.columns.forEach((column, columnIndex) => {
      const header = document.createElement("div");
      const isSelected =
        selection?.kind === "column" && selection.columnIndex === columnIndex;
      header.className = `master-cell column-master${column.enabled ? "" : " off"}${isSelected ? " selected" : ""}`;
      header.textContent = String(columnIndex + 1);
      header.addEventListener("click", () => {
        model.setColumn(columnIndex, { enabled: !column.enabled });
        render();
      });
      header.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        select({ kind: "column", columnIndex });
      });
      grid.appendChild(header);
    });

    cellEls = [];
    // Whether *any* row is soloed right now -- drives every non-soloed
    // row's dimmed-by-solo look, distinct from that row's own mute state
    // (see fireTick's identical soloActive check for the audio side).
    const soloActive = rows.some((r) => r.isSoloed());
    for (const row of rows) {
      const rowMaster = document.createElement("div");
      const rowSelected =
        selection?.kind === "row" && selection.rowId === row.id;
      const silencedBySolo = soloActive && !row.isSoloed();
      rowMaster.className = `master-cell row-master source-${row.config.sourceType}${row.config.enabled ? "" : " off"}${silencedBySolo ? " solo-dimmed" : ""}${rowSelected ? " selected" : ""}`;
      rowMaster.title = SOURCE_TYPE_LABELS[row.config.sourceType];
      rowMaster.addEventListener("click", () => {
        model.setRowEnabled(row, !row.config.enabled);
        render();
      });
      rowMaster.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        select({ kind: "row", rowId: row.id });
      });

      const rowMasterName = document.createElement("span");
      rowMasterName.className = "row-master-name";
      rowMasterName.textContent = row.config.name;
      rowMaster.appendChild(rowMasterName);

      const soloButton = document.createElement("button");
      soloButton.className = `solo-button${row.isSoloed() ? " active" : ""}`;
      soloButton.textContent = "S";
      soloButton.title = row.isSoloed() ? "Unsolo" : "Solo (isolate this row)";
      soloButton.addEventListener("click", (event) => {
        // Solo lives in the same cell as the mute-toggle click above --
        // stopPropagation so clicking S doesn't also flip mute.
        event.stopPropagation();
        model.setRowSolo(row, !row.isSoloed());
        render();
      });
      rowMaster.appendChild(soloButton);

      grid.appendChild(rowMaster);

      const rowCellEls: HTMLDivElement[] = [];
      row.cells.forEach((cell, columnIndex) => {
        const cellEl = document.createElement("div");
        const overridden =
          cell.note !== undefined ||
          cell.gain !== undefined ||
          cell.gate !== undefined ||
          cell.timeShiftSeconds !== undefined ||
          cell.envelopeOverride ||
          cell.effectsOverride;
        const cellSelected =
          selection?.kind === "cell" &&
          selection.rowId === row.id &&
          selection.columnIndex === columnIndex;
        cellEl.className = `cell${cell.on ? " on" : ""}${overridden ? " overridden" : ""}${cellSelected ? " selected" : ""}`;
        const cellKey = `${row.id}:${columnIndex}`;
        cellEl.addEventListener("mousedown", (event) => {
          if (event.button !== 0) return;
          // Not a native drag/text-selection gesture -- this is our own
          // paint gesture, not the browser's.
          event.preventDefault();
          isDragPainting = true;
          dragPaintedCells = new Set([cellKey]);
          model.setCell(row, columnIndex, { on: !cell.on });
          render();
        });
        cellEl.addEventListener("mouseenter", () => {
          if (!isDragPainting || dragPaintedCells.has(cellKey)) return;
          dragPaintedCells.add(cellKey);
          model.setCell(row, columnIndex, { on: !cell.on });
          render();
        });
        cellEl.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          select({ kind: "cell", rowId: row.id, columnIndex });
        });
        grid.appendChild(cellEl);
        rowCellEls.push(cellEl);
      });
      cellEls.push(rowCellEls);
    }

    // Grid auto-flow places this straight into column 1 of the next
    // implicit row -- directly under the last row's own label, no
    // manual row/column math needed -- with no cell divs following it,
    // so the rest of that row just stays empty. Replaces the old
    // always-visible add-row form (select + name input + button)
    // permanently on screen below the grid with a single affordance
    // that opens openAddRowModal instead.
    const addRowEl = document.createElement("div");
    addRowEl.className = "master-cell add-row-cell";
    addRowEl.textContent = "+";
    addRowEl.title = "Add row";
    addRowEl.addEventListener("click", () => {
      openAddRowModal((sourceType, name) => {
        options.onAddRow?.(sourceType, name);
      });
    });
    grid.appendChild(addRowEl);

    const panel = document.createElement("div");
    // "selection-panel", not just "config-panel" -- the latter is a
    // shared *styling* class (background/border/padding) the new Sample/
    // Instrument Library panels also reuse (see index.html), so it alone
    // no longer uniquely identifies this one dynamic row/column/cell/
    // master panel.
    panel.className = "config-panel selection-panel";
    const { title, fields, sections, onRemove, onDuplicate } =
      panelContent(rows);

    const heading = document.createElement("div");
    heading.className = "panel-title-row";
    const headingTitle = document.createElement("span");
    headingTitle.className = "panel-title";
    headingTitle.textContent = title;
    heading.appendChild(headingTitle);
    if (onDuplicate || onRemove) {
      // Grouped in their own container -- panel-title-row's own
      // space-between expects exactly two items (title, "everything
      // else"), not one per button spread individually across the row.
      const actions = document.createElement("div");
      actions.className = "panel-title-actions";
      if (onDuplicate) {
        const duplicateButton = document.createElement("button");
        duplicateButton.className = "panel-title-icon-button";
        duplicateButton.textContent = "⧉";
        duplicateButton.title = "Duplicate row";
        duplicateButton.addEventListener("click", () => {
          onDuplicate();
        });
        actions.appendChild(duplicateButton);
      }
      if (onRemove) {
        const removeButton = document.createElement("button");
        removeButton.className =
          "panel-title-icon-button panel-title-remove-button";
        removeButton.textContent = "🗑";
        removeButton.title = "Remove row";
        removeButton.addEventListener("click", onRemove);
        actions.appendChild(removeButton);
      }
      heading.appendChild(actions);
    }
    panel.appendChild(heading);

    if (fields.length === 0 && sections.length === 0 && selection === null) {
      const hint = document.createElement("p");
      hint.className = "panel-hint";
      hint.textContent =
        "Right-click a cell, a row label, or a column header to edit it here.";
      panel.appendChild(hint);
    } else {
      renderPanelSections(panel, fields, sections);
    }

    layout.appendChild(grid);
    layout.appendChild(panel);
    container.appendChild(layout);
  }

  function refreshPlayhead(): void {
    const rawIndex = model.clock.getCurrentStepIndex();
    const active = rawIndex === null ? null : rawIndex % model.columnCount;
    const rows = model.getRows();
    rows.forEach((row, rowIndex) => {
      cellEls[rowIndex]?.forEach((cellEl, columnIndex) => {
        cellEl.classList.toggle(
          "playhead",
          columnIndex === active && row.isActive(),
        );
      });
    });
  }

  // A fraction of each numeric effect param's own *active* range span
  // (activeRangeFor -- same custom-range-aware bound Drift/Reroll chain
  // already respect), applied as a random ± delta from wherever that
  // param currently sits, clamped back into range -- a nudge, not a
  // fresh draw. Select params (filter type, LFO shape, ...) are left
  // alone entirely: a "little" nudge shouldn't suddenly swap a lowpass
  // for a highpass, unlike Reroll chain's bigger, deliberate jump.
  const MORE_LIKE_THIS_EFFECT_NUDGE_FRACTION = 0.12;

  function nudgeEffects(effects: EffectSpec[]): EffectSpec[] {
    return effects.map((spec) => {
      const table = EFFECT_TABLE.find((e) => e.type === spec.type);
      if (!table) return spec;
      const nextParams: Record<string, number | string> = { ...spec.params };
      for (const param of table.params) {
        if (param.kind === "select") continue;
        const active = activeRangeFor(spec, param);
        const span = active.max - active.min;
        if (span <= 0) continue;
        const scale = param.scale ?? 1;
        const stored = spec.params[param.key];
        const storedDisplay =
          (typeof stored === "number" ? stored : param.default) * scale;
        const delta =
          (Math.random() * 2 - 1) * span * MORE_LIKE_THIS_EFFECT_NUDGE_FRACTION;
        const nextDisplay = Math.min(
          active.max,
          Math.max(active.min, storedDisplay + delta),
        );
        nextParams[param.key] = nextDisplay / scale;
      }
      return { ...spec, params: nextParams };
    });
  }

  // Same ± nudge shape as nudgeEffects above, just against each row-level
  // scalar's own sensible span instead of an effect param's active range
  // (rows have no per-field range concept to reuse the way effects do).
  // Setters that already clamp internally (setRowProbability, setRowPan)
  // are trusted to do that; the rest (no internal clamp -- see each
  // setter's own doc for why, e.g. setRowLevel's "values outside the
  // slider's own range are still musically meaningful") get a defensive
  // bound here instead, generous enough that repeated clicks can't drift
  // a value into something nonsensical (e.g. negative gain) but without
  // re-imposing the exact slider range those setters deliberately don't.
  function nudge(value: number, amount: number): number {
    return value + (Math.random() * 2 - 1) * amount;
  }

  function moreLikeThis(): void {
    for (const row of model.getRows()) {
      const c = row.config;
      model.setRowDefaultNote(
        row,
        Math.min(127, Math.max(0, Math.round(nudge(c.defaultNote, 3)))),
      );
      model.setRowDefaultGain(row, Math.min(1, Math.max(0, nudge(c.defaultGain, 0.12))));
      model.setRowDefaultTimeShift(
        row,
        Math.min(0.1, Math.max(-0.1, nudge(c.defaultTimeShiftSeconds, 0.01))),
      );
      model.setRowProbability(row, nudge(c.probability, 0.15));
      model.setRowPan(row, nudge(c.pan, 0.2));
      model.setRowLevel(row, Math.min(2, Math.max(0, nudge(c.level, 0.12))));
      model.setRowSendLevel(row, Math.min(1, Math.max(0, nudge(c.sendLevel, 0.12))));
      model.setRowEffects(row, nudgeEffects(c.effects));

      // A minority of steps flip -- small enough that a click or two
      // still reads as "the same groove," large enough to actually
      // notice; clicking repeatedly compounds toward something new.
      row.cells.forEach((cell, i) => {
        if (Math.random() < 0.12) model.setCell(row, i, { on: !cell.on });
      });
    }
    model.setMasterGain(
      Math.min(2, Math.max(0, nudge(model.masterGain.gain.value, 0.08))),
    );
    model.setMasterEffects(nudgeEffects(model.getMasterEffects()));
    model.setSendBusEffects(nudgeEffects(model.getSendBusEffects()));
    render();
  }

  render();
  startDriftEngine(model);
  return {
    render,
    refreshPlayhead,
    selectMaster: () => select({ kind: "master" }),
    selectRow: (rowId) => select({ kind: "row", rowId }),
    getSelectedRow,
    getSelectedEffectsTarget,
    moreLikeThis,
  };
}
