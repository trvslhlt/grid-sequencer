import { createSend, scheduleAutomation } from "bruit-kit/audio";
import type { Send } from "bruit-kit/audio";
import { createStepClock } from "bruit-kit/midi";
import type { StepClock } from "bruit-kit/midi";
import { semitoneRatio } from "bruit-kit/sources";
import {
  type CellConfig,
  type ColumnConfig,
  type EffectSpec,
  type EnvelopeParams,
  type Precedence,
  type ResolvedCellConfig,
  type RowConfig,
  resolveCellConfig,
} from "./config";
import {
  type BuiltEffectsChain,
  buildEffectsChain,
  createEffectsChainCache,
} from "./effectsChain";
import { type ScaleType, quantizeToScale } from "./scale";
import {
  type RowSource,
  type SourceType,
  createRowSource,
} from "./sourceFactory";
import { triggerModeGate, triggerModeSourceParams } from "./triggerModes";

/** Exported so the UI can show the same fallback values a field resolves
 * to when nothing overrides it -- see fields.ts's "override" kind. The
 * envelope is deliberately not a musical ADSR shape: a quick rise to full
 * value, a long hold, and a quick drop right at the end is just enough to
 * avoid clicks at voice start/end, not a stylistic choice a preset would
 * make -- and it's a starting curve to reshape via the automation editor,
 * not a fixed set of stages. */
/** Caps how many links a call-and-response chain can cascade through in
 * one go (A triggers B, B's own callResponse triggers C, ...) -- see
 * triggerCallResponse's own doc for why a hard cap is required rather
 * than just trusting each hop's probability to eventually fizzle out:
 * two rows pointed at each other (or any longer cycle) would otherwise
 * recurse forever in one synchronous call, crashing the tab instead of
 * just this one scheduling tick. 8 is generous for the kind of short
 * musical phrase this feature is for -- deep enough that a real chain
 * never feels artificially truncated, shallow enough to stay well under
 * any JS engine's call-stack limit even at probability 1 on every hop. */
const MAX_CALL_RESPONSE_HOPS = 8;

export const BUILT_INS = {
  note: 60,
  gain: 0.8,
  gate: 1.0,
  timeShiftSeconds: 0,
  envelope: {
    points: [
      { position: 0, value: 0 },
      { position: 0.02, value: 1 },
      { position: 0.9, value: 1 },
      { position: 1, value: 0 },
    ],
  } satisfies EnvelopeParams,
};

/** A fixed, non-user-facing ramp baked into every row's shared source
 * instance at creation -- not this app's actual note envelope any more
 * (see the per-row `envelopeGain` node in addRow/fireTick below), just
 * enough of a floor that a source's own per-voice gain node never steps
 * straight to full amplitude, which could click on its own before
 * envelopeGain's shape gets a chance to smooth it. Deliberately not
 * user-configurable or part of the resolved cascade -- doubling it up
 * with envelopeGain's own attack/release would reshape whatever curve the
 * user actually drew. */
const SOURCE_ENVELOPE_FLOOR = {
  attackMs: 2,
  decayMs: 0,
  sustainLevel: 1,
  releaseMs: 5,
};

/** Every noteOn now goes out at full velocity -- gain is applied entirely
 * by the per-row envelopeGain node's automation curve (see fireTick),
 * not by scaling the source's own per-voice peak, so there's nothing left
 * for a MIDI velocity value to usefully carry. */
const FULL_VELOCITY = 127;

/** Flips a buffer's own sample-frame order, per channel -- the only way to
 * play "backward" at all, since AudioBufferSourceNode.playbackRate can't go
 * negative and bruit-kit's SamplePlayer has no reverse concept of its own
 * (see RowConfig.reversed's doc). Reversing twice is exactly the identity,
 * so callers never need to keep the original buffer around alongside a
 * reversed copy -- just reverse in place again to flip back. */
export function reverseAudioBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer,
): AudioBuffer {
  const reversed = audioContext.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const dest = reversed.getChannelData(channel);
    const length = source.length;
    for (let i = 0; i < length; i++) {
      dest[i] = source[length - 1 - i];
    }
  }
  return reversed;
}

function createEnvelope(): EnvelopeParams {
  return { points: BUILT_INS.envelope.points.map((p) => ({ ...p })) };
}

function createColumnConfig(): ColumnConfig {
  return {
    enabled: true,
    defaultsOverride: false,
    defaultNote: BUILT_INS.note,
    defaultGain: BUILT_INS.gain,
    defaultGate: BUILT_INS.gate,
    defaultTimeShiftSeconds: BUILT_INS.timeShiftSeconds,
    envelopeOverride: false,
    envelope: createEnvelope(),
  };
}

function createCellConfig(): CellConfig {
  return {
    on: false,
    note: undefined,
    gain: undefined,
    gate: undefined,
    timeShiftSeconds: undefined,
    envelopeOverride: false,
    envelope: createEnvelope(),
    effects: [],
    effectsOverride: false,
  };
}

/** RowConfig plus the runtime plumbing (source instance, persistent chain,
 * send bus tap, activation state) a row needs but the UI doesn't -- kept
 * as a class-private shape so callers only ever see the public `Row`
 * fields. */
interface RowRuntime {
  readonly id: string;
  config: RowConfig;
  readonly source: RowSource;
  /** Sits between source.output and the effects chain -- the resolved
   * envelope's breakpoint curve is scheduled onto this node's gain at
   * every firing tick (see fireTick), not on the source itself, so the
   * same shaping mechanism works uniformly across all 5 source types
   * including GranularSynth (whose own per-grain envelope lives inside an
   * AudioWorkletProcessor, unreachable from here). Persistent per row, not
   * per voice -- see the envelope docs in README's Known limitations for
   * what that means for overlapping notes. */
  readonly envelopeGain: GainNode;
  cells: CellConfig[];
  chain: BuiltEffectsChain;
  /** Sits between chain.output and this row's two normal destinations
   * (masterGain, send.input) -- see addRow's own doc. Persistent for the
   * row's whole lifetime, unlike `chain` (which setRowEffects freely
   * swaps): any *other* row's duck relationship targets this node
   * directly by name lookup at fire time (see fireTick's scheduleDuck),
   * so it has to stay the same node across effects edits or a duck
   * relationship set up before an edit would silently stop reaching the
   * row's actual output after one. */
  readonly duckGain: GainNode;
  /** Sits right after duckGain, before this row's two normal
   * destinations -- see RowConfig.pan's own doc. Persistent for the
   * row's whole lifetime, same reasoning as duckGain: nothing ever
   * needs to reconnect it (setRowEffects only ever swaps `chain`,
   * upstream of both of these). */
  readonly panNode: StereoPannerNode;
  /** Sits right after panNode, before the split to this row's two normal
   * destinations -- see RowConfig.level's own doc for why it scales both
   * of them together. Persistent for the row's whole lifetime, same
   * reasoning as duckGain/panNode. */
  readonly levelNode: GainNode;
  send: Send;
  sampleBuffer: AudioBuffer | undefined;
  active: boolean;
  pendingCycleLength: number | null;
  /** Deliberately not part of RowConfig/PatchRow -- solo is a live
   * audition tool (isolate what one row sounds like without losing every
   * other row's mute state), not song data, so it resets to "none soloed"
   * on every patch load rather than round-tripping through save/load or
   * counting toward the unsaved-changes dirty check. See fireTick's own
   * use of it for the actual silencing behavior. */
  solo: boolean;
  /** RowConfig.continuePlayback's own live tracking -- see its doc.
   * Seconds into the raw loaded buffer the virtual scan position
   * currently sits at, and the shiftedAtTime of this row's last hit
   * while continuePlayback was in effect (needed to compute how much
   * real time elapsed before advancing the position on the next one).
   * Both undefined until the first hit needs them; reset together
   * (setRowContinuePlayback, loadRowSample) whenever resuming from
   * wherever they last were wouldn't make sense any more. */
  scanPositionSeconds: number | undefined;
  scanLastFireTime: number | undefined;
}

export type Row = Readonly<
  Pick<RowRuntime, "id" | "config" | "source" | "cells">
> & { isActive(): boolean; isSoloed(): boolean };

/** Names one of the three persistent effects chains applyLiveEffectParam
 * can reach -- exported so gridView.ts's drift engine (the only caller
 * outside this file) can build one without redeclaring the shape. Cell
 * effect overrides have no persistent chain (a fresh one-shot instance
 * per hit, see fireSamplePlayerOverride) and so can never be a valid
 * target here. */
export type EffectLiveTarget =
  | { kind: "row"; rowId: string }
  | { kind: "master" | "sendBus" };

/** Everything one running grid needs: the shared clock (see bruit-kit's
 * stepClock.ts doc for why rows never own their own), the shared send
 * bus, the effects-chain cache, and the row/column config that
 * resolveCellConfig cascades through every tick. */
export class GridModel {
  readonly clock: StepClock;
  readonly masterGain: GainNode;
  columns: ColumnConfig[];
  precedence: Precedence = "row";
  /** A global quantization constraint above the cell/row/column note
   * cascade -- not part of that cascade itself, same reasoning as
   * `precedence` being a plain top-level field rather than something
   * resolveCellConfig resolves. `scaleRoot` is 0-11 (C=0), applied in
   * fireTick (see quantizeToScale in ./scale). Defaults to "chromatic"
   * (every semitone legal, i.e. off) so existing patches and the demo are
   * unaffected until a user opts in. */
  scaleRoot = 0;
  scaleType: ScaleType = "chromatic";
  columnCount: number;
  private masterEffects: EffectSpec[] = [];
  private masterChain: BuiltEffectsChain;
  private readonly masterDestination: AudioNode;
  private readonly chainCache: ReturnType<typeof createEffectsChainCache>;
  /** Every row's own Send level (see RowConfig.sendLevel) taps a copy of
   * that row's output into this fixed, never-reconnected node -- so
   * rebuilding sendChain on setSendBusEffects only ever needs to touch
   * this one connection (mirrors setMasterEffects' masterGain/masterChain
   * pair), not every row's individual send tap. */
  private readonly sendBusInput: GainNode;
  private sendBusEffects: EffectSpec[] = [];
  private sendChain: BuiltEffectsChain;
  private readonly rows: RowRuntime[] = [];
  private stepSeconds: number;

  constructor(
    private readonly audioContext: AudioContext,
    dryDestination: AudioNode,
    initialColumnCount: number,
    initialStepSeconds: number,
  ) {
    this.stepSeconds = initialStepSeconds;
    this.columnCount = initialColumnCount;
    this.clock = createStepClock(audioContext, () => this.stepSeconds);
    this.masterDestination = dryDestination;

    // Master bus: every row's persistent chain and the shared send bus
    // both feed into masterGain, so a single fader/effects chain here
    // affects the whole mix, downstream of everything else.
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 1;
    this.masterChain = buildEffectsChain(audioContext, []);
    this.masterChain.output.connect(dryDestination);
    this.masterGain.connect(this.masterChain.input);

    this.chainCache = createEffectsChainCache(audioContext, this.masterGain);

    // The send bus: an arbitrary, user-configured effect chain (Master
    // panel's "Send Bus" section) that every row can tap into by some
    // amount via its own Send level, same shared-bus-many-taps shape a
    // hardcoded reverb send used to be, generalized to any chain (or
    // none) instead of a single fixed ReverbEffect.
    this.sendBusInput = audioContext.createGain();
    this.sendBusInput.gain.value = 1;
    this.sendChain = buildEffectsChain(audioContext, []);
    this.sendChain.output.connect(this.masterGain);
    this.sendBusInput.connect(this.sendChain.input);

    this.columns = Array.from({ length: this.columnCount }, () =>
      createColumnConfig(),
    );
    this.clock.onTick((stepIndex, atTime, stepSeconds) =>
      this.fireTick(stepIndex, atTime, stepSeconds),
    );
  }

  setStepSeconds(seconds: number): void {
    this.stepSeconds = seconds;
  }

  /** Growing pads with fresh default cells (existing columns keep their
   * data); shrinking just drops the trailing columns' data. A row
   * currently waiting to join at the next cycle re-targets that wait to
   * the new count, so it still means "the next full cycle," not a boundary
   * that no longer exists. */
  setColumnCount(count: number): void {
    if (count === this.columnCount || count < 1) return;
    if (count > this.columnCount) {
      const extra = count - this.columnCount;
      this.columns.push(
        ...Array.from({ length: extra }, () => createColumnConfig()),
      );
      for (const runtime of this.rows) {
        runtime.cells.push(
          ...Array.from({ length: extra }, () => createCellConfig()),
        );
      }
    } else {
      this.columns.length = count;
      for (const runtime of this.rows) {
        runtime.cells.length = count;
      }
    }
    for (const runtime of this.rows) {
      if (runtime.pendingCycleLength !== null) {
        runtime.pendingCycleLength = count;
      }
    }
    this.columnCount = count;
  }

  setMasterGain(gain: number): void {
    this.masterGain.gain.value = gain;
  }

  /** Same acquire-before-release pattern as setRowEffects, just against a
   * single always-present chain instead of the shared ref-counted cache
   * (there's only ever one master chain, so caching/sharing it with
   * anything else would be pointless). */
  setMasterEffects(effects: EffectSpec[]): void {
    const newChain = buildEffectsChain(this.audioContext, effects);
    newChain.output.connect(this.masterDestination);
    this.masterGain.disconnect();
    this.masterGain.connect(newChain.input);
    this.masterChain.dispose();
    this.masterChain = newChain;
    this.masterEffects = effects;
  }

  getMasterEffects(): EffectSpec[] {
    return this.masterEffects;
  }

  /** Same acquire-before-release-shaped rebuild as setMasterEffects, just
   * re-pointing sendBusInput (every row's fixed tap target, see its own
   * doc) at a fresh chain instead of masterGain. */
  setSendBusEffects(effects: EffectSpec[]): void {
    const newChain = buildEffectsChain(this.audioContext, effects);
    newChain.output.connect(this.masterGain);
    this.sendBusInput.disconnect();
    this.sendBusInput.connect(newChain.input);
    this.sendChain.dispose();
    this.sendChain = newChain;
    this.sendBusEffects = effects;
  }

  getSendBusEffects(): EffectSpec[] {
    return this.sendBusEffects;
  }

  /** The live-nudge bypass drift (see gridView.ts's drift engine) uses
   * instead of setRowEffects/setMasterEffects/setSendBusEffects' full
   * rebuild -- resolves whichever of the three persistent chains `target`
   * names and forwards straight to its own setParamsAt. A stale rowId (row
   * removed since) is a silent no-op, matching setParamsAt's own
   * tolerance of a stale index -- the engine always re-reads current rows
   * every tick, so it just stops applying next tick rather than needing
   * this to report failure. */
  applyLiveEffectParam(
    target: EffectLiveTarget,
    index: number,
    key: string,
    value: number,
  ): void {
    const chain =
      target.kind === "row"
        ? this.rows.find((r) => r.id === target.rowId)?.chain
        : target.kind === "master"
          ? this.masterChain
          : this.sendChain;
    chain?.setParamsAt(index, { [key]: value });
  }

  getRows(): Row[] {
    return this.rows.map((r) => this.toRow(r));
  }

  /** A fresh lookup, not a cached wrapper -- `Row.config` is replaced (not
   * mutated) on every change, so a `Row` object from an earlier `getRows()`
   * call goes stale the moment anything about it changes. Callers that
   * need the *current* config after their own earlier snapshot might have
   * gone stale (e.g. a field handler firing after a previous one already
   * changed the same row) should re-fetch through here rather than trust
   * a `Row` they're still holding. */
  getRow(id: string): Row | undefined {
    const runtime = this.rows.find((r) => r.id === id);
    return runtime ? this.toRow(runtime) : undefined;
  }

  async addRow(
    sourceType: SourceType,
    name: string,
    joinAtNextCycle: boolean,
  ): Promise<Row> {
    const source = createRowSource(this.audioContext, sourceType);
    if (source.init) await source.init();
    source.setParams(SOURCE_ENVELOPE_FLOOR);

    const config: RowConfig = {
      name,
      sourceType,
      enabled: true,
      triggerMode: { kind: "gatedToStep" },
      playbackMode: "direct",
      defaultsOverride: false,
      defaultNote: BUILT_INS.note,
      defaultTimeShiftSeconds: BUILT_INS.timeShiftSeconds,
      defaultGainOverride: false,
      defaultGain: BUILT_INS.gain,
      envelopeOverride: false,
      envelope: createEnvelope(),
      effects: [],
      sendLevel: 0,
      pan: 0,
      level: 1,
      sampleRange: { start: 0, end: 1 },
      reversed: false,
      duck: undefined,
      callResponse: undefined,
      continuePlayback: false,
    };
    if (sourceType === "samplePlayer") {
      source.setParams({
        rootNote: config.defaultNote,
        ...triggerModeSourceParams(config.triggerMode),
      });
    }

    const envelopeGain = this.audioContext.createGain();
    envelopeGain.gain.value = 0;
    source.output.connect(envelopeGain);
    // A dedicated chain, not this.chainCache's shared-by-config instances --
    // sendLevel's own doc says "this row's (post-effects) output," and a
    // send tap has to read a signal that's genuinely only this row's own.
    // The cache is a correct optimization for the dry path (two rows with
    // identical effects sharing one node is fine there, since dry signals
    // are meant to sum into the master bus anyway) but is wrong for a
    // per-row send tap: two rows sharing a chain means their signals are
    // already mixed together inside it, so tapping that shared node's
    // output leaks every row sharing it into whichever row's send happens
    // to be turned up, regardless of the others' own send levels. Cell-level
    // effect overrides (fireSamplePlayerOverride) have no per-cell send and
    // so can still safely use the cache. Rows are also few enough (unlike
    // cells across a big grid) that not de-duping them costs little.
    const chain = buildEffectsChain(this.audioContext, config.effects);
    // Sits between the chain's own output and both of this row's normal
    // destinations (dry to masterGain, wet-tap to send) -- one node any
    // *other* row's duck relationship can reach via scheduleDuck to
    // briefly pull this row's whole output down, dry and send alike,
    // without touching the chain itself (which sendLevel/effects edits
    // already rebuild independently). Unity gain (1) when nothing is
    // ducking this row -- see fireTick's own scheduleDuck call for the
    // envelope that actually moves it.
    const duckGain = this.audioContext.createGain();
    duckGain.gain.value = 1;
    const panNode = this.audioContext.createStereoPanner();
    panNode.pan.value = 0;
    // Sits after panNode, before the split to masterGain/send -- see
    // RowConfig.level's own doc for why both destinations scale together.
    const levelNode = this.audioContext.createGain();
    levelNode.gain.value = config.level;
    chain.output.connect(duckGain);
    duckGain.connect(panNode);
    panNode.connect(levelNode);
    levelNode.connect(this.masterGain);
    envelopeGain.connect(chain.input);
    const send = createSend(this.audioContext, this.sendBusInput, 0);
    levelNode.connect(send.input);

    const runtime: RowRuntime = {
      id: crypto.randomUUID(),
      config,
      source,
      envelopeGain,
      cells: Array.from({ length: this.columnCount }, () => createCellConfig()),
      chain,
      duckGain,
      panNode,
      levelNode,
      send,
      sampleBuffer: undefined,
      active: !joinAtNextCycle,
      pendingCycleLength: joinAtNextCycle ? this.columnCount : null,
      solo: false,
      scanPositionSeconds: undefined,
      scanLastFireTime: undefined,
    };
    this.rows.push(runtime);
    return this.toRow(runtime);
  }

  removeRow(row: Row): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.source.output.disconnect();
    runtime.envelopeGain.disconnect();
    runtime.send.input.disconnect();
    runtime.duckGain.disconnect();
    runtime.panNode.disconnect();
    runtime.levelNode.disconnect();
    // Never shared with anything else (see addRow's own doc), so a blanket
    // dispose is safe -- no other row's dry path or send routes through
    // this same chain instance.
    runtime.chain.dispose();
    this.rows.splice(this.rows.indexOf(runtime), 1);
  }

  /** If this row's reverse toggle is already on when a new sample gets
   * assigned, the incoming buffer is reversed before it's stored/loaded --
   * `reversed` is a row-level setting that survives swapping which sample
   * is loaded, same as playbackMode does. */
  async loadRowSample(row: Row, buffer: AudioBuffer): Promise<void> {
    const runtime = this.findRuntime(row);
    if (!runtime || !runtime.source.loadSample) return;
    const activeBuffer = runtime.config.reversed
      ? reverseAudioBuffer(this.audioContext, buffer)
      : buffer;
    await runtime.source.loadSample(activeBuffer);
    runtime.sampleBuffer = activeBuffer;
    // A scan position tracked against the *old* buffer's timeline is
    // meaningless once a different one is loaded -- see
    // RowConfig.continuePlayback's own doc.
    runtime.scanPositionSeconds = undefined;
    runtime.scanLastFireTime = undefined;
  }

  /** Not part of the public `Row` shape (see its own doc for why) --
   * the waveform range view needs the actual decoded buffer to draw
   * against, which only exists once loadRowSample has resolved. */
  getRowSampleBuffer(row: Row): AudioBuffer | undefined {
    return this.findRuntime(row)?.sampleBuffer;
  }

  setRowEnabled(row: Row, enabled: boolean): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, enabled };
  }

  /** Solo isn't exclusive -- toggling one row's solo on leaves any other
   * already-soloed row soloed too, same "click several to A/B a subset"
   * convention as every mixing console/DAW's own solo. See RowRuntime's
   * own doc for why this lives outside RowConfig entirely. */
  setRowSolo(row: Row, solo: boolean): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.solo = solo;
  }

  setRowName(row: Row, name: string): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, name };
  }

  setRowTriggerMode(row: Row, triggerMode: RowConfig["triggerMode"]): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.config = { ...runtime.config, triggerMode };
    if (runtime.config.sourceType === "samplePlayer") {
      runtime.source.setParams({ ...triggerModeSourceParams(triggerMode) });
    }
  }

  setRowPlaybackMode(row: Row, playbackMode: RowConfig["playbackMode"]): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, playbackMode };
  }

  /** Governs defaultNote/defaultTimeShiftSeconds together -- see
   * config.ts's RowConfig.defaultsOverride doc for why defaultGain has
   * its own separate flag (setRowDefaultGainOverride) instead. */
  setRowDefaultsOverride(row: Row, on: boolean): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, defaultsOverride: on };
  }

  setRowDefaultNote(row: Row, note: number): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.config = { ...runtime.config, defaultNote: note };
    // Direct-mode playback always uses this row's own note (never the
    // column's) regardless of defaultsOverride, so the player's internal
    // rootNote has to track it unconditionally.
    if (runtime.config.sourceType === "samplePlayer") {
      runtime.source.setParams({ rootNote: note });
    }
  }

  setRowDefaultGain(row: Row, gain: number): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, defaultGain: gain };
  }

  /** Separate from setRowDefaultsOverride -- see config.ts's
   * RowConfig.defaultGainOverride doc for why gain split off on its own. */
  setRowDefaultGainOverride(row: Row, on: boolean): void {
    const runtime = this.findRuntime(row);
    if (runtime) {
      runtime.config = { ...runtime.config, defaultGainOverride: on };
    }
  }

  setRowDefaultTimeShift(row: Row, seconds: number): void {
    const runtime = this.findRuntime(row);
    if (runtime) {
      runtime.config = { ...runtime.config, defaultTimeShiftSeconds: seconds };
    }
  }

  setRowEnvelopeOverride(row: Row, on: boolean): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, envelopeOverride: on };
  }

  /** Takes the whole points array (not a patch) -- the automation editor's
   * onChange already hands back a complete curve on every edit, and unlike
   * the old ADSR fields there's no sensible way to merge just one point
   * into an existing curve without knowing which one moved. */
  setRowEnvelope(row: Row, points: EnvelopeParams["points"]): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.config = { ...runtime.config, envelope: { points } };
  }

  setRowSendLevel(row: Row, level: number): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.send.setLevel(level);
    runtime.config = { ...runtime.config, sendLevel: level };
  }

  setRowPan(row: Row, pan: number): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    const clamped = Math.min(Math.max(pan, -1), 1);
    runtime.panNode.pan.value = clamped;
    runtime.config = { ...runtime.config, pan: clamped };
  }

  /** No clamping, same as setMasterGain -- unlike pan, values outside the
   * slider's own default range are still musically meaningful (just
   * louder/quieter), not nonsensical the way an out-of-range pan would
   * be. */
  setRowLevel(row: Row, level: number): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.levelNode.gain.value = level;
    runtime.config = { ...runtime.config, level };
  }

  /** Just records the config -- unlike sendLevel (a live gain value set
   * immediately) there's no persistent audio-graph change to make here;
   * the relationship only actually does anything at fire time, per hit
   * (see fireTick's own scheduleDuck call). */
  setRowDuck(row: Row, duck: RowConfig["duck"]): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, duck };
  }

  /** Same "just records the config" reasoning as setRowDuck -- see
   * fireTick's own triggerCallResponse call. */
  setRowCallResponse(row: Row, callResponse: RowConfig["callResponse"]): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, callResponse };
  }

  setRowSampleRange(row: Row, range: { start: number; end: number }): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.config = { ...runtime.config, sampleRange: range };
    if (runtime.config.sourceType === "samplePlayer") {
      runtime.source.setParams({
        rangeStart: range.start,
        rangeEnd: range.end,
      });
    }
  }

  /** Reverses whichever buffer is currently loaded, in place -- every
   * reader of runtime.sampleBuffer (the row's own shared SamplePlayer,
   * sampleRangeSeconds, and fireSamplePlayerOverride's per-hit node alike)
   * sees the correct audio afterward with no special-casing, since none of
   * them care whether that buffer happens to be a reversed copy. No buffer
   * loaded yet (e.g. toggled from a patch before its sample fetch resolves)
   * just records the flag -- loadRowSample applies it to whatever loads
   * next. */
  setRowReversed(row: Row, reversed: boolean): void {
    const runtime = this.findRuntime(row);
    if (!runtime || runtime.config.reversed === reversed) return;
    runtime.config = { ...runtime.config, reversed };
    if (!runtime.sampleBuffer) return;
    const buffer = reverseAudioBuffer(this.audioContext, runtime.sampleBuffer);
    runtime.sampleBuffer = buffer;
    if (runtime.source.loadSample) void runtime.source.loadSample(buffer);
  }

  /** Resets the tracked scan position on every toggle, not just off->on
   * -- flipping continuePlayback off and back on always starts fresh at
   * the trimmed range's own start, rather than potentially resuming a
   * position from however long ago it was last on (see
   * RowConfig.continuePlayback's own doc). */
  setRowContinuePlayback(row: Row, continuePlayback: boolean): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.config = { ...runtime.config, continuePlayback };
    runtime.scanPositionSeconds = undefined;
    runtime.scanLastFireTime = undefined;
  }

  /** Same build-before-dispose-shaped rebuild as setMasterEffects/
   * setSendBusEffects, just against a per-row dedicated chain instead of
   * the always-present master/send ones (see addRow's own doc for why rows
   * don't go through the shared chainCache). Never shared with anything
   * else, so a blanket oldChain.dispose() is safe -- no acquire/release
   * ref-counting needed the way cell-level overrides still need it. */
  setRowEffects(row: Row, effects: RowConfig["effects"]): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    const oldChain = runtime.chain;
    const newChain = buildEffectsChain(this.audioContext, effects);
    // Into duckGain, not masterGain/send.input directly -- duckGain is the
    // one node that stays constant across this rebuild (see its own doc),
    // so any duck relationship already targeting this row keeps reaching
    // its actual output without needing to know a chain rebuild happened.
    newChain.output.connect(runtime.duckGain);
    runtime.envelopeGain.disconnect();
    runtime.envelopeGain.connect(newChain.input);
    oldChain.dispose();
    runtime.config = { ...runtime.config, effects };
    runtime.chain = newChain;
  }

  setCell(row: Row, columnIndex: number, patch: Partial<CellConfig>): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.cells[columnIndex] = { ...runtime.cells[columnIndex], ...patch };
  }

  setColumn(columnIndex: number, patch: Partial<ColumnConfig>): void {
    this.columns[columnIndex] = { ...this.columns[columnIndex], ...patch };
  }

  resolveCell(row: Row, columnIndex: number): ResolvedCellConfig {
    const runtime = this.findRuntime(row);
    if (!runtime) throw new Error("row not found");
    const rowDefaultGate = triggerModeGate(runtime.config.triggerMode);
    return resolveCellConfig(
      runtime.cells[columnIndex],
      runtime.config,
      this.columns[columnIndex],
      this.precedence,
      BUILT_INS,
      rowDefaultGate,
    );
  }

  /** Fires one voice on `row` right now, using its own row-level defaults
   * -- the Instrument popup's "Preview" button (see gridView.ts), for
   * auditioning a source/envelope/effects change without needing the
   * sequencer running or a cell to actually be on. Always fires
   * regardless of this row's own mute/solo state (previewing an
   * instrument shouldn't require unmuting the row first) and never
   * triggers this row's own outbound duck/callResponse relationships --
   * those are consequences of the sequencer actually firing a step, not
   * of a manual audition. A small lookahead (see bruit-kit's own
   * scheduling convention) rather than audioContext.currentTime exactly,
   * so the browser has a moment to schedule before the note's own start
   * time arrives. */
  previewRow(row: Row): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    const atTime = this.audioContext.currentTime + 0.02;
    const { note, resolved, gateSeconds } = this.resolveRowVoice(
      runtime,
      this.stepSeconds,
    );
    this.fireVoice(runtime, note, resolved, atTime, gateSeconds);
  }

  private findRuntime(row: Row): RowRuntime | undefined {
    return this.rows.find((r) => r.id === row.id);
  }

  private toRow(runtime: RowRuntime): Row {
    return {
      id: runtime.id,
      config: runtime.config,
      source: runtime.source,
      cells: runtime.cells,
      isActive: () => runtime.active,
      isSoloed: () => runtime.solo,
    };
  }

  /** How long the row's trimmed sample range actually lasts, in seconds --
   * Infinity when there's no buffer yet (no constraint to apply) or the
   * row isn't a samplePlayer at all. Shared by both samplePlayer firing
   * paths (the row's own shared instance in fireTick, and
   * fireSamplePlayerOverride's fresh per-hit node) so an envelope curve
   * never outlives the raw audio bruit-kit's SamplePlayer already hard-
   * stops at this same point (see its noteOn). */
  private sampleRangeSeconds(runtime: RowRuntime): number {
    const buffer = runtime.sampleBuffer;
    if (!buffer) return Number.POSITIVE_INFINITY;
    const { start, end } = runtime.config.sampleRange;
    return Math.max(0, Math.abs(end - start)) * buffer.duration;
  }

  /** Schedules one duck dip-and-recover on `target`'s own duckGain,
   * anchored at `atTime` (the *source* row's own shiftedAtTime, so the
   * dip lands exactly on the hit that triggered it, timeShift included).
   * Reuses bruit-kit's scheduleAutomation rather than hand-rolling
   * cancel/ramp calls -- its own doc explains why a synchronous
   * `gain.value` read is the wrong anchor for a lookahead-scheduled
   * future atTime (it reflects "now," not what any still-pending ramp
   * will have reached by then) and cancelAndHoldAtTime is the correct
   * fix; retriggering mid-dip (a fast roll on the source row) rides on
   * that same click-safe anchoring for free. A 3-point curve in 0..1
   * value space maps directly onto a gain multiplier, no valueRange
   * remapping needed: unity at the start, down to `1 - amount` at the
   * attack point, back to unity by the end. */
  private scheduleDuck(
    target: RowRuntime,
    duck: NonNullable<RowConfig["duck"]>,
    atTime: number,
  ): void {
    const amount = Math.min(Math.max(duck.amount, 0), 1);
    const attackSeconds = Math.max(duck.attackMs, 0) / 1000;
    const releaseSeconds = Math.max(duck.releaseMs, 0) / 1000;
    const durationSeconds = attackSeconds + releaseSeconds;
    if (durationSeconds <= 0) return;
    scheduleAutomation(
      target.duckGain.gain,
      [
        { position: 0, value: 1 },
        { position: attackSeconds / durationSeconds, value: 1 - amount },
        { position: 1, value: 1 },
      ],
      this.audioContext,
      durationSeconds,
      { min: 0, max: 1 },
      atTime,
    );
  }

  /** Advances (and records) RowConfig.continuePlayback's virtual scan
   * position by however much real time passed since this row's last
   * hit, wrapping within the trimmed sampleRange -- see that field's
   * own doc. Returns the resulting position as a 0..1 fraction of the
   * buffer's own duration, ready for RowSource.playFromPosition. */
  private advanceScanPosition(
    runtime: RowRuntime,
    buffer: AudioBuffer,
    atTime: number,
  ): number {
    const { start, end } = runtime.config.sampleRange;
    const loSeconds = Math.min(start, end) * buffer.duration;
    const hiSeconds = Math.max(start, end) * buffer.duration;
    const spanSeconds = Math.max(0, hiSeconds - loSeconds);

    let positionSeconds = loSeconds;
    if (
      spanSeconds > 0 &&
      runtime.scanPositionSeconds !== undefined &&
      runtime.scanLastFireTime !== undefined
    ) {
      const elapsed = Math.max(0, atTime - runtime.scanLastFireTime);
      const raw = runtime.scanPositionSeconds - loSeconds + elapsed;
      // Safe modulo -- JS's own % can return negative for a negative
      // operand, which raw can be if sampleRange shrank/shifted since
      // the last hit and moved loSeconds past the old position.
      const withinSpan = ((raw % spanSeconds) + spanSeconds) % spanSeconds;
      positionSeconds = loSeconds + withinSpan;
    }
    runtime.scanPositionSeconds = positionSeconds;
    runtime.scanLastFireTime = atTime;

    return buffer.duration > 0 ? positionSeconds / buffer.duration : 0;
  }

  private fireTick(
    stepIndex: number,
    atTime: number,
    stepSeconds: number,
  ): void {
    const columnIndex = stepIndex % this.columnCount;
    const column = this.columns[columnIndex];
    // Computed once per tick, not per row -- solo isn't exclusive (see
    // setRowSolo), so "does *any* row have solo on" is what actually gates
    // every other row, not any single row's own flag.
    const soloActive = this.rows.some((r) => r.solo);
    for (const runtime of this.rows) {
      if (
        runtime.pendingCycleLength !== null &&
        stepIndex % runtime.pendingCycleLength === 0
      ) {
        runtime.active = true;
        runtime.pendingCycleLength = null;
      }
      if (!runtime.active) continue;
      if (soloActive && !runtime.solo) continue;

      const cell = runtime.cells[columnIndex];
      const rowDefaultGate = triggerModeGate(runtime.config.triggerMode);
      const resolved = resolveCellConfig(
        cell,
        runtime.config,
        column,
        this.precedence,
        BUILT_INS,
        rowDefaultGate,
      );
      if (!resolved.fires) continue;

      const shiftedAtTime = atTime + resolved.timeShiftSeconds;
      if (runtime.config.duck?.targetRowName) {
        const target = this.rows.find(
          (r) =>
            r !== runtime &&
            r.config.name === runtime.config.duck?.targetRowName,
        );
        if (target)
          this.scheduleDuck(target, runtime.config.duck, shiftedAtTime);
      }
      if (runtime.config.callResponse?.targetRowName) {
        this.triggerCallResponse(
          runtime,
          runtime.config.callResponse,
          shiftedAtTime,
          stepSeconds,
          soloActive,
        );
      }
      const gateSeconds = stepSeconds * resolved.gate;
      // "direct" playback mode is deliberately pitch-cascade-immune
      // already (see RowConfig.playbackMode's doc) -- quantizing it too
      // would introduce a pitch shift on rows that explicitly opt out of
      // pitch entirely, so scale quantization only applies to the normal
      // cascade-resolved branch.
      const note =
        runtime.config.sourceType === "samplePlayer" &&
        runtime.config.playbackMode === "direct"
          ? runtime.config.defaultNote
          : quantizeToScale(resolved.note, this.scaleRoot, this.scaleType);

      if (
        runtime.config.sourceType === "samplePlayer" &&
        cell.effectsOverride
      ) {
        this.fireSamplePlayerOverride(
          runtime,
          note,
          resolved.gain,
          shiftedAtTime,
          gateSeconds,
          resolved.effects,
          resolved.envelope,
        );
      } else {
        this.fireVoice(runtime, note, resolved, shiftedAtTime, gateSeconds);
      }
    }
  }

  /** The envelope drives envelopeGain -- a persistent, row-wide node
   * downstream of the source (see RowRuntime's doc), not a per-voice
   * param -- so scheduling it here, immediately before the noteOn it
   * shapes, is safe for the same reason mutating a source's own params
   * used to be: both this method's two callers (fireTick's own main
   * branch, and triggerCallResponse) own their entire scheduling call
   * synchronously (unlike bruit-kit's createStepTrack, which this app
   * deliberately doesn't use for exactly this reason), so the schedule
   * and the noteOn it applies to happen together, both anchored at the
   * same future atTime -- a *later* tick scheduling a new curve can't
   * retroactively affect a voice already firing. Every noteOn goes out
   * at full velocity since gain is entirely carried by this curve's own
   * valueRange max, not by scaling the source's per-voice peak.
   *
   * For a samplePlayer row, clamped to the trimmed sample range's own
   * length when that's shorter than the gate -- bruit-kit's SamplePlayer
   * hard-stops the raw buffer there regardless of gate (see its noteOn),
   * so scheduling the curve over the *longer* gateSeconds would leave
   * the user's own envelope shape -- in particular whatever release they
   * drew near the end of it -- silently pre-empted by that hard stop
   * instead of actually playing out. */
  private fireVoice(
    runtime: RowRuntime,
    note: number,
    resolved: ResolvedCellConfig,
    atTime: number,
    gateSeconds: number,
  ): void {
    const envelopeDuration =
      runtime.config.sourceType === "samplePlayer"
        ? Math.min(gateSeconds, this.sampleRangeSeconds(runtime))
        : gateSeconds;
    scheduleAutomation(
      runtime.envelopeGain.gain,
      resolved.envelope.points,
      this.audioContext,
      envelopeDuration,
      { min: 0, max: resolved.gain },
      atTime,
    );
    if (
      runtime.config.sourceType === "samplePlayer" &&
      runtime.config.continuePlayback &&
      runtime.source.playFromPosition &&
      runtime.sampleBuffer
    ) {
      const startFraction = this.advanceScanPosition(
        runtime,
        runtime.sampleBuffer,
        atTime,
      );
      runtime.source.playFromPosition(note, FULL_VELOCITY, atTime, startFraction);
    } else {
      runtime.source.target.noteOn(note, FULL_VELOCITY, atTime);
    }
    runtime.source.target.noteOff(note, atTime + gateSeconds);
  }

  /** Resolves what `runtime` itself would sound like on an always-on,
   * unoverridden synthetic cell/column -- i.e. its own row-level
   * defaults, exactly as if it had fired an empty cell of its own. Shared
   * by triggerCallResponse (which fires this resolution on a *different*
   * row than the one that actually triggered it) and previewRow (which
   * fires it on demand, outside the sequencer entirely) -- both need the
   * identical note/gain/envelope/gate resolution, just anchored at
   * different times for different reasons. */
  private resolveRowVoice(
    runtime: RowRuntime,
    stepSeconds: number,
  ): { note: number; resolved: ResolvedCellConfig; gateSeconds: number } {
    const rowDefaultGate = triggerModeGate(runtime.config.triggerMode);
    const resolved = resolveCellConfig(
      { ...createCellConfig(), on: true },
      runtime.config,
      createColumnConfig(),
      this.precedence,
      BUILT_INS,
      rowDefaultGate,
    );
    const note =
      runtime.config.sourceType === "samplePlayer" &&
      runtime.config.playbackMode === "direct"
        ? runtime.config.defaultNote
        : quantizeToScale(resolved.note, this.scaleRoot, this.scaleType);
    const gateSeconds = stepSeconds * resolved.gate;
    return { note, resolved, gateSeconds };
  }

  /** Rolls RowConfig.callResponse's probability for `runtime` (already
   * confirmed to have actually fired this tick -- see fireTick's own
   * duck-scheduling call right above this one, which this mirrors) and,
   * on a hit, fires `targetRowName`'s own row-level voice -- resolved
   * via an always-on, unoverridden synthetic cell/column, since there's
   * no specific cell here to pull a note/gain/envelope from -- after
   * `delaySeconds`. Like duck, resolved by name at fire time rather
   * than cached (see RowConfig.duck's own doc for why), and the
   * target's own mute/solo state still gates it: a muted or soloed-out
   * target stays silent even on a winning roll, same as it would for
   * its own cells.
   *
   * Cascades: if the target it just fired *also* has its own
   * callResponse set, this recurses to roll that hop too, anchored off
   * the response it just scheduled -- a chain of rows each calling the
   * next. `hopsRemaining` (defaults to MAX_CALL_RESPONSE_HOPS, only ever
   * passed explicitly by this method's own recursive call) is the hard
   * stop that keeps a cycle (A and B pointed at each other, or any
   * longer loop) from recursing forever in one synchronous call -- see
   * that constant's own doc. */
  private triggerCallResponse(
    runtime: RowRuntime,
    callResponse: NonNullable<RowConfig["callResponse"]>,
    atTime: number,
    stepSeconds: number,
    soloActive: boolean,
    hopsRemaining: number = MAX_CALL_RESPONSE_HOPS,
  ): void {
    if (hopsRemaining <= 0) return;
    const probability = Math.min(Math.max(callResponse.probability, 0), 1);
    if (Math.random() >= probability) return;

    const target = this.rows.find(
      (r) => r !== runtime && r.config.name === callResponse.targetRowName,
    );
    if (!target) return;
    if (!target.active || !target.config.enabled) return;
    if (soloActive && !target.solo) return;

    const { note, resolved, gateSeconds } = this.resolveRowVoice(
      target,
      stepSeconds,
    );
    const responseAtTime = atTime + Math.max(callResponse.delaySeconds, 0);
    this.fireVoice(target, note, resolved, responseAtTime, gateSeconds);

    if (target.config.callResponse?.targetRowName) {
      this.triggerCallResponse(
        target,
        target.config.callResponse,
        responseAtTime,
        stepSeconds,
        soloActive,
        hopsRemaining - 1,
      );
    }
  }

  /** The plan's Effects section describes a fresh one-shot source node
   * connect()ing into whichever chain applies "each time the cell fires" --
   * that only works cleanly when the source node really is spawned fresh
   * per hit, which is true of a sample buffer but not of the ADSR voices
   * SamplePlayer/OscillatorSynth/etc. already manage internally. So a
   * per-cell effects override (distinct from the row's own persistent
   * chain) is only supported for samplePlayer rows: this bypasses the
   * shared SamplePlayer instance for just this hit and builds the same
   * source->gain->chain graph SamplePlayer.noteOn would, but into the
   * cell's own cached chain instead of the row's. */
  private fireSamplePlayerOverride(
    runtime: RowRuntime,
    note: number,
    gain: number,
    atTime: number,
    gateSeconds: number,
    effects: RowConfig["effects"],
    envelope: EnvelopeParams,
  ): void {
    const buffer = runtime.sampleBuffer;
    if (!buffer) return;
    const chain = this.chainCache.acquire(effects);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = semitoneRatio(note, runtime.config.defaultNote);
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0;
    source.connect(gainNode).connect(chain.input);
    // Same trimmed-range handling as the row's own shared SamplePlayer
    // instance (see bruit-kit's SamplePlayer.noteOn) -- this path bypasses
    // that instance for a fresh per-hit node, so the range has to be
    // reapplied here rather than inherited from it.
    const { start: rangeStart, end: rangeEnd } = runtime.config.sampleRange;
    const offsetStart = Math.min(
      1,
      Math.max(0, Math.min(rangeStart, rangeEnd)),
    );
    const offsetEnd = Math.min(1, Math.max(0, Math.max(rangeStart, rangeEnd)));
    const offsetSeconds = offsetStart * buffer.duration;
    const durationSeconds = Math.max(
      0,
      (offsetEnd - offsetStart) * buffer.duration,
    );
    source.start(atTime, offsetSeconds, durationSeconds);

    // This node is spawned fresh per hit (unlike envelopeGain, which is
    // persistent per row), so the curve's own position-1 point is the
    // note's real end -- no extra release tail to account for the way
    // triggerRelease's return value used to. Clamped to the trimmed
    // range's own length, not just gateSeconds: source.start()'s duration
    // argument above hard-cuts the raw buffer at atTime + durationSeconds
    // with no fade of its own, so if the range is trimmed shorter than
    // the gate, scheduling the curve over the *longer* gateSeconds would
    // leave it mid-ramp (a pop) when the buffer stops out from under it.
    const effectiveDuration = Math.min(gateSeconds, durationSeconds);
    scheduleAutomation(
      gainNode.gain,
      envelope.points,
      this.audioContext,
      effectiveDuration,
      { min: 0, max: gain },
      atTime,
    );
    const endTime = atTime + effectiveDuration;
    source.stop(endTime);
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
      this.chainCache.release(effects);
    };
  }
}
