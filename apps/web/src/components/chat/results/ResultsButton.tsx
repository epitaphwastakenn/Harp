import type { EnvironmentId, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { ImagesIcon } from "lucide-react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../ui/button";

function OpenButton({ runId, onOpen }: { runId: RunId; onOpen: (runId: RunId) => void }) {
  return (
    <Button type="button" size="xs" variant="ghost-muted" onClick={() => onOpen(runId)}>
      <ImagesIcon />
      Results
    </Button>
  );
}

function StudioResultsButton({
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
  const evidence = useEnvironmentQuery(
    serverEnvironment.studioTurnEvidence({
      environmentId,
      input: { threadId: threadRef.threadId, runId },
    }),
  ).data;
  if ((evidence?.writes ?? 0) === 0) return null;
  return <OpenButton runId={runId} onOpen={onOpen} />;
}

export function ResultsButton({
  environmentId,
  threadRef,
  runId,
  hasImages,
  hasStudioTools,
  onOpen,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  runId: RunId;
  hasImages: boolean;
  hasStudioTools: boolean;
  onOpen: (runId: RunId) => void;
}) {
  if (hasImages) return <OpenButton runId={runId} onOpen={onOpen} />;
  if (!hasStudioTools) return null;
  return (
    <StudioResultsButton
      environmentId={environmentId}
      threadRef={threadRef}
      runId={runId}
      onOpen={onOpen}
    />
  );
}
