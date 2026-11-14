import { describe, expect, it } from "vite-plus/test";

import { undoCountLines, undoTotal } from "./StudioUndoButton.logic";

const counts = { scripts: 2, files: 0, properties: 1, created: 0, deleted: 3, builds: 1 };

describe("undoCountLines", () => {
  it("lists only the kinds the turn changed, singular or plural", () => {
    expect(undoCountLines(counts)).toEqual([
      "2 script writes",
      "1 property change",
      "3 removed instances",
      "1 build",
    ]);
  });

  it("adds the counts up", () => {
    expect(undoTotal(counts)).toBe(7);
  });
});
