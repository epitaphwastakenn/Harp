import type { RobloxStudioStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { studioOpenPlace, studioSetupNote } from "./studioSetup.logic";

const status = (patch: Partial<RobloxStudioStatus>): RobloxStudioStatus => ({
  mode: "sealcode",
  studioInstalled: true,
  officialMcpAvailable: false,
  servers: [],
  blender: {},
  blenderMcp: { args: [] },
  ...patch,
});

const bridge = (places: NonNullable<RobloxStudioStatus["bridge"]>["places"]) => ({
  state: "listening",
  restarts: 0,
  pluginUpdated: false,
  pluginConnected: places.length > 0,
  places,
});

describe("studioSetupNote", () => {
  it("names the place agents can work in once Studio is connected", () => {
    const connected = status({
      bridge: bridge([
        { instanceId: "place:1", role: "server" },
        { instanceId: "place:1", role: "edit", placeName: "Obby" },
      ]),
    });
    expect(studioOpenPlace(connected)).toBe("Obby");
    expect(studioSetupNote(connected)).toMatchObject({ tone: "success" });
    expect(studioSetupNote(connected)?.text).toContain("Obby");
  });

  it("tells a Studio user what happens next, and says nothing without Studio", () => {
    expect(studioSetupNote(status({ bridge: bridge([]) }))?.tone).toBe("info");
    expect(studioSetupNote(status({ mode: "off" }))?.text).toContain("Settings");
    expect(studioSetupNote(status({ studioInstalled: false }))).toBeNull();
    expect(studioOpenPlace(status({ mode: "official" }))).toBeUndefined();
  });
});
