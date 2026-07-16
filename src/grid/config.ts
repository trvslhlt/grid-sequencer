import type { SourceType } from "./sourceFactory";
import type { TriggerMode } from "./triggerModes";

export type EffectType =
  | "filter"
  | "delay"
  | "distortion"
  | "compressor"
  | "tremolo"
  | "ringMod"
  | "chorus"
  | "flanger"
  | "phaser"
  | "autoWah"
  | "bitcrusher";

export interface EffectSpec {
  type: EffectType;
  params: Record<string, number | string>;
}

export interface EnvelopePoint {
  /** 0..1 position across the note's own gated duration (not a fixed
   * seconds value) -- so the same shape stretches or compresses with
   * gate/tempo instead of needing to be re-tuned by hand. */
  position: number;
  /** 0..1, scaled by the resolved gain at fire time. */
  value: number;
}

/** Same shape as bruit-kit's AutomationPoint (audio/automation.ts +
 * ui/automationEditor.ts), redeclared locally so this file doesn't reach
 * into bruit-kit for one structural type -- gridModel.ts, which already
 * imports scheduleAutomation to talk to bruit-kit directly, passes a
 * ResolvedCellConfig.envelope.points straight through, where structural
 * typing makes the two interchangeable with no conversion. A multi-point
 * breakpoint curve rather than a fixed ADSR shape -- the first/last points
 * are permanent anchors at position 0/1 (see createAutomationEditor), so
 * this always has at least 2 points. */
export interface EnvelopeParams {
  points: EnvelopePoint[];
}

/** Which of row/column wins when both set a default for the same field —
 * configurable per PLAN.md's cascade section, default "row". On/off has no
 * entry here: it's always per-cell, never defaulted from row or column. */
export type Precedence = "row" | "column";

export interface RowConfig {
  name: string;
  sourceType: SourceType;
  enabled: boolean;
  triggerMode: TriggerMode;
  /** samplePlayer rows only (see PLAN.md's "Sample playback: direct vs.
   * pitched"): "direct" always plays defaultNote regardless of any
   * note/column/cell assignment (playbackRate stays 1.0); "pitched" plays
   * the resolved cascade note like a synth-like row. Ignored by every
   * other source type, which are inherently pitched. */
  playbackMode: "direct" | "pitched";
  /** One toggle governs all three defaults together (see the panel's
   * single "Override" button per row/column) -- they're always-present
   * values, editable and previewable whether or not this row currently
   * contributes them to the cascade, same reasoning as CellConfig.effects
   * staying live while effectsOverride is off. */
  defaultsOverride: boolean;
  defaultNote: number;
  defaultGain: number;
  defaultTimeShiftSeconds: number;
  envelopeOverride: boolean;
  envelope: EnvelopeParams;
  /** This row's persistent effect chain, built once and never torn down
   * until the row is removed (see effectsChain.ts). */
  effects: EffectSpec[];
  reverbSend: number;
  /** samplePlayer rows only: 0..1 fractions of the loaded sample's own
   * duration, trimming which portion actually plays (see bruit-kit's
   * SamplePlayerParams.rangeStart/rangeEnd, which this maps straight onto).
   * Ignored by every other source type -- there's nothing to trim before a
   * sample is loaded, or for a source that doesn't play from a buffer. */
  sampleRange: { start: number; end: number };
  /** samplePlayer rows only: non-destructive playback-direction flip.
   * GridModel reverses whichever buffer is actually loaded (in place, see
   * setRowReversed/loadRowSample) rather than this being a param passed to
   * bruit-kit -- SamplePlayer has no reverse concept of its own, and
   * AudioBufferSourceNode.playbackRate can't go negative. Toggle any time,
   * before or after a sample is assigned; survives assigning a different
   * sample from the library. For a destructive, permanent reverse of the
   * stored library sample itself, see the Manage Library page's own
   * "Reverse" action instead -- unrelated to this flag, and doesn't touch
   * it. */
  reversed: boolean;
}

export interface ColumnConfig {
  /** Column-master on/off: false skips this step index for every row,
   * regardless of any row's own cell state. */
  enabled: boolean;
  defaultsOverride: boolean;
  defaultNote: number;
  defaultGain: number;
  defaultGate: number;
  defaultTimeShiftSeconds: number;
  envelopeOverride: boolean;
  envelope: EnvelopeParams;
}

export interface CellConfig {
  /** Always per-cell, never inherited from row or column. */
  on: boolean;
  note: number | undefined;
  gain: number | undefined;
  gate: number | undefined;
  timeShiftSeconds: number | undefined;
  envelopeOverride: boolean;
  envelope: EnvelopeParams;
  /** This cell's own would-be effect chain -- always present (not
   * undefined) so it can be edited and previewed while `effectsOverride`
   * is off, same as every other override's value control stays live
   * while unchecked. Only takes effect (replacing the row's own chain
   * outright, not merging with it) when `effectsOverride` is true. */
  effects: EffectSpec[];
  effectsOverride: boolean;
}

export interface ResolvedCellConfig {
  /** Whether this cell actually sounds this cycle: its own on/off, AND-ed
   * with the row not being muted and the column not being skipped. */
  fires: boolean;
  note: number;
  /** Linear 0-1 multiplier, converted to a MIDI velocity (0-127) at fire
   * time -- every sources/ class already scales its per-voice envelope
   * peak by velocity/127 (see triggerAttack's callers), so this needs no
   * new audio nodes or per-row/per-cell routing, unlike effects or
   * trigger mode. */
  gain: number;
  gate: number;
  timeShiftSeconds: number;
  envelope: EnvelopeParams;
  effects: EffectSpec[];
}

export interface BuiltInDefaults {
  note: number;
  gain: number;
  gate: number;
  timeShiftSeconds: number;
  envelope: EnvelopeParams;
}

function pick(
  cellValue: number | undefined,
  rowValue: number | undefined,
  columnValue: number | undefined,
  precedence: Precedence,
  builtIn: number,
): number {
  if (cellValue !== undefined) return cellValue;
  const primary = precedence === "row" ? rowValue : columnValue;
  const secondary = precedence === "row" ? columnValue : rowValue;
  if (primary !== undefined) return primary;
  if (secondary !== undefined) return secondary;
  return builtIn;
}

/** Unlike every numeric default, a breakpoint curve can't be usefully
 * merged field-by-field across cell/row/column -- there's no sensible
 * meaning to "this point from the cell, that point from the row." So the
 * whole points array is picked from a single winning level instead of
 * `pick()`'s per-field cascade, same precedence order otherwise. */
function pickEnvelope(
  cell: { envelopeOverride: boolean; envelope: EnvelopeParams },
  row: { envelopeOverride: boolean; envelope: EnvelopeParams },
  column: { envelopeOverride: boolean; envelope: EnvelopeParams },
  precedence: Precedence,
  builtIn: EnvelopeParams,
): EnvelopeParams {
  if (cell.envelopeOverride) return cell.envelope;
  // Only a side with its own override actually on contributes --
  // precedence just tie-breaks when *both* are on, see the matching
  // comment in resolveCellConfig.
  const rowEnv = row.envelopeOverride ? row.envelope : undefined;
  const columnEnv = column.envelopeOverride ? column.envelope : undefined;
  const primary = precedence === "row" ? rowEnv : columnEnv;
  const secondary = precedence === "row" ? columnEnv : rowEnv;
  return primary ?? secondary ?? builtIn;
}

export function resolveCellConfig(
  cell: CellConfig,
  row: RowConfig,
  column: ColumnConfig,
  precedence: Precedence,
  builtIns: BuiltInDefaults,
  /** The row's trigger mode derives a gate from the *current* step length
   * (see triggerModeGate) -- a runtime value, not part of RowConfig's
   * static shape, so the caller computes and passes it in rather than this
   * module reaching for stepSeconds itself. */
  rowDefaultGate: number,
): ResolvedCellConfig {
  // A row/column only contributes a field's default when its own
  // Override is on -- precedence is purely a tie-breaker for when *both*
  // sides contribute the same field (see pick() below), not a way for
  // one side to win unconditionally regardless of its own override
  // state. A row/column that's never touched its defaults (or has
  // explicitly turned its override off) shouldn't silently block the
  // other side from taking effect just because it happens to hold global
  // precedence -- that would make the *other* side's own Override toggle
  // permanently inert, which is exactly the bug this cascade must avoid.
  const rowDefaultNote = row.defaultsOverride ? row.defaultNote : undefined;
  const rowDefaultGain = row.defaultsOverride ? row.defaultGain : undefined;
  const rowDefaultShift = row.defaultsOverride
    ? row.defaultTimeShiftSeconds
    : undefined;
  const columnDefaultNote = column.defaultsOverride
    ? column.defaultNote
    : undefined;
  const columnDefaultGain = column.defaultsOverride
    ? column.defaultGain
    : undefined;
  const columnDefaultGate = column.defaultsOverride
    ? column.defaultGate
    : undefined;
  const columnDefaultShift = column.defaultsOverride
    ? column.defaultTimeShiftSeconds
    : undefined;

  return {
    fires: cell.on && row.enabled && column.enabled,
    note: pick(
      cell.note,
      rowDefaultNote,
      columnDefaultNote,
      precedence,
      builtIns.note,
    ),
    gain: pick(
      cell.gain,
      rowDefaultGain,
      columnDefaultGain,
      precedence,
      builtIns.gain,
    ),
    gate: pick(
      cell.gate,
      rowDefaultGate,
      columnDefaultGate,
      precedence,
      builtIns.gate,
    ),
    timeShiftSeconds: pick(
      cell.timeShiftSeconds,
      rowDefaultShift,
      columnDefaultShift,
      precedence,
      builtIns.timeShiftSeconds,
    ),
    envelope: pickEnvelope(cell, row, column, precedence, builtIns.envelope),
    effects: cell.effectsOverride ? cell.effects : row.effects,
  };
}
