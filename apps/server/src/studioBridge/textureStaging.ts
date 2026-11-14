// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalRandomInEffect:off globalTimers:off preferSchemaOverJson:off -Staging copies one file into Studio's install folder.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { isPngBytes } from "./imageGeneration.ts";

export const MAX_STAGED_PNG_BYTES = 16 * 1024 * 1024;
export const STAGED_FOLDER = "harp";
const keepStaged = 60;

export type StageSource =
  | { readonly ok: true; readonly file: string; readonly bytes: Buffer }
  | { readonly ok: false; readonly reason: string };

const realPathOf = (path: string): string | undefined => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return undefined;
  }
};

const isInside = (root: string, file: string) => {
  const relative = NodePath.relative(root, file);
  return relative !== "" && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
};

/** Reads a PNG only from the given roots (job folders, the thread's workspace); anything else is refused. */
export const readStageSource = (
  path: string,
  roots: ReadonlyArray<string | undefined>,
): StageSource => {
  const real = realPathOf(NodePath.resolve(path));
  if (real === undefined) return { ok: false, reason: `No file at ${path}.` };
  const allowed = roots.some((root) => {
    if (root === undefined || root === "") return false;
    const realRoot = realPathOf(root);
    return realRoot !== undefined && isInside(realRoot, real);
  });
  if (!allowed) {
    return {
      ok: false,
      reason:
        "Only images from a generate_image or blender job, or inside this thread's workspace, can be staged.",
    };
  }
  let size: number;
  try {
    const stat = NodeFS.statSync(real);
    if (!stat.isFile()) return { ok: false, reason: `${path} is not a file.` };
    size = stat.size;
  } catch {
    return { ok: false, reason: `No file at ${path}.` };
  }
  if (size > MAX_STAGED_PNG_BYTES) {
    return {
      ok: false,
      reason: `The PNG is ${(size / 1048576).toFixed(1)} MB; the limit is 16 MB.`,
    };
  }
  const bytes = NodeFS.readFileSync(real);
  if (!isPngBytes(bytes)) return { ok: false, reason: "Only PNG files can be staged." };
  return { ok: true, file: real, bytes };
};

/** Studio's content folder: where `rbxasset://` paths resolve. */
export const studioContentDirectory = (input: {
  readonly platform: string;
  readonly executable: string | undefined;
  readonly home: string | undefined;
}): string | undefined => {
  if (input.platform === "win32") {
    return input.executable === undefined
      ? undefined
      : NodePath.join(NodePath.dirname(input.executable), "content");
  }
  if (input.platform === "darwin") {
    const candidates = [
      "/Applications/RobloxStudio.app",
      ...(input.home === undefined
        ? []
        : [NodePath.join(input.home, "Applications/RobloxStudio.app")]),
    ].map((app) => NodePath.join(app, "Contents/Resources/content"));
    return candidates.find((candidate) => NodeFS.existsSync(candidate));
  }
  return undefined;
};

export const stagedName = (bytes: Uint8Array): string =>
  `${NodeCrypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.png`;

export const rbxassetUrl = (name: string) => `rbxasset://${STAGED_FOLDER}/${name}`;

const pruneStaged = (folder: string, keep: string) => {
  let entries: Array<{ readonly path: string; readonly modified: number }>;
  try {
    entries = NodeFS.readdirSync(folder)
      .filter((name) => name.endsWith(".png") && name !== keep)
      .map((name) => {
        const path = NodePath.join(folder, name);
        return { path, modified: NodeFS.statSync(path).mtimeMs };
      });
  } catch {
    return;
  }
  entries.sort((left, right) => right.modified - left.modified);
  for (const entry of entries.slice(keepStaged - 1)) {
    try {
      NodeFS.rmSync(entry.path, { force: true });
    } catch {
      // A locked file is retried by the next staging.
    }
  }
};

export type StageResult =
  | { readonly ok: true; readonly url: string; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/** Copies the PNG to `<content>/harp/<hash>.png`; the same bytes always map to the same path. */
export const stageIntoContent = (contentDir: string, bytes: Buffer): StageResult => {
  const name = stagedName(bytes);
  const folder = NodePath.join(contentDir, STAGED_FOLDER);
  const target = NodePath.join(folder, name);
  try {
    NodeFS.mkdirSync(folder, { recursive: true });
    if (!NodeFS.existsSync(target) || NodeFS.statSync(target).size !== bytes.length) {
      NodeFS.writeFileSync(target, bytes);
    }
    pruneStaged(folder, name);
  } catch (cause) {
    return {
      ok: false,
      reason: `Harp could not write into Studio's content folder (${contentDir}): ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  return { ok: true, url: rbxassetUrl(name), path: target };
};
