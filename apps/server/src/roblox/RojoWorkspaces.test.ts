import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as RojoWorkspaces from "./RojoWorkspaces.ts";

const tree = (shared: boolean) => ({
  name: "project",
  tree: {
    $className: "DataModel",
    ReplicatedStorage: {
      $className: "ReplicatedStorage",
      $path: "src/ReplicatedStorage",
      ...(shared ? { Shared: { $path: "../../shared/Shared.luau" } } : {}),
    },
  },
});

const makeWorkspace = Effect.fn("makeWorkspace")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "harp-rojo-" });
  const write = (relative: string, text: string) =>
    fs
      .makeDirectory(path.dirname(path.join(root, relative)), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path.join(root, relative), text)));
  for (const place of ["lobby", "match"]) {
    yield* write(`places/${place}/default.project.json`, JSON.stringify(tree(true)));
    yield* write(`places/${place}/src/ReplicatedStorage/Config.luau`, `return "${place}"\n`);
  }
  yield* write("shared/Shared.luau", "return {}\n");
  yield* write("node_modules/pkg/default.project.json", JSON.stringify(tree(false)));
  yield* write("docs/old/lobby.default.project.json", JSON.stringify(tree(false)));
  yield* write(
    ".vscode/tasks.json",
    '{ "tasks": [{ "command": "rojo serve places/match/default.project.json --port 45873" }] }',
  );
  return root;
});

const layer = RojoWorkspaces.layer.pipe(Layer.provideMerge(NodeServices.layer));

describe("RojoWorkspaces", () => {
  it.live(
    "finds each place of a multi-place workspace and skips dependencies and stray copies",
    () =>
      Effect.gen(function* () {
        const root = yield* makeWorkspace();
        const rojo = yield* RojoWorkspaces.RojoWorkspaces;
        const projects = yield* rojo.projects(root);
        expect(projects.map((project) => [project.label, project.file, project.port])).toEqual([
          ["lobby", "places/lobby/default.project.json", 34872],
          ["match", "places/match/default.project.json", 45873],
        ]);
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live("locates a script's file by the place it belongs to", () =>
    Effect.gen(function* () {
      const root = yield* makeWorkspace();
      const rojo = yield* RojoWorkspaces.RojoWorkspaces;
      const byName = yield* rojo.locateScript({
        root,
        instancePath: "game.ReplicatedStorage.Config",
        placeName: "My Game Match",
      });
      expect(byName).toMatchObject({
        kind: "found",
        relative: "places/match/src/ReplicatedStorage/Config.luau",
        serving: false,
      });
      const byText = yield* rojo.locateScript({
        root,
        instancePath: "game.ReplicatedStorage.Config",
        placeName: "Place1",
        studioSource: 'return "lobby"\r\n',
      });
      expect(byText).toMatchObject({
        kind: "found",
        relative: "places/lobby/src/ReplicatedStorage/Config.luau",
      });
      const unknown = yield* rojo.locateScript({
        root,
        instancePath: "game.ReplicatedStorage.Config",
        placeName: "Place1",
      });
      expect(unknown).toMatchObject({ kind: "ambiguous" });
      const shared = yield* rojo.locateScript({
        root,
        instancePath: "game.ReplicatedStorage.Shared",
        placeName: "Place1",
      });
      expect(shared).toMatchObject({ kind: "found", relative: "shared/Shared.luau" });
      expect(
        yield* rojo.locateScript({ root, instancePath: "game.Workspace.Door.Script" }),
      ).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
