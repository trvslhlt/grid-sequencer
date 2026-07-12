import { createStepClock } from "bruit-kit/midi";
import type { NoteTarget, StepClock } from "bruit-kit/midi";
import { createGridRow, type GridRow } from "./row";

/** One shared clock for the whole grid -- rows subscribe to it rather than
 * owning their own, so add/mute/remove never risk drifting a row out of
 * sync with the others (see bruit-kit's stepClock.ts doc). */
export interface Sequencer {
  readonly clock: StepClock;
  readonly columnCount: number;
  addRow(target: NoteTarget, joinAtNextCycle?: boolean): GridRow;
  removeRow(row: GridRow): void;
  getRows(): GridRow[];
}

export function createSequencer(
  audioContext: AudioContext,
  getStepSeconds: () => number,
  columnCount: number,
): Sequencer {
  const clock = createStepClock(audioContext, getStepSeconds);
  const rows: GridRow[] = [];

  return {
    clock,
    columnCount,
    addRow(target, joinAtNextCycle = false) {
      const row = createGridRow(target, clock);
      if (joinAtNextCycle) row.activateAtNextCycle(columnCount);
      rows.push(row);
      return row;
    },
    removeRow(row) {
      const index = rows.indexOf(row);
      if (index === -1) return;
      row.unsubscribe();
      rows.splice(index, 1);
    },
    getRows() {
      return [...rows];
    },
  };
}
