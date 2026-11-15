import type { RunId } from "@t3tools/contracts";
import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/shell";
import { turnItemOutputImages } from "@t3tools/client-runtime/work-log/item-detail";
import { isStudioTool, studioToolTitle } from "@t3tools/shared/studioToolPresentation";
import { modelPreviewFromToolItem, type ModelPreviewReference } from "@t3tools/shared/toolOutput";

import type { TurnImageResource } from "../turnImagesPreview";
import { buildTurnImageTiles, type TurnImageTile } from "../modelViewer/modelPreviewVersions";

export type ResultOrigin = "studio" | "blender" | "animation" | "other";

export const resultOrigins: ReadonlyArray<ResultOrigin> = [
  "studio",
  "blender",
  "animation",
  "other",
];

export const resultOriginLabels: Readonly<Record<ResultOrigin, string>> = {
  studio: "Studio",
  blender: "Blender",
  animation: "Animation sheet",
  other: "Other",
};

export interface ResultSource {
  readonly itemId: string;
  readonly runId: RunId | null;
  readonly toolName: string | null;
  readonly input: unknown;
  readonly images: ReadonlyArray<TurnImageResource>;
  readonly model: ModelPreviewReference | undefined;
}

export interface ResultSubject {
  readonly key: string;
  readonly origin: ResultOrigin;
  readonly label: string;
  readonly tile: TurnImageTile;
  readonly images: ReadonlyArray<TurnImageResource>;
  readonly versionCount: number;
  readonly order: number;
}

export interface TurnResults {
  readonly subjects: ReadonlyArray<ResultSubject>;
  readonly counts: Readonly<Record<ResultOrigin, number>>;
  readonly imageCount: number;
}

const notCaptures = new Set(["generate_image", "stage_texture_preview"]);

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export function resultToolName(toolName: string | null): string | null {
  if (toolName === null) return null;
  let name = toolName;
  for (let depth = 0; depth < 4; depth += 1) {
    const qualified = /^mcp__.+?__(.+)$/u.exec(name);
    if (qualified?.[1] === undefined) break;
    name = qualified[1];
  }
  return name.split(".").at(-1) ?? null;
}

export function classifyResultOrigin(tool: string | null, hasModel: boolean): ResultOrigin {
  if (hasModel || tool === "blender") return "blender";
  if (tool === "animation") return "animation";
  if (tool !== null && isStudioTool(tool) && !notCaptures.has(tool)) return "studio";
  return "other";
}

function studioCaptureTarget(input: unknown): string {
  return text(record(input).target) ?? "edit";
}

function humanize(tool: string): string {
  const spaced = tool.replace(/[_-]+/gu, " ").trim();
  return spaced === "" ? "Image" : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function captureLabel(target: string): string {
  const client = /^client-(\d+)$/u.exec(target);
  return client?.[1] === undefined ? "Studio view" : `Client ${client[1]}`;
}

function animationSubject(source: ResultSource): string {
  const args = record(source.input);
  return text(args.sequence) ?? text(args.animationId) ?? text(args.rig) ?? source.itemId;
}

function subjectIdentity(
  source: ResultSource,
  origin: ResultOrigin,
  image: TurnImageResource,
): { readonly key: string; readonly label: string } {
  const tool = resultToolName(source.toolName);
  if (origin === "studio" && tool === "capture_screenshot") {
    const target = studioCaptureTarget(source.input);
    return { key: `studio:screenshot:${target}`, label: captureLabel(target) };
  }
  if (origin === "animation") {
    return { key: `animation:${animationSubject(source)}`, label: "Animation contact sheet" };
  }
  const title = tool === null ? undefined : studioToolTitle(tool, source.input);
  return {
    key: `${origin}:${source.itemId}:${String(image.index)}`,
    label: title ?? (tool === null ? "Image" : humanize(tool)),
  };
}

export function resultSourcesFromRows(
  rows: ReadonlyArray<ThreadStructureVisibleTurnItem>,
): ReadonlyArray<ResultSource> {
  const sources: ResultSource[] = [];
  for (const { item } of rows) {
    if (item.type !== "dynamic_tool" || item.status !== "completed") continue;
    const images = turnItemOutputImages(item);
    const model = modelPreviewFromToolItem(item);
    if (images.length === 0 && model === undefined) continue;
    sources.push({
      itemId: item.id,
      runId: item.runId,
      toolName: item.toolName,
      input: item.input,
      images,
      model,
    });
  }
  return sources;
}

export interface ResultRunFlags {
  readonly hasImages: boolean;
  readonly hasStudioTools: boolean;
}

const runFlagIndex = new WeakMap<object, ReadonlyMap<RunId, ResultRunFlags>>();

export function indexResultRunFlags(
  rows: ReadonlyArray<ThreadStructureVisibleTurnItem>,
): ReadonlyMap<RunId, ResultRunFlags> {
  const cached = runFlagIndex.get(rows);
  if (cached !== undefined) return cached;
  const flags = new Map<RunId, ResultRunFlags>();
  for (const source of indexResultSources(rows)) {
    if (source.runId === null) continue;
    const hasStudioTools = flags.get(source.runId)?.hasStudioTools ?? false;
    flags.set(source.runId, { hasImages: true, hasStudioTools });
  }
  for (const { item } of rows) {
    if (item.type !== "dynamic_tool" || item.runId === null) continue;
    const tool = resultToolName(item.toolName);
    if (tool === null || !isStudioTool(tool)) continue;
    const hasImages = flags.get(item.runId)?.hasImages ?? false;
    flags.set(item.runId, { hasImages, hasStudioTools: true });
  }
  runFlagIndex.set(rows, flags);
  return flags;
}

export function resultRunIds(sources: ReadonlyArray<ResultSource>): ReadonlyArray<RunId> {
  const runs = new Set<RunId>();
  for (const source of sources) {
    if (source.runId !== null) runs.add(source.runId);
  }
  return [...runs];
}

const rowIndex = new WeakMap<object, ReadonlyArray<ResultSource>>();

export function indexResultSources(
  rows: ReadonlyArray<ThreadStructureVisibleTurnItem>,
): ReadonlyArray<ResultSource> {
  const cached = rowIndex.get(rows);
  if (cached !== undefined) return cached;
  const sources = resultSourcesFromRows(rows);
  rowIndex.set(rows, sources);
  return sources;
}

const emptyCounts = (): Record<ResultOrigin, number> => ({
  studio: 0,
  blender: 0,
  animation: 0,
  other: 0,
});

export function buildTurnResults(
  sources: ReadonlyArray<ResultSource>,
  runId: RunId | null,
): TurnResults {
  const own = sources.filter((source) => source.runId === runId);
  const sourceByItem = new Map(own.map((source) => [source.itemId, source]));
  const tiles = buildTurnImageTiles(
    own.flatMap((source) => source.images),
    own.flatMap((source) =>
      source.model === undefined ? [] : [{ itemId: source.itemId, preview: source.model }],
    ),
  );

  const subjects = new Map<
    string,
    {
      origin: ResultOrigin;
      label: string;
      images: TurnImageResource[];
      tile: TurnImageTile;
      order: number;
    }
  >();
  for (const [order, tile] of tiles.entries()) {
    const source = sourceByItem.get(tile.itemId);
    if (source === undefined) continue;
    if (tile.versions !== undefined) {
      subjects.set(`blender:${tile.itemId}`, {
        origin: "blender",
        label: tile.resource === undefined ? "3D model" : "Blender model",
        images: tile.versions.flatMap((version) =>
          version.resource === undefined ? [] : [version.resource],
        ),
        tile,
        order,
      });
      continue;
    }
    if (tile.resource === undefined) continue;
    const origin = classifyResultOrigin(resultToolName(source.toolName), false);
    const { key, label } = subjectIdentity(source, origin, tile.resource);
    const existing = subjects.get(key);
    if (existing === undefined) {
      subjects.set(key, { origin, label, images: [tile.resource], tile, order });
    } else {
      existing.images.push(tile.resource);
      existing.tile = tile;
      existing.order = order;
    }
  }

  const ordered = [...subjects.entries()]
    .map(([key, subject]): ResultSubject => ({
      key,
      origin: subject.origin,
      label: subject.label,
      tile: subject.tile,
      images: subject.images,
      versionCount: subject.tile.versions?.length ?? subject.images.length,
      order: subject.order,
    }))
    .toSorted((left, right) => right.order - left.order);
  const counts = emptyCounts();
  for (const subject of ordered) counts[subject.origin] += 1;
  return {
    subjects: ordered,
    counts,
    imageCount: tiles.length === 0 ? 0 : own.reduce((sum, source) => sum + source.images.length, 0),
  };
}

export function filterSubjects(
  subjects: ReadonlyArray<ResultSubject>,
  origin: ResultOrigin | null,
): ReadonlyArray<ResultSubject> {
  return origin === null ? subjects : subjects.filter((subject) => subject.origin === origin);
}

export function resolveResultsRun(
  requested: RunId | null,
  runs: ReadonlyArray<RunId>,
  knownRuns?: ReadonlyMap<RunId, unknown>,
): RunId | null {
  if (requested !== null) {
    if (runs.includes(requested) || knownRuns?.has(requested) === true) return requested;
    return runs.at(-1) ?? null;
  }
  return runs.at(-1) ?? null;
}

export function stepRun(
  runs: ReadonlyArray<RunId>,
  current: RunId | null,
  direction: -1 | 1,
): RunId | null {
  const index = current === null ? -1 : runs.indexOf(current);
  const next = index === -1 ? (direction === 1 ? 0 : runs.length - 1) : index + direction;
  return runs[next] ?? null;
}

export function subjectVersionLabel(subject: ResultSubject): string | null {
  if (subject.versionCount <= 1) return null;
  return subject.tile.versions === undefined
    ? `${String(subject.versionCount)} captures`
    : `${String(subject.versionCount)} versions`;
}
