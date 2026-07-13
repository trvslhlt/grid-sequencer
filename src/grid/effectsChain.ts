import {
  CompressorEffect,
  DelayEffect,
  DistortionEffect,
  FilterEffect,
  RingModulationEffect,
  TremoloEffect,
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
  }
}

/** A single distinct effective effects config (see PLAN.md's Effects
 * section: node count is bounded by *distinct effective configs*, not
 * grid size). `dispose()` only tears down the chain's own nodes -- callers
 * are responsible for not calling it while anything still references this
 * chain (the cache below ref-counts so that's automatic). */
export interface BuiltEffectsChain extends ChainableNode {
  dispose(): void;
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
