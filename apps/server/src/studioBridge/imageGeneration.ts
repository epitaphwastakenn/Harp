// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalDate:off globalRandomInEffect:off globalTimers:off preferSchemaOverJson:off globalFetchInEffect:off -Image jobs are plain folders and the provider is reached with fetch.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { RobloxStudioSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { JOB_FOLDER_PREFIX, pruneJobFolders } from "./modelPreviews.ts";
import type { ImagePurpose } from "./imagePixelChecks.ts";

export const imagePurposes = ["particle", "icon", "decal", "tile", "ui"] as const;
export const maxImagesPerCall = 4;
const requestTimeoutMs = 180_000;
const maxImageBytes = 24 * 1024 * 1024;
const maxErrorChars = 300;

const presets = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-1" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.5-flash-image",
  },
  custom: { baseUrl: "", model: "" },
} as const;

export interface ImageProviderConfig {
  readonly provider: RobloxStudioSettings["imageProvider"];
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export type ImageProviderResolution =
  | { readonly ok: true; readonly config: ImageProviderConfig }
  | { readonly ok: false; readonly reason: string };

const trimSlash = (value: string) => value.replace(/\/+$/u, "");

/** Settings to a usable provider; the reason says which setting is missing. */
export const resolveImageProvider = (
  settings: Pick<
    RobloxStudioSettings,
    "imageGeneration" | "imageProvider" | "imageBaseUrl" | "imageModel" | "imageApiKey"
  >,
): ImageProviderResolution => {
  if (!settings.imageGeneration) {
    return { ok: false, reason: "Image generation is turned off in Harp's settings." };
  }
  const preset = presets[settings.imageProvider];
  const baseUrl = trimSlash(settings.imageBaseUrl === "" ? preset.baseUrl : settings.imageBaseUrl);
  const model = settings.imageModel === "" ? preset.model : settings.imageModel;
  if (baseUrl === "") return { ok: false, reason: "Image generation has no base URL." };
  if (!/^https?:\/\//iu.test(baseUrl)) {
    return {
      ok: false,
      reason: "The image generation base URL must start with http:// or https://.",
    };
  }
  if (model === "") return { ok: false, reason: "Image generation has no model." };
  if (settings.imageProvider !== "custom" && settings.imageApiKey === "") {
    return { ok: false, reason: "Image generation has no API key." };
  }
  return {
    ok: true,
    config: { provider: settings.imageProvider, baseUrl, model, apiKey: settings.imageApiKey },
  };
};

export const imageGenerationReady = (
  settings: Parameters<typeof resolveImageProvider>[0],
): boolean => resolveImageProvider(settings).ok;

const purposeHints: Record<ImagePurpose, string> = {
  particle:
    "Game particle texture: one centered soft shape with generous empty margin so nothing touches the image edge.",
  icon: "Game icon: one centered subject with a clean readable silhouette.",
  decal: "Game decal texture: the subject fills the frame.",
  tile: "Seamless tileable texture, flat and evenly lit, no vignette, border or focal point, left and right edges continue into each other, top and bottom too.",
  ui: "Game user interface element, clean shapes, centered.",
};

export const promptFor = (input: {
  readonly prompt: string;
  readonly purpose: ImagePurpose;
  readonly transparent: boolean;
}): string =>
  `${purposeHints[input.purpose]} ${
    input.transparent ? "Transparent background." : ""
  } ${input.prompt}`
    .replace(/\s+/gu, " ")
    .trim();

export interface ImageRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

export const buildImageRequest = (
  config: ImageProviderConfig,
  input: { readonly prompt: string; readonly size: string; readonly transparent: boolean },
): ImageRequest => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey !== "") headers.authorization = `Bearer ${config.apiKey}`;
  if (config.provider === "openrouter") {
    return {
      url: `${config.baseUrl}/chat/completions`,
      headers,
      body: {
        model: config.model,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: `${input.prompt} (${input.size}, square if unsure)` }],
      },
    };
  }
  const gptImage = config.model.startsWith("gpt-image");
  return {
    url: `${config.baseUrl}/images/generations`,
    headers,
    body: {
      model: config.model,
      prompt: input.prompt,
      n: 1,
      size: input.size,
      ...(gptImage ? { output_format: "png" } : { response_format: "b64_json" }),
      ...(gptImage && input.transparent ? { background: "transparent" } : {}),
    },
  };
};

export interface ImagePayload {
  readonly b64?: string | undefined;
  readonly url?: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fromDataUrl = (value: string): ImagePayload | undefined => {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/isu.exec(value);
  return match === null ? undefined : { b64: match[1]! };
};

/** Reads images out of an images-endpoint answer or a chat answer that carries generated images. */
export const parseImageResponse = (json: unknown): ReadonlyArray<ImagePayload> => {
  if (!isRecord(json)) return [];
  const out: ImagePayload[] = [];
  if (Array.isArray(json.data)) {
    for (const entry of json.data) {
      if (!isRecord(entry)) continue;
      if (typeof entry.b64_json === "string") out.push({ b64: entry.b64_json });
      else if (typeof entry.url === "string") out.push({ url: entry.url });
    }
  }
  if (Array.isArray(json.choices)) {
    for (const choice of json.choices) {
      const message = isRecord(choice) ? choice.message : undefined;
      const images = isRecord(message) && Array.isArray(message.images) ? message.images : [];
      for (const image of images) {
        const url = isRecord(image) && isRecord(image.image_url) ? image.image_url.url : undefined;
        if (typeof url !== "string") continue;
        out.push(fromDataUrl(url) ?? { url });
      }
    }
  }
  return out;
};

export const isPngBytes = (bytes: Uint8Array): boolean =>
  bytes.length > 8 &&
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);

const errorText = (status: number, body: string) => {
  let detail = body;
  try {
    const parsed: unknown = JSON.parse(body);
    const error = isRecord(parsed) ? parsed.error : undefined;
    if (typeof error === "string") detail = error;
    else if (isRecord(error) && typeof error.message === "string") detail = error.message;
  } catch {
    // Not JSON; the raw text is the detail.
  }
  return `The image service answered ${String(status)}: ${detail.slice(0, maxErrorChars)}`;
};

const readCapped = async (response: Response): Promise<Buffer> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxImageBytes) {
    throw new Error("The generated image is larger than 24 MB.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxImageBytes) throw new Error("The generated image is larger than 24 MB.");
  return bytes;
};

/** One image from the provider, as PNG bytes. Errors never include the API key. */
export const requestImage = (
  config: ImageProviderConfig,
  input: { readonly prompt: string; readonly size: string; readonly transparent: boolean },
): Effect.Effect<Buffer, Error> =>
  Effect.tryPromise({
    try: async () => {
      const request = buildImageRequest(config, input);
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(errorText(response.status, text));
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("The image service did not answer with JSON.");
      }
      const payload = parseImageResponse(parsed)[0];
      if (payload === undefined) throw new Error("The image service returned no image.");
      let bytes: Buffer;
      if (payload.b64 !== undefined) {
        bytes = Buffer.from(payload.b64, "base64");
      } else {
        const url = payload.url!;
        if (!/^https?:\/\//iu.test(url)) throw new Error("The image service returned a bad URL.");
        const download = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
        if (!download.ok)
          throw new Error(`Downloading the image failed (${String(download.status)}).`);
        bytes = await readCapped(download);
      }
      if (bytes.length > maxImageBytes)
        throw new Error("The generated image is larger than 24 MB.");
      if (!isPngBytes(bytes)) {
        throw new Error(
          "The image service returned something other than a PNG (JPEG or WebP). Pick a model or setting that outputs PNG.",
        );
      }
      return bytes;
    },
    catch: (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      return new Error(config.apiKey === "" ? message : message.replaceAll(config.apiKey, "[key]"));
    },
  });

export interface ImageJobProvenance {
  readonly prompt: string;
  readonly purpose: ImagePurpose;
  readonly model: string;
  readonly provider: string;
  readonly host: string;
  readonly size: string;
  readonly transparentRequested: boolean;
}

export const IMAGE_PROVENANCE_FILE = "provenance.json";
export const imageFileName = (index: number) => `image-${String(index + 1)}.png`;

/** Saves the PNGs and a provenance sidecar in a new job folder, then prunes old ones. */
export const writeImageJob = (
  jobsRoot: string,
  images: ReadonlyArray<Buffer>,
  provenance: ImageJobProvenance,
  now: number,
): { readonly jobDir: string; readonly files: ReadonlyArray<string> } => {
  const jobDir = NodePath.join(
    jobsRoot,
    `${JOB_FOLDER_PREFIX}${String(now)}-${NodeCrypto.randomBytes(4).toString("hex")}`,
  );
  NodeFS.mkdirSync(jobDir, { recursive: true });
  const files = images.map((bytes, index) => {
    const file = NodePath.join(jobDir, imageFileName(index));
    NodeFS.writeFileSync(file, bytes);
    return file;
  });
  NodeFS.writeFileSync(
    NodePath.join(jobDir, IMAGE_PROVENANCE_FILE),
    JSON.stringify(
      {
        ...provenance,
        createdAt: new Date(now).toISOString(),
        images: images.map((_, index) => imageFileName(index)),
      },
      null,
      2,
    ),
  );
  pruneJobFolders(jobsRoot, now, { protect: [jobDir] });
  return { jobDir, files };
};

export const sizePattern = /^\d{2,4}x\d{2,4}$/u;
export const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "";
  }
};
