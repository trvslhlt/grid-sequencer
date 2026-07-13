/** Populates the backend's sample library (see backend/src/sampleStore.ts,
 * src/patchApi.ts's SAMPLE_CATEGORIES) with a varied set of procedurally
 * synthesized one-shot sounds spanning every category -- run this once
 * against a fresh backend (or any time you want to top it up) to have
 * something more than the demo patch's own two placeholder blips to pick
 * from in a row's "Sample library" dropdown.
 *
 * Pure Node, no browser and no npm dependencies: synthesizes raw PCM with
 * plain math (phase-accumulated oscillators, one-pole filters, exponential
 * envelopes), encodes it as WAV by hand (same mono/16-bit shape as
 * src/wavEncoder.ts), and POSTs each to /api/samples with fetch's native
 * FormData/Blob -- mirrors src/patchApi.ts's uploadSample, just from the
 * host instead of the browser.
 *
 * Usage: node scripts/seed-sample-library.mjs [backendUrl]
 * (backendUrl defaults to http://localhost:3002, the host-mapped port from
 * docker-compose.yml)
 */

const SAMPLE_RATE = 44100;
const backendUrl = process.argv[2] ?? "http://localhost:3002";

// --- signal-generation primitives -------------------------------------

function renderSamples(durationSeconds, sampleRate, step) {
  const length = Math.max(1, Math.round(durationSeconds * sampleRate));
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = step(i / sampleRate, i);
  }
  return buffer;
}

function mix(...buffers) {
  const length = Math.max(...buffers.map((b) => b.length));
  const out = new Float32Array(length);
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) out[i] += buffer[i];
  }
  return out;
}

function whiteNoise(durationSeconds, sampleRate) {
  return renderSamples(
    durationSeconds,
    sampleRate,
    () => Math.random() * 2 - 1,
  );
}

/** Phase-accumulated so a swept frequency stays continuous (naive
 * sin(2*pi*freq(t)*t) would jump/click as freq(t) changes) -- freqAt(t)
 * returns the instantaneous frequency in Hz at time t. shape maps a 0..1
 * phase fraction to a waveform (sine/square/triangle/saw, see below). */
function oscillator(durationSeconds, sampleRate, freqAt, shape) {
  let phase = 0;
  return renderSamples(durationSeconds, sampleRate, (t) => {
    const value = shape(phase);
    phase += freqAt(t) / sampleRate;
    phase -= Math.floor(phase);
    return value;
  });
}

const sineShape = (phase) => Math.sin(2 * Math.PI * phase);
const squareShape = (phase) => (phase < 0.5 ? 1 : -1);
const sawShape = (phase) => phase * 2 - 1;
const triangleShape = (phase) =>
  1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));

function constantFreq(hz) {
  return () => hz;
}

/** Exponential sweep -- exponential (not linear) so a pitch drop/rise
 * sounds musically even across the whole sweep, same reasoning a synth's
 * own pitch-envelope would use. */
function sweepFreq(fromHz, toHz, sweepSeconds) {
  return (t) => {
    const frac = Math.min(1, t / sweepSeconds);
    return fromHz * (toHz / fromHz) ** frac;
  };
}

function expDecay(tau) {
  return (t) => Math.exp(-t / tau);
}

function envelope(buffer, sampleRate, envAt) {
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++)
    out[i] = buffer[i] * envAt(i / sampleRate);
  return out;
}

/** Simple one-pole IIR -- not a "real" filter design, just enough to turn
 * flat white noise into something that reads as a hi-hat/snare/pad texture
 * instead of pure hiss. */
function onePoleLowpass(buffer, cutoffHz, sampleRate) {
  const alpha =
    (2 * Math.PI * cutoffHz) / (2 * Math.PI * cutoffHz + sampleRate);
  const out = new Float32Array(buffer.length);
  let prev = 0;
  for (let i = 0; i < buffer.length; i++) {
    prev = prev + alpha * (buffer[i] - prev);
    out[i] = prev;
  }
  return out;
}

function onePoleHighpass(buffer, cutoffHz, sampleRate) {
  const alpha = sampleRate / (sampleRate + 2 * Math.PI * cutoffHz);
  const out = new Float32Array(buffer.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < buffer.length; i++) {
    const value = alpha * (prevOut + buffer[i] - prevIn);
    prevIn = buffer[i];
    prevOut = value;
    out[i] = value;
  }
  return out;
}

/** Scales so the loudest sample hits `targetPeak`, never scaling up past
 * 1 if the source is already quieter than that -- consistent perceived
 * loudness across a library built from very different generators without
 * ever clipping. */
function normalize(buffer, targetPeak = 0.85) {
  let peak = 0;
  for (const value of buffer) peak = Math.max(peak, Math.abs(value));
  if (peak === 0) return buffer;
  const gain = Math.min(targetPeak / peak, targetPeak / 0.05);
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] * gain;
  return out;
}

/** A few milliseconds of fade at the very start/end -- these are one-shot
 * samples loaded straight into SamplePlayer with no guarantee the app's
 * own envelope/trim always shapes the hard edges, so avoid baking in a
 * click at the buffer boundary itself. */
function fadeEdges(buffer, sampleRate, fadeMs = 4) {
  const fadeSamples = Math.round((fadeMs / 1000) * sampleRate);
  const out = Float32Array.from(buffer);
  for (let i = 0; i < Math.min(fadeSamples, out.length); i++) {
    out[i] *= i / fadeSamples;
    const j = out.length - 1 - i;
    out[j] *= i / fadeSamples;
  }
  return out;
}

function finish(buffer, sampleRate) {
  return normalize(fadeEdges(buffer, sampleRate));
}

// --- WAV encoding (mono, 16-bit PCM -- same shape as src/wavEncoder.ts) --

function encodeWav(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// --- the actual sound designs -------------------------------------------

const sounds = [
  {
    name: "Kick",
    category: "percussion",
    make: () => {
      const tone = oscillator(
        0.18,
        SAMPLE_RATE,
        sweepFreq(150, 45, 0.15),
        sineShape,
      );
      const click = whiteNoise(0.18, SAMPLE_RATE);
      return mix(
        envelope(tone, SAMPLE_RATE, expDecay(0.09)),
        envelope(click, SAMPLE_RATE, (t) => 0.3 * Math.exp(-t / 0.004)),
      );
    },
  },
  {
    name: "Snare",
    category: "percussion",
    make: () => {
      const tone = oscillator(0.16, SAMPLE_RATE, constantFreq(200), sineShape);
      const rattle = onePoleLowpass(
        onePoleHighpass(whiteNoise(0.16, SAMPLE_RATE), 900, SAMPLE_RATE),
        6000,
        SAMPLE_RATE,
      );
      return mix(
        envelope(tone, SAMPLE_RATE, (t) => 0.5 * Math.exp(-t / 0.05)),
        envelope(rattle, SAMPLE_RATE, (t) => 0.8 * Math.exp(-t / 0.08)),
      );
    },
  },
  {
    name: "Hihat Closed",
    category: "percussion",
    make: () => {
      const noise = onePoleHighpass(
        whiteNoise(0.06, SAMPLE_RATE),
        6000,
        SAMPLE_RATE,
      );
      return envelope(noise, SAMPLE_RATE, expDecay(0.018));
    },
  },
  {
    name: "Hihat Open",
    category: "percussion",
    make: () => {
      const noise = onePoleHighpass(
        whiteNoise(0.3, SAMPLE_RATE),
        5500,
        SAMPLE_RATE,
      );
      return envelope(noise, SAMPLE_RATE, expDecay(0.12));
    },
  },
  {
    name: "Clap",
    category: "percussion",
    make: () => {
      const offsets = [0, 0.018, 0.036, 0.06];
      const bursts = offsets.map((offset) =>
        envelope(whiteNoise(0.18, SAMPLE_RATE), SAMPLE_RATE, (t) =>
          t >= offset ? Math.exp(-(t - offset) / 0.02) : 0,
        ),
      );
      return onePoleHighpass(mix(...bursts), 1000, SAMPLE_RATE);
    },
  },
  {
    name: "Tom",
    category: "percussion",
    make: () => {
      const tone = oscillator(
        0.35,
        SAMPLE_RATE,
        sweepFreq(200, 75, 0.25),
        sineShape,
      );
      return envelope(tone, SAMPLE_RATE, expDecay(0.15));
    },
  },
  {
    name: "Sub Bass",
    category: "bass",
    make: () => {
      const tone = oscillator(0.6, SAMPLE_RATE, constantFreq(55), sineShape);
      return envelope(
        tone,
        SAMPLE_RATE,
        (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.3),
      );
    },
  },
  {
    name: "Bass Pluck",
    category: "bass",
    make: () => {
      const tone = oscillator(
        0.25,
        SAMPLE_RATE,
        constantFreq(110),
        triangleShape,
      );
      return envelope(tone, SAMPLE_RATE, expDecay(0.08));
    },
  },
  {
    name: "Bass Growl",
    category: "bass",
    make: () => {
      const tone = oscillator(0.65, SAMPLE_RATE, constantFreq(65), sawShape);
      return envelope(
        tone,
        SAMPLE_RATE,
        (t) => (0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t)) * Math.exp(-t / 0.4),
      );
    },
  },
  {
    name: "Square Lead",
    category: "lead",
    make: () => {
      const tone = oscillator(0.3, SAMPLE_RATE, constantFreq(440), squareShape);
      return envelope(
        tone,
        SAMPLE_RATE,
        (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.15),
      );
    },
  },
  {
    name: "Saw Lead",
    category: "lead",
    make: () => {
      const tone = oscillator(
        0.45,
        SAMPLE_RATE,
        constantFreq(523.25),
        sawShape,
      );
      return envelope(
        tone,
        SAMPLE_RATE,
        (t) => Math.min(1, t / 0.015) * Math.exp(-t / 0.25),
      );
    },
  },
  {
    name: "Pluck Lead",
    category: "lead",
    make: () => {
      const tone = oscillator(
        0.18,
        SAMPLE_RATE,
        constantFreq(659.25),
        triangleShape,
      );
      return envelope(tone, SAMPLE_RATE, expDecay(0.05));
    },
  },
  {
    name: "Warm Pad",
    category: "pad",
    make: () => {
      const root = oscillator(1.6, SAMPLE_RATE, constantFreq(220), sineShape);
      const fifth = oscillator(1.6, SAMPLE_RATE, constantFreq(330), sineShape);
      const octave = oscillator(1.6, SAMPLE_RATE, constantFreq(440), sineShape);
      const tone = mix(
        envelope(root, SAMPLE_RATE, () => 0.5),
        envelope(fifth, SAMPLE_RATE, () => 0.3),
        envelope(octave, SAMPLE_RATE, () => 0.2),
      );
      return envelope(
        tone,
        SAMPLE_RATE,
        (t) => Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - 0.25) / 1.0),
      );
    },
  },
  {
    name: "Airy Pad",
    category: "pad",
    make: () => {
      const air = onePoleLowpass(
        whiteNoise(1.6, SAMPLE_RATE),
        900,
        SAMPLE_RATE,
      );
      const tone = oscillator(1.6, SAMPLE_RATE, constantFreq(220), sineShape);
      const mixed = mix(
        envelope(air, SAMPLE_RATE, () => 0.6),
        envelope(tone, SAMPLE_RATE, () => 0.3),
      );
      return envelope(
        mixed,
        SAMPLE_RATE,
        (t) => Math.min(1, t / 0.3) * Math.exp(-Math.max(0, t - 0.3) / 1.0),
      );
    },
  },
  {
    name: "Riser",
    category: "fx",
    make: () => {
      const tone = oscillator(
        1.0,
        SAMPLE_RATE,
        sweepFreq(200, 2000, 1.0),
        sineShape,
      );
      const noise = onePoleLowpass(
        whiteNoise(1.0, SAMPLE_RATE),
        3000,
        SAMPLE_RATE,
      );
      const mixed = mix(
        envelope(tone, SAMPLE_RATE, () => 0.7),
        envelope(noise, SAMPLE_RATE, () => 0.3),
      );
      return envelope(mixed, SAMPLE_RATE, (t) => Math.min(1, t / 1.0));
    },
  },
  {
    name: "Downer",
    category: "fx",
    make: () => {
      const tone = oscillator(
        0.8,
        SAMPLE_RATE,
        sweepFreq(800, 40, 0.8),
        sawShape,
      );
      return envelope(tone, SAMPLE_RATE, expDecay(0.35));
    },
  },
  {
    name: "Zap",
    category: "fx",
    make: () => {
      const tone = oscillator(
        0.12,
        SAMPLE_RATE,
        sweepFreq(1200, 80, 0.08),
        squareShape,
      );
      return envelope(tone, SAMPLE_RATE, expDecay(0.03));
    },
  },
  {
    name: "Noise Burst",
    category: "other",
    make: () => {
      const noise = onePoleLowpass(
        whiteNoise(0.3, SAMPLE_RATE),
        4000,
        SAMPLE_RATE,
      );
      return envelope(noise, SAMPLE_RATE, expDecay(0.12));
    },
  },
];

// --- upload ---------------------------------------------------------------

async function uploadSample(name, category, samples) {
  const blob = encodeWav(finish(samples, SAMPLE_RATE), SAMPLE_RATE);
  const formData = new FormData();
  formData.append("audio", blob, `${name}.wav`);
  formData.append("name", name);
  formData.append("category", category);
  const response = await fetch(`${backendUrl}/api/samples`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(
      `Upload failed for "${name}": ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

for (const sound of sounds) {
  const result = await uploadSample(sound.name, sound.category, sound.make());
  console.log(`uploaded: ${sound.category} — ${sound.name} (${result.id})`);
}

console.log(`\nDone: ${sounds.length} samples uploaded to ${backendUrl}.`);
