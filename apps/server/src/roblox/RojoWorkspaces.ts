// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalTimers:off preferSchemaOverJson:off globalFetchInEffect:off globalFetch:off - Rojo runs as a long-lived child process and answers on a local port.
import * as NodeChildProcess from "node:child_process";

import type { RojoProjectStatus, RojoWorkspaceStatus } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";

import {
  arrangeRojoProjects,
  isRojoProjectFile,
  maxRojoScanDepth,
  maxRojoScannedFolders,
  parseInstancePath,
  parseRojoProject,
  rojoLayout,
  rojoPortHints,
  rojoProjectsForPlace,
  rojoScriptCandidates,
  rojoTreePaths,
  servedRojoProjects,
  shouldScanRojoFolder,
  type ParsedRojoProject,
  type RojoProject,
} from "./rojoProjects.ts";

const discoveryTtlMs = 15_000;
const executableTtlMs = 60_000;
const probeTimeoutMs = 600;
const startTimeoutMs = 10_000;
const stopTimeoutMs = 4_000;
const keptOutputLines = 30;
const rojoMissing =
  "Rojo was not found. Install it with Rokit or Aftman, or put rojo on your PATH, then try again.";

export type RojoScriptLocation =
  | {
      readonly kind: "found";
      readonly project: RojoProject;
      readonly absolute: string;
      readonly relative: string;
      readonly serving: boolean;
    }
  | { readonly kind: "ambiguous"; readonly files: ReadonlyArray<string> };

export interface RojoWorkspacesShape {
  readonly projects: (root: string) => Effect.Effect<ReadonlyArray<RojoProject>>;
  readonly status: (root: string) => Effect.Effect<RojoWorkspaceStatus>;
  readonly control: (
    root: string,
    input: { readonly action: "start" | "stop"; readonly file?: string | undefined },
  ) => Effect.Effect<RojoWorkspaceStatus>;
  readonly locateScript: (input: {
    readonly root: string;
    readonly instancePath: string;
    readonly placeId?: number | undefined;
    readonly placeName?: string | undefined;
    readonly studioSource?: string | undefined;
  }) => Effect.Effect<RojoScriptLocation | undefined>;
}

export class RojoWorkspaces extends Context.Service<RojoWorkspaces, RojoWorkspacesShape>()(
  "t3/roblox/RojoWorkspaces",
) {}

interface OwnedServer {
  readonly child: NodeChildProcess.ChildProcess | undefined;
  readonly lines: string[];
  exited: boolean;
}

const stripAnsi = (text: string) => text.replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, "");

const normalizeEol = (text: string) => text.replaceAll("\r\n", "\n");

const probe = (port: number) =>
  Effect.promise(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/api/rojo`, {
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
      if (!response.ok) return false;
      const body: unknown = await response.json();
      return (
        typeof body === "object" &&
        body !== null &&
        ("serverVersion" in body || "projectName" in body || "sessionId" in body)
      );
    } catch {
      return false;
    }
  });

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;

  const discovered = new Map<
    string,
    { readonly at: number; readonly projects: ReadonlyArray<RojoProject> }
  >();
  const owned = new Map<string, OwnedServer>();
  let executable: { readonly at: number; readonly value: string | undefined } | undefined;

  const serverKey = (root: string, file: string) => `${path.resolve(root).toLowerCase()}|${file}`;

  const isFile = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );

  const findRojo = Effect.fn("RojoWorkspaces.findRojo")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (executable !== undefined && now - executable.at < executableTtlMs) return executable.value;
    const names = platform === "win32" ? ["rojo.exe"] : ["rojo"];
    const folders = [
      ...(env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":"),
      ...[".rokit", ".aftman", ".foreman", ".cargo"].map((tool) => path.join(home, tool, "bin")),
    ].filter((folder) => folder.trim() !== "");
    let value: string | undefined;
    for (const folder of folders) {
      for (const name of names) {
        const candidate = path.join(folder, name);
        if (yield* isFile(candidate)) {
          value = candidate;
          break;
        }
      }
      if (value !== undefined) break;
    }
    executable = { at: now, value };
    return value;
  });

  const scan = Effect.fn("RojoWorkspaces.scan")(function* (root: string) {
    const found: string[] = [];
    const queue: Array<{ readonly relative: string; readonly depth: number }> = [
      { relative: "", depth: 0 },
    ];
    for (let index = 0; index < queue.length && index < maxRojoScannedFolders; index += 1) {
      const { relative, depth } = queue[index]!;
      const entries = yield* fs
        .readDirectory(path.join(root, relative))
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const entry of entries) {
        const child = relative === "" ? entry : `${relative}/${entry}`;
        if (isRojoProjectFile(entry)) found.push(child);
        else if (depth < maxRojoScanDepth && !entry.includes(".") && shouldScanRojoFolder(entry)) {
          queue.push({ relative: child, depth: depth + 1 });
        }
      }
    }
    const parsed: ParsedRojoProject[] = [];
    for (const file of found.toSorted()) {
      const text = yield* fs
        .readFileString(path.join(root, file))
        .pipe(Effect.orElseSucceed(() => ""));
      const project = parseRojoProject(file, text);
      if (project === undefined) continue;
      const folder = path.dirname(path.join(root, file));
      const sources = yield* Effect.forEach(rojoTreePaths(project.tree, 3), (source) =>
        fs.exists(path.resolve(folder, source)).pipe(Effect.orElseSucceed(() => false)),
      );
      if (sources.every((found) => found)) parsed.push(project);
    }
    const tasks = yield* fs
      .readFileString(path.join(root, ".vscode", "tasks.json"))
      .pipe(Effect.orElseSucceed(() => ""));
    return arrangeRojoProjects(parsed, rojoPortHints(tasks));
  });

  const projects: RojoWorkspacesShape["projects"] = Effect.fn("RojoWorkspaces.projects")(
    function* (root) {
      const key = path.resolve(root).toLowerCase();
      const now = yield* Clock.currentTimeMillis;
      const cached = discovered.get(key);
      if (cached !== undefined && now - cached.at < discoveryTtlMs) return cached.projects;
      const found = yield* scan(root);
      discovered.set(key, { at: now, projects: found });
      if (discovered.size > 128) discovered.delete(discovered.keys().next().value ?? key);
      return found;
    },
  );

  const projectStatus = Effect.fn("RojoWorkspaces.projectStatus")(function* (
    root: string,
    project: RojoProject,
  ) {
    const server = owned.get(serverKey(root, project.file));
    const alive = yield* probe(project.port);
    const base = {
      file: project.file,
      label: project.label,
      kind: project.kind,
      port: project.port,
    };
    if (alive) {
      return {
        ...base,
        state: "running",
        startedByHarp: server !== undefined && !server.exited,
      } satisfies RojoProjectStatus;
    }
    if (server === undefined) {
      return { ...base, state: "stopped", startedByHarp: false } satisfies RojoProjectStatus;
    }
    if (!server.exited) {
      return { ...base, state: "starting", startedByHarp: true } satisfies RojoProjectStatus;
    }
    const message = server.lines.findLast((line) => line.trim() !== "");
    return {
      ...base,
      state: "failed",
      startedByHarp: true,
      ...(message === undefined ? {} : { message: message.slice(0, 400) }),
    } satisfies RojoProjectStatus;
  });

  const status: RojoWorkspacesShape["status"] = Effect.fn("RojoWorkspaces.status")(
    function* (root) {
      const all = yield* projects(root);
      const served = servedRojoProjects(all);
      return {
        layout: rojoLayout(all),
        rojoFound: served.length === 0 ? false : (yield* findRojo()) !== undefined,
        projects: yield* Effect.forEach(served, (project) => projectStatus(root, project), {
          concurrency: 4,
        }),
      };
    },
  );

  const waitFor = (condition: Effect.Effect<boolean>, timeoutMs: number) =>
    condition.pipe(
      Effect.repeat({ until: (done) => done, schedule: Schedule.spaced(Duration.millis(250)) }),
      Effect.timeoutOption(Duration.millis(timeoutMs)),
      Effect.asVoid,
    );

  const kill = (server: OwnedServer) => {
    const child = server.child;
    if (child === undefined || server.exited || child.pid === undefined) return;
    if (platform === "win32") {
      NodeChildProcess.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      }).on("error", () => child.kill());
      return;
    }
    child.kill("SIGTERM");
  };

  const start = Effect.fn("RojoWorkspaces.start")(function* (root: string, project: RojoProject) {
    const key = serverKey(root, project.file);
    const current = owned.get(key);
    if ((current !== undefined && !current.exited) || (yield* probe(project.port))) return;
    const rojo = yield* findRojo();
    if (rojo === undefined) {
      owned.set(key, { child: undefined, lines: [rojoMissing], exited: true });
      return;
    }
    const absolute = path.join(root, project.file);
    const lines: string[] = [];
    const server: OwnedServer = {
      child: NodeChildProcess.spawn(
        rojo,
        ["serve", path.basename(absolute), "--port", String(project.port)],
        { cwd: path.dirname(absolute), windowsHide: true, env: process.env },
      ),
      lines,
      exited: false,
    };
    const collect = (chunk: Buffer) => {
      for (const line of stripAnsi(chunk.toString("utf8")).split(/\r?\n/u)) {
        if (line.trim() === "") continue;
        lines.push(line.trim());
        if (lines.length > keptOutputLines) lines.shift();
      }
    };
    server.child?.stdout?.on("data", collect);
    server.child?.stderr?.on("data", collect);
    server.child?.on("error", (error) => {
      lines.push(error.message);
      server.exited = true;
    });
    server.child?.on("exit", () => {
      server.exited = true;
    });
    owned.set(key, server);
    yield* waitFor(
      probe(project.port).pipe(Effect.map((alive) => alive || server.exited)),
      startTimeoutMs,
    );
  });

  const stop = Effect.fn("RojoWorkspaces.stop")(function* (root: string, project: RojoProject) {
    const key = serverKey(root, project.file);
    const server = owned.get(key);
    if (server === undefined) return;
    owned.delete(key);
    if (server.exited) return;
    kill(server);
    yield* waitFor(
      Effect.sync(() => server.exited),
      stopTimeoutMs,
    );
  });

  const control: RojoWorkspacesShape["control"] = Effect.fn("RojoWorkspaces.control")(
    function* (root, input) {
      const served = servedRojoProjects(yield* projects(root));
      const chosen =
        input.file === undefined ? served : served.filter((project) => project.file === input.file);
      yield* Effect.forEach(
        chosen,
        (project) => (input.action === "start" ? start(root, project) : stop(root, project)),
        { concurrency: 4, discard: true },
      );
      return yield* status(root);
    },
  );

  const locateScript: RojoWorkspacesShape["locateScript"] = Effect.fn(
    "RojoWorkspaces.locateScript",
  )(function* (input) {
    const segments = parseInstancePath(input.instancePath);
    if (segments === undefined) return undefined;
    const all = yield* projects(input.root);
    if (all.length === 0) return undefined;
    const hits = new Map<string, RojoProject>();
    for (const project of rojoProjectsForPlace(all, input)) {
      const folder = path.dirname(path.join(input.root, project.file));
      for (const candidate of rojoScriptCandidates(project, segments)) {
        const absolute = path.resolve(folder, candidate);
        if (!(yield* isFile(absolute))) continue;
        if (!hits.has(absolute)) hits.set(absolute, project);
        break;
      }
    }
    if (hits.size === 0) return undefined;
    let chosen = [...hits];
    if (chosen.length > 1 && input.studioSource !== undefined) {
      const wanted = normalizeEol(input.studioSource);
      const same: Array<[string, RojoProject]> = [];
      for (const hit of chosen) {
        const text = yield* fs.readFileString(hit[0]).pipe(Effect.orElseSucceed(() => undefined));
        if (text !== undefined && normalizeEol(text) === wanted) same.push(hit);
      }
      if (same.length === 1) chosen = same;
    }
    const relativeOf = (absolute: string) =>
      path.relative(input.root, absolute).split(path.sep).join("/");
    if (chosen.length > 1) {
      return { kind: "ambiguous", files: chosen.map(([absolute]) => relativeOf(absolute)) };
    }
    const [absolute, project] = chosen[0]!;
    return {
      kind: "found",
      project,
      absolute,
      relative: relativeOf(absolute),
      serving: yield* probe(project.port),
    };
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const server of owned.values()) kill(server);
      owned.clear();
    }),
  );

  return RojoWorkspaces.of({ projects, status, control, locateScript });
});

export const layer = Layer.effect(RojoWorkspaces, make);

const noProjects = Effect.succeed<ReadonlyArray<RojoProject>>([]);
const noStatus = Effect.succeed<RojoWorkspaceStatus>({
  layout: "none",
  rojoFound: false,
  projects: [],
});
// @effect-diagnostics-next-line effectSucceedWithVoid:off - No file is a value, not a void step.
const noScript = Effect.succeed<RojoScriptLocation | undefined>(undefined);

export const layerNone = Layer.succeed(
  RojoWorkspaces,
  RojoWorkspaces.of({
    projects: Effect.fn("RojoWorkspaces.projects")(() => noProjects),
    status: Effect.fn("RojoWorkspaces.status")(() => noStatus),
    control: Effect.fn("RojoWorkspaces.control")(() => noStatus),
    locateScript: Effect.fn("RojoWorkspaces.locateScript")(() => noScript),
  }),
);
