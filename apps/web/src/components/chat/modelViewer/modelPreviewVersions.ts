import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";

import type { TurnImageResource } from "../turnImagesPreview";

export const metresPerStud = 0.28;

export interface ModelPreviewEntry {
  readonly itemId: string;
  readonly preview: ModelPreviewReference;
}

export interface ModelVersion {
  readonly preview: ModelPreviewReference;
  readonly resource: TurnImageResource | undefined;
}

export interface TurnImageTile {
  readonly itemId: string;
  readonly resource: TurnImageResource | undefined;
  readonly versions?: ReadonlyArray<ModelVersion>;
}

export const maxGlbBytes = 30 * 1024 * 1024;

export function glbHeaderProblem(buffer: ArrayBuffer): string | undefined {
  if (buffer.byteLength > maxGlbBytes) return "3D previews are limited to 30 MB.";
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    return "This is not a binary glTF (.glb) file.";
  }
  if (view.getUint32(4, true) !== 2) return "Only glTF 2.0 models can be shown.";
  if (view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) {
    return "The model file is truncated or damaged.";
  }
  return undefined;
}

export function metresToStuds(metres: number): number {
  return metres / metresPerStud;
}

export function dimensionsInStuds(
  dimensions: readonly [number, number, number],
): [number, number, number] {
  return [metresToStuds(dimensions[0]), metresToStuds(dimensions[1]), metresToStuds(dimensions[2])];
}

export function formatStuds(studs: number): string {
  if (!Number.isFinite(studs)) return "0";
  const rounded = studs >= 100 ? Math.round(studs) : Math.round(studs * 10) / 10;
  return String(rounded);
}

export function formatStudSize(dimensions: readonly [number, number, number]): string {
  return dimensionsInStuds(dimensions).map(formatStuds).join(" x ");
}

export function formatMetreSize(dimensions: readonly [number, number, number]): string {
  return dimensions.map((value) => String(Math.round(value * 100) / 100)).join(" x ");
}

function lineageRoot(preview: ModelPreviewReference, parents: ReadonlyMap<string, string>) {
  let current = preview.jobId ?? preview.previewId;
  for (let steps = 0; steps < 256; steps += 1) {
    const parent = parents.get(current);
    if (parent === undefined) return current;
    current = parent;
  }
  return current;
}

/** Previews of one model across calls: jobs chained by continueFrom share a group, oldest first. */
export function groupModelVersions(
  entries: ReadonlyArray<ModelPreviewEntry>,
): ReadonlyArray<ReadonlyArray<ModelPreviewEntry>> {
  const parents = new Map<string, string>();
  for (const { preview } of entries) {
    if (preview.jobId !== undefined && preview.continuedFrom !== undefined) {
      parents.set(preview.jobId, preview.continuedFrom);
    }
  }
  const groups = new Map<string, ModelPreviewEntry[]>();
  for (const entry of entries) {
    const root = lineageRoot(entry.preview, parents);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [entry]);
    else group.push(entry);
  }
  return [...groups.values()];
}

/**
 * One tile per image, except that a model's earlier versions fold into the tile of its latest
 * version, which carries all versions oldest first.
 */
export function buildTurnImageTiles(
  images: ReadonlyArray<TurnImageResource>,
  models: ReadonlyArray<ModelPreviewEntry>,
): ReadonlyArray<TurnImageTile> {
  const coverOf = (itemId: string) =>
    images.find((image) => image.itemId === itemId && image.index === 0);
  const latestItems = new Map<string, ReadonlyArray<ModelVersion>>();
  const folded = new Set<string>();
  for (const group of groupModelVersions(models)) {
    const latest = group[group.length - 1]!;
    latestItems.set(
      latest.itemId,
      group.map((entry) => ({ preview: entry.preview, resource: coverOf(entry.itemId) })),
    );
    for (const entry of group.slice(0, -1)) folded.add(entry.itemId);
  }
  const tiles: TurnImageTile[] = [];
  for (const image of images) {
    if (image.index === 0 && folded.has(image.itemId)) continue;
    const versions = image.index === 0 ? latestItems.get(image.itemId) : undefined;
    tiles.push(
      versions === undefined
        ? { itemId: image.itemId, resource: image }
        : { itemId: image.itemId, resource: image, versions },
    );
  }
  for (const [itemId, versions] of latestItems) {
    if (coverOf(itemId) === undefined) tiles.push({ itemId, resource: undefined, versions });
  }
  return tiles;
}

export function versionLabel(index: number, count: number): string {
  return `Version ${index + 1} of ${count}`;
}

export function modelPreviewFailureReason(status: number): string {
  if (status === 401 || status === 403) return "This connection cannot read the model file.";
  if (status === 404) return "The model file is gone; previews expire with their job folder.";
  return `The server could not send the model file (${status}).`;
}
