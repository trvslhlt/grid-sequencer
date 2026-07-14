import "bruit-kit/ui/automationEditor.css";
import "bruit-kit/ui/waveformRangeView.css";
import { Recorder } from "bruit-kit/audio";
import { getSharedLimiter, unlockAudioContext } from "./audioContext";
import type { Precedence } from "./grid/config";
import { GridModel, type Row } from "./grid/gridModel";
import { KEY_LABELS, SCALE_LABELS, type ScaleType } from "./grid/scale";
import {
  PARAM_FIELDS_BY_SOURCE_TYPE,
  SOURCE_TYPE_LABELS,
  type SourceType,
} from "./grid/sourceFactory";
import { type TempoState, applyPatch, serializePatch } from "./patch";
import {
  type InstrumentPreset,
  SAMPLE_CATEGORIES,
  type SampleMetadata,
  SaveConflictError,
  createInstrumentPreset,
  deleteInstrumentPreset,
  deleteSample,
  fetchSampleAudio,
  listInstrumentPresets,
  listPatches,
  listSamples,
  loadPatch,
  savePatch,
  updateInstrumentPreset,
  updateSample,
  uploadSample,
} from "./patchApi";
import { generateBlipBuffer } from "./sampleGen";
import { type Field, renderFields } from "./ui/fields";
import { createGridView, effectsFields } from "./ui/gridView";
import { type TreeGroup, renderLibraryTree } from "./ui/libraryTree";
import { encodeWav } from "./wavEncoder";

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
const manageLibraryButtonEl = document.querySelector<HTMLButtonElement>(
  "#manage-library-button",
)!;
const sequencerViewEl =
  document.querySelector<HTMLDivElement>("#sequencer-view")!;
const libraryManagementViewEl = document.querySelector<HTMLDivElement>(
  "#library-management-view",
)!;
const sampleLibraryEl =
  document.querySelector<HTMLDivElement>("#sample-library")!;
const instrumentLibraryEl = document.querySelector<HTMLDivElement>(
  "#instrument-library",
)!;
const addSampleButtonEl =
  document.querySelector<HTMLButtonElement>("#add-sample-button")!;
const sampleManagementEl =
  document.querySelector<HTMLDivElement>("#sample-management")!;
const instrumentPresetManagementEl = document.querySelector<HTMLDivElement>(
  "#instrument-preset-management",
)!;
const recordButtonEl =
  document.querySelector<HTMLButtonElement>("#record-button")!;
const recordStatusEl =
  document.querySelector<HTMLSpanElement>("#record-status")!;
const bpmEl = document.querySelector<HTMLInputElement>("#bpm")!;
const subdivisionEl =
  document.querySelector<HTMLSelectElement>("#subdivision")!;
const columnCountEl =
  document.querySelector<HTMLInputElement>("#column-count")!;
const precedenceSelectEl =
  document.querySelector<HTMLSelectElement>("#precedence-select")!;
const keySelectEl = document.querySelector<HTMLSelectElement>("#key-select")!;
const scaleSelectEl =
  document.querySelector<HTMLSelectElement>("#scale-select")!;
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

KEY_LABELS.forEach((label, semitone) => {
  const option = document.createElement("option");
  option.value = String(semitone);
  option.textContent = label;
  keySelectEl.appendChild(option);
});

for (const [scaleType, label] of Object.entries(SCALE_LABELS)) {
  const option = document.createElement("option");
  option.value = scaleType;
  option.textContent = label;
  if (scaleType === "chromatic") option.selected = true;
  scaleSelectEl.appendChild(option);
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
  // Taps limiter.output, not masterGain -- the exact same node already
  // connected to audioContext.destination (see getSharedLimiter), so this
  // captures precisely what's actually heard, downstream of every row's
  // effects and the master bus.
  const recorder = new Recorder(audioContext, limiter.output);
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
  // Same reasoning, for the shared reverb bus -- ReverbEffect has no
  // getter either. Matches model.reverb's own construction call
  // (`setParams({ wet: 1, decaySeconds: 2.2 })`) plus ReverbEffect's own
  // constructor defaults for preDelay/damping (never set explicitly at
  // construction, so they start at the class's own 20ms/6000Hz).
  let reverbDecaySeconds = 2.2;
  let reverbPreDelayMs = 20;
  let reverbDampingHz = 6000;

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
      // The shared reverb bus's own character -- distinct from a row's
      // "Reverb send" (how much of that row reaches this bus at all).
      // wet isn't exposed here: model.reverb is a parallel send bus, not
      // an insert, so it's always fully wet (see gridModel.ts's own
      // construction call) -- exposing wet here too would just duplicate
      // what each row's send level already controls, more confusingly.
      {
        key: "reverbDecaySeconds",
        label: "Reverb decay (s)",
        kind: "range",
        value: reverbDecaySeconds,
        min: 0.1,
        max: 8,
        step: 0.1,
        onChange: (v) => {
          reverbDecaySeconds = v;
          model.reverb.setParams({ decaySeconds: v });
        },
      },
      {
        key: "reverbPreDelayMs",
        label: "Reverb pre-delay (ms)",
        kind: "range",
        value: reverbPreDelayMs,
        min: 0,
        max: 200,
        step: 1,
        onChange: (v) => {
          reverbPreDelayMs = v;
          model.reverb.setParams({ preDelayMs: v });
        },
      },
      {
        key: "reverbDampingHz",
        label: "Reverb damping (Hz)",
        kind: "range",
        value: reverbDampingHz,
        min: 500,
        max: 12000,
        step: 100,
        onChange: (v) => {
          reverbDampingHz = v;
          model.reverb.setParams({ dampingHz: v });
        },
      },
    ];
  }

  // Tracks, per row id, the backend sampleId (if any) its currently-loaded
  // buffer came from -- persistence-specific bookkeeping that doesn't
  // belong on RowConfig itself (GridModel stays entirely unaware the
  // backend/patches exist at all), read by serializePatch and populated by
  // applyPatch and assignSampleToRow below (see patch.ts's doc comment).
  const rowSampleIds = new Map<string, string>();

  // Mirrors refreshPatchList's own cache-then-sync-getter shape: gridView.ts
  // and the library panels below render synchronously, so they can't await
  // a fetch mid-render -- main.ts keeps these populated instead and hands
  // back plain synchronous getters/closures over them.
  let availableSamples: SampleMetadata[] = [];
  async function refreshAvailableSamples(): Promise<void> {
    availableSamples = await listSamples();
  }
  let availableInstrumentPresets: InstrumentPreset[] = [];
  async function refreshInstrumentPresets(): Promise<void> {
    availableInstrumentPresets = await listInstrumentPresets();
  }

  const view = createGridView(gridEl, model, {
    buildMasterFields,
    getCurrentSampleName: (row) => {
      const id = rowSampleIds.get(row.id);
      return availableSamples.find((s) => s.id === id)?.name;
    },
    onSaveInstrumentPreset: async (row, name) => {
      await createInstrumentPreset({
        name,
        sourceType: row.config.sourceType,
        sourceParams: row.source.getParams(),
        envelope: row.config.envelope,
      });
      await refreshInstrumentPresets();
      renderLibraryPanels();
    },
    onSelectionChange: () => renderLibraryPanels(),
  });

  // Fetches, decodes, and assigns a library sample onto `row` -- the
  // Sample Library panel's own click handler (below) is the only caller
  // now that local file loading no longer exists on this page.
  async function assignSampleToRow(row: Row, sampleId: string): Promise<void> {
    const arrayBuffer = await fetchSampleAudio(sampleId);
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    await model.loadRowSample(row, buffer);
    rowSampleIds.set(row.id, sampleId);
    view.render();
    renderLibraryPanels();
  }

  // Applies a saved instrument preset's sourceType params + envelope onto
  // `row` -- mirrors exactly what applyPatch's addPatchRow does for the
  // same two fields when loading a saved patch.
  function applyPresetToRow(row: Row, preset: InstrumentPreset): void {
    row.source.setParams(preset.sourceParams);
    const points = (preset.envelope as { points?: unknown[] } | null)?.points;
    if (Array.isArray(points)) {
      model.setRowEnvelope(
        row,
        points as Parameters<typeof model.setRowEnvelope>[1],
      );
    }
    view.render();
  }

  /** Expands into an itemEl to edit a preset's own sourceParams/envelope
   * directly -- reuses the same per-source-type field metadata
   * (PARAM_FIELDS_BY_SOURCE_TYPE) rowPanel builds its own param fields
   * from, and fields.ts's renderFields (the same renderer every other
   * panel in this app uses), just pointed at a plain draft object instead
   * of a live row's source. */
  function renderPresetEditor(
    preset: InstrumentPreset,
    itemEl: HTMLElement,
  ): void {
    const existing = itemEl.querySelector(".preset-editor");
    if (existing) {
      existing.remove();
      return;
    }

    const draftParams: Record<string, unknown> = { ...preset.sourceParams };
    const draftPoints: Array<{ position: number; value: number }> =
      Array.isArray((preset.envelope as { points?: unknown } | null)?.points)
        ? [
            ...(
              preset.envelope as {
                points: Array<{ position: number; value: number }>;
              }
            ).points,
          ]
        : [
            { position: 0, value: 0 },
            { position: 1, value: 0 },
          ];

    const editorEl = document.createElement("div");
    editorEl.className = "preset-editor";

    const fieldsEl = document.createElement("div");
    editorEl.appendChild(fieldsEl);

    function renderDraftFields(): void {
      const paramFields =
        PARAM_FIELDS_BY_SOURCE_TYPE[preset.sourceType as SourceType] ?? [];
      const fields: Field[] = paramFields.map((field) => {
        const current = draftParams[field.key] ?? field.default;
        if (field.kind === "select") {
          return {
            key: field.key,
            label: field.label,
            kind: "select",
            value: String(current),
            options: field.options ?? [],
            onChange: (v) => {
              draftParams[field.key] = v;
            },
          };
        }
        return {
          key: field.key,
          label: field.label,
          kind: "range",
          value: Number(current),
          min: field.min ?? 0,
          max: field.max ?? 1,
          step: field.step ?? 0.01,
          onChange: (v) => {
            draftParams[field.key] = v;
          },
        };
      });
      fields.push({
        key: "envelope",
        label: "Envelope shape",
        kind: "automation",
        points: draftPoints,
        onChange: (points) => {
          draftPoints.length = 0;
          draftPoints.push(...points);
        },
      });
      renderFields(fieldsEl, fields);
    }
    renderDraftFields();

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save changes";
    saveButton.addEventListener("click", async () => {
      await updateInstrumentPreset(preset.id, {
        sourceParams: draftParams,
        envelope: { points: draftPoints },
      });
      await refreshInstrumentPresets();
      renderManagementPage();
    });
    editorEl.appendChild(saveButton);

    itemEl.appendChild(editorEl);
  }

  // Full CRUD for both libraries -- see the "Manage Library" toggle above.
  function renderManagementPage(): void {
    const sampleGroups: TreeGroup<SampleMetadata>[] = SAMPLE_CATEGORIES.map(
      (category) => ({
        label: category,
        items: availableSamples.filter((s) => s.category === category),
      }),
    );
    renderLibraryTree(sampleManagementEl, sampleGroups, {
      getId: (s) => s.id,
      emptyMessage: "No samples in the library yet.",
      renderItem: (sample, itemEl) => {
        itemEl.classList.add("management-row");

        const nameEl = document.createElement("span");
        nameEl.className = "name";
        nameEl.textContent = sample.name;
        itemEl.appendChild(nameEl);

        const categorySelect = document.createElement("select");
        for (const category of SAMPLE_CATEGORIES) {
          const option = document.createElement("option");
          option.value = category;
          option.textContent = category;
          option.selected = category === sample.category;
          categorySelect.appendChild(option);
        }
        categorySelect.addEventListener("change", async () => {
          await updateSample(sample.id, { category: categorySelect.value });
          await refreshAvailableSamples();
          renderManagementPage();
          renderLibraryPanels();
        });
        itemEl.appendChild(categorySelect);

        const renameButton = document.createElement("button");
        renameButton.textContent = "Rename";
        renameButton.addEventListener("click", async () => {
          const name = window.prompt("Rename sample:", sample.name);
          if (!name?.trim()) return;
          await updateSample(sample.id, { name: name.trim() });
          await refreshAvailableSamples();
          renderManagementPage();
          renderLibraryPanels();
        });
        itemEl.appendChild(renameButton);

        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", async () => {
          if (
            !window.confirm(`Delete "${sample.name}"? This can't be undone.`)
          ) {
            return;
          }
          await deleteSample(sample.id);
          await refreshAvailableSamples();
          renderManagementPage();
          renderLibraryPanels();
        });
        itemEl.appendChild(deleteButton);
      },
    });

    const presetGroups: TreeGroup<InstrumentPreset>[] = Object.keys(
      SOURCE_TYPE_LABELS,
    ).map((sourceType) => ({
      label: SOURCE_TYPE_LABELS[sourceType as SourceType],
      items: availableInstrumentPresets.filter(
        (p) => p.sourceType === sourceType,
      ),
    }));
    renderLibraryTree(instrumentPresetManagementEl, presetGroups, {
      getId: (p) => p.id,
      emptyMessage: "No instrument presets saved yet.",
      renderItem: (preset, itemEl) => {
        itemEl.classList.add("stacked");

        const summaryRow = document.createElement("div");
        summaryRow.className = "management-row";

        const nameEl = document.createElement("span");
        nameEl.className = "name";
        nameEl.textContent = preset.name;
        summaryRow.appendChild(nameEl);

        const renameButton = document.createElement("button");
        renameButton.textContent = "Rename";
        renameButton.addEventListener("click", async () => {
          const name = window.prompt("Rename preset:", preset.name);
          if (!name?.trim()) return;
          await updateInstrumentPreset(preset.id, { name: name.trim() });
          await refreshInstrumentPresets();
          renderManagementPage();
          renderLibraryPanels();
        });
        summaryRow.appendChild(renameButton);

        const editButton = document.createElement("button");
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () =>
          renderPresetEditor(preset, itemEl),
        );
        summaryRow.appendChild(editButton);

        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", async () => {
          if (
            !window.confirm(`Delete "${preset.name}"? This can't be undone.`)
          ) {
            return;
          }
          await deleteInstrumentPreset(preset.id);
          await refreshInstrumentPresets();
          renderManagementPage();
          renderLibraryPanels();
        });
        summaryRow.appendChild(deleteButton);

        itemEl.appendChild(summaryRow);
      },
    });
  }

  // Rebuilds both main-page library panels from the current caches +
  // whatever row is currently selected -- called any time either cache or
  // the selection changes, full rebuild each time (no incremental
  // diffing anywhere in this app, see gridView.ts's own render()).
  function renderLibraryPanels(): void {
    const selectedRow = view.getSelectedRow();

    const sampleGroups: TreeGroup<SampleMetadata>[] = SAMPLE_CATEGORIES.map(
      (category) => ({
        label: category,
        items: availableSamples.filter((s) => s.category === category),
      }),
    );
    renderLibraryTree(sampleLibraryEl, sampleGroups, {
      getId: (s) => s.id,
      emptyMessage: "No samples in the library yet.",
      renderItem: (sample, itemEl) => {
        const button = document.createElement("button");
        button.textContent = sample.name;
        const eligible = selectedRow?.source.needsSample ?? false;
        if (!eligible) itemEl.classList.add("incompatible");
        button.addEventListener("click", () => {
          if (!selectedRow?.source.needsSample) {
            const hint = document.createElement("p");
            hint.className = "library-hint";
            hint.textContent = "Select a sample row first.";
            sampleLibraryEl.prepend(hint);
            setTimeout(() => hint.remove(), 2000);
            return;
          }
          assignSampleToRow(selectedRow, sample.id).catch((err) =>
            console.error("Failed to assign sample:", err),
          );
        });
        itemEl.appendChild(button);
      },
    });

    const presetGroups: TreeGroup<InstrumentPreset>[] = Object.keys(
      SOURCE_TYPE_LABELS,
    ).map((sourceType) => ({
      label: SOURCE_TYPE_LABELS[sourceType as SourceType],
      items: availableInstrumentPresets.filter(
        (p) => p.sourceType === sourceType,
      ),
    }));
    renderLibraryTree(instrumentLibraryEl, presetGroups, {
      getId: (p) => p.id,
      emptyMessage: "No instrument presets saved yet.",
      renderItem: (preset, itemEl) => {
        const button = document.createElement("button");
        button.textContent = preset.name;
        const matches = selectedRow?.config.sourceType === preset.sourceType;
        if (!matches) itemEl.classList.add("incompatible");
        button.addEventListener("click", () => {
          if (
            !selectedRow ||
            selectedRow.config.sourceType !== preset.sourceType
          ) {
            return;
          }
          applyPresetToRow(selectedRow, preset);
        });
        itemEl.appendChild(button);
      },
    });
  }

  async function addRow(
    sourceType: SourceType,
    name: string,
    on: boolean[] = [],
  ): Promise<Row> {
    const row = await model.addRow(sourceType, name, model.clock.isPlaying());
    on.forEach((isOn, i) => {
      if (isOn) model.setCell(row, i, { on: true });
    });
    // needsSample, not sourceType === "samplePlayer" specifically --
    // granularSynth needs one just as much (its own grain source), and
    // previously got left silent until a file was picked by hand.
    if (row.source.needsSample) {
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
      reverbDecaySeconds,
      reverbPreDelayMs,
      reverbDampingHz,
    };
  }

  function applyTempoState(state: TempoState): void {
    bpmEl.value = String(state.bpm);
    subdivisionEl.value = String(state.subdivision);
    limiterCeiling = state.limiterCeiling;
    limiterRelease = state.limiterRelease;
    limiter.setParams({ ceiling: limiterCeiling, release: limiterRelease });
    reverbDecaySeconds = state.reverbDecaySeconds;
    reverbPreDelayMs = state.reverbPreDelayMs;
    reverbDampingHz = state.reverbDampingHz;
    model.reverb.setParams({
      decaySeconds: reverbDecaySeconds,
      preDelayMs: reverbPreDelayMs,
      dampingHz: reverbDampingHz,
    });
    model.setStepSeconds(computeStepSeconds());
  }

  // applyPatch already updates model.precedence/columnCount/scaleRoot/
  // scaleType directly (see patch.ts) -- this just syncs the top-bar
  // controls that mirror them, which nothing else does automatically
  // since they're plain change-event-driven inputs, not read from the
  // model on every render.
  function syncTopBarFromModel(): void {
    precedenceSelectEl.value = model.precedence;
    columnCountEl.value = String(model.columnCount);
    keySelectEl.value = String(model.scaleRoot);
    scaleSelectEl.value = model.scaleType;
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
  // to loading it). Exercises all 5 source types across a basic groove
  // (kick/hats/bass/lead/pad), not just the original 2-row Kick+Synth
  // starter, so a fresh install actually demonstrates the range of what a
  // row can be. Uploads every sample-backed row's synthesized blip as a
  // real sample (so it round-trips through storage like any other sample
  // would -- there's no special-cased "regenerate this in JS" path on
  // load), and saves the whole thing under the protected name.
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
    const hatsRow = await addRow("noiseGenerator", "Hats", [
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    model.setRowDefaultGain(hatsRow, 0.35); // hats sit well back of the kick

    const bassRow = await addRow("fmSynth", "Bass", [
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
    ]);
    model.setRowDefaultNote(bassRow, 36); // two octaves below the 60 default

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

    const padRow = await addRow("granularSynth", "Pad", [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    // A long, loose hold (most of the 8-step cycle) plus a healthy reverb
    // send -- granular texture reads as atmosphere, not another hit in the
    // groove, so it's the one row deliberately not locked to the beat.
    model.setRowTriggerMode(padRow, {
      kind: "explicitDuration",
      steps: 6,
      loop: false,
    });
    model.setRowReverbSend(padRow, 0.4);

    // Kick and Pad both auto-loaded a placeholder blip in addRow (see its
    // needsSample check) -- upload both so they round-trip through the
    // backend like any other sample, same as a locally-picked file would.
    const seedCategories: Record<string, string> = {
      [kickRow.id]: "percussion",
      [padRow.id]: "pad",
    };
    for (const row of [kickRow, padRow]) {
      const buffer = model.getRowSampleBuffer(row);
      if (!buffer) continue;
      const uploaded = await uploadSample(
        buffer,
        `${row.config.name} blip`,
        seedCategories[row.id],
      );
      rowSampleIds.set(row.id, uploaded.id);
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
  await refreshAvailableSamples();
  await refreshInstrumentPresets();
  view.render();
  renderLibraryPanels();

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
    renderLibraryPanels();
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

  // Neither needs a re-render -- nothing in the panel reads
  // scaleRoot/scaleType, unlike precedence (which affects the Defaults
  // section's disabled state).
  keySelectEl.addEventListener("change", () => {
    model.scaleRoot = Number(keySelectEl.value);
  });
  scaleSelectEl.addEventListener("change", () => {
    model.scaleType = scaleSelectEl.value as ScaleType;
  });

  masterButtonEl.addEventListener("click", () => view.selectMaster());

  manageLibraryButtonEl.addEventListener("click", () => {
    const showingManagement =
      !libraryManagementViewEl.classList.contains("hidden");
    if (showingManagement) {
      libraryManagementViewEl.classList.add("hidden");
      sequencerViewEl.classList.remove("hidden");
      manageLibraryButtonEl.textContent = "Manage Library";
    } else {
      sequencerViewEl.classList.add("hidden");
      libraryManagementViewEl.classList.remove("hidden");
      manageLibraryButtonEl.textContent = "Back to Sequencer";
      renderManagementPage();
    }
  });

  // The only place a new local file enters the library now -- everywhere
  // else on the main page is select-only (see the plan's "split browsing
  // from administration"). Defaults the new sample to "other"; categorize
  // it afterward via the same per-row select every sample gets in the
  // table above.
  addSampleButtonEl.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const name = window.prompt("Name this sample:", file.name) ?? file.name;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      await uploadSample(buffer, name.trim() || file.name, "other");
      await refreshAvailableSamples();
      renderManagementPage();
      renderLibraryPanels();
    });
    input.click();
  });

  recordButtonEl.addEventListener("click", async () => {
    if (recorder.isRecording()) {
      recordButtonEl.disabled = true;
      recordStatusEl.textContent = "Processing…";
      const { blob } = await recorder.stop();
      try {
        // Re-encoded as WAV (not the raw webm/mp4 MediaRecorder produces)
        // so the download is universally playable without needing a
        // browser that understands whatever codec was actually used --
        // same reasoning as uploadSample's own WAV encode.
        const buffer = await audioContext.decodeAudioData(
          await blob.arrayBuffer(),
        );
        const wavBlob = encodeWav(buffer);
        const url = URL.createObjectURL(wavBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `grid-sequencer-${Date.now()}.wav`;
        link.click();
        URL.revokeObjectURL(url);
        recordStatusEl.textContent = "";
      } catch (err) {
        console.error("Recording couldn't be processed:", err);
        recordStatusEl.textContent = "Recording failed — try again";
      }
      recordButtonEl.textContent = "Record";
      recordButtonEl.disabled = false;
    } else {
      recorder.start();
      recordButtonEl.textContent = "Stop";
      recordStatusEl.textContent = "Recording…";
    }
  });

  function tick(): void {
    view.refreshPlayhead();
    requestAnimationFrame(tick);
  }
  tick();
});
