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
  defaultNote: number | undefined;
  defaultTimeShiftSeconds: number;
  /** This row's persistent effect chain, built once and never torn down
   * until the row is removed (see effectsChain.ts). */
  effects: EffectSpec[];
  reverbSend: number;
}

export interface ColumnConfig {
  /** Column-master on/off: false skips this step index for every row,
   * regardless of any row's own cell state. */
  enabled: boolean;
  defaultNote: number | undefined;
  defaultGate: number | undefined;
  defaultTimeShiftSeconds: number | undefined;
}

export interface CellConfig {
  /** Always per-cell, never inherited from row or column. */
  on: boolean;
  note: number | undefined;
  gate: number | undefined;
  timeShiftSeconds: number | undefined;
  /** When set, replaces the row's own effect chain selection for this cell
   * outright rather than merging with it -- a cell either uses its row's
   * persistent chain or its own, not a blend of both. */
  effects: EffectSpec[] | undefined;
}

export interface ResolvedCellConfig {
  /** Whether this cell actually sounds this cycle: its own on/off, AND-ed
   * with the row not being muted and the column not being skipped. */
  fires: boolean;
  note: number;
  gate: number;
  timeShiftSeconds: number;
  effects: EffectSpec[];
}

export interface BuiltInDefaults {
  note: number;
  gate: number;
  timeShiftSeconds: number;
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
  return {
    fires: cell.on && row.enabled && column.enabled,
    note: pick(
      cell.note,
      row.defaultNote,
      column.defaultNote,
      precedence,
      builtIns.note,
    ),
    gate: pick(
      cell.gate,
      rowDefaultGate,
      column.defaultGate,
      precedence,
      builtIns.gate,
    ),
    timeShiftSeconds: pick(
      cell.timeShiftSeconds,
      row.defaultTimeShiftSeconds,
      column.defaultTimeShiftSeconds,
      precedence,
      builtIns.timeShiftSeconds,
    ),
    effects: cell.effects ?? row.effects,
  };
}
