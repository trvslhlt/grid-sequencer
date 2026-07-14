/** Thin fetch wrappers around the backend's /api/patches and /api/samples
 * routes (see backend/src/routes/) -- kept dumb and typed loosely on
 * purpose, mirroring the backend's own opaque storage of envelope/effects/
 * cells/sourceParams (see patchStore.ts's doc comment): this module never
 * inspects those shapes, just passes them through. */

import { encodeWav } from "./wavEncoder";

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
  scaleRoot: number;
  scaleType:
    | "chromatic"
    | "major"
    | "naturalMinor"
    | "harmonicMinor"
    | "dorian"
    | "majorPentatonic"
    | "minorPentatonic";
  columns: unknown[];
  masterGain: number;
  masterEffects: unknown[];
  limiterCeiling: number;
  limiterRelease: number;
  reverbDecaySeconds: number;
  reverbPreDelayMs: number;
  reverbDampingHz: number;
  rows: PatchRow[];
}

export interface SampleMetadata {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
  category: string;
}

/** A curated preset list -- the backend itself doesn't enforce these (see
 * sampleStore.ts's doc comment), this is purely for a consistent picker
 * UI rather than every upload inventing its own category spelling. */
export const SAMPLE_CATEGORIES = [
  "percussion",
  "bass",
  "lead",
  "pad",
  "fx",
  "other",
] as const;

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

export async function uploadSample(
  buffer: AudioBuffer,
  name: string,
  category = "uncategorized",
): Promise<SampleMetadata> {
  const formData = new FormData();
  formData.append("audio", encodeWav(buffer), `${name}.wav`);
  formData.append("name", name);
  formData.append("category", category);
  const response = await fetch("/api/samples", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error("Failed to upload sample");
  return response.json();
}

export async function listSamples(): Promise<SampleMetadata[]> {
  const response = await fetch("/api/samples");
  const body: { samples: SampleMetadata[] } = await response.json();
  return body.samples;
}

export async function fetchSampleAudio(id: string): Promise<ArrayBuffer> {
  const response = await fetch(`/api/samples/${id}/audio`);
  if (!response.ok) throw new Error(`Failed to fetch sample ${id}`);
  return response.arrayBuffer();
}

export async function updateSample(
  id: string,
  patch: { name?: string; category?: string },
): Promise<SampleMetadata> {
  const response = await fetch(`/api/samples/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Failed to update sample ${id}`);
  return response.json();
}

export async function deleteSample(id: string): Promise<void> {
  const response = await fetch(`/api/samples/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Failed to delete sample ${id}`);
}

/** A saved instrument sound -- source type + that source's own params +
 * envelope shape, kept just as opaque here as the backend's own store
 * (see instrumentPresetStore.ts's doc comment): this module never
 * inspects sourceParams/envelope internals, just passes them through. */
export interface InstrumentPreset {
  id: string;
  name: string;
  sourceType: string;
  sourceParams: Record<string, unknown>;
  envelope: unknown;
  createdAt: string;
}

export async function listInstrumentPresets(): Promise<InstrumentPreset[]> {
  const response = await fetch("/api/instrument-presets");
  const body: { presets: InstrumentPreset[] } = await response.json();
  return body.presets;
}

export async function createInstrumentPreset(preset: {
  name: string;
  sourceType: string;
  sourceParams: Record<string, unknown>;
  envelope: unknown;
}): Promise<InstrumentPreset> {
  const response = await fetch("/api/instrument-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preset),
  });
  if (!response.ok) throw new Error("Failed to save instrument preset");
  return response.json();
}

export async function updateInstrumentPreset(
  id: string,
  patch: {
    name?: string;
    sourceParams?: Record<string, unknown>;
    envelope?: unknown;
  },
): Promise<InstrumentPreset> {
  const response = await fetch(`/api/instrument-presets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Failed to update preset ${id}`);
  return response.json();
}

export async function deleteInstrumentPreset(id: string): Promise<void> {
  const response = await fetch(`/api/instrument-presets/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Failed to delete preset ${id}`);
}

/** A saved, ordered effect chain -- unlike instrument presets, nothing
 * ties this to a source type or any other context, since effects apply
 * uniformly at the row/cell/master level. `effects` stays opaque here,
 * same reasoning as everywhere else this module never inspects a
 * cascade-config shape's internals. */
export interface EffectChainPreset {
  id: string;
  name: string;
  effects: unknown[];
  createdAt: string;
}

export async function listEffectChainPresets(): Promise<EffectChainPreset[]> {
  const response = await fetch("/api/effect-chain-presets");
  const body: { presets: EffectChainPreset[] } = await response.json();
  return body.presets;
}

export async function createEffectChainPreset(preset: {
  name: string;
  effects: unknown[];
}): Promise<EffectChainPreset> {
  const response = await fetch("/api/effect-chain-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preset),
  });
  if (!response.ok) throw new Error("Failed to save effect chain preset");
  return response.json();
}

export async function updateEffectChainPreset(
  id: string,
  patch: { name?: string; effects?: unknown[] },
): Promise<EffectChainPreset> {
  const response = await fetch(`/api/effect-chain-presets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok)
    throw new Error(`Failed to update effect chain preset ${id}`);
  return response.json();
}

export async function deleteEffectChainPreset(id: string): Promise<void> {
  const response = await fetch(`/api/effect-chain-presets/${id}`, {
    method: "DELETE",
  });
  if (!response.ok)
    throw new Error(`Failed to delete effect chain preset ${id}`);
}
