// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalRandomInEffect:off globalTimers:off preferSchemaOverJson:off globalFetchInEffect:off -Blender runs as a headless child process on job folders.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const decodeJsonUnknown = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

import { EPILOGUE, PRELUDE } from "./blenderScripts.ts";
import {
  JOB_FOLDER_PREFIX,
  MODEL_PREVIEW_FILE,
  MODEL_PREVIEW_INDEX_FILE,
  pruneJobFolders,
  registerModelPreview,
  validateGlb,
} from "./modelPreviews.ts";

/**
 * Headless Blender jobs. The agent's Python runs inside a prelude that gives it the job folder
 * and Harp's modeling helpers. Afterwards Harp measures the result itself: a topology report for
 * every mesh, export checks, an optional preview render, and an OBJ and a GLB export.
 */

export interface BlenderJobResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly jobDir: string;
  readonly output: string;
  readonly report: unknown;
  readonly files: ReadonlyArray<string>;
  readonly previewPng?: Buffer | undefined;
  readonly objPath?: string | undefined;
  readonly modelPreview?: ModelPreviewReference | undefined;
  readonly modelPreviewError?: string | undefined;
}

export const MAX_AGENT_SCRIPT_BYTES = 256 * 1024;

export const agentScriptSizeError = (script: string): string | undefined => {
  const bytes = Buffer.byteLength(script, "utf8");
  return bytes > MAX_AGENT_SCRIPT_BYTES
    ? `The script is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_AGENT_SCRIPT_BYTES / 1024} KB. Split the work into several jobs and chain them with continueFrom.`
    : undefined;
};

const SECRET_NAME =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|AUTH|COOKIE|CREDENTIAL|SESSION|ROBLOSECURITY/iu;
const KEPT_NAMES = new Set([
  "SESSIONNAME",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_SESSION_TYPE",
  "XDG_SESSION_CLASS",
  "XDG_SESSION_DESKTOP",
]);

/** The agent's script can print or send its environment, so Blender never sees credential-looking variables. */
export const blenderEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (!upper.startsWith("BLENDER_") && !KEPT_NAMES.has(upper) && SECRET_NAME.test(name)) continue;
    clean[name] = value;
  }
  return clean;
};

const killProcessTree = (child: NodeChildProcess.ChildProcess) => {
  const pid = child.pid;
  if (pid === undefined) return;
  if (NodeOS.platform() === "win32") {
    NodeChildProcess.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => child.kill());
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
};

const SUMMARY_BUDGET_BYTES = 12_000;

const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

const trimOutput = (output: string, keep: number) => {
  if (keep <= 0) return "";
  let tail = output.slice(-keep);
  while (Buffer.byteLength(tail, "utf8") > keep * 2) tail = tail.slice(Math.ceil(tail.length / 4));
  return `…${tail}`;
};

/** Client output compaction reads only the first 16 KB of a result, so the summary stays under it. */
export const fitJobSummary = <T extends { output: string; result: unknown }>(summary: T): T => {
  const fits = (value: unknown) => byteSize(value) <= SUMMARY_BUDGET_BYTES;
  if (fits(summary)) return summary;
  const fitted = { ...summary };
  for (const keep of [6000, 3000, 1000, 0]) {
    fitted.output = trimOutput(summary.output, keep);
    if (fits(fitted)) return fitted;
  }
  const original = (fitted.result ?? {}) as Record<string, unknown>;
  const withResult = (result: Record<string, unknown>) => {
    Object.assign(fitted, { result });
    return fits(fitted);
  };
  const lintOf = (result: Record<string, unknown>) =>
    result.lint !== null && typeof result.lint === "object"
      ? (result.lint as Record<string, unknown>)
      : {};
  const { objects: _objects, ...lintWithoutObjects } = lintOf(original);
  let result: Record<string, unknown> = {
    ...original,
    ...(original.lint === undefined
      ? {}
      : { lint: { ...lintWithoutObjects, objectsOmitted: true } }),
  };
  if (withResult(result)) return fitted;
  const meshes = Array.isArray(original.meshes) ? original.meshes : undefined;
  if (meshes !== undefined) {
    for (const limit of [40, 20, 10, 5, 0]) {
      if (meshes.length <= limit) continue;
      result = { ...result, meshes: meshes.slice(0, limit), meshesOmitted: meshes.length - limit };
      if (withResult(result)) return fitted;
    }
  }
  for (const limit of [20, 8, 3, 0]) {
    const lint: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(lintOf(result))) {
      lint[key] = Array.isArray(value) && value.length > limit ? value.slice(0, limit) : value;
    }
    result = { ...result, lint };
    if (withResult(result)) return fitted;
  }
  const { meshes: _meshes, lint: _lint, ...rest } = result;
  withResult({ ...rest, reportTrimmed: true });
  return fitted;
};

/** The job script: prelude, the agent's file run with its own line numbers, then the measurements. */
export const buildJobScript = (agentScriptPath: string): string =>
  [
    PRELUDE,
    "_sealcode_error = None",
    "try:",
    `    _sealcode_path = ${JSON.stringify(agentScriptPath)}`,
    '    exec(compile(open(_sealcode_path, encoding="utf-8").read(), _sealcode_path, "exec"), globals())',
    "except Exception:",
    "    _sealcode_error = traceback.format_exc()[-4000:]",
    "    print(_sealcode_error, file=sys.stderr)",
    EPILOGUE,
  ].join("\n");

const numberTriple = (value: unknown): [number, number, number] | undefined =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? [value[0], value[1], value[2]]
    : undefined;

/** Validates the exported GLB and gives it a preview id, or says why it has none. */
const readModelPreview = (
  jobDir: string,
  status: Record<string, unknown>,
  openBlend?: string,
): { modelPreview?: ModelPreviewReference; modelPreviewError?: string } => {
  if (typeof status.glbError === "string") {
    return { modelPreviewError: `GLB export failed: ${status.glbError}` };
  }
  if (status.glb !== true) return {};
  let bytes: Buffer;
  try {
    bytes = NodeFS.readFileSync(NodePath.join(jobDir, MODEL_PREVIEW_FILE));
  } catch {
    return { modelPreviewError: "GLB export reported success but model.glb is missing." };
  }
  const checked = validateGlb(bytes);
  if (!checked.ok) return { modelPreviewError: checked.reason };
  const continuedFrom = openBlend?.split(/[\\/]/u).filter(Boolean).at(-2);
  const model = (
    status.lint as { model?: { dimensions?: unknown; triangles?: unknown } } | undefined
  )?.model;
  const triangles =
    typeof model?.triangles === "number" && Number.isSafeInteger(model.triangles)
      ? model.triangles
      : 0;
  return {
    modelPreview: registerModelPreview(jobDir, {
      triangles,
      dimensions: numberTriple(model?.dimensions) ?? [0, 0, 0],
      animationClips: checked.info.animationClips,
      sizeBytes: checked.info.sizeBytes,
      jobId: NodePath.basename(jobDir),
      ...(continuedFrom === undefined ? {} : { continuedFrom }),
    }),
  };
};

export const resolveContinueBlend = (
  jobsRoot: string,
  continueFrom: string,
): { readonly path: string } | { readonly error: string } => {
  try {
    const root = NodeFS.realpathSync(jobsRoot);
    const folder = NodeFS.realpathSync(NodePath.resolve(jobsRoot, continueFrom));
    const relative = NodePath.relative(root, folder);
    if (relative === "" || relative.startsWith("..") || NodePath.isAbsolute(relative)) {
      return { error: "continueFrom must be the jobDir of an earlier blender job." };
    }
    const blend = NodePath.join(folder, "scene.blend");
    if (!NodeFS.existsSync(blend)) {
      return { error: `${continueFrom} has no scene.blend; that job did not save its scene.` };
    }
    return { path: blend };
  } catch {
    return { error: `continueFrom ${continueFrom} was not found; it may have been pruned.` };
  }
};

export const runBlenderJob = (input: {
  readonly executable: string;
  readonly jobsRoot: string;
  readonly script: string;
  readonly preview: boolean;
  readonly exportObj: boolean;
  readonly saveBlend: boolean;
  readonly timeoutMs: number;
  /** A .blend from an earlier job to continue from. */
  readonly openBlend?: string | undefined;
}) =>
  Effect.tryPromise({
    try: async (signal): Promise<BlenderJobResult> => {
      const tooLarge = agentScriptSizeError(input.script);
      if (tooLarge !== undefined) throw new Error(tooLarge);
      if (input.openBlend !== undefined && !NodeFS.existsSync(input.openBlend)) {
        throw new Error(`continue_from_missing: ${input.openBlend} does not exist.`);
      }
      pruneJobFolders(input.jobsRoot, Date.now(), {
        protect: input.openBlend ? [NodePath.dirname(input.openBlend)] : [],
      });
      const id = `${JOB_FOLDER_PREFIX}${new Date().toISOString().replace(/[:.]/gu, "-")}-${Math.random().toString(36).slice(2, 7)}`;
      const jobDir = NodePath.join(input.jobsRoot, id);
      NodeFS.mkdirSync(jobDir, { recursive: true });
      const agentPath = NodePath.join(jobDir, "agent.py");
      NodeFS.writeFileSync(agentPath, input.script);
      const scriptPath = NodePath.join(jobDir, "job.py");
      NodeFS.writeFileSync(scriptPath, buildJobScript(agentPath));
      const args = [
        ...(input.openBlend ? [input.openBlend] : []),
        "-b",
        "--factory-startup",
        "--python",
        scriptPath,
      ];
      const output: string[] = [];
      let size = 0;
      const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
        const child = NodeChildProcess.spawn(input.executable, args, {
          cwd: jobDir,
          windowsHide: true,
          detached: NodeOS.platform() !== "win32",
          env: {
            ...blenderEnvironment(process.env),
            SEALCODE_JOB_DIR: jobDir,
            SEALCODE_PREVIEW: input.preview ? "1" : "0",
            SEALCODE_EXPORT: input.exportObj ? "1" : "0",
            SEALCODE_SAVE_BLEND: input.saveBlend ? "1" : "0",
            SEALCODE_FRESH: input.openBlend ? "0" : "1",
          },
        });
        const collect = (chunk: Buffer) => {
          if (size > 400_000) return;
          size += chunk.length;
          output.push(chunk.toString("utf8"));
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        let timedOut = false;
        let finished = false;
        const finish = (code: number | null) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve({ code, timedOut });
        };
        // Grandchildren holding the pipes open would keep "close" from ever firing.
        const stop = () => {
          killProcessTree(child);
          setTimeout(() => finish(null), 5000).unref();
        };
        const timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, input.timeoutMs);
        const onAbort = () => stop();
        signal.addEventListener("abort", onAbort);
        if (signal.aborted) stop();
        child.on("error", (error) => {
          output.push(String(error));
          finish(null);
        });
        child.on("close", (code) => finish(code));
      });
      let status: Record<string, unknown> = {};
      try {
        status = decodeJsonUnknown(
          NodeFS.readFileSync(NodePath.join(jobDir, "sealcode-status.json"), "utf8"),
        ) as Record<string, unknown>;
      } catch {
        status = { statusMissing: true };
      }
      // Blender's own banner and timing lines are noise for the model.
      const text = output
        .join("")
        .split(/\r?\n/u)
        .filter((line) => !/^(Blender \d|Read prefs|Fra:|Saved: |Time: |\s*$)/u.test(line))
        .join("\n");
      const previewPath = NodePath.join(jobDir, "preview.png");
      const objPath = NodePath.join(jobDir, "model.obj");
      return {
        ok: !result.timedOut && result.code === 0 && status.scriptError == null,
        exitCode: result.code,
        timedOut: result.timedOut,
        jobDir,
        output: text.length > 12_000 ? `…${text.slice(-12_000)}` : text,
        report: status,
        files: NodeFS.readdirSync(jobDir).filter(
          (name) =>
            name !== "job.py" &&
            name !== "sealcode-status.json" &&
            name !== MODEL_PREVIEW_INDEX_FILE,
        ),
        previewPng: NodeFS.existsSync(previewPath) ? NodeFS.readFileSync(previewPath) : undefined,
        objPath: NodeFS.existsSync(objPath) ? objPath : undefined,
        ...readModelPreview(jobDir, status, input.openBlend),
      };
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export interface MeshGroup {
  readonly name: string;
  readonly color: readonly [number, number, number];
  readonly vertices: ReadonlyArray<number>;
  readonly triangles: ReadonlyArray<number>;
}

/**
 * Reads an OBJ (+ its MTL diffuse colours) into one triangle list per material, with
 * positions in studs. Each group becomes one MeshPart in Studio.
 */
export const parseObj = (objText: string, mtlText: string | undefined, studsPerUnit: number) => {
  const colors = new Map<string, readonly [number, number, number]>();
  let currentMtl: string | undefined;
  for (const line of (mtlText ?? "").split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    if (parts[0] === "newmtl") currentMtl = parts.slice(1).join(" ");
    if (parts[0] === "Kd" && currentMtl !== undefined) {
      colors.set(currentMtl, [Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    }
  }
  const positions: Array<readonly [number, number, number]> = [];
  const groups = new Map<
    string,
    { vertices: number[]; triangles: number[]; index: Map<number, number> }
  >();
  let material = "Default";
  for (const line of objText.split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    if (parts[0] === "v") {
      positions.push([
        Number(parts[1]) * studsPerUnit,
        Number(parts[2]) * studsPerUnit,
        Number(parts[3]) * studsPerUnit,
      ]);
    } else if (parts[0] === "usemtl") {
      material = parts.slice(1).join(" ") || "Default";
    } else if (parts[0] === "f") {
      let group = groups.get(material);
      if (group === undefined) {
        group = { vertices: [], triangles: [], index: new Map() };
        groups.set(material, group);
      }
      const ids = parts.slice(1).map((token) => {
        const raw = Number(token.split("/")[0]);
        const position = raw < 0 ? positions.length + raw : raw - 1;
        let local = group.index.get(position);
        if (local === undefined) {
          local = group.index.size;
          group.index.set(position, local);
          const p = positions[position] ?? [0, 0, 0];
          group.vertices.push(p[0], p[1], p[2]);
        }
        return local;
      });
      for (let i = 1; i + 1 < ids.length; i += 1) {
        group.triangles.push(ids[0]!, ids[i]!, ids[i + 1]!);
      }
    }
  }
  return [...groups.entries()].map(([name, group]): MeshGroup => ({
    name,
    color: colors.get(name) ?? [0.7, 0.7, 0.7],
    vertices: group.vertices,
    triangles: group.triangles,
  }));
};
