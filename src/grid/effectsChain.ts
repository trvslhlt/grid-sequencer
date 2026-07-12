import { DelayEffect, FilterEffect, chainEffects, createSend } from "bruit-kit/audio";

/** One row's persistent insert chain: built once and connected here, never
 * torn down until the row itself is deleted -- a fresh source just
 * connect()s into `input` on each hit (see PLAN.md's Effects section for
 * why persistent beats per-hit chains: the chain's own state, e.g. delay
 * feedback, keeps evolving between hits like a real mixer insert). The
 * dry path goes straight to `dryDestination`; a separate send tap feeds a
 * variable amount into the shared reverb bus without duplicating the
 * (expensive) convolver per row. */
export interface RowEffectsChain {
  readonly input: AudioNode;
  readonly filter: FilterEffect;
  readonly delay: DelayEffect;
  setReverbSend(level: number): void;
}

export function createRowEffectsChain(
  audioContext: AudioContext,
  dryDestination: AudioNode,
  reverbBusInput: AudioNode,
  initialReverbSend = 0,
): RowEffectsChain {
  const filter = new FilterEffect(audioContext);
  const delay = new DelayEffect(audioContext);
  const chain = chainEffects(audioContext, [filter, delay]);
  chain.output.connect(dryDestination);

  const send = createSend(audioContext, reverbBusInput, initialReverbSend);
  chain.output.connect(send.input);

  return {
    input: chain.input,
    filter,
    delay,
    setReverbSend(level) {
      send.setLevel(level);
    },
  };
}
