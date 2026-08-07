import { promises as fs } from "node:fs";
import path from "node:path";

/** Generic CRUD over a directory of `<id>.json` files -- the exact shape
 * instrumentPresetStore.ts and effectChainPresetStore.ts both hand-rolled
 * identically (only their directory and record type differed). Every
 * record must at least have an `id`, used as its filename; every other
 * field is entirely up to the caller. Not used by patchStore.ts or
 * sampleStore.ts -- both have genuinely different shapes on top of this
 * same idea (patchStore also projects a name-searchable summary list;
 * sampleStore also manages a binary audio file per record) -- but either
 * could still build on this for its own low-level read/write/list/delete
 * if that duplication ever becomes worth collapsing too. */
export interface JsonRecordStore<T extends { id: string }> {
  ensureDir(): Promise<void>;
  list(): Promise<T[]>;
  read(id: string): Promise<T | null>;
  write(record: T): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export function createJsonRecordStore<T extends { id: string }>(
  dir: string,
): JsonRecordStore<T> {
  function filePath(id: string): string {
    return path.join(dir, `${id}.json`);
  }

  async function ensureDir(): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  async function read(id: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath(id), "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function list(): Promise<T[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const records: T[] = [];
    for (const entryName of entries) {
      if (!entryName.endsWith(".json")) continue;
      const id = entryName.slice(0, -".json".length);
      const record = await read(id);
      if (record) records.push(record);
    }
    return records;
  }

  async function write(record: T): Promise<void> {
    await fs.writeFile(filePath(record.id), JSON.stringify(record, null, 2));
  }

  async function remove(id: string): Promise<boolean> {
    try {
      await fs.unlink(filePath(id));
      return true;
    } catch {
      return false;
    }
  }

  return { ensureDir, list, read, write, remove };
}
