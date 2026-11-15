import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { checkpointFileTotals } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { EnvironmentId, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon } from "lucide-react";
import { useState } from "react";

import { useResolvedAppearance } from "../../../hooks/useTheme";
import { useRightPanelStore } from "../../../rightPanelStore";
import { useAssetUrlState } from "../../../assets/assetUrls";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import {
  useQuietThreadVisibleTurnItems,
  useThreadCheckpointSummaries,
} from "../../../state/entities";
import { PanelSubheader } from "../../PanelSubheader";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../ui/empty";
import { ModelCardBody } from "../modelViewer/ModelCardBody";
import { ChangedFilesCard } from "../ChangedFilesTree";
import { openExpandedImagePreview } from "../ExpandedImageDialog";
import { buildResultsPreview } from "./resultsPreview";
import {
  buildTurnResults,
  filterSubjects,
  indexResultSources,
  resolveResultsRun,
  resultOriginLabels,
  resultOrigins,
  indexResultRunFlags,
  resultRunIds,
  stepRun,
  subjectVersionLabel,
  type ResultOrigin,
  type ResultSubject,
} from "./turnResults.logic";
import { useBecameVisible } from "./useBecameVisible";

export function ResultsPanel({
  threadRef,
  requestedRunId,
  onOpenTurnDiff,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly requestedRunId: RunId | null;
  readonly onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  const items = useQuietThreadVisibleTurnItems(threadRef);
  const sources = indexResultSources(items);
  const runs = resultRunIds(sources);
  const runId = resolveResultsRun(requestedRunId, runs, indexResultRunFlags(items));
  const results = buildTurnResults(sources, runId);
  const [origin, setOrigin] = useState<ResultOrigin | null>(null);
  const activeOrigin = origin !== null && results.counts[origin] > 0 ? origin : null;
  const shown = filterSubjects(results.subjects, activeOrigin);
  const position = runId === null ? -1 : runs.indexOf(runId);
  const selectRun = (next: RunId | null) =>
    useRightPanelStore.getState().openResults(threadRef, next);
  const previous = stepRun(runs, runId, -1);
  const next = stepRun(runs, runId, 1);

  return (
    <div data-results-panel className="flex h-full min-h-0 flex-col">
      <PanelSubheader>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Earlier turn"
          disabled={previous === null}
          onClick={() => selectRun(previous)}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-center text-xs tabular-nums text-muted-foreground">
          {runs.length === 0 || position === -1
            ? "Results"
            : `Turn ${String(position + 1)} of ${String(runs.length)}`}
        </span>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Later turn"
          disabled={next === null}
          onClick={() => selectRun(next)}
        >
          <ChevronRightIcon />
        </Button>
      </PanelSubheader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {runId === null ? null : (
          <>
            <StudioEvidenceSummary
              environmentId={threadRef.environmentId}
              threadRef={threadRef}
              runId={runId}
            />
            <TurnChanges threadRef={threadRef} runId={runId} onOpenTurnDiff={onOpenTurnDiff} />
          </>
        )}
        {results.subjects.length === 0 ? (
          <Empty size="compact">
            <EmptyHeader>
              <ImagesIcon className="size-5 text-muted-foreground" />
              <EmptyTitle>No images in this turn</EmptyTitle>
              <EmptyDescription>
                Studio captures, Blender renders and contact sheets the agent makes show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <section aria-label="Images" className="space-y-2">
            <div className="flex flex-wrap items-center gap-1">
              <OriginChip
                label="All"
                count={results.subjects.length}
                active={activeOrigin === null}
                onClick={() => setOrigin(null)}
              />
              {resultOrigins
                .filter((entry) => results.counts[entry] > 0)
                .map((entry) => (
                  <OriginChip
                    key={entry}
                    label={resultOriginLabels[entry]}
                    count={results.counts[entry]}
                    active={activeOrigin === entry}
                    onClick={() => setOrigin(entry)}
                  />
                ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              {shown.map((subject) => (
                <ResultTile
                  key={subject.key}
                  environmentId={threadRef.environmentId}
                  subject={subject}
                  onOpen={() =>
                    openExpandedImagePreview(
                      scopedThreadKey(threadRef),
                      buildResultsPreview(threadRef.environmentId, shown, shown.indexOf(subject)),
                    )
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function OriginChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? "outline" : "ghost-muted"}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
      <span className="text-2xs tabular-nums">{count}</span>
    </Button>
  );
}

function ResultTile({
  environmentId,
  subject,
  onOpen,
}: {
  environmentId: EnvironmentId;
  subject: ResultSubject;
  onOpen: () => void;
}) {
  const { ref, visible } = useBecameVisible();
  const assetUrl = useAssetUrlState(
    visible ? environmentId : null,
    visible ? (subject.tile.resource ?? null) : null,
  );
  const modelOnly =
    subject.tile.resource === undefined ? subject.tile.versions?.at(-1)?.preview : undefined;
  const [failed, setFailed] = useState(false);
  const unavailable = assetUrl._tag === "Failure" || failed;
  const versions = subjectVersionLabel(subject);

  return (
    <button
      ref={(element) => {
        ref.current = element;
      }}
      type="button"
      aria-label={`Open ${subject.label}${versions === null ? "" : `, ${versions}`}`}
      onClick={onOpen}
      className="group/result flex min-w-0 flex-col gap-1 text-left [contain-intrinsic-size:auto_8rem] [content-visibility:auto] focus-visible:outline-none"
    >
      <span className="relative block aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted transition-colors group-hover/result:border-brand/40 group-focus-visible/result:ring-2 group-focus-visible/result:ring-inset group-focus-visible/result:ring-ring/70">
        {modelOnly !== undefined ? (
          <span className="flex size-full items-center px-3">
            <ModelCardBody preview={modelOnly} />
          </span>
        ) : unavailable ? (
          <span className="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            Image unavailable
          </span>
        ) : assetUrl._tag === "Success" ? (
          <img
            src={assetUrl.url}
            alt=""
            decoding="async"
            draggable={false}
            className="size-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : null}
        <span className="absolute left-1 top-1 flex gap-1">
          <Badge size="sm" variant="secondary">
            {resultOriginLabels[subject.origin]}
          </Badge>
          {subject.tile.versions === undefined ? null : (
            <Badge size="sm" variant="secondary">
              3D
            </Badge>
          )}
        </span>
        {versions === null ? null : (
          <span className="absolute bottom-1 right-1">
            <Badge size="sm" variant="secondary">
              {versions}
            </Badge>
          </span>
        )}
      </span>
      <span className="truncate text-xs text-muted-foreground">{subject.label}</span>
    </button>
  );
}

function StudioEvidenceSummary({
  environmentId,
  threadRef,
  runId,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  runId: RunId;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.studioTurnEvidence({
      environmentId,
      input: { threadId: threadRef.threadId, runId },
    }),
  );
  const evidence = query.data;
  if (evidence === null || evidence.verdict === "notApplicable") return null;
  const verified = evidence.verdict === "verified";
  const facts = [
    `${evidence.writes} change${evidence.writes === 1 ? "" : "s"}`,
    evidence.scriptsWritten > 0
      ? `${evidence.scriptsVerified} of ${evidence.scriptsWritten} scripts checked`
      : null,
    evidence.playtests > 0
      ? `${evidence.playtests} playtest${evidence.playtests === 1 ? "" : "s"}`
      : null,
    evidence.screenshots > 0
      ? `${evidence.screenshots} screenshot${evidence.screenshots === 1 ? "" : "s"}`
      : null,
  ].filter((fact) => fact !== null);

  return (
    <section aria-label="Studio evidence" className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge variant={verified ? "success" : "warning"} size="sm">
          {verified ? "Studio verified" : "Studio unverified"}
        </Badge>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{facts.join(" · ")}</span>
      </div>
      {evidence.issues.length === 0 ? null : (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {evidence.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TurnChanges({
  threadRef,
  runId,
  onOpenTurnDiff,
}: {
  threadRef: ScopedThreadRef;
  runId: RunId;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  const summary = useThreadCheckpointSummaries(threadRef).find((entry) => entry.runId === runId);
  const resolvedTheme = useResolvedAppearance();
  const [expanded, setExpanded] = useState(false);
  if (summary === undefined || summary.files.length === 0) return null;
  return (
    <section aria-label="Changed files">
      <ChangedFilesCard
        runId={runId}
        files={summary.files}
        totals={checkpointFileTotals(summary)}
        allDirectoriesExpanded={expanded}
        resolvedTheme={resolvedTheme}
        onToggleAllDirectories={() => setExpanded((value) => !value)}
        onOpenTurnDiff={onOpenTurnDiff}
      />
    </section>
  );
}
