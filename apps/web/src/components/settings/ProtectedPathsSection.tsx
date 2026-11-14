import { useState } from "react";
import type { RobloxStudioProtectedPlace, RobloxStudioBridgeStatus } from "@t3tools/contracts";
import { XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  addProtectedPath,
  protectedPlaceRows,
  removeProtectedPath,
  type ProtectedPlaceRef,
} from "./protectedPaths.logic";

function PlaceProtectedPaths({
  place,
  paths,
  onAdd,
  onRemove,
}: {
  readonly place: ProtectedPlaceRef;
  readonly paths: ReadonlyArray<string>;
  readonly onAdd: (input: string) => string | undefined;
  readonly onRemove: (path: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    const problem = onAdd(draft);
    setError(problem);
    if (problem === undefined) setDraft("");
  };
  return (
    <div className="space-y-2 pt-1">
      {paths.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing is protected here. Agents may change anything in this place.
        </p>
      ) : (
        <ul className="space-y-1">
          {paths.map((path) => (
            <li key={path} className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md bg-foreground/[0.06] px-2 py-1 text-xs">
                {path}
              </code>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-destructive"
                aria-label={`Stop protecting ${path} in ${place.placeName}`}
                onClick={() => onRemove(path)}
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder="game.ServerStorage.Data"
          aria-label={`Protect a path in ${place.placeName}`}
          aria-invalid={error !== undefined}
          className="sm:w-72"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <Button type="button" size="xs" variant="outline" onClick={submit}>
          Protect
        </Button>
      </div>
      {error === undefined ? null : <p className="text-xs text-error-foreground">{error}</p>}
    </div>
  );
}

export function ProtectedPathsSection({
  saved,
  places,
  onChange,
}: {
  readonly saved: ReadonlyArray<RobloxStudioProtectedPlace>;
  readonly places: RobloxStudioBridgeStatus["places"];
  readonly onChange: (next: ReadonlyArray<RobloxStudioProtectedPlace>) => void;
}) {
  const rows = protectedPlaceRows(
    saved,
    places.filter((place) => place.role === undefined || place.role === "edit"),
  );
  return (
    <SettingsSection
      id="roblox-studio-protected-paths"
      title="Protected paths"
      description="Agents can read these instances but their tools refuse to change them or anything under them. Raw Luau cannot be stopped, so a run that changes one is flagged to the agent and to you."
    >
      {rows.length === 0 ? (
        <SettingsRow
          title="No places yet"
          description="Open a place in Roblox Studio and it shows up here."
        />
      ) : (
        rows.map((row) => (
          <SettingsRow
            key={row.placeKey}
            title={row.placeName}
            description={row.connected ? undefined : "Not open in Studio right now."}
            status={
              <PlaceProtectedPaths
                place={row}
                paths={row.paths}
                onAdd={(input) => {
                  const result = addProtectedPath(saved, row, input);
                  if (!result.ok) return result.error;
                  onChange(result.places);
                  return undefined;
                }}
                onRemove={(path) => onChange(removeProtectedPath(saved, row.placeKey, path))}
              />
            }
          />
        ))
      )}
    </SettingsSection>
  );
}
