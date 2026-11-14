// @effect-diagnostics nodeBuiltinImport:off globalDate:off -Temp folders and file mtimes are plain files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";

import {
  buildImageRequest,
  imageFileName,
  parseImageResponse,
  promptFor,
  resolveImageProvider,
  writeImageJob,
} from "./imageGeneration.ts";
import { encodePng } from "./png.ts";
import { readStageSource, stageIntoContent, stagedName } from "./textureStaging.ts";

const settings = {
  imageGeneration: true,
  imageProvider: "openai" as const,
  imageBaseUrl: "",
  imageModel: "",
  imageApiKey: "sk-test",
};

const png = encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);

const tempDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "harp-image-"));

describe("resolveImageProvider", () => {
  it("is unavailable while off or unconfigured", () => {
    expect(resolveImageProvider({ ...settings, imageGeneration: false }).ok).toBe(false);
    expect(resolveImageProvider({ ...settings, imageApiKey: "" }).ok).toBe(false);
    expect(resolveImageProvider({ ...settings, imageProvider: "custom" }).ok).toBe(false);
    expect(
      resolveImageProvider({
        ...settings,
        imageProvider: "custom",
        imageBaseUrl: "ftp://x",
        imageModel: "m",
      }).ok,
    ).toBe(false);
  });

  it("fills a preset's address and model, and lets a custom server go keyless", () => {
    const openai = resolveImageProvider(settings);
    expect(openai.ok && openai.config.baseUrl).toBe("https://api.openai.com/v1");
    expect(openai.ok && openai.config.model).toBe("gpt-image-1");
    const local = resolveImageProvider({
      imageGeneration: true,
      imageProvider: "custom",
      imageBaseUrl: "http://localhost:8080/v1/",
      imageModel: "sd",
      imageApiKey: "",
    });
    expect(local.ok && local.config.baseUrl).toBe("http://localhost:8080/v1");
  });
});

describe("buildImageRequest", () => {
  const input = { prompt: "a spark", size: "512x512", transparent: true };

  it("asks gpt-image models for transparent PNG output", () => {
    const resolved = resolveImageProvider(settings);
    if (!resolved.ok) throw new Error("unreachable");
    const request = buildImageRequest(resolved.config, input);
    expect(request.url).toBe("https://api.openai.com/v1/images/generations");
    expect(request.headers.authorization).toBe("Bearer sk-test");
    expect(request.body).toMatchObject({ output_format: "png", background: "transparent", n: 1 });
    expect(request.body).not.toHaveProperty("response_format");
  });

  it("asks other models for base64 and sends no key to a keyless server", () => {
    const request = buildImageRequest(
      { provider: "custom", baseUrl: "http://localhost:1/v1", model: "sd", apiKey: "" },
      input,
    );
    expect(request.body).toMatchObject({ response_format: "b64_json" });
    expect(request.headers).not.toHaveProperty("authorization");
  });

  it("uses chat completions with image output for OpenRouter", () => {
    const request = buildImageRequest(
      { provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "m", apiKey: "k" },
      input,
    );
    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request.body).toMatchObject({ modalities: ["image", "text"] });
  });

  it("adds what the purpose needs to the prompt", () => {
    expect(promptFor({ prompt: "moss", purpose: "tile", transparent: false })).toContain(
      "Seamless",
    );
    expect(promptFor({ prompt: "spark", purpose: "particle", transparent: true })).toContain(
      "Transparent background.",
    );
  });
});

describe("parseImageResponse", () => {
  it("reads images endpoint and chat answers", () => {
    expect(
      parseImageResponse({ data: [{ b64_json: "AAAA" }, { url: "https://x/y.png" }] }),
    ).toEqual([{ b64: "AAAA" }, { url: "https://x/y.png" }]);
    expect(
      parseImageResponse({
        choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,QkJC" } }] } }],
      }),
    ).toEqual([{ b64: "QkJC" }]);
    expect(parseImageResponse({ error: "no" })).toEqual([]);
  });
});

describe("image jobs", () => {
  it("saves the PNGs with a sidecar that never holds the key, and prunes old jobs", () => {
    const root = tempDir();
    const old = NodePath.join(root, "job-old");
    NodeFS.mkdirSync(old);
    const longAgo = new Date(1_000_000_000_000);
    NodeFS.utimesSync(old, longAgo, longAgo);
    for (let index = 0; index < 41; index += 1) {
      NodeFS.mkdirSync(NodePath.join(root, `job-keep-${String(index)}`));
    }
    const job = writeImageJob(
      root,
      [png, png],
      {
        prompt: "p",
        purpose: "icon",
        model: "m",
        provider: "openai",
        host: "api.openai.com",
        size: "1024x1024",
        transparentRequested: false,
      },
      1_900_000_000_000,
    );
    expect(job.files.map((file) => NodePath.basename(file))).toEqual([
      imageFileName(0),
      imageFileName(1),
    ]);
    const sidecar = NodeFS.readFileSync(NodePath.join(job.jobDir, "provenance.json"), "utf8");
    expect(JSON.parse(sidecar)).toMatchObject({ prompt: "p", model: "m", provider: "openai" });
    expect(sidecar).not.toContain("sk-");
    expect(NodeFS.existsSync(old)).toBe(false);
    NodeFS.rmSync(root, { recursive: true, force: true });
  });
});

describe("texture staging", () => {
  it("only reads PNGs from the allowed roots", () => {
    const jobs = tempDir();
    const outside = tempDir();
    const inside = NodePath.join(jobs, "a.png");
    NodeFS.writeFileSync(inside, png);
    NodeFS.writeFileSync(NodePath.join(outside, "b.png"), png);
    NodeFS.writeFileSync(NodePath.join(jobs, "c.png"), "not a png");
    expect(readStageSource(inside, [undefined, jobs]).ok).toBe(true);
    expect(readStageSource(NodePath.join(outside, "b.png"), [jobs]).ok).toBe(false);
    const sneaky = NodePath.join(jobs, "..", NodePath.basename(outside), "b.png");
    expect(readStageSource(sneaky, [jobs]).ok).toBe(false);
    const notPng = readStageSource(NodePath.join(jobs, "c.png"), [jobs]);
    expect(!notPng.ok && notPng.reason).toContain("PNG");
    NodeFS.rmSync(jobs, { recursive: true, force: true });
    NodeFS.rmSync(outside, { recursive: true, force: true });
  });

  it("copies into content/harp under a hash name and returns the rbxasset path", () => {
    const content = tempDir();
    const staged = stageIntoContent(content, png);
    expect(staged.ok && staged.url).toBe(`rbxasset://harp/${stagedName(png)}`);
    expect(NodeFS.readFileSync(NodePath.join(content, "harp", stagedName(png)))).toEqual(png);
    const again = stageIntoContent(content, png);
    expect(again.ok && again.url).toBe(staged.ok ? staged.url : "");
    NodeFS.rmSync(content, { recursive: true, force: true });
  });
});
