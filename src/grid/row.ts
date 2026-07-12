import { createStepTrack } from "bruit-kit/midi";
import type { NoteTarget, StepClock, TrackStep } from "bruit-kit/midi";

/** One row on the shared clock: a NoteTarget plus a live step pattern.
 * Never owns its own clock (see stepClock.ts's doc for why that matters
 * for add/mute/remove staying in sync) -- muting and pending activation are
 * both just local state read fresh by the same clock subscription, never a
 * subscribe/unsubscribe cycle. */
export interface GridRow {
  readonly target: NoteTarget;
  setSteps(steps: TrackStep[]): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Stays silent until the clock reaches the next tick where
   * `stepIndex % columnCount === 0` -- lets a row join mid-performance at
   * the grid's next cycle start rather than an arbitrary phase. */
  activateAtNextCycle(columnCount: number): void;
  isActive(): boolean;
  unsubscribe(): void;
}

export function createGridRow(target: NoteTarget, clock: StepClock): GridRow {
  let steps: TrackStep[] = [];
  let muted = false;
  let active = true;
  let pendingCycleLength: number | null = null;

  const stopTick = clock.onTick((stepIndex) => {
    if (pendingCycleLength !== null && stepIndex % pendingCycleLength === 0) {
      active = true;
      pendingCycleLength = null;
    }
  });

  const { unsubscribe: stopTrack } = createStepTrack(target, clock, () =>
    muted || !active ? [] : steps,
  );

  return {
    target,
    setSteps(newSteps) {
      steps = newSteps;
    },
    setMuted(value) {
      muted = value;
    },
    isMuted() {
      return muted;
    },
    activateAtNextCycle(columnCount) {
      active = false;
      pendingCycleLength = columnCount;
    },
    isActive() {
      return active;
    },
    unsubscribe() {
      stopTick();
      stopTrack();
    },
  };
}
