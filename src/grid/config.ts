import type { EffectSpec } from "bruit-kit/audio";
import type { SourceType } from "./sourceFactory";
import type { TriggerMode } from "./triggerModes";

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
  /** Governs defaultNote/defaultTimeShiftSeconds together (see the panel's
   * own "Override" button in the row's Defaults section) -- these are
   * sequencer/cascade concerns, independent of the instrument, so they
   * share one toggle the same way column defaults do. defaultGain used to
   * be part of this same toggle, but it scales envelopeGain -- the same
   * pre-effects node the instrument's own Envelope curve drives -- so it's
   * gated by its own defaultGainOverride instead and lives in the
   * Instrument popup, not here. Always-present values, editable and
   * previewable whether or not this row currently contributes them to the
   * cascade, same reasoning as CellConfig.effects staying live while
   * effectsOverride is off. Only actually consulted when this row is the
   * *losing* side of the global Row/column precedence setting -- when
   * precedence favors row, this row's defaultNote/defaultTimeShiftSeconds
   * apply unconditionally regardless of this flag (see
   * resolveCellConfig's pickByPrecedence), so gridView.ts shows this
   * toggle as on-and-disabled in that case rather than reading whatever
   * it's actually set to. */
  defaultsOverride: boolean;
  defaultNote: number;
  defaultTimeShiftSeconds: number;
  /** 0..1, default 1 (always fires) -- rolled once per tick for every
   * armed (cell.on) step of this row, independent of defaultsOverride:
   * unlike defaultNote/defaultTimeShiftSeconds, this isn't a cascade
   * fallback for cells with no value of their own, it's a per-tick gate
   * that applies uniformly to every cell this row fires, whether or not
   * that cell has its own note/gain/gate set. Tying it to the same
   * toggle as the cascade fallbacks would make turning Override on/off
   * for "does my default note apply" also silently change how often
   * hand-set cells fire, which is a confusing coupling of two unrelated
   * concerns -- so it's always active instead. Lives in the row panel's
   * Defaults section purely for UI grouping (see gridView.ts's rowPanel);
   * GridModel.fireTick applies it directly, not through
   * resolveCellConfig's cascade -- no per-column or per-cell probability
   * exists (yet), just this one row-wide knob. */
  probability: number;
  /** Scales envelopeGain -- pre-effects, the same node the Envelope curve
   * itself drives (see envelope's own doc) -- unlike sendLevel/pan/level
   * below, which are all downstream of the effects chain. Lives in the
   * Instrument popup for that reason: an effect reacts to a gain change
   * here the same way it reacts to an Envelope change, not the way it
   * reacts to Pan (which never touches the signal). Gated by its own
   * defaultGainOverride, separate from defaultsOverride above, since it's
   * a different category of default (instrument, not sequencer) even
   * though the *mechanism* -- a cascade fallback for cells with no gain of
   * their own -- is identical to defaultNote's. Same precedence-winner
   * exemption as defaultsOverride: only consulted when this row is the
   * losing side for gain specifically (see resolveCellConfig). */
  defaultGainOverride: boolean;
  defaultGain: number;
  envelopeOverride: boolean;
  envelope: EnvelopeParams;
  /** This row's persistent effect chain, built once and never torn down
   * until the row is removed (see effectsChain.ts). */
  effects: EffectSpec[];
  /** 0..1: how much of this row's (post-effects) output reaches the
   * shared send bus (see GridModel's sendBusInput/sendChain) -- a
   * parallel tap, not a replacement for the row's own direct path to the
   * master bus. The send bus's own effect chain (Master panel's "Send
   * Bus" section) decides what happens to whatever arrives here; it's
   * arbitrary and user-configured, not hardcoded to reverb any more, so
   * this is deliberately not called "reverbSend". */
  sendLevel: number;
  /** -1 (full left) .. 1 (full right), 0 = center -- a native
   * StereoPannerNode on GridModel's own RowRuntime.panNode, not an
   * EFFECT_TABLE entry: this is a channel-strip mixer control every row
   * always has (same category as sendLevel), not an insert effect
   * someone adds/removes/reorders in a chain. Applies to both this
   * row's dry output and its send-bus tap uniformly -- same "affects
   * both paths alike" positioning as duckGain, sitting right after it
   * in the signal path (see addRow). */
  pan: number;
  /** A plain always-on multiplier on GridModel's own RowRuntime.levelNode,
   * default 1 (unity) -- same category as pan/sendLevel (a channel-strip
   * mixer control, not an insert effect, no override/cascade concept the
   * way defaultGain has). Sits right after panNode, before the split to
   * masterGain and the send-bus tap (see addRow), so it scales both this
   * row's dry output and its send-bus contribution together -- turning a
   * row's Level down turns its reverb tail down too, the common "channel
   * fader" convention. Distinct from defaultGain, which scales a
   * *pre-effects* node (envelopeGain) and only ever applies as a cascade
   * fallback for cells with no gain of their own -- this applies
   * unconditionally, downstream of everything, the same way pan does. */
  level: number;
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
  /** Sidechain-style ducking: whenever THIS row actually fires (same
   * gate as everything else -- muted/soloed-out/cell-off rows duck
   * nothing), briefly reduces `targetRowName`'s own gain to `1 - amount`
   * over `attackMs`, then recovers to normal over `releaseMs` -- the
   * classic "kick ducks the pad" sidechain pump. Targeted by name, not
   * the runtime row id: row ids are freshly regenerated on every patch
   * load (see patch.ts's PatchRow, which has no id field at all), so a
   * name is the only reference that can round-trip through save/load.
   * Renaming the target row after the fact doesn't error or get cleared
   * -- the relationship just goes quietly inert until a same-named row
   * exists again (see GridModel.fireTick's live name lookup). undefined,
   * or an empty targetRowName, means no ducking. */
  duck?: {
    targetRowName: string;
    amount: number;
    attackMs: number;
    releaseMs: number;
  };
  /** Duck's sibling: whenever THIS row actually fires (same gate as
   * duck -- muted/soloed-out/cell-off rows trigger nothing), rolls
   * `probability` (0..1) and on a hit fires `targetRowName`'s own
   * row-level voice -- its defaultNote/defaultGain/envelope/gate,
   * exactly as if it had fired an empty, unoverridden cell of its own,
   * since there's no specific cell here to pull a note from -- landing
   * `delaySeconds` after the call so the response reads as a reply
   * rather than a doubled hit. Targeted by name, resolved live at fire
   * time, same reasoning as duck's own doc (row ids regenerate on every
   * patch load; renaming the target just goes quietly inert instead of
   * erroring). The target's own mute/solo state still gates it: a
   * muted or soloed-out target stays silent even on a winning roll,
   * same as it would for its own cells. undefined, or an empty
   * targetRowName, means no call-and-response. */
  callResponse?: {
    targetRowName: string;
    probability: number;
    delaySeconds: number;
  };
  /** samplePlayer rows only: instead of every hit starting from the
   * trimmed range's own start (sampleRange.start), each hit picks up
   * from wherever a virtual "scan" position has advanced to since this
   * row's last hit -- advancing by real elapsed wall-clock time (not
   * audio-buffer time actually consumed, which would depend on each
   * hit's own pitch/gate; the simpler clock-time model was chosen
   * first, see the sound-play backlog), wrapping back to the range
   * start once it reaches the range end. Gives successive hits on the
   * same row variety -- different slices of a longer sample -- instead
   * of always replaying the identical opening snippet. Tracked as
   * RowRuntime.scanPositionSeconds/scanLastFireTime, not here: this
   * flag is the persisted intent, the live scan position itself is
   * session state the same way a live-drifting effect param's current
   * value is (see EffectSpec.drift's own doc). Doesn't apply to a
   * cell's own effects override (fireSamplePlayerOverride) -- that's
   * already a more specialized per-hit path this doesn't extend into
   * for now. */
  continuePlayback: boolean;
}

export interface ColumnConfig {
  /** Column-master on/off: false skips this step index for every row,
   * regardless of any row's own cell state. */
  enabled: boolean;
  /** Governs defaultNote/defaultGain/defaultTimeShiftSeconds together --
   * unlike RowConfig.defaultsOverride, this one flag still covers gain
   * too (no popup split needed on the column side, since a column has no
   * instrument to separate it from). Doesn't govern defaultGate -- see
   * defaultGateOverride's own doc for why that one's independent. */
  defaultsOverride: boolean;
  defaultNote: number;
  defaultGain: number;
  /** Row has no gate concept of its own to race against (a row's gate
   * always comes from its trigger mode, see GridModel's rowDefaultGate) --
   * so unlike note/gain/timeShift, there's no "row vs. column, whichever
   * the precedence setting favors" question for gate at all, just "does
   * the column have one, or not." Its own flag, independent of
   * defaultsOverride, so it's never disabled by precedence the way that
   * one now is (see gridView.ts's columnPanel). */
  defaultGateOverride: boolean;
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

/** Whichever side the global Row/column precedence setting favors
 * contributes its raw value *unconditionally* -- the losing side only
 * takes over when it explicitly opts in via `loserOverride`. This is
 * deliberately not symmetric with the losing side's own state the way an
 * earlier version of this cascade was: a row/column always has *some*
 * concrete default value (never undefined at the type level, seeded from
 * BUILT_INS when the row/column is created), so the winning side never
 * needs its own Override flag consulted at all -- it always contributes.
 * Only the losing side needs a flag, to escape hatch out of losing.
 * gridView.ts's row/column panels reflect this: the winning side's own
 * Override button is shown on and disabled (toggling it can't change an
 * outcome it already controls), only the losing side's is interactive.
 * `winnerValue`/`loserValue` are already precedence-ordered by the
 * caller. */
function pickByPrecedence(
  cellValue: number | undefined,
  winnerValue: number,
  loserValue: number,
  loserOverride: boolean,
): number {
  if (cellValue !== undefined) return cellValue;
  return loserOverride ? loserValue : winnerValue;
}

/** Unlike every numeric default, a breakpoint curve can't be usefully
 * merged field-by-field across cell/row/column -- there's no sensible
 * meaning to "this point from the cell, that point from the row." So the
 * whole points array is picked from a single winning level instead of
 * `pickByPrecedence`'s per-field cascade, same precedence-winner-unless-
 * loser-overrides reasoning otherwise (see its own doc). */
function pickEnvelope(
  cell: { envelopeOverride: boolean; envelope: EnvelopeParams },
  row: { envelopeOverride: boolean; envelope: EnvelopeParams },
  column: { envelopeOverride: boolean; envelope: EnvelopeParams },
  precedence: Precedence,
): EnvelopeParams {
  if (cell.envelopeOverride) return cell.envelope;
  const rowWins = precedence === "row";
  const winner = rowWins ? row : column;
  const loser = rowWins ? column : row;
  return loser.envelopeOverride ? loser.envelope : winner.envelope;
}

export function resolveCellConfig(
  cell: CellConfig,
  row: RowConfig,
  column: ColumnConfig,
  precedence: Precedence,
  /** The row's trigger mode derives a gate from the *current* step length
   * (see triggerModeGate) -- a runtime value, not part of RowConfig's
   * static shape, so the caller computes and passes it in rather than this
   * module reaching for stepSeconds itself. Always a concrete number
   * (never undefined) -- see gate's own handling below for why that
   * makes it exempt from the row/column precedence race entirely. */
  rowDefaultGate: number,
): ResolvedCellConfig {
  const rowWins = precedence === "row";
  return {
    fires: cell.on && row.enabled && column.enabled,
    note: pickByPrecedence(
      cell.note,
      rowWins ? row.defaultNote : column.defaultNote,
      rowWins ? column.defaultNote : row.defaultNote,
      rowWins ? column.defaultsOverride : row.defaultsOverride,
    ),
    // defaultGain's own loser-side flag differs by which side is
    // losing -- row.defaultGainOverride is its own separate toggle (see
    // RowConfig's own doc for why), column has no equivalent split, its
    // shared defaultsOverride covers gain too.
    gain: pickByPrecedence(
      cell.gain,
      rowWins ? row.defaultGain : column.defaultGain,
      rowWins ? column.defaultGain : row.defaultGain,
      rowWins ? column.defaultsOverride : row.defaultGainOverride,
    ),
    // Not a precedence race at all -- row has no gate concept to
    // compete with column's (a row's own gate always comes from its
    // trigger mode, not a settable default), so column's own
    // defaultGateOverride is the only thing that ever matters here,
    // independent of the global precedence setting entirely.
    gate: cell.gate ?? (column.defaultGateOverride ? column.defaultGate : rowDefaultGate),
    timeShiftSeconds: pickByPrecedence(
      cell.timeShiftSeconds,
      rowWins ? row.defaultTimeShiftSeconds : column.defaultTimeShiftSeconds,
      rowWins ? column.defaultTimeShiftSeconds : row.defaultTimeShiftSeconds,
      rowWins ? column.defaultsOverride : row.defaultsOverride,
    ),
    envelope: pickEnvelope(cell, row, column, precedence),
    effects: cell.effectsOverride ? cell.effects : row.effects,
  };
}
