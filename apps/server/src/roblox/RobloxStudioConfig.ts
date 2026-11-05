import type {
  GlobalMcpServer,
  ProjectId,
  RobloxProjectDetection,
  RobloxProjectMode,
  RobloxStudioSettings,
  ServerSettings,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { studioBridgeInstructions } from "../studioBridge/instructions.ts";
import { loadStudioSkills, skillCatalog } from "../studioBridge/studioSkills.ts";
import { DEFAULT_STUDIO_BRIDGE_PORT } from "../studioBridge/protocol.ts";
import {
  decideRobloxProject,
  subfoldersToScan,
  type RobloxFolderListing,
} from "./robloxProjectDetection.ts";

export const STUDIO_BRIDGE_SERVER_ID = "studio";
export const OFFICIAL_SERVER_ID = "roblox-studio-official";
export const BLENDER_MCP_SERVER_ID = "blender";
export const MANAGED_SERVER_IDS: ReadonlySet<string> = new Set([
  STUDIO_BRIDGE_SERVER_ID,
  OFFICIAL_SERVER_ID,
  BLENDER_MCP_SERVER_ID,
]);

/** Where Harp's own Studio bridge listens, and the token its MCP endpoint wants. */
export interface StudioBridgeEndpoint {
  readonly port: number;
  readonly mcpToken: string;
}

export interface RobloxStudioEnvironment {
  readonly studioBridge: StudioBridgeEndpoint | undefined;
  readonly officialMcpPath: string | undefined;
  readonly studioInstalled: boolean;
  readonly blenderJobsRoot: string;
  /** Found in the usual install folders; a configured path wins over it. */
  readonly detectedBlender: string | undefined;
  /** The `mcp-for-blender` executable the official MCP for Blender installer makes, when present. */
  readonly detectedBlenderMcp: string | undefined;
}

export interface BlenderMcpLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const setting = (field: { readonly name: string; readonly value: string }, sensitive = false) => ({
  name: field.name,
  value: field.value,
  sensitive,
});

export const blenderExecutableFor = (
  roblox: RobloxStudioSettings,
  environment: Pick<RobloxStudioEnvironment, "detectedBlender">,
): string | undefined =>
  roblox.blenderExecutable.length > 0 ? roblox.blenderExecutable : environment.detectedBlender;

export const blenderMcpLaunchFor = (
  roblox: RobloxStudioSettings,
  environment: Pick<RobloxStudioEnvironment, "detectedBlenderMcp">,
): BlenderMcpLaunch => {
  if (roblox.blenderMcpCommand.length > 0) {
    return { command: roblox.blenderMcpCommand, args: roblox.blenderMcpArgs };
  }
  if (environment.detectedBlenderMcp !== undefined) {
    return { command: environment.detectedBlenderMcp, args: roblox.blenderMcpArgs };
  }
  return {
    command: "uvx",
    args: roblox.blenderMcpArgs.length > 0 ? roblox.blenderMcpArgs : ["blender-mcp"],
  };
};

/**
 * The MCP servers the Roblox settings stand for. They join the user's own servers in
 * `GlobalMcpManager`, so they share its connection, status, reconnect and gateway; a user server
 * with the same id wins.
 */
export const managedServersFor = (
  settings: Pick<ServerSettings, "robloxStudio">,
  environment: RobloxStudioEnvironment,
): Readonly<Record<string, GlobalMcpServer>> => {
  const roblox = settings.robloxStudio;
  if (roblox.mode === "off") return {};
  const servers: Record<string, GlobalMcpServer> = {};

  if (roblox.mode === "sealcode" && environment.studioBridge !== undefined) {
    const bridge = environment.studioBridge;
    servers[STUDIO_BRIDGE_SERVER_ID] = {
      id: STUDIO_BRIDGE_SERVER_ID,
      displayName: "Roblox Studio (Harp)",
      enabled: true,
      transport: "streamable-http",
      url: `http://127.0.0.1:${String(bridge.port)}/mcp`,
      args: [],
      env: [],
      headers: [setting({ name: "Authorization", value: `Bearer ${bridge.mcpToken}` }, true)],
    };
  }

  const official =
    roblox.mode === "official" || (roblox.mode === "sealcode" && roblox.officialMcpAlongside);
  if (official && environment.officialMcpPath !== undefined) {
    servers[OFFICIAL_SERVER_ID] = {
      id: OFFICIAL_SERVER_ID,
      displayName: "Roblox Studio (official)",
      enabled: true,
      transport: "stdio",
      command: "cmd.exe",
      args: ["/c", environment.officialMcpPath],
      env: [],
      headers: [],
    };
  }

  if (roblox.blenderMcp) {
    const launch = blenderMcpLaunchFor(roblox, environment);
    servers[BLENDER_MCP_SERVER_ID] = {
      id: BLENDER_MCP_SERVER_ID,
      displayName: "Blender",
      enabled: true,
      transport: "stdio",
      command: launch.command,
      args: [...launch.args],
      env: [
        setting({ name: "BLENDER_MCP_DISABLE_TELEMETRY", value: "true" }),
        setting({ name: "DISABLE_TELEMETRY", value: "true" }),
      ],
      headers: [],
    };
  }
  return servers;
};

const PROJECT_DETECTION_TTL_MS = 30_000;

export interface RobloxProjectTarget {
  readonly workspaceRoot: string | undefined;
  readonly title?: string | undefined;
  readonly projectIcon?: { readonly kind: string } | null | undefined;
  readonly mode?: RobloxProjectMode | undefined;
  readonly placeNames?: ReadonlyArray<string> | undefined;
}

export const robloxProjectTarget = (
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  project: {
    readonly id: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly projectIcon?: { readonly kind: string } | null | undefined;
  },
  places: ReadonlyArray<{ readonly placeName: string }>,
): RobloxProjectTarget => ({
  workspaceRoot: project.workspaceRoot,
  title: project.title,
  projectIcon: project.projectIcon,
  mode: settings.projectSettingsOverrides[project.id]?.robloxProject,
  placeNames: places.map((place) => place.placeName),
});

export interface RobloxStudioConfigShape {
  readonly environment: RobloxStudioEnvironment;
  readonly managedServers: (
    settings: Pick<ServerSettings, "robloxStudio">,
  ) => Readonly<Record<string, GlobalMcpServer>>;
  readonly detect: (
    settings: Pick<ServerSettings, "robloxStudio">,
    target: RobloxProjectTarget,
  ) => Effect.Effect<RobloxProjectDetection>;
  /** Whether a thread of this project gets the Roblox tools and instructions. */
  readonly appliesTo: (
    settings: Pick<ServerSettings, "robloxStudio">,
    target: RobloxProjectTarget,
  ) => Effect.Effect<boolean>;
  /**
   * Managed servers a thread of this project must not see: outside Roblox projects their tools
   * would only cost every conversation tokens. A user server of the same id stays.
   */
  readonly hiddenServerIds: (
    settings: Pick<ServerSettings, "robloxStudio" | "mcpServers">,
    target: RobloxProjectTarget,
  ) => Effect.Effect<ReadonlySet<string>>;
  /** The Studio instructions for a turn in this project, or undefined when they do not apply. */
  readonly instructions: (
    settings: Pick<ServerSettings, "robloxStudio">,
    target: RobloxProjectTarget & { readonly cwd: string },
  ) => Effect.Effect<string | undefined>;
}

const disabledEnvironment: RobloxStudioEnvironment = {
  studioBridge: undefined,
  officialMcpPath: undefined,
  studioInstalled: false,
  blenderJobsRoot: "",
  detectedBlender: undefined,
  detectedBlenderMcp: undefined,
};

/**
 * A reference rather than a required service: a harness that never sets it up runs no Roblox
 * servers and adds no instructions, which is also what the settings' default (`off`) means.
 */
export const RobloxStudioConfig = Context.Reference<RobloxStudioConfigShape>(
  "t3/roblox/RobloxStudioConfig",
  {
    defaultValue: () => ({
      environment: disabledEnvironment,
      managedServers: () => ({}),
      detect: () => Effect.succeed({ applies: false, reason: "studio-off" }),
      appliesTo: () => Effect.succeed(false),
      hiddenServerIds: () => Effect.succeed(new Set<string>()),
      // @effect-diagnostics-next-line effectSucceedWithVoid:off - No instructions is a value, not a void step.
      instructions: () => Effect.succeed(undefined),
    }),
  },
);

/** Blender in its usual install folders, plus Steam libraries on other drives. */
export const detectBlender = Effect.fn("RobloxStudioConfig.detectBlender")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  const exists = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );
  if (platform === "darwin") {
    const app = "/Applications/Blender.app/Contents/MacOS/Blender";
    return (yield* exists(app)) ? app : undefined;
  }
  if (platform !== "win32") {
    for (const candidate of ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender"]) {
      if (yield* exists(candidate)) return candidate;
    }
    return undefined;
  }
  const candidates: string[] = [];
  const roots = [
    env.ProgramFiles && path.join(env.ProgramFiles, "Blender Foundation"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Blender Foundation"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Blender Foundation"),
  ].filter((root): root is string => typeof root === "string" && root !== "");
  for (const root of roots) {
    const versions = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
    for (const version of versions) candidates.push(path.join(root, version, "blender.exe"));
  }
  // Steam is often installed on another drive, where nothing in the environment points to it.
  const steamRoots = [
    ...[env["ProgramFiles(x86)"], env.ProgramFiles]
      .filter((root): root is string => typeof root === "string" && root !== "")
      .map((root) => path.join(root, "Steam")),
    ..."CDEFGH".split("").flatMap((drive) => [`${drive}:\\Steam`, `${drive}:\\SteamLibrary`]),
  ];
  const libraries = new Set(steamRoots);
  for (const steam of steamRoots) {
    const folders = yield* fs
      .readFileString(path.join(steam, "steamapps", "libraryfolders.vdf"))
      .pipe(Effect.orElseSucceed(() => ""));
    for (const match of folders.matchAll(/"path"\s+"([^"]+)"/g)) {
      if (match[1]) libraries.add(match[1].replaceAll("\\\\", "\\"));
    }
  }
  for (const library of libraries) {
    candidates.push(path.join(library, "steamapps", "common", "Blender", "blender.exe"));
  }
  const versionOf = (file: string) =>
    (path.basename(path.dirname(file)).match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  const found: string[] = [];
  for (const candidate of candidates) {
    if (yield* exists(candidate)) found.push(candidate);
  }
  found.sort((left, right) => {
    const [leftMajor = 0, leftMinor = 0] = versionOf(left);
    const [rightMajor = 0, rightMinor = 0] = versionOf(right);
    return rightMajor - leftMajor || rightMinor - leftMinor;
  });
  return found[0];
});

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;

  const localAppData = platform === "win32" ? env.LOCALAPPDATA?.trim() : undefined;
  const officialMcpPath =
    localAppData === undefined || localAppData === ""
      ? undefined
      : path.join(localAppData, "Roblox", "mcp.bat");
  const officialAvailable =
    officialMcpPath !== undefined &&
    (yield* fs.exists(officialMcpPath).pipe(Effect.orElseSucceed(() => false)));
  const studioInstalled =
    localAppData !== undefined &&
    localAppData !== "" &&
    (yield* fs
      .exists(path.join(localAppData, "Roblox", "Versions"))
      .pipe(Effect.orElseSucceed(() => false)));
  const blenderMcpCandidate = path.join(
    home,
    ".mcp-for-blender",
    platform === "win32" ? "Scripts" : "bin",
    platform === "win32" ? "mcp-for-blender.exe" : "mcp-for-blender",
  );
  const detectedBlenderMcp = (yield* fs
    .exists(blenderMcpCandidate)
    .pipe(Effect.orElseSucceed(() => false)))
    ? blenderMcpCandidate
    : undefined;

  const crypto = yield* Crypto.Crypto;
  const configuredPort = Number(env.SEALCODE_STUDIO_BRIDGE_PORT?.trim() ?? "");
  const studioBridge: StudioBridgeEndpoint = {
    port:
      Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536
        ? configuredPort
        : DEFAULT_STUDIO_BRIDGE_PORT,
    // A fresh token per run: only this process's tool gateway may call the bridge's tools. A
    // maintainer can pin one to attach another MCP client while debugging.
    mcpToken:
      env.SEALCODE_STUDIO_BRIDGE_MCP_TOKEN?.trim() ||
      Buffer.from(yield* crypto.randomBytes(24).pipe(Effect.orDie)).toString("base64url"),
  };

  const studioSkillCatalog = skillCatalog(yield* loadStudioSkills);

  const environment: RobloxStudioEnvironment = {
    studioBridge,
    officialMcpPath: officialAvailable ? officialMcpPath : undefined,
    studioInstalled,
    blenderJobsRoot: path.join(config.stateDir, "blender-jobs"),
    detectedBlender: yield* detectBlender().pipe(Effect.orElseSucceed(() => undefined)),
    detectedBlenderMcp,
  };

  const listings = new Map<string, { readonly value: RobloxFolderListing; readonly at: number }>();
  const listFolder = Effect.fn("RobloxStudioConfig.listFolder")(function* (root: string) {
    const cached = listings.get(root);
    const now = yield* Clock.currentTimeMillis;
    if (cached !== undefined && now - cached.at < PROJECT_DETECTION_TTL_MS) return cached.value;
    const read = (folder: string) => fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => []));
    const entries = yield* read(root);
    const nested = yield* Effect.forEach(
      subfoldersToScan(entries),
      (entry) => read(path.join(root, entry)),
      { concurrency: 8 },
    );
    const value = { root: entries, nested: nested.flat() };
    listings.set(root, { value, at: now });
    if (listings.size > 256) listings.delete(listings.keys().next().value ?? root);
    return value;
  });

  const containerFolders = new Set(
    [home, ...["Documents", "Desktop", "Downloads"].map((folder) => path.join(home, folder))].map(
      (folder) => path.resolve(folder).toLowerCase(),
    ),
  );
  const isContainerFolder = (root: string) => {
    const resolved = path.resolve(root);
    return containerFolders.has(resolved.toLowerCase()) || path.dirname(resolved) === resolved;
  };

  const scratchRoot = path.resolve(config.baseDir, "scratch").toLowerCase();

  const detect: RobloxStudioConfigShape["detect"] = Effect.fn("RobloxStudioConfig.detect")(
    function* (settings, target) {
      if (settings.robloxStudio.mode === "off") return { applies: false, reason: "studio-off" };
      const root = target.workspaceRoot;
      const mode = target.mode ?? "auto";
      const allProjects = settings.robloxStudio.scope === "all-projects";
      const scratchFolder = root !== undefined && path.resolve(root).toLowerCase() === scratchRoot;
      const listing =
        root === undefined || mode !== "auto" || allProjects || scratchFolder
          ? { root: [], nested: [] }
          : yield* listFolder(root);
      return decideRobloxProject({
        mode,
        allProjects,
        hasGameIcon: target.projectIcon?.kind === "roblox-game",
        containerFolder: root === undefined || isContainerFolder(root),
        scratchFolder,
        folderNames:
          root === undefined
            ? []
            : [path.basename(root), path.basename(path.dirname(root))].filter(
                (name) => name.length > 0,
              ),
        title: target.title,
        listing,
        placeNames: target.placeNames ?? [],
      });
    },
  );

  const appliesTo: RobloxStudioConfigShape["appliesTo"] = (settings, target) =>
    detect(settings, target).pipe(Effect.map((detection) => detection.applies));

  const hiddenServerIds: RobloxStudioConfigShape["hiddenServerIds"] = Effect.fn(
    "RobloxStudioConfig.hiddenServerIds",
  )(function* (settings, target) {
    const managed = Object.keys(managedServersFor(settings, environment)).filter(
      (id) => settings.mcpServers[id] === undefined,
    );
    if (managed.length === 0) return new Set<string>();
    return (yield* appliesTo(settings, target)) ? new Set<string>() : new Set(managed);
  });

  const instructions: RobloxStudioConfigShape["instructions"] = Effect.fn(
    "RobloxStudioConfig.instructions",
  )(function* (settings, target) {
    const roblox = settings.robloxStudio;
    if (roblox.mode !== "sealcode" || !roblox.instructions) return undefined;
    const workspaceRoot = target.workspaceRoot ?? target.cwd;
    if (!(yield* appliesTo(settings, { ...target, workspaceRoot }))) return undefined;
    return studioBridgeInstructions({
      skillCatalog: studioSkillCatalog,
      autoPlaytest: roblox.autoPlaytest,
      officialMcp: roblox.officialMcpAlongside && environment.officialMcpPath !== undefined,
      blenderMcp: roblox.blenderMcp,
    });
  });

  return {
    environment,
    managedServers: (settings) => managedServersFor(settings, environment),
    detect,
    appliesTo,
    hiddenServerIds,
    instructions,
  } satisfies RobloxStudioConfigShape;
});

export const layer = Layer.effect(RobloxStudioConfig, make);
