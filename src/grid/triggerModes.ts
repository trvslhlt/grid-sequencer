/** All three trigger modes already work today purely through SamplePlayer's
 * existing oneShot/loop params and TrackStep's gate field -- no toolkit
 * changes needed, per PLAN.md's "Trigger modes" table. This module is just
 * the mapping from a mode choice to those existing knobs. */
export type TriggerMode =
  | { kind: "oneShotSample" }
  | { kind: "gatedToStep" }
  | { kind: "explicitDuration"; seconds: number; loop: boolean };

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

/** TrackStep.gate is a fraction of the *step's* own duration, so an
 * explicit-duration mode (which specifies seconds) needs the current step
 * length to convert -- a gate > 1 is exactly the documented "holds past
 * this step's own slot" contract (see bruit-kit's SequencerStep.gate). */
export function triggerModeGate(
  mode: TriggerMode,
  stepSeconds: number,
): number {
  switch (mode.kind) {
    case "oneShotSample":
    case "gatedToStep":
      return 1.0;
    case "explicitDuration":
      return mode.seconds / stepSeconds;
  }
}
