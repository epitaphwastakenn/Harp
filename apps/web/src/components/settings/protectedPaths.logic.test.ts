import { describe, expect, it } from "vite-plus/test";

import { addProtectedPath, protectedPlaceRows, removeProtectedPath } from "./protectedPaths.logic";

const lobby = { placeKey: "place:1", placeName: "Lobby" };

describe("protected path editing", () => {
  it("adds a canonical path, rejects bad and duplicate ones", () => {
    const added = addProtectedPath([], lobby, " workspace.Map ");
    expect(added).toEqual({
      ok: true,
      places: [{ ...lobby, paths: ["game.Workspace.Map"] }],
    });
    if (!added.ok) return;
    expect(addProtectedPath(added.places, lobby, "game.workspace.map")).toEqual({
      ok: false,
      error: "That path is already protected.",
    });
    expect(addProtectedPath(added.places, lobby, "game.Workspace.Map2")).toMatchObject({
      ok: true,
    });
    expect(addProtectedPath(added.places, lobby, "game.Workspace[Map]").ok).toBe(false);
    expect(addProtectedPath(added.places, lobby, "").ok).toBe(false);
  });

  it("removes a path and drops a place left with none", () => {
    const saved = [{ ...lobby, paths: ["game.A", "game.B"] }];
    expect(removeProtectedPath(saved, "place:1", "game.A")).toEqual([
      { ...lobby, paths: ["game.B"] },
    ]);
    expect(removeProtectedPath(saved, "place:1", "game.B").length).toBe(1);
    expect(removeProtectedPath([{ ...lobby, paths: ["game.A"] }], "place:1", "game.A")).toEqual([]);
  });

  it("lists saved places that are not connected next to connected ones", () => {
    const rows = protectedPlaceRows(
      [{ placeKey: "place:2", placeName: "Arena", paths: ["game.A"] }],
      [{ instanceId: "anon:x", placeKey: "place:1", placeName: "Lobby" }],
    );
    expect(rows.map((row) => [row.placeName, row.connected])).toEqual([
      ["Arena", false],
      ["Lobby", true],
    ]);
  });
});
