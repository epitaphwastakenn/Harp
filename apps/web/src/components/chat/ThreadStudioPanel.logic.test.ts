import { describe, expect, it } from "vite-plus/test";

import {
  studioPlaceChange,
  studioPlaceDetail,
  studioPlaceRows,
  studioPlaceTone,
  studioTargetSummary,
} from "./ThreadStudioPanel.logic";

const edit = (instanceId: string, placeName: string, placeKey = instanceId) => ({
  instanceId,
  placeKey,
  role: "edit",
  placeName,
  isRunning: false,
});

describe("studioPlaceRows", () => {
  it("groups a place's peers into one row and marks a running playtest", () => {
    const rows = studioPlaceRows(
      [
        edit("place:1", "Lobby"),
        { instanceId: "place:1", placeKey: "place:1", role: "server", isRunning: true },
        edit("anon:b", "Arena"),
      ],
      undefined,
    );
    expect(rows.map((row) => [row.name, row.included, row.playtestRunning])).toEqual([
      ["Arena", true, false],
      ["Lobby", true, true],
    ]);
  });

  it("keeps a turned-off place that is not connected so it can be turned back on", () => {
    const rows = studioPlaceRows([edit("place:1", "Lobby")], {
      excludedPlaces: [
        { placeKey: "place:1", placeName: "Lobby" },
        { placeKey: "anon:gone", placeName: "Old" },
      ],
    });
    expect(rows.map((row) => [row.name, row.included, row.connected])).toEqual([
      ["Lobby", false, true],
      ["Old", false, false],
    ]);
    expect(studioPlaceDetail(rows[1]!)).toBe("Not connected");
    expect(studioPlaceDetail(rows[0]!)).toBe("Ignored by the agent");
  });

  it("builds the change that flips a row", () => {
    const [row] = studioPlaceRows([edit("place:1", "Lobby")], undefined);
    expect(studioPlaceChange(row!, false)).toEqual({
      excludePlaces: [{ placeKey: "place:1", placeName: "Lobby" }],
    });
    expect(studioPlaceChange(row!, true)).toEqual({ includePlaces: ["place:1"] });
  });
});

const namedPlace = (name: string, role: string = "edit") => ({
  instanceId: `id:${name}:${role}`,
  placeKey: `place:${name}`,
  role,
  placeName: name,
});

describe("studioTargetSummary", () => {
  it("names the first place and counts the others", () => {
    const rows = studioPlaceRows(
      [namedPlace("TD Testing"), namedPlace("Lobby"), namedPlace("match")],
      undefined,
    );
    expect(studioTargetSummary(rows, undefined)).toEqual({
      label: "Lobby",
      extra: 2,
      tone: "success",
    });
  });

  it("leads with the place that has a playtest running", () => {
    const rows = studioPlaceRows(
      [namedPlace("Lobby"), namedPlace("match"), namedPlace("match", "server")],
      {},
    );
    expect(studioTargetSummary(rows, undefined)).toEqual({
      label: "match",
      extra: 1,
      tone: "info",
    });
  });

  it("skips switched off places", () => {
    const controls = { excludedPlaces: [{ placeKey: "place:Lobby", placeName: "Lobby" }] };
    const rows = studioPlaceRows([namedPlace("Lobby"), namedPlace("match")], controls);
    expect(studioTargetSummary(rows, controls)).toEqual({
      label: "match",
      extra: 0,
      tone: "brand",
    });
  });

  it("says so when the agent has no place to work in", () => {
    expect(studioTargetSummary([], undefined)).toMatchObject({ label: "No place open", extra: 0 });
    const controls = { excludedPlaces: [{ placeKey: "place:Lobby", placeName: "Lobby" }] };
    const rows = studioPlaceRows([namedPlace("Lobby")], controls);
    expect(studioTargetSummary(rows, controls)).toMatchObject({
      label: "No place selected",
      tone: "muted",
    });
  });

  it("marks a place that is gone and keeps it switched off", () => {
    const controls = { excludedPlaces: [{ placeKey: "place:Old", placeName: "Old" }] };
    const [row] = studioPlaceRows([], controls);
    expect(row).toMatchObject({ name: "Old", connected: false, included: false });
    expect(studioPlaceTone(row!)).toBe("muted");
    expect(studioPlaceChange(row!, true)).toEqual({ includePlaces: ["place:Old"] });
  });
});
