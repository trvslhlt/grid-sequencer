import { ReverbEffect, createSend, scheduleAutomation } from "bruit-kit/audio";
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
 * reverb send, activation state) a row needs but the UI doesn't -- kept as
 * a class-private shape so callers only ever see the public `Row` fields. */
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
  send: Send;
  sampleBuffer: AudioBuffer | undefined;
  active: boolean;
  pendingCycleLength: number | null;
}

export type Row = Readonly<
  Pick<RowRuntime, "id" | "config" | "source" | "cells">
> & { isActive(): boolean };

/** Everything one running grid needs: the shared clock (see bruit-kit's
 * stepClock.ts doc for why rows never own their own), the shared reverb
 * bus, the effects-chain cache, and the row/column config that
 * resolveCellConfig cascades through every tick. */
export class GridModel {
  readonly clock: StepClock;
  readonly reverb: ReverbEffect;
  readonly masterGain: GainNode;
  columns: ColumnConfig[];
  precedence: Precedence = "row";
  columnCount: number;
  private masterEffects: EffectSpec[] = [];
  private masterChain: BuiltEffectsChain;
  private readonly masterDestination: AudioNode;
  private readonly chainCache: ReturnType<typeof createEffectsChainCache>;
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

    // Master bus: every row's persistent chain and the shared reverb both
    // feed into masterGain, so a single fader/effects chain here affects
    // the whole mix, downstream of everything else.
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 1;
    this.masterChain = buildEffectsChain(audioContext, []);
    this.masterChain.output.connect(dryDestination);
    this.masterGain.connect(this.masterChain.input);

    this.chainCache = createEffectsChainCache(audioContext, this.masterGain);
    this.reverb = new ReverbEffect(audioContext);
    this.reverb.setParams({ wet: 1, decaySeconds: 2.2 });
    this.reverb.output.connect(this.masterGain);
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
      defaultGain: BUILT_INS.gain,
      defaultTimeShiftSeconds: BUILT_INS.timeShiftSeconds,
      envelopeOverride: false,
      envelope: createEnvelope(),
      effects: [],
      reverbSend: 0,
      sampleRange: { start: 0, end: 1 },
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
    const chain = this.chainCache.acquire(config.effects);
    envelopeGain.connect(chain.input);
    const send = createSend(this.audioContext, this.reverb.input, 0);
    chain.output.connect(send.input);

    const runtime: RowRuntime = {
      id: crypto.randomUUID(),
      config,
      source,
      envelopeGain,
      cells: Array.from({ length: this.columnCount }, () => createCellConfig()),
      chain,
      send,
      sampleBuffer: undefined,
      active: !joinAtNextCycle,
      pendingCycleLength: joinAtNextCycle ? this.columnCount : null,
    };
    this.rows.push(runtime);
    return this.toRow(runtime);
  }

  removeRow(row: Row): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.source.output.disconnect();
    runtime.envelopeGain.disconnect();
    // The chain may still be shared with another row (same effective
    // config), so only sever this row's own edge into it rather than a
    // blanket chain.output.disconnect() -- that would silence the other
    // row's dry path too. chainCache.release only tears the chain down
    // once nothing else references it.
    runtime.chain.output.disconnect(runtime.send.input);
    runtime.send.input.disconnect();
    this.chainCache.release(runtime.config.effects);
    this.rows.splice(this.rows.indexOf(runtime), 1);
  }

  async loadRowSample(row: Row, buffer: AudioBuffer): Promise<void> {
    const runtime = this.findRuntime(row);
    if (!runtime || !runtime.source.loadSample) return;
    await runtime.source.loadSample(buffer);
    runtime.sampleBuffer = buffer;
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

  /** Governs all three defaults (note/gain/time-shift) together -- see
   * config.ts's RowConfig doc for why a single flag replaced three
   * independent "is this one set" checks. */
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

  setRowReverbSend(row: Row, level: number): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.send.setLevel(level);
    runtime.config = { ...runtime.config, reverbSend: level };
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

  /** Re-acquires the cache entry for the *new* effects config before
   * releasing the old one -- acquire-before-release means a chain another
   * row still references (or this row's own unchanged config) is never
   * torn down and immediately rebuilt. */
  setRowEffects(row: Row, effects: RowConfig["effects"]): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    const oldEffects = runtime.config.effects;
    const oldChain = runtime.chain;
    const newChain = this.chainCache.acquire(effects);
    runtime.envelopeGain.disconnect();
    runtime.envelopeGain.connect(newChain.input);
    // Sever only the old chain's own edge into this row's send tap -- not
    // send.input.disconnect(), which would sever send.input's *outgoing*
    // edge to the reverb bus instead and silently kill this row's reverb
    // send for good (the old chain might still be shared with another
    // row, so a blanket oldChain.output.disconnect() isn't safe either).
    oldChain.output.disconnect(runtime.send.input);
    newChain.output.connect(runtime.send.input);
    this.chainCache.release(oldEffects);
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
    };
  }

  private fireTick(
    stepIndex: number,
    atTime: number,
    stepSeconds: number,
  ): void {
    const columnIndex = stepIndex % this.columnCount;
    const column = this.columns[columnIndex];
    for (const runtime of this.rows) {
      if (
        runtime.pendingCycleLength !== null &&
        stepIndex % runtime.pendingCycleLength === 0
      ) {
        runtime.active = true;
        runtime.pendingCycleLength = null;
      }
      if (!runtime.active) continue;

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
      const gateSeconds = stepSeconds * resolved.gate;
      const note =
        runtime.config.sourceType === "samplePlayer" &&
        runtime.config.playbackMode === "direct"
          ? runtime.config.defaultNote
          : resolved.note;

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
        // The envelope drives envelopeGain -- a persistent, row-wide node
        // downstream of the source (see RowRuntime's doc), not a per-voice
        // param -- so scheduling it here, immediately before the noteOn it
        // shapes, is safe for the same reason mutating a source's own
        // params used to be: fireTick owns the entire scheduling loop
        // itself (unlike bruit-kit's createStepTrack, which this app
        // deliberately doesn't use for exactly this reason), so the
        // schedule and the noteOn it applies to happen in the same
        // synchronous call, both anchored at the same future shiftedAtTime
        // -- a *later* tick scheduling a new curve can't retroactively
        // affect a voice already firing. Every noteOn goes out at full
        // velocity since gain is entirely carried by this curve's own
        // valueRange max, not by scaling the source's per-voice peak.
        scheduleAutomation(
          runtime.envelopeGain.gain,
          resolved.envelope.points,
          this.audioContext,
          gateSeconds,
          { min: 0, max: resolved.gain },
          shiftedAtTime,
        );
        runtime.source.target.noteOn(note, FULL_VELOCITY, shiftedAtTime);
        runtime.source.target.noteOff(note, shiftedAtTime + gateSeconds);
      }
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
    // triggerRelease's return value used to.
    scheduleAutomation(
      gainNode.gain,
      envelope.points,
      this.audioContext,
      gateSeconds,
      { min: 0, max: gain },
      atTime,
    );
    const endTime = atTime + gateSeconds;
    source.stop(endTime);
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
      this.chainCache.release(effects);
    };
  }
}
