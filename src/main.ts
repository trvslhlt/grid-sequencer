import { ReverbEffect } from "bruit-kit/audio";
import { SamplePlayer } from "bruit-kit/sources";
import type { TrackStep } from "bruit-kit/midi";
import { getSharedLimiter, unlockAudioContext } from "./audioContext";
import { generateBlipBuffer } from "./sampleGen";
import { createSequencer } from "./grid/sequencer";
import { createRowEffectsChain, type RowEffectsChain } from "./grid/effectsChain";
import {
  type TriggerMode,
  triggerModeGate,
  triggerModeSourceParams,
} from "./grid/triggerModes";

const COLUMN_COUNT = 8;

const TRIGGER_MODE_LABELS: Record<TriggerMode["kind"], string> = {
  oneShotSample: "One-shot (to end of sample)",
  gatedToStep: "Gated to step",
  explicitDuration: "Explicit duration",
};

interface HarnessRow {
  id: string;
  name: string;
  rootNote: number;
  on: boolean[];
  /** Only column 0 is exposed as an adjustable nudge in this harness --
   * enough to prove SequencerStep/TrackStep.timeShiftSeconds shifts one
   * step without dragging every later step's timing with it. */
  step0ShiftSeconds: number;
  muted: boolean;
  triggerMode: TriggerMode;
  cellsEl: HTMLDivElement[];
  player: SamplePlayer;
  effects: RowEffectsChain;
}

function renderRow(
  container: HTMLElement,
  row: HarnessRow,
  handlers: {
    onToggleCell: (index: number) => void;
    onToggleMute: (muted: boolean) => void;
    onTriggerModeChange: (kind: TriggerMode["kind"]) => void;
    onExplicitDurationChange: (seconds: number) => void;
    onStep0ShiftChange: (ms: number) => void;
    onFilterCutoffChange: (hz: number) => void;
    onReverbSendChange: (level: number) => void;
  },
): void {
  const rowEl = document.createElement("div");
  rowEl.className = "row";

  const header = document.createElement("div");
  header.className = "row-header";

  const label = document.createElement("strong");
  label.textContent = row.name;
  header.appendChild(label);

  const muteLabel = document.createElement("label");
  const muteInput = document.createElement("input");
  muteInput.type = "checkbox";
  muteInput.addEventListener("change", () =>
    handlers.onToggleMute(muteInput.checked),
  );
  muteLabel.appendChild(muteInput);
  muteLabel.append(" mute");
  header.appendChild(muteLabel);

  const modeSelect = document.createElement("select");
  for (const kind of Object.keys(TRIGGER_MODE_LABELS) as TriggerMode["kind"][]) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = TRIGGER_MODE_LABELS[kind];
    if (kind === row.triggerMode.kind) option.selected = true;
    modeSelect.appendChild(option);
  }
  modeSelect.addEventListener("change", () =>
    handlers.onTriggerModeChange(modeSelect.value as TriggerMode["kind"]),
  );
  header.appendChild(modeSelect);

  const durationLabel = document.createElement("label");
  durationLabel.append("dur (s) ");
  const durationInput = document.createElement("input");
  durationInput.type = "number";
  durationInput.min = "0.05";
  durationInput.max = "3";
  durationInput.step = "0.05";
  durationInput.value =
    row.triggerMode.kind === "explicitDuration"
      ? String(row.triggerMode.seconds)
      : "0.5";
  durationInput.style.width = "4rem";
  durationInput.addEventListener("input", () =>
    handlers.onExplicitDurationChange(Number(durationInput.value)),
  );
  durationLabel.appendChild(durationInput);
  header.appendChild(durationLabel);

  const status = document.createElement("span");
  status.className = "row-status";
  status.id = `status-${row.id}`;
  header.appendChild(status);

  rowEl.appendChild(header);

  const cellsEl = document.createElement("div");
  cellsEl.className = "cells";
  row.cellsEl = row.on.map((isOn, i) => {
    const cell = document.createElement("div");
    cell.className = `cell${isOn ? " on" : ""}`;
    cell.textContent = String(i + 1);
    cell.addEventListener("click", () => handlers.onToggleCell(i));
    cellsEl.appendChild(cell);
    return cell;
  });
  rowEl.appendChild(cellsEl);

  const controls = document.createElement("div");
  controls.className = "row-header";
  controls.style.marginTop = "0.5rem";

  const shiftLabel = document.createElement("label");
  shiftLabel.append("step 1 nudge (ms) ");
  const shiftInput = document.createElement("input");
  shiftInput.type = "range";
  shiftInput.min = "-100";
  shiftInput.max = "100";
  shiftInput.step = "5";
  shiftInput.value = String(row.step0ShiftSeconds * 1000);
  shiftInput.addEventListener("input", () =>
    handlers.onStep0ShiftChange(Number(shiftInput.value)),
  );
  shiftLabel.appendChild(shiftInput);
  controls.appendChild(shiftLabel);

  const filterLabel = document.createElement("label");
  filterLabel.append("filter cutoff (Hz) ");
  const filterInput = document.createElement("input");
  filterInput.type = "range";
  filterInput.min = "200";
  filterInput.max = "8000";
  filterInput.step = "50";
  filterInput.value = "8000";
  filterInput.addEventListener("input", () =>
    handlers.onFilterCutoffChange(Number(filterInput.value)),
  );
  filterLabel.appendChild(filterInput);
  controls.appendChild(filterLabel);

  const reverbLabel = document.createElement("label");
  reverbLabel.append("reverb send ");
  const reverbInput = document.createElement("input");
  reverbInput.type = "range";
  reverbInput.min = "0";
  reverbInput.max = "1";
  reverbInput.step = "0.01";
  reverbInput.value = "0";
  reverbInput.addEventListener("input", () =>
    handlers.onReverbSendChange(Number(reverbInput.value)),
  );
  reverbLabel.appendChild(reverbInput);
  controls.appendChild(reverbLabel);

  rowEl.appendChild(controls);

  container.appendChild(rowEl);
}

function toTrackSteps(row: HarnessRow, stepSeconds: number): TrackStep[] {
  const gate = triggerModeGate(row.triggerMode, stepSeconds);
  return row.on.map((isOn, i) => ({
    notes: isOn ? [row.rootNote] : [],
    velocity: 100,
    gate,
    timeShiftSeconds: i === 0 ? row.step0ShiftSeconds : 0,
  }));
}

const unlockEl = document.querySelector<HTMLDivElement>("#unlock")!;
const appEl = document.querySelector<HTMLDivElement>("#app")!;
const rowsEl = document.querySelector<HTMLDivElement>("#rows")!;
const playButtonEl = document.querySelector<HTMLButtonElement>("#play-button")!;
const stopButtonEl = document.querySelector<HTMLButtonElement>("#stop-button")!;
const addRowButtonEl = document.querySelector<HTMLButtonElement>(
  "#add-row-button",
)!;
const stepSecondsEl = document.querySelector<HTMLInputElement>("#step-seconds")!;
const stepSecondsValueEl = document.querySelector<HTMLSpanElement>(
  "#step-seconds-value",
)!;

unlockAudioContext(unlockEl).then((audioContext) => {
  unlockEl.classList.add("hidden");
  appEl.classList.remove("hidden");

  let stepSeconds = Number(stepSecondsEl.value);
  stepSecondsValueEl.textContent = stepSeconds.toFixed(2);
  const sequencer = createSequencer(
    audioContext,
    () => stepSeconds,
    COLUMN_COUNT,
  );

  // One shared, fully-wet reverb bus -- the one genuinely expensive
  // (ConvolverNode) node type in the toolkit, so every row sends a
  // variable amount into this single instance rather than owning its own.
  const reverb = new ReverbEffect(audioContext);
  reverb.setParams({ wet: 1, decaySeconds: 2.2 });
  const limiter = getSharedLimiter(audioContext);
  reverb.output.connect(limiter.input);

  const initialRowDefs: Array<Omit<HarnessRow, "cellsEl" | "player" | "effects">> = [
    {
      id: "a",
      name: "Row A",
      rootNote: 60,
      on: [true, false, true, false, true, false, true, false],
      step0ShiftSeconds: 0,
      muted: false,
      triggerMode: { kind: "gatedToStep" },
    },
    {
      id: "b",
      name: "Row B",
      rootNote: 64,
      on: [false, true, false, true, false, false, true, false],
      step0ShiftSeconds: 0,
      muted: false,
      triggerMode: { kind: "oneShotSample" },
    },
  ];
  const rowDefs: HarnessRow[] = [];

  const gridRows = new Map<string, ReturnType<typeof sequencer.addRow>>();

  function rebuildSteps(row: HarnessRow, gridRow: ReturnType<typeof sequencer.addRow>): void {
    gridRow.setSteps(toTrackSteps(row, stepSeconds));
  }

  function wireRow(
    rowInit: Omit<HarnessRow, "cellsEl" | "player" | "effects">,
  ): void {
    const player = new SamplePlayer(audioContext);
    player.loadSample(
      generateBlipBuffer(audioContext, 220 + rowInit.rootNote * 4),
    );
    const sourceParams = triggerModeSourceParams(rowInit.triggerMode);
    player.setParams({ rootNote: rowInit.rootNote, ...sourceParams });

    // Persistent per-row chain, built once here and never torn down until
    // the row is removed -- each noteOn just connects a fresh voice into
    // player.output, which stays wired into this same chain.
    const effects = createRowEffectsChain(
      audioContext,
      limiter.input,
      reverb.input,
    );
    player.output.connect(effects.input);

    const row: HarnessRow = { ...rowInit, cellsEl: [], player, effects };
    rowDefs.push(row);

    const gridRow = sequencer.addRow(player, row.id === "c");
    rebuildSteps(row, gridRow);
    gridRows.set(row.id, gridRow);

    renderRow(rowsEl, row, {
      onToggleCell: (index) => {
        row.on[index] = !row.on[index];
        row.cellsEl[index].classList.toggle("on", row.on[index]);
        rebuildSteps(row, gridRow);
      },
      onToggleMute: (muted) => {
        row.muted = muted;
        gridRow.setMuted(muted);
      },
      onTriggerModeChange: (kind) => {
        row.triggerMode =
          kind === "explicitDuration"
            ? { kind, seconds: 0.5, loop: false }
            : { kind };
        player.setParams(triggerModeSourceParams(row.triggerMode));
        rebuildSteps(row, gridRow);
      },
      onExplicitDurationChange: (seconds) => {
        if (row.triggerMode.kind !== "explicitDuration") return;
        row.triggerMode = { ...row.triggerMode, seconds };
        rebuildSteps(row, gridRow);
      },
      onStep0ShiftChange: (ms) => {
        row.step0ShiftSeconds = ms / 1000;
        rebuildSteps(row, gridRow);
      },
      onFilterCutoffChange: (hz) => {
        effects.filter.setParams({ wet: 1, frequency: hz });
      },
      onReverbSendChange: (level) => {
        effects.setReverbSend(level);
      },
    });

    if (row.id === "c") {
      const statusEl = document.querySelector<HTMLSpanElement>(
        `#status-${row.id}`,
      )!;
      statusEl.textContent = "pending — joins at next cycle";
      const stop = sequencer.clock.onTick(() => {
        if (gridRow.isActive()) {
          statusEl.textContent = "";
          stop();
        }
      });
    }
  }

  for (const row of initialRowDefs) wireRow(row);

  let rowCCount = 0;
  addRowButtonEl.addEventListener("click", () => {
    if (rowCCount > 0) return;
    rowCCount++;
    wireRow({
      id: "c",
      name: "Row C",
      rootNote: 67,
      on: [true, true, false, false, true, true, false, false],
      step0ShiftSeconds: 0,
      muted: false,
      triggerMode: { kind: "explicitDuration", seconds: 0.5, loop: false },
    });
    addRowButtonEl.disabled = true;
  });

  playButtonEl.addEventListener("click", () => sequencer.clock.start());
  stopButtonEl.addEventListener("click", () => sequencer.clock.stop());

  stepSecondsEl.addEventListener("input", () => {
    stepSeconds = Number(stepSecondsEl.value);
    stepSecondsValueEl.textContent = stepSeconds.toFixed(2);
    // Explicit-duration rows express gate as seconds/stepSeconds, so a
    // step-length change has to re-derive that fraction for every row.
    for (const row of rowDefs) {
      const gridRow = gridRows.get(row.id);
      if (gridRow) rebuildSteps(row, gridRow);
    }
  });

  function tick(): void {
    const rawIndex = sequencer.clock.getCurrentStepIndex();
    const active = rawIndex === null ? null : rawIndex % COLUMN_COUNT;
    for (const row of rowDefs) {
      const gridRow = gridRows.get(row.id);
      if (!gridRow) continue;
      row.cellsEl.forEach((cell, i) => {
        cell.classList.toggle("playhead", i === active && gridRow.isActive());
      });
    }
    requestAnimationFrame(tick);
  }
  tick();
});
