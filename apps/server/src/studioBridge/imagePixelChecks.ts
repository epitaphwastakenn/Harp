import { downscaleRgba, encodePng } from "./png.ts";

export type ImagePurpose = "particle" | "icon" | "decal" | "tile" | "ui";

export interface Rgba {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ImageFacts {
  readonly width: number;
  readonly height: number;
  readonly hasAlphaChannel: boolean;
  readonly alphaCoverage: number;
  readonly opaqueFraction: number;
  readonly backgroundTransparent: boolean;
  readonly borderBleed: number;
  readonly borderMaxAlpha: number;
  readonly borderLuma: number;
  readonly brightness: number;
  readonly saturation: number;
  readonly edgeSharpness: number;
  readonly sharpness: "flat" | "soft" | "medium" | "crisp";
  readonly seamLeftRight?: number | undefined;
  readonly seamTopBottom?: number | undefined;
  readonly seamless?: boolean | undefined;
  readonly warnings: ReadonlyArray<string>;
}

const visibleAlpha = 8;
const round = (value: number, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const borderIndices = (width: number, height: number): ReadonlyArray<number> => {
  const out: number[] = [];
  for (let x = 0; x < width; x += 1) out.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y += 1) out.push(y * width, y * width + width - 1);
  return out;
};

const luma = (data: Uint8Array, pixel: number) =>
  (0.2126 * data[pixel * 4]! + 0.7152 * data[pixel * 4 + 1]! + 0.0722 * data[pixel * 4 + 2]!) / 255;

const premultipliedLuma = (data: Uint8Array, pixel: number) =>
  luma(data, pixel) * (data[pixel * 4 + 3]! / 255);

const saturationOf = (data: Uint8Array, pixel: number) => {
  const r = data[pixel * 4]!;
  const g = data[pixel * 4 + 1]!;
  const b = data[pixel * 4 + 2]!;
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};

/** Mean absolute RGB difference (0-1) between two pixel lines given as index lists. */
const lineDifference = (
  data: Uint8Array,
  first: ReadonlyArray<number>,
  second: ReadonlyArray<number>,
) => {
  let sum = 0;
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i]! * 4;
    const b = second[i]! * 4;
    const weight = Math.min(data[a + 3]!, data[b + 3]!) / 255;
    sum +=
      (Math.abs(data[a]! - data[b]!) +
        Math.abs(data[a + 1]! - data[b + 1]!) +
        Math.abs(data[a + 2]! - data[b + 2]!)) *
      weight;
  }
  return sum / (first.length * 3 * 255);
};

const column = (width: number, height: number, x: number) =>
  Array.from({ length: height }, (_, y) => y * width + x);
const row = (width: number, y: number) => Array.from({ length: width }, (_, x) => y * width + x);

const seamOf = (data: Uint8Array, width: number, height: number) => {
  const horizontalSeam = lineDifference(
    data,
    column(width, height, 0),
    column(width, height, width - 1),
  );
  const verticalSeam = lineDifference(data, row(width, 0), row(width, height - 1));
  const sampleSteps = Math.min(width - 1, 32);
  let horizontalBase = 0;
  for (let step = 0; step < sampleSteps; step += 1) {
    const x = Math.floor((step * (width - 2)) / Math.max(sampleSteps - 1, 1));
    horizontalBase += lineDifference(data, column(width, height, x), column(width, height, x + 1));
  }
  horizontalBase /= Math.max(sampleSteps, 1);
  const rowSteps = Math.min(height - 1, 32);
  let verticalBase = 0;
  for (let step = 0; step < rowSteps; step += 1) {
    const y = Math.floor((step * (height - 2)) / Math.max(rowSteps - 1, 1));
    verticalBase += lineDifference(data, row(width, y), row(width, y + 1));
  }
  verticalBase /= Math.max(rowSteps, 1);
  const limit = (base: number) => base * 1.6 + 0.02;
  return {
    leftRight: horizontalSeam,
    topBottom: verticalSeam,
    seamless: horizontalSeam <= limit(horizontalBase) && verticalSeam <= limit(verticalBase),
  };
};

type Sharpness = ImageFacts["sharpness"];

const sharpnessOf = (
  data: Uint8Array,
  width: number,
  height: number,
): { readonly value: number; readonly label: Sharpness } => {
  const bins = new Uint32Array(256);
  let counted = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const here = premultipliedLuma(data, y * width + x);
      const gradient = Math.max(
        Math.abs(here - premultipliedLuma(data, y * width + x + 1)),
        Math.abs(here - premultipliedLuma(data, (y + 1) * width + x)),
      );
      bins[Math.min(255, Math.floor(gradient * 255))]! += 1;
      counted += 1;
    }
  }
  if (counted === 0) return { value: 0, label: "flat" };
  const target = counted * 0.01;
  let seen = 0;
  let p99 = 0;
  for (let bin = 255; bin >= 0; bin -= 1) {
    seen += bins[bin]!;
    if (seen >= target) {
      p99 = (bin + 1) / 255;
      break;
    }
  }
  const label: Sharpness =
    p99 < 0.04 ? "flat" : p99 < 0.1 ? "soft" : p99 < 0.25 ? "medium" : "crisp";
  return { value: p99, label };
};

export const analyzeImage = (
  image: Rgba,
  options: { readonly purpose: ImagePurpose; readonly transparentRequested: boolean },
): ImageFacts => {
  const { data, width, height } = image;
  const total = width * height;
  let hasAlphaChannel = false;
  let visible = 0;
  let opaque = 0;
  let lumaSum = 0;
  let saturationSum = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    const alpha = data[pixel * 4 + 3]!;
    if (alpha < 255) hasAlphaChannel = true;
    if (alpha > visibleAlpha) {
      visible += 1;
      lumaSum += luma(data, pixel);
      saturationSum += saturationOf(data, pixel);
    }
    if (alpha >= 250) opaque += 1;
  }
  const border = borderIndices(width, height);
  let borderVisible = 0;
  let borderMaxAlpha = 0;
  let borderLuma = 0;
  for (const pixel of border) {
    const alpha = data[pixel * 4 + 3]!;
    if (alpha > visibleAlpha) borderVisible += 1;
    if (alpha > borderMaxAlpha) borderMaxAlpha = alpha;
    borderLuma += premultipliedLuma(data, pixel);
  }
  const borderBleed = borderVisible / border.length;
  borderLuma /= border.length;
  const alphaCoverage = visible / total;
  const backgroundTransparent = hasAlphaChannel && borderBleed <= 0.02 && alphaCoverage < 0.98;
  const sharp = sharpnessOf(data, width, height);
  const seam = options.purpose === "tile" ? seamOf(data, width, height) : undefined;

  const warnings: string[] = [];
  if (options.transparentRequested && !backgroundTransparent) {
    warnings.push(
      hasAlphaChannel
        ? "Transparent background requested but the border is not clear: the image has opaque or semi-opaque pixels at its edges."
        : "Transparent background requested but the image has no alpha channel (the model ignored it). Ask for a plain black background and use it additively, or choose a provider that outputs transparency.",
    );
  }
  if (options.purpose === "particle") {
    const bleeding = hasAlphaChannel ? borderMaxAlpha > visibleAlpha : borderLuma > 0.05;
    if (bleeding) {
      warnings.push(
        "Edge bleed: the glow or shape touches the image border, so the particle shows a visible square edge. Regenerate with more empty margin.",
      );
    }
  }
  if (seam !== undefined && !seam.seamless) {
    warnings.push(
      "The tile does not wrap cleanly: its opposite edges differ more than neighbouring pixels do. Look at the 2x2 sheet for visible seams.",
    );
  }
  if (sharp.label === "flat" && alphaCoverage > 0) {
    warnings.push("The image is almost featureless (no real edges or gradients).");
  }
  if (alphaCoverage < 0.01) warnings.push("Almost nothing is visible: alpha coverage is under 1%.");

  return {
    width,
    height,
    hasAlphaChannel,
    alphaCoverage: round(alphaCoverage),
    opaqueFraction: round(opaque / total),
    backgroundTransparent,
    borderBleed: round(borderBleed),
    borderMaxAlpha,
    borderLuma: round(borderLuma),
    brightness: round(visible === 0 ? 0 : lumaSum / visible),
    saturation: round(visible === 0 ? 0 : saturationSum / visible),
    edgeSharpness: round(sharp.value),
    sharpness: sharp.label,
    ...(seam === undefined
      ? {}
      : {
          seamLeftRight: round(seam.leftRight),
          seamTopBottom: round(seam.topBottom),
          seamless: seam.seamless,
        }),
    warnings,
  };
};

/** Alpha-composites straight RGBA over a flat colour; the result is opaque. */
export const composeOnGround = (
  image: Rgba,
  ground: readonly [number, number, number] = [18, 18, 22],
): Rgba => {
  const out = new Uint8Array(image.data.length);
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const alpha = image.data[pixel * 4 + 3]! / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      out[pixel * 4 + channel] = Math.round(
        image.data[pixel * 4 + channel]! * alpha + ground[channel]! * (1 - alpha),
      );
    }
    out[pixel * 4 + 3] = 255;
  }
  return { data: out, width: image.width, height: image.height };
};

/** The image repeated 2x2 with no gap, so seams show. */
export const repeatTwoByTwo = (image: Rgba): Rgba => {
  const width = image.width * 2;
  const height = image.height * 2;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = ((y % image.height) * image.width + (x % image.width)) * 4;
      out.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { data: out, width, height };
};

const maxDisplaySide = 768;
const maxRawDisplayBytes = 1_500_000;

const fitForDisplay = (image: Rgba, side: number): Rgba => {
  const factor = Math.ceil(Math.max(image.width, image.height) / side);
  return factor <= 1 ? image : downscaleRgba(image.data, image.width, image.height, factor);
};

/**
 * The PNG the agent looks at: glows and particles on a dark ground, tiles repeated 2x2 so seams
 * show, anything else as generated. Large results are scaled down.
 */
export const displayPng = (
  image: Rgba,
  originalPng: Buffer,
  purpose: ImagePurpose,
): { readonly png: Buffer; readonly note: string } => {
  if (purpose === "particle") {
    const dark = fitForDisplay(composeOnGround(image), maxDisplaySide);
    return {
      png: encodePng(dark.data, dark.width, dark.height),
      note: "composited on a dark ground",
    };
  }
  if (purpose === "tile") {
    const tiled = repeatTwoByTwo(fitForDisplay(composeOnGround(image), maxDisplaySide / 2));
    return { png: encodePng(tiled.data, tiled.width, tiled.height), note: "shown tiled 2x2" };
  }
  if (originalPng.length <= maxRawDisplayBytes) return { png: originalPng, note: "as generated" };
  const small = fitForDisplay(composeOnGround(image), maxDisplaySide);
  return { png: encodePng(small.data, small.width, small.height), note: "scaled down" };
};
