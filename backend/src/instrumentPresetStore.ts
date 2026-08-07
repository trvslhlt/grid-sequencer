import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonRecordStore } from "./jsonRecordStore.js";

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

const store = createJsonRecordStore<InstrumentPreset>(INSTRUMENT_PRESETS_DIR);

export const ensureInstrumentPresetsDir = store.ensureDir;
export const listInstrumentPresets = store.list;
export const readInstrumentPreset = store.read;
export const writeInstrumentPreset = store.write;
export const deleteInstrumentPreset = store.remove;
