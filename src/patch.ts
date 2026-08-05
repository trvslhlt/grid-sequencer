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

/** The same plain-JSON shape serializePatch produces, minus the fields a
 * save actually needs (id/createdAt/name) -- what a patch "is" independent
 * of where it's persisted. Used both for save/load (Patch itself extends
 * this via PatchSummary) and for in-memory undo/redo snapshots (see
 * main.ts's undo stack and restoreSnapshot below), which never touch the
 * backend at all. */
export type PatchSnapshot = Omit<Patch, "id" | "createdAt" | "name">;

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
): PatchSnapshot {
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
      defaultGainOverride: row.config.defaultGainOverride,
      defaultTimeShiftSeconds: row.config.defaultTimeShiftSeconds,
      probability: row.config.probability,
      envelopeOverride: row.config.envelopeOverride,
      envelope: row.config.envelope,
      effects: row.config.effects,
      sendLevel: row.config.sendLevel,
      pan: row.config.pan,
      level: row.config.level,
      sampleRange: row.config.sampleRange,
      reversed: row.config.reversed,
      duck: row.config.duck,
      callResponse: row.config.callResponse,
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
    defaultGainOverride: sourceRow.config.defaultGainOverride,
    defaultTimeShiftSeconds: sourceRow.config.defaultTimeShiftSeconds,
    probability: sourceRow.config.probability,
    envelopeOverride: sourceRow.config.envelopeOverride,
    envelope: structuredClone(sourceRow.config.envelope),
    effects: structuredClone(sourceRow.config.effects),
    sendLevel: sourceRow.config.sendLevel,
    pan: sourceRow.config.pan,
    level: sourceRow.config.level,
    sampleRange: structuredClone(sourceRow.config.sampleRange),
    reversed: sourceRow.config.reversed,
    duck: structuredClone(sourceRow.config.duck),
    callResponse: structuredClone(sourceRow.config.callResponse),
    continuePlayback: sourceRow.config.continuePlayback,
    sourceParams: structuredClone(sourceRow.source.getParams()),
    sampleId: rowSampleIds.get(sourceRow.id) ?? null,
    cells: structuredClone(sourceRow.cells),
  };

  return addPatchRow(model, audioContext, snapshot, rowSampleIds);
}

/** Applies every config field `patchRow` describes onto an already-
 * existing row (fresh from addRow, or one that's been playing for an
 * hour) -- the shared "make this row's config match this data" step both
 * addPatchRow (a brand new row) and restoreSnapshot (an existing one, for
 * undo/redo -- see its own doc) need, split out so undo/redo doesn't have
 * to duplicate this field list.
 *
 * The effects/continuePlayback guards below aren't optional cleanup: unlike
 * every other setter here (a cheap config write, or an idempotent AudioParam
 * set), setRowEffects unconditionally tears down and rebuilds the row's
 * whole effects chain, and setRowContinuePlayback unconditionally resets
 * the tracked scan position -- calling either on every restore regardless
 * of whether that field actually changed would rebuild a chain (a
 * potential audible glitch on a row that's mid-note) or drop scan position
 * on every single undo step, not just the ones that touch it. */
async function applyRowConfig(
  model: GridModel,
  audioContext: AudioContext,
  row: Row,
  patchRow: PatchRow,
  rowSampleIds: Map<string, string>,
): Promise<void> {
  model.setRowName(row, patchRow.name);
  model.setRowEnabled(row, patchRow.enabled);
  model.setRowTriggerMode(row, patchRow.triggerMode as TriggerMode);
  model.setRowPlaybackMode(row, patchRow.playbackMode as "direct" | "pitched");
  // Before the sample-loading block below -- loadRowSample reverses an
  // incoming buffer based on this flag, so it needs to already be set by
  // the time a sample gets fetched/decoded, not after.
  model.setRowReversed(row, patchRow.reversed);
  model.setRowDefaultsOverride(row, patchRow.defaultsOverride);
  model.setRowDefaultNote(row, patchRow.defaultNote);
  model.setRowDefaultGain(row, patchRow.defaultGain);
  model.setRowDefaultGainOverride(row, patchRow.defaultGainOverride ?? false);
  model.setRowDefaultTimeShift(row, patchRow.defaultTimeShiftSeconds);
  model.setRowProbability(row, patchRow.probability ?? 1);
  model.setRowEnvelopeOverride(row, patchRow.envelopeOverride);
  model.setRowEnvelope(row, (patchRow.envelope as EnvelopeParams).points);
  if (JSON.stringify(patchRow.effects) !== JSON.stringify(row.config.effects)) {
    model.setRowEffects(row, patchRow.effects as EffectSpec[]);
  }
  model.setRowSendLevel(row, patchRow.sendLevel);
  model.setRowPan(row, patchRow.pan ?? 0);
  model.setRowLevel(row, patchRow.level ?? 1);
  // Targets by name, resolved live at fire time (see RowConfig.duck's own
  // doc) -- safe to set regardless of whether the target row has been
  // added yet, since rows apply in sequence here but nothing reads this
  // until playback actually fires a note.
  model.setRowDuck(row, patchRow.duck);
  model.setRowCallResponse(row, patchRow.callResponse);
  if ((patchRow.continuePlayback ?? false) !== row.config.continuePlayback) {
    model.setRowContinuePlayback(row, patchRow.continuePlayback ?? false);
  }
  row.source.setParams(patchRow.sourceParams);

  const currentSampleId = rowSampleIds.get(row.id) ?? null;
  if (
    patchRow.sampleId &&
    patchRow.sampleId !== currentSampleId &&
    row.source.needsSample
  ) {
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
  await applyRowConfig(model, audioContext, row, patchRow, rowSampleIds);
  return row;
}

/** The undo/redo counterpart to applyPatch: restores `snapshot` (an
 * earlier currentSnapshot() from main.ts's undo stack) without applyPatch's
 * "remove every row, rebuild every row from scratch" approach -- that
 * would tear down and re-fetch every row's sample audio over the network
 * on every single undo click, which is both slow and would audibly cut
 * off anything mid-playback. Instead this patches existing rows in place
 * by index (reusing applyRowConfig, which already only touches a sample's
 * audio when its id actually changed), and only adds/removes rows at all
 * when the snapshot's row count actually differs from the live one --
 * e.g. undoing past an Add Row or a Remove Row. Row identity doesn't
 * survive an add/remove either way (row.id is a fresh crypto.randomUUID()
 * every time addRow runs, same as a normal patch load), so a panel left
 * open on a row that gets removed this way just falls back to "nothing
 * selected", same as any other stale selection. */
export async function restoreSnapshot(
  model: GridModel,
  audioContext: AudioContext,
  snapshot: PatchSnapshot,
  rowSampleIds: Map<string, string>,
): Promise<TempoState> {
  model.setColumnCount(snapshot.columnCount);
  model.precedence = snapshot.precedence;
  model.scaleRoot = snapshot.scaleRoot ?? 0;
  model.scaleType = snapshot.scaleType ?? "chromatic";
  snapshot.columns.forEach((columnConfig, i) => {
    model.setColumn(i, columnConfig as Partial<ColumnConfig>);
  });

  // Trim from the end first so the index-aligned patch loop below only
  // ever has to grow the row list, never also shrink it mid-loop.
  const excess = model.getRows().slice(snapshot.rows.length);
  for (const row of excess) {
    model.removeRow(row);
    rowSampleIds.delete(row.id);
  }

  const rows = model.getRows();
  for (let i = 0; i < snapshot.rows.length; i++) {
    const patchRow = snapshot.rows[i];
    if (i < rows.length) {
      await applyRowConfig(model, audioContext, rows[i], patchRow, rowSampleIds);
    } else {
      await addPatchRow(model, audioContext, patchRow, rowSampleIds);
    }
  }

  model.setMasterGain(snapshot.masterGain);
  if (
    JSON.stringify(snapshot.masterEffects) !==
    JSON.stringify(model.getMasterEffects())
  ) {
    model.setMasterEffects(snapshot.masterEffects as EffectSpec[]);
  }
  const nextSendBusEffects = (snapshot.sendBusEffects as EffectSpec[]) ?? [];
  if (
    JSON.stringify(nextSendBusEffects) !==
    JSON.stringify(model.getSendBusEffects())
  ) {
    model.setSendBusEffects(nextSendBusEffects);
  }

  return {
    bpm: snapshot.bpm,
    subdivision: snapshot.subdivision,
    limiterCeiling: snapshot.limiterCeiling,
    limiterRelease: snapshot.limiterRelease,
  };
}
