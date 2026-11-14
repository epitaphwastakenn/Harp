import { describe, expect, it } from "@effect/vitest";

import { analyzeImage, composeOnGround, displayPng, repeatTwoByTwo } from "./imagePixelChecks.ts";
import { decodePng, encodePng } from "./png.ts";

const build = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
};

const glow = (spread: number) =>
  build(64, 64, (x, y) => {
    const radius = Math.hypot(x - 31.5, y - 31.5);
    const alpha = Math.exp(-((radius / spread) ** 2));
    return [255, 255, 255, Math.round(alpha * 255)];
  });

describe("analyzeImage", () => {
  it("accepts a soft glow on a transparent background", () => {
    const facts = analyzeImage(glow(12), { purpose: "particle", transparentRequested: true });
    expect(facts.hasAlphaChannel).toBe(true);
    expect(facts.backgroundTransparent).toBe(true);
    expect(facts.borderBleed).toBe(0);
    expect(facts.alphaCoverage).toBeGreaterThan(0.2);
    expect(facts.alphaCoverage).toBeLessThan(0.6);
    expect(facts.sharpness).toBe("soft");
    expect(facts.brightness).toBe(1);
    expect(facts.saturation).toBe(0);
    expect(facts.warnings).toEqual([]);
  });

  it("flags edge bleed when the glow reaches the border", () => {
    const facts = analyzeImage(glow(60), { purpose: "particle", transparentRequested: false });
    expect(facts.borderBleed).toBeGreaterThan(0.5);
    expect(facts.warnings.some((warning) => warning.startsWith("Edge bleed"))).toBe(true);
  });

  it("flags edge bleed on an opaque particle with a bright border", () => {
    const facts = analyzeImage(
      build(32, 32, () => [200, 200, 200, 255]),
      { purpose: "particle", transparentRequested: false },
    );
    expect(facts.hasAlphaChannel).toBe(false);
    expect(facts.warnings.some((warning) => warning.startsWith("Edge bleed"))).toBe(true);
  });

  it("says when a requested transparent background came back opaque", () => {
    const facts = analyzeImage(
      build(32, 32, () => [10, 10, 10, 255]),
      { purpose: "icon", transparentRequested: true },
    );
    expect(facts.backgroundTransparent).toBe(false);
    expect(facts.warnings.join(" ")).toContain("no alpha channel");
  });

  it("measures saturation and brightness of visible pixels only", () => {
    const facts = analyzeImage(
      build(16, 16, (x) => (x < 8 ? [255, 0, 0, 255] : [0, 255, 0, 0])),
      { purpose: "decal", transparentRequested: false },
    );
    expect(facts.saturation).toBe(1);
    expect(facts.brightness).toBeCloseTo(0.213, 2);
    expect(facts.alphaCoverage).toBe(0.5);
  });

  it("calls hard edges crisp", () => {
    const facts = analyzeImage(
      build(32, 32, (x, y) =>
        ((x >> 2) + (y >> 2)) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
      ),
      { purpose: "decal", transparentRequested: false },
    );
    expect(facts.sharpness).toBe("crisp");
  });

  it("passes a tile whose edges continue and fails a ramp", () => {
    const wrapping = analyzeImage(
      build(64, 64, (x, y) => {
        const value = Math.round(
          128 + 90 * Math.sin((2 * Math.PI * x) / 64) * Math.cos((2 * Math.PI * y) / 64),
        );
        return [value, value, value, 255];
      }),
      { purpose: "tile", transparentRequested: false },
    );
    expect(wrapping.seamless).toBe(true);
    const ramp = analyzeImage(
      build(64, 64, (x) => [Math.round((x / 63) * 255), 0, 0, 255]),
      { purpose: "tile", transparentRequested: false },
    );
    expect(ramp.seamLeftRight).toBeGreaterThan(0.2);
    expect(ramp.seamTopBottom).toBe(0);
    expect(ramp.seamless).toBe(false);
    expect(ramp.warnings.some((warning) => warning.includes("wrap"))).toBe(true);
  });
});

describe("display images", () => {
  it("composites transparency onto the ground", () => {
    const out = composeOnGround(
      build(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [255, 0, 0, 0])),
      [10, 20, 30],
    );
    expect([...out.data]).toEqual([255, 0, 0, 255, 10, 20, 30, 255]);
  });

  it("repeats a tile 2x2", () => {
    const tiled = repeatTwoByTwo(build(2, 2, (x, y) => [x * 100, y * 100, 0, 255]));
    expect(tiled.width).toBe(4);
    expect(tiled.height).toBe(4);
    const at = (x: number, y: number) => [
      ...tiled.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4),
    ];
    expect(at(3, 3)).toEqual([100, 100, 0, 255]);
    expect(at(2, 2)).toEqual([0, 0, 0, 255]);
  });

  it("shows a particle on a dark ground and a tile repeated", () => {
    const image = glow(12);
    const original = encodePng(image.data, 64, 64);
    const particle = decodePng(displayPng(image, original, "particle").png);
    expect(particle.data[3]).toBe(255);
    expect(particle.data[0]).toBeLessThan(40);
    expect(decodePng(displayPng(image, original, "tile").png).width).toBe(128);
    expect(displayPng(image, original, "icon").png).toBe(original);
  });
});
