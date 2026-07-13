/** Thin fetch wrappers around the backend's /api/patches and /api/samples
 * routes (see backend/src/routes/) -- kept dumb and typed loosely on
 * purpose, mirroring the backend's own opaque storage of envelope/effects/
 * cells/sourceParams (see patchStore.ts's doc comment): this module never
 * inspects those shapes, just passes them through. */

export interface PatchRow {
  name: string;
  sourceType: string;
  enabled: boolean;
  triggerMode: unknown;
  playbackMode: string;
  defaultsOverride: boolean;
  defaultNote: number;
  defaultGain: number;
  defaultTimeShiftSeconds: number;
  envelopeOverride: boolean;
  envelope: unknown;
  effects: unknown[];
  reverbSend: number;
  sampleRange: { start: number; end: number };
  sourceParams: Record<string, unknown>;
  sampleId: string | null;
  cells: unknown[];
}

export interface PatchSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface Patch extends PatchSummary {
  bpm: number;
  subdivision: number;
  columnCount: number;
  precedence: "row" | "column";
  columns: unknown[];
  masterGain: number;
  masterEffects: unknown[];
  limiterCeiling: number;
  limiterRelease: number;
  rows: PatchRow[];
}

export interface SampleMetadata {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
}

/** Thrown by savePatch on a 409 (name already exists -- see existingId,
 * for a caller that wants to retry with overwrite: true) or 403 (the
 * "demo" patch can't be overwritten, existingId is absent). */
export class SaveConflictError extends Error {
  constructor(
    public readonly status: 409 | 403,
    public readonly existingId?: string,
  ) {
    super(
      status === 403
        ? "The demo patch can't be overwritten"
        : "A patch with that name already exists",
    );
  }
}

export async function listPatches(): Promise<PatchSummary[]> {
  const response = await fetch("/api/patches");
  const body: { patches: PatchSummary[] } = await response.json();
  return body.patches;
}

export async function loadPatch(id: string): Promise<Patch> {
  const response = await fetch(`/api/patches/${id}`);
  if (!response.ok) throw new Error(`Failed to load patch ${id}`);
  return response.json();
}

export async function savePatch(
  patch: Omit<Patch, "id" | "createdAt">,
  options: { overwrite?: boolean } = {},
): Promise<Patch> {
  const response = await fetch("/api/patches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, overwrite: options.overwrite ?? false }),
  });
  if (response.status === 409) {
    const body: { existingId: string } = await response.json();
    throw new SaveConflictError(409, body.existingId);
  }
  if (response.status === 403) {
    throw new SaveConflictError(403);
  }
  if (!response.ok) throw new Error("Failed to save patch");
  return response.json();
}

/** mono, 16-bit PCM -- matches every sample source this app actually
 * produces (generateBlipBuffer's synthesized blip, and loaded files are
 * already decoded to an AudioBuffer via decodeAudioData before reaching
 * here, so channel count already collapsed to whatever the source was).
 * AudioBuffer has no native Blob export, so this is the whole reason a
 * hand-rolled encoder is needed at all -- ported from docker_collab's
 * frontend, which solved the identical problem for its own sample
 * uploads. */
function encodeWav(buffer: AudioBuffer): Blob {
  const channelData = buffer.getChannelData(0);
  const dataSize = channelData.length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, text: string): void {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < channelData.length; i++) {
    const clamped = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export async function uploadSample(
  buffer: AudioBuffer,
  name: string,
): Promise<SampleMetadata> {
  const formData = new FormData();
  formData.append("audio", encodeWav(buffer), `${name}.wav`);
  formData.append("name", name);
  const response = await fetch("/api/samples", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error("Failed to upload sample");
  return response.json();
}

export async function fetchSampleAudio(id: string): Promise<ArrayBuffer> {
  const response = await fetch(`/api/samples/${id}/audio`);
  if (!response.ok) throw new Error(`Failed to fetch sample ${id}`);
  return response.arrayBuffer();
}
