import { describe, expect, it } from "@effect/vitest";

import { checkAnimation } from "./animationChecks.ts";

const key = (
  time: number,
  poses: Record<string, { rotation?: number[]; position?: number[] }>,
) => ({
  time,
  poses,
});

describe("checkAnimation", () => {
  it("accepts a gentle wave that returns to rest", () => {
    const result = checkAnimation({
      looped: true,
      keyframes: [
        key(0, {}),
        key(0.5, {
          RightShoulder: { rotation: [0, 0, 120] },
          RightElbow: { rotation: [40, 0, 0] },
        }),
        key(1, {}),
      ],
    });
    expect(result.findings.filter((finding) => finding.kind !== "asymmetry")).toEqual([]);
  });

  it("reports rotation beyond the joint range with the time and a severity", () => {
    const result = checkAnimation({
      keyframes: [
        key(0, {}),
        key(0.5, { RightElbow: { rotation: [-10, 0, 0] }, LeftKnee: { rotation: [60, 0, 0] } }),
      ],
    });
    const elbow = result.findings.find((finding) => finding.joint === "RightElbow");
    const knee = result.findings.find((finding) => finding.joint === "LeftKnee");
    expect(elbow).toMatchObject({ kind: "range", severity: "warning", time: 0.5 });
    expect(knee).toMatchObject({ kind: "range", severity: "error", time: 0.5 });
    expect(result.errors).toBe(1);
    expect(result.warnings).toBe(1);
  });

  it("matches joints by the part they move and ignores case", () => {
    const result = checkAnimation({
      keyframes: [key(0, {}), key(0.5, { rightlowerarm: { rotation: [-60, 0, 0] } })],
    });
    expect(result.findings[0]).toMatchObject({ joint: "RightElbow", severity: "error" });
  });

  it("flags a snap between two keys but not a Constant easing", () => {
    const keyframes = [key(0, {}), key(0.02, { Neck: { rotation: [0, 60, 0] } })];
    const result = checkAnimation({ keyframes });
    expect(result.findings).toMatchObject([{ kind: "velocity", joint: "Neck", severity: "error" }]);
    expect(checkAnimation({ keyframes, easingStyle: "Constant" }).findings).toEqual([]);
  });

  it("measures angular speed as a rotation, not per euler axis", () => {
    const result = checkAnimation({
      keyframes: [
        key(0, { Neck: { rotation: [0, 0, 0] } }),
        key(1, { Neck: { rotation: [0, 0, 0] } }),
      ],
    });
    expect(result.findings).toEqual([]);
  });

  it("finds a loop seam and root drift only for looped animations", () => {
    const keyframes = [
      key(0, { Root: { position: [0, 0, 0] }, Waist: { rotation: [0, 0, 0] } }),
      key(0.5, { Waist: { rotation: [-20, 0, 0] } }),
      key(1, { Root: { position: [0, 0, -2] }, Waist: { rotation: [-20, 0, 0] } }),
    ];
    const looped = checkAnimation({ looped: true, keyframes });
    expect(looped.findings.map((finding) => finding.kind).toSorted()).toEqual([
      "loopSeam",
      "rootDrift",
    ]);
    expect(looped.findings.find((finding) => finding.kind === "rootDrift")?.severity).toBe("error");
    expect(checkAnimation({ looped: false, keyframes }).findings).toEqual([]);
  });

  it("warns when only one side of a looped cycle moves", () => {
    const result = checkAnimation({
      looped: true,
      keyframes: [key(0, {}), key(0.4, { LeftHip: { rotation: [40, 0, 0] } }), key(0.8, {})],
    });
    expect(result.findings).toMatchObject([{ kind: "asymmetry", severity: "warning" }]);
  });

  it("skips joints it has no table for and tolerates malformed input", () => {
    const result = checkAnimation({
      looped: true,
      keyframes: [
        key(0, { Tail: { rotation: [0, 0, 0] } }),
        key(0.1, { Tail: { rotation: [900, 900, 900] } }),
        "nope",
        { time: "x" },
        { time: 0.2, poses: { Neck: { rotation: "bad" } } },
      ] as never,
    });
    expect(result.findings.filter((finding) => finding.kind === "range")).toEqual([]);
    expect(checkAnimation({ keyframes: undefined })).toEqual({
      findings: [],
      errors: 0,
      warnings: 0,
    });
  });
});
