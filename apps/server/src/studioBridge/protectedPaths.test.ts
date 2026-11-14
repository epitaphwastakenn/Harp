import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { canonicalInstancePath, instancePathProblem } from "@t3tools/shared/instancePath";
import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import * as RojoWorkspaces from "../roblox/RojoWorkspaces.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { STUDIO_PROTOCOL_VERSION } from "./protocol.ts";
import { firstProtectedHit, instanceRefsOf, protectedTargetsOf } from "./protectedPaths.ts";
import * as StudioBridge from "./StudioBridge.ts";
import { studioControlsContext } from "./instructions.ts";
import * as StudioTools from "./StudioTools.ts";

const layer = StudioTools.layer.pipe(
  Layer.provideMerge(StudioBridge.layer),
  Layer.provide(
    ServerSettingsService.layerTest({
      robloxStudio: {
        protectedPlaces: [
          {
            placeKey: "anon:a",
            placeName: "Lobby",
            paths: ["game.ServerStorage.Data", "game.Workspace.Map"],
          },
        ],
      },
    }),
  ),
  Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
  Layer.provide(RojoWorkspaces.layerNone),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const fakePlace = (instanceId: string, refs: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const bridge = yield* StudioBridge.StudioBridge;
    const { sessionToken } = yield* bridge.hello({
      protocol: STUDIO_PROTOCOL_VERSION,
      build: "test",
      pluginSessionId: `session-${instanceId}`,
      instanceId,
      role: "edit",
      placeId: 0,
      gameId: 0,
      placeName: "Lobby",
      dataModelName: "Lobby",
      isRunning: false,
      studioVersion: "",
      pluginHash: "h",
      capabilities: [],
      toggles: { paused: false, readOnly: false, allowLuau: true },
    });
    const calls: Array<{ endpoint: string; data: any }> = [];
    const fiber = yield* Effect.forever(
      Effect.gen(function* () {
        const messages = yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 20 });
        for (const message of messages) {
          if (message.kind !== "request") continue;
          calls.push({ endpoint: message.endpoint, data: message.data });
          yield* bridge.respond({
            requestId: message.requestId,
            payload:
              message.endpoint === "resolve-refs"
                ? { paths: refs }
                : message.endpoint === "find-replace-scripts"
                  ? {
                      success: true,
                      results: [
                        { path: "game.ServerStorage.Data.Save", count: 1, newText: "x" },
                        { path: "game.Workspace.Other", count: 1, newText: "x" },
                      ],
                    }
                  : { success: true },
          });
        }
      }),
    ).pipe(Effect.forkChild);
    return { calls, fiber };
  });

const textOf = (result: { readonly content: ReadonlyArray<any> }) =>
  result.content[0].text as string;

const hit = (rules: string[], path: string, reach: "within" | "subtree" = "within") =>
  firstProtectedHit(rules, [{ path, reach }]) !== undefined;

describe("protected path matching", () => {
  it("matches by instance boundary, not by string prefix", () => {
    const rules = ["game.Workspace.Map"];
    expect(hit(rules, "game.Workspace.Map")).toBe(true);
    expect(hit(rules, "game.Workspace.Map.Tree.Leaf")).toBe(true);
    expect(hit(rules, 'game.Workspace["Map"].Tree')).toBe(true);
    expect(hit(rules, "Workspace.map.Tree")).toBe(true);
    expect(hit(rules, "game.Workspace.Map2")).toBe(false);
    expect(hit(rules, "game.Workspace.Map2.Tree")).toBe(false);
    expect(hit(rules, "game.Workspace")).toBe(false);
    expect(hit(rules, "game.Workspace", "subtree")).toBe(true);
    expect(hit(rules, "game.Workspace.Maps", "subtree")).toBe(false);
  });

  it("normalises and validates paths", () => {
    expect(canonicalInstancePath("workspace.Map")).toBe("game.Workspace.Map");
    expect(canonicalInstancePath('game.ReplicatedStorage["My Packages"]')).toBe(
      'game.ReplicatedStorage["My Packages"]',
    );
    expect(instancePathProblem("game.ServerStorage.Data")).toBeUndefined();
    expect(instancePathProblem("")).toBeDefined();
    expect(instancePathProblem("game")).toBeDefined();
    expect(instancePathProblem("game.Workspace[Map]")).toBeDefined();
  });

  it("finds the paths each tool would change", () => {
    const paths = (tool: string, args: Record<string, unknown>) =>
      protectedTargetsOf(tool, args).map((target) => `${target.reach}:${target.path}`);
    expect(paths("set_properties", { path: "game.A.B", properties: { Name: "C" } })).toEqual([
      "subtree:game.A.B",
    ]);
    expect(paths("set_properties", { path: "game.A.B", properties: { Parent: "game.X" } })).toEqual(
      ["subtree:game.A.B", "within:game.X"],
    );
    expect(paths("delete_instances", { paths: ["game.A", "game.B"] })).toEqual([
      "subtree:game.A",
      "subtree:game.B",
    ]);
    expect(paths("insert_asset", { assetId: 1 })).toEqual(["within:game.Workspace"]);
    expect(paths("import_mesh", { parentPath: "game.A" })).toEqual(["within:game.A"]);
    expect(paths("find_and_replace_in_scripts", { path: "game.A" })).toEqual([]);
    expect(paths("find_and_replace_in_scripts", { path: "game.A", dryRun: false })).toEqual([
      "within:game.A",
    ]);
    expect(
      paths("build_instances", {
        path: "game.Workspace.Folder",
        operations: [
          { op: "create", parent: "$root" },
          { op: "scatter", parent: "game.Workspace.Map.Trees" },
          { op: "remove", target: "game.Workspace.Folder.Old" },
        ],
      }),
    ).toEqual([
      "within:game.Workspace.Folder",
      "within:game.Workspace.Map.Trees",
      "subtree:game.Workspace.Folder.Old",
    ]);
    expect(
      paths("animation", { action: "create", rig: "game.Workspace.R", parent: "ServerStorage" }),
    ).toEqual(["within:game.Workspace.R", "within:game.ServerStorage"]);
    expect(paths("animation", { action: "play", rig: "game.Workspace.R" })).toEqual([]);
    expect(instanceRefsOf("delete_instances", { instanceRefs: ["ir:1", "ir:1", "ir:2"] })).toEqual([
      "ir:1",
      "ir:2",
    ]);
  });

  it("tells agents which paths are protected", () => {
    const text = studioControlsContext(undefined, [
      { placeName: "Lobby", paths: ["game.ServerStorage.Data"] },
      { placeName: "Empty", paths: [] },
    ]);
    expect(text).toContain("Lobby: game.ServerStorage.Data");
    expect(text).not.toContain("Empty");
    expect(studioControlsContext(undefined, [])).toBeUndefined();
  });
});

describe("protected path enforcement", () => {
  it.effect("refuses changes at or under a protected path and lets the rest through", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const place = yield* fakePlace("anon:a");
      const refused = [
        ["set_properties", { path: "game.ServerStorage.Data.Config", properties: { Value: 1 } }],
        ["delete_instances", { paths: ["game.Workspace.Other", "game.ServerStorage"] }],
        ["edit_script", { path: "game.ServerStorage.Data.Save", edits: [] }],
        ["build_instances", { path: "game.Workspace.Map", operations: [{ op: "create" }] }],
        ["insert_asset", { assetId: 1, parentPath: "game.Workspace.Map.Props" }],
      ] as const;
      for (const [name, args] of refused) {
        const result = yield* tools.call(name, args, {});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("protected_path");
      }
      expect(place.calls).toEqual([]);
      const allowed = yield* tools.call(
        "set_properties",
        { path: "game.Workspace.Map2", properties: { Name: "X" } },
        {},
      );
      expect(allowed.isError).not.toBe(true);
      const read = yield* tools.call(
        "get_instance_properties",
        { path: "game.ServerStorage.Data" },
        {},
      );
      expect(read.isError).not.toBe(true);
      expect(place.calls.map((call) => call.endpoint)).toEqual([
        "set-properties",
        "get-properties",
      ]);
      yield* Fiber.interrupt(place.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("resolves instance refs to paths before deciding", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const place = yield* fakePlace("anon:a", {
        "ir:bad": "game.ServerStorage.Data.Config",
        "ir:ok": "game.Workspace.Part",
      });
      const bad = yield* tools.call("delete_instances", { instanceRefs: ["ir:ok", "ir:bad"] }, {});
      expect(bad.isError).toBe(true);
      expect(textOf(bad)).toContain("game.ServerStorage.Data.Config");
      const ok = yield* tools.call("delete_instances", { instanceRefs: ["ir:ok"] }, {});
      expect(ok.isError).not.toBe(true);
      expect(place.calls.map((call) => call.endpoint)).toEqual([
        "resolve-refs",
        "resolve-refs",
        "delete-instances",
      ]);
      yield* Fiber.interrupt(place.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("leaves protected scripts out of find and replace and hands Luau the paths", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const place = yield* fakePlace("anon:a");
      const dry = yield* tools.call("find_and_replace_in_scripts", { find: "a", replace: "b" }, {});
      expect(textOf(dry)).toContain("game.Workspace.Other");
      expect(textOf(dry)).not.toContain("ServerStorage.Data.Save");
      expect(textOf(dry)).toContain("skippedProtected");
      yield* tools.call("execute_luau", { code: "return 1" }, {});
      const luau = place.calls.find((call) => call.endpoint === "execute-luau");
      expect(luau?.data.protectedPaths).toEqual(["game.ServerStorage.Data", "game.Workspace.Map"]);
      yield* Fiber.interrupt(place.fiber);
    }).pipe(Effect.provide(layer)),
  );
});
