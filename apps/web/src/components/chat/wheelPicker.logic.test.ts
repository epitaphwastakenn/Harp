import { describe, expect, it } from "vite-plus/test";

import {
  accumulateWheel,
  advanceTypeahead,
  clampIndex,
  currentTypeaheadBuffer,
  edgeEnabledIndex,
  findTypeaheadIndex,
  initialTypeahead,
  initialWheelAccumulator,
  isTypeaheadKey,
  nearestEnabledIndex,
  stepEnabledIndex,
  wheelPose,
  wheelPoseTransform,
  wheelWindow,
  type WheelAccumulator,
} from "./wheelPicker.logic";

const labelled = (...labels: ReadonlyArray<string>) => labels.map((label) => ({ label }));
const flags = (...disabled: ReadonlyArray<boolean>) =>
  disabled.map((value) => ({ disabled: value }));
const key = (character: string) => ({
  key: character,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
});

function feed(
  events: ReadonlyArray<{ deltaY: number; timeStamp: number; deltaMode?: number }>,
  start: WheelAccumulator = initialWheelAccumulator,
) {
  let state = start;
  const steps: Array<number> = [];
  for (const event of events) {
    const result = accumulateWheel(state, { deltaMode: 0, ...event });
    state = result.state;
    steps.push(result.step);
  }
  return steps;
}

describe("clampIndex", () => {
  it("keeps an index inside the list and rounds fractions", () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2.6, 5)).toBe(3);
  });

  it("is zero for an empty list", () => {
    expect(clampIndex(4, 0)).toBe(0);
  });
});

describe("enabled index search", () => {
  const items = flags(false, true, false, false, true, false);

  it("steps over disabled items and stops at the ends", () => {
    expect(stepEnabledIndex(items, 0, 1)).toBe(2);
    expect(stepEnabledIndex(items, 3, 1)).toBe(5);
    expect(stepEnabledIndex(items, 5, 1)).toBe(5);
    expect(stepEnabledIndex(items, 2, -1)).toBe(0);
    expect(stepEnabledIndex(items, 0, -1)).toBe(0);
  });

  it("starts from the first item when nothing is selected", () => {
    expect(stepEnabledIndex(items, -1, 1)).toBe(0);
  });

  it("lands on the nearest enabled item, preferring the travel direction", () => {
    expect(nearestEnabledIndex(items, 1, 1)).toBe(2);
    expect(nearestEnabledIndex(items, 1, -1)).toBe(0);
    expect(nearestEnabledIndex(items, 4, 1)).toBe(5);
    expect(nearestEnabledIndex(items, 4, -1)).toBe(3);
    expect(nearestEnabledIndex(flags(true, false, true), 1, 1)).toBe(1);
    expect(nearestEnabledIndex(flags(false, true, true, false), 1, -1)).toBe(0);
    expect(nearestEnabledIndex(flags(false, true, true, false), 2, 1)).toBe(3);
  });

  it("reports no landing spot when every item is disabled", () => {
    expect(nearestEnabledIndex(flags(true, true), 0)).toBe(-1);
    expect(edgeEnabledIndex(flags(true, true), "end")).toBe(-1);
  });

  it("finds the first and last enabled item", () => {
    expect(edgeEnabledIndex(flags(true, false, false, true), "start")).toBe(1);
    expect(edgeEnabledIndex(flags(true, false, false, true), "end")).toBe(2);
  });
});

describe("accumulateWheel", () => {
  it("moves one item per mouse notch in either direction", () => {
    expect(
      feed([
        { deltaY: 100, timeStamp: 0 },
        { deltaY: 100, timeStamp: 30 },
        { deltaY: -100, timeStamp: 60 },
      ]),
    ).toEqual([1, 1, -1]);
  });

  it("never moves more than one item for one event", () => {
    expect(feed([{ deltaY: 2400, timeStamp: 0 }])).toEqual([1]);
  });

  it("waits for small trackpad deltas to add up", () => {
    const steps = feed([
      { deltaY: 10, timeStamp: 0 },
      { deltaY: 14, timeStamp: 16 },
      { deltaY: 14, timeStamp: 32 },
      { deltaY: 14, timeStamp: 48 },
    ]);
    expect(steps).toEqual([0, 0, 0, 1]);
  });

  it("restarts the sum when the direction flips or the gesture goes idle", () => {
    expect(
      feed([
        { deltaY: 30, timeStamp: 0 },
        { deltaY: -30, timeStamp: 16 },
        { deltaY: -30, timeStamp: 32 },
      ]),
    ).toEqual([0, 0, -1]);
    expect(
      feed([
        { deltaY: 30, timeStamp: 0 },
        { deltaY: 30, timeStamp: 400 },
      ]),
    ).toEqual([0, 0]);
  });

  it("holds back a trackpad flick so it cannot spin the wheel", () => {
    const flick = Array.from({ length: 30 }, (_, index) => ({
      deltaY: 20,
      timeStamp: index * 16,
    }));
    const moved = feed(flick).filter((step) => step !== 0).length;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(4);
  });

  it("still gives every mouse notch its own item during the cooldown", () => {
    expect(
      feed([
        { deltaY: 100, timeStamp: 0 },
        { deltaY: 100, timeStamp: 10 },
        { deltaY: 100, timeStamp: 20 },
      ]),
    ).toEqual([1, 1, 1]);
  });

  it("reads line and page deltas as scrolled distance", () => {
    expect(feed([{ deltaY: 3, deltaMode: 1, timeStamp: 0 }])).toEqual([1]);
    expect(feed([{ deltaY: -1, deltaMode: 2, timeStamp: 0 }])).toEqual([-1]);
    expect(feed([{ deltaY: 1, deltaMode: 1, timeStamp: 0 }])).toEqual([0]);
  });

  it("ignores events with no vertical movement", () => {
    expect(feed([{ deltaY: 0, timeStamp: 0 }])).toEqual([0]);
  });
});

describe("wheelWindow", () => {
  it("renders only the rows around the band", () => {
    expect(wheelWindow(100, 50)).toEqual({ start: 47, end: 54 });
  });

  it("clips at both ends of the list", () => {
    expect(wheelWindow(100, 0)).toEqual({ start: 0, end: 4 });
    expect(wheelWindow(100, 99)).toEqual({ start: 96, end: 100 });
    expect(wheelWindow(2, 1)).toEqual({ start: 0, end: 2 });
  });

  it("has nothing to render for an empty list", () => {
    expect(wheelWindow(0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("follows a fractional drag position to the nearest row", () => {
    expect(wheelWindow(100, 10.4)).toEqual(wheelWindow(100, 10));
    expect(wheelWindow(100, 10.6)).toEqual(wheelWindow(100, 11));
  });
});

describe("wheelPose", () => {
  it("leaves the centred row flat, full size and opaque", () => {
    expect(wheelPose(0)).toEqual({
      y: 0,
      z: 0,
      rotate: 0,
      scale: 1,
      opacity: 1,
      interactive: true,
    });
  });

  it("tilts, shrinks and dims rows the further they sit from the band", () => {
    const [near, mid, far] = [wheelPose(1), wheelPose(2), wheelPose(3)];
    expect(near.scale).toBeGreaterThan(mid.scale);
    expect(mid.scale).toBeGreaterThan(far.scale);
    expect(near.opacity).toBeGreaterThan(mid.opacity);
    expect(mid.opacity).toBeGreaterThan(far.opacity);
    expect(Math.abs(near.rotate)).toBeLessThan(Math.abs(mid.rotate));
    expect(near.z).toBeGreaterThan(mid.z);
  });

  it("mirrors rows above and below the band", () => {
    const above = wheelPose(-2);
    const below = wheelPose(2);
    expect(above.y).toBe(-below.y);
    expect(above.rotate).toBe(-below.rotate);
    expect(above.opacity).toBe(below.opacity);
    expect(above.scale).toBe(below.scale);
  });

  it("hides rows past the visible rows and stops them taking clicks", () => {
    expect(wheelPose(2).interactive).toBe(true);
    expect(wheelPose(3).opacity).toBe(0);
    expect(wheelPose(3).interactive).toBe(false);
    expect(wheelPose(9)).toEqual(wheelPose(3));
  });

  it("builds a transform from the pose using only transform functions", () => {
    expect(wheelPoseTransform(wheelPose(1))).toMatch(
      /^translate3d\(.*\) rotateX\(-20deg\) scale\(0\.92\)$/,
    );
  });
});

describe("type-ahead", () => {
  const models = labelled("Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Claude Sonnet 4");

  it("accepts letters, and digits or spaces only inside a word", () => {
    expect(isTypeaheadKey(key("s"), "")).toBe(true);
    expect(isTypeaheadKey(key("5"), "")).toBe(false);
    expect(isTypeaheadKey(key("5"), "gpt-")).toBe(true);
    expect(isTypeaheadKey(key(" "), "")).toBe(false);
    expect(isTypeaheadKey(key(" "), "claude")).toBe(true);
    expect(isTypeaheadKey(key("ArrowDown"), "")).toBe(false);
    expect(isTypeaheadKey({ ...key("s"), ctrlKey: true }, "")).toBe(false);
  });

  it("builds a buffer that resets after a pause", () => {
    const first = advanceTypeahead(initialTypeahead, "S", 100);
    const second = advanceTypeahead(first, "o", 300);
    expect(second.buffer).toBe("so");
    expect(currentTypeaheadBuffer(second, 400)).toBe("so");
    expect(currentTypeaheadBuffer(second, 1200)).toBe("");
    expect(advanceTypeahead(second, "h", 1200).buffer).toBe("h");
  });

  it("jumps to the first label that starts with the typed text", () => {
    expect(findTypeaheadIndex(models, "o", 0)).toBe(2);
    expect(findTypeaheadIndex(models, "son", 0)).toBe(1);
  });

  it("falls back to a word start and then to any match", () => {
    expect(findTypeaheadIndex(models, "sonnet 4", 0)).toBe(3);
    expect(findTypeaheadIndex(models, "nnet 4", 0)).toBe(3);
    expect(findTypeaheadIndex(models, "zzq", 0)).toBe(-1);
  });

  it("cycles through labels sharing a first letter when one key repeats", () => {
    const same = labelled("Sonnet 4", "Sonnet 5", "Opus", "Sonnet 6");
    expect(findTypeaheadIndex(same, "s", 0)).toBe(1);
    expect(findTypeaheadIndex(same, "s", 1)).toBe(3);
    expect(findTypeaheadIndex(same, "s", 3)).toBe(0);
    expect(findTypeaheadIndex(same, "ss", 0)).toBe(1);
  });

  it("keeps the current item while the typed text still matches it", () => {
    const same = labelled("Sonnet 4", "Sonnet 5");
    expect(findTypeaheadIndex(same, "sonnet", 1)).toBe(1);
  });

  it("skips disabled items and ignores accents and case", () => {
    const items = [{ label: "Opus", disabled: true }, { label: "Ópera" }, { label: "Haiku" }];
    expect(findTypeaheadIndex(items, "op", 2)).toBe(1);
    expect(findTypeaheadIndex(items, "", 0)).toBe(-1);
    expect(findTypeaheadIndex([], "o", 0)).toBe(-1);
  });
});
