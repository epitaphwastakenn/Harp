import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildResultsPreview } from "./resultsPreview";
import type { ResultSubject } from "./turnResults.logic";

const resource = (itemId: string) => ({ itemId }) as never;

const model = (label: string, versions: number): ResultSubject =>
  ({
    key: label,
    label,
    images: Array.from({ length: versions }, (_, index) => resource(`${label}${String(index)}`)),
    tile: { resource: resource(label), versions: [{}, {}, {}].slice(0, versions) },
  }) as never;

const capture = (label: string, count: number): ResultSubject =>
  ({
    key: label,
    label,
    images: Array.from({ length: count }, (_, index) => resource(`${label}${String(index)}`)),
    tile: { resource: resource(label) },
  }) as never;

describe("buildResultsPreview", () => {
  const environmentId = "env" as EnvironmentId;

  it("opens a multi-version model on its own item", () => {
    const subjects = [model("a", 3), capture("b", 2)];
    const preview = buildResultsPreview(environmentId, subjects, 0);
    expect(preview.images).toHaveLength(3);
    expect(preview.index).toBe(0);
    expect(buildResultsPreview(environmentId, subjects, 1).index).toBe(2);
  });
});
