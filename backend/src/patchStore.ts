import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PATCHES_DIR = path.join(__dirname, "..", "patches");

/** A single row's own config -- most fields typed loosely/opaquely, since
 * this store never inspects envelope/effects/cells/sourceParams
 * internals, just round-trips them (the frontend owns those shapes, which
 * have already changed more than once this project). */
export interface PatchRow {
  name: string;
  sourceType: string;
  enabled: boolean;
  triggerMode: unknown;
  playbackMode: string;
  defaultsOverride: boolean;
  defaultNote: number;
  defaultGain: number;
  defaultTimeShiftSeconds: number;
  envelopeOverride: boolean;
  envelope: unknown;
  effects: unknown[];
  reverbSend: number;
  sampleRange: { start: number; end: number };
  /** Per-source-type params (waveform/detune/harmonicity/etc, see
   * sourceFactory.ts's RowSource.getParams()) -- opaque here too. */
  sourceParams: Record<string, unknown>;
  /** References a stored sample (see sampleStore.ts) -- null for rows with
   * no sample loaded, or source types that don't use one at all. */
  sampleId: string | null;
  cells: unknown[];
}

export interface PatchSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface Patch extends PatchSummary {
  bpm: number;
  subdivision: number;
  columnCount: number;
  precedence: "row" | "column";
  /** A global constraint above the row/column/cell cascade (see the
   * frontend's src/grid/scale.ts) -- opaque here too, same reasoning as
   * everything else this store never inspects, just round-trips.
   * scaleRoot is 0-11 (C=0). */
  scaleRoot: number;
  scaleType: string;
  columns: unknown[];
  masterGain: number;
  masterEffects: unknown[];
  limiterCeiling: number;
  limiterRelease: number;
  reverbDecaySeconds: number;
  reverbPreDelayMs: number;
  reverbDampingHz: number;
  rows: PatchRow[];
}

export async function ensurePatchesDir(): Promise<void> {
  await fs.mkdir(PATCHES_DIR, { recursive: true });
}

async function readPatchFile(id: string): Promise<Patch | null> {
  try {
    const raw = await fs.readFile(
      path.join(PATCHES_DIR, `${id}.json`),
      "utf-8",
    );
    return JSON.parse(raw) as Patch;
  } catch {
    return null;
  }
}

export async function listPatches(): Promise<PatchSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(PATCHES_DIR);
  } catch {
    return [];
  }

  const patches: PatchSummary[] = [];
  for (const entryName of entries) {
    if (!entryName.endsWith(".json")) continue;
    const id = entryName.slice(0, -".json".length);
    const patch = await readPatchFile(id);
    if (!patch) continue;
    patches.push({
      id: patch.id,
      name: patch.name,
      createdAt: patch.createdAt,
    });
  }
  return patches;
}

export async function readPatch(id: string): Promise<Patch | null> {
  return readPatchFile(id);
}

/** Case-sensitive exact match on name -- the uniqueness key the frontend's
 * save flow (and the "demo" protection in routes/patches.ts) checks
 * against, distinct from the opaque `id` every patch is actually keyed by
 * on disk. */
export async function findPatchByName(name: string): Promise<Patch | null> {
  const summaries = await listPatches();
  const match = summaries.find((s) => s.name === name);
  if (!match) return null;
  return readPatchFile(match.id);
}

export async function writePatch(patch: Patch): Promise<void> {
  await fs.writeFile(
    path.join(PATCHES_DIR, `${patch.id}.json`),
    JSON.stringify(patch, null, 2),
  );
}
