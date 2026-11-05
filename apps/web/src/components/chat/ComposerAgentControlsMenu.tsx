import type { EnvironmentId, OrchestrationV2StudioControls } from "@t3tools/contracts";
import { playtestsAllowed, type StudioControlsChange } from "@t3tools/shared/studioControls";
import { useLocation } from "@tanstack/react-router";
import { PlayIcon } from "lucide-react";
import { memo } from "react";

import { useStudioPlaces } from "../../hooks/useThreadStudioControls";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { StatusDot } from "../ui/status-dot";
import { ComposerControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import {
  studioPlaceChange,
  studioPlaceDetail,
  studioPlaceRows,
  studioPlaceTone,
  studioTargetSummary,
  type StudioTargetSummary,
} from "./ThreadStudioPanel.logic";
import { useComposerMenuState } from "./useComposerMenuState";

export interface AgentControlsBinding {
  readonly environmentId: EnvironmentId;
  readonly controls: OrchestrationV2StudioControls | undefined;
  readonly onChange: (change: StudioControlsChange) => void;
}

export function useStudioMenuState(hidden = false) {
  const settingsOpen = useLocation({
    select: (location) => location.pathname.startsWith("/settings"),
  });
  return useComposerMenuState(hidden || settingsOpen);
}

export function StudioTargetLabel(props: {
  readonly summary: StudioTargetSummary;
  readonly composer?: boolean;
}) {
  return (
    <>
      <StatusDot size="md" tone={props.summary.tone} />
      <span
        {...(props.composer ? { "data-composer-control-label": true } : {})}
        className={props.composer ? "max-w-32 truncate" : "min-w-0 truncate"}
      >
        {props.summary.label}
      </span>
      {props.summary.extra > 0 ? (
        <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
          +{props.summary.extra}
        </span>
      ) : null}
    </>
  );
}

export function AgentControlsMenuContent(props: AgentControlsBinding) {
  const places = useStudioPlaces(props.environmentId, true);
  const rows = studioPlaceRows(places, props.controls);
  const allowed = playtestsAllowed(props.controls);
  return (
    <div className="flex w-64 flex-col gap-1">
      {rows.map((row) => {
        const detail = studioPlaceDetail(row);
        return (
          <MenuCheckboxItem
            key={row.placeKey}
            variant="trailing"
            checked={row.included}
            onCheckedChange={(included) => props.onChange(studioPlaceChange(row, included))}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <StatusDot size="md" tone={studioPlaceTone(row)} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{row.name}</span>
                {detail ? (
                  <span className="truncate text-xs text-muted-foreground">{detail}</span>
                ) : null}
              </span>
            </span>
          </MenuCheckboxItem>
        );
      })}
      {rows.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Open a place in Roblox Studio and it shows up here.
        </p>
      ) : null}
      <div className="rounded-lg bg-foreground/6 p-0.5">
        <MenuCheckboxItem
          variant="switch"
          checked={allowed}
          onCheckedChange={(allowPlaytests) => props.onChange({ allowPlaytests })}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <PlayIcon aria-hidden className="-mx-0.75 size-3.5 text-icon-muted" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">Playtests</span>
              <span className="truncate text-xs text-muted-foreground">
                {allowed ? "The agent can start them" : "The agent can't start one"}
              </span>
            </span>
          </span>
        </MenuCheckboxItem>
      </div>
    </div>
  );
}

export const ComposerAgentControlsMenu = memo(function ComposerAgentControlsMenu(
  props: AgentControlsBinding & {
    size?: "sm" | "xs";
    hidden?: boolean;
  },
) {
  const size = props.size ?? "sm";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useStudioMenuState(props.hidden);
  const places = useStudioPlaces(props.environmentId, true);
  const summary = studioTargetSummary(studioPlaceRows(places, props.controls), props.controls);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl size={size} className="shrink-0" aria-label="Roblox Studio controls" />
        }
      >
        <StudioTargetLabel summary={summary} composer />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        <AgentControlsMenuContent
          environmentId={props.environmentId}
          controls={props.controls}
          onChange={props.onChange}
        />
      </MenuPopup>
    </Menu>
  );
});
