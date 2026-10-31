import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { subscribeThemeEpoch } from "~/themeEpoch";
import type { EffortSliderVariantProps } from "./types";

type Rgb = readonly [number, number, number];
type Point = readonly [number, number];
type Stop = readonly [number, string];

interface Tune {
  readonly amp: number;
  readonly speed: number;
  readonly bubbles: number;
  readonly drops: number;
  readonly glints: number;
  readonly rest: number;
  readonly glow: number;
  readonly hot: number;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  wob: number;
  age: number;
  delay: number;
  pop: number;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  delay: number;
}

interface Ring {
  x: number;
  age: number;
}

interface LiquidEngine {
  sync: (index: number, count: number) => void;
  dragStart: (clientX: number) => number;
  dragMove: (clientX: number) => number | null;
  dragEnd: () => number | null;
  nudge: () => void;
  focus: () => void;
  dispose: () => void;
}

const padX = 20;
const padTop = 48;
const padBottom = 16;
const stageHeight = 60;
const vesselTop = 10;
const vesselHeight = 40;
const lensRadius = 23;
const topIntensity = 4;
const settleMs = 1500;
const nudgeMs = 1000;
const fallbackAccent: Rgb = [139, 92, 246];

const tunes: ReadonlyArray<Tune> = [
  { amp: 0.7, speed: 4, bubbles: 3, drops: 0, glints: 0, rest: 2, glow: 0.3, hot: 0 },
  { amp: 1, speed: 5.5, bubbles: 6, drops: 0, glints: 0, rest: 4, glow: 0.45, hot: 0.05 },
  { amp: 1.4, speed: 7, bubbles: 10, drops: 0, glints: 0, rest: 6, glow: 0.65, hot: 0.12 },
  { amp: 2, speed: 9, bubbles: 17, drops: 8, glints: 2, rest: 9, glow: 0.95, hot: 0.26 },
  { amp: 3, speed: 12, bubbles: 28, drops: 20, glints: 4, rest: 13, glow: 1.3, hot: 0.48 },
];

const glintSpots: ReadonlyArray<Point> = [
  [34, 11],
  [78, 29],
  [118, 14],
  [62, 8],
];

const vesselStyle: CSSProperties = {
  boxShadow:
    "inset 0 2px 7px rgb(0 0 0 / 0.35), inset 0 0 0 1px color-mix(in srgb, var(--brand-accent) calc(var(--glow) * 45%), rgb(255 255 255 / 0.1)), 0 0 calc(8px + var(--glow) * 30px) color-mix(in srgb, var(--brand-accent) calc(var(--glow) * 45%), transparent)",
};

const lensStyle: CSSProperties = {
  border: "2.5px solid rgb(255 255 255 / 0.92)",
  background:
    "radial-gradient(circle at 34% 26%, rgb(255 255 255 / 0.26), rgb(255 255 255 / 0.04) 40%, transparent 62%), radial-gradient(circle at 50% 62%, transparent 52%, rgb(0 0 0 / 0.3))",
  boxShadow:
    "0 0 0 1px rgb(0 0 0 / 0.35), 0 5px 14px rgb(0 0 0 / 0.5), inset 0 0 10px rgb(255 255 255 / 0.3), 0 0 calc(6px + var(--glow) * 24px) color-mix(in srgb, var(--brand-accent) 75%, transparent)",
};

const lensGlintStyle: CSSProperties = { filter: "blur(1px)" };
const labelGlowShadow = "0 0 calc(var(--glow) * 14px) var(--brand-accent)";

function frac(n: number) {
  return n - Math.floor(n);
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function rand(low: number, high: number) {
  return low + Math.random() * (high - low);
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

function rgb(color: Rgb) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function rgba(color: Rgb, alpha: number) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function ramp(gradient: CanvasGradient, stops: ReadonlyArray<Stop>) {
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function prune<T>(list: T[], keep: (item: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (item !== undefined && !keep(item)) list.splice(i, 1);
  }
}

function tuneAt(intensity: number): Tune {
  const low = clamp(Math.floor(intensity), 0, tunes.length - 2);
  const from = tunes[low] ?? tunes[0]!;
  const to = tunes[low + 1] ?? from;
  const t = intensity - low;
  const blend = (key: keyof Tune) => from[key] + (to[key] - from[key]) * t;
  return {
    amp: blend("amp"),
    speed: blend("speed"),
    bubbles: Math.round(blend("bubbles")),
    drops: Math.round(blend("drops")),
    glints: Math.round(blend("glints")),
    rest: Math.round(blend("rest")),
    glow: blend("glow"),
    hot: blend("hot"),
  };
}

function intensityAt(index: number, lastIndex: number) {
  return lastIndex > 0 ? (index / lastIndex) * topIntensity : 0;
}

function stopLeft(index: number, lastIndex: number) {
  const share = lastIndex > 0 ? index / lastIndex : 0;
  return `calc(${lensRadius}px + (100% - ${lensRadius * 2}px) * ${share})`;
}

const restSeeds = Array.from({ length: 14 }, (_, i) => ({
  u: frac(i * 0.618034 + 0.13),
  v: frac(i * 0.754878 + 0.31),
  r: 1.2 + frac(i * 0.56984) * 2.2,
}));

const accentCache = new Map<string, Rgb>();
let probeContext: CanvasRenderingContext2D | null | undefined;

function resolveColor(value: string): Rgb {
  const cached = accentCache.get(value);
  if (cached) return cached;
  if (probeContext === undefined) {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    probeContext = probe.getContext("2d", { willReadFrequently: true });
  }
  let color = fallbackAccent;
  if (probeContext && value) {
    probeContext.clearRect(0, 0, 1, 1);
    probeContext.fillStyle = "rgba(0, 0, 0, 0)";
    probeContext.fillStyle = value;
    probeContext.fillRect(0, 0, 1, 1);
    const pixel = probeContext.getImageData(0, 0, 1, 1).data;
    if ((pixel[3] ?? 0) > 0) color = [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
  }
  if (accentCache.size >= 16) accentCache.clear();
  accentCache.set(value, color);
  return color;
}

function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (!stroke) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  disc(ctx, x, y, r, `rgba(255, 255, 255, ${0.1 * a})`, `rgba(255, 255, 255, ${0.55 * a})`);
  disc(ctx, x - r * 0.35, y - r * 0.35, Math.max(0.5, r * 0.28), `rgba(255, 255, 255, ${0.9 * a})`);
}

function drawGlint(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s);
  ctx.lineTo(x, y + s);
  ctx.stroke();
}

function liquidPath(ctx: CanvasRenderingContext2D, points: ReadonlyArray<Point>) {
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineTo(-6, vesselHeight);
  ctx.closePath();
}

function createLiquidEngine(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  thumb: HTMLElement,
): LiquidEngine {
  const ctx = canvas.getContext("2d");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const bubbles: Bubble[] = [];
  const drops: Drop[] = [];
  const rings: Ring[] = [];
  let lastIndex = topIntensity;
  let idx = 0;
  let tune = tuneAt(0);
  let ready = false;
  let width = 0;
  let cw = 0;
  let ch = 0;
  let dpr = 1;
  let accent = fallbackAccent;
  let deep = accent;
  let light = accent;
  let hot = accent;
  let thumbX = 0;
  let thumbV = 0;
  let frontX = 0;
  let frontV = 0;
  let target = 0;
  let energy = 0;
  let phase = 0;
  let flash = 0;
  let shake = 0;
  let until = 0;
  let last = 0;
  let raf = 0;
  let dragging = false;
  let free = false;
  let stageLeft = 0;
  let startX = 0;
  let dragIndex = 0;

  const calm = () => motion.matches;
  const intensity = () => intensityAt(idx, lastIndex);
  const stopX = (index: number) =>
    lensRadius + (width - lensRadius * 2) * (lastIndex > 0 ? index / lastIndex : 0);

  function readColors() {
    accent = resolveColor(getComputedStyle(stage).getPropertyValue("--brand-accent").trim());
    deep = mix(accent, [0, 0, 0], 0.6);
    light = mix(accent, [255, 255, 255], 0.35);
    hot = mix(accent, [255, 255, 255], 0.72);
  }

  function edge(fx: number, y: number, layer: number) {
    const k = (y - 0.5) * 2;
    const bulge = (5 + clamp(frontV * 0.03, -7, 10)) * (1 - k * k);
    const wave =
      energy *
      tune.amp *
      (Math.sin(y * 9 + phase + layer * 2) * 1.6 + Math.sin(y * 17 - phase * 1.4 + layer) * 0.8);
    return fx + bulge + wave + 1.1 * Math.sin(y * 6.5 + 1 + layer * 1.7) + layer * 7;
  }

  function edgeLine(fx: number, layer: number) {
    return Array.from({ length: 21 }, (_, i): Point => [
      edge(fx, i / 20, layer),
      (vesselHeight * i) / 20,
    ]);
  }

  function paint(c: CanvasRenderingContext2D) {
    const fx = frontX;
    const mid = vesselHeight / 2;
    const fill = (style: CanvasGradient) => {
      c.fillStyle = style;
      c.fillRect(0, 0, width, vesselHeight);
    };
    c.clearRect(0, 0, cw, ch);
    c.save();
    c.translate(padX, padTop + vesselTop);
    c.beginPath();
    c.roundRect(0, 0, width, vesselHeight, mid);
    c.clip();
    const back = edgeLine(fx, 1);
    const main = edgeLine(fx, 0);
    liquidPath(c, back);
    c.fillStyle = rgba(light, 0.26 + tune.hot * 0.3);
    c.fill();
    liquidPath(c, main);
    c.fillStyle = ramp(c.createLinearGradient(0, 0, fx + 10, 0), [
      [0, rgb(deep)],
      [0.5, rgb(accent)],
      [1, rgb(mix(accent, hot, 0.3 + tune.hot * 0.7))],
    ]);
    c.fill();
    c.save();
    c.clip();
    c.globalCompositeOperation = "lighter";
    fill(
      ramp(c.createLinearGradient(0, 0, 0, vesselHeight), [
        [0, rgba(hot, 0)],
        [0.5, rgba(hot, 0.04 + tune.hot * 0.32)],
        [1, rgba(hot, 0)],
      ]),
    );
    fill(
      ramp(c.createRadialGradient(fx, mid, 0, fx, mid, 80), [
        [0, rgba(light, 0.1 + tune.glow * 0.2)],
        [1, rgba(light, 0)],
      ]),
    );
    if (flash > 0.01) {
      fill(
        ramp(c.createRadialGradient(thumbX, mid, 0, thumbX, mid, 50 + (1 - flash) * 190), [
          [0, rgba(hot, flash * 0.75)],
          [1, rgba(hot, 0)],
        ]),
      );
    }
    for (const ring of rings) {
      const p = ring.age / 0.75;
      c.beginPath();
      c.ellipse(ring.x, mid, 10 + p * 170, 40, 0, 0, Math.PI * 2);
      c.strokeStyle = rgba(hot, (1 - p) * 0.9);
      c.lineWidth = 1 + (1 - p) * 4;
      c.stroke();
    }
    c.globalCompositeOperation = "source-over";
    fill(
      ramp(c.createLinearGradient(0, 0, 0, vesselHeight), [
        [0, "rgba(255, 255, 255, 0.34)"],
        [0.3, "rgba(255, 255, 255, 0.06)"],
        [0.55, "rgba(255, 255, 255, 0)"],
        [1, "rgba(0, 0, 0, 0.24)"],
      ]),
    );
    for (const seed of restSeeds.slice(0, tune.rest)) {
      const x = 10 + seed.u * (width - 20);
      if (x < fx - 8) drawBubble(c, x, 8 + seed.v * (vesselHeight - 16), seed.r, 0.8);
    }
    for (const bubble of bubbles) {
      if (bubble.age < bubble.delay) continue;
      drawBubble(c, bubble.x, bubble.y, bubble.r * (1 + bubble.pop * 3), 1 - bubble.pop / 0.22);
    }
    for (const [dx, y] of glintSpots.slice(0, tune.glints)) {
      if (fx - dx > 6) drawGlint(c, fx - dx, y, 3.5);
    }
    c.restore();
    c.beginPath();
    main.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.shadowColor = rgb(light);
    c.shadowBlur = 6 + tune.glow * 10;
    c.strokeStyle = rgba(hot, 0.55 + tune.hot * 0.4);
    c.lineWidth = 1.6;
    c.stroke();
    c.restore();
    c.save();
    c.translate(padX, padTop + vesselTop);
    for (const drop of drops) {
      if (drop.delay > 0) continue;
      disc(c, drop.x, drop.y, drop.r, rgba(mix(light, hot, 0.5), 1 - drop.age / 0.85));
    }
    c.restore();
  }

  function render() {
    if (!ready) return;
    thumb.style.transform = `translate3d(${thumbX}px, 0, 0)`;
    stage.style.transform =
      shake > 0.01
        ? `translate(${rand(-1, 1) * shake * 3}px, ${rand(-1, 1) * shake * 2}px) scale(${1 + shake * 0.015})`
        : "";
    if (ctx && width > 0) paint(ctx);
  }

  function settle() {
    thumbX = target;
    frontX = target;
    thumbV = 0;
    frontV = 0;
    energy = 0;
    flash = 0;
    shake = 0;
    bubbles.length = 0;
    drops.length = 0;
    rings.length = 0;
    render();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = stage.clientWidth;
    cw = width + padX * 2;
    ch = padTop + stageHeight + padBottom;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.left = `${-padX}px`;
    canvas.style.top = `${-padTop}px`;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!dragging) target = stopX(idx);
    settle();
  }

  function spawnBubbles(n: number) {
    const level = intensity();
    for (let i = 0; i < n; i++) {
      bubbles.push({
        x: clamp(target - rand(6, 170), 8, width - 8),
        y: vesselHeight - rand(4, 12),
        r: rand(1.4, 3 + level * 0.7),
        vy: rand(45, 90 + level * 18),
        wob: rand(0, 6),
        age: 0,
        delay: rand(0, 0.4),
        pop: 0,
      });
    }
  }

  function spawnDrops(n: number) {
    for (let i = 0; i < n; i++) {
      drops.push({
        x: target + rand(-16, 6),
        y: 2,
        vx: rand(-60, 90),
        vy: -rand(190, 330),
        r: rand(1.6, 4),
        age: 0,
        delay: rand(0.1, 0.2),
      });
    }
  }

  function step(dt: number) {
    thumbV += (520 * (target - thumbX) - 42 * thumbV) * dt;
    thumbX += thumbV * dt;
    frontV += (150 * (thumbX - frontX) - 11 * frontV) * dt;
    const nx = frontX + frontV * dt;
    frontX = clamp(nx, thumbX - 40, thumbX + 40);
    if (frontX !== nx) frontV = thumbV;
    energy = Math.max(energy * Math.exp(-dt * 2.6), Math.min(1.2, Math.abs(frontV) / 260));
    phase += dt * tune.speed;
    flash *= Math.exp(-dt * 3.2);
    shake *= Math.exp(-dt * 8);
    if (dragging && Math.abs(frontV) > 40 && Math.random() < dt * 24) {
      spawnBubbles(intensity() > 2 ? 2 : 1);
    }
    for (const bubble of bubbles) {
      bubble.age += dt;
      if (bubble.age < bubble.delay) continue;
      bubble.y = Math.max(bubble.r + 2, bubble.y - bubble.vy * dt);
      bubble.x += Math.sin(bubble.age * 7 + bubble.wob) * 12 * dt;
      if (bubble.y <= bubble.r + 2) bubble.pop += dt;
    }
    for (const drop of drops) {
      if (drop.delay > 0) {
        drop.delay -= dt;
        continue;
      }
      drop.vy += 1100 * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      drop.age += dt;
    }
    for (const ring of rings) ring.age += dt;
    prune(bubbles, (bubble) => bubble.pop < 0.22);
    prune(drops, (drop) => drop.age < 0.85 && !(drop.vy > 0 && drop.y > 6));
    prune(rings, (ring) => ring.age < 0.75);
  }

  function tick(now: number) {
    step(Math.min(0.033, (now - last) / 1000 || 0.016));
    last = now;
    render();
    if (now < until) {
      raf = requestAnimationFrame(tick);
      return;
    }
    raf = 0;
    settle();
  }

  function kick(ms: number) {
    if (calm()) return;
    until = Math.max(until, performance.now() + ms);
    if (raf) return;
    readColors();
    if ((window.devicePixelRatio || 1) !== dpr) resize();
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function burst(from: number, to: number) {
    const up = to > from;
    const level = intensityAt(to, lastIndex);
    const t = tuneAt(level);
    energy = Math.max(energy, up ? 0.7 + level * 0.3 : 0.45 + level * 0.15);
    spawnBubbles(up ? t.bubbles : Math.ceil(t.bubbles * 0.5));
    if (!up) return;
    spawnDrops(t.drops);
    if (level >= 2.5) rings.push({ x: target, age: 0 });
    const peak = clamp((level - 2) / 2, 0, 1);
    flash = peak ** 1.15;
    shake = peak ** 1.7;
  }

  function pointerTo(clientX: number) {
    if (Math.abs(clientX - startX) > 3) free = true;
    const span = width - lensRadius * 2;
    const x = clamp(clientX - stageLeft, stopX(0), stopX(lastIndex));
    if (lastIndex > 0 && span > 0) {
      dragIndex = clamp(Math.round(((x - lensRadius) / span) * lastIndex), 0, lastIndex);
    }
    target = free && !calm() ? x : stopX(dragIndex);
    kick(settleMs);
    return dragIndex;
  }

  readColors();
  resize();
  const stopResize = observeResize(stage, () => {
    if (stage.clientWidth !== width) resize();
  });
  const stopTheme = subscribeThemeEpoch(() => {
    readColors();
    if (!raf) render();
  });

  return {
    sync(index, count) {
      const nextLast = Math.max(0, count - 1);
      const next = clamp(index, 0, nextLast);
      const reshaped = nextLast !== lastIndex;
      lastIndex = nextLast;
      if (!ready || reshaped) {
        ready = true;
        idx = next;
        tune = tuneAt(intensity());
        if (!dragging) target = stopX(idx);
        readColors();
        settle();
        return;
      }
      if (next === idx) return;
      const previous = idx;
      idx = next;
      tune = tuneAt(intensity());
      if (!dragging) target = stopX(idx);
      if (calm()) {
        settle();
        return;
      }
      burst(previous, idx);
      kick(settleMs);
    },
    dragStart(clientX) {
      dragging = true;
      free = false;
      startX = clientX;
      dragIndex = idx;
      stageLeft = stage.getBoundingClientRect().left;
      return pointerTo(clientX);
    },
    dragMove(clientX) {
      return dragging ? pointerTo(clientX) : null;
    },
    dragEnd() {
      if (!dragging) return null;
      dragging = false;
      target = stopX(dragIndex);
      if (calm()) settle();
      else kick(settleMs);
      return dragIndex;
    },
    nudge() {
      if (calm()) return;
      energy = Math.max(energy, 0.4);
      kick(nudgeMs);
    },
    focus() {
      stage.focus({ preventScroll: true });
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      stopResize();
      stopTheme();
      stage.style.transform = "";
    },
  };
}

export function LiquidEffortSlider({
  options,
  value,
  label,
  disabled,
  onPreview,
  onCommit,
}: EffortSliderVariantProps) {
  const engineRef = useRef<LiquidEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const levelCount = options.length;
  const lastIndex = Math.max(0, levelCount - 1);
  const current = options[value] ?? options[0];
  const glow = tuneAt(intensityAt(value, lastIndex)).glow;

  const attach = (stage: HTMLDivElement | null) => {
    const canvas = canvasRef.current;
    const thumb = thumbRef.current;
    if (!stage || !canvas || !thumb) return;
    const engine = createLiquidEngine(stage, canvas, thumb);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  };

  // oxlint-disable-next-line t3code/react-effect-budget -- value also changes from the wrapper (number keys, selection), outside this component's handlers, and the canvas animation has to follow it
  useLayoutEffect(() => {
    engineRef.current?.sync(value, levelCount);
  }, [value, levelCount]);

  const choose = (index: number) => {
    if (index === value) engineRef.current?.nudge();
    else onCommit(index);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const engine = engineRef.current;
    if (disabled || !engine || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onPreview(engine.dragStart(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const index = engine.dragMove(event.clientX);
    if (index !== null) onPreview(index);
  };

  const endDrag = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const index = engine.dragEnd();
    if (index === null) return;
    setDragging(false);
    onCommit(index);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    let next = value;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = value + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = value - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = lastIndex;
    else return;
    event.preventDefault();
    choose(Math.min(lastIndex, Math.max(0, next)));
  };

  return (
    <div style={{ "--glow": glow } as CSSProperties}>
      <div
        ref={attach}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={value}
        aria-valuetext={current?.label}
        aria-disabled={disabled || undefined}
        data-dragging={dragging ? "true" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={cn(
          "relative h-15 w-full touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
          disabled ? "cursor-not-allowed opacity-50" : dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-x-0 inset-y-2.5 rounded-full bg-foreground/10 transition-shadow duration-500 motion-reduce:transition-none"
            style={vesselStyle}
          />
          <canvas ref={canvasRef} className="absolute" />
          <div className="absolute inset-x-4.5 top-3.5 h-1.75 rounded-full bg-linear-to-b from-white/30 to-transparent" />
          {options.map((option, index) => (
            <span
              key={option.id}
              className="absolute top-7.5 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/30"
              style={{ left: stopLeft(index, lastIndex) }}
            />
          ))}
          <div
            ref={thumbRef}
            className="absolute -left-5.75 top-1.75 size-11.5 will-change-transform"
          >
            <div
              className={cn(
                "relative size-full rounded-full transition-[transform,box-shadow] duration-300 ease-out motion-reduce:transition-none",
                dragging && "scale-110",
              )}
              style={lensStyle}
            >
              <span
                className="absolute left-2 top-1.5 h-1.75 w-3.5 -rotate-28 rounded-full bg-white/75"
                style={lensGlintStyle}
              />
            </div>
          </div>
        </div>
      </div>

      {levelCount > 1 ? (
        <div className="relative mt-0.5 h-7.5" aria-hidden="true">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => {
                choose(index);
                engineRef.current?.focus();
              }}
              className={cn(
                "absolute top-0 h-7.5 min-w-16 -translate-x-1/2 whitespace-nowrap px-1 text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none",
                index === value
                  ? "text-foreground"
                  : "text-muted-foreground enabled:hover:text-foreground/80",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
              style={{
                left: stopLeft(index, lastIndex),
                textShadow: index === value ? labelGlowShadow : undefined,
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
