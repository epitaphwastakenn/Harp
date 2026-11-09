import { FolderIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { DisclosureChevron } from "../ui/disclosure-chevron";
import { SortableSidebarGroupItem } from "./SidebarListMarkers";

const FOLDER_DOT_CLASS = {
  attention: "bg-amber-500 dark:bg-amber-300/90",
  failed: "bg-red-500 dark:bg-red-300/90",
  unread: "bg-emerald-500 dark:bg-emerald-300/90",
  working: "bg-sky-500 dark:bg-sky-300/80",
} as const;

export function SidebarThreadFolderHeader(props: {
  readonly sortableId: string;
  readonly folderKey: string;
  readonly name: string;
  readonly count: number;
  readonly expanded: boolean;
  readonly trayOpen: boolean;
  readonly indented: boolean;
  readonly dot: keyof typeof FOLDER_DOT_CLASS | null;
  readonly isDropTarget: boolean;
  readonly isRenaming: boolean;
  readonly onToggle: () => void;
  readonly onStartRename: () => void;
  readonly onCommitRename: (name: string) => void;
  readonly onCancelRename: () => void;
  readonly onContextMenu: (position: { x: number; y: number }) => void;
}) {
  return (
    <SortableSidebarGroupItem
      sortableId={props.sortableId}
      data-tray={props.trayOpen ? "first" : undefined}
      className={cn(
        "list-none rounded-lg",
        props.indented ? "ml-3" : "mx-0.5",
        props.trayOpen && "sidebar-folder-tray -mb-px pb-px",
      )}
    >
      {props.isRenaming ? (
        <div className="flex h-8 min-w-0 items-center gap-2 px-(--sidebar-row-content-inset) text-sm">
          <DisclosureChevron open={props.expanded} />
          <FolderIcon aria-hidden className="size-3.5 shrink-0 text-brand" />
          <ThreadFolderNameInput
            name={props.name}
            onCommit={props.onCommitRename}
            onCancel={props.onCancelRename}
          />
        </div>
      ) : (
        <button
          type="button"
          role="treeitem"
          tabIndex={-1}
          data-sidebar-row={`folder:${props.folderKey}`}
          aria-expanded={props.expanded}
          aria-label={`${props.name}, ${props.count} threads`}
          data-testid="sidebar-thread-folder"
          className={cn(
            "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-(--sidebar-row-content-inset) text-start text-sm outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
            props.isDropTarget && "bg-brand/20 hover:bg-brand/20",
          )}
          onClick={props.onToggle}
          onKeyDown={(event) => {
            if (event.key !== "F2") return;
            event.preventDefault();
            props.onStartRename();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onContextMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <DisclosureChevron open={props.expanded} />
          <FolderIcon aria-hidden className="size-3.5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate font-medium text-sidebar-foreground">
            {props.name}
          </span>
          {props.dot !== null && !props.expanded ? (
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT_CLASS[props.dot])}
            />
          ) : null}
          <span className="shrink-0 text-xs font-normal tabular-nums text-secondary-label">
            {props.count}
          </span>
        </button>
      )}
    </SortableSidebarGroupItem>
  );
}

function ThreadFolderNameInput(props: {
  readonly name: string;
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(props.name);
  const [settled, setSettled] = useState(false);
  const commit = () => {
    if (settled) return;
    setSettled(true);
    const name = value.trim();
    if (name.length === 0 || name === props.name) props.onCancel();
    else props.onCommit(name);
  };
  return (
    <input
      ref={(node) => {
        node?.focus();
        node?.select();
      }}
      aria-label="Folder name"
      maxLength={64}
      value={value}
      className="min-w-0 flex-1 rounded-sm bg-transparent font-medium text-sidebar-foreground outline-none ring-1 ring-brand/60 selection:bg-brand/30"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          setSettled(true);
          props.onCancel();
        }
      }}
    />
  );
}
