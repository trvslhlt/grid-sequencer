/** A popup for previewing and non-destructively editing a single library
 * sample -- trimming its start/end (bruit-kit's waveform range view) and
 * toggling reverse, both previewable before committing anything -- then
 * saving either overwrites the sample in place or creates a new one
 * alongside it. Pulled out of the management page's per-row controls (see
 * main.ts's renderManagementPage) so browsing samples isn't cluttered with
 * a full operations panel repeated on every row; editing now happens in
 * one place instead. All edits here are just local buffer math (see
 * extractRange/reverseAudioBuffer) until a save button is clicked -- the
 * stored file is never touched by dragging the range handles or toggling
 * reverse alone. */

import { type WaveformRange, createWaveformRangeView } from "bruit-kit/ui";
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
  function stopPreview(): void {
    if (!currentSource) return;
    try {
      currentSource.stop();
    } catch {
      // already stopped/finished
    }
    currentSource = null;
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

  function buildWorkingBuffer(original: AudioBuffer): AudioBuffer {
    const trimmed = extractRange(audioContext, original, range);
    return reversed ? reverseAudioBuffer(audioContext, trimmed) : trimmed;
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
      source.connect(audioContext.destination);
      source.addEventListener("ended", () => {
        if (currentSource === source) currentSource = null;
      });
      source.start();
      currentSource = source;
    });
    controlsRow.appendChild(previewButton);
    body.appendChild(controlsRow);

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
      statusEl.textContent = "Saving…";
      try {
        await callbacks.onSaveAsNew(buildWorkingBuffer(original), {
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

    const overwriteButton = document.createElement("button");
    overwriteButton.textContent = "Save (overwrite)";
    overwriteButton.addEventListener("click", async () => {
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
    footer.appendChild(overwriteButton);

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
