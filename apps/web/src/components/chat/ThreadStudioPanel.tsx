import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { playtestsAllowed } from "@t3tools/shared/studioControls";
import { ChevronDownIcon, PlayIcon } from "lucide-react";

import {
  useStudioControlsApply,
  useStudioPlaces,
  useThreadStudioControls,
} from "../../hooks/useThreadStudioControls";
import { cn } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AgentControlsMenuContent,
  StudioTargetLabel,
  useStudioMenuState,
} from "./ComposerAgentControlsMenu";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { studioPlaceRows, studioTargetSummary } from "./ThreadStudioPanel.logic";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadStudioPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const applies = useStudioControlsApply({
    environmentId: props.environmentId,
    threadId: props.threadId,
    enabled: true,
  });
  const shell = useThreadShell({ environmentId: props.environmentId, threadId: props.threadId });
  const places = useStudioPlaces(props.environmentId, applies);
  const { controls, change } = useThreadStudioControls({
    environmentId: props.environmentId,
    threadId: props.threadId,
    composerDraftTarget: { environmentId: props.environmentId, threadId: props.threadId },
    isDraft: false,
    serverControls: shell?.studioControls,
  });
  const [menuOpen, setMenuOpen] = useStudioMenuState();
  if (!applies) return null;
  const summary = studioTargetSummary(studioPlaceRows(places, controls), controls);
  const allowed = playtestsAllowed(controls);
  const playtestsLabel = allowed ? "The agent can start playtests" : "Playtests are off";

  return (
    <ThreadDetailsSection
      headingId="thread-details-studio-heading"
      title="Roblox Studio"
      showHeading={false}
      data-thread-studio-panel
    >
      <div className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger
            render={
              <ThreadDetailsControl
                aria-label="Roblox Studio places"
                size="sm"
                variant="ghost"
                part="primary"
              />
            }
          >
            <StudioTargetLabel summary={summary} />
            <ChevronDownIcon
              aria-hidden
              className={cn(THREAD_DETAILS_PANEL_CHEVRON_CLASS, "ms-auto")}
            />
          </MenuTrigger>
          <MenuPopup align="start">
            <AgentControlsMenuContent
              environmentId={props.environmentId}
              controls={controls}
              onChange={change}
              projectId={shell?.projectId}
            />
          </MenuPopup>
        </Menu>
        <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                aria-label="Let the agent start playtests"
                aria-pressed={allowed}
                size="sm"
                variant="ghost"
                part="secondary"
                onClick={() => change({ allowPlaytests: !allowed })}
              />
            }
          >
            <PlayIcon
              aria-hidden
              className={cn(
                THREAD_DETAILS_PANEL_ICON_CLASS,
                allowed && "fill-current text-success",
              )}
            />
          </TooltipTrigger>
          <TooltipPopup side="top">{playtestsLabel}</TooltipPopup>
        </Tooltip>
      </div>
    </ThreadDetailsSection>
  );
}
