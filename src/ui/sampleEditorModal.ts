/** A popup for previewing and editing a single library sample -- trimming
 * its start/end (bruit-kit's waveform range view), toggling reverse,
 * changing playback speed, and applying an effects chain (reusing
 * effectsFields.ts's own UI), all previewable live before
 * committing anything. Trim/reverse/speed alone stay non-destructive-
 * until-saved and can overwrite the sample in place; once an effect is
 * added, the edit becomes destructive processing baked into real audio,
 * so overwrite is disallowed and only "Save as new" remains (see
 * updateOverwriteAvailability). Pulled out of the management page's
 * per-row controls (see main.ts's renderManagementPage) so browsing
 * samples isn't cluttered with a full operations panel repeated on every
 * row; editing now happens in one place instead. */

import {
  type BuiltEffectsChain,
  type EffectSpec,
  applySpeed,
  buildEffectsChain,
  extractRange,
  pitchCompensationSpec,
  renderEffectsOffline,
} from "bruit-kit/audio";
import {
  type Field,
  type WaveformRange,
  createWaveformRangeView,
  effectsFields,
  renderFields,
} from "bruit-kit/ui";
import { reverseAudioBuffer } from "../grid/gridModel";
import type { SampleMetadata } from "../patchApi";

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
  let speed = 1;
  let preservePitch = false;
  let effects: EffectSpec[] = [];
  let overwriteButtonEl: HTMLButtonElement | null = null;

  // Whatever pitchCompensationSpec would add on top of the user's own
  // effects, only when it'd actually do something -- speed === 1 has no
  // pitch to compensate, and unchecked Preserve pitch means the tape/
  // vinyl-style pitch change is the point, not something to undo.
  function effectsWithPitchCompensation(): EffectSpec[] {
    return preservePitch && speed !== 1
      ? [...pitchCompensationSpec(speed), ...effects]
      : effects;
  }

  // Overwrite rewrites the stored file in place -- fine for trim/reverse/
  // speed alone (still just a deterministic, non-destructive-feeling edit
  // until a save button is clicked), but once an effect is in the chain
  // (the user's own, or the Preserve pitch checkbox's own compensation
  // pass through that same Pitch shift effect) the save is genuinely
  // destructive processing, so only "Save as new" stays available (see
  // this file's own doc comment).
  function updateOverwriteAvailability(): void {
    if (!overwriteButtonEl) return;
    const blocked = effectsWithPitchCompensation().length > 0;
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
    const working = await applySpeed(buildWorkingBuffer(original), speed);
    const finalEffects = effectsWithPitchCompensation();
    return finalEffects.length > 0
      ? renderEffectsOffline(working, finalEffects)
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

    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Speed ";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    // Wide enough range for a sound-experimentation tool, not just a
    // "gentle tempo match" tweak (0.5x..2x) -- tape/vinyl-style, so
    // pitch rides along with it in both directions.
    speedInput.min = "0.25";
    speedInput.max = "4";
    speedInput.step = "0.01";
    speedInput.value = String(speed);
    const speedValueEl = document.createElement("span");
    speedValueEl.className = "field-value";
    speedValueEl.textContent = `${speed.toFixed(2)}×`;
    speedInput.addEventListener("input", () => {
      speed = Number(speedInput.value);
      speedValueEl.textContent = `${speed.toFixed(2)}×`;
    });
    speedLabel.append(speedInput, speedValueEl);
    controlsRow.appendChild(speedLabel);

    const preservePitchLabel = document.createElement("label");
    const preservePitchCheckbox = document.createElement("input");
    preservePitchCheckbox.type = "checkbox";
    preservePitchCheckbox.checked = preservePitch;
    preservePitchCheckbox.addEventListener("change", () => {
      preservePitch = preservePitchCheckbox.checked;
      updateOverwriteAvailability();
    });
    preservePitchLabel.append(preservePitchCheckbox, " Preserve pitch");
    controlsRow.appendChild(preservePitchLabel);

    const previewButton = document.createElement("button");
    previewButton.textContent = "▶ Preview";
    previewButton.addEventListener("click", () => {
      stopPreview();
      const source = audioContext.createBufferSource();
      source.buffer = buildWorkingBuffer(original);
      // Live playbackRate, not the offline speed render -- instant
      // audible feedback while dragging the slider, same reasoning as
      // playing the un-rendered effects chain live below. The offline
      // applySpeed render only actually runs when saving.
      source.playbackRate.value = speed;
      // Live nodes, not the offline render -- immediate audible feedback
      // while dialing in effect params, same real-time chain the grid
      // itself plays rows through (see buildEffectsChain). An empty
      // `effects` array still works here: chainEffects treats it as a
      // no-op passthrough, so this path is identical to plain trim/
      // reverse preview when no effect has been added yet. Preserve
      // pitch's own compensation is prepended the same way it is for the
      // real offline render (effectsWithPitchCompensation), so Preview
      // always matches what Save would actually produce.
      const chain = buildEffectsChain(audioContext, effectsWithPitchCompensation());
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
        (next) => {
          effects = next;
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
        effects.length > 0 || speed !== 1 ? "Rendering…" : "Saving…";
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
      statusEl.textContent = speed !== 1 ? "Rendering…" : "Saving…";
      try {
        const buffer = await applySpeed(buildWorkingBuffer(original), speed);
        await callbacks.onOverwrite(sample, buffer, {
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
