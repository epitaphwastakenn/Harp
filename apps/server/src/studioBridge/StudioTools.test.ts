import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { studioCodeToolRisks } from "@t3tools/shared/studioCode";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import * as RojoWorkspaces from "../roblox/RojoWorkspaces.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { decodePng } from "./png.ts";
import { STUDIO_PROTOCOL_VERSION } from "./protocol.ts";
import * as StudioBridge from "./StudioBridge.ts";
import { handleMcpMessage } from "./studioMcp.ts";
import * as StudioTools from "./StudioTools.ts";
import { StudioEvidence } from "./studioEvidence.ts";

const layer = StudioTools.layer.pipe(
  Layer.provideMerge(StudioBridge.layer),
  Layer.provide(ServerSettingsService.layerTest()),
  Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
  Layer.provide(RojoWorkspaces.layerNone),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

/** A stand-in plugin: answers each endpoint through `answer` until interrupted. */
const fakePlugin = (answer: (endpoint: string, data: any) => unknown) =>
  Effect.gen(function* () {
    const bridge = yield* StudioBridge.StudioBridge;
    const { sessionToken } = yield* bridge.hello({
      protocol: STUDIO_PROTOCOL_VERSION,
      build: "test",
      pluginSessionId: "edit",
      instanceId: "anon:place",
      role: "edit",
      placeId: 0,
      gameId: 0,
      placeName: "Place",
      dataModelName: "Place",
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
            payload: answer(message.endpoint, message.data),
          });
        }
      }),
    ).pipe(Effect.forkChild);
    return { calls, fiber };
  });

const textOf = (result: { readonly content: ReadonlyArray<any> }) =>
  result.content[0].text as string;

describe("StudioTools", () => {
  it.effect("verifies a script write by reading the whole script back", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin((endpoint) =>
        endpoint === "edit-script"
          ? {
              success: true,
              path: "game.ServerScriptService.Main",
              revision: "r1:5:aa",
              instanceRef: "ir:x:1",
            }
          : { path: "game.ServerScriptService.Main", revision: "r1:5:aa", lineCount: 1 },
      );
      const result = yield* tools.call(
        "edit_script",
        { path: "game.ServerScriptService.Main", edits: [{ old_string: "a", new_string: "b" }] },
        {},
      );
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain("verified revision r1:5:aa");
      expect(plugin.calls.map((call) => call.endpoint)).toEqual([
        "edit-script",
        "get-script-source",
      ]);
      expect(plugin.calls[1]!.data).toMatchObject({ instanceRef: "ir:x:1", lineRange: "1-" });
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("says a write is unverified when Studio holds another revision", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin((endpoint) =>
        endpoint === "set-script-source"
          ? { success: true, revision: "r1:5:aa" }
          : { revision: "r1:9:bb" },
      );
      const result = yield* tools.call(
        "set_script_source",
        { path: "game.Workspace.Script", source: "print()", expectedRevision: "r1:0:00" },
        {},
      );
      expect(textOf(result)).toContain("Do not describe this change as verified");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("writes an empty script without a revision but refuses a non-empty one", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      let body = "  \n";
      const plugin = yield* fakePlugin((endpoint, data) =>
        endpoint === "get-script-source"
          ? { rawSource: body, revision: `rev-${body.length}` }
          : { success: true, revision: "after", expected: data.expectedRevision },
      );
      const ok = yield* tools.call(
        "set_script_source",
        { path: "game.Workspace.S", source: "x" },
        {},
      );
      expect(ok.isError).toBeUndefined();
      expect(
        plugin.calls.find((call) => call.endpoint === "set-script-source")!.data.expectedRevision,
      ).toBe("rev-3");
      body = "print('hi')";
      const refused = yield* tools.call(
        "set_script_source",
        { path: "game.Workspace.S", source: "x" },
        {},
      );
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("expected_revision_required");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "refuses a screenshot during a playtest instead of waiting for one that never comes",
    () =>
      Effect.gen(function* () {
        const tools = yield* StudioTools.StudioTools;
        const bridge = yield* StudioBridge.StudioBridge;
        const plugin = yield* fakePlugin(() => ({
          success: true,
          width: 1,
          height: 1,
          data: "AAAAAA==",
        }));
        yield* bridge.hello({
          protocol: STUDIO_PROTOCOL_VERSION,
          build: "test",
          pluginSessionId: "server",
          instanceId: "anon:place",
          role: "server",
          placeId: 0,
          gameId: 0,
          placeName: "Place",
          dataModelName: "Place",
          isRunning: true,
          studioVersion: "",
          pluginHash: "h",
          capabilities: [],
          toggles: { paused: false, readOnly: false, allowLuau: true },
        });
        const result = yield* tools.call("capture_screenshot", {}, {});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("playtest_running");
        expect(plugin.calls).toHaveLength(0);
        yield* Fiber.interrupt(plugin.fiber);
      }).pipe(Effect.provide(layer)),
  );

  it.effect("counts the play server leaving during a stop as the playtest stopping", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const bridge = yield* StudioBridge.StudioBridge;
      const plugin = yield* fakePlugin(() => ({}));
      const { sessionToken } = yield* bridge.hello({
        protocol: STUDIO_PROTOCOL_VERSION,
        build: "test",
        pluginSessionId: "server",
        instanceId: "anon:place",
        role: "server",
        placeId: 0,
        gameId: 0,
        placeName: "Place",
        dataModelName: "Place",
        isRunning: true,
        studioVersion: "",
        pluginHash: "h",
        capabilities: [],
        toggles: { paused: false, readOnly: false, allowLuau: true },
      });
      // The play server takes the stop request and its DataModel closes before it answers.
      const server = yield* Effect.gen(function* () {
        const messages = yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 20 });
        if (messages.some((message) => message.kind === "request")) yield* bridge.bye(sessionToken);
      }).pipe(Effect.repeat({ while: () => true }), Effect.forkChild);
      const result = yield* tools.call("playtest", { action: "stop" }, {});
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain("Playtest stopped.");
      yield* Fiber.interrupt(server);
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reports a plugin that predates an endpoint as outdated", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin((endpoint) => ({ error: `Unknown endpoint: ${endpoint}` }));
      const result = yield* tools.call("get_place_info", {}, {});
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("plugin_outdated");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("folds a print that several peers echoed into one log entry", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const bridge = yield* StudioBridge.StudioBridge;
      const plugin = yield* fakePlugin(() => ({
        entries: [{ seq: 4, ts: 100, level: "OUT", message: "hello" }],
        nextSince: 4,
        totalDropped: 0,
      }));
      const { sessionToken } = yield* bridge.hello({
        protocol: STUDIO_PROTOCOL_VERSION,
        build: "test",
        pluginSessionId: "server",
        instanceId: "anon:place",
        role: "server",
        placeId: 0,
        gameId: 0,
        placeName: "Place",
        dataModelName: "Place",
        isRunning: true,
        studioVersion: "",
        pluginHash: "h",
        capabilities: [],
        toggles: { paused: false, readOnly: false, allowLuau: true },
      });
      const server = yield* Effect.forever(
        Effect.gen(function* () {
          for (const message of yield* bridge.poll({
            sessionToken,
            inFlight: [],
            waitSeconds: 20,
          })) {
            if (message.kind !== "request") continue;
            yield* bridge.respond({
              requestId: message.requestId,
              payload: {
                entries: [{ seq: 1, ts: 101, level: "OUT", message: "hello" }],
                nextSince: 1,
                totalDropped: 0,
              },
            });
          }
        }),
      ).pipe(Effect.forkChild);
      const result = yield* tools.call("get_output_logs", {}, {});
      const parsed = JSON.parse(textOf(result));
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]).toMatchObject({ peer: "edit", alsoSeenBy: ["server"] });
      expect(parsed.next).toEqual({ edit: 4, server: 1 });
      yield* Fiber.interrupt(plugin.fiber);
      yield* Fiber.interrupt(server);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "saves an export to disk without handing the bytes to the model, and never overwrites",
    () =>
      Effect.gen(function* () {
        const tools = yield* StudioTools.StudioTools;
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const bytes = Buffer.from("rbxm-bytes");
        const plugin = yield* fakePlugin(() => ({
          success: true,
          base64: bytes.toString("base64"),
          instances: [{ path: "game.Workspace.A", className: "Model" }],
        }));
        const target = `${dir}/nested/model.rbxm`;
        const saved = yield* tools.call(
          "export_rbxm",
          { paths: ["game.Workspace.A"], outputPath: target },
          {},
        );
        expect(saved.isError).toBeUndefined();
        expect(textOf(saved)).not.toContain(bytes.toString("base64"));
        expect(Buffer.from(yield* fs.readFile(target)).equals(bytes)).toBe(true);
        const again = yield* tools.call(
          "export_rbxm",
          { paths: ["game.Workspace.A"], outputPath: target },
          {},
        );
        expect(textOf(again)).toContain("file_exists");
        const xml = yield* tools.call(
          "export_rbxm",
          { paths: ["game.Workspace.A"], outputPath: `${dir}/model.rbxmx` },
          {},
        );
        expect(textOf(xml)).toContain("invalid_arguments");
        expect(plugin.calls).toHaveLength(1);
        yield* Fiber.interrupt(plugin.fiber);
      }).pipe(
        Effect.scoped,
        Effect.provide(Layer.mergeAll(layer, NodeServices.layer, NodeCrypto.layer)),
      ),
  );

  it.effect("sends a file's bytes and parent to the plugin when importing", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const bytes = Buffer.from("rbxm-bytes");
      yield* fs.writeFile(`${dir}/in.rbxm`, bytes);
      const plugin = yield* fakePlugin(() => ({ success: true, imported: [] }));
      const result = yield* tools.call(
        "import_rbxm",
        { filePath: `${dir}/in.rbxm`, parentPath: "game.ServerStorage" },
        {},
      );
      expect(result.isError).toBeUndefined();
      expect(plugin.calls[0]).toMatchObject({
        endpoint: "import-rbxm",
        data: { base64: bytes.toString("base64"), parentPath: "game.ServerStorage" },
      });
      const missing = yield* tools.call("import_rbxm", { filePath: `${dir}/none.rbxm` }, {});
      expect(textOf(missing)).toContain("not_found");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(layer, NodeServices.layer, NodeCrypto.layer)),
    ),
  );

  it.effect("checks network profile values before touching any peer", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const loss = yield* tools.call(
        "set_network_profile",
        { profile: "custom", overrides: { InboundNetworkLossPercent: 2 } },
        {},
      );
      expect(loss.isError).toBe(true);
      expect(textOf(loss)).toContain("invalid_arguments");
      const plugin = yield* fakePlugin(() => ({ success: true }));
      const noClients = yield* tools.call("set_network_profile", { profile: "poor" }, {});
      expect(textOf(noClients)).toContain("runtime_client_required");
      expect(plugin.calls).toHaveLength(0);
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("sends an animation description to the edit peer after checking its shape", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin(() => ({ success: true, temporaryId: "abc" }));
      const empty = yield* tools.call(
        "animation",
        { action: "create", rig: "game.Workspace.Rig", keyframes: [] },
        {},
      );
      expect(textOf(empty)).toContain("invalid_arguments");
      const noSource = yield* tools.call(
        "animation",
        { action: "play", rig: "game.Workspace.Rig" },
        {},
      );
      expect(textOf(noSource)).toContain("sequence");
      const keyframes = [
        { time: 0, poses: {} },
        { time: 1, poses: { Neck: { rotation: [0, 10, 0] } } },
      ];
      const created = yield* tools.call(
        "animation",
        { action: "create", rig: "game.Workspace.Rig", name: "Nod", keyframes },
        {},
      );
      expect(created.isError).toBeUndefined();
      expect(plugin.calls).toHaveLength(1);
      expect(plugin.calls[0]).toMatchObject({
        endpoint: "animation-create",
        data: { rig: "game.Workspace.Rig", name: "Nod", keyframes },
      });
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("returns motion checks with create and refuses errors when strict", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin(() => ({ success: true, temporaryId: "abc" }));
      const keyframes = [
        { time: 0, poses: {} },
        { time: 0.5, poses: { LeftKnee: { rotation: [60, 0, 0] } } },
      ];
      const refused = yield* tools.call(
        "animation",
        { action: "create", rig: "game.Workspace.Rig", keyframes, strict: true },
        {},
      );
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("animation_checks_failed");
      expect(textOf(refused)).toContain("LeftKnee");
      expect(plugin.calls).toHaveLength(0);
      const created = yield* tools.call(
        "animation",
        { action: "create", rig: "game.Workspace.Rig", keyframes },
        {},
      );
      expect(created.isError).toBeUndefined();
      expect(plugin.calls).toHaveLength(1);
      expect(created.structuredContent).toMatchObject({
        temporaryId: "abc",
        checks: { errors: 1, findings: [{ kind: "range", joint: "LeftKnee", severity: "error" }] },
      });
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("tiles posed captures into one contact sheet image in time order", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const pixel = Buffer.alloc(8 * 6 * 4, 120).toString("base64");
      const plugin = yield* fakePlugin((endpoint) =>
        endpoint === "capture-screenshot"
          ? { success: true, width: 8, height: 6, data: pixel }
          : { success: true, length: 2, looped: false },
      );
      const sheet = yield* tools.call(
        "animation",
        {
          action: "contactSheet",
          rig: "game.Workspace.Rig",
          sequence: "game.Workspace.Rig.Swing",
          frames: 4,
          settleSeconds: 0,
        },
        {},
      );
      expect(sheet.isError).toBeUndefined();
      const info = JSON.parse(textOf(sheet));
      expect(info.frames.map((frame: { time: number }) => frame.time)).toEqual([
        0, 0.667, 1.333, 2,
      ]);
      expect(info.grid).toMatchObject({ columns: 4, rows: 1 });
      const image = sheet.content[1] as { type: string; data: string };
      expect(image.type).toBe("image");
      const decoded = decodePng(Buffer.from(image.data, "base64"));
      expect(decoded.width).toBe(4 * 8 + 5 * 4);
      const plays = plugin.calls.filter((call) => call.endpoint === "animation-play");
      expect(plays.map((call) => call.data.time ?? call.data.action)).toEqual([
        0,
        0.667,
        1.333,
        2,
        "stop",
      ]);
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("serves the tool list and calls over JSON-RPC with the thread id", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const bridge = yield* StudioBridge.StudioBridge;
      const listed = yield* handleMcpMessage(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        tools,
        bridge.markAgentLinked,
      );
      expect(listed.kind).toBe("json");
      const names = (listed as any).body.result.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain("get_script_source");
      expect((yield* bridge.snapshot).agentLinked).toBe(true);
      const called = yield* handleMcpMessage(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_place_info", arguments: {}, _meta: { "sealcode/threadId": "t1" } },
        },
        tools,
        Effect.void,
      );
      const result = (called as any).body.result;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no_studio_connected");
      const notification = yield* handleMcpMessage(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        tools,
        Effect.void,
      );
      expect(notification.kind).toBe("accepted");
    }).pipe(Effect.provide(layer)),
  );
});

describe("Studio panel catalog", () => {
  it.effect("lists every tool exactly once, so each one has a switch", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const catalog = yield* Effect.promise(() =>
        import("node:fs/promises").then((fs) =>
          fs.readFile(
            new URL("../../resources/studio-plugin/Catalog.luau", import.meta.url),
            "utf8",
          ),
        ),
      );
      const listed = [...catalog.matchAll(/\{ "([a-z_]+)", "/gu)].map((match) => match[1]);
      expect(listed.toSorted()).toEqual(tools.list.map((tool) => tool.name).toSorted());
    }).pipe(Effect.provide(layer)),
  );
});

describe("code tools", () => {
  it.effect("share their risk with the approval card", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      for (const [name, risk] of Object.entries(studioCodeToolRisks)) {
        expect(tools.list.find((tool) => tool.name === name)?.risk).toBe(risk);
      }
    }).pipe(Effect.provide(layer)),
  );
});

describe("script tools in a Rojo workspace", () => {
  const rojoLayer = StudioTools.layer.pipe(
    Layer.provideMerge(StudioBridge.layer),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
    Layer.provide(RojoWorkspaces.layer),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

  const makeWorkspace = Effect.fn("makeWorkspace")(function* (source: string) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "harp-rojo-tools-" });
    yield* fs.makeDirectory(`${root}/src/server`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/default.project.json`,
      JSON.stringify({
        name: "game",
        servePort: 45871,
        tree: { $className: "DataModel", ServerScriptService: { $path: "src/server" } },
      }),
    );
    yield* fs.writeFileString(`${root}/src/server/Main.server.luau`, source);
    return root;
  });

  it.effect("saves an edit to the synced file and keeps Studio the same", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tools = yield* StudioTools.StudioTools;
      const root = yield* makeWorkspace("print('a')\r\nprint('z')\r\n");
      let studio = "print('a')\nprint('z')\n";
      const plugin = yield* fakePlugin((endpoint, data) => {
        if (endpoint === "set-script-source") {
          studio = data.source;
          return { success: true, revision: "r2" };
        }
        return { path: "game.ServerScriptService.Main", rawSource: studio, revision: "r1" };
      });
      const result = yield* tools.call(
        "edit_script",
        {
          path: "game.ServerScriptService.Main",
          edits: [{ old_string: "print('a')", new_string: "print('b')" }],
        },
        { workspaceRoot: root },
      );
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(textOf(result))).toMatchObject({
        success: true,
        file: "src/server/Main.server.luau",
        savedTo: "file",
      });
      expect(yield* fs.readFileString(`${root}/src/server/Main.server.luau`)).toBe(
        "print('b')\r\nprint('z')\r\n",
      );
      expect(studio).toBe("print('b')\nprint('z')\n");
      expect(plugin.calls.some((call) => call.endpoint === "edit-script")).toBe(false);

      const read = yield* tools.call(
        "get_script_source",
        { path: "game.ServerScriptService.Main" },
        { workspaceRoot: root },
      );
      expect(JSON.parse(textOf(read))).toMatchObject({ file: "src/server/Main.server.luau" });

      const stale = yield* tools.call(
        "set_script_source",
        { path: "game.ServerScriptService.Main", source: "x", expectedRevision: "old" },
        { workspaceRoot: root },
      );
      expect(stale.isError).toBe(true);
      expect(textOf(stale)).toContain("source_revision_conflict");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.scoped, Effect.provide(rojoLayer)),
  );

  it.effect("leaves scripts that are not in files to Studio", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const root = yield* makeWorkspace("print('a')\n");
      const plugin = yield* fakePlugin((endpoint) =>
        endpoint === "edit-script"
          ? { success: true, path: "game.Workspace.Door.Script", revision: "r2" }
          : { path: "game.Workspace.Door.Script", rawSource: "print(1)", revision: "r2" },
      );
      const result = yield* tools.call(
        "edit_script",
        { path: "game.Workspace.Door.Script", edits: [{ old_string: "1", new_string: "2" }] },
        { workspaceRoot: root },
      );
      expect(textOf(result)).toContain("verified revision r2");
      expect(plugin.calls.some((call) => call.endpoint === "edit-script")).toBe(true);
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.scoped, Effect.provide(rojoLayer)),
  );
});

describe("find_and_replace_in_scripts", () => {
  const plan = {
    totalReplacements: 3,
    scriptsSearched: 5,
    scriptsMatched: 2,
    truncated: false,
    results: [
      {
        path: "game.Workspace.A",
        instanceRef: "ref-a",
        className: "Script",
        revision: "ra",
        count: 2,
        snippets: [{ line: 1, context: "old()", old: "old", new: "fresh" }],
        newText: "fresh() fresh()",
      },
      {
        path: "game.Workspace.B",
        instanceRef: "ref-b",
        className: "ModuleScript",
        revision: "rb",
        count: 1,
        snippets: [],
        newText: "fresh()",
      },
    ],
  };

  it.effect("lists counts and snippets without writing anything by default", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin(() => plan);
      const result = yield* tools.call(
        "find_and_replace_in_scripts",
        { find: "old", replace: "fresh" },
        {},
      );
      const body = JSON.parse(textOf(result));
      expect(body).toMatchObject({ success: true, dryRun: true, totalReplacements: 3 });
      expect(body.results[0].newText).toBeUndefined();
      expect(plugin.calls.map((call) => call.endpoint)).toEqual(["find-replace-scripts"]);
      expect(plugin.calls[0]!.data).toMatchObject({ includeText: false, usePattern: false });
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("writes each script with its revision and keeps going past a failure", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin((endpoint, data) => {
        if (endpoint === "find-replace-scripts") return plan;
        if (endpoint === "get-script-source") {
          return { rawSource: "x", revision: data.path === "game.Workspace.A" ? "wa" : "wb" };
        }
        return data.path === "game.Workspace.A"
          ? { error: "Source revision conflict", errorCode: "source_revision_conflict" }
          : { success: true, path: data.path, revision: "wb" };
      });
      const result = yield* tools.call(
        "find_and_replace_in_scripts",
        { find: "old", replace: "fresh", dryRun: false },
        {},
      );
      const body = JSON.parse(textOf(result));
      expect(body.written).toEqual([
        {
          path: "game.Workspace.B",
          count: 1,
          verification: "Read the script back and verified revision wb.",
        },
      ]);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0].path).toBe("game.Workspace.A");
      const writes = plugin.calls.filter((call) => call.endpoint === "set-script-source");
      expect(
        writes.map((call) => [call.data.path, call.data.source, call.data.expectedRevision]),
      ).toEqual([
        ["game.Workspace.A", "fresh() fresh()", "ra"],
        ["game.Workspace.B", "fresh()", "rb"],
      ]);
      expect(plugin.calls[0]!.data.includeText).toBe(true);
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses an empty find and unknown classes before asking Studio", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const empty = yield* tools.call(
        "find_and_replace_in_scripts",
        { find: "", replace: "x" },
        {},
      );
      expect(empty.isError).toBe(true);
      const classes = yield* tools.call(
        "find_and_replace_in_scripts",
        { find: "a", replace: "b", classes: ["Part"] },
        {},
      );
      expect(textOf(classes)).toContain("invalid_arguments");
    }).pipe(Effect.provide(layer)),
  );
});

describe("scene analysis modes and scatter", () => {
  it.effect("forwards the scene analysis mode and a scatter step to Studio", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin(() => ({ success: true }));
      yield* tools.call("get_scene_analysis", { mode: "unparented", topN: 5 }, {});
      const scatter = {
        op: "scatter",
        name: "Trees",
        templates: [{ path: "game.ReplicatedStorage.Tree", weight: 2 }],
        zone: { min: [0, 0, 0], max: [50, 10, 50] },
        density: 3,
        seed: 7,
      };
      yield* tools.call(
        "build_instances",
        { path: "game.Workspace.Forest", operations: [scatter] },
        {},
      );
      expect(plugin.calls[0]).toMatchObject({
        endpoint: "scene-analysis",
        data: { mode: "unparented", topN: 5 },
      });
      expect(plugin.calls[1]).toMatchObject({
        endpoint: "build-instances",
        data: { path: "game.Workspace.Forest", operations: [scatter] },
      });
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );
});

describe("Rojo sync guard and structural saves", () => {
  const rojoLayer = StudioTools.layer.pipe(
    Layer.provideMerge(StudioBridge.layer),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
    Layer.provide(RojoWorkspaces.layer),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

  const makeWorkspace = Effect.fn("makeStructuralWorkspace")(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "harp-rojo-structure-" });
    yield* fs.makeDirectory(`${root}/src/server`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/default.project.json`,
      JSON.stringify({
        name: "game",
        servePort: 45873,
        tree: { $className: "DataModel", ServerScriptService: { $path: "src/server" } },
      }),
    );
    yield* fs.writeFileString(`${root}/src/server/Main.server.luau`, "print('a')\n");
    return root;
  });

  const mainPath = "game.ServerScriptService.Main";

  it.effect("reports the sync status and refuses a playtest while Studio is behind the file", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const root = yield* makeWorkspace();
      const plugin = yield* fakePlugin((endpoint) => {
        if (endpoint === "set-script-source") return { success: true, revision: "r2" };
        if (endpoint === "start-playtest") return { error: "stopped here" };
        return { path: mainPath, rawSource: "print('a')\n", revision: "r1" };
      });
      const written = yield* tools.call(
        "edit_script",
        { path: mainPath, edits: [{ old_string: "'a'", new_string: "'b'" }] },
        { workspaceRoot: root, threadId: "t1" },
      );
      expect(JSON.parse(textOf(written))).toMatchObject({ success: true, syncStatus: "diverged" });

      const refused = yield* tools.call(
        "playtest",
        { action: "start" },
        { workspaceRoot: root, threadId: "t1" },
      );
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("rojo_sync_diverged");
      expect(textOf(refused)).toContain(mainPath);
      expect(plugin.calls.some((call) => call.endpoint === "start-playtest")).toBe(false);

      const otherThread = yield* tools.call(
        "playtest",
        { action: "start" },
        { workspaceRoot: root, threadId: "t2" },
      );
      expect(textOf(otherThread)).not.toContain("rojo_sync_diverged");
      const forced = yield* tools.call(
        "playtest",
        { action: "start", force: true },
        { workspaceRoot: root, threadId: "t1" },
      );
      expect(textOf(forced)).not.toContain("rojo_sync_diverged");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.scoped, Effect.provide(rojoLayer)),
  );

  it.effect("refuses to overwrite a file when Studio holds unsaved edits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tools = yield* StudioTools.StudioTools;
      const root = yield* makeWorkspace();
      let studio = "print('a')\n";
      const plugin = yield* fakePlugin((endpoint, data) => {
        if (endpoint === "set-script-source") {
          studio = data.source;
          return { success: true, revision: "r3" };
        }
        return { path: mainPath, rawSource: studio, revision: "r1" };
      });
      const context = { workspaceRoot: root, threadId: "t1" };
      yield* tools.call("get_script_source", { path: mainPath }, context);
      studio = "print('typed in Studio')\n";
      const refused = yield* tools.call(
        "edit_script",
        { path: mainPath, edits: [{ old_string: "'a'", new_string: "'b'" }] },
        context,
      );
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("studio_unsaved_changes");
      expect(yield* fs.readFileString(`${root}/src/server/Main.server.luau`)).toBe("print('a')\n");
      const forced = yield* tools.call(
        "edit_script",
        { path: mainPath, edits: [{ old_string: "'a'", new_string: "'b'" }], force: true },
        context,
      );
      expect(forced.isError).toBeUndefined();
      expect(yield* fs.readFileString(`${root}/src/server/Main.server.luau`)).toBe("print('b')\n");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.scoped, Effect.provide(rojoLayer)),
  );

  it.effect("saves new scripts and folders as files and says what stays Studio-only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tools = yield* StudioTools.StudioTools;
      const root = yield* makeWorkspace();
      const plugin = yield* fakePlugin(() => ({ success: true }));
      const result = yield* tools.call(
        "build_instances",
        {
          path: "game.ServerScriptService",
          operations: [
            {
              op: "create",
              className: "ModuleScript",
              name: "Service",
              id: "svc",
              properties: { Source: "return {}" },
            },
            { op: "create", className: "ModuleScript", name: "Types", parent: "$svc" },
            { op: "create", className: "Folder", name: "Data" },
            { op: "create", className: "StringValue", name: "Version" },
          ],
        },
        { workspaceRoot: root, threadId: "t1" },
      );
      expect(result.isError).toBeUndefined();
      const body = JSON.parse(textOf(result));
      expect(body.rojo.files).toEqual([
        "src/server/Service",
        "src/server/Service/init.luau",
        "src/server/Service/Types.luau",
        "src/server/Data",
      ]);
      expect(body.rojo.studioOnly).toEqual(["StringValue"]);
      expect(yield* fs.readFileString(`${root}/src/server/Service/init.luau`)).toBe("return {}");
      const sent = plugin.calls.find((call) => call.endpoint === "build-instances");
      expect(sent?.data.operations).toHaveLength(4);
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.scoped, Effect.provide(rojoLayer)),
  );

  it.effect("moves deleted synced scripts to the trash folder and renames their files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tools = yield* StudioTools.StudioTools;
      const root = yield* makeWorkspace();
      yield* fs.writeFileString(`${root}/src/server/Old.luau`, "return 1\n");
      const plugin = yield* fakePlugin(() => ({ success: true }));
      const context = { workspaceRoot: root, threadId: "t1" };
      const renamed = yield* tools.call(
        "set_properties",
        { path: "game.ServerScriptService.Old", properties: { Name: "Fresh" } },
        context,
      );
      expect(JSON.parse(textOf(renamed)).rojo.files).toEqual(["src/server/Fresh.luau"]);
      expect(yield* fs.exists(`${root}/src/server/Old.luau`)).toBe(false);
      const deleted = yield* tools.call(
        "delete_instances",
        { paths: ["game.ServerScriptService.Fresh", "game.Workspace.Part"] },
        context,
      );
      const body = JSON.parse(textOf(deleted));
      const trashed: string = body.rojo.trashedTo[0];
      expect(trashed).toMatch(/^\.harp\/rojo-trash\/[^/]+\/src\/server\/Fresh\.luau$/u);
      expect(yield* fs.readFileString(`${root}/${trashed}`)).toBe("return 1\n");
      expect(yield* fs.exists(`${root}/src/server/Fresh.luau`)).toBe(false);
      const sent = plugin.calls.filter((call) => call.endpoint === "delete-instances");
      expect(sent.at(-1)?.data.paths).toEqual([
        "game.ServerScriptService.Fresh",
        "game.Workspace.Part",
      ]);
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.scoped, Effect.provide(rojoLayer)),
  );
});

describe("image generation tools", () => {
  const imageLayer = (robloxStudio: Record<string, unknown>) =>
    StudioTools.layer.pipe(
      Layer.provideMerge(StudioBridge.layer),
      Layer.provide(ServerSettingsService.layerTest({ robloxStudio })),
      Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
      Layer.provide(RojoWorkspaces.layerNone),
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    );

  it.effect("are advertised only once image generation is on and configured", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const names = (yield* tools.advertised).map((tool) => tool.name);
      expect(names).not.toContain("generate_image");
      expect(names).toContain("stage_texture_preview");
      expect(tools.list.map((tool) => tool.name)).toContain("generate_image");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("advertise generate_image as destructive while approval is required", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const advertised = yield* tools.advertised;
      expect(advertised.find((tool) => tool.name === "generate_image")?.risk).toBe("irreversible");
    }).pipe(
      Effect.provide(
        imageLayer({ imageGeneration: true, imageApiKey: "k", imageRequireApproval: true }),
      ),
    ),
  );

  it.effect("stop at the per-turn cap before calling the service", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const evidence = yield* StudioEvidence;
      yield* evidence.reserveImages({ threadId: "thread-1", wanted: 2, cap: 2 });
      const result = yield* tools.call(
        "generate_image",
        { prompt: "a spark", purpose: "particle" },
        { threadId: "thread-1" },
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining("image_cap_reached"),
      });
    }).pipe(
      Effect.provide(
        imageLayer({
          imageGeneration: true,
          imageApiKey: "k",
          imageMaxPerTurn: 2,
          imageProvider: "custom",
          imageBaseUrl: "http://127.0.0.1:9/v1",
          imageModel: "test-model",
        }),
      ),
    ),
  );
});
