import { BoxIcon } from "lucide-react";
import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";

import { formatStudSize } from "./modelPreviewVersions";

function modelCardStats(preview: ModelPreviewReference): string | null {
  if (preview.triangles === 0) return null;
  return `${preview.triangles.toLocaleString()} triangles · ${formatStudSize(preview.dimensions)} studs`;
}

export function ModelCardBody({ preview }: { readonly preview: ModelPreviewReference }) {
  const stats = modelCardStats(preview);
  return (
    <span className="flex size-full min-w-0 items-center gap-2 text-left text-xs text-muted-foreground">
      <BoxIcon className="size-5 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-foreground">3D model</span>
        {stats === null ? null : <span className="truncate tabular-nums">{stats}</span>}
      </span>
    </span>
  );
}
