import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { subscribeThemeEpoch } from "~/themeEpoch";
import type { EffortSliderVariantProps } from "./types";

type Rgb = readonly [number, number, number];
type Wave = {
  x: number;
  k: number;
  age: number;
  reach: number;
  life: number;
  amp: number;
  r: number;
  a: number;
  u: number;
};
type View = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rail: HTMLElement;
  reduced: MediaQueryList;
};

const tau = Math.PI * 2;
const padX = 14;
const padY = 18;
const edge = 24;
const overhang = 12;
const half = 3;
const band = 16;
const liftPx = 10;
const gravity = 90;
const tilt = 0.22;
const commitMs = 1500;
const landMs = 1300;
const white: Rgb = [255, 255, 255];
const black: Rgb = [0, 0, 0];
const ink: Rgb = [18, 10, 31];
const fallbackAccent: Rgb = [139, 92, 246];
const sentinel = "#010203";
const sides = [-1, 1] as const;
const tierTable = {
  rings: [2, 2, 3, 3, 3],
  reach: [92, 112, 140, 164, 190],
  life: [0.78, 0.82, 0.86, 0.9, 0.95],
  amp: [0.5, 0.6, 0.7, 0.82, 0.95],
  glow: [0.25, 0.36, 0.48, 0.62, 0.78],
  orb: [7, 7.5, 8, 8.5, 9],
};
type Tier = { [Key in keyof typeof tierTable]: number };
const tierKeys = Object.keys(tierTable) as Array<keyof Tier>;
const canvasStyle = {
  left: -padX,
  top: -padY,
  width: `calc(100% + ${padX * 2}px)`,
  height: `calc(100% + ${padY * 2}px)`,
};
const waterStyle: CSSProperties = { boxShadow: "inset 0 1px 3px rgb(0 0 0 / 0.4)" };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const rgba = (color: Rgb, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
const luminance = (color: Rgb) => (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;
const mix = (color: Rgb, to: Rgb, amount: number): Rgb => [
  Math.round(color[0] + (to[0] - color[0]) * amount),
  Math.round(color[1] + (to[1] - color[1]) * amount),
  Math.round(color[2] + (to[2] - color[2]) * amount),
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
  if (rgbCache.size >= 16) rgbCache.clear();
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

function oval(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  paint: "fill" | "stroke",
) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, tau);
  if (paint === "fill") c.fill();
  else c.stroke();
}

function ramp(gradient: CanvasGradient, ...stops: ReadonlyArray<readonly [number, string]>) {
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function dropPath(c: CanvasRenderingContext2D, r: number, tip: number) {
  const q = tip / 7;
  c.beginPath();
  c.moveTo(0, -r - tip);
  c.bezierCurveTo(r * (0.5523 - 0.43 * q), -r - tip * 0.35, r, -r * 0.5523, r, 0);
  c.arc(0, 0, r, 0, Math.PI);
  c.bezierCurveTo(-r, -r * 0.5523, -r * (0.5523 - 0.43 * q), -r - tip * 0.35, 0, -r - tip);
  c.closePath();
}

function createRippleEngine(initialValue: number, initialCount: number) {
  const geo = { width: 0, height: 0, x0: 0, step: 1, cy: 0, dpr: 1 };
  const palette = { acc: fallbackAccent, dark: true };
  const state = {
    value: initialValue,
    count: initialCount,
    level: (initialValue / Math.max(1, initialCount - 1)) * 4,
    x: 0,
    v: 0,
    target: 0,
    dragging: false,
    focused: false,
    lift: 0,
    fall: 0,
    squash: 0,
    squashV: 0,
    until: 0,
    raf: 0,
    last: 0,
  };
  const waves: Array<Wave> = [];
  let view: View | null = null;

  const stops = () => Math.max(1, state.count - 1);
  const stopX = (index: number) => geo.x0 + index * geo.step;
  const lastX = () => stopX(Math.max(0, state.count - 1));
  const trackEnd = () => stopX(stops());
  const levelOf = (index: number) => (index / stops()) * 4;
  const indexAt = (x: number) =>
    clamp(Math.round((x - geo.x0) / geo.step), 0, Math.max(0, state.count - 1));
  const liftGoal = () => (state.dragging || Math.abs(state.target - state.x) > 10 ? 1 : 0);

  const quiet = () =>
    waves.length === 0 &&
    Math.abs(state.lift - liftGoal()) < 0.002 &&
    Math.abs(state.squash) < 0.003 &&
    Math.abs(state.target - state.x) < 0.2 &&
    Math.abs(state.v) < 1 &&
    Math.abs(levelOf(state.value) - state.level) < 0.004;

  function waveAt(x: number) {
    let sum = 0;
    for (const wave of waves) {
      const d = (Math.abs(x - wave.x) - wave.r) / band;
      sum += wave.a * Math.exp(-d * d);
    }
    return sum;
  }

  function readPalette(v: View) {
    const style = getComputedStyle(v.rail);
    const text = toRgb(style.color);
    palette.acc = toRgb(style.getPropertyValue("--brand-accent").trim()) ?? text ?? fallbackAccent;
    palette.dark = text ? luminance(text) > 0.5 : true;
  }

  function draw() {
    const v = view;
    if (!v || geo.width <= 0) return;
    const c = v.ctx;
    const { acc, dark } = palette;
    const gain = dark ? 1 : 0.6;
    const glowOp = dark ? "lighter" : "source-over";
    const light = mix(acc, dark ? white : black, dark ? 0.5 : 0.2);
    const spark = dark ? mix(light, white, 0.6) : white;
    const pearl = mix(acc, white, 0.5);
    const deep = dark ? mix(acc, ink, 0.45) : mix(acc, white, 0.45);
    const pebble = dark ? white : mix(acc, black, 0.55);
    const floor = dark ? 0.2 : 0.35;
    const t = tierAt(state.level);
    const cy = geo.cy;
    const ox = state.x;
    const xa = geo.x0 - overhang;
    const xb = trackEnd() + overhang;
    const dy = cy - state.lift * liftPx;
    const halo = (color = "transparent", blur = 0) => {
      c.shadowColor = color;
      c.shadowBlur = blur * geo.dpr;
    };

    c.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    c.clearRect(0, 0, geo.width, geo.height);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";

    if (ox - xa > 1) {
      c.beginPath();
      c.roundRect(xa, cy - half, ox - xa, half * 2, half);
      halo(rgba(acc, (0.4 + 0.4 * t.glow) * gain), 6 + 16 * t.glow);
      c.fillStyle = ramp(
        c.createLinearGradient(xa, 0, ox, 0),
        [0, rgba(deep, 1)],
        [0.6, rgba(acc, 1)],
        [1, rgba(light, 1)],
      );
      c.fill();
      halo();
      c.fillStyle = ramp(
        c.createLinearGradient(0, cy - half, 0, cy + half),
        [0, "rgba(255,255,255,0.4)"],
        [0.5, "rgba(255,255,255,0.04)"],
        [1, "rgba(0,0,0,0.2)"],
      );
      c.fill();
    }

    const haloRadius = 26 + 18 * t.glow;
    c.globalCompositeOperation = glowOp;
    c.fillStyle = ramp(
      c.createRadialGradient(ox, cy, 0, ox, cy, haloRadius),
      [0, rgba(light, (0.1 + 0.3 * t.glow) * gain)],
      [1, rgba(acc, 0)],
    );
    c.fillRect(ox - haloRadius, cy - haloRadius, haloRadius * 2, haloRadius * 2);
    c.globalCompositeOperation = "source-over";

    for (let i = 0; i < state.count; i++) {
      const px = stopX(i);
      const lit = clamp((ox - px) / 12 + 0.5, 0, 1);
      const pulse = Math.min(1, waveAt(px) * 2.2);
      const k = Math.max(lit * 0.7, pulse);
      halo(rgba(light, k * 0.9 * gain), 9 * k);
      c.fillStyle = rgba(mix(pebble, spark, lit), Math.min(1, floor + 0.7 * lit + 0.3 * pulse));
      oval(c, px, cy, 3 + pulse, 2.4 + 0.8 * pulse, "fill");
    }
    halo();

    if (waves.length > 0) {
      const fade = ramp(
        c.createLinearGradient(0, 0, geo.width, 0),
        [0, rgba(light, 0)],
        [0.06, rgba(light, 1)],
        [0.94, rgba(light, 1)],
        [1, rgba(light, 0)],
      );
      c.globalCompositeOperation = glowOp;
      for (const wave of waves) {
        if (wave.a < 0.005) continue;
        const bloom = Math.min(1, (wave.r - 6) / 24);
        c.globalAlpha = wave.a * 0.65;
        c.strokeStyle = fade;
        c.lineWidth = 0.6 + 1.2 * (1 - wave.u);
        oval(c, wave.x, cy, wave.r, wave.r * tilt, "stroke");
        c.globalAlpha = 1;
        for (const side of sides) {
          const sx = wave.x + side * wave.r;
          if (sx < xa || sx > xb) continue;
          c.fillStyle = ramp(
            c.createLinearGradient(sx - band, 0, sx + band, 0),
            [0, rgba(light, 0)],
            [0.5, rgba(light, wave.a * bloom * 0.6)],
            [1, rgba(light, 0)],
          );
          oval(c, sx, cy, band, half + 2 * wave.a, "fill");
        }
      }
      c.globalCompositeOperation = "source-over";
    }

    if (state.lift > 0.01) {
      c.fillStyle = rgba(light, 0.14 * state.lift);
      oval(c, ox, cy, 8 + 8 * state.lift, 2.6 + 2.6 * state.lift, "fill");
      c.strokeStyle = rgba(light, 0.45 * state.lift);
      c.lineWidth = 1;
      c.stroke();
    }

    const r = t.orb * (1 + 0.16 * state.lift);
    const stretch = clamp(state.fall / 90, 0, 0.14);
    c.save();
    c.translate(ox, dy);
    c.scale(1 + state.squash - stretch * 0.6, 1 - state.squash + stretch);
    dropPath(c, r, 7 * clamp(state.lift, 0, 1));
    halo(rgba(light, 0.55 + 0.3 * t.glow), 8 + 10 * t.glow);
    c.fillStyle = ramp(
      c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.1),
      [0, rgba(white, 1)],
      [0.45, rgba(pearl, 1)],
      [1, rgba(acc, 1)],
    );
    c.fill();
    halo();
    c.strokeStyle = "rgba(255,255,255,0.75)";
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.8)";
    c.translate(-r * 0.32, -r * 0.3);
    c.rotate(-0.6);
    oval(c, 0, 0, r * 0.26, r * 0.14, "fill");
    c.restore();

    if (state.focused) {
      const ring = mix(acc, dark ? white : black, dark ? 0.85 : 0.4);
      c.strokeStyle = rgba(acc, 0.55);
      c.lineWidth = 3;
      oval(c, ox, dy, 16.5, 16.5, "stroke");
      c.strokeStyle = rgba(ring, 0.85);
      c.lineWidth = 2;
      oval(c, ox, dy, 14, 14, "stroke");
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
    state.level = levelOf(state.value);
    readPalette(v);
    draw();
  }

  function emit(x: number, k: number) {
    const t = tierAt(levelOf(state.value));
    const { reach, life, amp } = t;
    for (let i = 0; i < Math.round(t.rings); i++) {
      waves.push({ x, k: k * (1 - 0.22 * i), age: -i * 0.11, reach, life, amp, r: 0, a: 0, u: 0 });
    }
  }

  function touchdown(now: number) {
    const k = clamp(state.fall / 11, 0.5, 1);
    state.lift = 0;
    state.fall = 0;
    state.squash = 0.24 * k;
    state.squashV = 0;
    state.until = Math.max(state.until, now + landMs);
    emit(state.x, k);
  }

  function step(dt: number, now: number) {
    state.v += ((state.target - state.x) * 520 - state.v * 35) * dt;
    state.x = clamp(state.x + state.v * dt, geo.x0 - overhang, lastX() + overhang);
    state.level += (levelOf(state.value) - state.level) * (1 - Math.exp(-dt * 6));
    if (liftGoal() === 1) {
      state.lift += (1 - state.lift) * (1 - Math.exp(-dt * 16));
      state.fall = 0;
    } else if (state.lift > 0) {
      state.fall += gravity * dt;
      state.lift -= state.fall * dt;
      if (state.lift <= 0) touchdown(now);
    }
    state.squashV += (-220 * state.squash - 16 * state.squashV) * dt;
    state.squash += state.squashV * dt;
    for (let i = waves.length - 1; i >= 0; i--) {
      const wave = waves[i]!;
      wave.age += dt;
      wave.u = Math.max(0, wave.age / wave.life);
      if (wave.u >= 1) {
        waves.splice(i, 1);
        continue;
      }
      wave.r = wave.age > 0 ? 6 + (wave.reach - 6) * (1 - (1 - wave.u) ** 2) : 0;
      wave.a = wave.age > 0 ? wave.k * wave.amp * (1 - wave.u) ** 1.4 : 0;
    }
  }

  function settle() {
    state.x = state.target;
    state.v = 0;
    state.level = levelOf(state.value);
    state.lift = 0;
    state.fall = 0;
    state.squash = 0;
    state.squashV = 0;
    waves.length = 0;
    draw();
  }

  function tick(now: number) {
    const v = view;
    if (!v || v.reduced.matches) {
      state.raf = 0;
      settle();
      return;
    }
    step(clamp((now - state.last) / 1000, 0, 0.033), now);
    state.last = now;
    draw();
    if (quiet()) {
      state.raf = 0;
      if (!state.dragging) settle();
      return;
    }
    if (state.dragging || now < state.until) {
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
    state.until = performance.now() + commitMs;
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
      const stopTheme = subscribeThemeEpoch(() => {
        const v = view;
        if (!v) return;
        readPalette(v);
        if (!state.raf) draw();
      });
      return () => {
        stopObserving();
        stopTheme();
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
      state.target = pointerX(clientX);
      wake();
      return indexAt(state.target);
    },
    drag(clientX: number) {
      if (!state.dragging) return null;
      state.target = pointerX(clientX);
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

export function RippleEffortSlider({
  options,
  value,
  label,
  disabled,
  onPreview,
  onCommit,
}: EffortSliderVariantProps) {
  const [engine] = useState(() => createRippleEngine(value, options.length));
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
        aria-orientation="horizontal"
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
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/10"
          style={waterStyle}
        />
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
                "absolute top-0 h-7 min-w-14 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 text-xs transition-colors duration-150 motion-reduce:transition-none",
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
