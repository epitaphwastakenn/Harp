import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ProjectIconInput } from "@t3tools/contracts";
import { createElement, useState } from "react";

import { lucideIconByName } from "../../lib/lucideIconByName";
import { gameProjectIcons } from "../../projectIconOptions";
import { deriveProjectIdentity } from "../../projectIdentity";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentsWithScope } from "../../state/session";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

function GameIcon({ name }: { readonly name: string }) {
  const icon = lucideIconByName(name);
  return icon ? createElement(icon) : null;
}

export function ProjectIconDialog({
  group,
  onClose,
}: {
  readonly group: SidebarProjectSnapshot;
  readonly onClose: () => void;
}) {
  const updateProject = useOrchestrationCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const editableIds = useEnvironmentsWithScope(group.memberProjects, AuthOrchestrationOperateScope);
  const canEdit = group.memberProjects.every((member) => editableIds.has(member.environmentId));
  const [gameUrl, setGameUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = group.projectIcon ?? null;
  const color = chosen?.kind === "lucide" ? chosen.color : deriveProjectIdentity(group.title).color;
  const hasIcon = group.memberProjects.some((member) => member.projectIcon != null);
  const disabled = saving || !canEdit;

  const apply = async (projectIcon: ProjectIconInput | null) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    for (const member of group.memberProjects) {
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, faviconPath: null, projectIcon },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setError(failure instanceof Error ? failure.message : "Could not change the icon.");
        }
        setSaving(false);
        return;
      }
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="w-full sm:w-[24rem]">
        <DialogHeader>
          <DialogTitle>Project icon</DialogTitle>
          <DialogDescription>Pick an icon, or use the icon of a Roblox game.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ToggleGroup
            aria-label="Project icon"
            variant="default"
            className="grid w-full grid-cols-6"
            value={chosen?.kind === "lucide" ? [chosen.name] : []}
            disabled={disabled}
            onValueChange={(next) => {
              const name = next[0];
              if (name !== undefined) void apply({ kind: "lucide", name, color });
            }}
          >
            {gameProjectIcons.map((icon) => (
              <Toggle key={icon.name} value={icon.name} aria-label={icon.label} title={icon.label}>
                <GameIcon name={icon.name} />
              </Toggle>
            ))}
          </ToggleGroup>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const url = gameUrl.trim();
              if (url.length > 0) void apply({ kind: "roblox-game-url", url });
            }}
          >
            <Label htmlFor="project-icon-roblox-url">Roblox game</Label>
            <div className="flex items-center gap-2">
              <Input
                id="project-icon-roblox-url"
                inputMode="url"
                value={gameUrl}
                placeholder="https://www.roblox.com/games/123456789/Name"
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                aria-invalid={error !== null}
                onChange={(event) => {
                  setGameUrl(event.currentTarget.value);
                  setError(null);
                }}
              />
              <Button type="submit" disabled={disabled || gameUrl.trim().length === 0}>
                {saving ? <Spinner /> : null}
                Use icon
              </Button>
            </div>
            {error === null ? null : (
              <p role="alert" className="text-xs text-error-foreground">
                {error}
              </p>
            )}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={disabled || !hasIcon}
            onClick={() => void apply(null)}
          >
            Use letters
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
