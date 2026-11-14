import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";
import type { RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildTurnResults,
  classifyResultOrigin,
  filterSubjects,
  resolveResultsRun,
  resultRunIds,
  resultToolName,
  stepRun,
  subjectVersionLabel,
  type ResultSource,
} from "./turnResults.logic";

const run = (id: string) => id as RunId;

const source = (
  itemId: string,
  toolName: string | null,
  input: unknown = {},
  options: { runId?: RunId; images?: number; model?: ModelPreviewReference } = {},
): ResultSource => ({
  itemId,
  runId: options.runId ?? run("run-1"),
  toolName,
  input,
  images: Array.from({ length: options.images ?? 1 }, (_, index) => ({
    _tag: "tool-output-image" as const,
    threadId: "thread" as ThreadId,
    itemId: itemId as TurnItemId,
    index,
  })),
  model: options.model,
});

const preview = (jobId: string, continuedFrom?: string): ModelPreviewReference => ({
  previewId: jobId.padEnd(16, "x"),
  triangles: 10,
  dimensions: [1, 1, 1],
  animationClips: 0,
  sizeBytes: 10,
  jobId,
  ...(continuedFrom === undefined ? {} : { continuedFrom }),
});

describe("resultToolName", () => {
  it("strips mcp prefixes, including the gateway's doubled one", () => {
    expect(resultToolName("mcp__studio__capture_screenshot")).toBe("capture_screenshot");
    expect(resultToolName("mcp__sealcode-global__mcp__studio__animation")).toBe("animation");
    expect(resultToolName("studio.blender")).toBe("blender");
    expect(resultToolName(null)).toBeNull();
  });
});

describe("classifyResultOrigin", () => {
  it("tags each origin", () => {
    expect(classifyResultOrigin("capture_screenshot", false)).toBe("studio");
    expect(classifyResultOrigin("blender", false)).toBe("blender");
    expect(classifyResultOrigin("anything", true)).toBe("blender");
    expect(classifyResultOrigin("animation", false)).toBe("animation");
    expect(classifyResultOrigin("generate_image", false)).toBe("other");
    expect(classifyResultOrigin("view_image", false)).toBe("other");
    expect(classifyResultOrigin(null, false)).toBe("other");
  });
});

describe("buildTurnResults", () => {
  it("groups repeated captures of one view and lists newest subjects first", () => {
    const results = buildTurnResults(
      [
        source("a", "mcp__studio__capture_screenshot", { target: "edit" }),
        source("b", "mcp__studio__capture_screenshot", { target: "client-2" }),
        source("c", "mcp__studio__capture_screenshot", { target: "edit" }),
      ],
      run("run-1"),
    );
    expect(results.subjects.map((subject) => subject.label)).toEqual(["Studio view", "Client 2"]);
    expect(results.subjects[0]?.images.map((image) => image.itemId)).toEqual(["a", "c"]);
    expect(results.subjects[0]?.tile.resource.itemId).toBe("c");
    expect(subjectVersionLabel(results.subjects[0]!)).toBe("2 captures");
    expect(subjectVersionLabel(results.subjects[1]!)).toBeNull();
    expect(results.counts).toEqual({ studio: 2, blender: 0, animation: 0, other: 0 });
    expect(results.imageCount).toBe(3);
  });

  it("folds Blender versions of one model into a subject with the latest tile", () => {
    const results = buildTurnResults(
      [
        source("m1", "blender", {}, { model: preview("job-1") }),
        source("m2", "blender", {}, { model: preview("job-2", "job-1") }),
        source("m3", "blender", {}, { model: preview("job-3") }),
      ],
      run("run-1"),
    );
    expect(results.counts.blender).toBe(2);
    const [newest, older] = results.subjects;
    expect(newest?.tile.resource.itemId).toBe("m3");
    expect(older?.tile.resource.itemId).toBe("m2");
    expect(older?.versionCount).toBe(2);
    expect(subjectVersionLabel(older!)).toBe("2 versions");
  });

  it("groups contact sheets by animation and keeps unrelated images apart", () => {
    const results = buildTurnResults(
      [
        source("s1", "mcp__studio__animation", { action: "contactSheet", sequence: "Walk" }),
        source("s2", "mcp__studio__animation", { action: "contactSheet", sequence: "Walk" }),
        source("s3", "mcp__studio__animation", { action: "contactSheet", sequence: "Run" }),
        source("o1", "view_image"),
        source("o2", "view_image"),
      ],
      run("run-1"),
    );
    expect(results.counts).toEqual({ studio: 0, blender: 0, animation: 2, other: 2 });
    expect(filterSubjects(results.subjects, "animation")).toHaveLength(2);
    expect(filterSubjects(results.subjects, null)).toHaveLength(4);
  });

  it("keeps device matrix images separate and only counts the asked run", () => {
    const results = buildTurnResults(
      [
        source("d", "mcp__studio__capture_device_matrix", {}, { images: 3 }),
        source("x", "mcp__studio__capture_screenshot", {}, { runId: run("run-2") }),
      ],
      run("run-1"),
    );
    expect(results.subjects).toHaveLength(3);
    expect(results.counts.studio).toBe(3);
  });
});

describe("run selection", () => {
  const sources = [
    source("a", "blender", {}, { runId: run("r1") }),
    source("b", "blender", {}, { runId: run("r2") }),
    source("c", "blender", {}, { runId: run("r1") }),
  ];

  it("lists runs with images in order", () => {
    expect(resultRunIds(sources)).toEqual(["r1", "r2"]);
  });

  it("defaults to the latest run and steps between them", () => {
    const runs = resultRunIds(sources);
    expect(resolveResultsRun(null, runs)).toBe("r2");
    expect(resolveResultsRun(run("r1"), runs)).toBe("r1");
    expect(stepRun(runs, run("r2"), -1)).toBe("r1");
    expect(stepRun(runs, run("r2"), 1)).toBeNull();
    expect(stepRun(runs, run("r9"), 1)).toBe("r1");
    expect(resolveResultsRun(null, [])).toBeNull();
  });
});
