import { SamplePlayer } from "bruit-kit/sources";
import type { TrackStep } from "bruit-kit/midi";
import { connectToOutput, unlockAudioContext } from "./audioContext";
import { generateBlipBuffer } from "./sampleGen";
import { createSequencer } from "./grid/sequencer";

const COLUMN_COUNT = 8;

interface HarnessRow {
  id: string;
  name: string;
  rootNote: number;
  on: boolean[];
  muted: boolean;
  cellsEl: HTMLDivElement[];
}

function renderRow(
  container: HTMLElement,
  row: HarnessRow,
  onToggleCell: (index: number) => void,
  onToggleMute: (muted: boolean) => void,
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
  muteInput.addEventListener("change", () => onToggleMute(muteInput.checked));
  muteLabel.appendChild(muteInput);
  muteLabel.append(" mute");
  header.appendChild(muteLabel);

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
    cell.addEventListener("click", () => onToggleCell(i));
    cellsEl.appendChild(cell);
    return cell;
  });
  rowEl.appendChild(cellsEl);

  container.appendChild(rowEl);
}

function toTrackSteps(row: HarnessRow): TrackStep[] {
  return row.on.map((isOn) => ({
    notes: isOn ? [row.rootNote] : [],
    velocity: 100,
    gate: 0.7,
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
const reverbSendEl = document.querySelector<HTMLInputElement>("#reverb-send")!;

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

  const initialRowDefs: HarnessRow[] = [
    {
      id: "a",
      name: "Row A",
      rootNote: 60,
      on: [true, false, true, false, true, false, true, false],
      muted: false,
      cellsEl: [],
    },
    {
      id: "b",
      name: "Row B",
      rootNote: 64,
      on: [false, true, false, true, false, false, true, false],
      muted: false,
      cellsEl: [],
    },
  ];
  const rowDefs: HarnessRow[] = [];

  const gridRows = new Map<string, ReturnType<typeof sequencer.addRow>>();

  function wireRow(row: HarnessRow): void {
    rowDefs.push(row);
    const player = new SamplePlayer(audioContext);
    player.loadSample(generateBlipBuffer(audioContext, 220 + row.rootNote * 4));
    player.setParams({ rootNote: row.rootNote, oneShot: false });
    connectToOutput(player.output, audioContext);

    const gridRow = sequencer.addRow(player, row.id === "c");
    gridRow.setSteps(toTrackSteps(row));
    gridRows.set(row.id, gridRow);

    renderRow(
      rowsEl,
      row,
      (index) => {
        row.on[index] = !row.on[index];
        row.cellsEl[index].classList.toggle("on", row.on[index]);
        gridRow.setSteps(toTrackSteps(row));
      },
      (muted) => {
        row.muted = muted;
        gridRow.setMuted(muted);
      },
    );

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
      muted: false,
      cellsEl: [],
    });
    addRowButtonEl.disabled = true;
  });

  playButtonEl.addEventListener("click", () => sequencer.clock.start());
  stopButtonEl.addEventListener("click", () => sequencer.clock.stop());

  stepSecondsEl.addEventListener("input", () => {
    stepSeconds = Number(stepSecondsEl.value);
    stepSecondsValueEl.textContent = stepSeconds.toFixed(2);
  });

  reverbSendEl.addEventListener("input", () => {
    // Wired up once step 6 adds the shared reverb bus; no-op for now.
  });

  function tick(): void {
    const rawIndex = sequencer.clock.getCurrentStepIndex();
    const active = rawIndex === null ? null : rawIndex % COLUMN_COUNT;
    for (const [id, gridRow] of gridRows) {
      const row = rowDefs.find((r) => r.id === id);
      if (!row) continue;
      row.cellsEl.forEach((cell, i) => {
        cell.classList.toggle("playhead", i === active && gridRow.isActive());
      });
    }
    requestAnimationFrame(tick);
  }
  tick();
});
