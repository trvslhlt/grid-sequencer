import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLES_DIR = path.join(__dirname, "..", "samples");

export interface SampleMetadata {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
  /** Free-form -- the frontend offers a curated preset list (percussion/
   * pad/bass/lead/fx/other) but this store doesn't enforce it, same as it
   * doesn't validate `name`. Defaults to "uncategorized" for samples
   * uploaded before this field existed (readSidecar's fallback below) or
   * whenever a caller omits it. */
  category: string;
}

// The sidecar is the source of truth for a sample's audio filename, same
// reasoning as docker_collab's sampleStore.ts: the file on disk and its
// extension can be anything, without a mimeType <-> extension mapping
// needing to stay in sync in two places.
interface Sidecar {
  name: string;
  filename: string;
  mimeType: string;
  createdAt: string;
  category?: string;
}

export async function ensureSamplesDir(): Promise<void> {
  await fs.mkdir(SAMPLES_DIR, { recursive: true });
}

async function readSidecar(id: string): Promise<Sidecar | null> {
  try {
    const raw = await fs.readFile(
      path.join(SAMPLES_DIR, `${id}.json`),
      "utf-8",
    );
    return JSON.parse(raw) as Sidecar;
  } catch {
    return null;
  }
}

export async function listSamples(): Promise<SampleMetadata[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(SAMPLES_DIR);
  } catch {
    return [];
  }

  const samples: SampleMetadata[] = [];
  for (const entryName of entries) {
    if (!entryName.endsWith(".json")) continue;
    const id = entryName.slice(0, -".json".length);
    const sidecar = await readSidecar(id);
    if (!sidecar) continue;
    samples.push({
      id,
      name: sidecar.name,
      mimeType: sidecar.mimeType,
      createdAt: sidecar.createdAt,
      category: sidecar.category ?? "uncategorized",
    });
  }
  return samples;
}

export async function findSampleFile(
  id: string,
): Promise<{ filePath: string; mimeType: string } | null> {
  const sidecar = await readSidecar(id);
  if (!sidecar) return null;
  return {
    filePath: path.join(SAMPLES_DIR, sidecar.filename),
    mimeType: sidecar.mimeType,
  };
}

export async function writeSample(
  id: string,
  filename: string,
  data: Buffer,
  sidecar: Sidecar,
): Promise<void> {
  await fs.writeFile(path.join(SAMPLES_DIR, filename), data);
  await fs.writeFile(
    path.join(SAMPLES_DIR, `${id}.json`),
    JSON.stringify(sidecar, null, 2),
  );
}

/** Rewrites just the sidecar's name/category -- the audio file itself
 * (and its id/filename) are untouched, same reasoning as this store never
 * needing a mimeType<->extension mapping in reverse. */
export async function updateSampleMetadata(
  id: string,
  patch: { name?: string; category?: string },
): Promise<SampleMetadata | null> {
  const sidecar = await readSidecar(id);
  if (!sidecar) return null;
  const updated: Sidecar = {
    ...sidecar,
    name: patch.name?.trim() || sidecar.name,
    category: patch.category?.trim() || sidecar.category,
  };
  await fs.writeFile(
    path.join(SAMPLES_DIR, `${id}.json`),
    JSON.stringify(updated, null, 2),
  );
  return {
    id,
    name: updated.name,
    mimeType: updated.mimeType,
    createdAt: updated.createdAt,
    category: updated.category ?? "uncategorized",
  };
}

export async function deleteSample(id: string): Promise<boolean> {
  const sidecar = await readSidecar(id);
  if (!sidecar) return false;
  await fs.unlink(path.join(SAMPLES_DIR, sidecar.filename)).catch(() => {});
  await fs.unlink(path.join(SAMPLES_DIR, `${id}.json`)).catch(() => {});
  return true;
}

/** Reverses a WAV file's own `data` chunk in place, one whole frame
 * (all channels' sample for a given instant) at a time so a swap never
 * splits a frame across channels -- every sample this app ever stores is
 * this exact PCM16 shape (see src/wavEncoder.ts and
 * scripts/seed-sample-library.mjs, the only two places that ever write to
 * this store), but chunks are walked properly rather than hardcoding a
 * 44-byte header offset, in case a chunk layout ever grows an extra tag. */
function reverseWavPcm16InPlace(data: Buffer): void {
  if (
    data.length < 12 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Not a WAV file");
  }
  let offset = 12;
  let dataOffset = -1;
  let dataSize = -1;
  let numChannels = 1;
  let bitsPerSample = 16;
  while (offset + 8 <= data.length) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      numChannels = data.readUInt16LE(offset + 10);
      bitsPerSample = data.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  if (dataOffset === -1) throw new Error("WAV file has no data chunk");
  if (bitsPerSample !== 16) {
    throw new Error("Only 16-bit PCM WAV samples can be reversed");
  }

  const frameBytes = 2 * numChannels;
  const frameCount = Math.floor(dataSize / frameBytes);
  for (let i = 0; i < Math.floor(frameCount / 2); i++) {
    const a = dataOffset + i * frameBytes;
    const b = dataOffset + (frameCount - 1 - i) * frameBytes;
    for (let byteOffset = 0; byteOffset < frameBytes; byteOffset++) {
      const tmp = data[a + byteOffset];
      data[a + byteOffset] = data[b + byteOffset];
      data[b + byteOffset] = tmp;
    }
  }
}

/** Permanently, destructively reverses a sample's own stored audio file --
 * unlike updateSampleMetadata, this rewrites the binary itself, in place,
 * same id/filename/mimeType/createdAt. Distinct from (and unrelated to) a
 * row's own non-destructive "Reverse playback" toggle, which flips an
 * already-decoded in-memory buffer and never touches this file. */
export async function reverseSampleAudio(
  id: string,
): Promise<SampleMetadata | null> {
  const sidecar = await readSidecar(id);
  if (!sidecar) return null;
  const filePath = path.join(SAMPLES_DIR, sidecar.filename);
  const data = await fs.readFile(filePath);
  reverseWavPcm16InPlace(data);
  await fs.writeFile(filePath, data);
  return {
    id,
    name: sidecar.name,
    mimeType: sidecar.mimeType,
    createdAt: sidecar.createdAt,
    category: sidecar.category ?? "uncategorized",
  };
}
