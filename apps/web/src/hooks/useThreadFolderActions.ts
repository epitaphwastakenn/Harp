import { CommandId, type ScopedProjectRef, type ScopedThreadRef } from "@t3tools/contracts";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { create } from "zustand";

import { nextThreadFolderName, threadFolderKey } from "../components/Sidebar.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { randomUUID } from "../lib/utils";
import { orchestrationEnvironment } from "../state/orchestration";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useUiStateStore } from "../uiStateStore";

/** Which thread folder header shows its name input; any surface can ask for it. */
export const useThreadFolderRename = create<{
  readonly folderKey: string | null;
  readonly start: (folderKey: string) => void;
  readonly stop: () => void;
}>((set) => ({
  folderKey: null,
  start: (folderKey) => set({ folderKey }),
  stop: () => set({ folderKey: null }),
}));

function reportFailure(title: string, results: ReadonlyArray<AtomCommandResult<unknown, unknown>>) {
  for (const result of results) {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) continue;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
    return;
  }
}

export function useThreadFolderActions() {
  const setFolder = useOrchestrationCommand(threadEnvironment.setFolder, { reportFailure: false });
  const renameFolder = useAtomCommand(orchestrationEnvironment.renameThreadFolder);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const startRename = useThreadFolderRename((store) => store.start);

  const moveThreads = async (threads: readonly ScopedThreadRef[], folder: string | null) => {
    const results = await Promise.all(
      threads.map((thread) =>
        setFolder({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId, folder },
        }),
      ),
    );
    reportFailure("Failed to move thread", results);
  };

  const createFolder = async (
    threads: readonly ScopedThreadRef[],
    projectKey: string,
    existing: readonly string[],
  ) => {
    const name = nextThreadFolderName(existing);
    startRename(threadFolderKey(projectKey, name));
    await moveThreads(threads, name);
  };

  const changeFolder = async (input: {
    readonly projects: readonly ScopedProjectRef[];
    readonly projectKey: string;
    readonly folder: string;
    readonly newFolder: string | null;
  }) => {
    const results = await Promise.all(
      input.projects.map((project) =>
        renameFolder({
          environmentId: project.environmentId,
          input: {
            commandId: CommandId.make(randomUUID()),
            projectId: project.projectId,
            folder: input.folder,
            newFolder: input.newFolder,
          },
        }),
      ),
    );
    setProjectExpanded(threadFolderKey(input.projectKey, input.folder), true);
    reportFailure(
      input.newFolder === null ? "Failed to ungroup folder" : "Failed to rename folder",
      results,
    );
  };

  return { moveThreads, createFolder, changeFolder };
}
