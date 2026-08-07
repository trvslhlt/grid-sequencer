import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonRecordStore } from "./jsonRecordStore.js";

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

const store = createJsonRecordStore<EffectChainPreset>(
  EFFECT_CHAIN_PRESETS_DIR,
);

export const ensureEffectChainPresetsDir = store.ensureDir;
export const listEffectChainPresets = store.list;
export const readEffectChainPreset = store.read;
export const writeEffectChainPreset = store.write;
export const deleteEffectChainPreset = store.remove;
