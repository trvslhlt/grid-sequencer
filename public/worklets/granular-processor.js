// Runs in AudioWorkletGlobalScope. `sampleRate` and `currentTime` are globals
// provided by that scope and share the same clock as the main-thread
// AudioContext — no clock translation needed between the two.
//
// This processor has no concept of "MIDI": its only inputs are noteOn/
// noteOff events (each carrying a note number, velocity, and optional
// absolute AudioContext time) and a bag of grain-shape params. A MIDI file
// player and a manual on-screen keyboard both just produce the same kind of
// event — this file doesn't know or care which one sent them.

// Cap on how many grains' worth of detail ride along on each status ping —
// keeps the message small at high density instead of serializing hundreds
// of objects 20x/sec; the live grain-cloud view just gets a representative
// subset rather than every single grain.
const MAX_STATUS_GRAINS = 300;

// Standard bipolar (-1..1) LFO waveform generators, phase given in cycles
// (not pre-wrapped) — used by buildEffectiveParams below to modulate
// worklet-internal params. Native AudioParam targets (effects, master
// volume) don't go through this; those use a real OscillatorNode instead
// (see lfoEngine.ts) since they can modulate for free on the audio thread.
function lfoValue(shape, phase) {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "triangle":
      return 4 * Math.abs(p - Math.floor(p + 0.5)) - 1;
    case "square":
      return Math.sin(2 * Math.PI * p) >= 0 ? 1 : -1;
    case "sawtooth":
      return 2 * p - 1;
    default:
      return 0;
  }
}

class GranularProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    /** @type {Float32Array | null} */
    this.sampleData = null;

    this.params = {
      grainDurationMinMs: 40,
      grainDurationMaxMs: 80,
      densityHz: 20,
      positionJitterMs: 30,
      pitchJitterCents: 10,
      panSpread: 0.5,
      scanSpeed: 1,
      playheadMode: "shared", // "shared" | "per-note"
      // "random": grainDurationMs is picked uniformly from
      // [grainDurationMinMs, grainDurationMaxMs] regardless of envelope
      // phase (original behavior). "envelope": the top of that range
      // scales with voice.envValue, so grains start short (attack),
      // lengthen toward grainDurationMaxMs at sustain, then shorten again
      // through release -- the same shape densityHz already follows below.
      grainDurationMode: "random", // "random" | "envelope"
      attackMs: 20,
      decayMs: 150,
      sustainLevel: 0.7,
      releaseMs: 300,
      // Only affects Direct Play's continuous voice — MIDI/manual notes get
      // their pitch from note number instead.
      directPitchSemitones: 0,
    };

    // this.params as actually used this block, after applying any active
    // LFOs (see buildEffectiveParams) — recomputed once per process() call
    // rather than per grain, since a block is ~2.9ms and these are slow
    // (sub-20Hz) modulations.
    this.effectiveParams = this.params;

    // One slot per LFO (null = unassigned/off): { target, shape, rateHz,
    // depth, min, max }, all already in the target's real units.
    this.modulations = [null, null, null];

    // Sorted ascending by time; only ever contains events not yet applied.
    this.events = [];

    // note -> { velocity, timeSinceLastGrain, notePos, phase, phaseTime, envValue, releaseStartLevel }
    // phase is "attack" | "decay" | "sustain" | "release" | "finished".
    this.activeVoices = new Map();

    // A single note-number-free voice for "Direct Play" — press play and
    // the playhead just streams grains at rate 1 (no pitch shift), same
    // shape as any other voice otherwise. Kept separate from activeVoices
    // (rather than reusing note 60) so it can't collide with the manual
    // keyboard's own note-60 key.
    this.directVoice = null;

    this.playheadPos = 0; // seconds into the sample buffer
    this.grains = [];

    this.statusCounter = 0;

    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case "loadSample":
        this.sampleData = msg.channelData;
        this.playheadPos = 0;
        break;
      case "setParams":
        Object.assign(this.params, msg.params);
        break;
      case "noteOn":
        this.insertEvents([
          {
            time: msg.time ?? currentTime,
            type: "noteOn",
            note: msg.note,
            velocity: msg.velocity,
          },
        ]);
        break;
      case "noteOff":
        this.insertEvents([
          { time: msg.time ?? currentTime, type: "noteOff", note: msg.note },
        ]);
        break;
      case "schedule":
        this.insertEvents(msg.events);
        break;
      case "directPlayOn":
        this.insertEvents([
          { time: msg.time ?? currentTime, type: "directOn" },
        ]);
        break;
      case "directPlayOff":
        this.insertEvents([
          { time: msg.time ?? currentTime, type: "directOff" },
        ]);
        break;
      case "clear":
        this.events = [];
        this.activeVoices.clear();
        this.directVoice = null;
        this.grains = [];
        break;
      case "setPlayhead": {
        const position = Math.min(
          Math.max(msg.position, 0),
          this.bufferDurationSeconds(),
        );
        this.playheadPos = position;
        // In per-note mode, each voice scans from its own notePos rather
        // than reading this.playheadPos directly (see advanceVoiceAndSpawn)
        // — without this, scrubbing the waveform would silently do nothing
        // to any note already sounding.
        for (const voice of this.activeVoices.values())
          voice.notePos = position;
        if (this.directVoice) this.directVoice.notePos = position;
        break;
      }
      case "setModulation":
        this.modulations[msg.slot] = msg.config;
        break;
    }
  }

  // Applies each active LFO on top of this.params' base values, producing
  // this.effectiveParams — everything that spawns grains or advances
  // envelopes reads from effectiveParams instead of params directly, so a
  // modulated param still has a stable "center" that the LFO swings around.
  buildEffectiveParams() {
    this.effectiveParams = { ...this.params };
    for (const mod of this.modulations) {
      if (!mod) continue;
      const lfo = lfoValue(mod.shape, mod.rateHz * currentTime);
      const raw = this.params[mod.target] + lfo * mod.depth;
      this.effectiveParams[mod.target] = Math.min(
        Math.max(raw, mod.min),
        mod.max,
      );
    }
  }

  insertEvents(newEvents) {
    for (const ev of newEvents) this.events.push(ev);
    this.events.sort((a, b) => a.time - b.time);
  }

  bufferDurationSeconds() {
    return this.sampleData ? this.sampleData.length / sampleRate : 0;
  }

  applyEvent(ev) {
    if (ev.type === "noteOn") {
      this.activeVoices.set(ev.note, {
        velocity: ev.velocity,
        timeSinceLastGrain: 0,
        notePos: this.playheadPos,
        phase: "attack",
        phaseTime: 0,
        envValue: 0,
        releaseStartLevel: 0,
      });
    } else if (ev.type === "noteOff") {
      const voice = this.activeVoices.get(ev.note);
      if (voice && voice.phase !== "release" && voice.phase !== "finished") {
        voice.phase = "release";
        voice.phaseTime = 0;
        voice.releaseStartLevel = voice.envValue;
      }
    } else if (ev.type === "directOn") {
      this.directVoice = {
        velocity: 100,
        timeSinceLastGrain: 0,
        notePos: this.playheadPos,
        phase: "attack",
        phaseTime: 0,
        envValue: 0,
        releaseStartLevel: 0,
      };
    } else if (ev.type === "directOff") {
      const voice = this.directVoice;
      if (voice && voice.phase !== "release" && voice.phase !== "finished") {
        voice.phase = "release";
        voice.phaseTime = 0;
        voice.releaseStartLevel = voice.envValue;
      }
    }
  }

  // Advances one voice's ADSR phase in place and sets voice.envValue (0..1).
  // Phase transitions fall through in the same call so envelope stages
  // shorter than one render block still advance correctly.
  advanceEnvelope(voice, blockDuration) {
    const { attackMs, decayMs, sustainLevel, releaseMs } = this.effectiveParams;
    const attackSec = Math.max(attackMs, 0) / 1000;
    const decaySec = Math.max(decayMs, 0) / 1000;
    const releaseSec = Math.max(releaseMs, 0) / 1000;

    voice.phaseTime += blockDuration;

    if (voice.phase === "attack") {
      if (attackSec <= 0) {
        voice.phase = "decay";
        voice.phaseTime = 0;
      } else if (voice.phaseTime >= attackSec) {
        voice.phase = "decay";
        voice.phaseTime -= attackSec;
      } else {
        voice.envValue = voice.phaseTime / attackSec;
        return;
      }
    }

    if (voice.phase === "decay") {
      if (decaySec <= 0) {
        voice.phase = "sustain";
        voice.phaseTime = 0;
      } else if (voice.phaseTime >= decaySec) {
        voice.phase = "sustain";
        voice.phaseTime -= decaySec;
      } else {
        voice.envValue = 1 + (sustainLevel - 1) * (voice.phaseTime / decaySec);
        return;
      }
    }

    if (voice.phase === "sustain") {
      voice.envValue = sustainLevel;
      return;
    }

    if (voice.phase === "release") {
      if (releaseSec <= 0 || voice.phaseTime >= releaseSec) {
        voice.envValue = 0;
        voice.phase = "finished";
        return;
      }
      voice.envValue =
        voice.releaseStartLevel * (1 - voice.phaseTime / releaseSec);
    }
  }

  spawnGrain(note, voice, sourcePos) {
    const {
      grainDurationMinMs,
      grainDurationMaxMs,
      positionJitterMs,
      pitchJitterCents,
      panSpread,
    } = this.effectiveParams;
    const bufferDuration = this.bufferDurationSeconds();
    if (bufferDuration <= 0) return;

    const jitterSeconds = (Math.random() * 2 - 1) * (positionJitterMs / 1000);
    const posSeconds = Math.min(
      Math.max(sourcePos + jitterSeconds, 0),
      bufferDuration,
    );

    const pitchJitterRatio =
      2 ** (((Math.random() * 2 - 1) * pitchJitterCents) / 100 / 12);
    const rate = 2 ** ((note - 60) / 12) * pitchJitterRatio;

    // Each grain gets its own random length in [min, max] — defensively
    // ordered here too, in case the UI's own min<=max clamping is bypassed.
    const lo = Math.min(grainDurationMinMs, grainDurationMaxMs);
    const hi = Math.max(grainDurationMinMs, grainDurationMaxMs);
    // In "envelope" mode the top of the range tracks voice.envValue instead
    // of always being the configured max, so grains lengthen through
    // attack/sustain and shorten again through release (see the
    // grainDurationMode default's doc comment above).
    const effectiveHi =
      this.params.grainDurationMode === "envelope"
        ? lo + (hi - lo) * voice.envValue
        : hi;
    const grainDurationMs = lo + Math.random() * (effectiveHi - lo);
    const lengthSamples = Math.max(
      1,
      Math.round((grainDurationMs / 1000) * sampleRate),
    );

    const panRandom = (Math.random() * 2 - 1) * panSpread;
    const angle = ((panRandom + 1) * Math.PI) / 4; // 0..pi/2
    const panL = Math.cos(angle);
    const panR = Math.sin(angle);

    this.grains.push({
      srcPos: posSeconds * sampleRate,
      rate,
      length: lengthSamples,
      envProgress: 0,
      panL,
      panR,
      // Raw -1..1 spread value (pre angle-mapping) — kept alongside panL/panR
      // purely for the grain-cloud visualization, where it's a more direct
      // "left/right" signal than deriving one back out of the equal-power gains.
      pan: panRandom,
      amp: (voice.velocity / 127) * voice.envValue,
    });
  }

  // Advances one voice's per-note playhead + envelope and spawns any grains
  // now due. `note` determines pitch (60 = no shift, used by the direct-play
  // voice); returns true once the voice's release has finished, so the
  // caller knows to drop it.
  advanceVoiceAndSpawn(note, voice, blockDuration, bufferDuration) {
    const { densityHz, scanSpeed } = this.effectiveParams;
    const { playheadMode } = this.params;

    if (playheadMode === "per-note") {
      voice.notePos =
        (voice.notePos + scanSpeed * blockDuration) % bufferDuration;
      if (voice.notePos < 0) voice.notePos += bufferDuration;
    }

    this.advanceEnvelope(voice, blockDuration);
    if (voice.phase === "finished") return true;

    // The envelope drives grain density as well as amplitude: sparse
    // grains during attack build to full density, thinning out again
    // through release, rather than just fading a constant grain stream.
    // (Grain *duration* optionally follows the same envelope too -- see
    // spawnGrain's grainDurationMode handling.)
    const effectiveDensity = Math.max(densityHz * voice.envValue, 0.1);
    const spacing = 1 / effectiveDensity;
    voice.timeSinceLastGrain += blockDuration;
    while (voice.timeSinceLastGrain >= spacing) {
      voice.timeSinceLastGrain -= spacing;
      const sourcePos =
        playheadMode === "shared" ? this.playheadPos : voice.notePos;
      this.spawnGrain(note, voice, sourcePos);
    }
    return false;
  }

  advanceVoicesAndSpawn(blockDuration) {
    const { scanSpeed } = this.effectiveParams;
    const bufferDuration = this.bufferDurationSeconds();
    if (bufferDuration <= 0) return;

    this.playheadPos =
      (this.playheadPos + scanSpeed * blockDuration) % bufferDuration;
    if (this.playheadPos < 0) this.playheadPos += bufferDuration;

    const toRemove = [];
    for (const [note, voice] of this.activeVoices) {
      if (
        this.advanceVoiceAndSpawn(note, voice, blockDuration, bufferDuration)
      ) {
        toRemove.push(note);
      }
    }
    for (const note of toRemove) this.activeVoices.delete(note);

    if (this.directVoice) {
      // Note 60 -> playback rate 1.0 (no shift); directPitchSemitones
      // offsets from there, reusing spawnGrain's existing note-based pitch
      // math rather than a separate rate calculation.
      const directNote = 60 + this.effectiveParams.directPitchSemitones;
      if (
        this.advanceVoiceAndSpawn(
          directNote,
          this.directVoice,
          blockDuration,
          bufferDuration,
        )
      ) {
        this.directVoice = null;
      }
    }
  }

  renderGrains(outputL, outputR) {
    const data = this.sampleData;
    if (!data) return;
    const blockSize = outputL.length;

    for (let g = this.grains.length - 1; g >= 0; g--) {
      const grain = this.grains[g];
      for (let i = 0; i < blockSize; i++) {
        if (grain.envProgress >= grain.length) {
          this.grains.splice(g, 1);
          break;
        }
        const windowVal =
          0.5 *
          (1 - Math.cos((2 * Math.PI * grain.envProgress) / grain.length));

        const idx = Math.floor(grain.srcPos);
        let sampleVal = 0;
        if (idx >= 0 && idx + 1 < data.length) {
          const frac = grain.srcPos - idx;
          sampleVal = data[idx] * (1 - frac) + data[idx + 1] * frac;
        }

        const contribution = sampleVal * windowVal * grain.amp;
        outputL[i] += contribution * grain.panL;
        outputR[i] += contribution * grain.panR;

        grain.envProgress += 1;
        grain.srcPos += grain.rate;
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const outputL = output[0];
    const outputR = output[1] ?? output[0];
    outputL.fill(0);
    if (outputR !== outputL) outputR.fill(0);

    const blockDuration = outputL.length / sampleRate;
    const blockEndTime = currentTime + blockDuration;

    while (this.events.length > 0 && this.events[0].time <= blockEndTime) {
      this.applyEvent(this.events.shift());
    }

    this.buildEffectiveParams();
    this.advanceVoicesAndSpawn(blockDuration);
    this.renderGrains(outputL, outputR);

    this.statusCounter += blockDuration;
    if (this.statusCounter >= 0.05) {
      this.statusCounter = 0;
      const bufferDuration = this.bufferDurationSeconds();
      const grains = this.grains.slice(0, MAX_STATUS_GRAINS).map((g) => ({
        pos: bufferDuration > 0 ? g.srcPos / sampleRate / bufferDuration : 0,
        pan: g.pan,
        amp: g.amp,
        life: g.length > 0 ? 1 - g.envProgress / g.length : 0,
        rate: g.rate,
      }));
      this.port.postMessage({
        type: "status",
        activeVoices: this.activeVoices.size + (this.directVoice ? 1 : 0),
        activeGrains: this.grains.length,
        playheadFraction:
          bufferDuration > 0 ? this.playheadPos / bufferDuration : 0,
        grains,
      });
    }

    return true;
  }
}

registerProcessor("granular-processor", GranularProcessor);
