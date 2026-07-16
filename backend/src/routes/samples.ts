import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { Router } from "express";
import multer from "multer";
import {
  deleteSample,
  findSampleFile,
  listSamples,
  reverseSampleAudio,
  updateSampleMetadata,
  writeSample,
} from "../sampleStore.js";

// Only used at upload time, to name the file written to disk -- playback
// reads the mimeType/filename straight back out of the sidecar, so this
// mapping never needs to be consulted in reverse.
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
};

const upload = multer({ storage: multer.memoryStorage() });

export const samplesRouter = Router();

samplesRouter.get("/", async (_req, res) => {
  const samples = await listSamples();
  res.json({ samples });
});

samplesRouter.get("/:id/audio", async (req, res) => {
  const file = await findSampleFile(req.params.id);
  if (!file) {
    res.status(404).json({ error: "Sample not found" });
    return;
  }
  res.type(file.mimeType);
  createReadStream(file.filePath).pipe(res);
});

samplesRouter.post("/", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Missing audio file" });
    return;
  }

  const extension = EXTENSION_BY_MIME_TYPE[req.file.mimetype] ?? ".bin";
  const id = randomUUID();
  const filename = `${id}${extension}`;
  const name =
    typeof req.body.name === "string" && req.body.name.trim()
      ? req.body.name.trim()
      : `Sample ${new Date().toLocaleTimeString()}`;
  const category =
    typeof req.body.category === "string" && req.body.category.trim()
      ? req.body.category.trim()
      : "uncategorized";
  const createdAt = new Date().toISOString();

  await writeSample(id, filename, req.file.buffer, {
    name,
    filename,
    mimeType: req.file.mimetype,
    createdAt,
    category,
  });

  res
    .status(201)
    .json({ id, name, mimeType: req.file.mimetype, createdAt, category });
});

samplesRouter.patch("/:id", async (req, res) => {
  const updated = await updateSampleMetadata(req.params.id, {
    name: typeof req.body.name === "string" ? req.body.name : undefined,
    category:
      typeof req.body.category === "string" ? req.body.category : undefined,
  });
  if (!updated) {
    res.status(404).json({ error: "Sample not found" });
    return;
  }
  res.json(updated);
});

samplesRouter.post("/:id/reverse", async (req, res) => {
  try {
    const updated = await reverseSampleAudio(req.params.id);
    if (!updated) {
      res.status(404).json({ error: "Sample not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    // Only reachable if a sample's stored file somehow isn't the 16-bit
    // PCM WAV shape every upload path in this app produces -- see
    // sampleStore.ts's reverseWavPcm16InPlace doc.
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to reverse sample",
    });
  }
});

samplesRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteSample(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Sample not found" });
    return;
  }
  // 200 + a body, not 204 -- an empty-body response through Vite's dev
  // proxy was intermittently reported client-side as net::ERR_ABORTED
  // even though the delete had already succeeded server-side.
  res.status(200).json({ deleted: true });
});
