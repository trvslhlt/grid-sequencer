import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  type InstrumentPreset,
  deleteInstrumentPreset,
  listInstrumentPresets,
  readInstrumentPreset,
  writeInstrumentPreset,
} from "../instrumentPresetStore.js";

export const instrumentPresetsRouter = Router();

instrumentPresetsRouter.get("/", async (_req, res) => {
  const presets = await listInstrumentPresets();
  res.json({ presets });
});

instrumentPresetsRouter.get("/:id", async (req, res) => {
  const preset = await readInstrumentPreset(req.params.id);
  if (!preset) {
    res.status(404).json({ error: "Instrument preset not found" });
    return;
  }
  res.json(preset);
});

instrumentPresetsRouter.post("/", async (req, res) => {
  const body = req.body as Partial<InstrumentPreset>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sourceType =
    typeof body.sourceType === "string" ? body.sourceType.trim() : "";
  if (!name || !sourceType) {
    res.status(400).json({ error: "Missing name or sourceType" });
    return;
  }

  const preset: InstrumentPreset = {
    id: randomUUID(),
    name,
    sourceType,
    sourceParams:
      typeof body.sourceParams === "object" && body.sourceParams !== null
        ? body.sourceParams
        : {},
    envelope: body.envelope ?? null,
    createdAt: new Date().toISOString(),
  };

  await writeInstrumentPreset(preset);
  res.status(201).json(preset);
});

instrumentPresetsRouter.patch("/:id", async (req, res) => {
  const existing = await readInstrumentPreset(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Instrument preset not found" });
    return;
  }

  const body = req.body as Partial<InstrumentPreset>;
  const updated: InstrumentPreset = {
    ...existing,
    name:
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : existing.name,
    sourceParams:
      typeof body.sourceParams === "object" && body.sourceParams !== null
        ? body.sourceParams
        : existing.sourceParams,
    envelope: body.envelope !== undefined ? body.envelope : existing.envelope,
  };

  await writeInstrumentPreset(updated);
  res.json(updated);
});

instrumentPresetsRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteInstrumentPreset(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Instrument preset not found" });
    return;
  }
  // 200 + a body, not 204 -- see samples.ts's DELETE handler for why.
  res.status(200).json({ deleted: true });
});
