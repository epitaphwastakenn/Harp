import type { RobloxStudioStatus } from "@t3tools/contracts";

export const studioOpenPlace = (
  status: RobloxStudioStatus | null | undefined,
): string | undefined => {
  if (status?.mode !== "sealcode") return undefined;
  const place = status.bridge?.places.find(
    (entry) => entry.role === undefined || entry.role === "edit",
  );
  if (place === undefined) return undefined;
  const name = place.placeName?.trim();
  return name === undefined || name === "" ? "your open place" : name;
};

export interface StudioSetupNote {
  readonly tone: "success" | "info" | "muted";
  readonly text: string;
}

export const studioSetupNote = (
  status: RobloxStudioStatus | null | undefined,
): StudioSetupNote | null => {
  if (status === null || status === undefined) return null;
  const place = studioOpenPlace(status);
  if (place !== undefined) {
    return {
      tone: "success",
      text: `Roblox Studio is connected: agents can work in ${place} right away.`,
    };
  }
  if (!status.studioInstalled) return null;
  if (status.mode === "sealcode") {
    return {
      tone: "info",
      text: "Roblox Studio found. Harp installs its Studio plugin by itself: open a place and agents can work in it.",
    };
  }
  return {
    tone: "muted",
    text: "Roblox Studio found. Turn the connection on in Settings, under Roblox Studio.",
  };
};
