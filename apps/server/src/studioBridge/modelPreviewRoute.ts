import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";
import * as ServerConfig from "../config.ts";
import { MODEL_PREVIEW_ROUTE_PREFIX, resolveModelPreview } from "./modelPreviews.ts";

const notFound = HttpServerResponse.text("Not Found", {
  status: 404,
  headers: { "cache-control": "private, no-store" },
});

/**
 * GET /api/studio/model-previews/<previewId>: the GLB of a Blender job, by the opaque id the
 * blender tool result carries. Needs the same session as the rest of the API (cookie or bearer).
 */
export const layerModelPreviewRoute = HttpRouter.add(
  "GET",
  `${MODEL_PREVIEW_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
      Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
        failEnvironmentAuthInvalid(
          EnvironmentAuth.serverAuthCredentialReason(error),
          EnvironmentAuth.serverAuthDpopFailureReason(error),
        ),
      ),
      Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
        failEnvironmentInternal("internal_error", error),
      ),
    );
    if (!session.scopes.includes(AuthOrchestrationReadScope)) {
      return yield* failEnvironmentScopeRequired(AuthOrchestrationReadScope);
    }
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const previewId = url.value.pathname.slice(`${MODEL_PREVIEW_ROUTE_PREFIX}/`.length);
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const preview = resolveModelPreview(path.join(config.stateDir, "blender-jobs"), previewId);
    if (preview === undefined) return notFound;
    const fileSystem = yield* FileSystem.FileSystem;
    const bytes = yield* fileSystem.readFile(preview.path).pipe(Effect.option);
    if (Option.isNone(bytes)) return notFound;
    return HttpServerResponse.uint8Array(bytes.value, {
      contentType: "model/gltf-binary",
      headers: { "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
    });
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);
