import { useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import type { EffortSliderVariantProps } from "./types";

type Rgb = readonly [number, number, number];
type Stream = {
  x: number;
  span: number;
  speed: number;
  phase: number;
  freq: number;
  amp: number;
  size: number;
  age: number;
  focus: number;
  dir: number;
};
type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  age: number;
};
type Ring = { x: number; age: number; dur: number; radius: number };
type View = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rail: HTMLElement;
  reduced: MediaQueryList;
};

const tau = Math.PI * 2;
const padX = 14;
const padY = 44;
const edge = 22;
const commitGlowMs = 600;
const dragGlowMs = 900;
const tailLimitMs = 900;
const white: Rgb = [255, 255, 255];
const fallbackAccent: Rgb = [139, 92, 246];
const sentinel = "#010203";
const tierTable = {
  rate: [30, 60, 100, 150, 220],
  speed: [170, 230, 300, 380, 480],
  orb: [7.5, 8.5, 9.5, 10.5, 12],
  halo: [28, 35, 43, 52, 60],
  spread: [5, 8, 11, 14, 18],
  burst: [8, 14, 24, 40, 72],
  heat: [0.1, 0.25, 0.4, 0.6, 0.85],
  size: [1.1, 1.3, 1.5, 1.7, 2],
  glow: [0.3, 0.4, 0.5, 0.62, 0.8],
};
type Tier = { [Key in keyof typeof tierTable]: number };
const tierKeys = Object.keys(tierTable) as Array<keyof Tier>;
const recoilFrames = [
  { transform: "translate(0, 0)" },
  { transform: "translate(-1.5px, 1px)" },
  { transform: "translate(1px, -1px)" },
  { transform: "translate(0, 0)" },
];
const trailLayers = [
  [2.2, 0.18],
  [1, 1],
] as const;
const flareAxes = [
  [1, 0, 3.8],
  [0, 1, 3],
] as const;
const dashedRings = [
  [2.2, 1.3, 5, 0.55, []],
  [3.2, 0.8, 10, 0.45, [3, 5]],
] as const;
const canvasStyle = {
  left: -padX,
  top: -padY,
  width: `calc(100% + ${padX * 2}px)`,
  height: `calc(100% + ${padY * 2}px)`,
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const rgba = (color: Rgb, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
const luminance = (color: Rgb) => (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;
const mix = (color: Rgb, to: number, amount: number): Rgb => [
  Math.round(color[0] + (to - color[0]) * amount),
  Math.round(color[1] + (to - color[1]) * amount),
  Math.round(color[2] + (to - color[2]) * amount),
];

const rgbCache = new Map<string, Rgb | null>();
let sampler: CanvasRenderingContext2D | null = null;

function toRgb(css: string): Rgb | null {
  if (css === "") return null;
  const cached = rgbCache.get(css);
  if (cached !== undefined) return cached;
  if (!sampler) {
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
  rgbCache.set(css, rgb);
  return rgb;
}

function tierAt(position: number) {
  const q = clamp(position, 0, 4);
  const index = Math.min(3, Math.floor(q));
  const tier = {} as Tier;
  for (const key of tierKeys) {
    const row = tierTable[key];
    const from = row[index]!;
    tier[key] = from + (row[index + 1]! - from) * (q - index);
  }
  return tier;
}

function circle(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  paint: "fill" | "stroke",
) {
  c.beginPath();
  c.arc(x, y, radius, 0, tau);
  if (paint === "fill") c.fill();
  else c.stroke();
}

function segment(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function ramp(gradient: CanvasGradient, ...stops: ReadonlyArray<readonly [number, string]>) {
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function createCometEngine(initialValue: number, initialCount: number) {
  const geo = { width: 0, height: 0, x0: 0, step: 1, cy: 0, dpr: 1 };
  const palette = { acc: fallbackAccent, dark: true };
  const state = {
    value: initialValue,
    count: initialCount,
    x: 0,
    v: 0,
    target: 0,
    dragging: false,
    focused: false,
    pending: false,
    until: 0,
    energy: 0,
    emit: 0,
    raf: 0,
    last: 0,
  };
  const streams: Array<Stream> = [];
  const sparks: Array<Spark> = [];
  const rings: Array<Ring> = [];
  let view: View | null = null;

  const stops = () => Math.max(1, state.count - 1);
  const stopX = (index: number) => geo.x0 + index * geo.step;
  const lastX = () => stopX(Math.max(0, state.count - 1));
  const trackEnd = () => stopX(stops());
  const progress = (x: number) => clamp((x - geo.x0) / (geo.step * stops()), 0, 1) * 4;
  const indexAt = (x: number) =>
    clamp(Math.round((x - geo.x0) / geo.step), 0, Math.max(0, state.count - 1));

  function readPalette(v: View) {
    const style = getComputedStyle(v.rail);
    const text = toRgb(style.color);
    palette.acc = toRgb(style.getPropertyValue("--brand-accent").trim()) ?? text ?? fallbackAccent;
    palette.dark = text ? luminance(text) > 0.5 : true;
  }

  function draw() {
    const v = view;
    if (!v) return;
    const c = v.ctx;
    const { acc, dark } = palette;
    const lift = (amount: number) => mix(acc, dark ? 255 : 0, dark ? amount : amount * 0.35);
    const glowOp = dark ? "lighter" : "source-over";
    const p = progress(state.x);
    const t = tierAt(p);
    const e = state.energy;
    const light = lift(0.55);
    const lightS = rgba(light, 1);
    const accS = rgba(acc, 1);
    const hotS = rgba(lift(0.45 + 0.45 * t.heat), 1);
    const ox = state.x;
    const cy = geo.cy;
    const r = t.orb * (1 + 0.1 * e);

    c.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    c.clearRect(0, 0, geo.width, geo.height);
    c.lineCap = "round";
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    c.strokeStyle = rgba(acc, 0.16);
    c.lineWidth = 4;
    segment(c, geo.x0, cy, trackEnd(), cy);

    const trailStart = geo.x0 - 8;
    if (ox - trailStart > 4) {
      const halfWidth = 1.4 + t.orb * 0.2 * (1 + 0.4 * e);
      const alpha = (0.36 + 0.34 * e) * (0.6 + 0.4 * t.glow);
      c.globalCompositeOperation = glowOp;
      for (const [scale, weight] of trailLayers) {
        const gradient = c.createLinearGradient(trailStart, 0, ox, 0);
        c.fillStyle = ramp(
          gradient,
          [0, rgba(acc, 0)],
          [0.65, rgba(acc, alpha * weight * 0.3)],
          [1, rgba(light, alpha * weight)],
        );
        c.beginPath();
        c.moveTo(trailStart, cy);
        c.lineTo(ox, cy - halfWidth * scale);
        c.lineTo(ox, cy + halfWidth * scale);
        c.fill();
      }
    }

    c.globalCompositeOperation = "source-over";
    for (let i = 0; i < state.count; i++) {
      const lit = stopX(i) <= ox + 1;
      c.fillStyle = lit ? rgba(light, 0.9) : rgba(acc, 0.35);
      circle(c, stopX(i), cy, lit ? 2.6 : 2.2, "fill");
    }

    c.globalCompositeOperation = glowOp;
    for (const spark of sparks) {
      const fade = 1 - spark.age / spark.life;
      c.globalAlpha = fade * fade;
      c.fillStyle = hotS;
      circle(c, spark.x, spark.y, spark.size * (0.5 + fade * 0.5), "fill");
    }
    for (const stream of streams) {
      const f = stream.focus;
      const y =
        cy +
        Math.sin(stream.phase + stream.age * stream.freq) *
          stream.amp *
          (0.3 + 0.7 * (1 - f) ** 0.8);
      c.globalAlpha =
        Math.min(1, stream.age * 9) * Math.min(1, (0.6 - stream.age) * 5) * (0.2 + 0.4 * f);
      c.strokeStyle = f > 0.6 ? lightS : accS;
      c.lineWidth = stream.size * (0.8 + 0.6 * f);
      segment(c, stream.x, y, stream.x - stream.dir * stream.speed * (1 + 1.2 * f) * 0.035, y);
    }
    for (const ring of rings) {
      if (ring.age < 0) continue;
      const u = ring.age / ring.dur;
      c.globalAlpha = (1 - u) * (1 - u) * 0.8;
      c.strokeStyle = lightS;
      c.lineWidth = 2 * (1 - u) + 0.5;
      circle(c, ring.x, cy, r + (ring.radius - r) * (1 - (1 - u) ** 2), "stroke");
    }

    c.globalAlpha = 1;
    const haloRadius = t.halo * (1 + 0.15 * e);
    const haloAlpha = Math.min(1, (0.2 + 0.5 * t.glow) * (1 + 0.5 * e));
    const halo = c.createRadialGradient(ox, cy, 0, ox, cy, haloRadius);
    c.fillStyle = ramp(
      halo,
      [0, rgba(light, haloAlpha)],
      [0.3, rgba(acc, haloAlpha * 0.45)],
      [1, rgba(acc, 0)],
    );
    circle(c, ox, cy, haloRadius, "fill");

    const flare = clamp(p - 3, 0, 1);
    if (flare > 0) {
      for (const [dx, dy, length] of flareAxes) {
        const reach = r * length * (0.5 + 0.5 * flare) * (1 + 0.35 * e);
        const gradient = c.createLinearGradient(
          ox - dx * reach,
          cy - dy * reach,
          ox + dx * reach,
          cy + dy * reach,
        );
        c.strokeStyle = ramp(
          gradient,
          [0, rgba(light, 0)],
          [0.5, rgba(light, 0.75 * flare)],
          [1, rgba(light, 0)],
        );
        c.lineWidth = 1.4;
        segment(c, ox - dx * reach, cy - dy * reach, ox + dx * reach, cy + dy * reach);
      }
    }

    c.globalCompositeOperation = "source-over";
    for (const [from, range, gap, alpha, dash] of dashedRings) {
      const k = clamp((p - from) / range, 0, 1);
      if (k <= 0) continue;
      c.strokeStyle = rgba(light, alpha * k);
      c.lineWidth = 1.4;
      c.setLineDash(dash);
      c.lineDashOffset = -ox * 0.4;
      circle(c, ox, cy, r + gap * (1 + 0.3 * e), "stroke");
    }
    c.setLineDash([]);

    const body = c.createRadialGradient(ox - r * 0.3, cy - r * 0.35, r * 0.1, ox, cy, r);
    c.fillStyle = ramp(body, [0, rgba(white, 1)], [0.4, hotS], [1, rgba(mix(acc, 0, 0.2), 1)]);
    circle(c, ox, cy, r, "fill");
    c.strokeStyle = rgba(white, 0.7);
    c.lineWidth = 1;
    circle(c, ox, cy, r - 0.5, "stroke");

    if (state.focused) {
      c.strokeStyle = rgba(lift(1), 0.9);
      c.lineWidth = 2;
      circle(c, ox, cy, r + 3, "stroke");
      c.strokeStyle = rgba(acc, 0.5);
      c.lineWidth = 2.5;
      circle(c, ox, cy, r + 6.5, "stroke");
    }
  }

  function measure() {
    const v = view;
    if (!v) return;
    const width = v.rail.clientWidth;
    if (width <= 0) return;
    const height = v.rail.clientHeight;
    geo.dpr = Math.min(2, window.devicePixelRatio || 1);
    geo.width = width + padX * 2;
    geo.height = height + padY * 2;
    v.canvas.width = Math.round(geo.width * geo.dpr);
    v.canvas.height = Math.round(geo.height * geo.dpr);
    geo.x0 = padX + edge;
    geo.step = Math.max(1, (width - edge * 2) / stops());
    geo.cy = padY + height / 2;
    if (!state.dragging) {
      state.x = stopX(state.value);
      state.target = state.x;
    }
    readPalette(v);
    draw();
  }

  function spawnStream(span: number, t: Tier) {
    const far = Math.random() < 0.3 ? 0.85 + Math.random() * 0.15 : Math.random() ** 1.8;
    streams.push({
      x: state.x - (12 + (span - 12) * far),
      span,
      speed: t.speed * (0.6 + Math.random() * 0.6),
      phase: Math.random() * tau,
      freq: 6 + Math.random() * 8,
      amp: t.spread * (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
      size: t.size * (0.7 + Math.random() * 0.6),
      age: 0,
      focus: 0,
      dir: 1,
    });
  }

  function burst(v: View) {
    const p = progress(state.x);
    const t = tierAt(p);
    for (let i = 0; i < Math.round(t.burst); i++) {
      const angle = Math.random() * tau;
      const speed = 60 + Math.random() * (100 + t.speed * 0.5);
      sparks.push({
        x: state.x,
        y: geo.cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.85,
        life: 0.4 + Math.random() * 0.3,
        size: 0.9 + Math.random() * t.size * 1.2,
        age: 0,
      });
    }
    const waves = p > 3.5 ? 2 : p > 2.5 ? 1 : 0;
    for (let j = 0; j < waves; j++) {
      rings.push({ x: state.x, age: -j * 0.1, dur: 0.55, radius: 22 + t.orb * 2 + j * 12 });
    }
    if (p > 3.6) v.rail.animate(recoilFrames, 150);
  }

  function step(v: View, dt: number, now: number) {
    const active = now < state.until;
    const t = tierAt(progress(state.x));
    state.v += ((state.target - state.x) * 520 - state.v * 35) * dt;
    state.x = clamp(state.x + state.v * dt, geo.x0 - 12, lastX() + 12);
    state.energy += ((active ? 1 : 0) - state.energy) * (1 - Math.exp(-dt * (active ? 9 : 6.5)));
    if (!active && state.energy < 0.01) state.energy = 0;
    if (active) {
      state.emit += t.rate * dt;
      const span = Math.max(48, state.x - geo.x0 + 16);
      for (; state.emit >= 1; state.emit--) spawnStream(span, t);
    }
    if (state.pending && !state.dragging && Math.abs(state.target - state.x) < 10) {
      state.pending = false;
      burst(v);
    }
    for (let i = streams.length - 1; i >= 0; i--) {
      const stream = streams[i]!;
      const dx = state.x - stream.x;
      stream.age += dt;
      stream.focus = 1 - Math.min(1, Math.abs(dx) / stream.span);
      stream.dir = Math.sign(dx) || 1;
      stream.x += stream.dir * stream.speed * (1 + 1.8 * stream.focus) * dt;
      if (Math.abs(dx) < t.orb * 0.8 || stream.age > 0.6) {
        streams[i] = streams[streams.length - 1]!;
        streams.pop();
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i]!;
      const drag = Math.exp(-3.4 * dt);
      spark.age += dt;
      spark.vx *= drag;
      spark.vy *= drag;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      if (spark.age > spark.life) {
        sparks[i] = sparks[sparks.length - 1]!;
        sparks.pop();
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i]!;
      ring.age += dt;
      if (ring.age > ring.dur) rings.splice(i, 1);
    }
  }

  function busy(now: number) {
    if (now > state.until + tailLimitMs) return false;
    return (
      state.pending ||
      now < state.until ||
      streams.length > 0 ||
      sparks.length > 0 ||
      rings.length > 0 ||
      state.energy > 0 ||
      Math.abs(state.target - state.x) > 0.2 ||
      Math.abs(state.v) > 1
    );
  }

  function settle() {
    state.x = state.target;
    state.v = 0;
    state.emit = 0;
    state.energy = 0;
    state.pending = false;
    streams.length = 0;
    sparks.length = 0;
    rings.length = 0;
    draw();
  }

  function tick(now: number) {
    const v = view;
    if (!v || v.reduced.matches) {
      state.raf = 0;
      settle();
      return;
    }
    const dt = clamp((now - state.last) / 1000, 0, 0.033);
    state.last = now;
    step(v, dt, now);
    draw();
    if (busy(now)) {
      state.raf = requestAnimationFrame(tick);
      return;
    }
    state.raf = 0;
    settle();
  }

  function wake() {
    const v = view;
    if (!v) return;
    if (v.reduced.matches) {
      settle();
      return;
    }
    if (state.raf) return;
    if (Math.min(2, window.devicePixelRatio || 1) !== geo.dpr) measure();
    readPalette(v);
    state.last = performance.now();
    state.raf = requestAnimationFrame(tick);
  }

  function glowFor(ms: number) {
    state.until = performance.now() + ms;
  }

  function pointerX(clientX: number) {
    const v = view;
    if (!v) return state.target;
    const rect = v.canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? geo.width / rect.width : 1;
    return clamp((clientX - rect.left) * scale, geo.x0, lastX());
  }

  function land(index: number) {
    state.value = index;
    state.target = stopX(index);
    state.pending = true;
    glowFor(commitGlowMs);
    wake();
  }

  return {
    attach(element: HTMLCanvasElement | null) {
      const context = element?.getContext("2d");
      const rail = element?.parentElement;
      if (!element || !context || !rail) return;
      view = {
        canvas: element,
        ctx: context,
        rail,
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)"),
      };
      measure();
      const stopObserving = observeResize(rail, measure);
      return () => {
        stopObserving();
        cancelAnimationFrame(state.raf);
        state.raf = 0;
        view = null;
      };
    },
    sync(value: number, count: number) {
      const index = clamp(value, 0, Math.max(0, count - 1));
      const resized = count !== state.count;
      state.count = count;
      if (resized) {
        state.value = index;
        measure();
        return;
      }
      if (index === state.value) return;
      if (state.dragging) {
        state.value = index;
        return;
      }
      land(index);
    },
    grab(clientX: number) {
      state.dragging = true;
      state.pending = false;
      state.target = pointerX(clientX);
      glowFor(dragGlowMs);
      wake();
      return indexAt(state.target);
    },
    drag(clientX: number) {
      if (!state.dragging) return null;
      state.target = pointerX(clientX);
      glowFor(dragGlowMs);
      wake();
      return indexAt(state.target);
    },
    release() {
      if (!state.dragging) return null;
      state.dragging = false;
      const index = indexAt(state.target);
      land(index);
      return index;
    },
    focus(visible: boolean) {
      state.focused = visible;
      if (!state.raf) draw();
    },
  };
}

export function CometEffortSlider({
  options,
  value,
  label,
  disabled,
  onPreview,
  onCommit,
}: EffortSliderVariantProps) {
  const [engine] = useState(() => createCometEngine(value, options.length));
  const trackRef = useRef<HTMLDivElement>(null);
  const lastIndex = Math.max(0, options.length - 1);

  // oxlint-disable-next-line t3code/react-effect-budget -- the level can change from outside this component (number keys, parent state) and the canvas animation has to start when it does
  useLayoutEffect(() => {
    engine.sync(value, options.length);
  }, [engine, value, options.length]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onPreview(engine.grab(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const index = engine.drag(event.clientX);
    if (index !== null) onPreview(index);
  };

  const endDrag = () => {
    const index = engine.release();
    if (index !== null) onCommit(index);
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
    trackRef.current?.focus({ preventScroll: true });
    if (index !== value) onCommit(index);
  };

  const current = options[value] ?? options[0];

  return (
    <div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={value}
        aria-valuetext={current?.label}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onKeyDown}
        onFocus={(event) => engine.focus(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => engine.focus(false)}
        className={cn(
          "relative h-14 w-full touch-none select-none outline-none",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing",
        )}
      >
        <canvas
          ref={(element) => engine.attach(element)}
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={canvasStyle}
        />
      </div>

      {options.length > 1 ? (
        <div className="relative h-7">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => chooseLevel(index)}
              className={cn(
                "absolute top-0 h-7 min-w-14 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 text-2xs transition-colors duration-150 motion-reduce:transition-none",
                index === value
                  ? "font-semibold text-brand"
                  : "text-muted-foreground enabled:hover:text-foreground",
              )}
              style={{
                left: `calc(${edge}px + (100% - ${edge * 2}px) * ${index} / ${lastIndex})`,
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
