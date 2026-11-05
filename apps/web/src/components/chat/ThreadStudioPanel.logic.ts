import type { OrchestrationV2StudioControls, RobloxStudioPlace } from "@t3tools/contracts";
import { excludedStudioPlaces, isStudioRestricted } from "@t3tools/shared/studioControls";

export interface StudioPlaceRow {
  readonly placeKey: string;
  readonly name: string;
  readonly included: boolean;
  readonly connected: boolean;
  readonly playtestRunning: boolean;
}

const fallbackPlaceName = "Unsaved place";

const isEditPeer = (place: RobloxStudioPlace) => place.role === undefined || place.role === "edit";

export function studioPlaceRows(
  places: ReadonlyArray<RobloxStudioPlace> | undefined,
  controls: OrchestrationV2StudioControls | null | undefined,
): ReadonlyArray<StudioPlaceRow> {
  const excluded = new Map(excludedStudioPlaces(controls).map((place) => [place.placeKey, place]));
  const grouped = new Map<string, RobloxStudioPlace[]>();
  for (const place of places ?? []) {
    const key = place.placeKey ?? place.instanceId;
    grouped.set(key, [...(grouped.get(key) ?? []), place]);
  }
  const connected = [...grouped.entries()]
    .map(([placeKey, peers]): StudioPlaceRow => {
      const edit = peers.find(isEditPeer) ?? peers[0]!;
      return {
        placeKey,
        name: edit.placeName?.trim() || excluded.get(placeKey)?.placeName || fallbackPlaceName,
        included: !excluded.has(placeKey),
        connected: true,
        playtestRunning: peers.some((peer) => !isEditPeer(peer)),
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const gone = [...excluded.values()]
    .filter((place) => !grouped.has(place.placeKey))
    .map((place): StudioPlaceRow => ({
      placeKey: place.placeKey,
      name: place.placeName.trim() || fallbackPlaceName,
      included: false,
      connected: false,
      playtestRunning: false,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return [...connected, ...gone];
}

export function studioPlaceChange(row: StudioPlaceRow, included: boolean) {
  return included
    ? { includePlaces: [row.placeKey] }
    : { excludePlaces: [{ placeKey: row.placeKey, placeName: row.name }] };
}

export function studioPlaceDetail(row: StudioPlaceRow): string | null {
  if (!row.connected) return "Not connected";
  if (!row.included) return "Ignored by the agent";
  if (row.playtestRunning) return "Playtest running";
  return null;
}

export function studioPlaceTone(row: StudioPlaceRow) {
  if (!row.connected) return "muted" as const;
  return row.playtestRunning ? ("info" as const) : ("success" as const);
}

export interface StudioTargetSummary {
  readonly label: string;
  readonly extra: number;
  readonly tone: "brand" | "info" | "muted" | "success";
}

export function studioTargetSummary(
  rows: ReadonlyArray<StudioPlaceRow>,
  controls: OrchestrationV2StudioControls | null | undefined,
): StudioTargetSummary {
  const working = rows.filter((row) => row.included && row.connected);
  const lead = working.find((row) => row.playtestRunning) ?? working[0];
  if (lead === undefined) {
    return {
      label: rows.length === 0 ? "No place open" : "No place selected",
      extra: 0,
      tone: "muted",
    };
  }
  return {
    label: lead.name,
    extra: working.length - 1,
    tone: lead.playtestRunning ? "info" : isStudioRestricted(controls) ? "brand" : "success",
  };
}
