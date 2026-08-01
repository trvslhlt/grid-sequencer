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
    sendBusEffects: model.getSendBusEffects(),
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
      sendLevel: row.config.sendLevel,
      pan: row.config.pan,
      sampleRange: row.config.sampleRange,
      reversed: row.config.reversed,
      duck: row.config.duck,
      continuePlayback: row.config.continuePlayback,
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
  // ?? fallback: patches saved before the send bus was generalized from a
  // hardcoded reverb have no such key at all -- an empty chain (silent
  // send bus) is the correct fallback, not a migration system.
  model.setSendBusEffects((patch.sendBusEffects as EffectSpec[]) ?? []);

  return {
    bpm: patch.bpm,
    subdivision: patch.subdivision,
    limiterCeiling: patch.limiterCeiling,
    limiterRelease: patch.limiterRelease,
  };
}

/** Builds a full independent copy of `sourceRow` -- same "walk live
 * state into a plain snapshot, then rebuild live state from it" round
 * trip serializePatch/addPatchRow already do for a whole patch's worth
 * of rows, just for one row with no actual save/load in between. Every
 * object/array-valued field is structuredClone'd rather than handed to
 * addPatchRow by reference: addPatchRow's own per-field
 * setRowX(row, patchRow.x) calls mostly replace whichever nested object
 * wholesale on the *next* edit (so a shared reference would usually
 * self-heal), but nothing here guarantees every future mutation path
 * does that everywhere, and two rows silently sharing one mutable
 * envelope/cells array is exactly the kind of bug that stays invisible
 * until someone edits one row and is confused the other one changed
 * too. Renamed ("X copy", "X copy 2", ...) rather than reusing the
 * source's exact name: duck's own name-based targeting would still
 * work fine with a duplicate name (first match wins), but every row-
 * name dropdown in the app (duck's own target picker included) would
 * read ambiguously otherwise. */
export async function duplicateRow(
  model: GridModel,
  audioContext: AudioContext,
  sourceRow: Row,
  rowSampleIds: Map<string, string>,
): Promise<Row> {
  const existingNames = new Set(model.getRows().map((r) => r.config.name));
  let name = `${sourceRow.config.name} copy`;
  for (let n = 2; existingNames.has(name); n++) {
    name = `${sourceRow.config.name} copy ${n}`;
  }

  const snapshot: PatchRow = {
    name,
    sourceType: sourceRow.config.sourceType,
    enabled: sourceRow.config.enabled,
    triggerMode: structuredClone(sourceRow.config.triggerMode),
    playbackMode: sourceRow.config.playbackMode,
    defaultsOverride: sourceRow.config.defaultsOverride,
    defaultNote: sourceRow.config.defaultNote,
    defaultGain: sourceRow.config.defaultGain,
    defaultTimeShiftSeconds: sourceRow.config.defaultTimeShiftSeconds,
    envelopeOverride: sourceRow.config.envelopeOverride,
    envelope: structuredClone(sourceRow.config.envelope),
    effects: structuredClone(sourceRow.config.effects),
    sendLevel: sourceRow.config.sendLevel,
    pan: sourceRow.config.pan,
    sampleRange: structuredClone(sourceRow.config.sampleRange),
    reversed: sourceRow.config.reversed,
    duck: structuredClone(sourceRow.config.duck),
    continuePlayback: sourceRow.config.continuePlayback,
    sourceParams: structuredClone(sourceRow.source.getParams()),
    sampleId: rowSampleIds.get(sourceRow.id) ?? null,
    cells: structuredClone(sourceRow.cells),
  };

  return addPatchRow(model, audioContext, snapshot, rowSampleIds);
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
  // Before the sample-loading block below -- loadRowSample reverses an
  // incoming buffer based on this flag, so it needs to already be set by
  // the time a sample gets fetched/decoded, not after.
  if (patchRow.reversed) model.setRowReversed(row, true);
  if (patchRow.defaultsOverride) model.setRowDefaultsOverride(row, true);
  model.setRowDefaultNote(row, patchRow.defaultNote);
  model.setRowDefaultGain(row, patchRow.defaultGain);
  model.setRowDefaultTimeShift(row, patchRow.defaultTimeShiftSeconds);
  if (patchRow.envelopeOverride) model.setRowEnvelopeOverride(row, true);
  model.setRowEnvelope(row, (patchRow.envelope as EnvelopeParams).points);
  model.setRowEffects(row, patchRow.effects as EffectSpec[]);
  model.setRowSendLevel(row, patchRow.sendLevel);
  model.setRowPan(row, patchRow.pan ?? 0);
  // Targets by name, resolved live at fire time (see RowConfig.duck's own
  // doc) -- safe to set regardless of whether the target row has been
  // added yet, since addPatchRow runs once per row in sequence here but
  // nothing reads this until playback actually fires a note.
  if (patchRow.duck) model.setRowDuck(row, patchRow.duck);
  if (patchRow.continuePlayback) {
    model.setRowContinuePlayback(row, true);
  }
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
