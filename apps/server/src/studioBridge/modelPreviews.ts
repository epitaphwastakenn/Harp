// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalDate:off globalRandomInEffect:off globalRandom:off globalTimers:off preferSchemaOverJson:off -Blender job folders are plain files read and pruned outside Effect.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";

export const MAX_GLB_BYTES = 30 * 1024 * 1024;
export const MODEL_PREVIEW_FILE = "model.glb";
export const MODEL_PREVIEW_INDEX_FILE = "preview-index.json";
export const MODEL_PREVIEW_ROUTE_PREFIX = "/api/studio/model-previews";
export const JOB_FOLDER_PREFIX = "job-";

export const jobFolderName = (now: number) =>
  `${JOB_FOLDER_PREFIX}${new Date(now).toISOString().replace(/[:.]/gu, "-")}-${Math.random().toString(36).slice(2, 7)}`;

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

const invalid = (reason: string) => ({ ok: false, reason }) as const;

const hasExternalUri = (entries: unknown): boolean =>
  Array.isArray(entries) &&
  entries.some((entry) => {
    const uri = (entry as { uri?: unknown } | null)?.uri;
    return uri !== undefined && !(typeof uri === "string" && uri.startsWith("data:"));
  });

type GlbJson =
  | { readonly ok: true; readonly json: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

const readGlbJson = (bytes: Uint8Array): GlbJson => {
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
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return invalid("The GLB JSON chunk is not an object.");
    }
    return { ok: true, json: parsed as Record<string, unknown> };
  } catch {
    return invalid("The GLB JSON chunk does not parse.");
  }
};

/** Checks the binary glTF 2.0 container and what a viewer would need to fetch or decode. */
export const validateGlb = (bytes: Uint8Array): GlbValidation => {
  if (bytes.byteLength > MAX_GLB_BYTES) {
    return invalid(
      `The GLB is ${(bytes.byteLength / 1048576).toFixed(1)} MB; previews are capped at ${MAX_GLB_BYTES / 1048576} MB.`,
    );
  }
  const parsed = readGlbJson(bytes);
  if (!parsed.ok) return parsed;
  const json = parsed.json;
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

interface GlbStats {
  readonly triangles: number;
  readonly dimensions: readonly [number, number, number];
}

type Matrix = ReadonlyArray<number>;

const identityMatrix: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const multiply = (left: Matrix, right: Matrix): Matrix =>
  Array.from({ length: 16 }, (_, cell) => {
    const column = Math.floor(cell / 4);
    const row = cell % 4;
    let sum = 0;
    for (let k = 0; k < 4; k += 1) sum += left[k * 4 + row]! * right[column * 4 + k]!;
    return sum;
  });

const finiteList = (value: unknown, length: number): ReadonlyArray<number> | undefined =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? (value as ReadonlyArray<number>)
    : undefined;

const localMatrix = (node: Record<string, unknown>): Matrix => {
  const matrix = finiteList(node.matrix, 16);
  if (matrix !== undefined) return matrix;
  const [tx = 0, ty = 0, tz = 0] = finiteList(node.translation, 3) ?? [];
  const [x = 0, y = 0, z = 0, w = 1] = finiteList(node.rotation, 4) ?? [];
  const [sx = 1, sy = 1, sz = 1] = finiteList(node.scale, 3) ?? [];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
};

const records = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(recordOf) : [];

const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const indexOf = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) ? (value as number) : undefined;

const indexList = (value: unknown): ReadonlyArray<number> =>
  Array.isArray(value) ? value.filter((entry): entry is number => Number.isSafeInteger(entry)) : [];

const trianglesOf = (mode: unknown, count: number) => {
  if (mode === undefined || mode === 4) return Math.floor(count / 3);
  return mode === 5 || mode === 6 ? Math.max(count - 2, 0) : 0;
};

const visitLimit = 100_000;

export const glbStats = (bytes: Uint8Array): GlbStats => {
  const parsed = readGlbJson(bytes);
  if (!parsed.ok) return { triangles: 0, dimensions: [0, 0, 0] };
  const { json } = parsed;
  const accessors = records(json.accessors);
  const meshes = records(json.meshes);
  const nodes = records(json.nodes);
  const scene = records(json.scenes)[indexOf(json.scene) ?? 0];
  const children = new Set(nodes.flatMap((node) => indexList(node.children)));
  const roots =
    scene === undefined
      ? nodes.flatMap((_, index) => (children.has(index) ? [] : [index]))
      : indexList(scene.nodes);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let visits = 0;
  const visit = (index: number, parent: Matrix, depth: number) => {
    const node = nodes[index];
    visits += 1;
    if (node === undefined || depth > 64 || visits > visitLimit) return;
    const world = multiply(parent, localMatrix(node));
    const mesh = meshes[indexOf(node.mesh) ?? -1];
    for (const primitive of records(mesh?.primitives)) {
      const position = accessors[indexOf(recordOf(primitive.attributes).POSITION) ?? -1];
      const indices = accessors[indexOf(primitive.indices) ?? -1] ?? position;
      triangles += trianglesOf(primitive.mode, indexOf(indices?.count) ?? 0);
      const min = finiteList(position?.min, 3);
      const max = finiteList(position?.max, 3);
      if (min === undefined || max === undefined) continue;
      for (let corner = 0; corner < 8; corner += 1) {
        const point = [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? max[axis]! : min[axis]!));
        for (let axis = 0; axis < 3; axis += 1) {
          const value =
            world[axis]! * point[0]! +
            world[axis + 4]! * point[1]! +
            world[axis + 8]! * point[2]! +
            world[axis + 12]!;
          low[axis] = Math.min(low[axis]!, value);
          high[axis] = Math.max(high[axis]!, value);
        }
      }
    }
    for (const child of indexList(node.children)) visit(child, world, depth + 1);
  };
  for (const root of roots) visit(root, identityMatrix, 0);
  const size = (axis: number) =>
    Number.isFinite(low[axis]!) ? Math.round((high[axis]! - low[axis]!) * 1000) / 1000 : 0;
  return {
    triangles: Number.isSafeInteger(triangles) ? triangles : 0,
    dimensions: [size(0), size(2), size(1)],
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

type ShownModel =
  | {
      readonly ok: true;
      readonly file: string;
      readonly jobDir: string;
      readonly modelPreview: ModelPreviewReference;
    }
  | { readonly ok: false; readonly error: string; readonly reason: string };

export const showModelFile = (input: {
  readonly path: string;
  readonly cwd: string | undefined;
  readonly jobsRoot: string;
  readonly now: number;
}): ShownModel => {
  if (!/\.glb$/iu.test(input.path)) {
    return {
      ok: false,
      error: "not_glb",
      reason: `${input.path} is not a .glb file. Only binary glTF (.glb) can be shown; export other formats to .glb first.`,
    };
  }
  if (!NodePath.isAbsolute(input.path) && input.cwd === undefined) {
    return {
      ok: false,
      error: "invalid_arguments",
      reason: "This thread has no project folder, so path must be absolute.",
    };
  }
  const file = NodePath.resolve(input.cwd ?? "", input.path);
  let size: number;
  try {
    const stat = NodeFS.statSync(file);
    if (!stat.isFile())
      return { ok: false, error: "file_not_found", reason: `${file} is not a file.` };
    size = stat.size;
  } catch {
    return { ok: false, error: "file_not_found", reason: `No file at ${file}.` };
  }
  if (size > MAX_GLB_BYTES) {
    return {
      ok: false,
      error: "invalid_glb",
      reason: `The GLB is ${(size / 1048576).toFixed(1)} MB; previews are capped at ${MAX_GLB_BYTES / 1048576} MB.`,
    };
  }
  const bytes = NodeFS.readFileSync(file);
  const checked = validateGlb(bytes);
  if (!checked.ok) return { ok: false, error: "invalid_glb", reason: checked.reason };
  pruneJobFolders(input.jobsRoot, input.now);
  const jobDir = NodePath.join(input.jobsRoot, jobFolderName(input.now));
  NodeFS.mkdirSync(jobDir, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(jobDir, MODEL_PREVIEW_FILE), bytes);
  return {
    ok: true,
    file,
    jobDir,
    modelPreview: registerModelPreview(jobDir, {
      ...glbStats(bytes),
      animationClips: checked.info.animationClips,
      sizeBytes: checked.info.sizeBytes,
      jobId: NodePath.basename(jobDir),
    }),
  };
};
