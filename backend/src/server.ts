import express from "express";
import { ensurePatchesDir } from "./patchStore.js";
import { patchesRouter } from "./routes/patches.js";
import { samplesRouter } from "./routes/samples.js";
import { ensureSamplesDir } from "./sampleStore.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3002;

app.use(express.json());
app.use("/api/samples", samplesRouter);
app.use("/api/patches", patchesRouter);

async function main() {
  // patches/ and samples/ are gitignored, so a fresh checkout won't have
  // them yet.
  await ensurePatchesDir();
  await ensureSamplesDir();
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

main();
