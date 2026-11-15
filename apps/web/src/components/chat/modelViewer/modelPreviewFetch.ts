import type { EnvironmentId } from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";

import { readPreparedConnection } from "~/state/session";

import { readBoundedDocument } from "../../files/readBoundedDocument";
import { glbHeaderProblem, maxGlbBytes, modelPreviewFailureReason } from "./modelPreviewVersions";

export interface ModelViewerSource {
  readonly load: (signal: AbortSignal) => Promise<ArrayBuffer>;
  readonly triangles?: number;
  readonly dimensions?: readonly [number, number, number];
}

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

export function previewModelSource(
  environmentId: EnvironmentId,
  preview: ModelPreviewReference,
): ModelViewerSource {
  return {
    load: (signal) => fetchModelPreviewGlb(environmentId, preview.previewId, signal),
    triangles: preview.triangles,
    dimensions: preview.dimensions,
  };
}

export function fileModelSource(url: string): ModelViewerSource {
  return {
    load: async (signal) => {
      const buffer = await readBoundedDocument(url, signal, maxGlbBytes);
      const problem = glbHeaderProblem(buffer);
      if (problem !== undefined) throw new Error(problem);
      return buffer;
    },
  };
}
