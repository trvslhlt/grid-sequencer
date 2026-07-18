/** Uploads real audio files from assets/base-samples/ (see that
 * directory's own README for the folder-per-category convention) to the
 * backend's sample library -- unlike scripts/seed-sample-library.mjs's
 * procedurally synthesized set, these files are git-tracked source
 * assets, not generated at runtime, so they survive a
 * `rm -rf backend/samples` dev/test reset the same way any other source
 * file does; this script just re-populates the running backend from them.
 *
 * Idempotent by name+category (checks the target backend's existing
 * library first, skips anything already there) -- safe to run after
 * every reset without piling up duplicates, unlike seed-sample-library.mjs's
 * own "each run just adds another copy" behavior.
 *
 * Pure Node, no browser and no npm dependencies: reads each file's raw
 * bytes and POSTs them with fetch's native FormData/Blob, same as
 * seed-sample-library.mjs and src/patchApi.ts's uploadSample.
 *
 * Usage: node scripts/seed-base-samples.mjs [backendUrl]
 * (backendUrl defaults to http://localhost:3002, the host-mapped port
 * from docker-compose.yml)
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseSamplesDir = path.join(__dirname, "..", "assets", "base-samples");
const backendUrl = process.argv[2] ?? "http://localhost:3002";

// Mirrors backend/src/routes/samples.ts's own EXTENSION_BY_MIME_TYPE,
// reversed -- the backend derives the stored file's extension from
// whatever Content-Type this script sends, not from the source
// filename, so getting this mapping right matters for playback.
const MIME_TYPE_BY_EXTENSION = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
};

async function findAudioFiles() {
  const categories = await readdir(baseSamplesDir, { withFileTypes: true });
  const files = [];
  for (const entry of categories) {
    if (!entry.isDirectory()) continue;
    const category = entry.name;
    const categoryDir = path.join(baseSamplesDir, category);
    for (const filename of await readdir(categoryDir)) {
      const ext = path.extname(filename).toLowerCase();
      const mimeType = MIME_TYPE_BY_EXTENSION[ext];
      if (!mimeType) continue; // skips .gitkeep and any unsupported format
      files.push({
        category,
        name: path.basename(filename, ext),
        filePath: path.join(categoryDir, filename),
        mimeType,
      });
    }
  }
  return files;
}

async function fetchExistingNames() {
  const response = await fetch(`${backendUrl}/api/samples`);
  if (!response.ok) {
    throw new Error(`Failed to list existing samples: ${response.status}`);
  }
  const body = await response.json();
  return new Set(body.samples.map((s) => `${s.category}::${s.name}`));
}

async function uploadSample({ category, name, filePath, mimeType }) {
  const data = await readFile(filePath);
  const formData = new FormData();
  formData.append("audio", new Blob([data], { type: mimeType }), name);
  formData.append("name", name);
  formData.append("category", category);
  const response = await fetch(`${backendUrl}/api/samples`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(
      `Upload failed for "${name}": ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

const files = await findAudioFiles();
if (files.length === 0) {
  console.log(
    `No audio files found in ${baseSamplesDir} -- see its README for the folder-per-category convention.`,
  );
  process.exit(0);
}

const existing = await fetchExistingNames();
let uploaded = 0;
let skipped = 0;
for (const file of files) {
  const key = `${file.category}::${file.name}`;
  if (existing.has(key)) {
    console.log(`skipped (already present): ${file.category} — ${file.name}`);
    skipped++;
    continue;
  }
  const result = await uploadSample(file);
  console.log(`uploaded: ${file.category} — ${file.name} (${result.id})`);
  uploaded++;
}

console.log(
  `\nDone: ${uploaded} uploaded, ${skipped} already present, ${files.length} total in assets/base-samples/.`,
);
