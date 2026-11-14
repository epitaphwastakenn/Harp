import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TurnImageResource } from "../turnImagesPreview";
import {
  buildTurnImageTiles,
  dimensionsInStuds,
  formatStudSize,
  formatStuds,
  groupModelVersions,
  metresPerStud,
  metresToStuds,
  modelPreviewFailureReason,
  versionLabel,
} from "./modelPreviewVersions";
import { framingDistance, planGrid } from "./modelFraming";

const maxCells = 24;

const preview = (
  previewId: string,
  jobId?: string,
  continuedFrom?: string,
): ModelPreviewReference => ({
  previewId: previewId.padEnd(16, "x"),
  triangles: 10,
  dimensions: [1, 2, 3],
  animationClips: 0,
  sizeBytes: 100,
  ...(jobId === undefined ? {} : { jobId }),
  ...(continuedFrom === undefined ? {} : { continuedFrom }),
});

const image = (itemId: string, index = 0) =>
  ({
    _tag: "tool-output-image",
    threadId: "thread" as ThreadId,
    itemId: itemId as TurnItemId,
    index,
  }) satisfies TurnImageResource;

describe("stud conversion", () => {
  it("uses 0.28 m per stud", () => {
    expect(metresToStuds(0.28)).toBeCloseTo(1);
    expect(dimensionsInStuds([0.56, 1.4, 2.8])).toEqual([2, 5, 10].map((v) => expect.closeTo(v)));
  });

  it("formats readable sizes", () => {
    expect(formatStuds(5.04)).toBe("5");
    expect(formatStuds(5.46)).toBe("5.5");
    expect(formatStuds(123.4)).toBe("123");
    expect(formatStuds(Number.NaN)).toBe("0");
    expect(formatStudSize([0.28, 0.56, 2.8])).toBe("1 x 2 x 10");
  });
});

describe("groupModelVersions", () => {
  it("chains jobs through continuedFrom and keeps unrelated models apart", () => {
    const groups = groupModelVersions([
      { itemId: "a", preview: preview("a", "job-1") },
      { itemId: "b", preview: preview("b", "job-2") },
      { itemId: "c", preview: preview("c", "job-3", "job-1") },
      { itemId: "d", preview: preview("d", "job-4", "job-3") },
    ]);
    expect(groups.map((group) => group.map((entry) => entry.itemId))).toEqual([
      ["a", "c", "d"],
      ["b"],
    ]);
  });

  it("groups jobs that continue a job without a preview", () => {
    const groups = groupModelVersions([
      { itemId: "a", preview: preview("a", "job-2", "job-1") },
      { itemId: "b", preview: preview("b", "job-3", "job-1") },
    ]);
    expect(groups).toHaveLength(1);
  });

  it("treats previews without lineage as separate models and survives cycles", () => {
    expect(
      groupModelVersions([
        { itemId: "a", preview: preview("a") },
        { itemId: "b", preview: preview("b") },
      ]),
    ).toHaveLength(2);
    expect(
      groupModelVersions([
        { itemId: "a", preview: preview("a", "job-1", "job-2") },
        { itemId: "b", preview: preview("b", "job-2", "job-1") },
      ]).flat(),
    ).toHaveLength(2);
  });
});

describe("buildTurnImageTiles", () => {
  it("folds earlier versions into the latest tile", () => {
    const tiles = buildTurnImageTiles(
      [image("a"), image("shot"), image("b"), image("c")],
      [
        { itemId: "a", preview: preview("a", "job-1") },
        { itemId: "b", preview: preview("b", "job-2", "job-1") },
        { itemId: "c", preview: preview("c", "job-9") },
      ],
    );
    expect(tiles.map((tile) => tile.resource.itemId)).toEqual(["shot", "b", "c"]);
    expect(tiles[0]?.versions).toBeUndefined();
    expect(tiles[1]?.versions?.map((version) => version.resource.itemId)).toEqual(["a", "b"]);
    expect(tiles[2]?.versions).toHaveLength(1);
  });

  it("leaves extra images of a model item alone", () => {
    const tiles = buildTurnImageTiles(
      [image("a"), image("a", 1)],
      [{ itemId: "a", preview: preview("a", "job-1") }],
    );
    expect(tiles).toHaveLength(2);
    expect(tiles[1]?.versions).toBeUndefined();
  });

  it("ignores a model whose image is missing", () => {
    const tiles = buildTurnImageTiles(
      [image("b")],
      [
        { itemId: "a", preview: preview("a", "job-1") },
        { itemId: "b", preview: preview("b", "job-2", "job-1") },
      ],
    );
    expect(tiles[0]?.versions).toHaveLength(1);
  });
});

it("labels versions", () => {
  expect(versionLabel(1, 4)).toBe("Version 2 of 4");
});

describe("planGrid", () => {
  it("keeps the line count small at any size and cells in whole studs", () => {
    for (const footprint of [0.01, 0.5, 2, 30, 4000]) {
      const plan = planGrid(footprint);
      expect(plan.divisions).toBeLessThanOrEqual(maxCells + 1);
      expect(plan.divisions).toBeGreaterThanOrEqual(2);
      expect(plan.sizeMetres).toBeCloseTo(plan.divisions * plan.studsPerCell * metresPerStud);
      expect(plan.sizeMetres).toBeGreaterThanOrEqual(footprint * 2);
    }
  });
});

describe("framingDistance", () => {
  it("backs off further for narrow viewports", () => {
    expect(framingDistance(1, 40, 0.5)).toBeGreaterThan(framingDistance(1, 40, 2));
    expect(framingDistance(2, 40, 1.5)).toBeCloseTo(framingDistance(1, 40, 1.5) * 2);
  });
});

describe("modelPreviewFailureReason", () => {
  it("explains expired and unauthorised previews", () => {
    expect(modelPreviewFailureReason(404)).toMatch(/gone/);
    expect(modelPreviewFailureReason(401)).toMatch(/cannot read/);
    expect(modelPreviewFailureReason(500)).toMatch(/500/);
  });
});
