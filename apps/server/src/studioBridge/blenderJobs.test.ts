// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";

import {
  agentScriptSizeError,
  blenderEnvironment,
  buildJobScript,
  fitJobSummary,
  MAX_AGENT_SCRIPT_BYTES,
  resolveContinueBlend,
  runBlenderJob,
} from "./blenderJobs.ts";

describe("blenderEnvironment", () => {
  it("drops credential-looking variables and keeps what Blender needs", () => {
    const clean = blenderEnvironment({
      PATH: "/bin",
      SystemRoot: "C:\\Windows",
      APPDATA: "C:\\Users\\a\\AppData",
      BLENDER_USER_CONFIG: "/cfg",
      BLENDER_API_KEY_FILE: "/kept",
      SESSIONNAME: "Console",
      OPENAI_API_KEY: "sk-1",
      GITHUB_TOKEN: "t",
      client_secret: "s",
      DB_PASSWORD: "p",
      T3CODE_AUTH_TOKEN: "a",
      Cookie_Jar: "c",
      AWS_CREDENTIALS: "c",
      LOGIN_SESSION_ID: "x",
      ROBLOSECURITY: "r",
    });
    expect(Object.keys(clean).toSorted()).toEqual([
      "APPDATA",
      "BLENDER_API_KEY_FILE",
      "BLENDER_USER_CONFIG",
      "PATH",
      "SESSIONNAME",
      "SystemRoot",
    ]);
  });
});

describe("agentScriptSizeError", () => {
  it("accepts a script at the limit and names the limit above it", () => {
    expect(agentScriptSizeError("x".repeat(MAX_AGENT_SCRIPT_BYTES))).toBeUndefined();
    expect(agentScriptSizeError("x".repeat(MAX_AGENT_SCRIPT_BYTES + 1))).toContain("256 KB");
  });

  it.effect("runBlenderJob refuses an oversized script before touching the disk", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runBlenderJob({
          executable: "blender",
          jobsRoot: "/nonexistent/jobs",
          script: "x".repeat(MAX_AGENT_SCRIPT_BYTES + 1),
          preview: false,
          exportObj: false,
          saveBlend: false,
          timeoutMs: 1000,
        }),
      );
      expect(error.message).toContain("256 KB");
    }),
  );
});

describe("fitJobSummary", () => {
  const base = { success: true, output: "o".repeat(12_000), result: { lint: { objects: ["a"] } } };

  it("keeps the summary under the client compaction budget", () => {
    const fitted = fitJobSummary(base);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(13_000);
    expect(fitted.output.length).toBeGreaterThan(0);
  });

  it("drops the object list when the report alone is too large", () => {
    const big = {
      ...base,
      result: { lint: { objects: ["n".repeat(14_000)], model: { parts: 2 } } },
    };
    expect(fitJobSummary(big).result).toEqual({
      lint: { model: { parts: 2 }, objectsOmitted: true },
    });
  });
});

describe("fitJobSummary with many parts", () => {
  it("caps the mesh list so the UTF-8 size stays under budget", () => {
    const meshes = Array.from({ length: 150 }, (_, i) => ({
      name: `pé${String(i)}`.padEnd(300, "é"),
    }));
    const fitted = fitJobSummary({
      success: true,
      modelPreview: { jobId: "a" },
      output: "ü".repeat(12_000),
      result: { meshes, lint: { hiddenObjects: meshes.map((m) => m.name) } },
    });
    expect(Buffer.byteLength(JSON.stringify(fitted), "utf8")).toBeLessThanOrEqual(12_000);
    expect(fitted.modelPreview).toEqual({ jobId: "a" });
    expect(fitted.success).toBe(true);
  });
});

describe("resolveContinueBlend", () => {
  it("refuses missing folders, folders outside the root and folders without a scene", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "harp-jobs-"));
    const inside = NodePath.join(root, "job-1");
    NodeFS.mkdirSync(inside);
    expect("error" in resolveContinueBlend(root, inside)).toBe(true);
    NodeFS.writeFileSync(NodePath.join(inside, "scene.blend"), "x");
    expect(resolveContinueBlend(root, inside)).toEqual({
      path: NodePath.join(NodeFS.realpathSync(inside), "scene.blend"),
    });
    expect("error" in resolveContinueBlend(root, NodePath.join(root, "nope"))).toBe(true);
    expect("error" in resolveContinueBlend(root, NodeOS.tmpdir())).toBe(true);
    NodeFS.rmSync(root, { recursive: true, force: true });
  });
});

describe("buildJobScript", () => {
  it("runs the helpers first and the export checks after the agent script", () => {
    const script = buildJobScript("/jobs/a/agent.py");
    expect(script.indexOf("def harp_part")).toBeLessThan(script.indexOf("/jobs/a/agent.py"));
    expect(script.indexOf("/jobs/a/agent.py")).toBeLessThan(script.indexOf("def _harp_lint"));
    expect(script).toContain("glbError");
  });
});
