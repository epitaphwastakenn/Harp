import type { EnvironmentId, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { ImagesIcon } from "lucide-react";

import { useQuietThreadVisibleTurnItems } from "../../../state/entities";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../ui/button";
import { indexResultSources } from "./turnResults.logic";

export function ResultsButton({
  environmentId,
  threadRef,
  runId,
  onOpen,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  runId: RunId;
  onOpen: (runId: RunId) => void;
}) {
  const hasImages = indexResultSources(useQuietThreadVisibleTurnItems(threadRef)).some(
    (source) => source.runId === runId,
  );
  const evidence = useEnvironmentQuery(
    serverEnvironment.studioTurnEvidence({
      environmentId,
      input: { threadId: threadRef.threadId, runId },
    }),
  ).data;
  if (!hasImages && (evidence?.writes ?? 0) === 0) return null;
  return (
    <Button type="button" size="xs" variant="ghost-muted" onClick={() => onOpen(runId)}>
      <ImagesIcon />
      Results
    </Button>
  );
}
