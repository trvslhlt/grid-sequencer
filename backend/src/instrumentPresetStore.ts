import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const INSTRUMENT_PRESETS_DIR = path.join(
  __dirname,
  "..",
  "instrumentPresets",
);

/** A saved instrument sound -- source type + that source's own params +
 * envelope shape, deliberately not the effects chain/reverb send/trigger
 * mode (those are more about how a row sits in a specific patch than what
 * the instrument itself sounds like). Opaque `sourceParams`/`envelope`
 * here, same reasoning as PatchRow's own fields in patchStore.ts: this
 * store never inspects their internals, just round-trips them. */
export interface InstrumentPreset {
  id: string;
  name: string;
  sourceType: string;
  sourceParams: Record<string, unknown>;
  envelope: unknown;
  createdAt: string;
}

export async function ensureInstrumentPresetsDir(): Promise<void> {
  await fs.mkdir(INSTRUMENT_PRESETS_DIR, { recursive: true });
}

async function readPresetFile(id: string): Promise<InstrumentPreset | null> {
  try {
    const raw = await fs.readFile(
      path.join(INSTRUMENT_PRESETS_DIR, `${id}.json`),
      "utf-8",
    );
    return JSON.parse(raw) as InstrumentPreset;
  } catch {
    return null;
  }
}

export async function listInstrumentPresets(): Promise<InstrumentPreset[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(INSTRUMENT_PRESETS_DIR);
  } catch {
    return [];
  }

  const presets: InstrumentPreset[] = [];
  for (const entryName of entries) {
    if (!entryName.endsWith(".json")) continue;
    const id = entryName.slice(0, -".json".length);
    const preset = await readPresetFile(id);
    if (preset) presets.push(preset);
  }
  return presets;
}

export async function readInstrumentPreset(
  id: string,
): Promise<InstrumentPreset | null> {
  return readPresetFile(id);
}

export async function writeInstrumentPreset(
  preset: InstrumentPreset,
): Promise<void> {
  await fs.writeFile(
    path.join(INSTRUMENT_PRESETS_DIR, `${preset.id}.json`),
    JSON.stringify(preset, null, 2),
  );
}

export async function deleteInstrumentPreset(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(INSTRUMENT_PRESETS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
