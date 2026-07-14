/** Converts between GridModel's live state and the plain-JSON Patch shape
 * the backend stores (see patchApi.ts) -- the two directions of a save/
 * load round trip. Mirrors docker_collab's frontend serializeNode/
 * loadCreation split for the same reason: one function walks live state
 * into JSON, the other tears down and rebuilds live state from JSON. */

import type {
  CellConfig,
  ColumnConfig,
  EffectSpec,
  EnvelopeParams,
} from "./grid/config";
import type { GridModel, Row } from "./grid/gridModel";
import type { SourceType } from "./grid/sourceFactory";
import type { TriggerMode } from "./grid/triggerModes";
import type { Patch, PatchRow } from "./patchApi";
import { fetchSampleAudio } from "./patchApi";

/** Tempo/limiter state that lives outside GridModel entirely (see
 * main.ts's own bpmEl/subdivisionEl/limiter closures) -- passed in by the
 * caller rather than read from the model, and handed back by applyPatch
 * so the caller can sync its own UI/limiter from a loaded patch. */
export interface TempoState {
  bpm: number;
  subdivision: number;
  limiterCeiling: number;
  limiterRelease: number;
}

export function serializePatch(
  model: GridModel,
  tempoState: TempoState,
  rowSampleIds: Map<string, string>,
): Omit<Patch, "id" | "createdAt" | "name"> {
  return {
    bpm: tempoState.bpm,
    subdivision: tempoState.subdivision,
    columnCount: model.columnCount,
    precedence: model.precedence,
    scaleRoot: model.scaleRoot,
    scaleType: model.scaleType,
    columns: model.columns,
    masterGain: model.masterGain.gain.value,
    masterEffects: model.getMasterEffects(),
    limiterCeiling: tempoState.limiterCeiling,
    limiterRelease: tempoState.limiterRelease,
    rows: model.getRows().map((row) => ({
      name: row.config.name,
      sourceType: row.config.sourceType,
      enabled: row.config.enabled,
      triggerMode: row.config.triggerMode,
      playbackMode: row.config.playbackMode,
      defaultsOverride: row.config.defaultsOverride,
      defaultNote: row.config.defaultNote,
      defaultGain: row.config.defaultGain,
      defaultTimeShiftSeconds: row.config.defaultTimeShiftSeconds,
      envelopeOverride: row.config.envelopeOverride,
      envelope: row.config.envelope,
      effects: row.config.effects,
      reverbSend: row.config.reverbSend,
      sampleRange: row.config.sampleRange,
      sourceParams: row.source.getParams(),
      sampleId: rowSampleIds.get(row.id) ?? null,
      cells: row.cells,
    })),
  };
}

/** Removes every current row, then rebuilds rows/cells/columns/master/
 * tempo from `patch`. Returns the tempo/limiter values so the caller can
 * sync the UI elements and LimiterEffect that live outside GridModel. */
export async function applyPatch(
  model: GridModel,
  audioContext: AudioContext,
  patch: Patch,
  rowSampleIds: Map<string, string>,
): Promise<TempoState> {
  for (const row of model.getRows()) {
    model.removeRow(row);
  }
  rowSampleIds.clear();

  model.setColumnCount(patch.columnCount);
  model.precedence = patch.precedence;
  // ?? fallback: patches saved before this field existed have no
  // scaleRoot/scaleType key at all -- fall back to GridModel's own
  // "off" defaults rather than clobbering them with undefined.
  model.scaleRoot = patch.scaleRoot ?? 0;
  model.scaleType = patch.scaleType ?? "chromatic";
  patch.columns.forEach((columnConfig, i) => {
    model.setColumn(i, columnConfig as Partial<ColumnConfig>);
  });

  for (const patchRow of patch.rows) {
    await addPatchRow(model, audioContext, patchRow, rowSampleIds);
  }

  model.setMasterGain(patch.masterGain);
  model.setMasterEffects(patch.masterEffects as EffectSpec[]);

  return {
    bpm: patch.bpm,
    subdivision: patch.subdivision,
    limiterCeiling: patch.limiterCeiling,
    limiterRelease: patch.limiterRelease,
  };
}

async function addPatchRow(
  model: GridModel,
  audioContext: AudioContext,
  patchRow: PatchRow,
  rowSampleIds: Map<string, string>,
): Promise<Row> {
  const row = await model.addRow(
    patchRow.sourceType as SourceType,
    patchRow.name,
    false,
  );

  if (!patchRow.enabled) model.setRowEnabled(row, false);
  model.setRowTriggerMode(row, patchRow.triggerMode as TriggerMode);
  model.setRowPlaybackMode(row, patchRow.playbackMode as "direct" | "pitched");
  if (patchRow.defaultsOverride) model.setRowDefaultsOverride(row, true);
  model.setRowDefaultNote(row, patchRow.defaultNote);
  model.setRowDefaultGain(row, patchRow.defaultGain);
  model.setRowDefaultTimeShift(row, patchRow.defaultTimeShiftSeconds);
  if (patchRow.envelopeOverride) model.setRowEnvelopeOverride(row, true);
  model.setRowEnvelope(row, (patchRow.envelope as EnvelopeParams).points);
  model.setRowEffects(row, patchRow.effects as EffectSpec[]);
  model.setRowReverbSend(row, patchRow.reverbSend);
  row.source.setParams(patchRow.sourceParams);

  if (patchRow.sampleId && row.source.needsSample) {
    // The referenced sample can be gone by the time this patch is loaded
    // again -- the library management page now allows deleting any
    // sample, including ones a saved patch still points at (see README's
    // Known limitations). That's this row's problem alone: it shouldn't
    // take the rest of the patch load down with it, so this row just
    // ends up with no sample loaded instead of the whole applyPatch call
    // throwing partway through the row list.
    try {
      const arrayBuffer = await fetchSampleAudio(patchRow.sampleId);
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      await model.loadRowSample(row, buffer);
      rowSampleIds.set(row.id, patchRow.sampleId);
    } catch (err) {
      console.error(
        `Row "${row.config.name}"'s sample (${patchRow.sampleId}) couldn't be loaded -- it may have been deleted from the library:`,
        err,
      );
    }
  }
  model.setRowSampleRange(row, patchRow.sampleRange);

  patchRow.cells.forEach((cell, i) => {
    model.setCell(row, i, cell as Partial<CellConfig>);
  });

  return row;
}
