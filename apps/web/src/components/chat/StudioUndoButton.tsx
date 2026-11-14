import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, RunId, StudioUndoNote, ThreadId } from "@t3tools/contracts";
import type { StudioUndoResult } from "@t3tools/contracts";
import { Undo2Icon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { undoCountLines, undoTotal } from "./StudioUndoButton.logic";

function NoteList({ title, notes }: { title: string; notes: ReadonlyArray<StudioUndoNote> }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
        {notes.map((note) => (
          <li key={`${note.what}\n${note.reason}`}>
            <span className="text-foreground">{note.what}</span>: {note.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StudioUndoButton({
  environmentId,
  threadId,
  runId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  runId: RunId;
}) {
  const preview = useEnvironmentQuery(
    serverEnvironment.studioUndoPreview({ environmentId, input: { threadId, runId } }),
  );
  const permitted = useAtomValue(serverEnvironment.undoStudioTurn.permissionAtom(environmentId));
  const undo = useAtomCommand(serverEnvironment.undoStudioTurn, "undo Studio changes");
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<StudioUndoResult | null>(null);
  const data = preview.data;
  if (data === null && result === null) return null;

  const reason = !permitted
    ? "Your session cannot change Studio on this environment."
    : data?.available === false
      ? data.reason
      : undefined;
  const disabled = reason !== undefined;

  const confirm = async () => {
    setRunning(true);
    const settled = await undo({ environmentId, input: { threadId, runId } });
    setRunning(false);
    if (settled._tag === "Success") setResult(settled.value);
    preview.refresh();
  };

  const lines = data === null ? [] : undoCountLines(data.counts);
  const restoredLines = result === null ? [] : undoCountLines(result.restored);

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<span />}>
          <Button
            variant="ghost-muted"
            size="xs"
            disabled={disabled}
            onClick={() => {
              setResult(null);
              preview.refresh();
              setOpen(true);
            }}
          >
            <Undo2Icon />
            Undo Studio changes
          </Button>
        </TooltipTrigger>
        {reason === undefined ? null : <TooltipPopup side="top">{reason}</TooltipPopup>}
      </Tooltip>
      <AlertDialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {result === null ? "Undo this turn's Studio changes?" : "Studio changes undone"}
            </AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              {result === null ? (
                <>
                  <p>
                    {lines.length === 0
                      ? "Nothing in this turn can be undone automatically."
                      : `Reverts ${lines.join(", ")} as one undo step in Studio. Anything changed since is left alone.`}
                  </p>
                  {data === null ? null : (
                    <NoteList title="Cannot be undone" notes={data.notUndoable} />
                  )}
                  {disabled && reason !== undefined ? (
                    <p className="mt-3 text-warning-foreground">{reason}</p>
                  ) : null}
                </>
              ) : result.status === "unavailable" ? (
                <p>{result.message}</p>
              ) : (
                <>
                  <p>
                    {undoTotal(result.restored) === 0
                      ? "Nothing was restored."
                      : `Restored ${restoredLines.join(", ")}. Ctrl+Z in Studio steps it back.`}
                  </p>
                  <NoteList title="Skipped" notes={result.skipped} />
                  <NoteList title="Cannot be undone" notes={result.notUndoable} />
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {result === null ? "Cancel" : "Close"}
            </AlertDialogClose>
            {result === null ? (
              <Button size="sm" disabled={disabled || running} onClick={() => void confirm()}>
                {running ? <Spinner /> : null}
                Undo changes
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
