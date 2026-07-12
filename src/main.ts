import { getSharedLimiter, unlockAudioContext } from "./audioContext";
import type { Precedence } from "./grid/config";
import { GridModel } from "./grid/gridModel";
import { SOURCE_TYPE_LABELS, type SourceType } from "./grid/sourceFactory";
import { generateBlipBuffer } from "./sampleGen";
import { createGridView } from "./ui/gridView";

const COLUMN_COUNT = 8;

const unlockEl = document.querySelector<HTMLDivElement>("#unlock")!;
const appEl = document.querySelector<HTMLDivElement>("#app")!;
const gridEl = document.querySelector<HTMLDivElement>("#grid")!;
const playButtonEl = document.querySelector<HTMLButtonElement>("#play-button")!;
const stopButtonEl = document.querySelector<HTMLButtonElement>("#stop-button")!;
const stepSecondsEl =
  document.querySelector<HTMLInputElement>("#step-seconds")!;
const stepSecondsValueEl = document.querySelector<HTMLSpanElement>(
  "#step-seconds-value",
)!;
const precedenceSelectEl =
  document.querySelector<HTMLSelectElement>("#precedence-select")!;
const newRowTypeEl =
  document.querySelector<HTMLSelectElement>("#new-row-type")!;
const newRowNameEl = document.querySelector<HTMLInputElement>("#new-row-name")!;
const addRowButtonEl =
  document.querySelector<HTMLButtonElement>("#add-row-button")!;

for (const type of Object.keys(SOURCE_TYPE_LABELS) as SourceType[]) {
  const option = document.createElement("option");
  option.value = type;
  option.textContent = SOURCE_TYPE_LABELS[type];
  newRowTypeEl.appendChild(option);
}

unlockAudioContext(unlockEl).then(async (audioContext) => {
  unlockEl.classList.add("hidden");
  appEl.classList.remove("hidden");

  let stepSeconds = Number(stepSecondsEl.value);
  stepSecondsValueEl.textContent = stepSeconds.toFixed(2);

  const limiter = getSharedLimiter(audioContext);
  const model = new GridModel(
    audioContext,
    limiter.input,
    COLUMN_COUNT,
    stepSeconds,
  );
  const view = createGridView(gridEl, model);

  async function addRow(
    sourceType: SourceType,
    name: string,
    on: boolean[] = [],
  ): Promise<void> {
    const row = await model.addRow(sourceType, name, model.clock.isPlaying());
    on.forEach((isOn, i) => {
      if (isOn) model.setCell(row, i, { on: true });
    });
    if (sourceType === "samplePlayer") {
      const blip = generateBlipBuffer(audioContext, 300 + Math.random() * 300);
      await model.loadRowSample(row, blip);
    }
    view.render();
  }

  // Two starter rows so the grid is audible immediately -- a sample row
  // (direct/unpitched, drum-hit style) and an oscillator row.
  await addRow("samplePlayer", "Kick", [
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
  ]);
  await addRow("oscillatorSynth", "Synth", [
    false,
    true,
    false,
    true,
    false,
    false,
    true,
    false,
  ]);
  view.render();

  addRowButtonEl.addEventListener("click", async () => {
    const sourceType = newRowTypeEl.value as SourceType;
    const name = newRowNameEl.value.trim() || SOURCE_TYPE_LABELS[sourceType];
    newRowNameEl.value = "";
    await addRow(sourceType, name);
  });

  playButtonEl.addEventListener("click", () => model.clock.start());
  stopButtonEl.addEventListener("click", () => model.clock.stop());

  stepSecondsEl.addEventListener("input", () => {
    stepSeconds = Number(stepSecondsEl.value);
    stepSecondsValueEl.textContent = stepSeconds.toFixed(2);
    model.setStepSeconds(stepSeconds);
  });

  precedenceSelectEl.addEventListener("change", () => {
    model.precedence = precedenceSelectEl.value as Precedence;
  });

  function tick(): void {
    view.refreshPlayhead();
    requestAnimationFrame(tick);
  }
  tick();
});
