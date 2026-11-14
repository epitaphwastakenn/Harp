import type { StudioTurnEvidence } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { StudioRisk } from "./StudioTools.ts";

export const leaseIdleMs = 10 * 60_000;

const maxThreads = 200;
const maxFinishedTurns = 20;
const maxCallsPerTurn = 200;
const maxTargetsPerTurn = 50;
const maxTargetsPerCall = 8;
const maxTargetChars = 200;
const maxTitles = 500;
const uiScanChars = 20_000;

type Args = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const notPlaceWrites = new Set([
  "playtest",
  "multiplayer_playtest",
  "interact_ui",
  "simulate_mouse_input",
  "simulate_keyboard_input",
  "set_device_simulator",
  "capture_device_matrix",
  "set_network_profile",
  "breakpoints",
  "manage_studio",
  "blender",
  "export_rbxm",
  "eval_server_runtime",
  "eval_client_runtime",
  "load_skill",
]);

const scriptWriteTools = new Set(["set_script_source", "edit_script"]);
const playtestTools = new Set(["playtest", "multiplayer_playtest"]);
const screenshotTools = new Set(["capture_screenshot", "capture_device_matrix"]);

const uiPattern =
  /StarterGui|PlayerGui|ScreenGui|SurfaceGui|BillboardGui|"(?:TextLabel|TextButton|TextBox|ImageLabel|ImageButton|Frame|ScrollingFrame|UIListLayout|UIGridLayout|UICorner|UIStroke|UIPadding|UIScale)"/;

/** Whether a call can change the place's contents, which is what the per-place lease guards. */
export const isPlaceWrite = (tool: string, risk: StudioRisk, args: Args): boolean => {
  if (risk === "read" || notPlaceWrites.has(tool)) return false;
  if (tool === "animation") return args.action === "create";
  if (tool === "execute_luau") {
    const target = typeof args.target === "string" ? args.target : "edit";
    return target === "edit";
  }
  return true;
};

const targetKeys = ["path", "parent", "script", "rig", "sequence", "instanceRef", "name"];

const targetsOf = (args: Args): ReadonlyArray<string> => {
  const found: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim() !== "" && found.length < maxTargetsPerCall) {
      found.push(value.slice(0, maxTargetChars));
    }
  };
  for (const key of targetKeys) add(args[key]);
  for (const key of ["paths", "instances", "operations"]) {
    const list = args[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === "string") add(entry);
      else if (isRecord(entry)) {
        add(entry.path);
        add(entry.parent);
      }
    }
  }
  return [...new Set(found)];
};

const touchesUi = (tool: string, args: Args): boolean => {
  if (scriptWriteTools.has(tool)) return false;
  let text = "";
  try {
    text = (JSON.stringify(args) ?? "").slice(0, uiScanChars);
  } catch {
    return false;
  }
  return uiPattern.test(text);
};

const scriptWriteVerified = (structured: Record<string, unknown> | undefined): boolean => {
  const line = structured?.verification;
  return (
    typeof line === "string" &&
    (line.startsWith("Read the script back and verified") || line.startsWith("Wrote "))
  );
};

interface EvidenceCall {
  readonly seq: number;
  readonly tool: string;
  readonly at: number;
  readonly write: boolean;
  readonly ok: boolean;
  readonly targets: ReadonlyArray<string>;
  snapshot?: unknown;
}

interface TurnRecord {
  runId: string | undefined;
  calls: EvidenceCall[];
  nextSeq: number;
  writeAttempts: number;
  writes: number;
  targets: Set<string>;
  scriptsWritten: number;
  scriptsVerified: number;
  playtests: number;
  playtestErrors: number;
  uiChanges: number;
  uiPending: boolean;
  screenshots: number;
  failures: number;
  failedTools: Map<string, number>;
}

export const emptyTurn = (runId: string | undefined): TurnRecord => ({
  runId,
  calls: [],
  nextSeq: 1,
  writeAttempts: 0,
  writes: 0,
  targets: new Set(),
  scriptsWritten: 0,
  scriptsVerified: 0,
  playtests: 0,
  playtestErrors: 0,
  uiChanges: 0,
  uiPending: false,
  screenshots: 0,
  failures: 0,
  failedTools: new Map(),
});

interface FinishedCall {
  readonly tool: string;
  readonly risk: StudioRisk;
  readonly args: Args;
  readonly ok: boolean;
  readonly structured?: Record<string, unknown> | undefined;
  readonly at: number;
}

/** Folds one finished tool call into the turn; returns the call's sequence number. */
export const applyCall = (turn: TurnRecord, call: FinishedCall): number => {
  const write = isPlaceWrite(call.tool, call.risk, call.args);
  const targets = write || call.risk !== "read" ? targetsOf(call.args) : [];
  const seq = turn.nextSeq;
  turn.nextSeq += 1;
  if (turn.calls.length >= maxCallsPerTurn) turn.calls.shift();
  turn.calls.push({ seq, tool: call.tool, at: call.at, write, ok: call.ok, targets });
  if (!call.ok) {
    turn.failures += 1;
    turn.failedTools.set(call.tool, (turn.failedTools.get(call.tool) ?? 0) + 1);
  }
  if (write) {
    turn.writeAttempts += 1;
    if (call.ok) {
      turn.writes += 1;
      for (const target of targets) {
        if (turn.targets.size < maxTargetsPerTurn) turn.targets.add(target);
      }
      if (scriptWriteTools.has(call.tool)) {
        turn.scriptsWritten += 1;
        if (scriptWriteVerified(call.structured)) turn.scriptsVerified += 1;
      } else if (touchesUi(call.tool, call.args)) {
        turn.uiChanges += 1;
        turn.uiPending = true;
      }
    }
  }
  if (call.ok) {
    if (call.tool === "inspect_ui") turn.uiPending = false;
    if (screenshotTools.has(call.tool)) turn.screenshots += 1;
    const started =
      call.tool === "multiplayer_playtest"
        ? call.args.action === "start"
        : call.tool === "playtest" && call.args.action === "start";
    if (started && playtestTools.has(call.tool)) {
      turn.playtests += 1;
      turn.playtestErrors = 0;
    }
  }
  return seq;
};

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

export const deriveEvidence = (turn: TurnRecord): StudioTurnEvidence => {
  const issues: string[] = [];
  if (turn.failures > 0) {
    issues.push(
      `${plural(turn.failures, "Studio tool call", "Studio tool calls")} failed (${[...turn.failedTools.keys()].slice(0, 4).join(", ")})`,
    );
  }
  const unverified = turn.scriptsWritten - turn.scriptsVerified;
  if (unverified > 0) {
    issues.push(
      `${plural(unverified, "script write was", "script writes were")} not read back to verify`,
    );
  }
  if (turn.scriptsWritten > 0 && turn.playtests === 0) {
    issues.push("Scripts changed but no playtest ran");
  }
  if (turn.playtestErrors > 0) {
    issues.push(`The last playtest printed ${plural(turn.playtestErrors, "error", "errors")}`);
  }
  if (turn.uiPending) issues.push("UI changed without a UI audit");
  return {
    verdict:
      turn.writeAttempts === 0 ? "notApplicable" : issues.length === 0 ? "verified" : "unverified",
    issues,
    writes: turn.writes,
    targets: [...turn.targets],
    scriptsWritten: turn.scriptsWritten,
    scriptsVerified: turn.scriptsVerified,
    playtests: turn.playtests,
    playtestErrors: turn.playtestErrors,
    uiChanges: turn.uiChanges,
    uiAudited: turn.uiChanges > 0 && !turn.uiPending,
    screenshots: turn.screenshots,
    failures: turn.failures,
  };
};

interface ThreadLedger {
  open: TurnRecord;
  finished: Map<string, TurnRecord>;
}

interface Lease {
  threadId: string;
  at: number;
}

type LeaseDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly holder: string; readonly holderTitle: string | undefined };

export class StudioEvidence extends Context.Service<
  StudioEvidence,
  {
    /** The first write to a place takes its lease; another thread holding it refuses the call. */
    readonly claimWrite: (input: {
      readonly place: string;
      readonly threadId: string;
    }) => Effect.Effect<LeaseDecision>;
    /** Records a finished call; the returned sequence number is where an undo slice attaches a snapshot. */
    readonly record: (input: {
      readonly threadId: string;
      readonly call: Omit<FinishedCall, "at">;
    }) => Effect.Effect<number>;
    readonly attachSnapshot: (input: {
      readonly threadId: string;
      readonly seq: number;
      readonly snapshot: unknown;
    }) => Effect.Effect<void>;
    readonly runStarted: (threadId: string, runId: string) => Effect.Effect<void>;
    /** Closes the thread's open turn under `runId` and releases the leases the thread holds. */
    readonly runEnded: (threadId: string, runId: string) => Effect.Effect<void>;
    readonly threadDeleted: (threadId: string) => Effect.Effect<void>;
    readonly threadTitled: (threadId: string, title: string) => Effect.Effect<void>;
    readonly playtestError: (threadIds: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly evidence: (input: {
      readonly threadId: string;
      readonly runId: string;
    }) => Effect.Effect<StudioTurnEvidence>;
    readonly leaseHolder: (place: string) => Effect.Effect<string | undefined>;
  }
>()("t3/studioBridge/studioEvidence") {}

const make = Effect.sync(() => {
  const threads = new Map<string, ThreadLedger>();
  const leases = new Map<string, Lease>();
  const titles = new Map<string, string>();

  const releaseLeases = (threadId: string) => {
    for (const [place, lease] of leases) {
      if (lease.threadId === threadId) leases.delete(place);
    }
  };

  const ledgerOf = (threadId: string): ThreadLedger => {
    const existing = threads.get(threadId);
    if (existing !== undefined) return existing;
    const created: ThreadLedger = { open: emptyTurn(undefined), finished: new Map() };
    threads.set(threadId, created);
    if (threads.size > maxThreads) {
      const oldest = threads.keys().next().value;
      if (oldest !== undefined && oldest !== threadId) {
        threads.delete(oldest);
        releaseLeases(oldest);
      }
    }
    return created;
  };

  const finish = (ledger: ThreadLedger, runId: string) => {
    ledger.open.runId = runId;
    ledger.finished.set(runId, ledger.open);
    if (ledger.finished.size > maxFinishedTurns) {
      const oldest = ledger.finished.keys().next().value;
      if (oldest !== undefined) ledger.finished.delete(oldest);
    }
    ledger.open = emptyTurn(undefined);
  };

  const claimWrite = Effect.fn("StudioEvidence.claimWrite")(function* (input: {
    readonly place: string;
    readonly threadId: string;
  }) {
    const now = yield* Clock.currentTimeMillis;
    const lease = leases.get(input.place);
    if (lease !== undefined && lease.threadId !== input.threadId && now - lease.at < leaseIdleMs) {
      return {
        ok: false,
        holder: lease.threadId,
        holderTitle: titles.get(lease.threadId),
      } as const;
    }
    leases.set(input.place, { threadId: input.threadId, at: now });
    return { ok: true } as const;
  });

  const record = Effect.fn("StudioEvidence.record")(function* (input: {
    readonly threadId: string;
    readonly call: Omit<FinishedCall, "at">;
  }) {
    const at = yield* Clock.currentTimeMillis;
    return applyCall(ledgerOf(input.threadId).open, { ...input.call, at });
  });

  return StudioEvidence.of({
    claimWrite,
    record,
    attachSnapshot: Effect.fn("StudioEvidence.attachSnapshot")((input) =>
      Effect.sync(() => {
        const call = threads
          .get(input.threadId)
          ?.open.calls.find((candidate) => candidate.seq === input.seq);
        if (call !== undefined) call.snapshot = input.snapshot;
      }),
    ),
    runStarted: Effect.fn("StudioEvidence.runStarted")((threadId, runId) =>
      Effect.sync(() => {
        const ledger = ledgerOf(threadId);
        if (ledger.open.runId === undefined) ledger.open.runId = runId;
        else if (ledger.open.runId !== runId) {
          finish(ledger, ledger.open.runId);
          ledger.open.runId = runId;
        }
      }),
    ),
    runEnded: Effect.fn("StudioEvidence.runEnded")((threadId, runId) =>
      Effect.sync(() => {
        releaseLeases(threadId);
        const ledger = threads.get(threadId);
        if (ledger === undefined || ledger.finished.has(runId)) return;
        if (ledger.open.runId !== undefined && ledger.open.runId !== runId) return;
        if (ledger.open.calls.length === 0 && ledger.open.runId === undefined) return;
        finish(ledger, runId);
      }),
    ),
    threadDeleted: Effect.fn("StudioEvidence.threadDeleted")((threadId) =>
      Effect.sync(() => {
        threads.delete(threadId);
        titles.delete(threadId);
        releaseLeases(threadId);
      }),
    ),
    threadTitled: Effect.fn("StudioEvidence.threadTitled")((threadId, title) =>
      Effect.sync(() => {
        titles.delete(threadId);
        titles.set(threadId, title);
        if (titles.size > maxTitles) {
          const oldest = titles.keys().next().value;
          if (oldest !== undefined) titles.delete(oldest);
        }
      }),
    ),
    playtestError: Effect.fn("StudioEvidence.playtestError")((threadIds) =>
      Effect.sync(() => {
        for (const threadId of threadIds) {
          const open = threads.get(threadId)?.open;
          if (open !== undefined && open.playtests > 0) open.playtestErrors += 1;
        }
      }),
    ),
    evidence: Effect.fn("StudioEvidence.evidence")((input) =>
      Effect.sync(() => {
        const ledger = threads.get(input.threadId);
        const turn =
          ledger?.finished.get(input.runId) ??
          (ledger?.open.runId === input.runId ? ledger.open : undefined);
        return deriveEvidence(turn ?? emptyTurn(input.runId));
      }),
    ),
    leaseHolder: Effect.fn("StudioEvidence.leaseHolder")((place) =>
      Effect.sync(() => leases.get(place)?.threadId),
    ),
  });
});

export const layer = Layer.effect(StudioEvidence, make);
