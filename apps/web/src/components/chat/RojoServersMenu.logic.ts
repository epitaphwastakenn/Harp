import type { RojoProjectStatus, RojoWorkspaceStatus } from "@t3tools/contracts";

export const rojoHeading = (status: RojoWorkspaceStatus): string =>
  status.layout === "multi" ? `Rojo · ${String(status.projects.length)} places` : "Rojo";

export const rojoRowDetail = (project: RojoProjectStatus): string => {
  switch (project.state) {
    case "running":
      return project.startedByHarp
        ? `Serving on port ${String(project.port)}`
        : `Serving on port ${String(project.port)}, started outside Harp`;
    case "starting":
      return "Starting";
    case "failed":
      return project.message ?? "Rojo stopped with an error";
    case "stopped":
      return `Not serving · port ${String(project.port)}`;
  }
};

export const rojoRowTone = (project: RojoProjectStatus) => {
  switch (project.state) {
    case "running":
      return "success" as const;
    case "starting":
      return "info" as const;
    case "failed":
      return "error" as const;
    case "stopped":
      return "muted" as const;
  }
};

export const rojoRowOn = (project: RojoProjectStatus): boolean =>
  project.state === "running" || project.state === "starting";

export const rojoRowLocked = (project: RojoProjectStatus): boolean =>
  project.state === "starting" || (project.state === "running" && !project.startedByHarp);

export const rojoBulkAction = (
  projects: ReadonlyArray<RojoProjectStatus>,
): { readonly action: "start" | "stop"; readonly label: string } | null => {
  if (projects.length < 2) return null;
  if (projects.some((project) => !rojoRowOn(project))) {
    return { action: "start", label: "Start all" };
  }
  return projects.some((project) => project.startedByHarp)
    ? { action: "stop", label: "Stop all" }
    : null;
};
