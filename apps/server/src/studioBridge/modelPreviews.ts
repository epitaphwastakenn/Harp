// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalRandomInEffect:off globalTimers:off preferSchemaOverJson:off -Blender job folders are plain files read and pruned outside Effect.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";

export const MAX_GLB_BYTES = 30 * 1024 * 1024;
export const MODEL_PREVIEW_FILE = "model.glb";
export const MODEL_PREVIEW_INDEX_FILE = "preview-index.json";
export const MODEL_PREVIEW_ROUTE_PREFIX = "/api/studio/model-previews";
export const JOB_FOLDER_PREFIX = "job-";

const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const FORBIDDEN_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "EXT_meshopt_compression",
  "KHR_meshopt_compression",
]);

export interface GlbInfo {
  readonly sizeBytes: number;
  readonly animationClips: number;
}

export type GlbValidation =
  | { readonly ok: true; readonly info: GlbInfo }
  | { readonly ok: false; readonly reason: string };

const invalid = (reason: string): GlbValidation => ({ ok: false, reason });

const hasExternalUri = (entries: unknown): boolean =>
  Array.isArray(entries) &&
  entries.some((entry) => {
    const uri = (entry as { uri?: unknown } | null)?.uri;
    return uri !== undefined && !(typeof uri === "string" && uri.startsWith("data:"));
  });

/** Checks the binary glTF 2.0 container and what a viewer would need to fetch or decode. */
export const validateGlb = (bytes: Uint8Array): GlbValidation => {
  if (bytes.byteLength > MAX_GLB_BYTES) {
    return invalid(
      `The GLB is ${(bytes.byteLength / 1048576).toFixed(1)} MB; previews are capped at ${MAX_GLB_BYTES / 1048576} MB.`,
    );
  }
  if (bytes.byteLength < 20) return invalid("The GLB is too short to hold a header and a chunk.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return invalid("Not a binary glTF file.");
  if (view.getUint32(4, true) !== 2) return invalid("Only glTF 2.0 is supported.");
  if (view.getUint32(8, true) !== bytes.byteLength) {
    return invalid("The GLB header length does not match the file size.");
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + jsonLength > bytes.byteLength) {
    return invalid("The GLB has no valid JSON chunk first.");
  }
  let json: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return invalid("The GLB JSON chunk is not an object.");
    }
    json = parsed as Record<string, unknown>;
  } catch {
    return invalid("The GLB JSON chunk does not parse.");
  }
  const version = (json.asset as { version?: unknown } | undefined)?.version;
  if (typeof version !== "string" || !version.startsWith("2")) {
    return invalid("The GLB asset version is not 2.0.");
  }
  if (hasExternalUri(json.buffers) || hasExternalUri(json.images)) {
    return invalid("The GLB points at external buffers or images; it must be self-contained.");
  }
  for (const list of [json.extensionsUsed, json.extensionsRequired]) {
    const found = Array.isArray(list) ? list.find((name) => FORBIDDEN_EXTENSIONS.has(name)) : null;
    if (found) return invalid(`The GLB uses ${found}, which the preview cannot decode.`);
  }
  return {
    ok: true,
    info: {
      sizeBytes: bytes.byteLength,
      animationClips: Array.isArray(json.animations) ? json.animations.length : 0,
    },
  };
};

interface IndexedPreview {
  readonly jobDir: string;
}

const previews = new Map<string, IndexedPreview>();

const newPreviewId = () => NodeCrypto.randomBytes(18).toString("base64url");

/** Gives a valid GLB an opaque id, kept in memory and in the job folder so a restart keeps it. */
export const registerModelPreview = (
  jobDir: string,
  input: Omit<ModelPreviewReference, "previewId">,
): ModelPreviewReference => {
  const reference: ModelPreviewReference = { previewId: newPreviewId(), ...input };
  previews.set(reference.previewId, { jobDir });
  try {
    NodeFS.writeFileSync(
      NodePath.join(jobDir, MODEL_PREVIEW_INDEX_FILE),
      JSON.stringify({ version: 1, file: MODEL_PREVIEW_FILE, ...reference }),
    );
  } catch {
    // The in-memory id still works until the next restart.
  }
  return reference;
};

const readIndex = (jobDir: string): { readonly previewId: string } | undefined => {
  try {
    const parsed = JSON.parse(
      NodeFS.readFileSync(NodePath.join(jobDir, MODEL_PREVIEW_INDEX_FILE), "utf8"),
    ) as { previewId?: unknown; file?: unknown };
    return typeof parsed.previewId === "string" &&
      PREVIEW_ID_PATTERN.test(parsed.previewId) &&
      parsed.file === MODEL_PREVIEW_FILE
      ? { previewId: parsed.previewId }
      : undefined;
  } catch {
    return undefined;
  }
};

export interface ResolvedModelPreview {
  readonly path: string;
  readonly sizeBytes: number;
}

const statGlb = (jobDir: string): ResolvedModelPreview | undefined => {
  const path = NodePath.join(jobDir, MODEL_PREVIEW_FILE);
  try {
    const stat = NodeFS.statSync(path);
    return stat.isFile() && stat.size <= MAX_GLB_BYTES ? { path, sizeBytes: stat.size } : undefined;
  } catch {
    return undefined;
  }
};

/** Never trusts a path from the caller: the id selects a job folder Harp itself created. */
export const resolveModelPreview = (
  jobsRoot: string,
  previewId: string,
): ResolvedModelPreview | undefined => {
  if (!PREVIEW_ID_PATTERN.test(previewId)) return undefined;
  const known = previews.get(previewId);
  if (known !== undefined) {
    const resolved = statGlb(known.jobDir);
    if (resolved !== undefined) return resolved;
    previews.delete(previewId);
  }
  let names: string[];
  try {
    names = NodeFS.readdirSync(jobsRoot);
  } catch {
    return undefined;
  }
  for (const name of names) {
    if (!name.startsWith(JOB_FOLDER_PREFIX)) continue;
    const jobDir = NodePath.join(jobsRoot, name);
    if (readIndex(jobDir)?.previewId !== previewId) continue;
    const resolved = statGlb(jobDir);
    if (resolved === undefined) return undefined;
    previews.set(previewId, { jobDir });
    return resolved;
  }
  return undefined;
};

export const JOB_KEEP_NEWEST = 40;
export const JOB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Removes job folders that are both beyond the newest ones and older than the age limit. */
export const pruneJobFolders = (
  jobsRoot: string,
  now: number,
  options: { readonly protect?: ReadonlyArray<string> } = {},
): number => {
  let names: string[];
  try {
    names = NodeFS.readdirSync(jobsRoot).filter((name) => name.startsWith(JOB_FOLDER_PREFIX));
  } catch {
    return 0;
  }
  const protectedDirs = new Set((options.protect ?? []).map((dir) => NodePath.resolve(dir)));
  const entries = names.flatMap((name) => {
    const dir = NodePath.join(jobsRoot, name);
    try {
      const stat = NodeFS.statSync(dir);
      return stat.isDirectory() ? [{ dir, modified: stat.mtimeMs }] : [];
    } catch {
      return [];
    }
  });
  entries.sort((left, right) => right.modified - left.modified);
  let removed = 0;
  for (const entry of entries.slice(JOB_KEEP_NEWEST)) {
    if (now - entry.modified < JOB_MAX_AGE_MS || protectedDirs.has(NodePath.resolve(entry.dir))) {
      continue;
    }
    try {
      NodeFS.rmSync(entry.dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      // A locked folder is retried by the next job.
    }
  }
  for (const [id, preview] of previews) {
    if (!NodeFS.existsSync(preview.jobDir)) previews.delete(id);
  }
  return removed;
};
