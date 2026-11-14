import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import * as RojoWorkspaces from "../roblox/RojoWorkspaces.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { STUDIO_PROTOCOL_VERSION } from "./protocol.ts";
import * as StudioBridge from "./StudioBridge.ts";
import * as Evidence from "./studioEvidence.ts";
import * as StudioTools from "./StudioTools.ts";

type Finished = Parameters<typeof Evidence.applyCall>[1];

const call = (
  tool: string,
  args: Record<string, unknown>,
  extra: { risk?: "read" | "mutation" | "irreversible"; ok?: boolean; verification?: string } = {},
): Finished => ({
  tool,
  risk: extra.risk ?? "mutation",
  args,
  ok: extra.ok ?? true,
  at: 0,
  ...(extra.verification === undefined ? {} : { structured: { verification: extra.verification } }),
});

const verifiedLine = "Read the script back and verified revision r1.";

const derive = (calls: ReadonlyArray<Finished>) => {
  const turn = Evidence.emptyTurn("run-1");
  for (const entry of calls) Evidence.applyCall(turn, entry);
  return Evidence.deriveEvidence(turn);
};

describe("deriveEvidence", () => {
  it("is not applicable when the turn only read from Studio", () => {
    const evidence = derive([
      call("get_script_source", { path: "game.A" }, { risk: "read" }),
      call("get_output_logs", {}, { risk: "read", ok: false }),
    ]);
    expect(evidence.verdict).toBe("notApplicable");
  });

  it("flags scripts that changed without a playtest and without a read-back", () => {
    const evidence = derive([
      call("edit_script", { path: "game.A" }, { verification: verifiedLine }),
      call("set_script_source", { path: "game.B" }, { verification: "Did not verify: x" }),
    ]);
    expect(evidence.verdict).toBe("unverified");
    expect(evidence.issues).toEqual([
      "1 script write was not read back to verify",
      "Scripts changed but no playtest ran",
    ]);
    expect(evidence.targets).toEqual(["game.A", "game.B"]);
  });

  it("is verified once scripts are read back and a playtest ran clean", () => {
    const evidence = derive([
      call("edit_script", { path: "game.A" }, { verification: verifiedLine }),
      call("playtest", { action: "start" }),
      call("get_output_logs", {}, { risk: "read" }),
    ]);
    expect(evidence).toMatchObject({ verdict: "verified", issues: [], playtests: 1 });
  });

  it("clears playtest errors when a new playtest starts", () => {
    const turn = Evidence.emptyTurn("run-1");
    Evidence.applyCall(
      turn,
      call("edit_script", { path: "game.A" }, { verification: verifiedLine }),
    );
    Evidence.applyCall(turn, call("playtest", { action: "start" }));
    turn.playtestErrors = 3;
    expect(Evidence.deriveEvidence(turn).issues).toEqual(["The last playtest printed 3 errors"]);
    Evidence.applyCall(turn, call("playtest", { action: "start" }));
    expect(Evidence.deriveEvidence(turn).verdict).toBe("verified");
  });

  it("wants a UI audit after UI changes and counts failures", () => {
    const changed = derive([
      call("build_instances", {
        path: "game.StarterGui",
        operations: [{ op: "create", className: "ScreenGui" }],
      }),
      call("set_properties", { path: "game.Workspace.Part" }, { ok: false }),
    ]);
    expect(changed.issues).toEqual([
      "1 Studio tool call failed (set_properties)",
      "UI changed without a UI audit",
    ]);
    const audited = derive([
      call("build_instances", { path: "game.StarterGui" }),
      call("inspect_ui", {}, { risk: "read" }),
    ]);
    expect(audited).toMatchObject({ verdict: "verified", uiChanges: 1, uiAudited: true });
  });
});

describe("isPlaceWrite", () => {
  it("separates edits to the place from playtests, reads and runtime calls", () => {
    expect(Evidence.isPlaceWrite("edit_script", "mutation", {})).toBe(true);
    expect(Evidence.isPlaceWrite("get_script_source", "read", {})).toBe(false);
    expect(Evidence.isPlaceWrite("playtest", "mutation", { action: "start" })).toBe(false);
    expect(Evidence.isPlaceWrite("execute_luau", "irreversible", {})).toBe(true);
    expect(Evidence.isPlaceWrite("execute_luau", "irreversible", { target: "server" })).toBe(false);
    expect(Evidence.isPlaceWrite("animation", "mutation", { action: "play" })).toBe(false);
    expect(Evidence.isPlaceWrite("animation", "mutation", { action: "create" })).toBe(true);
    expect(Evidence.isPlaceWrite("some_new_tool", "mutation", {})).toBe(true);
  });
});

describe("StudioEvidence ledger", () => {
  it.effect("keeps a turn's evidence under its run id and starts the next turn empty", () =>
    Effect.gen(function* () {
      const ledger = yield* Evidence.StudioEvidence;
      yield* ledger.runStarted("t1", "run-1");
      yield* ledger.record({ threadId: "t1", call: call("edit_script", { path: "game.A" }) });
      yield* ledger.runEnded("t1", "run-1");
      yield* ledger.runStarted("t1", "run-2");
      expect((yield* ledger.evidence({ threadId: "t1", runId: "run-1" })).writes).toBe(1);
      expect((yield* ledger.evidence({ threadId: "t1", runId: "run-2" })).verdict).toBe(
        "notApplicable",
      );
    }).pipe(Effect.provide(Evidence.layer)),
  );

  it.effect("counts playtest errors only for threads that ran a playtest this turn", () =>
    Effect.gen(function* () {
      const ledger = yield* Evidence.StudioEvidence;
      yield* ledger.runStarted("t1", "run-1");
      yield* ledger.runStarted("t2", "run-2");
      yield* ledger.record({ threadId: "t1", call: call("playtest", { action: "start" }) });
      yield* ledger.record({ threadId: "t1", call: call("edit_script", { path: "game.A" }) });
      yield* ledger.record({ threadId: "t2", call: call("edit_script", { path: "game.B" }) });
      yield* ledger.playtestError(["t1", "t2"]);
      expect((yield* ledger.evidence({ threadId: "t1", runId: "run-1" })).playtestErrors).toBe(1);
      expect((yield* ledger.evidence({ threadId: "t2", runId: "run-2" })).playtestErrors).toBe(0);
    }).pipe(Effect.provide(Evidence.layer)),
  );

  it.effect("lets one thread write a place at a time and frees it when the turn ends", () =>
    Effect.gen(function* () {
      const ledger = yield* Evidence.StudioEvidence;
      yield* ledger.threadTitled("a", "Obby combat");
      expect(yield* ledger.claimWrite({ place: "place:1", threadId: "a" })).toEqual({ ok: true });
      expect(yield* ledger.claimWrite({ place: "place:1", threadId: "a" })).toEqual({ ok: true });
      expect(yield* ledger.claimWrite({ place: "place:1", threadId: "b" })).toEqual({
        ok: false,
        holder: "a",
        holderTitle: "Obby combat",
      });
      expect(yield* ledger.claimWrite({ place: "place:2", threadId: "b" })).toEqual({ ok: true });
      yield* ledger.runStarted("a", "run-1");
      yield* ledger.runEnded("a", "run-1");
      expect(yield* ledger.claimWrite({ place: "place:1", threadId: "b" })).toEqual({ ok: true });
    }).pipe(Effect.provide(Evidence.layer)),
  );

  it("treats only an applying find_and_replace_in_scripts as a place write", () => {
    expect(Evidence.isPlaceWrite("find_and_replace_in_scripts", "mutation", {})).toBe(false);
    expect(Evidence.isPlaceWrite("find_and_replace_in_scripts", "mutation", { dryRun: true })).toBe(
      false,
    );
    expect(
      Evidence.isPlaceWrite("find_and_replace_in_scripts", "mutation", { dryRun: false }),
    ).toBe(true);
  });

  it("counts scripts written by an applying find_and_replace_in_scripts", () => {
    const turn = Evidence.emptyTurn("run-1");
    Evidence.applyCall(turn, {
      ...call("find_and_replace_in_scripts", { dryRun: false }),
      structured: {
        written: [
          { path: "game.A", verification: "Read the script back and verified it" },
          { path: "game.B" },
        ],
      },
    });
    expect(turn.scriptsWritten).toBe(2);
    expect(turn.scriptsVerified).toBe(1);
  });

  it.effect("reserves images atomically against the per-turn cap", () =>
    Effect.gen(function* () {
      const ledger = yield* Evidence.StudioEvidence;
      const input = { threadId: "t1", wanted: 4, cap: 4 };
      expect(yield* ledger.reserveImages(input)).toBe(4);
      expect(yield* ledger.reserveImages(input)).toBe(0);
      yield* ledger.releaseImages("t1", 3);
      expect(yield* ledger.reserveImages(input)).toBe(3);
    }).pipe(Effect.provide(Evidence.layer)),
  );

  it.effect("keeps a live run's lease when an older run ends and releases on demand", () =>
    Effect.gen(function* () {
      const ledger = yield* Evidence.StudioEvidence;
      yield* ledger.runStarted("a", "run-2");
      yield* ledger.claimWrite({ place: "place:1", threadId: "a" });
      yield* ledger.runEnded("a", "run-1");
      expect((yield* ledger.claimWrite({ place: "place:1", threadId: "b" })).ok).toBe(false);
      yield* ledger.releaseWrite("a");
      expect((yield* ledger.claimWrite({ place: "place:1", threadId: "b" })).ok).toBe(true);
    }).pipe(Effect.provide(Evidence.layer)),
  );

  it.effect("frees a place after ten idle minutes and when the holder is deleted", () =>
    Effect.gen(function* () {
      const ledger = yield* Evidence.StudioEvidence;
      yield* ledger.claimWrite({ place: "place:1", threadId: "a" });
      yield* TestClock.adjust(Evidence.leaseIdleMs - 1);
      expect((yield* ledger.claimWrite({ place: "place:1", threadId: "b" })).ok).toBe(false);
      yield* TestClock.adjust(Evidence.leaseIdleMs + 1);
      expect((yield* ledger.claimWrite({ place: "place:1", threadId: "b" })).ok).toBe(true);
      yield* ledger.threadDeleted("b");
      expect((yield* ledger.claimWrite({ place: "place:1", threadId: "c" })).ok).toBe(true);
    }).pipe(Effect.provide(Evidence.layer)),
  );

  it.effect("numbers recorded calls so an undo slice can attach snapshots to them", () =>
    Effect.gen(function* () {
      const ledger = yield* Evidence.StudioEvidence;
      const first = yield* ledger.record({ threadId: "t1", call: call("edit_script", {}) });
      const second = yield* ledger.record({ threadId: "t1", call: call("set_properties", {}) });
      yield* ledger.attachSnapshot({ threadId: "t1", seq: second, snapshot: { source: "old" } });
      expect([first, second]).toEqual([1, 2]);
    }).pipe(Effect.provide(Evidence.layer)),
  );
});

const layer = StudioTools.layer.pipe(
  Layer.provideMerge(StudioBridge.layer),
  Layer.provide(ServerSettingsService.layerTest()),
  Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
  Layer.provide(RojoWorkspaces.layerNone),
  Layer.provide(NodeServices.layer),
);

const textOf = (result: { readonly content: ReadonlyArray<any> }) =>
  result.content[0].text as string;

describe("Studio writes through the lease", () => {
  it.effect("refuses a second thread's write, names the holder, and still allows reads", () =>
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
      const plugin = yield* Effect.forever(
        Effect.gen(function* () {
          const messages = yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 20 });
          for (const message of messages) {
            if (message.kind !== "request") continue;
            yield* bridge.respond({
              requestId: message.requestId,
              payload:
                message.endpoint === "edit-script"
                  ? { success: true, path: "game.A", revision: "r1", instanceRef: "ir:x" }
                  : { success: true, path: "game.A", revision: "r1", lineCount: 1 },
            });
          }
        }),
      ).pipe(Effect.forkChild);
      yield* ledger.threadTitled("a", "Obby combat");
      yield* ledger.runStarted("a", "run-a");
      const write = yield* tools.call(
        "edit_script",
        { path: "game.A", edits: [{ old_string: "a", new_string: "b" }] },
        { threadId: "a" },
      );
      expect(write.isError).not.toBe(true);
      const refused = yield* tools.call(
        "set_properties",
        { path: "game.Workspace.Part", properties: { Anchored: true } },
        { threadId: "b" },
      );
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("place_busy");
      expect(textOf(refused)).toContain("Obby combat");
      const read = yield* tools.call("get_script_source", { path: "game.A" }, { threadId: "b" });
      expect(read.isError).not.toBe(true);
      expect(yield* ledger.evidence({ threadId: "a", runId: "run-a" })).toMatchObject({
        verdict: "unverified",
        scriptsWritten: 1,
        scriptsVerified: 1,
        issues: ["Scripts changed but no playtest ran"],
      });
      yield* ledger.runEnded("a", "run-a");
      const afterTurn = yield* tools.call(
        "set_properties",
        { path: "game.Workspace.Part", properties: { Anchored: true } },
        { threadId: "b" },
      );
      expect(textOf(afterTurn)).not.toContain("place_busy");
      yield* Fiber.interrupt(plugin);
    }).pipe(Effect.provide(layer)),
  );
});
