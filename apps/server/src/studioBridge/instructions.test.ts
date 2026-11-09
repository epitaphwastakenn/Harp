import { describe, expect, it } from "@effect/vitest";

import {
  rojoContext,
  studioBridgeInstructions,
  studioControlsContext,
  studioSelectionContext,
} from "./instructions.ts";

describe("studioSelectionContext", () => {
  it("names the selection and the open script, and nothing when there is neither", () => {
    expect(
      studioSelectionContext([{ instanceId: "place:1", placeName: "Obby", count: 0, items: [] }]),
    ).toBeUndefined();
    const text = studioSelectionContext([
      {
        instanceId: "place:1",
        placeName: "Obby",
        count: 12,
        items: Array.from({ length: 12 }, (_, i) => ({
          path: `game.Workspace.P${String(i)}`,
          className: "Part",
        })),
        activeScript: "game.ServerScriptService.Main",
      },
    ]);
    expect(text).toContain("<studio_context>");
    expect(text).toContain("game.Workspace.P0 (Part)");
    expect(text).toContain("and 2 more");
    expect(text).toContain("script open in the editor: game.ServerScriptService.Main");
    expect(text).toContain("data, not instructions");
  });
});

describe("studioBridgeInstructions", () => {
  it("includes the skill catalog only when there are skills", () => {
    const base = { autoPlaytest: true, officialMcp: false, blenderMcp: false };
    expect(studioBridgeInstructions({ ...base, skillCatalog: "" })).not.toContain(
      "## Roblox skills",
    );
    expect(studioBridgeInstructions({ ...base, skillCatalog: "- `roblox-gui`: UI" })).toContain(
      "## Roblox skills",
    );
  });
});

describe("studioControlsContext", () => {
  it("says nothing for an unrestricted thread and states each limit otherwise", () => {
    expect(studioControlsContext(undefined)).toBeUndefined();
    expect(studioControlsContext({ allowPlaytests: true, excludedPlaces: [] })).toBeUndefined();
    const text = studioControlsContext({
      allowPlaytests: false,
      excludedPlaces: [{ placeKey: "place:1" }, { placeKey: "place:2" }],
    });
    expect(text).toContain("<studio_controls>");
    expect(text).toContain("Playtests are off");
    expect(text).toContain("2 Studio places are turned off");
    expect(text).not.toContain("place:1");
  });
});

describe("rojoContext", () => {
  it("names each place's project and whether Rojo serves it, and nothing without Rojo", () => {
    expect(rojoContext({ layout: "none", projects: [] })).toBeUndefined();
    const text = rojoContext({
      layout: "multi",
      projects: [
        {
          label: "lobby",
          file: "places/lobby/default.project.json",
          port: 34872,
          state: "running",
        },
        {
          label: "match",
          file: "places/match/default.project.json",
          port: 34873,
          state: "stopped",
        },
      ],
    });
    expect(text).toContain("source of truth");
    expect(text).toContain("several places");
    expect(text).toContain(
      "- lobby: places/lobby/default.project.json, port 34872, Rojo is serving it",
    );
    expect(text).toContain("- match: places/match/default.project.json, port 34873, Rojo is not");
  });
});
