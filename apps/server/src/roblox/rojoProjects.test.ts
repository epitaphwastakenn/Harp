import { describe, expect, it } from "@effect/vitest";

import {
  applyScriptEdits,
  arrangeRojoProjects,
  parseInstancePath,
  parseRojoProject,
  planRojoCreation,
  renameRojoEntry,
  rojoEntryNameProblem,
  rojoEntryParent,
  rojoLayout,
  rojoParentTarget,
  rojoPortHints,
  rojoProjectsForPlace,
  rojoScriptCandidates,
  rojoSidecarName,
  rojoTextConflict,
  rojoTrashStamp,
  rojoTrashTarget,
  type ParsedRojoProject,
} from "./rojoProjects.ts";

const placeTree = {
  $className: "DataModel",
  ReplicatedStorage: {
    $className: "ReplicatedStorage",
    DataService: {
      $path: "src/ReplicatedStorage/DataService",
      Networker: { $path: "../../shared/src/ReplicatedStorage/DataService/Networker" },
    },
    Config: { $path: "src/shared/Config.luau" },
  },
  ServerScriptService: { $path: "src/ServerScriptService" },
};

const parse = (file: string, extra: Record<string, unknown> = {}) =>
  parseRojoProject(file, JSON.stringify({ name: "project", tree: placeTree, ...extra }))!;

describe("Rojo project discovery", () => {
  it("reads a place project and tells it from a model project", () => {
    const place = parse("places/lobby/default.project.json", {
      servePort: 34900,
      servePlaceIds: [123],
    });
    expect(place).toMatchObject({ kind: "place", servePort: 34900, placeIds: [123] });
    const model = parseRojoProject(
      "packages/ui/default.project.json",
      JSON.stringify({ name: "ui", tree: { $path: "src" } }),
    );
    expect(model?.kind).toBe("model");
    expect(parseRojoProject("default.project.json", "not json")).toBeUndefined();
  });

  it("names each place of a multi-place workspace by its folder and gives each a port", () => {
    const projects = arrangeRojoProjects([
      parse("places/match/default.project.json"),
      parse("places/lobby/default.project.json"),
    ]);
    expect(projects.map((project) => [project.label, project.port])).toEqual([
      ["lobby", 34872],
      ["match", 34873],
    ]);
    expect(rojoLayout(projects)).toBe("multi");
  });

  it("keeps the ports the workspace already uses in its editor tasks", () => {
    const hints = rojoPortHints(
      '{ "command": "rojo serve places/lobby/default.project.json --port 34880" },\n{ "command": "rojo serve places\\\\match\\\\default.project.json --port 34881" }',
    );
    const projects = arrangeRojoProjects(
      [parse("places/lobby/default.project.json"), parse("places/match/default.project.json")],
      hints,
    );
    expect(projects.map((project) => project.port)).toEqual([34880, 34881]);
  });

  it("treats one place project as a single-place workspace and hides its model projects", () => {
    const model: ParsedRojoProject = {
      file: "packages/ui/default.project.json",
      name: "ui",
      kind: "model",
      servePort: undefined,
      placeIds: [],
      tree: { $path: "src" },
    };
    const projects = arrangeRojoProjects([model, parse("default.project.json")]);
    expect(rojoLayout(projects)).toBe("single");
    expect(rojoLayout([])).toBe("none");
  });

  it("picks the project of a connected place by place id, then by name", () => {
    const projects = arrangeRojoProjects([
      parse("places/lobby/default.project.json", { servePlaceIds: [111] }),
      parse("places/match/default.project.json"),
    ]);
    expect(rojoProjectsForPlace(projects, { placeId: 111 }).map((p) => p.label)).toEqual(["lobby"]);
    expect(
      rojoProjectsForPlace(projects, { placeName: "Sugary District - Match" }).map((p) => p.label),
    ).toEqual(["match"]);
    expect(rojoProjectsForPlace(projects, { placeName: "Place1" })).toHaveLength(2);
  });
});

describe("instance paths in a Rojo tree", () => {
  it("splits dotted and bracketed names", () => {
    expect(parseInstancePath('game.Workspace["My Part"].Script')).toEqual([
      "Workspace",
      "My Part",
      "Script",
    ]);
    expect(parseInstancePath("game")).toBeUndefined();
    expect(parseInstancePath("game.Workspace[unquoted]")).toBeUndefined();
  });

  it("maps a script to its file through explicit nodes and folders", () => {
    const project = { tree: placeTree };
    expect(
      rojoScriptCandidates(project, ["ServerScriptService", "Managers", "Badges"]).slice(0, 4),
    ).toEqual([
      "src/ServerScriptService/Managers/Badges.luau",
      "src/ServerScriptService/Managers/Badges.lua",
      "src/ServerScriptService/Managers/Badges.server.luau",
      "src/ServerScriptService/Managers/Badges.server.lua",
    ]);
    expect(
      rojoScriptCandidates(project, ["ReplicatedStorage", "DataService", "Networker"]),
    ).toContain("../../shared/src/ReplicatedStorage/DataService/Networker/init.luau");
    expect(rojoScriptCandidates(project, ["ReplicatedStorage", "Config"])).toEqual([
      "src/shared/Config.luau",
    ]);
    expect(rojoScriptCandidates(project, ["Workspace", "Map", "Door"])).toEqual([]);
  });
});

describe("edits applied to a synced file", () => {
  it("replaces unique matches and uses line to pick between repeats", () => {
    expect(
      applyScriptEdits("local a = 1\nlocal b = 2\n", [{ oldString: "b = 2", newString: "b = 3" }]),
    ).toEqual({ ok: true, text: "local a = 1\nlocal b = 3\n" });
    expect(
      applyScriptEdits("x()\ny()\nx()\n", [{ oldString: "x()", newString: "z()", line: 3 }]),
    ).toEqual({ ok: true, text: "x()\ny()\nz()\n" });
  });

  it("refuses edits that are missing, repeated without a line, or overlapping", () => {
    expect(applyScriptEdits("a", [{ oldString: "b", newString: "c" }]).ok).toBe(false);
    expect(applyScriptEdits("a a", [{ oldString: "a", newString: "c" }]).ok).toBe(false);
    expect(
      applyScriptEdits("abcd", [
        { oldString: "abc", newString: "x" },
        { oldString: "bcd", newString: "y" },
      ]).ok,
    ).toBe(false);
  });
});

describe("structural saves in a Rojo project", () => {
  const project = { tree: placeTree };

  it("names the file for each script class and for scripts with children", () => {
    expect(
      planRojoCreation("src/server", [
        { name: "Main", className: "Script", source: "print(1)", children: [] },
        { name: "Hud", className: "LocalScript", children: [] },
        { name: "Util", className: "ModuleScript", source: "return {}", children: [] },
        { name: "Agent", className: "Script", runContext: "Client", children: [] },
        { name: "Models", className: "Folder", children: [] },
      ]).map((entry) => [entry.path, entry.kind]),
    ).toEqual([
      ["src/server/Main.server.luau", "file"],
      ["src/server/Hud.client.luau", "file"],
      ["src/server/Util.luau", "file"],
      ["src/server/Agent.client.luau", "file"],
      ["src/server/Models", "directory"],
    ]);
    expect(
      planRojoCreation("src", [
        {
          name: "Service",
          className: "ModuleScript",
          source: "return {}",
          children: [
            { name: "Types", className: "ModuleScript", children: [] },
            { name: "Sub", className: "Folder", children: [] },
          ],
        },
      ]),
    ).toEqual([
      { path: "src/Service", kind: "directory" },
      { path: "src/Service/init.luau", kind: "file", content: "return {}" },
      { path: "src/Service/Types.luau", kind: "file", content: "" },
      { path: "src/Service/Sub", kind: "directory" },
    ]);
  });

  it("maps an instance path to the folder or file that backs it", () => {
    expect(rojoParentTarget(project, ["ServerScriptService", "Combat"])).toEqual({
      kind: "directory",
      base: "src/ServerScriptService",
      rest: ["Combat"],
    });
    expect(rojoParentTarget(project, ["ReplicatedStorage", "Config"])).toEqual({
      kind: "file",
      file: "src/shared/Config.luau",
    });
    expect(rojoParentTarget(project, ["Workspace"])).toBeUndefined();
    expect(rojoEntryParent(project, ["ServerScriptService", "Combat", "Hit"])).toEqual({
      directory: "src/ServerScriptService/Combat",
      name: "Hit",
    });
    expect(rojoEntryParent(project, ["ServerScriptService"])).toBeUndefined();
    expect(rojoEntryParent(project, ["ReplicatedStorage", "Config", "Child"])).toBeUndefined();
  });

  it("renames files and sidecars without losing the script suffix", () => {
    expect(renameRojoEntry("Main.server.luau", "file", "Boot")).toBe("Boot.server.luau");
    expect(renameRojoEntry("Util.luau", "file", "Tools")).toBe("Tools.luau");
    expect(renameRojoEntry("Combat", "directory", "Fight")).toBe("Fight");
    expect(renameRojoEntry("data.json", "file", "x")).toBeUndefined();
    expect(rojoSidecarName("Main.server.luau")).toBe("Main.meta.json");
    expect(rojoEntryNameProblem("Good Name")).toBeUndefined();
    expect(rojoEntryNameProblem("a/b")).toContain("characters");
    expect(rojoEntryNameProblem("..")).toBeDefined();
  });

  it("builds trash paths under the workspace's .harp folder", () => {
    expect(rojoTrashStamp(0)).toBe("1970-01-01T00-00-00-000Z");
    expect(rojoTrashTarget("stamp", "src/server/Main.server.luau")).toBe(
      ".harp/rojo-trash/stamp/src/server/Main.server.luau",
    );
  });

  it("flags only Studio text that is neither the baseline nor the file", () => {
    const base = { baseline: "a\n", fileText: "a\n", studioText: "a\r\n" };
    expect(rojoTextConflict(base)).toBe(false);
    expect(rojoTextConflict({ ...base, studioText: "typed in Studio\n" })).toBe(true);
    expect(rojoTextConflict({ ...base, fileText: "b\n", studioText: "b\n" })).toBe(false);
    expect(rojoTextConflict({ ...base, baseline: undefined, studioText: "x" })).toBe(false);
  });
});
