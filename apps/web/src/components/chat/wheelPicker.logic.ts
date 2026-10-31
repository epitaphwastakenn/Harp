const wheelRenderRadius = 3;
const wheelStepDegrees = 20;
export const wheelVisibleRows = 5;
export const wheelDragThresholdPx = 4;
const wheelStepThreshold = 48;
const wheelCooldownMs = 140;
const wheelIdleResetMs = 220;
const typeaheadResetMs = 700;

const wheelLineHeightPx = 16;
const wheelPageHeightPx = 400;
const stepRadians = (wheelStepDegrees * Math.PI) / 180;
const drumRadius = 1 / stepRadians;

type Enableable = { readonly disabled?: boolean | undefined };
type Labelled = Enableable & { readonly label: string };

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(index)));
}

export function isEnabledAt(items: ReadonlyArray<Enableable>, index: number): boolean {
  const item = items[index];
  return item !== undefined && item.disabled !== true;
}

export function stepEnabledIndex(
  items: ReadonlyArray<Enableable>,
  from: number,
  direction: 1 | -1,
): number {
  for (let index = from + direction; index >= 0 && index < items.length; index += direction) {
    if (isEnabledAt(items, index)) return index;
  }
  return from;
}

export function nearestEnabledIndex(
  items: ReadonlyArray<Enableable>,
  index: number,
  direction: 1 | -1 = 1,
): number {
  const target = clampIndex(index, items.length);
  if (isEnabledAt(items, target)) return target;
  for (let offset = 1; offset < items.length; offset += 1) {
    const ahead = target + offset * direction;
    if (isEnabledAt(items, ahead)) return ahead;
    const behind = target - offset * direction;
    if (isEnabledAt(items, behind)) return behind;
  }
  return -1;
}

export function edgeEnabledIndex(items: ReadonlyArray<Enableable>, edge: "start" | "end"): number {
  return edge === "start"
    ? nearestEnabledIndex(items, 0, 1)
    : nearestEnabledIndex(items, items.length - 1, -1);
}

export type WheelAccumulator = {
  readonly delta: number;
  readonly lastEventAt: number;
  readonly lastStepAt: number;
};

export const initialWheelAccumulator: WheelAccumulator = {
  delta: 0,
  lastEventAt: Number.NEGATIVE_INFINITY,
  lastStepAt: Number.NEGATIVE_INFINITY,
};

export function accumulateWheel(
  state: WheelAccumulator,
  input: { readonly deltaY: number; readonly deltaMode: number; readonly timeStamp: number },
): { readonly state: WheelAccumulator; readonly step: -1 | 0 | 1 } {
  const unit =
    input.deltaMode === 1 ? wheelLineHeightPx : input.deltaMode === 2 ? wheelPageHeightPx : 1;
  const pixels = input.deltaY * unit;
  if (pixels === 0) return { state, step: 0 };
  const now = input.timeStamp;
  const isNotch = Math.abs(pixels) >= wheelStepThreshold;
  if (!isNotch && now - state.lastStepAt < wheelCooldownMs) {
    return { state: { ...state, delta: 0, lastEventAt: now }, step: 0 };
  }
  const continuing =
    now - state.lastEventAt <= wheelIdleResetMs && Math.sign(state.delta) === Math.sign(pixels);
  const delta = (continuing ? state.delta : 0) + pixels;
  if (Math.abs(delta) < wheelStepThreshold) {
    return { state: { delta, lastEventAt: now, lastStepAt: state.lastStepAt }, step: 0 };
  }
  return { state: { delta: 0, lastEventAt: now, lastStepAt: now }, step: delta > 0 ? 1 : -1 };
}

export function wheelWindow(
  count: number,
  center: number,
  radius: number = wheelRenderRadius,
): { readonly start: number; readonly end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const middle = clampIndex(center, count);
  return { start: Math.max(0, middle - radius), end: Math.min(count, middle + radius + 1) };
}

export type WheelPose = {
  readonly y: number;
  readonly z: number;
  readonly rotate: number;
  readonly scale: number;
  readonly opacity: number;
  readonly interactive: boolean;
};

const roundPose = (value: number) => Math.round(value * 1000) / 1000 + 0;

export function wheelPose(distance: number): WheelPose {
  const clamped = Math.max(-wheelRenderRadius, Math.min(wheelRenderRadius, distance));
  const magnitude = Math.abs(clamped);
  const angle = clamped * stepRadians;
  const opacity = Math.max(0, 1 - (magnitude / 3) ** 1.6);
  return {
    y: roundPose(drumRadius * Math.sin(angle)),
    z: roundPose(drumRadius * (Math.cos(angle) - 1)),
    rotate: roundPose(-clamped * wheelStepDegrees),
    scale: roundPose(Math.max(0.6, 1 - 0.08 * magnitude)),
    opacity: roundPose(opacity),
    interactive: opacity >= 0.2,
  };
}

export function wheelPoseTransform(pose: WheelPose): string {
  return `translate3d(0, calc(var(--wheel-item) * ${pose.y}), calc(var(--wheel-item) * ${pose.z})) rotateX(${pose.rotate}deg) scale(${pose.scale})`;
}

export type TypeaheadState = { readonly buffer: string; readonly at: number };

export const initialTypeahead: TypeaheadState = { buffer: "", at: Number.NEGATIVE_INFINITY };

export function currentTypeaheadBuffer(state: TypeaheadState, now: number): string {
  return now - state.at > typeaheadResetMs ? "" : state.buffer;
}

export function isTypeaheadKey(
  event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly altKey: boolean;
  },
  buffer: string,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  if (event.key === " ") return buffer.length > 0;
  if (buffer.length === 0 && /\p{N}/u.test(event.key)) return false;
  return true;
}

export function advanceTypeahead(state: TypeaheadState, key: string, now: number): TypeaheadState {
  return { buffer: currentTypeaheadBuffer(state, now) + key.toLowerCase(), at: now };
}

function normalizeForMatch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function startsWordAt(label: string, index: number): boolean {
  return index === 0 || !/[\p{L}\p{N}]/u.test(label[index - 1] ?? "");
}

function matchesWordStart(label: string, query: string): boolean {
  for (let index = 0; index < label.length; index += 1) {
    if (startsWordAt(label, index) && label.startsWith(query, index)) return true;
  }
  return false;
}

export function findTypeaheadIndex(
  items: ReadonlyArray<Labelled>,
  buffer: string,
  from: number,
): number {
  const count = items.length;
  if (count === 0 || buffer.length === 0) return -1;
  const normalizedBuffer = normalizeForMatch(buffer);
  const first = normalizedBuffer[0] ?? "";
  const cycling = [...normalizedBuffer].every((character) => character === first);
  const query = cycling ? first : normalizedBuffer;
  const start = query.length === 1 && cycling ? from + 1 : Math.max(from, 0);
  const labels = items.map((item) => normalizeForMatch(item.label));
  const tiers: ReadonlyArray<(label: string) => boolean> = [
    (label) => label.startsWith(query),
    (label) => matchesWordStart(label, query),
    (label) => label.includes(query),
  ];
  for (const matches of tiers) {
    for (let offset = 0; offset < count; offset += 1) {
      const index = (((start + offset) % count) + count) % count;
      if (isEnabledAt(items, index) && matches(labels[index] ?? "")) return index;
    }
  }
  return -1;
}
