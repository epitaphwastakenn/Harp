import type {
  ComposerContextRecord,
  OrchestrationV2StudioControls,
  RobloxStudioSelectionSummary,
} from "@t3tools/contracts";

import { isStudioPlaceExcluded } from "./studioControls.ts";

export const studioSelectionContextKind = "studio-selection";
export const studioSelectionContextId = "studio-selection";

export interface StudioSelectionSummary {
  readonly count: number;
  readonly names: ReadonlyArray<string>;
  readonly activeScript?: string | undefined;
}

const lastSegment = (path: string) => path.split(".").at(-1) ?? path;

export const studioSelectionLabel = (summary: StudioSelectionSummary): string => {
  const first = summary.names[0];
  if (first === undefined) {
    return summary.activeScript === undefined
      ? "Studio selection"
      : `Open: ${lastSegment(summary.activeScript)}`;
  }
  const more = summary.count - 1;
  return more > 0 ? `Selected: ${first}, +${String(more)} more` : `Selected: ${first}`;
};

export const studioSelectionContextRecord = (
  summary: StudioSelectionSummary,
  included: boolean,
): ComposerContextRecord => ({
  version: 1,
  contextId: studioSelectionContextId as ComposerContextRecord["contextId"],
  kind: studioSelectionContextKind,
  label: studioSelectionLabel(summary),
  payload: {
    included,
    count: summary.count,
    names: summary.names.slice(0, 3),
    ...(summary.activeScript === undefined ? {} : { activeScript: summary.activeScript }),
  },
});

const studioSelectionPayload = (record: ComposerContextRecord) =>
  record.kind === studioSelectionContextKind && "payload" in record
    ? (record.payload as { included?: unknown; count?: unknown; names?: unknown } | null)
    : undefined;

export const studioSelectionOptedOut = (records: ReadonlyArray<ComposerContextRecord>): boolean =>
  records.some((record) => studioSelectionPayload(record)?.included === false);

export const sentStudioSelectionLabel = (
  records: ReadonlyArray<ComposerContextRecord>,
): string | undefined => {
  for (const record of records) {
    const payload = studioSelectionPayload(record);
    if (payload?.included === true) return record.label;
  }
  return undefined;
};

export const summarizeStudioSelections = (
  selections: ReadonlyArray<RobloxStudioSelectionSummary> | undefined,
  controls: OrchestrationV2StudioControls | undefined,
): StudioSelectionSummary | undefined => {
  const live = (selections ?? []).filter(
    (selection) => !isStudioPlaceExcluded(controls, selection.instanceId),
  );
  const count = live.reduce((total, selection) => total + selection.count, 0);
  const activeScript = live.find((selection) => selection.activeScript !== undefined)?.activeScript;
  if (count === 0 && activeScript === undefined) return undefined;
  return {
    count,
    names: live.flatMap((selection) => selection.names).slice(0, 3),
    ...(activeScript === undefined ? {} : { activeScript }),
  };
};
