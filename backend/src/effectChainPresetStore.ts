import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EFFECT_CHAIN_PRESETS_DIR = path.join(
  __dirname,
  "..",
  "effectChainPresets",
);

/** A saved, ordered effect chain -- unlike instrument presets, nothing
 * ties this to a source type or any other context, since effects apply
 * uniformly at the row/cell/master level. `effects` is opaque here, same
 * reasoning as PatchRow.effects in patchStore.ts: this store never
 * inspects its internals, just round-trips it. */
export interface EffectChainPreset {
  id: string;
  name: string;
  effects: unknown[];
  createdAt: string;
}

export async function ensureEffectChainPresetsDir(): Promise<void> {
  await fs.mkdir(EFFECT_CHAIN_PRESETS_DIR, { recursive: true });
}

async function readPresetFile(id: string): Promise<EffectChainPreset | null> {
  try {
    const raw = await fs.readFile(
      path.join(EFFECT_CHAIN_PRESETS_DIR, `${id}.json`),
      "utf-8",
    );
    return JSON.parse(raw) as EffectChainPreset;
  } catch {
    return null;
  }
}

export async function listEffectChainPresets(): Promise<EffectChainPreset[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(EFFECT_CHAIN_PRESETS_DIR);
  } catch {
    return [];
  }

  const presets: EffectChainPreset[] = [];
  for (const entryName of entries) {
    if (!entryName.endsWith(".json")) continue;
    const id = entryName.slice(0, -".json".length);
    const preset = await readPresetFile(id);
    if (preset) presets.push(preset);
  }
  return presets;
}

export async function readEffectChainPreset(
  id: string,
): Promise<EffectChainPreset | null> {
  return readPresetFile(id);
}

export async function writeEffectChainPreset(
  preset: EffectChainPreset,
): Promise<void> {
  await fs.writeFile(
    path.join(EFFECT_CHAIN_PRESETS_DIR, `${preset.id}.json`),
    JSON.stringify(preset, null, 2),
  );
}

export async function deleteEffectChainPreset(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(EFFECT_CHAIN_PRESETS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
