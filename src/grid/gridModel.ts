import { ReverbEffect, createSend } from "bruit-kit/audio";
import type { Send } from "bruit-kit/audio";
import { createStepClock } from "bruit-kit/midi";
import type { StepClock } from "bruit-kit/midi";
import {
  type AdsrParams,
  semitoneRatio,
  triggerAttack,
  triggerRelease,
} from "bruit-kit/sources";
import {
  type CellConfig,
  type ColumnConfig,
  type Precedence,
  type ResolvedCellConfig,
  type RowConfig,
  resolveCellConfig,
} from "./config";
import {
  type BuiltEffectsChain,
  createEffectsChainCache,
} from "./effectsChain";
import {
  type RowSource,
  type SourceType,
  createRowSource,
} from "./sourceFactory";
import { triggerModeGate, triggerModeSourceParams } from "./triggerModes";

const BUILT_INS = { note: 60, gate: 1.0, timeShiftSeconds: 0 };
const VELOCITY = 100;

const DEFAULT_SAMPLE_ADSR: AdsrParams = {
  attackMs: 5,
  decayMs: 0,
  sustainLevel: 1,
  releaseMs: 30,
};

/** RowConfig plus the runtime plumbing (source instance, persistent chain,
 * reverb send, activation state) a row needs but the UI doesn't -- kept as
 * a class-private shape so callers only ever see the public `Row` fields. */
interface RowRuntime {
  readonly id: string;
  config: RowConfig;
  readonly source: RowSource;
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
  readonly columns: ColumnConfig[];
  precedence: Precedence = "row";
  private readonly chainCache: ReturnType<typeof createEffectsChainCache>;
  private readonly rows: RowRuntime[] = [];
  private stepSeconds: number;

  constructor(
    private readonly audioContext: AudioContext,
    dryDestination: AudioNode,
    readonly columnCount: number,
    initialStepSeconds: number,
  ) {
    this.stepSeconds = initialStepSeconds;
    this.clock = createStepClock(audioContext, () => this.stepSeconds);
    this.chainCache = createEffectsChainCache(audioContext, dryDestination);
    this.reverb = new ReverbEffect(audioContext);
    this.reverb.setParams({ wet: 1, decaySeconds: 2.2 });
    this.reverb.output.connect(dryDestination);
    this.columns = Array.from({ length: columnCount }, () => ({
      enabled: true,
      defaultNote: undefined,
      defaultGate: undefined,
      defaultTimeShiftSeconds: undefined,
    }));
    this.clock.onTick((stepIndex, atTime, stepSeconds) =>
      this.fireTick(stepIndex, atTime, stepSeconds),
    );
  }

  setStepSeconds(seconds: number): void {
    this.stepSeconds = seconds;
  }

  getRows(): Row[] {
    return this.rows.map((r) => this.toRow(r));
  }

  async addRow(
    sourceType: SourceType,
    name: string,
    joinAtNextCycle: boolean,
  ): Promise<Row> {
    const source = createRowSource(this.audioContext, sourceType);
    if (source.init) await source.init();

    const config: RowConfig = {
      name,
      sourceType,
      enabled: true,
      triggerMode: { kind: "gatedToStep" },
      playbackMode: "direct",
      defaultNote: 60,
      defaultTimeShiftSeconds: 0,
      effects: [],
      reverbSend: 0,
    };
    if (sourceType === "samplePlayer") {
      source.setParams({
        rootNote: config.defaultNote,
        ...triggerModeSourceParams(config.triggerMode),
      });
    }

    const chain = this.chainCache.acquire(config.effects);
    source.output.connect(chain.input);
    const send = createSend(this.audioContext, this.reverb.input, 0);
    chain.output.connect(send.input);

    const runtime: RowRuntime = {
      id: crypto.randomUUID(),
      config,
      source,
      cells: Array.from({ length: this.columnCount }, () => ({
        on: false,
        note: undefined,
        gate: undefined,
        timeShiftSeconds: undefined,
        effects: undefined,
      })),
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
    this.chainCache.release(runtime.config.effects);
    this.rows.splice(this.rows.indexOf(runtime), 1);
  }

  async loadRowSample(row: Row, buffer: AudioBuffer): Promise<void> {
    const runtime = this.findRuntime(row);
    if (!runtime || !runtime.source.loadSample) return;
    await runtime.source.loadSample(buffer);
    runtime.sampleBuffer = buffer;
  }

  setRowEnabled(row: Row, enabled: boolean): void {
    const runtime = this.findRuntime(row);
    if (runtime) runtime.config = { ...runtime.config, enabled };
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

  setRowDefaultNote(row: Row, note: number | undefined): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    runtime.config = { ...runtime.config, defaultNote: note };
    if (runtime.config.sourceType === "samplePlayer" && note !== undefined) {
      runtime.source.setParams({ rootNote: note });
    }
  }

  setRowDefaultTimeShift(row: Row, seconds: number): void {
    const runtime = this.findRuntime(row);
    if (runtime) {
      runtime.config = { ...runtime.config, defaultTimeShiftSeconds: seconds };
    }
  }

  setRowReverbSend(row: Row, level: number): void {
    this.findRuntime(row)?.send.setLevel(level);
  }

  /** Re-acquires the cache entry for the *new* effects config before
   * releasing the old one -- acquire-before-release means a chain another
   * row still references (or this row's own unchanged config) is never
   * torn down and immediately rebuilt. */
  setRowEffects(row: Row, effects: RowConfig["effects"]): void {
    const runtime = this.findRuntime(row);
    if (!runtime) return;
    const oldEffects = runtime.config.effects;
    const newChain = this.chainCache.acquire(effects);
    runtime.source.output.disconnect();
    runtime.source.output.connect(newChain.input);
    runtime.send.input.disconnect();
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
    const rowDefaultGate = triggerModeGate(
      runtime.config.triggerMode,
      this.stepSeconds,
    );
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
      const rowDefaultGate = triggerModeGate(
        runtime.config.triggerMode,
        stepSeconds,
      );
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
          ? (runtime.config.defaultNote ?? BUILT_INS.note)
          : resolved.note;

      if (
        runtime.config.sourceType === "samplePlayer" &&
        cell.effects !== undefined
      ) {
        this.fireSamplePlayerOverride(
          runtime,
          note,
          shiftedAtTime,
          gateSeconds,
          resolved.effects,
        );
      } else {
        runtime.source.target.noteOn(note, VELOCITY, shiftedAtTime);
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
    atTime: number,
    gateSeconds: number,
    effects: RowConfig["effects"],
  ): void {
    const buffer = runtime.sampleBuffer;
    if (!buffer) return;
    const chain = this.chainCache.acquire(effects);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = semitoneRatio(
      note,
      runtime.config.defaultNote ?? BUILT_INS.note,
    );
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(chain.input);
    source.start(atTime);

    triggerAttack(gain.gain, this.audioContext, DEFAULT_SAMPLE_ADSR, 1, atTime);
    const endTime = triggerRelease(
      gain.gain,
      this.audioContext,
      DEFAULT_SAMPLE_ADSR,
      atTime + gateSeconds,
    );
    source.stop(endTime);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.chainCache.release(effects);
    };
  }
}
