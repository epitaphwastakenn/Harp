import { workspaceAreaProps } from "../lib/workspaceFocus";
import { BlocksIcon, MessageSquareDashedIcon, PlusIcon } from "lucide-react";

import { openCommandPalette } from "../commandPaletteBus";
import { isElectron } from "../env";
import { useScratchProject } from "../hooks/useScratchProject";
import { studioOpenPlace, studioSetupNote } from "../onboarding/studioSetup.logic";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { HarpMascot } from "./mascot/HarpMascot";
import { RouteInset } from "./RouteInset";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function NoProjectsHero() {
  const contentArea = workspaceAreaProps("home", 1, "Home");
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  const studio = useEnvironmentQuery(
    scratchTargetEnvironmentId === null
      ? null
      : serverEnvironment.robloxStudioStatus({
          environmentId: scratchTargetEnvironmentId,
          input: {},
        }),
  );
  const openPlace = studioOpenPlace(studio.data);
  const studioNote = openPlace === undefined ? studioSetupNote(studio.data) : null;

  return (
    <RouteInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <Empty size="hero" className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <HarpMascot scene="sleeping" className="mb-6 h-20 w-auto" />
              <EmptyTitle>What should we work on?</EmptyTitle>
              <EmptyDescription>
                {scratchTargetEnvironmentId === null
                  ? "Add a project to start your first thread."
                  : openPlace !== undefined
                    ? `${openPlace} is open in Roblox Studio. Start working in it, or add a project folder.`
                    : (studioNote?.text ?? "Add a project, or start without one.")}
              </EmptyDescription>
              <div className="mt-6 flex justify-center gap-2">
                {scratchTargetEnvironmentId !== null && openPlace !== undefined ? (
                  <Button
                    size="sm"
                    onClick={() => void startScratchThread(scratchTargetEnvironmentId)}
                  >
                    <BlocksIcon className="size-4" />
                    Work in Studio
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={openPlace === undefined ? "default" : "outline"}
                  onClick={() => openCommandPalette({ open: "add-project" })}
                >
                  <PlusIcon className="size-4" />
                  Add project
                </Button>
                {scratchTargetEnvironmentId === null || openPlace !== undefined ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void startScratchThread(scratchTargetEnvironmentId)}
                  >
                    <MessageSquareDashedIcon className="size-4" />
                    Start without a project
                  </Button>
                )}
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </RouteInset>
  );
}
