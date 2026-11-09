import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { MenuCheckboxItem, MenuItem } from "../ui/menu";
import { StatusDot } from "../ui/status-dot";
import {
  rojoBulkAction,
  rojoHeading,
  rojoRowDetail,
  rojoRowLocked,
  rojoRowOn,
  rojoRowTone,
} from "./RojoServersMenu.logic";

export function RojoServersMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const status = useEnvironmentQuery(
    serverEnvironment.rojoStatus({
      environmentId: props.environmentId,
      input: { projectId: props.projectId },
    }),
  );
  const control = useAtomCommand(serverEnvironment.controlRojo, "control Rojo");
  const data = status.data;
  if (data === null || data === undefined || data.layout === "none") return null;

  const run = (action: "start" | "stop", file?: string) => {
    void control({
      environmentId: props.environmentId,
      input: { projectId: props.projectId, action, ...(file === undefined ? {} : { file }) },
    }).finally(() => status.refresh());
  };
  const bulk = rojoBulkAction(data.projects);

  return (
    <div className="rounded-lg bg-foreground/6 p-0.5" data-rojo-servers>
      <p className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
        {rojoHeading(data)}
      </p>
      {data.projects.map((project) => (
        <MenuCheckboxItem
          key={project.file}
          variant="switch"
          checked={rojoRowOn(project)}
          disabled={rojoRowLocked(project)}
          onCheckedChange={(on) => run(on ? "start" : "stop", project.file)}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <StatusDot size="md" tone={rojoRowTone(project)} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{project.label}</span>
              <span className="truncate text-xs text-muted-foreground">
                {rojoRowDetail(project)}
              </span>
            </span>
          </span>
        </MenuCheckboxItem>
      ))}
      {bulk === null ? null : (
        <MenuItem closeOnClick={false} onClick={() => run(bulk.action)}>
          {bulk.label}
        </MenuItem>
      )}
      {data.rojoFound ? null : (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Rojo was not found. Install it with Rokit or Aftman, or put rojo on your PATH.
        </p>
      )}
    </div>
  );
}
