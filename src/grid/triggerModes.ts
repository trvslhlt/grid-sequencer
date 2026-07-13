/** All three trigger modes already work today purely through SamplePlayer's
 * existing oneShot/loop params and TrackStep's gate field -- no toolkit
 * changes needed, per PLAN.md's "Trigger modes" table. This module is just
 * the mapping from a mode choice to those existing knobs. */
export type TriggerMode =
  | { kind: "oneShotSample" }
  | { kind: "gatedToStep" }
  /** `steps` is a count of the grid's own step length, not seconds -- a
   * duration of 2 means "hold for 2 steps" at whatever the current
   * tempo/subdivision resolves a step to, so it scales with tempo changes
   * instead of needing to be re-tuned by hand every time BPM changes. */
  | { kind: "explicitDuration"; steps: number; loop: boolean };

export type TriggerModeKind = TriggerMode["kind"];

export const TRIGGER_MODE_LABELS: Record<TriggerModeKind, string> = {
  oneShotSample: "One-shot (to end of sample)",
  gatedToStep: "Gated to step",
  explicitDuration: "Explicit duration",
};

export interface TriggerModeSourceParams {
  oneShot: boolean;
  loop: boolean;
  releaseMs: number;
}

export function triggerModeSourceParams(
  mode: TriggerMode,
): TriggerModeSourceParams {
  switch (mode.kind) {
    case "oneShotSample":
      // oneShot voices play to their natural end regardless of noteOff
      // (SamplePlayer never tracks them in `voices`), so release doesn't
      // apply.
      return { oneShot: true, loop: false, releaseMs: 0 };
    case "gatedToStep":
      return { oneShot: false, loop: false, releaseMs: 30 };
    case "explicitDuration":
      return { oneShot: false, loop: mode.loop, releaseMs: 30 };
  }
}

/** TrackStep.gate is already expressed as a fraction/multiple of the
 * step's own duration -- since explicit-duration mode's `steps` is in the
 * same unit, this is a direct pass-through, no seconds/tempo conversion
 * needed. A gate > 1 is exactly the documented "holds past this step's
 * own slot" contract (see bruit-kit's SequencerStep.gate). */
export function triggerModeGate(mode: TriggerMode): number {
  switch (mode.kind) {
    case "oneShotSample":
    case "gatedToStep":
      return 1.0;
    case "explicitDuration":
      return mode.steps;
  }
}
