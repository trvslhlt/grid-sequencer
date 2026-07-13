import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  type Patch,
  type PatchRow,
  findPatchByName,
  listPatches,
  readPatch,
  writePatch,
} from "../patchStore.js";

export const patchesRouter = Router();

/** The one patch name a save request can never touch once it exists --
 * the frontend's own first-ever-boot seeding is what creates it (a normal
 * save through this same route, before any "demo" patch exists yet), not
 * anything special on this side. */
const PROTECTED_NAME = "demo";

/** Mirrors the frontend's ScaleType (src/grid/scale.ts) -- validated here,
 * unlike most of this store's opaque fields, because an unrecognized
 * value would crash the frontend's quantizeToScale (an unknown key's
 * `SCALE_INTERVALS[scaleType]` lookup is undefined), same reasoning as
 * `precedence` being validated just below. */
const VALID_SCALE_TYPES = new Set([
  "chromatic",
  "major",
  "naturalMinor",
  "harmonicMinor",
  "dorian",
  "majorPentatonic",
  "minorPentatonic",
]);

patchesRouter.get("/", async (_req, res) => {
  const patches = await listPatches();
  res.json({ patches });
});

patchesRouter.get("/:id", async (req, res) => {
  const patch = await readPatch(req.params.id);
  if (!patch) {
    res.status(404).json({ error: "Patch not found" });
    return;
  }
  res.json(patch);
});

patchesRouter.post("/", async (req, res) => {
  const body = req.body as Partial<Patch> & { overwrite?: boolean };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Missing name" });
    return;
  }
  if (!Array.isArray(body.rows)) {
    res.status(400).json({ error: "Missing rows" });
    return;
  }

  const existing = await findPatchByName(name);

  if (name === PROTECTED_NAME && existing) {
    res.status(403).json({ error: "The demo patch can't be overwritten" });
    return;
  }
  if (existing && body.overwrite !== true) {
    res.status(409).json({ error: "exists", existingId: existing.id });
    return;
  }

  const patch: Patch = {
    id: existing?.id ?? randomUUID(),
    name,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    bpm: body.bpm ?? 120,
    subdivision: body.subdivision ?? 4,
    columnCount: body.columnCount ?? 8,
    precedence: body.precedence === "column" ? "column" : "row",
    scaleRoot:
      Number.isInteger(body.scaleRoot) &&
      (body.scaleRoot as number) >= 0 &&
      (body.scaleRoot as number) <= 11
        ? (body.scaleRoot as number)
        : 0,
    scaleType: VALID_SCALE_TYPES.has(body.scaleType as string)
      ? (body.scaleType as string)
      : "chromatic",
    columns: body.columns ?? [],
    masterGain: body.masterGain ?? 1,
    masterEffects: body.masterEffects ?? [],
    limiterCeiling: body.limiterCeiling ?? -1,
    limiterRelease: body.limiterRelease ?? 0.1,
    rows: body.rows as PatchRow[],
  };

  await writePatch(patch);
  res.status(201).json(patch);
});
