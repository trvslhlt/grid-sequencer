/** A popup for previewing and editing a single library sample -- trimming
 * its start/end (bruit-kit's waveform range view), toggling reverse, and
 * applying an effects chain (reusing gridView.ts's own effectsFields UI),
 * all previewable live before committing anything. Trim/reverse alone stay
 * non-destructive-until-saved and can overwrite the sample in place; once
 * an effect is added, the edit becomes destructive processing baked into
 * real audio, so overwrite is disallowed and only "Save as new" remains
 * (see updateOverwriteAvailability). Pulled out of the management page's
 * per-row controls (see main.ts's renderManagementPage) so browsing
 * samples isn't cluttered with a full operations panel repeated on every
 * row; editing now happens in one place instead. */

import { type WaveformRange, createWaveformRangeView } from "bruit-kit/ui";
import type { EffectSpec } from "../grid/config";
import { type BuiltEffectsChain, buildEffectsChain } from "../grid/effectsChain";
import { reverseAudioBuffer } from "../grid/gridModel";
import type { SampleMetadata } from "../patchApi";
import { type Field, renderFields } from "./fields";
import { effectsFields } from "./gridView";

export interface SampleEditorCallbacks {
  fetchAudio: (id: string) => Promise<ArrayBuffer>;
  onOverwrite: (
    sample: SampleMetadata,
    buffer: AudioBuffer,
    meta: { name: string; category: string },
  ) => Promise<void>;
  onSaveAsNew: (
    buffer: AudioBuffer,
    meta: { name: string; category: string },
  ) => Promise<void>;
  onDelete: (sample: SampleMetadata) => Promise<void>;
}

/** Slices out just the selected {start, end} fraction of `buffer` -- same
 * fractional-range convention as WaveformRange/RowConfig.sampleRange
 * elsewhere in this app, just materialized into real frames here instead
 * of applied at playback time, since the result gets encoded straight to
 * a WAV file rather than played through a row's source. */
function extractRange(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  range: WaveformRange,
): AudioBuffer {
  const startFrame = Math.max(
    0,
    Math.min(buffer.length, Math.floor(range.start * buffer.length)),
  );
  const endFrame = Math.max(
    startFrame + 1,
    Math.min(buffer.length, Math.floor(range.end * buffer.length)),
  );
  const length = endFrame - startFrame;
  const out = audioContext.createBuffer(
    buffer.numberOfChannels,
    length,
    buffer.sampleRate,
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    out
      .getChannelData(channel)
      .set(buffer.getChannelData(channel).subarray(startFrame, endFrame));
  }
  return out;
}

const MAX_TAIL_SECONDS = 15;

/** How much extra render time a chain's own decay/echo tail needs beyond
 * the dry buffer's own length, so baking doesn't truncate a reverb's
 * decay or a delay's repeats mid-ring-out. Deliberately approximate (not
 * every param combination is modeled precisely) -- this only sizes an
 * offline render buffer, not anything audible on its own, so "generous
 * enough to not cut off a tail" matters more than exactness. */
function estimateTailSeconds(effects: EffectSpec[]): number {
  let tail = 0;
  for (const spec of effects) {
    if (spec.type === "reverb") {
      const decay =
        typeof spec.params.decaySeconds === "number"
          ? spec.params.decaySeconds
          : 2.2;
      tail = Math.max(tail, decay + 0.5);
    } else if (spec.type === "delay") {
      const delaySeconds =
        (typeof spec.params.delayMs === "number" ? spec.params.delayMs : 180) /
        1000;
      const feedback =
        typeof spec.params.feedback === "number" ? spec.params.feedback : 0.35;
      // Repeats until the echo drops below ~1% amplitude.
      const repeats = feedback > 0.001 ? Math.log(0.01) / Math.log(feedback) : 1;
      tail = Math.max(tail, delaySeconds * (repeats + 1));
    }
  }
  return Math.min(tail, MAX_TAIL_SECONDS);
}

/** Bakes `effects` onto `buffer` via an OfflineAudioContext, reusing the
 * exact same chain-building logic (buildEffectsChain/instantiateEffect)
 * the live grid uses for rows/master/send-bus -- offline rendering is just
 * running that same graph faster than real time instead of to speakers.
 * Cast to AudioContext at the boundary: every effect class in this
 * toolkit only ever calls methods OfflineAudioContext also implements
 * (createGain/createBiquadFilter/etc., all on the shared BaseAudioContext
 * interface), so this is safe at runtime despite the narrower TS type. */
async function renderEffectsOffline(
  buffer: AudioBuffer,
  effects: EffectSpec[],
): Promise<AudioBuffer> {
  const tailSeconds = estimateTailSeconds(effects);
  const length = Math.ceil(
    (buffer.duration + tailSeconds) * buffer.sampleRate,
  );
  const offlineContext = new OfflineAudioContext(
    buffer.numberOfChannels,
    length,
    buffer.sampleRate,
  );
  const source = offlineContext.createBufferSource();
  source.buffer = buffer;
  const chain = buildEffectsChain(
    offlineContext as unknown as AudioContext,
    effects,
  );
  source.connect(chain.input);
  chain.output.connect(offlineContext.destination);
  source.start();
  return offlineContext.startRendering();
}

export function openSampleEditorModal(
  sample: SampleMetadata,
  audioContext: AudioContext,
  categories: readonly string[],
  callbacks: SampleEditorCallbacks,
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal sample-editor-modal";
  overlay.appendChild(modal);

  let currentSource: AudioBufferSourceNode | null = null;
  let currentChain: BuiltEffectsChain | null = null;
  function stopPreview(): void {
    if (currentSource) {
      try {
        currentSource.stop();
      } catch {
        // already stopped/finished
      }
      currentSource = null;
    }
    if (currentChain) {
      currentChain.dispose();
      currentChain = null;
    }
  }

  function close(): void {
    stopPreview();
    overlay.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("span");
  title.className = "modal-title";
  title.textContent = sample.name;
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.className = "modal-close-button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  const loadingEl = document.createElement("p");
  loadingEl.className = "panel-hint";
  loadingEl.textContent = "Loading…";
  body.appendChild(loadingEl);

  document.body.appendChild(overlay);

  let range: WaveformRange = { start: 0, end: 1 };
  let reversed = false;
  let effects: EffectSpec[] = [];
  let overwriteButtonEl: HTMLButtonElement | null = null;

  // Overwrite rewrites the stored file in place -- fine for trim/reverse
  // (still just a non-destructive edit until a save button is clicked),
  // but once an effect is in the chain the save is genuinely destructive
  // processing, so only "Save as new" stays available (see this file's
  // own doc comment).
  function updateOverwriteAvailability(): void {
    if (!overwriteButtonEl) return;
    const blocked = effects.length > 0;
    overwriteButtonEl.disabled = blocked;
    overwriteButtonEl.title = blocked
      ? "Effects are destructive processing — save as a new sample instead"
      : "";
  }

  function buildWorkingBuffer(original: AudioBuffer): AudioBuffer {
    const trimmed = extractRange(audioContext, original, range);
    return reversed ? reverseAudioBuffer(audioContext, trimmed) : trimmed;
  }

  async function buildFinalBuffer(original: AudioBuffer): Promise<AudioBuffer> {
    const working = buildWorkingBuffer(original);
    return effects.length > 0
      ? renderEffectsOffline(working, effects)
      : working;
  }

  function renderLoaded(original: AudioBuffer): void {
    body.innerHTML = "";

    const rangeViewEl = document.createElement("div");
    rangeViewEl.className = "sample-editor-waveform";
    const rangeView = createWaveformRangeView(rangeViewEl, {
      initialRange: range,
      onChange: (r) => {
        range = r;
      },
    });
    rangeView.setBuffer(original);
    body.appendChild(rangeViewEl);

    const controlsRow = document.createElement("div");
    controlsRow.className = "sample-editor-controls";

    const reverseLabel = document.createElement("label");
    const reverseCheckbox = document.createElement("input");
    reverseCheckbox.type = "checkbox";
    reverseCheckbox.checked = reversed;
    reverseCheckbox.addEventListener("change", () => {
      reversed = reverseCheckbox.checked;
    });
    reverseLabel.append(reverseCheckbox, " Reverse");
    controlsRow.appendChild(reverseLabel);

    const previewButton = document.createElement("button");
    previewButton.textContent = "▶ Preview";
    previewButton.addEventListener("click", () => {
      stopPreview();
      const source = audioContext.createBufferSource();
      source.buffer = buildWorkingBuffer(original);
      // Live nodes, not the offline render -- immediate audible feedback
      // while dialing in effect params, same real-time chain the grid
      // itself plays rows through (see buildEffectsChain). An empty
      // `effects` array still works here: chainEffects treats it as a
      // no-op passthrough, so this path is identical to plain trim/
      // reverse preview when no effect has been added yet.
      const chain = buildEffectsChain(audioContext, effects);
      source.connect(chain.input);
      chain.output.connect(audioContext.destination);
      source.addEventListener("ended", () => {
        if (currentSource === source) currentSource = null;
        if (currentChain === chain) {
          chain.dispose();
          currentChain = null;
        }
      });
      source.start();
      currentSource = source;
      currentChain = chain;
    });
    controlsRow.appendChild(previewButton);
    body.appendChild(controlsRow);

    const effectsSection = document.createElement("div");
    effectsSection.className = "panel-section";
    const effectsTitleRow = document.createElement("div");
    effectsTitleRow.className = "panel-section-title-row";
    const effectsTitle = document.createElement("span");
    effectsTitle.className = "panel-section-title";
    effectsTitle.textContent = "Effects (destructive — forces Save as new)";
    effectsTitleRow.appendChild(effectsTitle);
    effectsSection.appendChild(effectsTitleRow);
    const effectsFieldsEl = document.createElement("div");
    effectsSection.appendChild(effectsFieldsEl);
    body.appendChild(effectsSection);

    function renderEffectsSection(): void {
      const fields: Field[] = effectsFields(
        () => effects,
        (next) => {
          effects = next;
          renderEffectsSection();
          updateOverwriteAvailability();
        },
      );
      renderFields(effectsFieldsEl, fields);
    }
    renderEffectsSection();

    const nameField = document.createElement("div");
    nameField.className = "panel-field";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = sample.name;
    nameField.append(nameLabel, nameInput);
    body.appendChild(nameField);

    const categoryField = document.createElement("div");
    categoryField.className = "panel-field";
    const categoryLabel = document.createElement("label");
    categoryLabel.textContent = "Category";
    const categorySelect = document.createElement("select");
    for (const category of categories) {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      option.selected = category === sample.category;
      categorySelect.appendChild(option);
    }
    categoryField.append(categoryLabel, categorySelect);
    body.appendChild(categoryField);

    const statusEl = document.createElement("p");
    statusEl.className = "status-text";
    body.appendChild(statusEl);

    const footer = document.createElement("div");
    footer.className = "modal-footer";

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Delete";
    deleteButton.className = "modal-destructive-button";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`Delete "${sample.name}"? This can't be undone.`)) {
        return;
      }
      stopPreview();
      try {
        await callbacks.onDelete(sample);
        close();
      } catch (err) {
        statusEl.textContent = "Delete failed — try again";
        console.error(err);
      }
    });
    footer.appendChild(deleteButton);

    const saveAsNewButton = document.createElement("button");
    saveAsNewButton.textContent = "Save as new…";
    saveAsNewButton.addEventListener("click", async () => {
      const baseName = nameInput.value.trim() || sample.name;
      const name = window.prompt("Name the new sample:", `${baseName} copy`);
      if (!name?.trim()) return;
      stopPreview();
      statusEl.textContent =
        effects.length > 0 ? "Rendering…" : "Saving…";
      try {
        const finalBuffer = await buildFinalBuffer(original);
        await callbacks.onSaveAsNew(finalBuffer, {
          name: name.trim(),
          category: categorySelect.value,
        });
        close();
      } catch (err) {
        statusEl.textContent = "Save failed — try again";
        console.error(err);
      }
    });
    footer.appendChild(saveAsNewButton);

    overwriteButtonEl = document.createElement("button");
    overwriteButtonEl.textContent = "Save (overwrite)";
    overwriteButtonEl.addEventListener("click", async () => {
      if (
        !window.confirm(
          `Overwrite "${sample.name}" with these changes? This can't be undone.`,
        )
      ) {
        return;
      }
      stopPreview();
      statusEl.textContent = "Saving…";
      try {
        await callbacks.onOverwrite(sample, buildWorkingBuffer(original), {
          name: nameInput.value.trim() || sample.name,
          category: categorySelect.value,
        });
        close();
      } catch (err) {
        statusEl.textContent = "Save failed — try again";
        console.error(err);
      }
    });
    footer.appendChild(overwriteButtonEl);
    updateOverwriteAvailability();

    modal.appendChild(footer);
  }

  callbacks
    .fetchAudio(sample.id)
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then(renderLoaded)
    .catch((err) => {
      loadingEl.textContent = "Failed to load sample audio";
      console.error(err);
    });
}
