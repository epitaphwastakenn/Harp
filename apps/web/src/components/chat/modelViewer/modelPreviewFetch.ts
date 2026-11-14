import type { EnvironmentId } from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";

import { readPreparedConnection } from "~/state/session";

import { modelPreviewFailureReason } from "./modelPreviewVersions";

const modelPreviewRoute = "/api/studio/model-previews";
const fetchTimeoutMs = 60_000;

/** The GLB needs the environment's session, so it is fetched with that connection rather than loaded by URL. */
export async function fetchModelPreviewGlb(
  environmentId: EnvironmentId,
  previewId: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const connection = readPreparedConnection(environmentId);
  const url =
    connection === null
      ? null
      : resolveAssetUrl(connection.httpBaseUrl, `${modelPreviewRoute}/${previewId}`);
  if (connection === null || url === null) {
    throw new Error("Reconnect to this environment to view the model.");
  }
  const authorization = connection.httpAuthorization;
  const response = await fetch(
    url,
    authorization === null
      ? {
          signal: AbortSignal.any([signal, AbortSignal.timeout(fetchTimeoutMs)]),
          credentials: "include",
        }
      : {
          signal: AbortSignal.any([signal, AbortSignal.timeout(fetchTimeoutMs)]),
          headers: { authorization: `Bearer ${authorization.token}` },
        },
  ).catch((cause: unknown) => {
    if (signal.aborted) throw cause;
    throw new Error("The model file could not be downloaded.");
  });
  if (!response.ok) throw new Error(modelPreviewFailureReason(response.status));
  return response.arrayBuffer();
}
