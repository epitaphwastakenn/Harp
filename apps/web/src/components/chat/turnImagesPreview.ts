import type { AssetResource, EnvironmentId } from "@t3tools/contracts";

import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import type { TurnImageTile } from "./modelViewer/modelPreviewVersions";

export type TurnImageResource = Extract<AssetResource, { readonly _tag: "tool-output-image" }>;

export const turnImageTileLimit = 8;

export function turnImageTileCounts(imageCount: number) {
  const shown = Math.min(imageCount, turnImageTileLimit);
  return { shown, hidden: imageCount - shown };
}

export function buildTurnImagesPreview(
  environmentId: EnvironmentId,
  tiles: ReadonlyArray<TurnImageTile>,
  index: number,
): ExpandedImagePreview {
  return {
    images: tiles.map(({ resource, versions }, position) => ({
      src: null,
      name: versions === undefined ? "Screenshot" : "Blender model",
      actionsSource: {
        kind: "image",
        name: `Screenshot ${position + 1}`,
        src: null,
        asset: { environmentId, resource },
      },
      ...(versions === undefined ? {} : { model: { environmentId, versions } }),
    })),
    index,
    filmstrip: true,
  };
}
