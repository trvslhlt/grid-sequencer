/** Creates 10 ready-to-load demo patches spanning noise to simple/pretty
 * musical, per the sound-play backlog's "differentiate from Ableton --
 * play with sound, not necessarily make songs" framing: several of these
 * are deliberately not "songs" at all (a pure noise wash, a static drone),
 * not just genre variations on a beat.
 *
 * Pure Node, no browser and no npm dependencies -- constructs full Patch
 * JSON matching the exact shape src/patch.ts's serializePatch produces
 * (see src/grid/config.ts, gridModel.ts's BUILT_INS, triggerModes.ts,
 * sourceFactory.ts's PARAM_FIELDS_BY_SOURCE_TYPE, and gridView.ts's
 * EFFECT_TABLE for the schemas this mirrors) and POSTs each straight to
 * the backend, the same way any other saved patch gets there -- no UI
 * driving needed. Looks up real library sample IDs by name+category
 * first (see fetchSamples), so sample-backed rows use this app's actual
 * seeded library content instead of placeholder blips.
 *
 * Idempotent by name: always overwrite:true's its own 10 names (safe to
 * re-run after tweaking one patch's definition), never touches anything
 * else already in the library.
 *
 * Usage: node scripts/seed-demo-patches.mjs [backendUrl]
 * (backendUrl defaults to http://localhost:3002, the host-mapped port
 * from docker-compose.yml)
 */

const backendUrl = process.argv[2] ?? "http://localhost:3002";

// ---- schema helpers (mirror src/grid/config.ts + gridModel.ts's BUILT_INS
// exactly -- see this file's own top comment) ----

function envelope(points) {
  return {
    points: points ?? [
      { position: 0, value: 0 },
      { position: 0.02, value: 1 },
      { position: 0.9, value: 1 },
      { position: 1, value: 0 },
    ],
  };
}

// A short, punchy shape for percussion/glitch content -- fast in, fast out.
const PUNCHY_ENVELOPE = envelope([
  { position: 0, value: 0 },
  { position: 0.01, value: 1 },
  { position: 0.3, value: 0.6 },
  { position: 1, value: 0 },
]);

// A slow swell for pads/drones -- eases in, holds, eases out.
const SWELL_ENVELOPE = envelope([
  { position: 0, value: 0 },
  { position: 0.3, value: 1 },
  { position: 0.7, value: 1 },
  { position: 1, value: 0 },
]);

function defaultColumn() {
  return {
    enabled: true,
    defaultsOverride: false,
    defaultNote: 60,
    defaultGain: 0.8,
    defaultGate: 1.0,
    defaultTimeShiftSeconds: 0,
    envelopeOverride: false,
    envelope: envelope(),
  };
}

function columns(count) {
  return Array.from({ length: count }, () => defaultColumn());
}

function fx(type, params = {}) {
  return { type, params };
}

/** `pat` is a compact "x...x..." string (x/X = on, anything else = off),
 * one char per step. `notes`/`gains` are optional same-length arrays
 * (MIDI note / 0-1 gain) applied only to "on" steps, for melodic or
 * accented rows -- everything else stays at its BUILT_INS default via
 * `undefined`, exactly like an untouched cell in the real UI. */
function cells(pat, { notes, gains, effects } = {}) {
  return pat.split("").map((ch, i) => {
    const on = ch === "x" || ch === "X";
    return {
      on,
      note: on ? (notes?.[i] ?? undefined) : undefined,
      gain: on ? (gains?.[i] ?? undefined) : undefined,
      gate: undefined,
      timeShiftSeconds: undefined,
      envelopeOverride: false,
      envelope: envelope(),
      effects: (on && effects?.[i]) ?? [],
      effectsOverride: Boolean(on && effects?.[i]),
    };
  });
}

function row({
  name,
  sourceType,
  playbackMode = "direct",
  triggerMode = { kind: "gatedToStep" },
  defaultNote = 60,
  defaultGain = 0.8,
  defaultTimeShiftSeconds = 0,
  sendLevel = 0,
  reversed = false,
  sampleRange = { start: 0, end: 1 },
  sourceParams = {},
  sampleId = null,
  effects = [],
  cellEnvelope,
  cellsStr,
  cellOptions,
}) {
  return {
    name,
    sourceType,
    enabled: true,
    triggerMode,
    playbackMode,
    defaultsOverride: false,
    defaultNote,
    defaultGain,
    defaultTimeShiftSeconds,
    envelopeOverride: Boolean(cellEnvelope),
    envelope: cellEnvelope ?? envelope(),
    effects,
    sendLevel,
    sampleRange,
    reversed,
    sourceParams,
    sampleId,
    cells: cells(cellsStr, cellOptions),
  };
}

function patch({
  name,
  bpm,
  subdivision = 4,
  columnCount,
  scaleRoot = 0,
  scaleType = "chromatic",
  masterGain = 1,
  masterEffects = [],
  sendBusEffects = [],
  limiterCeiling = -1,
  limiterRelease = 0.1,
  rows,
}) {
  return {
    name,
    bpm,
    subdivision,
    columnCount,
    precedence: "row",
    scaleRoot,
    scaleType,
    columns: columns(columnCount),
    masterGain,
    masterEffects,
    sendBusEffects,
    limiterCeiling,
    limiterRelease,
    rows,
  };
}

/** A miscounted "x...x..." pattern string silently misaligns instead of
 * erroring (cells()/notes/gains all just index past a too-short array
 * and get undefined back) -- catch it here instead of by eye. */
function validate(p) {
  for (const r of p.rows) {
    if (r.cells.length !== p.columnCount) {
      throw new Error(
        `${p.name} / ${r.name}: cellsStr has ${r.cells.length} steps, expected columnCount ${p.columnCount}`,
      );
    }
  }
}

// ---- sample library lookup ----

async function fetchSamples() {
  const response = await fetch(`${backendUrl}/api/samples`);
  if (!response.ok) throw new Error(`Failed to list samples: ${response.status}`);
  const body = await response.json();
  const byName = new Map();
  for (const s of body.samples) byName.set(s.name, s.id);
  return byName;
}

async function main() {
  const S = await fetchSamples();
  const need = (name) => {
    const id = S.get(name);
    if (!id) throw new Error(`Sample "${name}" not found in the library`);
    return id;
  };

  const patches = [
    // 1. Pure noise -- no rhythm to speak of, an evolving abrasive wash.
    // The harsh end of the spectrum: nothing here is trying to be a song.
    patch({
      name: "Demo: White Noise Storm",
      bpm: 140,
      subdivision: 4,
      columnCount: 8,
      scaleType: "chromatic",
      limiterCeiling: -3,
      rows: [
        row({
          name: "Storm",
          sourceType: "noiseGenerator",
          sourceParams: { type: "white" },
          triggerMode: { kind: "explicitDuration", steps: 3, loop: false },
          cellsStr: "x.xx.x.x",
          cellEnvelope: PUNCHY_ENVELOPE,
          effects: [fx("bitcrusher", { bits: 3, outputGain: 1 }), fx("distortion", { amount: 80, outputGain: 0.8 })],
        }),
        row({
          name: "Crackle",
          sourceType: "noiseGenerator",
          sourceParams: { type: "brown" },
          cellsStr: ".x..x..x",
          defaultGain: 0.5,
          effects: [fx("ringMod", { frequency: 400, waveform: "square" }), fx("filter", { type: "highpass", frequency: 2500, q: 4 })],
        }),
        row({
          name: "Zap",
          sourceType: "samplePlayer",
          sampleId: need("Zap"),
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "x......x",
          effects: [fx("bitcrusher", { bits: 4, outputGain: 1.3 })],
        }),
      ],
    }),

    // 2. Glitch pulse -- broken, IDM-flavored, still has a pulse under it.
    patch({
      name: "Demo: Glitch Pulse",
      bpm: 128,
      subdivision: 4,
      columnCount: 16,
      scaleType: "chromatic",
      rows: [
        row({
          name: "Kick",
          sourceType: "samplePlayer",
          sampleId: need("Kick"),
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "x...x.x...x...x.",
        }),
        row({
          name: "Hat",
          sourceType: "samplePlayer",
          sampleId: need("Hihat Closed"),
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.45,
          cellsStr: "x.xxx.xxx.x.xxx.",
        }),
        row({
          name: "Stab",
          sourceType: "fmSynth",
          playbackMode: "pitched",
          sourceParams: { carrierWaveform: "square", modulatorWaveform: "sine", harmonicity: 3, modulationIndex: 320 },
          triggerMode: { kind: "explicitDuration", steps: 1, loop: false },
          cellEnvelope: PUNCHY_ENVELOPE,
          cellsStr: "..x...x.....x...",
          cellOptions: { notes: [null, null, 45, null, null, null, 57, null, null, null, null, null, 48, null, null, null] },
          effects: [fx("bitcrusher", { bits: 5 }), fx("delay", { delayMs: 120, feedback: 0.4, wet: 0.3 })],
        }),
        row({
          name: "Noise Hit",
          sourceType: "noiseGenerator",
          sourceParams: { type: "white" },
          defaultGain: 0.55,
          cellsStr: "....x.......x...",
          effects: [fx("ringMod", { frequency: 900 })],
        }),
      ],
    }),

    // 3. Four on the floor -- clean, minimal, unmistakably musical.
    patch({
      name: "Demo: Four on the Floor",
      bpm: 124,
      subdivision: 2,
      columnCount: 8,
      scaleRoot: 9,
      scaleType: "naturalMinor",
      sendBusEffects: [fx("reverb", { decaySeconds: 1.4, preDelayMs: 10, dampingHz: 5000, wet: 1 })],
      rows: [
        row({
          name: "Kick",
          sourceType: "samplePlayer",
          sampleId: need("Kick"),
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "x.x.x.x.",
        }),
        row({
          name: "Hat",
          sourceType: "samplePlayer",
          sampleId: need("Hihat Closed"),
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.5,
          cellsStr: ".x.x.x.x",
        }),
        row({
          name: "Clap",
          sourceType: "samplePlayer",
          sampleId: need("Clap"),
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.7,
          cellsStr: "....x...",
        }),
        row({
          name: "Bass",
          sourceType: "samplePlayer",
          sampleId: need("Sub Bass"),
          playbackMode: "pitched",
          triggerMode: { kind: "gatedToStep" },
          sendLevel: 0.15,
          cellsStr: "x...x...",
          cellOptions: { notes: [33, null, null, null, 33, null, null, null] },
        }),
      ],
    }),

    // 4. Ambient drift -- pretty, atmospheric, granular, barely rhythmic.
    patch({
      name: "Demo: Ambient Drift",
      bpm: 70,
      subdivision: 1,
      columnCount: 4,
      scaleRoot: 2,
      scaleType: "majorPentatonic",
      sendBusEffects: [fx("reverb", { decaySeconds: 6, preDelayMs: 40, dampingHz: 3500, wet: 1 })],
      rows: [
        row({
          name: "Air Bed",
          sourceType: "granularSynth",
          sampleId: need("Airy Pad"),
          playbackMode: "pitched",
          sourceParams: { grainDurationMinMs: 80, grainDurationMaxMs: 180, densityHz: 12, positionJitterMs: 60, pitchJitterCents: 15, panSpread: 0.8, scanSpeed: 0.3 },
          triggerMode: { kind: "explicitDuration", steps: 4, loop: false },
          cellEnvelope: SWELL_ENVELOPE,
          sendLevel: 0.5,
          cellsStr: "x...",
          cellOptions: { notes: [50] },
          effects: [fx("chorus", { rate: 0.3, depth: 4, wet: 0.4 })],
        }),
        row({
          name: "Warm Under",
          sourceType: "granularSynth",
          sampleId: need("Warm Pad"),
          playbackMode: "pitched",
          sourceParams: { grainDurationMinMs: 100, grainDurationMaxMs: 220, densityHz: 8, positionJitterMs: 40, pitchJitterCents: 8, panSpread: 0.5, scanSpeed: -0.2 },
          triggerMode: { kind: "explicitDuration", steps: 4, loop: false },
          cellEnvelope: SWELL_ENVELOPE,
          defaultGain: 0.6,
          sendLevel: 0.6,
          cellsStr: "x...",
          cellOptions: { notes: [38] },
        }),
        row({
          name: "Glint",
          sourceType: "samplePlayer",
          sampleId: need("Pluck Lead"),
          playbackMode: "pitched",
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.4,
          sendLevel: 0.5,
          cellsStr: "...x",
          cellOptions: { notes: [null, null, null, 74] },
          effects: [fx("delay", { delayMs: 500, feedback: 0.5, wet: 0.4 })],
        }),
      ],
    }),

    // 5. Minimal pluck -- simplest, prettiest, most "just a melody" patch.
    patch({
      name: "Demo: Minimal Pluck",
      bpm: 96,
      subdivision: 4,
      columnCount: 8,
      scaleRoot: 0,
      scaleType: "majorPentatonic",
      sendBusEffects: [fx("reverb", { decaySeconds: 2, preDelayMs: 20, dampingHz: 5500, wet: 0.6 })],
      rows: [
        row({
          name: "Pluck",
          sourceType: "samplePlayer",
          sampleId: need("Pluck Lead"),
          playbackMode: "pitched",
          triggerMode: { kind: "oneShotSample" },
          sendLevel: 0.3,
          cellsStr: "x.x.xx.x",
          cellOptions: { notes: [72, null, 76, null, 79, 76, null, 72] },
          effects: [fx("chorus", { rate: 0.6, depth: 2.5, wet: 0.25 })],
        }),
        row({
          name: "Soft Bass",
          sourceType: "samplePlayer",
          sampleId: need("Sub Bass"),
          playbackMode: "pitched",
          triggerMode: { kind: "gatedToStep" },
          defaultGain: 0.6,
          cellsStr: "x...x...",
          cellOptions: { notes: [36, null, null, null, 43, null, null, null] },
        }),
      ],
    }),

    // 6. Broken beat -- syncopated, more moving parts, still musical.
    patch({
      name: "Demo: Broken Beat",
      bpm: 132,
      subdivision: 4,
      columnCount: 16,
      scaleRoot: 2,
      scaleType: "dorian",
      rows: [
        row({
          name: "Kick",
          sourceType: "samplePlayer",
          sampleId: need("Kick"),
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "x..x..x...x.x...",
        }),
        row({
          name: "Hat",
          sourceType: "samplePlayer",
          sampleId: need("Hihat Closed"),
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.5,
          cellsStr: "x.x.xxx.x.x.xxx.",
          cellOptions: { gains: [0.6, null, 0.3, null, 0.6, 0.3, 0.3, null, 0.6, null, 0.3, null, 0.6, 0.3, 0.3, null] },
        }),
        row({
          name: "Snare",
          sourceType: "samplePlayer",
          sampleId: need("Snare"),
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "....x......x.x..",
        }),
        row({
          name: "Bass",
          sourceType: "fmSynth",
          playbackMode: "pitched",
          sourceParams: { carrierWaveform: "sine", modulatorWaveform: "triangle", harmonicity: 1, modulationIndex: 60 },
          triggerMode: { kind: "explicitDuration", steps: 2, loop: false },
          cellsStr: "x.x...x.x...x.x.",
          cellOptions: { notes: [38, null, 41, null, null, null, 38, null, 45, null, null, null, 38, null, 41, null] },
          effects: [fx("filter", { type: "lowpass", frequency: 900, q: 3 })],
        }),
      ],
    }),

    // 7. Drone wash -- abstract, non-rhythmic, but not harsh -- the
    // "pretty" end of pure texture rather than pure noise.
    patch({
      name: "Demo: Drone Wash",
      bpm: 60,
      subdivision: 1,
      columnCount: 4,
      scaleType: "chromatic",
      sendBusEffects: [fx("reverb", { decaySeconds: 7, preDelayMs: 60, dampingHz: 3000, wet: 1 })],
      rows: [
        row({
          name: "Low Drone",
          sourceType: "oscillatorSynth",
          playbackMode: "pitched",
          sourceParams: { waveform: "sawtooth", detune: -12 },
          triggerMode: { kind: "explicitDuration", steps: 4, loop: false },
          cellEnvelope: SWELL_ENVELOPE,
          sendLevel: 0.6,
          cellsStr: "x...",
          cellOptions: { notes: [36] },
          effects: [fx("phaser", { rate: 0.15, depth: 0.6, feedback: 0.4, wet: 0.5 }), fx("filter", { type: "lowpass", frequency: 1200, q: 0.7 })],
        }),
        row({
          name: "High Shimmer",
          sourceType: "oscillatorSynth",
          playbackMode: "pitched",
          sourceParams: { waveform: "triangle", detune: 9 },
          triggerMode: { kind: "explicitDuration", steps: 4, loop: false },
          cellEnvelope: SWELL_ENVELOPE,
          defaultGain: 0.5,
          sendLevel: 0.7,
          cellsStr: "x...",
          cellOptions: { notes: [72] },
          effects: [fx("flanger", { rate: 0.08, depth: 3, feedback: 0.3, wet: 0.6 })],
        }),
      ],
    }),

    // 8. Acid bassline -- aggressive but groovy; per-cell filter overrides
    // on the bass give it the classic sweeping-cutoff acid character.
    patch({
      name: "Demo: Acid Bassline",
      bpm: 138,
      subdivision: 4,
      columnCount: 16,
      scaleRoot: 4,
      scaleType: "minorPentatonic",
      rows: [
        row({
          name: "Kick",
          sourceType: "samplePlayer",
          sampleId: need("Kick"),
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "x...x...x...x...",
        }),
        row({
          name: "Hat",
          sourceType: "samplePlayer",
          sampleId: need("Hihat Open"),
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.4,
          cellsStr: "..x...x...x...x.",
        }),
        row({
          name: "Acid",
          sourceType: "oscillatorSynth",
          playbackMode: "pitched",
          sourceParams: { waveform: "sawtooth", detune: 0 },
          triggerMode: { kind: "explicitDuration", steps: 1, loop: false },
          cellEnvelope: PUNCHY_ENVELOPE,
          effects: [fx("filter", { type: "lowpass", frequency: 500, q: 12 }), fx("distortion", { amount: 15, outputGain: 1 })],
          cellsStr: "x.xxx.x.x.xxx.x.",
          cellOptions: {
            notes: [40, null, 40, 43, 40, null, 47, null, 40, null, 40, 43, 45, null, 40, null],
            effects: {
              0: [fx("filter", { type: "lowpass", frequency: 400, q: 14 }), fx("distortion", { amount: 15, outputGain: 1 })],
              3: [fx("filter", { type: "lowpass", frequency: 1800, q: 18 }), fx("distortion", { amount: 15, outputGain: 1 })],
              6: [fx("filter", { type: "lowpass", frequency: 2600, q: 20 }), fx("distortion", { amount: 20, outputGain: 1 })],
              11: [fx("filter", { type: "lowpass", frequency: 1400, q: 16 }), fx("distortion", { amount: 15, outputGain: 1 })],
            },
          },
        }),
      ],
    }),

    // 9. Toy box -- playful, light, deliberately "sound play" rather than
    // a serious composition -- bells, wobble, and small hand percussion.
    patch({
      name: "Demo: Toy Box",
      bpm: 110,
      subdivision: 4,
      columnCount: 8,
      scaleRoot: 7,
      scaleType: "majorPentatonic",
      sendBusEffects: [fx("reverb", { decaySeconds: 1.2, preDelayMs: 5, dampingHz: 6000, wet: 0.35 })],
      rows: [
        row({
          name: "Bell",
          sourceType: "fmSynth",
          playbackMode: "pitched",
          sourceParams: { carrierWaveform: "sine", modulatorWaveform: "sine", harmonicity: 3.5, modulationIndex: 60 },
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "x.x.xx.x",
          cellOptions: { notes: [79, null, 84, null, 86, 84, null, 79] },
          effects: [fx("chorus", { rate: 1.2, depth: 3, wet: 0.3 })],
        }),
        row({
          name: "Wobble Pad",
          sourceType: "granularSynth",
          sampleId: need("Pad blip"),
          playbackMode: "pitched",
          sourceParams: { grainDurationMinMs: 20, grainDurationMaxMs: 60, densityHz: 30, positionJitterMs: 10, pitchJitterCents: 80, panSpread: 0.6, scanSpeed: 1.5 },
          triggerMode: { kind: "explicitDuration", steps: 4, loop: false },
          defaultGain: 0.45,
          cellsStr: "x...x...",
          cellOptions: { notes: [67, null, null, null, 74, null, null, null] },
        }),
        row({
          name: "Clap Toy",
          sourceType: "samplePlayer",
          sampleId: need("Clap"),
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.5,
          cellsStr: "..x...x.",
        }),
      ],
    }),

    // 10. Industrial clang -- harsh and dark but with a steady pulse,
    // sitting between straight noise and a real beat.
    patch({
      name: "Demo: Industrial Clang",
      bpm: 100,
      subdivision: 4,
      columnCount: 8,
      scaleType: "chromatic",
      limiterCeiling: -2,
      rows: [
        row({
          name: "Metal Hit",
          sourceType: "samplePlayer",
          sampleId: need("Tom"),
          triggerMode: { kind: "oneShotSample" },
          cellsStr: "x.x.x.x.",
          effects: [fx("ringMod", { frequency: 210, waveform: "square" }), fx("distortion", { amount: 40, outputGain: 1 })],
        }),
        row({
          name: "Crush Clap",
          sourceType: "samplePlayer",
          sampleId: need("Clap"),
          triggerMode: { kind: "oneShotSample" },
          defaultGain: 0.7,
          cellsStr: "....x...",
          effects: [fx("bitcrusher", { bits: 4, outputGain: 1.4 })],
        }),
        row({
          name: "Rumble",
          sourceType: "noiseGenerator",
          sourceParams: { type: "brown" },
          defaultGain: 0.5,
          triggerMode: { kind: "explicitDuration", steps: 2, loop: false },
          cellsStr: "..x.....",
          effects: [fx("distortion", { amount: 60, outputGain: 0.9 }), fx("filter", { type: "lowpass", frequency: 700, q: 2 })],
        }),
        row({
          name: "Metallic Stab",
          sourceType: "fmSynth",
          playbackMode: "pitched",
          sourceParams: { carrierWaveform: "square", modulatorWaveform: "sawtooth", harmonicity: 5, modulationIndex: 450 },
          triggerMode: { kind: "explicitDuration", steps: 1, loop: false },
          cellEnvelope: PUNCHY_ENVELOPE,
          cellsStr: "...x...x",
          cellOptions: { notes: [null, null, null, 43, null, null, null, 46] },
          effects: [fx("ringMod", { frequency: 130 }), fx("bitcrusher", { bits: 6 })],
        }),
      ],
    }),
  ];

  for (const p of patches) validate(p);

  for (const p of patches) {
    const response = await fetch(`${backendUrl}/api/patches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, overwrite: true }),
    });
    if (!response.ok) {
      console.error(`FAILED: ${p.name} -- ${response.status} ${await response.text()}`);
      continue;
    }
    console.log(`saved: ${p.name}`);
  }
}

main();
