import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId, type RobloxStudioSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  BLENDER_MCP_SERVER_ID,
  blenderExecutableFor,
  hiddenOfficialTools,
  layer as robloxStudioConfigLayer,
  managedServersFor,
  OFFICIAL_SERVER_ID,
  RobloxStudioConfig,
  robloxProjectTarget,
  STUDIO_BRIDGE_SERVER_ID,
  type RobloxStudioEnvironment,
} from "./RobloxStudioConfig.ts";

const environment: RobloxStudioEnvironment = {
  studioBridge: { port: 58760, mcpToken: "token" },
  officialMcpPath: "C:\\Users\\me\\AppData\\Local\\Roblox\\mcp.bat",
  studioInstalled: true,
  blenderJobsRoot: "/state/blender-jobs",
  docsCacheRoot: "",
  detectedBlender: "C:\\Blender\\blender.exe",
  detectedBlenderMcp: undefined,
};

const withRoblox = (patch: Partial<RobloxStudioSettings>) => ({
  robloxStudio: { ...DEFAULT_SERVER_SETTINGS.robloxStudio, ...patch },
});

describe("managedServersFor", () => {
  it("runs nothing while the Roblox settings are off", () => {
    expect(managedServersFor(withRoblox({ mode: "off", blenderMcp: true }), environment)).toEqual(
      {},
    );
  });

  it("points the Harp mode at the in-server bridge's MCP endpoint, with its token as a secret", () => {
    const servers = managedServersFor(
      withRoblox({ mode: "sealcode", officialMcpAlongside: false }),
      environment,
    );
    expect(Object.keys(servers)).toEqual([STUDIO_BRIDGE_SERVER_ID]);
    expect(servers[STUDIO_BRIDGE_SERVER_ID]).toMatchObject({
      transport: "streamable-http",
      url: "http://127.0.0.1:58760/mcp",
      headers: [{ name: "Authorization", value: "Bearer token", sensitive: true }],
    });
  });

  it("runs Roblox's own MCP alone, or beside Harp's bridge when asked", () => {
    expect(Object.keys(managedServersFor(withRoblox({ mode: "official" }), environment))).toEqual([
      OFFICIAL_SERVER_ID,
    ]);
    expect(
      Object.keys(
        managedServersFor(
          withRoblox({ mode: "sealcode", officialMcpAlongside: true }),
          environment,
        ),
      ),
    ).toEqual([STUDIO_BRIDGE_SERVER_ID, OFFICIAL_SERVER_ID]);
    expect(
      Object.keys(
        managedServersFor(withRoblox({ mode: "off", officialMcpAlongside: true }), environment),
      ),
    ).toEqual([]);
    expect(
      managedServersFor(withRoblox({ mode: "official" }), {
        ...environment,
        officialMcpPath: undefined,
      }),
    ).toEqual({});
  });

  it("starts a Blender MCP from its detected install, a configured command, or uvx", () => {
    const blender = (patch: Partial<RobloxStudioSettings>, detected?: string) =>
      managedServersFor(withRoblox({ mode: "official", blenderMcp: true, ...patch }), {
        ...environment,
        detectedBlenderMcp: detected,
      })[BLENDER_MCP_SERVER_ID];
    expect(blender({})).toMatchObject({ command: "uvx", args: ["blender-mcp"] });
    expect(blender({}, "C:\\mcp-for-blender.exe")).toMatchObject({
      command: "C:\\mcp-for-blender.exe",
      args: [],
    });
    expect(blender({ blenderMcpCommand: "my-blender", blenderMcpArgs: ["--x"] })).toMatchObject({
      command: "my-blender",
      args: ["--x"],
    });
  });
});

describe("hiddenOfficialTools", () => {
  const settings = (patch: Partial<RobloxStudioSettings>, mcpServers = {}) => ({
    ...withRoblox(patch),
    mcpServers,
  });

  it("hides the tools Harp already has only while both servers run", () => {
    const beside = hiddenOfficialTools(settings({ mode: "sealcode", officialMcpAlongside: true }));
    expect(beside.has("roblox-studio-official:execute_luau")).toBe(true);
    expect(beside.has("roblox-studio-official:generate_mesh")).toBe(false);
    expect(hiddenOfficialTools(settings({ mode: "official" })).size).toBe(0);
    expect(
      hiddenOfficialTools(settings({ mode: "sealcode", officialMcpAlongside: false })).size,
    ).toBe(0);
  });

  it("leaves a server the user configured under the same id alone", () => {
    const own = settings(
      { mode: "sealcode", officialMcpAlongside: true },
      { [OFFICIAL_SERVER_ID]: {} },
    );
    expect(hiddenOfficialTools(own as never).size).toBe(0);
  });
});

describe("blenderExecutableFor", () => {
  it("prefers the configured Blender over the one found", () => {
    expect(blenderExecutableFor(DEFAULT_SERVER_SETTINGS.robloxStudio, environment)).toBe(
      "C:\\Blender\\blender.exe",
    );
    expect(
      blenderExecutableFor(
        { ...DEFAULT_SERVER_SETTINGS.robloxStudio, blenderExecutable: "D:\\b\\blender.exe" },
        environment,
      ),
    ).toBe("D:\\b\\blender.exe");
  });
});

describe("a project's Roblox tools and instructions", () => {
  const configLayer = robloxStudioConfigLayer.pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-roblox-config-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  const projectId = ProjectId.make("project-1");
  const settings = (robloxProject?: "auto" | "roblox" | "other") => ({
    ...DEFAULT_SERVER_SETTINGS,
    ...withRoblox({ mode: "sealcode" }),
    projectSettingsOverrides: robloxProject ? { [projectId]: { robloxProject } } : {},
  });
  const project = (workspaceRoot: string) => ({ id: projectId, title: "Tools", workspaceRoot });

  const folder = Effect.fn("test.folder")(function* (files: ReadonlyArray<string>) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-project-" });
    yield* Effect.forEach(files, (file) => fs.writeFileString(path.join(root, file), ""));
    return root;
  });

  it.effect("gates everything together for a Rojo project and a code project", () =>
    Effect.gen(function* () {
      const roblox = yield* RobloxStudioConfig;
      const game = yield* folder(["default.project.json"]);
      const site = yield* folder(["package.json"]);
      const current = settings();
      const gameTarget = robloxProjectTarget(current, project(game), []);
      const siteTarget = robloxProjectTarget(current, project(site), []);

      expect((yield* roblox.detect(current, gameTarget)).reason).toBe("project-files");
      expect(yield* roblox.instructions(current, { ...gameTarget, cwd: game })).toContain(
        "roblox-collaboration-mode",
      );
      expect((yield* roblox.hiddenServerIds(current, gameTarget)).has("studio")).toBe(false);

      expect(yield* roblox.instructions(current, { ...siteTarget, cwd: site })).toBeUndefined();
      expect((yield* roblox.hiddenServerIds(current, siteTarget)).has("studio")).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(configLayer)),
  );

  it.effect("turns a code project into a Roblox one by the project setting, and back", () =>
    Effect.gen(function* () {
      const roblox = yield* RobloxStudioConfig;
      const site = yield* folder(["package.json"]);
      const on = settings("roblox");
      const off = settings("other");

      expect(
        (yield* roblox.hiddenServerIds(on, robloxProjectTarget(on, project(site), []))).size,
      ).toBe(0);
      expect(
        yield* roblox.instructions(off, {
          ...robloxProjectTarget(off, project(site), []),
          cwd: site,
        }),
      ).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(configLayer)),
  );

  it.effect("follows Studio in the No project folder", () =>
    Effect.gen(function* () {
      const roblox = yield* RobloxStudioConfig;
      const config = yield* ServerConfig.ServerConfig;
      const path = yield* Path.Path;
      const current = settings();
      const target = (places: ReadonlyArray<{ placeName: string }>) =>
        robloxProjectTarget(current, project(path.resolve(config.baseDir, "scratch")), places);

      expect((yield* roblox.hiddenServerIds(current, target([]))).has("studio")).toBe(true);
      const open = target([{ placeName: "match" }]);
      expect((yield* roblox.detect(current, open)).reason).toBe("studio-open");
      expect((yield* roblox.hiddenServerIds(current, open)).has("studio")).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(configLayer)),
  );

  it.effect("becomes a Roblox project when Studio connects to a blank folder", () =>
    Effect.gen(function* () {
      const roblox = yield* RobloxStudioConfig;
      const blank = yield* folder(["notes.md"]);
      const current = settings();
      const target = (places: ReadonlyArray<{ placeName: string }>) =>
        robloxProjectTarget(current, project(blank), places);

      expect(yield* roblox.appliesTo(current, target([]))).toBe(false);
      expect(yield* roblox.appliesTo(current, target([{ placeName: "match" }]))).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(configLayer)),
  );
});
