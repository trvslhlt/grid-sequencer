import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  type EffectChainPreset,
  deleteEffectChainPreset,
  listEffectChainPresets,
  readEffectChainPreset,
  writeEffectChainPreset,
} from "../effectChainPresetStore.js";

export const effectChainPresetsRouter = Router();

effectChainPresetsRouter.get("/", async (_req, res) => {
  const presets = await listEffectChainPresets();
  res.json({ presets });
});

effectChainPresetsRouter.get("/:id", async (req, res) => {
  const preset = await readEffectChainPreset(req.params.id);
  if (!preset) {
    res.status(404).json({ error: "Effect chain preset not found" });
    return;
  }
  res.json(preset);
});

effectChainPresetsRouter.post("/", async (req, res) => {
  const body = req.body as Partial<EffectChainPreset>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || !Array.isArray(body.effects)) {
    res.status(400).json({ error: "Missing name or effects" });
    return;
  }

  const preset: EffectChainPreset = {
    id: randomUUID(),
    name,
    effects: body.effects,
    createdAt: new Date().toISOString(),
  };

  await writeEffectChainPreset(preset);
  res.status(201).json(preset);
});

effectChainPresetsRouter.patch("/:id", async (req, res) => {
  const existing = await readEffectChainPreset(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Effect chain preset not found" });
    return;
  }

  const body = req.body as Partial<EffectChainPreset>;
  const updated: EffectChainPreset = {
    ...existing,
    name:
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : existing.name,
    effects: Array.isArray(body.effects) ? body.effects : existing.effects,
  };

  await writeEffectChainPreset(updated);
  res.json(updated);
});

effectChainPresetsRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteEffectChainPreset(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Effect chain preset not found" });
    return;
  }
  // 200 + a body, not 204 -- see samples.ts's DELETE handler for why.
  res.status(200).json({ deleted: true });
});
