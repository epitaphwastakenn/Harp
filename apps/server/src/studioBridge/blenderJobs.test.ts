import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  agentScriptSizeError,
  blenderEnvironment,
  buildJobScript,
  fitJobSummary,
  MAX_AGENT_SCRIPT_BYTES,
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

describe("buildJobScript", () => {
  it("runs the helpers first and the export checks after the agent script", () => {
    const script = buildJobScript("/jobs/a/agent.py");
    expect(script.indexOf("def harp_part")).toBeLessThan(script.indexOf("/jobs/a/agent.py"));
    expect(script.indexOf("/jobs/a/agent.py")).toBeLessThan(script.indexOf("def _harp_lint"));
    expect(script).toContain("glbError");
  });
});
