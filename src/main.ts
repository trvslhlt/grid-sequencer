import "bruit-kit/ui/automationEditor.css";
import { getSharedLimiter, unlockAudioContext } from "./audioContext";
import type { Precedence } from "./grid/config";
import { GridModel } from "./grid/gridModel";
import { SOURCE_TYPE_LABELS, type SourceType } from "./grid/sourceFactory";
import { generateBlipBuffer } from "./sampleGen";
import type { Field } from "./ui/fields";
import { createGridView, effectsFields } from "./ui/gridView";

const INITIAL_COLUMN_COUNT = 8;

/** subdivisionsPerBeat -- app-level tempo->seconds conversion, same
 * reasoning as PLAN.md's "Core model": the toolkit's clock works purely in
 * seconds, BPM/subdivision is entirely this app's concern. */
const SUBDIVISIONS: Array<{ label: string; value: number }> = [
  { label: "1/4 notes", value: 1 },
  { label: "1/8 notes", value: 2 },
  { label: "1/8 triplets", value: 3 },
  { label: "1/16 notes", value: 4 },
  { label: "1/16 triplets", value: 6 },
];

const unlockEl = document.querySelector<HTMLDivElement>("#unlock")!;
const appEl = document.querySelector<HTMLDivElement>("#app")!;
const gridEl = document.querySelector<HTMLDivElement>("#grid")!;
const playButtonEl = document.querySelector<HTMLButtonElement>("#play-button")!;
const stopButtonEl = document.querySelector<HTMLButtonElement>("#stop-button")!;
const masterButtonEl =
  document.querySelector<HTMLButtonElement>("#master-button")!;
const bpmEl = document.querySelector<HTMLInputElement>("#bpm")!;
const subdivisionEl =
  document.querySelector<HTMLSelectElement>("#subdivision")!;
const columnCountEl =
  document.querySelector<HTMLInputElement>("#column-count")!;
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

for (const subdivision of SUBDIVISIONS) {
  const option = document.createElement("option");
  option.value = String(subdivision.value);
  option.textContent = subdivision.label;
  if (subdivision.value === 4) option.selected = true;
  subdivisionEl.appendChild(option);
}

function computeStepSeconds(): number {
  const bpm = Math.max(1, Number(bpmEl.value));
  const subdivisionsPerBeat = Number(subdivisionEl.value);
  return 60 / bpm / subdivisionsPerBeat;
}

unlockAudioContext(unlockEl).then(async (audioContext) => {
  unlockEl.classList.add("hidden");
  appEl.classList.remove("hidden");

  const limiter = getSharedLimiter(audioContext);
  const model = new GridModel(
    audioContext,
    limiter.input,
    INITIAL_COLUMN_COUNT,
    computeStepSeconds(),
  );

  // LimiterEffect has no getter for its own params (setParams only), so
  // this app tracks the current values itself -- matching its constructor
  // defaults -- to show the real current value each time the panel
  // rebuilds rather than resetting the sliders to a hardcoded default.
  let limiterCeiling = -1;
  let limiterRelease = 0.1;

  function buildMasterFields(): Field[] {
    return [
      {
        key: "masterGain",
        label: "Gain",
        kind: "range",
        value: model.masterGain.gain.value,
        min: 0,
        max: 1.5,
        step: 0.01,
        onChange: (v) => model.setMasterGain(v),
      },
      ...effectsFields(
        () => model.getMasterEffects(),
        (next) => model.setMasterEffects(next),
      ),
      {
        key: "limiterCeiling",
        label: "Limiter ceiling (dB)",
        kind: "range",
        value: limiterCeiling,
        min: -12,
        max: 0,
        step: 0.5,
        onChange: (v) => {
          limiterCeiling = v;
          limiter.setParams({ ceiling: v });
        },
      },
      {
        key: "limiterRelease",
        label: "Limiter release (s)",
        kind: "range",
        value: limiterRelease,
        min: 0.01,
        max: 1,
        step: 0.01,
        onChange: (v) => {
          limiterRelease = v;
          limiter.setParams({ release: v });
        },
      },
    ];
  }

  const view = createGridView(gridEl, model, { buildMasterFields });

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

  bpmEl.addEventListener("input", () =>
    model.setStepSeconds(computeStepSeconds()),
  );
  subdivisionEl.addEventListener("change", () =>
    model.setStepSeconds(computeStepSeconds()),
  );

  columnCountEl.addEventListener("change", () => {
    const count = Math.round(Number(columnCountEl.value));
    if (count < 1) return;
    model.setColumnCount(count);
    view.render();
  });

  precedenceSelectEl.addEventListener("change", () => {
    model.precedence = precedenceSelectEl.value as Precedence;
    view.render();
  });

  masterButtonEl.addEventListener("click", () => view.selectMaster());

  function tick(): void {
    view.refreshPlayhead();
    requestAnimationFrame(tick);
  }
  tick();
});
