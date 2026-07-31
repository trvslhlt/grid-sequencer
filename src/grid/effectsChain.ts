import {
  AutoWahEffect,
  BitcrusherEffect,
  ChorusEffect,
  CompressorEffect,
  DelayEffect,
  DistortionEffect,
  FilterEffect,
  FlangerEffect,
  FoldbackDistortionEffect,
  FuzzEffect,
  GainEffect,
  HardClipEffect,
  OverdriveEffect,
  ParametricWaveshaperEffect,
  PhaserEffect,
  PitchShiftEffect,
  RectifierEffect,
  ReverbEffect,
  RingModulationEffect,
  SampleRateReducerEffect,
  SoftClipEffect,
  TapeSaturationEffect,
  TremoloEffect,
  WaveFolderEffect,
  chainEffects,
} from "bruit-kit/audio";
import type { ChainableNode } from "bruit-kit/audio";
import type { EffectSpec } from "./config";

function instantiateEffect(
  audioContext: AudioContext,
  spec: EffectSpec,
): ChainableNode {
  switch (spec.type) {
    case "filter": {
      const fx = new FilterEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "gain": {
      const fx = new GainEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "delay": {
      // Not wet:1 like the others: createDryWet zeroes the dry path
      // entirely at wet 1 (dryGain.gain.value = 1 - wet), and a DelayNode
      // emits nothing until its own delay time has elapsed -- for a short
      // or percussive note (shorter than the delay time), that's total
      // silence until an echo that may never arrive, not just "no dry
      // signal." Delay is the one effect here where full-wet is actually
      // broken, not just a stylistic choice; a fixed default blend keeps
      // the dry hit always audible with the echo mixed underneath.
      const fx = new DelayEffect(audioContext);
      fx.setParams({ wet: 0.35, ...spec.params });
      return fx;
    }
    case "distortion": {
      const fx = new DistortionEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "compressor": {
      const fx = new CompressorEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "tremolo": {
      const fx = new TremoloEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "ringMod": {
      const fx = new RingModulationEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "chorus": {
      const fx = new ChorusEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "flanger": {
      const fx = new FlangerEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "phaser": {
      const fx = new PhaserEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "autoWah": {
      const fx = new AutoWahEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "bitcrusher": {
      const fx = new BitcrusherEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "reverb": {
      const fx = new ReverbEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "pitchShift": {
      // Unlike every other effect here, this one requires the caller to
      // have already awaited preloadPitchShiftWorklet(audioContext) for
      // this exact context (real-time or offline) -- see PitchShiftEffect's
      // own doc comment for why its constructor can't do that lazily the
      // way GranularSynth's async init() does. main.ts preloads once on
      // the shared real-time AudioContext at startup; sampleEditorModal.ts's
      // renderEffectsOffline preloads on its own fresh OfflineAudioContext
      // whenever pitchShift appears among the effects being baked.
      const fx = new PitchShiftEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "softClip": {
      const fx = new SoftClipEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "hardClip": {
      const fx = new HardClipEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "overdrive": {
      const fx = new OverdriveEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "waveFolder": {
      const fx = new WaveFolderEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "fuzz": {
      const fx = new FuzzEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "foldbackDistortion": {
      const fx = new FoldbackDistortionEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "rectifier": {
      const fx = new RectifierEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "tapeSaturation": {
      const fx = new TapeSaturationEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "sampleRateReducer": {
      // Same worklet-preload requirement as pitchShift above -- see
      // preloadSampleRateReducerWorklet's own doc comment. main.ts
      // preloads it alongside pitchShift's own worklet at startup;
      // sampleEditorModal.ts's renderEffectsOffline preloads it on each
      // fresh OfflineAudioContext whenever sampleRateReducer appears
      // among the effects being baked.
      const fx = new SampleRateReducerEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
    case "parametricWaveshaper": {
      const fx = new ParametricWaveshaperEffect(audioContext);
      fx.setParams({ wet: 1, ...spec.params });
      return fx;
    }
  }
}

/** A single distinct effective effects config (see PLAN.md's Effects
 * section: node count is bounded by *distinct effective configs*, not
 * grid size). `dispose()` only tears down the chain's own nodes -- callers
 * are responsible for not calling it while anything still references this
 * chain (the cache below ref-counts so that's automatic). */
export interface BuiltEffectsChain extends ChainableNode {
  dispose(): void;
  /** Live-nudges one already-instantiated effect's params in place --
   * bypasses the normal rebuild-the-whole-chain path (a fresh
   * buildEffectsChain call via setRowEffects/setMasterEffects/
   * setSendBusEffects), for a caller that needs to update a running
   * effect smoothly and often (see gridView.ts's drift engine) without
   * paying a disconnect/reconnect click at that frequency. `index`
   * matches the position in the same `specs` array this chain was built
   * from -- a stale index (chain since rebuilt with fewer effects) is a
   * harmless no-op, not an error, since a drift engine tick always reads
   * fresh state anyway and will simply stop applying next tick. */
  setParamsAt(index: number, params: Record<string, number | string>): void;
}

export function buildEffectsChain(
  audioContext: AudioContext,
  specs: EffectSpec[],
): BuiltEffectsChain {
  const nodes = specs.map((spec) => instantiateEffect(audioContext, spec));
  const chain = chainEffects(audioContext, nodes);
  return {
    input: chain.input,
    output: chain.output,
    dispose() {
      chain.input.disconnect();
      chain.output.disconnect();
    },
    setParamsAt(index, params) {
      const node = nodes[index] as
        | (ChainableNode & {
            setParams?: (p: Record<string, number | string>) => void;
          })
        | undefined;
      node?.setParams?.(params);
    },
  };
}

/** Caches persistent chains by their effects config so two rows/cells that
 * resolve to the identical effective config (the common case -- most cells
 * inherit their row's chain untouched) share one chain instance instead of
 * building a duplicate. Ref-counted so a chain is torn down once nothing
 * references it any more (a row deleted, or a cell's override cleared). */
export interface EffectsChainCache {
  acquire(specs: EffectSpec[]): BuiltEffectsChain;
  release(specs: EffectSpec[]): void;
}

export function createEffectsChainCache(
  audioContext: AudioContext,
  dryDestination: AudioNode,
): EffectsChainCache {
  const entries = new Map<
    string,
    { chain: BuiltEffectsChain; refCount: number }
  >();

  return {
    acquire(specs) {
      const key = JSON.stringify(specs);
      const existing = entries.get(key);
      if (existing) {
        existing.refCount++;
        return existing.chain;
      }
      const chain = buildEffectsChain(audioContext, specs);
      chain.output.connect(dryDestination);
      entries.set(key, { chain, refCount: 1 });
      return chain;
    },
    release(specs) {
      const key = JSON.stringify(specs);
      const entry = entries.get(key);
      if (!entry) return;
      entry.refCount--;
      if (entry.refCount <= 0) {
        entry.chain.dispose();
        entries.delete(key);
      }
    },
  };
}
