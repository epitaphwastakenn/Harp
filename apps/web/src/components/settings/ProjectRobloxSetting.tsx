import type { EnvironmentId, ProjectId, RobloxProjectDetection } from "@t3tools/contracts";
import type { RobloxProjectMode } from "@t3tools/contracts/settings";

import { useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const modeLabels: Record<RobloxProjectMode, string> = {
  auto: "Automatic",
  roblox: "Roblox game",
  other: "Not a Roblox game",
};

export function robloxProjectDescription(detection: RobloxProjectDetection): string {
  switch (detection.reason) {
    case "project-files":
      return `Harp found ${detection.detail ?? "Roblox files"} in this folder, so threads get the Roblox tools and rules.`;
    case "game-icon":
      return "This project has a Roblox game icon, so threads get the Roblox tools and rules.";
    case "folder-name":
      return "The project's name points to Roblox, so threads get the Roblox tools and rules.";
    case "studio-place":
      return `${detection.detail ?? "A place"} is open in Roblox Studio, so threads get the Roblox tools and rules.`;
    case "studio-open":
      return "Threads here get the Roblox tools and rules while a place is open in Roblox Studio.";
    case "all-projects":
      return "Roblox Studio settings turn the Roblox tools on for all projects.";
    case "user-choice":
      return detection.applies
        ? "Threads here get the Roblox tools and rules."
        : "Threads here skip the Roblox tools and rules.";
    default:
      return "Nothing here looks like a Roblox game, so threads skip the Roblox tools and rules.";
  }
}

export function ProjectRobloxSetting(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const configs = useServerConfigs();
  const supported =
    configs.get(props.environmentId)?.environment.capabilities.robloxProjectDetection === true;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const mixed = useScopedSettingsMixed(["robloxProject"]);
  const detection = useEnvironmentQuery(
    supported
      ? serverEnvironment.robloxProjectDetection({
          environmentId: props.environmentId,
          input: { projectId: props.projectId },
        })
      : null,
  ).data;
  if (detection == null || detection.reason === "studio-off") return null;
  const mode = settings.robloxProject;

  return (
    <SettingsRow
      {...searchableSetting("project-roblox-game")}
      description={robloxProjectDescription(detection)}
      serverScoped
      settingKeys={["robloxProject"]}
      mixed={mixed}
      control={
        <Select
          value={mixed ? null : mode}
          onValueChange={(next) => {
            if (next === "auto") clearSettings(["robloxProject"]);
            else if (next === "roblox" || next === "other") updateSettings({ robloxProject: next });
          }}
        >
          <SelectTrigger size="sm" aria-label="Roblox game">
            <SelectValue>{mixed ? "Mixed" : modeLabels[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {(["auto", "roblox", "other"] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {modeLabels[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
