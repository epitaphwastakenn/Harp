import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import * as RojoWorkspaces from "../roblox/RojoWorkspaces.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { STUDIO_PROTOCOL_VERSION } from "./protocol.ts";
import * as StudioBridge from "./StudioBridge.ts";
import * as Evidence from "./studioEvidence.ts";
import * as StudioTools from "./StudioTools.ts";
import {
  planUndo,
  takeUndo,
  walkUndo,
  type UndoEntry,
  type UndoOutcome,
  type UndoRestorers,
} from "./studioUndo.ts";

const plugin = (data: Record<string, unknown>): UndoEntry => ({ source: "plugin", data });

const turnOf = (
  calls: ReadonlyArray<{
    seq: number;
    tool: string;
    entries?: ReadonlyArray<UndoEntry>;
    ok?: boolean;
    write?: boolean;
    snapshotDropped?: boolean;
  }>,
  dropped = 0,
) => ({
  runId: "run-1",
  dropped,
  undone: false,
  calls: calls.map((call) => ({
    seq: call.seq,
    tool: call.tool,
    ok: call.ok ?? true,
    write: call.write ?? true,
    targets: [],
    snapshot:
      call.entries === undefined ? undefined : { instanceId: "place:1", entries: call.entries },
    snapshotDropped: call.snapshotDropped ?? false,
  })),
});

describe("takeUndo", () => {
  it("moves the plugin's before-state out of the answer the model reads", () => {
    const taken = takeUndo({
      success: true,
      path: "game.A",
      undo: [
        { kind: "deleted", token: "u:1", path: "game.Workspace.Part" },
        { kind: "deleted", token: "u:2", path: "game.Workspace.Other" },
      ],
    });
    expect(taken.payload).toEqual({ success: true, path: "game.A" });
    expect(taken.entries).toHaveLength(2);
    expect(takeUndo({ success: true, undo: { kind: "script", path: "game.A" } }).entries).toEqual([
      plugin({ kind: "script", path: "game.A" }),
    ]);
    expect(takeUndo({ success: true }).entries).toEqual([]);
  });
});

describe("planUndo", () => {
  it("walks the newest change first and names what cannot be undone", () => {
    const plan = planUndo(
      turnOf([
        { seq: 1, tool: "set_properties", entries: [plugin({ kind: "properties", path: "a" })] },
        { seq: 2, tool: "execute_luau" },
        {
          seq: 3,
          tool: "find_and_replace_in_scripts",
          entries: [plugin({ kind: "script", path: "s1" }), plugin({ kind: "script", path: "s2" })],
        },
        { seq: 4, tool: "set_properties", ok: false },
        { seq: 5, tool: "get_script_source", write: false },
        { seq: 6, tool: "execute_luau" },
        { seq: 7, tool: "import_mesh", snapshotDropped: true },
      ]),
    );
    expect(
      plan.steps.map((step) => [step.seq, step.entry.source === "plugin" && step.entry.data.path]),
    ).toEqual([
      [3, "s2"],
      [3, "s1"],
      [1, "a"],
    ]);
    expect(plan.counts).toMatchObject({ scripts: 2, properties: 1 });
    expect(plan.notUndoable.map((note) => note.what)).toEqual([
      "import_mesh",
      "execute_luau (2 calls)",
    ]);
  });

  it("reports calls that fell out of the record", () => {
    const plan = planUndo(turnOf([], 3));
    expect(plan.notUndoable).toEqual([
      { what: "3 earlier calls", reason: "They fell out of the turn's record" },
    ]);
  });
});

const fileEntry = (relative: string, studio: boolean): UndoEntry => ({
  source: "file",
  absolute: `/p/${relative}`,
  relative,
  previous: "old",
  written: "new",
  studio: studio ? { kind: "script", path: relative, source: "old", lenient: true } : undefined,
});

const restorers = (
  fileOutcome: (relative: string) => UndoOutcome,
  pluginOutcome: (data: Record<string, unknown>) => UndoOutcome,
) => {
  const log: string[] = [];
  const value: UndoRestorers = {
    restoreFile: (entry) =>
      Effect.sync(() => {
        log.push(`file ${entry.relative}`);
        return fileOutcome(entry.relative);
      }),
    restorePlugin: ({ entries }) =>
      Effect.sync(() => {
        log.push(`plugin ${entries.map((data) => String(data.path)).join(",")}`);
        return entries.map(pluginOutcome);
      }),
  };
  return { log, value };
};

describe("walkUndo", () => {
  it.effect("restores files first, then every Studio entry in one reverse-ordered batch", () =>
    Effect.gen(function* () {
      const plan = planUndo(
        turnOf([
          { seq: 1, tool: "set_properties", entries: [plugin({ kind: "properties", path: "p1" })] },
          { seq: 2, tool: "edit_script", entries: [fileEntry("A.luau", true)] },
          { seq: 3, tool: "build_instances", entries: [plugin({ kind: "journal", path: "b" })] },
        ]),
      );
      const { log, value } = restorers(
        () => ({ status: "restored" }),
        () => ({ status: "restored" }),
      );
      const run = yield* walkUndo(plan, value);
      expect(log).toEqual(["file A.luau", "plugin b,A.luau,p1"]);
      expect(run.restored).toMatchObject({ files: 1, properties: 1, builds: 1 });
      expect(run.skipped).toEqual([]);
      expect(run.changed).toBe(true);
    }),
  );

  it.effect("skips a conflicting file and leaves its Studio copy alone", () =>
    Effect.gen(function* () {
      const plan = planUndo(
        turnOf([{ seq: 1, tool: "edit_script", entries: [fileEntry("A.luau", true)] }]),
      );
      const { log, value } = restorers(
        () => ({ status: "skipped", reason: "The file changed since the agent wrote it" }),
        () => ({ status: "restored" }),
      );
      const run = yield* walkUndo(plan, value);
      expect(log).toEqual(["file A.luau"]);
      expect(run.restored.files).toBe(0);
      expect(run.skipped).toEqual([
        { what: "file A.luau", reason: "The file changed since the agent wrote it" },
      ]);
      expect(run.changed).toBe(false);
    }),
  );

  it.effect("reports what changed since and counts a partial restore", () =>
    Effect.gen(function* () {
      const plan = planUndo(
        turnOf([
          { seq: 1, tool: "set_properties", entries: [plugin({ kind: "properties", path: "p1" })] },
          { seq: 2, tool: "set_properties", entries: [plugin({ kind: "properties", path: "p2" })] },
          { seq: 3, tool: "delete_instances", entries: [plugin({ kind: "deleted", path: "d" })] },
        ]),
      );
      const { value } = restorers(
        () => ({ status: "restored" }),
        (data) =>
          data.path === "p2"
            ? { status: "skipped", reason: "Anchored changed since the agent set it" }
            : data.path === "p1"
              ? { status: "partial", reason: "Color changed since the agent set it" }
              : { status: "restored" },
      );
      const run = yield* walkUndo(plan, value);
      expect(run.restored).toMatchObject({ deleted: 1, properties: 1 });
      expect(run.skipped).toEqual([
        { what: "properties of p2", reason: "Anchored changed since the agent set it" },
        { what: "properties of p1", reason: "Color changed since the agent set it" },
      ]);
    }),
  );

  it.effect("keeps the failure when Studio never answers", () =>
    Effect.gen(function* () {
      const plan = planUndo(
        turnOf([
          { seq: 1, tool: "set_properties", entries: [plugin({ kind: "properties", path: "p" })] },
        ]),
      );
      const run = yield* walkUndo(plan, {
        restoreFile: () => Effect.succeed({ status: "restored" }),
        restorePlugin: () => Effect.fail("Studio did not answer"),
      });
      expect(run.pluginFailure).toBe("Studio did not answer");
      expect(run.changed).toBe(false);
      expect(run.skipped[0]?.reason).toBe("Studio did not answer");
    }),
  );
});

const layer = StudioTools.layer.pipe(
  Layer.provideMerge(StudioBridge.layer),
  Layer.provide(ServerSettingsService.layerTest()),
  Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
  Layer.provide(RojoWorkspaces.layerNone),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

describe("undoing a finished turn through the bridge", () => {
  it.effect("captures before-states, hides them from the model and reverts once", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const bridge = yield* StudioBridge.StudioBridge;
      const ledger = yield* Evidence.StudioEvidence;
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
      const seen: Array<{ endpoint: string; data: Record<string, unknown> }> = [];
      const fake = yield* Effect.forever(
        Effect.gen(function* () {
          const messages = yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 20 });
          for (const message of messages) {
            if (message.kind !== "request") continue;
            seen.push({
              endpoint: message.endpoint,
              data: message.data as Record<string, unknown>,
            });
            const payload =
              message.endpoint === "set-properties"
                ? {
                    success: true,
                    path: "game.Workspace.Part",
                    undo: { kind: "properties", path: "game.Workspace.Part", props: {} },
                  }
                : message.endpoint === "delete-instances"
                  ? {
                      success: true,
                      removed: ["game.Workspace.Old"],
                      undo: [{ kind: "deleted", token: "u:1", path: "game.Workspace.Old" }],
                    }
                  : message.endpoint === "undo-apply"
                    ? {
                        success: true,
                        results: [{ status: "restored" }, { status: "skipped", reason: "moved" }],
                      }
                    : { success: true };
            yield* bridge.respond({ requestId: message.requestId, payload });
          }
        }),
      ).pipe(Effect.forkChild);

      yield* ledger.runStarted("t", "run-1");
      const set = yield* tools.call(
        "set_properties",
        { path: "game.Workspace.Part", properties: { Anchored: true } },
        { threadId: "t" },
      );
      expect(JSON.stringify(set)).not.toContain("props");
      yield* tools.call("delete_instances", { paths: ["game.Workspace.Old"] }, { threadId: "t" });
      yield* tools.call("execute_luau", { code: "print(1)" }, { threadId: "t" });
      expect(seen[0]?.data.captureUndo).toBe("t");

      const busy = yield* tools.undoTurnChanges({
        threadId: "t",
        runId: "run-1",
        fromAgent: false,
      });
      expect(busy.status).toBe("unavailable");
      yield* ledger.runEnded("t", "run-1");

      const preview = yield* tools.undoPreview({ threadId: "t", runId: "run-1" });
      expect(preview).toMatchObject({
        available: true,
        studioConnected: true,
        counts: { properties: 1, deleted: 1 },
        notUndoable: [{ what: "execute_luau" }],
      });

      const result = yield* tools.undoTurnChanges({
        threadId: "t",
        runId: "run-1",
        fromAgent: false,
      });
      expect(result).toMatchObject({
        status: "done",
        restored: { deleted: 1, properties: 0 },
        skipped: [{ what: "properties of game.Workspace.Part", reason: "moved" }],
      });
      const sent = seen.find((entry) => entry.endpoint === "undo-apply");
      expect(sent?.data.undoKey).toBe("t");
      const sentEntries = (sent?.data.entries ?? []) as ReadonlyArray<{ kind: string }>;
      expect(sentEntries.map((entry) => entry.kind)).toEqual(["deleted", "properties"]);

      const again = yield* tools.undoTurnChanges({
        threadId: "t",
        runId: "run-1",
        fromAgent: false,
      });
      expect(again).toMatchObject({ status: "unavailable" });
      expect(yield* tools.undoPreview({ threadId: "t", runId: "run-1" })).toMatchObject({
        available: false,
        reason: "These changes were already undone.",
      });
      yield* Fiber.interrupt(fake);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("says the record is gone when the ledger has no such turn", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      expect(yield* tools.undoPreview({ threadId: "none", runId: "run-9" })).toMatchObject({
        available: false,
        reason: expect.stringContaining("server restart"),
      });
    }).pipe(Effect.provide(layer)),
  );
});
