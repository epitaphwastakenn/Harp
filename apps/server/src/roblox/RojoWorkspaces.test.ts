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

describe("RojoWorkspaces structural saves", () => {
  const workspace = Effect.fn("structuralWorkspace")(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "harp-rojo-struct-" });
    yield* fs.makeDirectory(`${root}/src/server/Combat`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/default.project.json`,
      JSON.stringify({
        name: "game",
        servePort: 45872,
        tree: { $className: "DataModel", ServerScriptService: { $path: "src/server" } },
      }),
    );
    yield* fs.writeFileString(`${root}/src/server/Main.server.luau`, "print(1)\n");
    yield* fs.writeFileString(`${root}/src/server/Main.meta.json`, "{}");
    yield* fs.writeFileString(`${root}/src/server/Util.luau`, "return {}\n");
    yield* fs.writeFileString(`${root}/src/server/Combat/Hit.luau`, "return 1\n");
    return root;
  });

  it.live("creates files and folders under a synced folder and promotes a script parent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* workspace();
      const rojo = yield* RojoWorkspaces.RojoWorkspaces;
      const folder = yield* rojo.locateParent({
        root,
        instancePath: "game.ServerScriptService.Combat",
      });
      expect(folder).toMatchObject({ kind: "directory", serving: false });
      const made = yield* rojo.createEntries({
        root,
        parent: folder!,
        nodes: [
          { name: "Swing", className: "Script", source: "print('swing')", children: [] },
          { name: "Fx", className: "Folder", children: [] },
        ],
      });
      expect(made).toEqual({
        ok: true,
        files: ["src/server/Combat/Swing.server.luau", "src/server/Combat/Fx"],
      });
      expect(yield* fs.readFileString(`${root}/src/server/Combat/Swing.server.luau`)).toBe(
        "print('swing')",
      );
      expect((yield* fs.stat(`${root}/src/server/Combat/Fx`)).type).toBe("Directory");
      const again = yield* rojo.createEntries({
        root,
        parent: folder!,
        nodes: [{ name: "Swing", className: "ModuleScript", children: [] }],
      });
      expect(again.ok).toBe(false);

      const script = yield* rojo.locateParent({
        root,
        instancePath: "game.ServerScriptService.Util",
      });
      expect(script).toMatchObject({ kind: "script" });
      const child = yield* rojo.createEntries({
        root,
        parent: script!,
        nodes: [{ name: "Types", className: "ModuleScript", children: [] }],
      });
      expect(child.ok).toBe(true);
      expect(yield* fs.readFileString(`${root}/src/server/Util/init.luau`)).toBe("return {}\n");
      expect(yield* fs.exists(`${root}/src/server/Util/Types.luau`)).toBe(true);
      expect(yield* fs.exists(`${root}/src/server/Util.luau`)).toBe(false);
      expect(
        yield* rojo.locateParent({ root, instancePath: "game.Workspace.Map" }),
      ).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live(
    "moves deleted files to the trash folder and renames or moves files with their meta",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* workspace();
        const rojo = yield* RojoWorkspaces.RojoWorkspaces;
        const main = yield* rojo.locateEntry({
          root,
          instancePath: "game.ServerScriptService.Main",
        });
        expect(main).toMatchObject({
          entry: "file",
          script: true,
          relative: "src/server/Main.server.luau",
        });

        const renamed = yield* rojo.moveEntry({ root, location: main!, name: "Boot" });
        expect(renamed).toEqual({ ok: true, files: ["src/server/Boot.server.luau"] });
        expect(yield* fs.exists(`${root}/src/server/Boot.meta.json`)).toBe(true);
        expect(yield* fs.exists(`${root}/src/server/Main.meta.json`)).toBe(false);

        const boot = yield* rojo.locateEntry({
          root,
          instancePath: "game.ServerScriptService.Boot",
        });
        const combat = yield* rojo.locateParent({
          root,
          instancePath: "game.ServerScriptService.Combat",
        });
        const moved = yield* rojo.moveEntry({ root, location: boot!, to: combat! });
        expect(moved).toEqual({ ok: true, files: ["src/server/Combat/Boot.server.luau"] });
        const into = yield* rojo.moveEntry({
          root,
          location: (yield* rojo.locateEntry({
            root,
            instancePath: "game.ServerScriptService.Combat",
          }))!,
          to: combat!,
        });
        expect(into.ok).toBe(false);

        const hit = yield* rojo.locateEntry({
          root,
          instancePath: "game.ServerScriptService.Combat.Hit",
        });
        const trashed = yield* rojo.trashEntry({ root, location: hit! });
        expect(trashed.ok).toBe(true);
        const files = trashed.ok ? trashed.files : [];
        expect(files[0]).toMatch(/^\.harp\/rojo-trash\/[^/]+\/src\/server\/Combat\/Hit\.luau$/u);
        expect(yield* fs.readFileString(`${root}/${files[0]}`)).toBe("return 1\n");
        expect(yield* fs.exists(`${root}/src/server/Combat/Hit.luau`)).toBe(false);
        expect(yield* fs.readFileString(`${root}/.harp/.gitignore`)).toBe("*\n");
        expect(
          yield* rojo.locateEntry({ root, instancePath: "game.ServerScriptService" }),
        ).toBeUndefined();
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
