import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientError, HttpClientResponse, UrlParams } from "effect/http";
import { describe, expect, it } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as ProjectIconResolver from "./ProjectIconResolver.ts";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const gameUrl = "https://www.roblox.com/games/920587237/Adopt-Me";
const iconUrl = "https://tr.rbxcdn.com/icon/150/150/Image/Png/noFilter";

describe("parseRobloxPlaceId", () => {
  it("reads the place id from a game page link", () => {
    for (const [input, placeId] of [
      ["https://www.roblox.com/games/123456789/Name", 123456789],
      ["https://www.roblox.com/games/123456789", 123456789],
      ["https://www.roblox.com/games/123456789/", 123456789],
      ["  https://www.roblox.com/games/42/Some-Name?privateServerLinkCode=1  ", 42],
      ["http://roblox.com/games/42/Name#top", 42],
      ["roblox.com/games/42/Name", 42],
      ["www.roblox.com/games/42", 42],
      ["https://web.roblox.com/games/42/Name", 42],
      ["https://www.roblox.com/es/games/42/Name", 42],
      ["https://www.roblox.com/pt-br/games/42/Name", 42],
      ["https://WWW.ROBLOX.COM/Games/42/Name", 42],
    ] as const) {
      expect(ProjectIconResolver.parseRobloxPlaceId(input), input).toBe(placeId);
    }
  });

  it("refuses anything that is not a game page on roblox.com", () => {
    for (const input of [
      "",
      "   ",
      "123456789",
      "not a link",
      "https://www.roblox.com/",
      "https://www.roblox.com/users/42/profile",
      "https://www.roblox.com/games/",
      "https://www.roblox.com/games/abc/Name",
      "https://www.roblox.com/games/0/Name",
      "https://www.roblox.com/games/42abc/Name",
      "https://www.roblox.com/games/1234567890123456/Name",
      "https://www.roblox.com/catalog/42/games/42",
      "https://evilroblox.com/games/42/Name",
      "https://roblox.com.evil.test/games/42/Name",
      "https://roblox.com@evil.test/games/42/Name",
      "https://example.com/games/42/Name",
      "ftp://www.roblox.com/games/42/Name",
      "javascript://www.roblox.com/games/42",
    ]) {
      expect(ProjectIconResolver.parseRobloxPlaceId(input), input).toBeNull();
    }
  });
});

const jsonResponse = (
  request: Parameters<Parameters<typeof HttpClient.make>[0]>[0],
  body: unknown,
) => Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body)));

const fakeRoblox = (
  options: {
    readonly image?: Uint8Array;
    readonly transportFailure?: boolean;
  } = {},
) => {
  const requests: Array<string> = [];
  const client = HttpClient.make((request) => {
    if (options.transportFailure) {
      return Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, description: "offline" }),
        }),
      );
    }
    const params = UrlParams.toString(request.urlParams);
    requests.push(params === "" ? request.url : `${request.url}?${params}`);
    if (request.url === "https://apis.roblox.com/universes/v1/places/920587237/universe") {
      return jsonResponse(request, { universeId: 383310974 });
    }
    if (request.url === "https://apis.roblox.com/universes/v1/places/1/universe") {
      return jsonResponse(request, { universeId: null });
    }
    if (request.url === "https://thumbnails.roblox.com/v1/games/icons") {
      return jsonResponse(request, {
        data: [{ targetId: 383310974, state: "Completed", imageUrl: iconUrl }],
      });
    }
    if (request.url === iconUrl) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(options.image ?? pngBytes)),
      );
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response("missing", { status: 404 })),
    );
  });
  return { client, requests };
};

const layerFor = (client: HttpClient.HttpClient) =>
  ProjectIconResolver.layer.pipe(
    Layer.provideMerge(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "project-icon-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const cachedIconPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  return path.join(
    config.attachmentsDir,
    ProjectIconResolver.projectIconsDirectory,
    "383310974.png",
  );
});

const thumbnailsUrl =
  "https://thumbnails.roblox.com/v1/games/icons?universeIds=383310974&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false";
const universeUrl = "https://apis.roblox.com/universes/v1/places/920587237/universe";

describe("ProjectIconResolver", () => {
  effectIt.effect("fetches a missing icon, stores it, and answers with the stored ids", () => {
    const { client, requests } = fakeRoblox();
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      const fileSystem = yield* FileSystem.FileSystem;
      const icon = yield* resolver.resolveGameUrl(gameUrl);
      assert.deepEqual(icon, { kind: "roblox-game", placeId: 920587237, universeId: 383310974 });
      assert.deepEqual(requests, [universeUrl, thumbnailsUrl, iconUrl]);
      assert.deepEqual(yield* fileSystem.readFile(yield* cachedIconPath), pngBytes);
    }).pipe(Effect.provide(layerFor(client)));
  });

  effectIt.effect("does not fetch again while the stored file exists", () => {
    const { client, requests } = fakeRoblox();
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      yield* resolver.resolveGameUrl(gameUrl);
      requests.length = 0;
      const stored = yield* resolver.ensureGameIcon(383310974);
      assert.strictEqual(stored, yield* cachedIconPath);
      assert.deepEqual(requests, []);
      yield* resolver.resolveGameUrl(gameUrl);
      assert.deepEqual(requests, [universeUrl]);
    }).pipe(Effect.provide(layerFor(client)));
  });

  effectIt.effect("fetches again once the stored file is gone", () => {
    const { client, requests } = fakeRoblox();
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* resolver.ensureGameIcon(383310974);
      yield* fileSystem.remove(yield* cachedIconPath);
      requests.length = 0;
      yield* resolver.ensureGameIcon(383310974);
      assert.deepEqual(requests, [thumbnailsUrl, iconUrl]);
      assert.isTrue(yield* fileSystem.exists(yield* cachedIconPath));
    }).pipe(Effect.provide(layerFor(client)));
  });

  effectIt.effect("concurrent requests for one game download its icon once", () => {
    const { client, requests } = fakeRoblox();
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      yield* Effect.all([resolver.ensureGameIcon(383310974), resolver.ensureGameIcon(383310974)], {
        concurrency: 2,
      });
      assert.deepEqual(requests, [thumbnailsUrl, iconUrl]);
    }).pipe(Effect.provide(layerFor(client)));
  });

  effectIt.effect("rejects a link that is not a game page without asking Roblox", () => {
    const { client, requests } = fakeRoblox();
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      const error = yield* resolver
        .resolveGameUrl("https://example.com/games/920587237")
        .pipe(Effect.flip);
      assert.instanceOf(error, ProjectIconResolver.ProjectIconUrlInvalidError);
      assert.deepEqual(requests, []);
    }).pipe(Effect.provide(layerFor(client)));
  });

  effectIt.effect("reports an unknown place and keeps nothing on disk", () => {
    const { client, requests } = fakeRoblox();
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      const fileSystem = yield* FileSystem.FileSystem;
      const error = yield* resolver
        .resolveGameUrl("https://www.roblox.com/games/1/Nothing")
        .pipe(Effect.flip);
      assert.instanceOf(error, ProjectIconResolver.ProjectIconGameNotFoundError);
      assert.deepEqual(requests, ["https://apis.roblox.com/universes/v1/places/1/universe"]);
      assert.isFalse(yield* fileSystem.exists(yield* cachedIconPath));
    }).pipe(Effect.provide(layerFor(client)));
  });

  effectIt.effect("reports an unreachable Roblox without storing anything", () => {
    const { client } = fakeRoblox({ transportFailure: true });
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      const fileSystem = yield* FileSystem.FileSystem;
      const error = yield* resolver.resolveGameUrl(gameUrl).pipe(Effect.flip);
      assert.instanceOf(error, ProjectIconResolver.ProjectIconFetchError);
      assert.isFalse(yield* fileSystem.exists(yield* cachedIconPath));
      const iconError = yield* resolver.ensureGameIcon(383310974).pipe(Effect.flip);
      assert.instanceOf(iconError, ProjectIconResolver.ProjectIconFetchError);
    }).pipe(Effect.provide(layerFor(client)));
  });

  effectIt.effect("does not keep a download that is not a PNG", () => {
    const { client } = fakeRoblox({ image: new TextEncoder().encode("<html>not an image</html>") });
    return Effect.gen(function* () {
      const resolver = yield* ProjectIconResolver.ProjectIconResolver;
      const fileSystem = yield* FileSystem.FileSystem;
      const error = yield* resolver.ensureGameIcon(383310974).pipe(Effect.flip);
      assert.instanceOf(error, ProjectIconResolver.ProjectIconGameNotFoundError);
      assert.isFalse(yield* fileSystem.exists(yield* cachedIconPath));
    }).pipe(Effect.provide(layerFor(client)));
  });
});
