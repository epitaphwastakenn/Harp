import type {
  StudioUndoCounts,
  StudioUndoNote,
  StudioUndoPreview,
  StudioUndoResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as StudioBridge from "./StudioBridge.ts";
import { StudioEndpoints } from "./protocol.ts";
import { placeKey } from "./StudioRouter.ts";
import { StudioEvidence, type UndoTurnView } from "./studioEvidence.ts";

type PluginData = Record<string, unknown>;

export interface FileUndoEntry {
  readonly source: "file";
  readonly absolute: string;
  readonly relative: string;
  readonly previous: string;
  readonly written: string;
  readonly studio: PluginData | undefined;
}

export type UndoEntry =
  | { readonly source: "plugin"; readonly data: PluginData }
  | FileUndoEntry
  | { readonly source: "opaque"; readonly what: string; readonly reason: string };

export interface UndoSnapshot {
  readonly instanceId: string | undefined;
  readonly entries: ReadonlyArray<UndoEntry>;
}

export interface UndoCapture {
  readonly entries: UndoEntry[];
  instanceId: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSnapshot = (value: unknown): value is UndoSnapshot =>
  isRecord(value) && Array.isArray(value.entries);

export const takeUndo = (
  payload: unknown,
): { readonly payload: unknown; readonly entries: ReadonlyArray<UndoEntry> } => {
  if (!isRecord(payload) || payload.undo === undefined) return { payload, entries: [] };
  const { undo, ...rest } = payload;
  const list = Array.isArray(undo) ? undo : [undo];
  return {
    payload: rest,
    entries: list
      .filter(isRecord)
      .filter((data) => typeof data.kind === "string")
      .map((data) => ({ source: "plugin" as const, data })),
  };
};

export const emptyCounts = (): StudioUndoCounts => ({
  scripts: 0,
  files: 0,
  properties: 0,
  created: 0,
  deleted: 0,
  builds: 0,
});

const kindCounter = {
  script: "scripts",
  properties: "properties",
  created: "created",
  deleted: "deleted",
  journal: "builds",
} as const;

const countKey = (
  entry: Exclude<UndoEntry, { source: "opaque" }>,
): keyof StudioUndoCounts | undefined =>
  entry.source === "file"
    ? "files"
    : (kindCounter as Record<string, keyof StudioUndoCounts | undefined>)[String(entry.data.kind)];

const bump = (counts: StudioUndoCounts, key: keyof StudioUndoCounts): StudioUndoCounts => ({
  ...counts,
  [key]: counts[key] + 1,
});

const labelOf = (entry: Exclude<UndoEntry, { source: "opaque" }>): string => {
  if (entry.source === "file") return `file ${entry.relative}`;
  const path = typeof entry.data.path === "string" ? entry.data.path : "an instance";
  switch (entry.data.kind) {
    case "script":
      return `script ${path}`;
    case "properties":
      return `properties of ${path}`;
    case "created":
      return `created ${path}`;
    case "deleted":
      return `removed ${path}`;
    case "journal":
      return `build under ${path}`;
    default:
      return path;
  }
};

export interface UndoStep {
  readonly seq: number;
  readonly instanceId: string | undefined;
  readonly entry: Exclude<UndoEntry, { source: "opaque" }>;
}

export interface UndoPlan {
  readonly steps: ReadonlyArray<UndoStep>;
  readonly notUndoable: ReadonlyArray<StudioUndoNote>;
  readonly counts: StudioUndoCounts;
}

const opaqueReason = (tool: string): string =>
  tool === "execute_luau"
    ? "Arbitrary Luau can change anything, so Harp cannot reverse it"
    : "This tool has no automatic undo";

export const planUndo = (turn: UndoTurnView): UndoPlan => {
  const steps: UndoStep[] = [];
  const opaque = new Map<string, { what: string; reason: string; count: number }>();
  const note = (what: string, reason: string) => {
    const key = `${what}\n${reason}`;
    const existing = opaque.get(key);
    if (existing === undefined) opaque.set(key, { what, reason, count: 1 });
    else existing.count += 1;
  };
  let counts = emptyCounts();
  for (const call of [...turn.calls].sort((a, b) => b.seq - a.seq)) {
    const snapshot = isSnapshot(call.snapshot) ? call.snapshot : undefined;
    if (snapshot === undefined || snapshot.entries.length === 0) {
      if (call.write && call.ok) {
        note(
          call.tool,
          call.snapshotDropped ? "Its before-state was too large to keep" : opaqueReason(call.tool),
        );
      }
      continue;
    }
    for (const entry of [...snapshot.entries].reverse()) {
      if (entry.source === "opaque") {
        note(entry.what, entry.reason);
        continue;
      }
      steps.push({ seq: call.seq, instanceId: snapshot.instanceId, entry });
      const key = countKey(entry);
      if (key !== undefined) counts = bump(counts, key);
    }
  }
  const notUndoable: StudioUndoNote[] = [...opaque.values()].map((item) => ({
    what: item.count > 1 ? `${item.what} (${String(item.count)} calls)` : item.what,
    reason: item.reason,
  }));
  if (turn.dropped > 0) {
    notUndoable.push({
      what: `${String(turn.dropped)} earlier calls`,
      reason: "They fell out of the turn's record",
    });
  }
  return { steps, notUndoable, counts };
};

export interface UndoOutcome {
  readonly status: "restored" | "partial" | "skipped";
  readonly reason?: string | undefined;
}

export interface UndoRestorers {
  readonly restoreFile: (entry: FileUndoEntry) => Effect.Effect<UndoOutcome>;
  readonly restorePlugin: (input: {
    readonly instanceId: string | undefined;
    readonly entries: ReadonlyArray<PluginData>;
  }) => Effect.Effect<ReadonlyArray<UndoOutcome>, string>;
}

export interface UndoRun {
  readonly restored: StudioUndoCounts;
  readonly skipped: ReadonlyArray<StudioUndoNote>;
  readonly pluginFailure: string | undefined;
  readonly changed: boolean;
}

export const walkUndo = Effect.fn("StudioUndo.walk")(function* (
  plan: UndoPlan,
  restorers: UndoRestorers,
) {
  const outcomes = new Map<UndoStep, UndoOutcome>();
  const queue: Array<{
    readonly step: UndoStep | undefined;
    readonly owner: UndoStep;
    readonly data: PluginData;
  }> = [];
  for (const step of plan.steps) {
    if (step.entry.source === "file") {
      const outcome = yield* restorers.restoreFile(step.entry);
      outcomes.set(step, outcome);
      if (outcome.status !== "skipped" && step.entry.studio !== undefined) {
        queue.push({ step: undefined, owner: step, data: step.entry.studio });
      }
    } else {
      queue.push({ step, owner: step, data: step.entry.data });
    }
  }
  const groups = new Map<string | undefined, typeof queue>();
  for (const item of queue) {
    const group = groups.get(item.owner.instanceId) ?? [];
    group.push(item);
    groups.set(item.owner.instanceId, group);
  }
  let pluginFailure: string | undefined;
  for (const [instanceId, group] of groups) {
    const answered = yield* restorers
      .restorePlugin({ instanceId, entries: group.map((item) => item.data) })
      .pipe(Effect.result);
    if (answered._tag === "Failure") {
      pluginFailure = answered.failure;
      for (const item of group) {
        if (item.step !== undefined) {
          outcomes.set(item.step, { status: "skipped", reason: answered.failure });
        }
      }
      continue;
    }
    group.forEach((item, index) => {
      if (item.step === undefined) return;
      outcomes.set(
        item.step,
        answered.success[index] ?? { status: "skipped", reason: "Studio did not answer for it" },
      );
    });
  }
  let restored = emptyCounts();
  const skipped: StudioUndoNote[] = [];
  let changed = false;
  for (const step of plan.steps) {
    const outcome = outcomes.get(step) ?? { status: "skipped" as const, reason: "Not attempted" };
    const key = countKey(step.entry);
    if (outcome.status !== "skipped") {
      changed = true;
      if (key !== undefined) restored = bump(restored, key);
    }
    if (outcome.status !== "restored") {
      skipped.push({
        what: labelOf(step.entry),
        reason: outcome.reason ?? "It changed since the agent made it",
      });
    }
  }
  return { restored, skipped, pluginFailure, changed } satisfies UndoRun;
});

const lf = (text: string) => text.replaceAll("\r\n", "\n");

export const makeStudioUndo = Effect.gen(function* () {
  const bridge = yield* StudioBridge.StudioBridge;
  const evidence = yield* StudioEvidence;
  const fileSystem = yield* FileSystem.FileSystem;

  const restoreFile = Effect.fn("StudioUndo.restoreFile")(function* (entry: FileUndoEntry) {
    const current = yield* fileSystem
      .readFileString(entry.absolute)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (current === undefined)
      return { status: "skipped", reason: "The file no longer exists" } as const;
    if (lf(current) === lf(entry.previous)) return { status: "restored" } as const;
    if (lf(current) !== lf(entry.written)) {
      return { status: "skipped", reason: "The file changed since the agent wrote it" } as const;
    }
    const saved = yield* fileSystem.writeFileString(entry.absolute, entry.previous).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    return saved
      ? ({ status: "restored" } as const)
      : ({ status: "skipped", reason: "The file could not be written" } as const);
  });

  const restorePlugin = Effect.fn("StudioUndo.restorePlugin")(function* (
    threadId: string,
    input: { readonly instanceId: string | undefined; readonly entries: ReadonlyArray<PluginData> },
  ) {
    const answered = yield* bridge
      .request({
        instanceId: input.instanceId,
        defaultRole: "edit",
        endpoint: StudioEndpoints.undoApply,
        data: { entries: input.entries, undoKey: threadId },
        timeoutMs: 60_000,
        meta: { tool: "undo_turn_changes", summary: "Undo agent changes", threadId },
      })
      .pipe(Effect.mapError((error) => `Studio did not answer: ${error.message}`));
    const payload = answered.payload;
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      const detail =
        isRecord(payload) && typeof payload.error === "string" ? payload.error : "no result";
      return yield* Effect.fail(`Studio refused the undo: ${detail}`);
    }
    return payload.results.map((result): UndoOutcome => {
      const status = isRecord(result) ? result.status : undefined;
      const reason =
        isRecord(result) && typeof result.reason === "string" ? result.reason : undefined;
      return {
        status: status === "restored" || status === "partial" ? status : "skipped",
        reason,
      };
    });
  });

  const studioConnected = (instanceId: string | undefined) =>
    (instanceId === undefined ? bridge.peers : bridge.peersOf(instanceId)).pipe(
      Effect.map((peers) => peers.some((peer) => peer.role === "edit")),
    );

  const preview = Effect.fn("StudioUndo.preview")(function* (input: {
    readonly threadId: string;
    readonly runId: string;
  }) {
    const turn = yield* evidence.undoSource(input);
    const base = { counts: emptyCounts(), notUndoable: [] } as const;
    if (turn === undefined) {
      return {
        ...base,
        available: false,
        studioConnected: false,
        reason: "Harp keeps this record in memory, so it is gone after a server restart.",
      } satisfies StudioUndoPreview;
    }
    const plan = planUndo(turn);
    const connected = yield* studioConnected(
      plan.steps.find((step) => step.instanceId !== undefined)?.instanceId,
    );
    const reason = turn.undone
      ? "These changes were already undone."
      : plan.steps.length === 0
        ? "Nothing this turn changed in Studio can be undone automatically."
        : (yield* evidence.isRunning(input.threadId))
          ? "Wait for the agent to finish its current run."
          : connected
            ? undefined
            : "Studio is not connected. Open the place with Harp's plugin to undo.";
    return {
      available: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
      studioConnected: connected,
      counts: plan.counts,
      notUndoable: plan.notUndoable,
    } satisfies StudioUndoPreview;
  });

  const revert = Effect.fn("StudioUndo.revert")(function* (input: {
    readonly threadId: string;
    readonly runId?: string | undefined;
    readonly fromAgent: boolean;
  }) {
    const unavailable = (message: string): StudioUndoResult => ({
      status: "unavailable",
      message,
      restored: emptyCounts(),
      skipped: [],
      notUndoable: [],
    });
    const turn = yield* evidence.undoSource(input);
    if (turn === undefined) {
      return unavailable(
        "There is no finished turn to undo. Harp keeps this record in memory, so it is gone after a server restart.",
      );
    }
    if (turn.undone) return unavailable("That turn's changes were already undone.");
    if (!input.fromAgent && (yield* evidence.isRunning(input.threadId))) {
      return unavailable("Wait for the agent to finish its current run, then undo.");
    }
    const plan = planUndo(turn);
    if (plan.steps.length === 0) {
      return {
        ...unavailable("Nothing that turn changed in Studio can be undone automatically."),
        notUndoable: plan.notUndoable,
      };
    }
    const places = new Set(plan.steps.map((step) => step.instanceId));
    for (const instanceId of places) {
      const peer = yield* bridge.resolve({ instanceId, defaultRole: "edit" }).pipe(Effect.result);
      if (peer._tag === "Failure") {
        return unavailable("Studio is not connected to the place those changes were made in.");
      }
      const lease = yield* evidence.claimWrite({
        place: placeKey(peer.success),
        threadId: input.threadId,
      });
      if (!lease.ok) {
        return unavailable(
          "Another Harp thread is changing this place. Try again when it finishes.",
        );
      }
    }
    const run = yield* walkUndo(plan, {
      restoreFile,
      restorePlugin: (step) => restorePlugin(input.threadId, step),
    });
    if (run.pluginFailure !== undefined && !run.changed) {
      return unavailable(`${run.pluginFailure}. Nothing was changed; try again.`);
    }
    yield* evidence.finishUndo({ threadId: input.threadId, runId: turn.runId });
    return {
      status: "done",
      restored: run.restored,
      skipped: run.skipped,
      notUndoable: plan.notUndoable,
    } satisfies StudioUndoResult;
  });

  return { preview, revert };
});
