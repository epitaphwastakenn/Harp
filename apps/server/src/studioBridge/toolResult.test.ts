import { describe, expect, it } from "@effect/vitest";

import { StudioLimits } from "./protocol.ts";
import { jsonResult } from "./toolResult.ts";

const textOf = (result: ReturnType<typeof jsonResult>) => {
  const block = result.content[0];
  return block?.type === "text" ? block.text : "";
};

const row = (index: number) => ({ index, message: `line ${String(index)} ${"x".repeat(200)}` });

describe("jsonResult", () => {
  it("leaves a small result whole", () => {
    const result = jsonResult({ success: true, items: [1, 2, 3] });
    expect(result.structuredContent).toEqual({ success: true, items: [1, 2, 3] });
    expect(JSON.parse(textOf(result))).toEqual({ success: true, items: [1, 2, 3] });
  });

  it("keeps the newest items of a log-like array and reports the cut", () => {
    const entries = Array.from({ length: 400 }, (_, index) => row(index));
    const result = jsonResult({ entries, next: { server: 400 }, nextCursor: "c1" });
    const parsed = JSON.parse(textOf(result));
    expect(textOf(result).length).toBeLessThanOrEqual(StudioLimits.maxResultChars);
    expect(result.structuredContent).toEqual(parsed);
    expect(parsed.entries.at(-1).index).toBe(399);
    expect(parsed.entries.length).toBe(parsed.truncated.kept);
    expect(parsed.truncated).toMatchObject({ field: "entries" });
    expect(parsed.truncated.kept + parsed.truncated.dropped).toBe(400);
    expect(parsed.entries.at(0).index).toBe(400 - parsed.truncated.kept);
    expect(parsed.next).toEqual({ server: 400 });
    expect(parsed.nextCursor).toBe("c1");
  });

  it("keeps the first items of other arrays and cuts the largest one", () => {
    const small = [1, 2, 3];
    const results = Array.from({ length: 300 }, (_, index) => row(index));
    const parsed = JSON.parse(textOf(jsonResult({ small, results })));
    expect(parsed.small).toEqual(small);
    expect(parsed.results[0].index).toBe(0);
    expect(parsed.truncated.field).toBe("results");
    expect(parsed.results.length).toBe(parsed.truncated.kept);
  });

  it("cuts arrays nested in an object and names the path", () => {
    const parsed = JSON.parse(
      textOf(jsonResult({ data: { logs: Array.from({ length: 300 }, (_, index) => row(index)) } })),
    );
    expect(parsed.truncated.field).toBe("data.logs");
    expect(parsed.data.logs.at(-1).index).toBe(299);
  });

  it("falls back to cutting the text when no array can shrink enough", () => {
    const result = jsonResult({ blob: "y".repeat(StudioLimits.maxResultChars * 2) });
    expect(textOf(result)).toContain("[Result cut at");
    expect(result.structuredContent).toBeUndefined();
  });

  it("keeps the error flag and the suffix when truncating", () => {
    const entries = Array.from({ length: 400 }, (_, index) => row(index));
    const result = jsonResult({ entries, error: "boom" }, { suffix: "see logs" });
    expect(result.isError).toBe(true);
    expect(textOf(result).endsWith("see logs")).toBe(true);
    expect(textOf(result).length).toBeLessThanOrEqual(StudioLimits.maxResultChars);
    expect(result.structuredContent).toBeUndefined();
  });
});
