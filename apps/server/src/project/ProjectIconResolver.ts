import { type ProjectRobloxGameIcon } from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";

export const projectIconsDirectory = "project-icons";

const universeLookupUrl = "https://apis.roblox.com/universes/v1/places";
const gameIconsUrl = "https://thumbnails.roblox.com/v1/games/icons";
const requestTimeout = "10 seconds";
const maxIconBytes = 1024 * 1024;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const gamePathPattern = /^(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/(\d{1,15})(?:\/|$)/i;

const UniverseResponse = Schema.Struct({ universeId: Schema.NullOr(Schema.Number) });
const GameIconsResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      targetId: Schema.Number,
      imageUrl: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});

export function parseRobloxPlaceId(input: string): number | null {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(candidate)) return null;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "roblox.com" && !host.endsWith(".roblox.com")) return null;
  const match = gamePathPattern.exec(url.pathname.slice(1));
  const placeId = match === null ? 0 : Number(match[1]);
  return placeId > 0 ? placeId : null;
}

const isPng = (bytes: Uint8Array) =>
  bytes.length <= maxIconBytes && pngSignature.every((byte, index) => bytes[index] === byte);

export class ProjectIconUrlInvalidError extends Schema.TaggedError<ProjectIconUrlInvalidError>()(
  "ProjectIconUrlInvalidError",
  {},
) {
  override get message(): string {
    return "That is not a Roblox game link. Paste a page like https://www.roblox.com/games/123456789/Name.";
  }
}

export class ProjectIconGameNotFoundError extends Schema.TaggedError<ProjectIconGameNotFoundError>()(
  "ProjectIconGameNotFoundError",
  {
    placeId: Schema.optional(Schema.Number),
    universeId: Schema.optional(Schema.Number),
  },
) {
  override get message(): string {
    return "Roblox has no icon for that game. Check the link and try again.";
  }
}

export class ProjectIconFetchError extends Schema.TaggedError<ProjectIconFetchError>()(
  "ProjectIconFetchError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not download the game icon from Roblox. Check the connection and try again.";
  }
}

const ProjectIconError = Schema.Union([
  ProjectIconUrlInvalidError,
  ProjectIconGameNotFoundError,
  ProjectIconFetchError,
]);
export type ProjectIconError = typeof ProjectIconError.Type;
export const isProjectIconError = Schema.is(ProjectIconError);

export class ProjectIconResolver extends Context.Service<
  ProjectIconResolver,
  {
    readonly resolveGameUrl: (
      url: string,
    ) => Effect.Effect<ProjectRobloxGameIcon, ProjectIconError>;
    readonly ensureGameIcon: (
      universeId: number,
    ) => Effect.Effect<string, ProjectIconGameNotFoundError | ProjectIconFetchError>;
  }
>()("t3/project/ProjectIconResolver") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const client = yield* HttpClient.HttpClient;
  const locks = yield* KeyedLock.make<number>();

  const lookupUniverse = Effect.fn("ProjectIconResolver.lookupUniverse")(function* (
    placeId: number,
  ) {
    const response = yield* client
      .execute(HttpClientRequest.get(`${universeLookupUrl}/${placeId}/universe`))
      .pipe(
        Effect.timeout(requestTimeout),
        Effect.mapError((cause) => new ProjectIconFetchError({ cause })),
      );
    if (response.status === 404) return yield* new ProjectIconGameNotFoundError({ placeId });
    const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(UniverseResponse)),
      Effect.timeout(requestTimeout),
      Effect.mapError((cause) => new ProjectIconFetchError({ cause })),
    );
    const universeId = body.universeId;
    if (universeId === null || !Number.isSafeInteger(universeId) || universeId < 1) {
      return yield* new ProjectIconGameNotFoundError({ placeId });
    }
    return universeId;
  });

  const downloadIcon = Effect.fn("ProjectIconResolver.downloadIcon")(function* (
    universeId: number,
  ) {
    const listing = yield* client
      .execute(
        HttpClientRequest.get(gameIconsUrl, {
          urlParams: {
            universeIds: String(universeId),
            returnPolicy: "PlaceHolder",
            size: "150x150",
            format: "Png",
            isCircular: "false",
          },
        }),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GameIconsResponse)),
        Effect.timeout(requestTimeout),
        Effect.mapError((cause) => new ProjectIconFetchError({ cause })),
      );
    const imageUrl = listing.data.find((entry) => entry.targetId === universeId)?.imageUrl;
    if (!imageUrl?.startsWith("https://")) {
      return yield* new ProjectIconGameNotFoundError({ universeId });
    }
    const bytes = yield* client.execute(HttpClientRequest.get(imageUrl)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.timeout(requestTimeout),
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.mapError((cause) => new ProjectIconFetchError({ cause })),
    );
    if (!isPng(bytes)) return yield* new ProjectIconGameNotFoundError({ universeId });
    return bytes;
  });

  const ensureGameIcon = Effect.fn("ProjectIconResolver.ensureGameIcon")(function* (
    universeId: number,
  ) {
    const filePath = path.join(config.attachmentsDir, projectIconsDirectory, `${universeId}.png`);
    return yield* locks.withLock(
      universeId,
      Effect.gen(function* () {
        if (yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false))) {
          return filePath;
        }
        const bytes = yield* downloadIcon(universeId);
        const partialPath = `${filePath}.part`;
        yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
          Effect.andThen(fileSystem.writeFile(partialPath, bytes)),
          Effect.andThen(fileSystem.rename(partialPath, filePath)),
          Effect.mapError((cause) => new ProjectIconFetchError({ cause })),
        );
        return filePath;
      }),
    );
  });

  const resolveGameUrl = Effect.fn("ProjectIconResolver.resolveGameUrl")(function* (url: string) {
    const placeId = parseRobloxPlaceId(url);
    if (placeId === null) return yield* new ProjectIconUrlInvalidError();
    const universeId = yield* lookupUniverse(placeId);
    yield* ensureGameIcon(universeId);
    return { kind: "roblox-game", placeId, universeId } as const;
  });

  return ProjectIconResolver.of({ resolveGameUrl, ensureGameIcon });
});

export const layer = Layer.effect(ProjectIconResolver, make);
