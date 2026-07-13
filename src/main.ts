import "bruit-kit/ui/automationEditor.css";
import "bruit-kit/ui/waveformRangeView.css";
import { getSharedLimiter, unlockAudioContext } from "./audioContext";
import type { Precedence } from "./grid/config";
import { GridModel, type Row } from "./grid/gridModel";
import { SOURCE_TYPE_LABELS, type SourceType } from "./grid/sourceFactory";
import { type TempoState, applyPatch, serializePatch } from "./patch";
import {
  SaveConflictError,
  listPatches,
  loadPatch,
  savePatch,
  uploadSample,
} from "./patchApi";
import { generateBlipBuffer } from "./sampleGen";
import type { Field } from "./ui/fields";
import { createGridView, effectsFields } from "./ui/gridView";

const DEMO_PATCH_NAME = "demo";

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
const patchNameEl = document.querySelector<HTMLInputElement>("#patch-name")!;
const savePatchButtonEl =
  document.querySelector<HTMLButtonElement>("#save-patch-button")!;
const patchSelectEl =
  document.querySelector<HTMLSelectElement>("#patch-select")!;
const loadPatchButtonEl =
  document.querySelector<HTMLButtonElement>("#load-patch-button")!;
const patchStatusEl = document.querySelector<HTMLSpanElement>("#patch-status")!;

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

  // Tracks, per row id, the backend sampleId (if any) its currently-loaded
  // buffer came from -- persistence-specific bookkeeping that doesn't
  // belong on RowConfig itself (GridModel stays entirely unaware the
  // backend/patches exist at all), read by serializePatch and populated by
  // applyPatch and the onSampleLoaded hook below (see patch.ts's doc
  // comment).
  const rowSampleIds = new Map<string, string>();

  const view = createGridView(gridEl, model, {
    buildMasterFields,
    onSampleLoaded: (row, buffer) => {
      uploadSample(buffer, row.config.name)
        .then((meta) => rowSampleIds.set(row.id, meta.id))
        .catch((err) => console.error("Failed to upload sample:", err));
    },
  });

  async function addRow(
    sourceType: SourceType,
    name: string,
    on: boolean[] = [],
  ): Promise<Row> {
    const row = await model.addRow(sourceType, name, model.clock.isPlaying());
    on.forEach((isOn, i) => {
      if (isOn) model.setCell(row, i, { on: true });
    });
    if (sourceType === "samplePlayer") {
      const blip = generateBlipBuffer(audioContext, 300 + Math.random() * 300);
      await model.loadRowSample(row, blip);
    }
    view.render();
    return row;
  }

  function currentTempoState(): TempoState {
    return {
      bpm: Number(bpmEl.value),
      subdivision: Number(subdivisionEl.value),
      limiterCeiling,
      limiterRelease,
    };
  }

  function applyTempoState(state: TempoState): void {
    bpmEl.value = String(state.bpm);
    subdivisionEl.value = String(state.subdivision);
    limiterCeiling = state.limiterCeiling;
    limiterRelease = state.limiterRelease;
    limiter.setParams({ ceiling: limiterCeiling, release: limiterRelease });
    model.setStepSeconds(computeStepSeconds());
  }

  // applyPatch already updates model.precedence/columnCount directly (see
  // patch.ts) -- this just syncs the two top-bar controls that mirror
  // them, which nothing else does automatically since they're plain
  // change-event-driven inputs, not read from the model on every render.
  function syncTopBarFromModel(): void {
    precedenceSelectEl.value = model.precedence;
    columnCountEl.value = String(model.columnCount);
  }

  async function refreshPatchList(): Promise<void> {
    const previouslySelected = patchSelectEl.value;
    const patches = await listPatches();
    patchSelectEl.innerHTML = "";
    for (const patch of patches) {
      const option = document.createElement("option");
      option.value = patch.id;
      option.textContent = patch.name;
      patchSelectEl.appendChild(option);
    }
    if (patches.some((p) => p.id === previouslySelected)) {
      patchSelectEl.value = previouslySelected;
    }
  }

  // The "demo" patch is what loads by default -- seeded into the backend
  // exactly once, the first time this app ever runs against a fresh
  // backend (every later boot finds it already there and skips straight
  // to loading it). Seeding builds the same 2-row starter content this
  // app has always shipped, uploads Kick's synthesized blip as a real
  // sample (so it round-trips through storage like any other sample would
  // -- there's no special-cased "regenerate this in JS" path on load), and
  // saves it under the protected name.
  async function seedDemoIfMissing(): Promise<void> {
    if ((await listPatches()).some((p) => p.name === DEMO_PATCH_NAME)) return;

    const kickRow = await addRow("samplePlayer", "Kick", [
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

    const kickBuffer = model.getRowSampleBuffer(kickRow);
    if (kickBuffer) {
      const uploaded = await uploadSample(kickBuffer, "Kick blip");
      rowSampleIds.set(kickRow.id, uploaded.id);
    }

    const patchData = serializePatch(model, currentTempoState(), rowSampleIds);
    await savePatch({ ...patchData, name: DEMO_PATCH_NAME });
  }

  await seedDemoIfMissing();
  const demoSummary = (await listPatches()).find(
    (p) => p.name === DEMO_PATCH_NAME,
  );
  if (demoSummary) {
    const demo = await loadPatch(demoSummary.id);
    applyTempoState(await applyPatch(model, audioContext, demo, rowSampleIds));
    syncTopBarFromModel();
    patchNameEl.value = demo.name;
  }
  await refreshPatchList();
  view.render();

  addRowButtonEl.addEventListener("click", async () => {
    const sourceType = newRowTypeEl.value as SourceType;
    const name = newRowNameEl.value.trim() || SOURCE_TYPE_LABELS[sourceType];
    newRowNameEl.value = "";
    await addRow(sourceType, name);
  });

  savePatchButtonEl.addEventListener("click", async () => {
    const name = patchNameEl.value.trim();
    if (!name) {
      patchStatusEl.textContent = "Enter a name first";
      return;
    }
    const patchData = serializePatch(model, currentTempoState(), rowSampleIds);
    try {
      await savePatch({ ...patchData, name });
    } catch (err) {
      if (err instanceof SaveConflictError) {
        if (err.status === 403) {
          patchStatusEl.textContent =
            "Can't overwrite the demo patch — choose a different name";
          return;
        }
        if (!window.confirm(`"${name}" already exists. Overwrite?`)) return;
        await savePatch({ ...patchData, name }, { overwrite: true });
      } else {
        patchStatusEl.textContent = "Save failed — try again";
        return;
      }
    }
    await refreshPatchList();
    patchStatusEl.textContent = "Saved";
  });

  loadPatchButtonEl.addEventListener("click", async () => {
    const id = patchSelectEl.value;
    if (!id) return;
    if (!window.confirm("Loading will replace the current grid. Continue?")) {
      return;
    }
    const patchData = await loadPatch(id);
    applyTempoState(
      await applyPatch(model, audioContext, patchData, rowSampleIds),
    );
    syncTopBarFromModel();
    patchNameEl.value = patchData.name;
    view.render();
    patchStatusEl.textContent = "Loaded";
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
