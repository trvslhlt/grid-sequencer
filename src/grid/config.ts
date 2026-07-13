import type { SourceType } from "./sourceFactory";
import type { TriggerMode } from "./triggerModes";

export type EffectType =
  | "filter"
  | "delay"
  | "distortion"
  | "compressor"
  | "tremolo"
  | "ringMod";

export interface EffectSpec {
  type: EffectType;
  params: Record<string, number | string>;
}

/** Same shape as bruit-kit's AdsrParams (sources/envelope.ts), redeclared
 * locally so this file doesn't reach into bruit-kit for one structural
 * type -- gridModel.ts, which already imports AdsrParams to talk to
 * sources/ directly, passes a ResolvedCellConfig.envelope straight through
 * to a source's setParams(), where structural typing makes the two
 * interchangeable with no conversion. */
export interface EnvelopeParams {
  attackMs: number;
  decayMs: number;
  sustainLevel: number;
  releaseMs: number;
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

function pickEnvelope(
  cell: { envelopeOverride: boolean; envelope: EnvelopeParams },
  row: { envelopeOverride: boolean; envelope: EnvelopeParams },
  column: { envelopeOverride: boolean; envelope: EnvelopeParams },
  precedence: Precedence,
  builtIn: EnvelopeParams,
): EnvelopeParams {
  const rowEnv = row.envelopeOverride ? row.envelope : undefined;
  const columnEnv = column.envelopeOverride ? column.envelope : undefined;
  const cellEnv = cell.envelopeOverride ? cell.envelope : undefined;
  return {
    attackMs: pick(
      cellEnv?.attackMs,
      rowEnv?.attackMs,
      columnEnv?.attackMs,
      precedence,
      builtIn.attackMs,
    ),
    decayMs: pick(
      cellEnv?.decayMs,
      rowEnv?.decayMs,
      columnEnv?.decayMs,
      precedence,
      builtIn.decayMs,
    ),
    sustainLevel: pick(
      cellEnv?.sustainLevel,
      rowEnv?.sustainLevel,
      columnEnv?.sustainLevel,
      precedence,
      builtIn.sustainLevel,
    ),
    releaseMs: pick(
      cellEnv?.releaseMs,
      rowEnv?.releaseMs,
      columnEnv?.releaseMs,
      precedence,
      builtIn.releaseMs,
    ),
  };
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
