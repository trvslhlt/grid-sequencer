import express from "express";
import { ensureEffectChainPresetsDir } from "./effectChainPresetStore.js";
import { ensureInstrumentPresetsDir } from "./instrumentPresetStore.js";
import { ensurePatchesDir } from "./patchStore.js";
import { effectChainPresetsRouter } from "./routes/effectChainPresets.js";
import { instrumentPresetsRouter } from "./routes/instrumentPresets.js";
import { patchesRouter } from "./routes/patches.js";
import { samplesRouter } from "./routes/samples.js";
import { ensureSamplesDir } from "./sampleStore.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3002;

app.use(express.json());
app.use("/api/samples", samplesRouter);
app.use("/api/patches", patchesRouter);
app.use("/api/instrument-presets", instrumentPresetsRouter);
app.use("/api/effect-chain-presets", effectChainPresetsRouter);

async function main() {
  // patches/, samples/, instrumentPresets/, and effectChainPresets/ are
  // gitignored, so a fresh checkout won't have them yet.
  await ensurePatchesDir();
  await ensureSamplesDir();
  await ensureInstrumentPresetsDir();
  await ensureEffectChainPresetsDir();
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

main();
