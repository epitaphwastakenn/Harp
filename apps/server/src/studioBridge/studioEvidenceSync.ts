import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import { StudioEvidence } from "./studioEvidence.ts";

const activeRunStatuses = new Set(["starting", "running", "waiting"]);
const endedRunStatuses = new Set(["completed", "interrupted", "failed", "cancelled"]);

/** Feeds run and thread lifecycle into the Studio evidence ledger: turn boundaries, titles, deletion. */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const evidence = yield* StudioEvidence;

  const handle = (event: OrchestrationV2DomainEvent): Effect.Effect<void> => {
    switch (event.type) {
      case "run.created":
      case "run.updated":
        if (activeRunStatuses.has(event.payload.status)) {
          return evidence.runStarted(event.threadId, event.payload.id);
        }
        return endedRunStatuses.has(event.payload.status)
          ? evidence.runEnded(event.threadId, event.payload.id)
          : Effect.void;
      case "thread.created":
      case "thread.metadata-updated":
        return evidence.threadTitled(event.threadId, event.payload.title);
      case "thread.deleted":
        return evidence.threadDeleted(event.threadId);
      default:
        return Effect.void;
    }
  };

  const start = Effect.fn("StudioEvidenceSync.start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("studio evidence event stream failed", { cause }),
        ),
      ),
    );
  });

  return { start };
});
