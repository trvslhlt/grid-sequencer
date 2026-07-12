import type { NoteTarget } from "bruit-kit/midi";
import {
  FmSynth,
  GranularSynth,
  NoiseGenerator,
  OscillatorSynth,
  SamplePlayer,
} from "bruit-kit/sources";

export type SourceType =
  | "samplePlayer"
  | "oscillatorSynth"
  | "fmSynth"
  | "noiseGenerator"
  | "granularSynth";

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  samplePlayer: "Sample player",
  oscillatorSynth: "Oscillator synth",
  fmSynth: "FM synth",
  noiseGenerator: "Noise generator",
  granularSynth: "Granular synth",
};

export interface ParamField {
  key: string;
  label: string;
  kind: "range" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  default: number | string;
}

/** Wraps one of the 5 sources/ classes behind a uniform shape so the grid
 * model doesn't need a switch statement per operation -- every class
 * already shares the NoteTarget + setParams(Partial<Params>) shape (see
 * PLAN.md's Core model: "Row = one source instance, any sources/ class"),
 * this just adds the handful of things that genuinely differ (sample
 * loading, GranularSynth's async worklet init, which knobs make sense to
 * expose per type). */
export interface RowSource {
  target: NoteTarget;
  output: AudioNode;
  setParams(params: Record<string, unknown>): void;
  /** The underlying sources/ classes are setParams-only (no getter), so
   * this is this wrapper's own tracked copy -- otherwise a param menu
   * would have no way to show its *current* value rather than always
   * falling back to paramFields' static default on every reopen. */
  getParams(): Record<string, unknown>;
  paramFields: ParamField[];
  needsSample: boolean;
  loadSample?(buffer: AudioBuffer): void | Promise<void>;
  /** Only GranularSynth needs this -- loads its AudioWorkletProcessor
   * before any noteOn will produce sound. */
  init?(): Promise<void>;
}

function toRowSource<T extends NoteTarget & { output: AudioNode }>(
  instance: T,
  applyParams: (params: Record<string, unknown>) => void,
  paramFields: ParamField[],
  extra: Partial<Pick<RowSource, "needsSample" | "loadSample" | "init">> = {},
): RowSource {
  const currentParams: Record<string, unknown> = Object.fromEntries(
    paramFields.map((field) => [field.key, field.default]),
  );
  return {
    target: instance,
    output: instance.output,
    setParams(params) {
      Object.assign(currentParams, params);
      applyParams(params);
    },
    getParams() {
      return { ...currentParams };
    },
    paramFields,
    needsSample: extra.needsSample ?? false,
    loadSample: extra.loadSample,
    init: extra.init,
  };
}

export function createRowSource(
  audioContext: AudioContext,
  type: SourceType,
): RowSource {
  switch (type) {
    case "samplePlayer": {
      const player = new SamplePlayer(audioContext);
      return toRowSource(player, (p) => player.setParams(p), [], {
        needsSample: true,
        loadSample: (buffer) => player.loadSample(buffer),
      });
    }
    case "oscillatorSynth": {
      const synth = new OscillatorSynth(audioContext);
      return toRowSource(synth, (p) => synth.setParams(p), [
        {
          key: "waveform",
          label: "Waveform",
          kind: "select",
          options: ["sine", "square", "sawtooth", "triangle"],
          default: "sawtooth",
        },
        {
          key: "detune",
          label: "Detune (cents)",
          kind: "range",
          min: -100,
          max: 100,
          step: 1,
          default: 0,
        },
      ]);
    }
    case "fmSynth": {
      const synth = new FmSynth(audioContext);
      return toRowSource(synth, (p) => synth.setParams(p), [
        {
          key: "harmonicity",
          label: "Harmonicity",
          kind: "range",
          min: 0.5,
          max: 8,
          step: 0.1,
          default: 2,
        },
        {
          key: "modulationIndex",
          label: "Mod index (Hz)",
          kind: "range",
          min: 0,
          max: 500,
          step: 5,
          default: 100,
        },
      ]);
    }
    case "noiseGenerator": {
      const noise = new NoiseGenerator(audioContext);
      return toRowSource(noise, (p) => noise.setParams(p), [
        {
          key: "type",
          label: "Color",
          kind: "select",
          options: ["white", "pink", "brown"],
          default: "white",
        },
      ]);
    }
    case "granularSynth": {
      const synth = new GranularSynth(audioContext);
      return toRowSource(
        synth,
        (p) => synth.setParams(p),
        [
          {
            key: "densityHz",
            label: "Grain density (Hz)",
            kind: "range",
            min: 5,
            max: 60,
            step: 1,
            default: 20,
          },
          {
            key: "pitchJitterCents",
            label: "Pitch jitter (cents)",
            kind: "range",
            min: 0,
            max: 200,
            step: 5,
            default: 0,
          },
        ],
        {
          needsSample: true,
          loadSample: (buffer) => synth.loadSample(buffer),
          init: () => synth.init(),
        },
      );
    }
  }
}
