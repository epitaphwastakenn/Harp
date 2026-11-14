import type { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { StudioUndoButton } from "./StudioUndoButton";

export function StudioEvidenceBadge({
  environmentId,
  threadId,
  runId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  runId: RunId;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.studioTurnEvidence({ environmentId, input: { threadId, runId } }),
  );
  const evidence = query.data;
  if (evidence === undefined || evidence === null || evidence.verdict === "notApplicable")
    return null;
  const verified = evidence.verdict === "verified";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant={verified ? "success" : "warning"}
              size="sm"
              render={<button type="button" />}
            />
          }
        >
          {verified ? "Studio verified" : "Studio unverified"}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {verified ? (
            <span>
              {evidence.writes} Studio change{evidence.writes === 1 ? "" : "s"}, checked.
            </span>
          ) : (
            <ul className="max-w-72 list-disc pl-4">
              {evidence.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </TooltipPopup>
      </Tooltip>
      {evidence.writes > 0 ? (
        <StudioUndoButton environmentId={environmentId} threadId={threadId} runId={runId} />
      ) : null}
    </div>
  );
}
