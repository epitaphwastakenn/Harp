import { describe, expect, it } from "vite-plus/test";

import {
  sentStudioSelectionLabel,
  studioSelectionContextRecord,
  studioSelectionLabel,
  studioSelectionOptedOut,
  summarizeStudioSelections,
} from "./studioSelection.ts";

describe("studio selection", () => {
  it("labels one, many and script-only selections", () => {
    expect(studioSelectionLabel({ count: 1, names: ["Door"] })).toBe("Selected: Door");
    expect(studioSelectionLabel({ count: 3, names: ["Door", "Wall", "Lamp"] })).toBe(
      "Selected: Door, +2 more",
    );
    expect(
      studioSelectionLabel({ count: 0, names: [], activeScript: "ServerScriptService.Main" }),
    ).toBe("Open: Main");
  });

  it("records what was sent and what was withheld", () => {
    const summary = { count: 2, names: ["Door", "Wall"] };
    const sent = studioSelectionContextRecord(summary, true);
    const withheld = studioSelectionContextRecord(summary, false);
    expect(studioSelectionOptedOut([sent])).toBe(false);
    expect(studioSelectionOptedOut([withheld])).toBe(true);
    expect(sentStudioSelectionLabel([sent])).toBe("Selected: Door, +1 more");
    expect(sentStudioSelectionLabel([withheld])).toBeUndefined();
  });

  it("merges places and skips the ones the thread excluded", () => {
    const selections = [
      { instanceId: "a", count: 2, names: ["Door", "Wall"] },
      { instanceId: "b", count: 1, names: ["Lamp"], activeScript: "ServerScriptService.Main" },
    ];
    expect(summarizeStudioSelections(selections, undefined)).toEqual({
      count: 3,
      names: ["Door", "Wall", "Lamp"],
      activeScript: "ServerScriptService.Main",
    });
    expect(
      summarizeStudioSelections(selections, {
        excludedPlaces: [{ placeKey: "b", placeName: "B" }],
      }),
    ).toEqual({ count: 2, names: ["Door", "Wall"] });
    expect(summarizeStudioSelections([], undefined)).toBeUndefined();
  });
});
