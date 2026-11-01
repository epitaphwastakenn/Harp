import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { subscribeThemeEpoch } from "~/themeEpoch";
import type { EffortSliderVariantProps } from "./types";

type Rgb = readonly [number, number, number];
type Stop = readonly [number, string];

interface Tune {
  readonly spread: number;
  readonly lift: number;
  readonly curtain: number;
  readonly core: number;
  readonly blur: number;
  readonly sweep: number;
  readonly glow: number;
}

interface Strand {
  readonly freq: number;
  readonly speed: number;
  readonly offset: number;
}

interface AuroraEngine {
  sync: (index: number, count: number) => void;
  dragStart: (clientX: number) => number;
  dragMove: (clientX: number) => number | null;
  dragEnd: () => number | null;
  focus: () => void;
  dispose: () => void;
}

const padX = 24;
const padTop = 20;
const padBottom = 12;
const stageHeight = 56;
const edge = 18;
const topIntensity = 4;
const sweepSeconds = 1;
const breathDelay = 0.35;
const breathSeconds = 1.1;
const settleMs = 1550;
const fallbackHue = 258;
const fallbackAccent: Rgb = [139, 92, 246];
const sentinel = "#010203";

const tunes: ReadonlyArray<Tune> = [
  { spread: 14, lift: 9, curtain: 0.2, core: 1.8, blur: 7, sweep: 0.45, glow: 0.3 },
  { spread: 22, lift: 12, curtain: 0.24, core: 2, blur: 9, sweep: 0.55, glow: 0.42 },
  { spread: 30, lift: 15, curtain: 0.28, core: 2.2, blur: 11, sweep: 0.68, glow: 0.56 },
  { spread: 38, lift: 18, curtain: 0.33, core: 2.4, blur: 13, sweep: 0.82, glow: 0.72 },
  { spread: 46, lift: 22, curtain: 0.38, core: 2.6, blur: 16, sweep: 1, glow: 0.9 },
];

const strands: ReadonlyArray<Strand> = [
  { freq: 0.034, speed: 0.9, offset: 0 },
  { freq: 0.05, speed: -0.7, offset: 2.1 },
  { freq: 0.027, speed: 1.3, offset: 4 },
];

const pearlStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, var(--brand-accent) 40%, rgb(255 255 255 / 0.6))",
  background:
    "radial-gradient(circle at 34% 26%, rgb(255 255 255 / 0.92), rgb(255 255 255 / 0.42) 38%, rgb(255 255 255 / 0.1) 74%), linear-gradient(150deg, color-mix(in srgb, var(--brand-accent) 28%, rgb(255 255 255 / 0.55)), color-mix(in srgb, var(--brand-accent) 60%, rgb(255 255 255 / 0.12)))",
  backdropFilter: "blur(5px) saturate(1.5)",
  boxShadow:
    "inset 0 -3px 6px color-mix(in srgb, var(--brand-accent) 45%, transparent), inset 0 1px 2px rgb(255 255 255 / 0.6), 0 3px 8px rgb(0 0 0 / 0.3), 0 0 calc(6px + var(--glow) * 16px) color-mix(in srgb, var(--brand-accent) 50%, transparent)",
};

const pearlGlintStyle: CSSProperties = { filter: "blur(0.8px)" };

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function smooth(from: number, to: number, value: number) {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

function rgba(color: Rgb, alpha: number) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function luminance(color: Rgb) {
  return (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;
}

function ramp(gradient: CanvasGradient, stops: ReadonlyArray<Stop>) {
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function hueSat(color: Rgb) {
  const r = color[0] / 255;
  const g = color[1] / 255;
  const b = color[2] / 255;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const d = hi - lo;
  if (d === 0) return { hue: fallbackHue, sat: 70 };
  const sector = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: sector * 60, sat: clamp((d / (1 - Math.abs(hi + lo - 1))) * 100, 60, 95) };
}

function tuneAt(intensity: number): Tune {
  const low = clamp(Math.floor(intensity), 0, tunes.length - 2);
  const from = tunes[low] ?? tunes[0]!;
  const to = tunes[low + 1] ?? from;
  const t = clamp(intensity - low, 0, 1);
  const blend = (key: keyof Tune) => from[key] + (to[key] - from[key]) * t;
  return {
    spread: blend("spread"),
    lift: blend("lift"),
    curtain: blend("curtain"),
    core: blend("core"),
    blur: blend("blur"),
    sweep: blend("sweep"),
    glow: blend("glow"),
  };
}

function intensityAt(index: number, lastIndex: number) {
  return lastIndex > 0 ? (index / lastIndex) * topIntensity : 0;
}

function stopLeft(index: number, lastIndex: number) {
  const share = lastIndex > 0 ? index / lastIndex : 0;
  return `calc(${edge}px + (100% - ${edge * 2}px) * ${share})`;
}

const rgbCache = new Map<string, Rgb | null>();
let sampler: CanvasRenderingContext2D | null | undefined;

function toRgb(css: string): Rgb | null {
  if (css === "") return null;
  const cached = rgbCache.get(css);
  if (cached !== undefined) return cached;
  if (sampler === undefined) {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    sampler = probe.getContext("2d", { willReadFrequently: true });
  }
  let rgb: Rgb | null = null;
  if (sampler) {
    sampler.clearRect(0, 0, 1, 1);
    sampler.fillStyle = sentinel;
    sampler.fillStyle = css;
    if (sampler.fillStyle !== sentinel) {
      sampler.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0, alpha = 0] = sampler.getImageData(0, 0, 1, 1).data;
      if (alpha > 0) rgb = [red, green, blue];
    }
  }
  if (rgbCache.size >= 16) rgbCache.clear();
  rgbCache.set(css, rgb);
  return rgb;
}

function createAuroraEngine(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  thumb: HTMLElement,
): AuroraEngine {
  const ctx = canvas.getContext("2d");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let lastIndex = topIntensity;
  let idx = 0;
  let tune = tuneAt(0);
  let ready = false;
  let width = 0;
  let cw = 0;
  let ch = 0;
  let dpr = 1;
  let hue = fallbackHue;
  let sat = 70;
  let dark = true;
  let ink: Rgb = [255, 255, 255];
  let thumbX = 0;
  let thumbV = 0;
  let target = 0;
  let energy = 0;
  let phase = 0;
  let sweepAge = sweepSeconds;
  let breathAge = breathSeconds;
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
    edge + (width - edge * 2) * (lastIndex > 0 ? index / lastIndex : 0);
  const tint = (h: number, l: number, a: number) =>
    `hsla(${h}, ${sat}%, ${dark ? l : l * 0.72}%, ${a})`;
  const glowOp = (): GlobalCompositeOperation => (dark ? "lighter" : "source-over");
  const gate = () => (dark ? 1 : 0.6);

  function breath() {
    const u = breathAge / breathSeconds;
    return u > 0 && u < 1 ? Math.sin(Math.PI * u ** 0.7) ** 2 : 0;
  }

  function readColors() {
    const style = getComputedStyle(stage);
    const text = toRgb(style.color);
    const accent = toRgb(style.getPropertyValue("--brand-accent").trim()) ?? fallbackAccent;
    const tone = hueSat(accent);
    hue = tone.hue;
    sat = tone.sat;
    dark = text ? luminance(text) > 0.5 : true;
    ink = text ?? [255, 255, 255];
  }

  function ribbon(c: CanvasRenderingContext2D, x0: number, x1: number, b: number) {
    const cy = stageHeight / 2;
    const len = x1 - x0;
    const lift = tune.lift * (1 + 0.35 * b + 0.15 * energy);
    const curtain = tune.curtain * (1 + 0.5 * b);
    const wob = (x: number) => cy + 0.9 * Math.sin(x / 52 + phase * 0.6);
    c.globalCompositeOperation = glowOp();
    for (const [k, strand] of strands.entries()) {
      const h = hue + (k - 1) * tune.spread;
      c.beginPath();
      c.moveTo(x0, wob(x0));
      for (let x = x0; x <= x1; x += 4) {
        const ease = smooth(0, 28, x - x0) * smooth(0, 32, x1 - x);
        const wave = Math.max(0, Math.sin(x * strand.freq + phase * strand.speed + strand.offset));
        c.lineTo(x, wob(x) - lift * ease * wave ** 1.6);
      }
      c.lineTo(x1, wob(x1));
      c.fillStyle = ramp(c.createLinearGradient(0, cy - lift, 0, cy), [
        [0, tint(h, 62, 0)],
        [0.55, tint(h, 62, curtain * 0.2)],
        [1, tint(h, 62, curtain)],
      ]);
      c.shadowColor = tint(h, 62, 0.5);
      c.shadowBlur = 8 * dpr;
      c.fill();
    }
    c.shadowBlur = 0;
    const core = c.createLinearGradient(x0, 0, x1, 0);
    for (let i = 0; i <= 8; i++) {
      const at = (len * i) / 8;
      const shift = tune.spread * Math.sin((x0 + at) / 120 + phase);
      core.addColorStop(i / 8, tint(hue + shift, 76, 0.95 * smooth(0, 22, at)));
    }
    c.beginPath();
    c.moveTo(x0, wob(x0));
    for (let x = x0 + 6; x < x1; x += 6) c.lineTo(x, wob(x));
    c.lineTo(x1, wob(x1));
    c.strokeStyle = core;
    c.globalAlpha = 0.22 + 0.2 * b;
    c.lineWidth = tune.core + 4;
    c.stroke();
    c.globalAlpha = 1;
    c.lineWidth = tune.core;
    c.shadowColor = tint(hue, 64, 0.85);
    c.shadowBlur = tune.blur * (1 + 0.6 * b) * dpr;
    c.stroke();
    c.shadowBlur = 0;
    c.shadowColor = "transparent";
    c.globalCompositeOperation = "source-over";
  }

  function sweep(c: CanvasRenderingContext2D, x0: number, x1: number) {
    const u = sweepAge / sweepSeconds;
    if (u >= 1) return;
    const cy = stageHeight / 2;
    const sx = x0 + (x1 - x0) * (0.5 - Math.cos(Math.PI * u) / 2);
    const gain = tune.sweep * smooth(0, 0.2, u) * (1 - smooth(0.8, 1, u)) * gate();
    const w = 40 + intensity() * 5;
    c.globalCompositeOperation = glowOp();
    c.save();
    c.translate(sx, cy);
    c.scale(1, 0.3);
    c.fillStyle = ramp(c.createRadialGradient(0, 0, 0, 0, 0, w), [
      [0, tint(hue + 12, 90, 0.85 * gain)],
      [0.4, tint(hue, 80, 0.3 * gain)],
      [1, tint(hue, 70, 0)],
    ]);
    c.fillRect(-w, -w, w * 2, w * 2);
    c.restore();
    c.strokeStyle = ramp(c.createLinearGradient(sx - w * 0.7, 0, sx + w * 0.7, 0), [
      [0, tint(hue, 92, 0)],
      [0.5, tint(hue + 12, 92, gain)],
      [1, tint(hue, 92, 0)],
    ]);
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(Math.max(x0, sx - w * 0.7), cy);
    c.lineTo(Math.min(x1, sx + w * 0.7), cy);
    c.stroke();
    c.globalCompositeOperation = "source-over";
  }

  function halo(c: CanvasRenderingContext2D, b: number) {
    if (b < 0.01) return;
    const cy = stageHeight / 2;
    const radius = 24 + 6 * b;
    const power = b * gate();
    c.globalCompositeOperation = glowOp();
    c.fillStyle = ramp(c.createRadialGradient(thumbX, cy, 0, thumbX, cy, radius), [
      [0, tint(hue, 80, 0.5 * power)],
      [0.5, tint(hue, 70, 0.2 * power)],
      [1, tint(hue, 65, 0)],
    ]);
    c.fillRect(thumbX - radius, cy - radius, radius * 2, radius * 2);
    c.globalCompositeOperation = "source-over";
  }

  function paint(c: CanvasRenderingContext2D) {
    const b = breath();
    const x0 = stopX(0);
    const cy = stageHeight / 2;
    c.setTransform(dpr, 0, 0, dpr, padX * dpr, padTop * dpr);
    c.clearRect(-padX, -padTop, cw, ch);
    c.lineCap = "round";
    c.lineJoin = "round";
    if (thumbX - x0 > 2) {
      ribbon(c, x0, thumbX, b);
      sweep(c, x0, thumbX);
    }
    halo(c, b);
    for (let i = 0; i <= lastIndex; i++) {
      const x = stopX(i);
      if (Math.abs(x - thumbX) < 14) continue;
      const lit = x < thumbX;
      c.fillStyle = lit ? tint(hue, 88, 0.9) : rgba(ink, 0.28);
      c.beginPath();
      c.arc(x, cy, lit ? 1.8 : 2, 0, Math.PI * 2);
      c.fill();
    }
  }

  function render() {
    if (!ready) return;
    thumb.style.transform = `translate3d(${thumbX}px, 0, 0)`;
    if (ctx && width > 0) paint(ctx);
  }

  function settle() {
    thumbX = target;
    thumbV = 0;
    energy = 0;
    sweepAge = sweepSeconds;
    breathAge = breathSeconds;
    render();
  }

  function measure() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = stage.clientWidth;
    cw = width + padX * 2;
    ch = padTop + stageHeight + padBottom;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.left = `${-padX}px`;
    canvas.style.top = `${-padTop}px`;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
  }

  function resize() {
    measure();
    if (!dragging) target = stopX(idx);
    settle();
  }

  function step(dt: number) {
    thumbV += (380 * (target - thumbX) - 38 * thumbV) * dt;
    thumbX += thumbV * dt;
    energy = Math.max(energy * Math.exp(-dt * 2.4), dragging ? 0.6 : 0);
    phase += dt * 1.6 * energy;
    sweepAge = Math.min(sweepAge + dt, sweepSeconds);
    breathAge = Math.min(breathAge + dt, breathSeconds);
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

  function kick() {
    if (calm()) return;
    until = Math.max(until, performance.now() + settleMs);
    if (raf) return;
    readColors();
    if (Math.min(2, window.devicePixelRatio || 1) !== dpr) measure();
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function pulse() {
    const b = breath();
    energy = 1;
    if (sweepAge > sweepSeconds * 0.75) sweepAge = 0;
    breathAge =
      b > 0.02 ? (Math.asin(Math.sqrt(b)) / Math.PI) ** (1 / 0.7) * breathSeconds : -breathDelay;
    kick();
  }

  function pointerTo(clientX: number) {
    if (Math.abs(clientX - startX) > 3) free = true;
    const span = width - edge * 2;
    const x = clamp(clientX - stageLeft, stopX(0), stopX(lastIndex));
    if (lastIndex > 0 && span > 0) {
      dragIndex = clamp(Math.round(((x - edge) / span) * lastIndex), 0, lastIndex);
    }
    target = free && !calm() ? x : stopX(dragIndex);
    kick();
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
      idx = next;
      tune = tuneAt(intensity());
      if (!dragging) target = stopX(idx);
      if (calm()) {
        settle();
        return;
      }
      pulse();
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
      else kick();
      return dragIndex;
    },
    focus() {
      stage.focus({ preventScroll: true });
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      stopResize();
      stopTheme();
    },
  };
}

export function AuroraEffortSlider({
  options,
  value,
  label,
  disabled,
  onPreview,
  onCommit,
}: EffortSliderVariantProps) {
  const engineRef = useRef<AuroraEngine | null>(null);
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
    const engine = createAuroraEngine(stage, canvas, thumb);
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

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const engine = engineRef.current;
    if (disabled || !engine || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onPreview(engine.dragStart(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const index = engineRef.current?.dragMove(event.clientX);
    if (index !== null && index !== undefined) onPreview(index);
  };

  const endDrag = () => {
    const index = engineRef.current?.dragEnd();
    if (index === null || index === undefined) return;
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
    next = Math.min(lastIndex, Math.max(0, next));
    if (next !== value) onCommit(next);
  };

  const chooseLevel = (index: number) => {
    if (index !== value) onCommit(index);
    engineRef.current?.focus();
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
          "relative h-14 w-full touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
          disabled
            ? "cursor-not-allowed opacity-50"
            : dragging
              ? "cursor-grabbing"
              : "cursor-pointer",
        )}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-4 top-1/2 h-0.75 -translate-y-1/2 rounded-full bg-foreground/10" />
          <canvas ref={canvasRef} className="absolute" />
          <div ref={thumbRef} className="absolute -left-3 top-4 size-6 will-change-transform">
            <div
              className={cn(
                "relative size-full rounded-full transition-[scale,box-shadow] duration-300 ease-out motion-reduce:transition-none",
                dragging && "scale-110",
              )}
              style={pearlStyle}
            >
              <span
                className="absolute left-1.25 top-0.75 h-1 w-2 -rotate-30 rounded-full bg-white/85"
                style={pearlGlintStyle}
              />
            </div>
          </div>
        </div>
      </div>

      {levelCount > 1 ? (
        <div className="relative h-7.5" aria-hidden="true">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => chooseLevel(index)}
              className={cn(
                "absolute top-0 h-7.5 min-w-14 -translate-x-1/2 whitespace-nowrap px-1 text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none",
                index === value
                  ? "text-brand"
                  : "text-muted-foreground enabled:hover:text-foreground",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
              style={{ left: stopLeft(index, lastIndex) }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
