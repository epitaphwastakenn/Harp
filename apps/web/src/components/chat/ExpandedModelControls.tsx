import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "../ui/button";
import { versionLabel } from "./modelViewer/modelPreviewVersions";

export function ExpandedModelControls({
  stillAvailable,
  showStill,
  versionIndex,
  versionCount,
  reason,
  onShowStill,
  onVersionChange,
}: {
  readonly stillAvailable: boolean;
  readonly showStill: boolean;
  readonly versionIndex: number;
  readonly versionCount: number;
  readonly reason: string | undefined;
  readonly onShowStill: (still: boolean) => void;
  readonly onVersionChange: (index: number) => void;
}) {
  return (
    <div className="mt-2 flex max-w-[var(--media-width)] flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/80">
      {stillAvailable ? (
        <div className="flex items-center gap-1" role="group" aria-label="Model view">
          <Button
            type="button"
            size="micro"
            variant={showStill ? "overlay" : "secondary"}
            aria-pressed={!showStill}
            onClick={() => onShowStill(false)}
          >
            3D
          </Button>
          <Button
            type="button"
            size="micro"
            variant={showStill ? "secondary" : "overlay"}
            aria-pressed={showStill}
            onClick={() => onShowStill(true)}
          >
            Still
          </Button>
        </div>
      ) : null}
      {versionCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-micro"
            variant="overlay"
            aria-label="Previous version"
            disabled={versionIndex === 0}
            onClick={() => onVersionChange(versionIndex - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="tabular-nums" aria-live="polite">
            {versionLabel(versionIndex, versionCount)}
          </span>
          <Button
            type="button"
            size="icon-micro"
            variant="overlay"
            aria-label="Next version"
            disabled={versionIndex === versionCount - 1}
            onClick={() => onVersionChange(versionIndex + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      ) : null}
      {reason === undefined ? null : <span role="status">3D view unavailable: {reason}</span>}
    </div>
  );
}
