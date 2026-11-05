import { describe, expect, it } from "vite-plus/test";

import {
  decideRobloxProject,
  isRobloxProjectListing,
  maxScannedSubfolders,
  subfoldersToScan,
  type RobloxProjectSignals,
} from "./robloxProjectDetection.ts";

const signals = (overrides: Partial<RobloxProjectSignals> = {}): RobloxProjectSignals => ({
  mode: "auto",
  allProjects: false,
  hasGameIcon: false,
  containerFolder: false,
  scratchFolder: false,
  folderNames: ["website"],
  title: "website",
  listing: { root: ["package.json", "src"], nested: [] },
  placeNames: [],
  ...overrides,
});

describe("decideRobloxProject", () => {
  it("leaves an ordinary code project alone", () => {
    expect(decideRobloxProject(signals())).toEqual({ applies: false, reason: "no-signal" });
  });

  it("does not turn a code project into a game just because Studio is open", () => {
    expect(decideRobloxProject(signals({ placeNames: ["match"] })).applies).toBe(false);
  });

  it.each([
    ["default.project.json", "root"],
    ["Place1.rbxl", "root"],
    ["game.rbxlx", "root"],
    ["wally.toml", "root"],
    ["rokit.toml", "root"],
    ["default.project.json", "nested"],
  ] as const)("finds %s in the %s of the folder", (file, where) => {
    const listing =
      where === "root"
        ? { root: ["README.md", file], nested: [] }
        : { root: ["README.md", "game"], nested: [file] };
    expect(decideRobloxProject(signals({ listing }))).toEqual({
      applies: true,
      reason: "project-files",
      detail: file,
    });
  });

  it("takes a Roblox game icon as a signal", () => {
    expect(decideRobloxProject(signals({ hasGameIcon: true })).reason).toBe("game-icon");
  });

  it.each(["My Roblox Game", "RobloxGame", "rbx-tycoon", "game_rbx"])("reads the name %s", (n) => {
    expect(decideRobloxProject(signals({ folderNames: [n] })).reason).toBe("folder-name");
  });

  it("does not read rbx inside another word", () => {
    expect(decideRobloxProject(signals({ folderNames: ["herbx"], title: undefined })).applies).toBe(
      false,
    );
  });

  it("matches a connected place to the project by name", () => {
    const named = signals({ folderNames: ["TheDepths-Game"], title: "The Depths" });
    expect(decideRobloxProject({ ...named, placeNames: ["The Depths"] })).toEqual({
      applies: true,
      reason: "studio-place",
      detail: "The Depths",
    });
    expect(decideRobloxProject({ ...named, placeNames: ["Other game"] }).applies).toBe(false);
  });

  it("ignores Studio's default place names when matching", () => {
    expect(
      decideRobloxProject(signals({ folderNames: ["place1-site"], placeNames: ["Place1"] }))
        .applies,
    ).toBe(false);
  });

  it("claims a blank folder once Studio connects, and only then", () => {
    const blank = { root: ["notes.md"], nested: [] };
    expect(decideRobloxProject(signals({ listing: blank })).applies).toBe(false);
    expect(decideRobloxProject(signals({ listing: blank, placeNames: ["match"] }))).toEqual({
      applies: true,
      reason: "studio-place",
      detail: "match",
    });
  });

  it("does not trust loose files in a home-style folder", () => {
    const listing = { root: ["wally.toml", "maps.rbxm"], nested: [] };
    expect(decideRobloxProject(signals({ containerFolder: true, listing })).applies).toBe(false);
    expect(
      decideRobloxProject(signals({ containerFolder: true, listing, placeNames: ["match"] }))
        .applies,
    ).toBe(false);
  });

  it("gives No project threads Studio only while a place is open", () => {
    const scratch = signals({
      scratchFolder: true,
      listing: { root: ["2026-11-02-demo"], nested: ["default.project.json"] },
    });
    expect(decideRobloxProject(scratch)).toEqual({ applies: false, reason: "no-signal" });
    expect(decideRobloxProject({ ...scratch, placeNames: ["match"] })).toEqual({
      applies: true,
      reason: "studio-open",
      detail: "match",
    });
  });

  it("still honours a game icon on a home-style folder", () => {
    expect(decideRobloxProject(signals({ containerFolder: true, hasGameIcon: true })).applies).toBe(
      true,
    );
  });

  it("puts the user's choice above every signal, both ways", () => {
    const roblox = signals({ hasGameIcon: true, listing: { root: ["a.rbxl"], nested: [] } });
    expect(decideRobloxProject({ ...roblox, mode: "other" })).toEqual({
      applies: false,
      reason: "user-choice",
    });
    expect(decideRobloxProject(signals({ mode: "roblox" }))).toEqual({
      applies: true,
      reason: "user-choice",
    });
    expect(decideRobloxProject(signals({ mode: "other", allProjects: true })).applies).toBe(false);
  });

  it("keeps the all projects setting", () => {
    expect(decideRobloxProject(signals({ allProjects: true })).reason).toBe("all-projects");
  });
});

describe("listing helpers", () => {
  it("does not mistake a TypeScript config for a Rojo project", () => {
    expect(isRobloxProjectListing(["tsconfig.project.json"])).toBe(false);
    expect(isRobloxProjectListing(["game.project.json"])).toBe(true);
  });

  it("skips hidden and dependency folders and caps the scan", () => {
    expect(subfoldersToScan([".git", "node_modules", "game", "dist"])).toEqual(["game"]);
    const many = Array.from({ length: 50 }, (_, index) => `folder${String(index)}`);
    expect(subfoldersToScan(many)).toHaveLength(maxScannedSubfolders);
  });
});
