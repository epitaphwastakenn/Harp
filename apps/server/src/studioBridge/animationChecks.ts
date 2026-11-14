export type AnimationFindingKind = "range" | "velocity" | "loopSeam" | "rootDrift" | "asymmetry";

export interface AnimationFinding {
  readonly severity: "error" | "warning";
  readonly kind: AnimationFindingKind;
  readonly joint: string;
  readonly time?: number;
  readonly message: string;
}

export interface AnimationCheckResult {
  readonly findings: ReadonlyArray<AnimationFinding>;
  readonly errors: number;
  readonly warnings: number;
}

type Range = readonly [number, number];
type JointRange = { readonly X: Range; readonly Y: Range; readonly Z: Range };

const symmetric = (limit: number): Range => [-limit, limit];

/**
 * Natural R15 motion in degrees of offset from the rest pose, from the animation skill's joint
 * table (a guideline, not a hard engine limit). Joints not listed here are never checked.
 */
const jointRanges: Readonly<Record<string, JointRange>> = {
  Root: { X: [-15, 10], Y: symmetric(25), Z: symmetric(10) },
  Waist: { X: [-45, 20], Y: symmetric(45), Z: symmetric(25) },
  Neck: { X: symmetric(40), Y: symmetric(70), Z: symmetric(30) },
  RightShoulder: { X: [-60, 180], Y: symmetric(90), Z: [-30, 170] },
  LeftShoulder: { X: [-60, 180], Y: symmetric(90), Z: [-170, 30] },
  RightElbow: { X: [0, 145], Y: symmetric(20), Z: [0, 0] },
  LeftElbow: { X: [0, 145], Y: symmetric(20), Z: [0, 0] },
  RightWrist: { X: symmetric(60), Y: symmetric(45), Z: symmetric(30) },
  LeftWrist: { X: symmetric(60), Y: symmetric(45), Z: symmetric(30) },
  RightHip: { X: [-35, 120], Y: symmetric(30), Z: [-10, 45] },
  LeftHip: { X: [-35, 120], Y: symmetric(30), Z: [-45, 10] },
  RightKnee: { X: [-145, 0], Y: [0, 0], Z: [0, 0] },
  LeftKnee: { X: [-145, 0], Y: [0, 0], Z: [0, 0] },
  RightAnkle: { X: [-45, 25], Y: symmetric(15), Z: symmetric(15) },
  LeftAnkle: { X: [-45, 25], Y: symmetric(15), Z: symmetric(15) },
};

const partToJoint: Readonly<Record<string, string>> = {
  lowertorso: "Root",
  uppertorso: "Waist",
  head: "Neck",
  rightupperarm: "RightShoulder",
  leftupperarm: "LeftShoulder",
  rightlowerarm: "RightElbow",
  leftlowerarm: "LeftElbow",
  righthand: "RightWrist",
  lefthand: "LeftWrist",
  rightupperleg: "RightHip",
  leftupperleg: "LeftHip",
  rightlowerleg: "RightKnee",
  leftlowerleg: "LeftKnee",
  rightfoot: "RightAnkle",
  leftfoot: "LeftAnkle",
};

const canonicalByLower = new Map<string, string>([
  ...Object.keys(jointRanges).map((name) => [name.toLowerCase(), name] as const),
  ...Object.entries(partToJoint),
]);

const rootNames = new Set(["root", "lowertorso", "humanoidrootpart", "rootjoint"]);

const pairs: ReadonlyArray<readonly [string, string]> = [
  ["LeftShoulder", "RightShoulder"],
  ["LeftElbow", "RightElbow"],
  ["LeftHip", "RightHip"],
  ["LeftKnee", "RightKnee"],
];

const warnOverRangeDegrees = 0;
const errorOverRangeDegrees = 20;
const warnVelocityDegreesPerSecond = 1080;
const errorVelocityDegreesPerSecond = 2160;
const warnSeamDegrees = 3;
const errorSeamDegrees = 15;
const warnSeamStuds = 0.1;
const errorSeamStuds = 0.5;
const warnDriftStuds = 0.15;
const errorDriftStuds = 1;
const minAsymmetryDegrees = 20;
const asymmetryRatio = 0.3;
const maxFindings = 40;

interface PoseSample {
  readonly rotation: readonly [number, number, number];
  readonly position: readonly [number, number, number];
}

interface Frame {
  readonly time: number;
  readonly poses: ReadonlyMap<string, PoseSample>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const vector = (value: unknown): readonly [number, number, number] | undefined => {
  const pick = (key: string, index: number): number | undefined => {
    const raw = Array.isArray(value)
      ? value[index]
      : isRecord(value)
        ? (value[key] ?? value[key.toUpperCase()])
        : undefined;
    const number = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    return typeof number === "number" && Number.isFinite(number) ? number : undefined;
  };
  const x = pick("x", 0);
  const y = pick("y", 1);
  const z = pick("z", 2);
  return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
};

const readFrames = (keyframes: unknown): Frame[] => {
  if (!Array.isArray(keyframes)) return [];
  const frames: Frame[] = [];
  for (const entry of keyframes) {
    if (!isRecord(entry)) continue;
    const time = typeof entry.time === "number" ? entry.time : Number(entry.time);
    if (!Number.isFinite(time)) continue;
    const poses = new Map<string, PoseSample>();
    if (isRecord(entry.poses)) {
      for (const [name, pose] of Object.entries(entry.poses)) {
        if (!isRecord(pose)) continue;
        const rotation = pose.rotation === undefined ? ([0, 0, 0] as const) : vector(pose.rotation);
        const position = pose.position === undefined ? ([0, 0, 0] as const) : vector(pose.position);
        if (rotation === undefined || position === undefined) continue;
        poses.set(name, { rotation, position });
      }
    }
    frames.push({ time, poses });
  }
  return frames.toSorted((a, b) => a.time - b.time);
};

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** The unit quaternion of CFrame.fromEulerAnglesXYZ, the order the plugin builds poses with. */
const quaternionOf = (
  rotation: readonly [number, number, number],
): [number, number, number, number] => {
  const [hx, hy, hz] = rotation.map((degrees) => radians(degrees) / 2) as [number, number, number];
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(hx),
    Math.sin(hx),
    Math.cos(hy),
    Math.sin(hy),
    Math.cos(hz),
    Math.sin(hz),
  ] as const;
  const x = [sx, 0, 0, cx] as const;
  const y = [0, sy, 0, cy] as const;
  const z = [0, 0, sz, cz] as const;
  const multiply = (
    a: readonly number[],
    b: readonly number[],
  ): [number, number, number, number] => [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
  ];
  return multiply(multiply(x, y), z);
};

const angleBetween = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => {
  const qa = quaternionOf(a);
  const qb = quaternionOf(b);
  const dot = Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]));
  return (2 * Math.acos(dot) * 180) / Math.PI;
};

const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const round = (value: number, places = 1): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const keyOf = (name: string): string => {
  const lower = name.toLowerCase();
  return (canonicalByLower.get(lower) ?? lower).toLowerCase();
};

const rest: PoseSample = { rotation: [0, 0, 0], position: [0, 0, 0] };

/**
 * A joint a key does not pose counts as at rest, and a rest key is implied at time 0, as the
 * plugin adds one. Joints without a range table are skipped.
 */
export const checkAnimation = (input: {
  readonly keyframes: unknown;
  readonly looped?: boolean | undefined;
  readonly easingStyle?: string | undefined;
}): AnimationCheckResult => {
  const read = readFrames(input.keyframes);
  const findings: AnimationFinding[] = [];
  if (read.length === 0) return { findings, errors: 0, warnings: 0 };
  const frames =
    read[0]!.time > 0 ? [{ time: 0, poses: new Map<string, PoseSample>() }, ...read] : read;
  const looped = input.looped === true;
  const snapping = input.easingStyle === "Constant";

  const keyed = frames.map((frame) => {
    const poses = new Map<string, PoseSample>();
    for (const [name, pose] of frame.poses) poses.set(keyOf(name), pose);
    return { time: frame.time, poses };
  });
  const keys = new Set(keyed.flatMap((frame) => [...frame.poses.keys()]));

  for (const key of keys) {
    const joint = canonicalByLower.get(key);
    if (joint === undefined) continue;
    const track = keyed.map((frame) => ({ time: frame.time, pose: frame.poses.get(key) ?? rest }));
    const range = jointRanges[joint];
    if (range !== undefined) {
      for (const [index, axis] of (["X", "Y", "Z"] as const).entries()) {
        const [low, high] = range[axis];
        let worst: { over: number; time: number; value: number } | undefined;
        let count = 0;
        for (const sample of track) {
          const value = sample.pose.rotation[index]!;
          const over = value > high ? value - high : value < low ? low - value : 0;
          if (over <= warnOverRangeDegrees) continue;
          count += 1;
          if (worst === undefined || over > worst.over) worst = { over, time: sample.time, value };
        }
        if (worst === undefined) continue;
        findings.push({
          severity: worst.over > errorOverRangeDegrees ? "error" : "warning",
          kind: "range",
          joint,
          time: round(worst.time, 3),
          message: `${joint} ${axis} reaches ${String(round(worst.value))} deg at ${String(round(worst.time, 3))}s, ${String(round(worst.over))} deg beyond its natural range ${String(low)} to ${String(high)}${count > 1 ? ` (${String(count)} keys exceed it)` : ""}.`,
        });
      }
    }

    if (snapping) continue;
    let fastest: { rate: number; from: number; to: number; degrees: number } | undefined;
    for (let index = 1; index < track.length; index += 1) {
      const previous = track[index - 1]!;
      const next = track[index]!;
      const dt = next.time - previous.time;
      if (dt <= 0) continue;
      const degrees = angleBetween(previous.pose.rotation, next.pose.rotation);
      const rate = degrees / dt;
      if (fastest === undefined || rate > fastest.rate) {
        fastest = { rate, from: previous.time, to: next.time, degrees };
      }
    }
    if (fastest !== undefined && fastest.rate > warnVelocityDegreesPerSecond) {
      findings.push({
        severity: fastest.rate > errorVelocityDegreesPerSecond ? "error" : "warning",
        kind: "velocity",
        joint,
        time: round(fastest.from, 3),
        message: `${joint} turns ${String(round(fastest.degrees))} deg between ${String(round(fastest.from, 3))}s and ${String(round(fastest.to, 3))}s, ${String(Math.round(fastest.rate))} deg/s, which reads as a snap. Add a key in between or give it more time.`,
      });
    }
  }

  if (looped && keyed.length > 1) {
    const first = keyed[0]!;
    const last = keyed[keyed.length - 1]!;
    for (const key of keys) {
      const isRoot = rootNames.has(key);
      const joint = canonicalByLower.get(key);
      if (joint === undefined && !isRoot) continue;
      const label = joint ?? key;
      const start = first.poses.get(key) ?? rest;
      const end = last.poses.get(key) ?? rest;
      const degrees = joint === undefined ? 0 : angleBetween(start.rotation, end.rotation);
      if (degrees > warnSeamDegrees) {
        findings.push({
          severity: degrees > errorSeamDegrees ? "error" : "warning",
          kind: "loopSeam",
          joint: label,
          time: round(last.time, 3),
          message: `${label} ends ${String(round(degrees))} deg away from where it starts, so the loop pops at the seam. Make the last key match the first.`,
        });
      }
      const offset = distance(start.position, end.position);
      if (isRoot) {
        if (offset > warnDriftStuds) {
          findings.push({
            severity: offset > errorDriftStuds ? "error" : "warning",
            kind: "rootDrift",
            joint: label,
            time: round(last.time, 3),
            message: `${label} ends ${String(round(offset, 2))} studs from where it starts, so the character drifts every loop. Return it to the start position and let the game move the character.`,
          });
        }
      } else if (offset > warnSeamStuds) {
        findings.push({
          severity: offset > errorSeamStuds ? "error" : "warning",
          kind: "loopSeam",
          joint: label,
          time: round(last.time, 3),
          message: `${label} ends ${String(round(offset, 2))} studs from where it starts, so the loop pops at the seam.`,
        });
      }
    }

    const amplitude = (joint: string): number =>
      Math.max(
        0,
        ...keyed.map((frame) =>
          angleBetween([0, 0, 0], frame.poses.get(joint.toLowerCase())?.rotation ?? [0, 0, 0]),
        ),
      );
    for (const [left, right] of pairs) {
      const a = amplitude(left);
      const b = amplitude(right);
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      if (big >= minAsymmetryDegrees && small < big * asymmetryRatio) {
        const still = a > b ? right : left;
        findings.push({
          severity: "warning",
          kind: "asymmetry",
          joint: still,
          message: `${left} and ${right} are lopsided in a loop: one swings ${String(round(big))} deg and ${still} only ${String(round(small))}. Cycles usually move both sides, opposite in phase.`,
        });
      }
    }
  }

  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return { findings: findings.slice(0, maxFindings), errors, warnings: findings.length - errors };
};
