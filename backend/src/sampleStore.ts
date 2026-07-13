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
