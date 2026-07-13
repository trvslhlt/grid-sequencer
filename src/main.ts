import "bruit-kit/ui/automationEditor.css";
import "bruit-kit/ui/waveformRangeView.css";
import { Recorder } from "bruit-kit/audio";
import { getSharedLimiter, unlockAudioContext } from "./audioContext";
import type { Precedence } from "./grid/config";
import { GridModel, type Row } from "./grid/gridModel";
import { KEY_LABELS, SCALE_LABELS, type ScaleType } from "./grid/scale";
import { SOURCE_TYPE_LABELS, type SourceType } from "./grid/sourceFactory";
import { type TempoState, applyPatch, serializePatch } from "./patch";
import {
  SAMPLE_CATEGORIES,
  type SampleMetadata,
  SaveConflictError,
  fetchSampleAudio,
  listPatches,
  listSamples,
  loadPatch,
  savePatch,
  uploadSample,
} from "./patchApi";
import { generateBlipBuffer } from "./sampleGen";
import type { Field } from "./ui/fields";
import { createGridView, effectsFields } from "./ui/gridView";
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

  // Mirrors refreshPatchList's own cache-then-sync-getter shape: gridView.ts
  // renders synchronously, so it can't await a fetch mid-render -- main.ts
  // keeps this populated instead and hands back a plain synchronous getter.
  let availableSamples: SampleMetadata[] = [];
  async function refreshAvailableSamples(): Promise<void> {
    availableSamples = await listSamples();
  }

  const view = createGridView(gridEl, model, {
    buildMasterFields,
    sampleCategories: [...SAMPLE_CATEGORIES],
    getAvailableSamples: () => availableSamples,
    onSampleLoaded: (row, buffer, category) => {
      uploadSample(buffer, row.config.name, category)
        .then((meta) => {
          rowSampleIds.set(row.id, meta.id);
          return refreshAvailableSamples();
        })
        .then(() => view.render())
        .catch((err) => console.error("Failed to upload sample:", err));
    },
    onLoadFromLibrary: async (row, sampleId) => {
      const arrayBuffer = await fetchSampleAudio(sampleId);
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      await model.loadRowSample(row, buffer);
      rowSampleIds.set(row.id, sampleId);
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
