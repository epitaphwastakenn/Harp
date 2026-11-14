import * as NodeZlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** Encodes straight RGBA pixels (row-major, 4 bytes each) as an RGB PNG. */
export const encodePng = (rgba: Uint8Array, width: number, height: number): Buffer => {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = row + 1 + x * 3;
      raw[target] = rgba[source]!;
      raw[target + 1] = rgba[source + 1]!;
      raw[target + 2] = rgba[source + 2]!;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", NodeZlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ]);
};

/** Box-averages RGBA pixels down by an integer factor. */
export const downscaleRgba = (
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
): { readonly data: Uint8Array; readonly width: number; readonly height: number } => {
  const outWidth = Math.max(1, Math.floor(width / factor));
  const outHeight = Math.max(1, Math.floor(height / factor));
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const sums = [0, 0, 0, 0];
      let count = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const sy = y * factor + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < factor; dx += 1) {
          const sx = x * factor + dx;
          if (sx >= width) break;
          const index = (sy * width + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel]! += rgba[index + channel]!;
          count += 1;
        }
      }
      const target = (y * outWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        out[target + channel] = Math.round(sums[channel]! / Math.max(count, 1));
      }
    }
  }
  return { data: out, width: outWidth, height: outHeight };
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_DECODED_PIXELS = 16_000_000;

const channelsOf = (colorType: number): number | undefined =>
  colorType === 0 || colorType === 3
    ? 1
    : colorType === 4
      ? 2
      : colorType === 2
        ? 3
        : colorType === 6
          ? 4
          : undefined;

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decodes a non-interlaced 8-bit PNG (greyscale, greyscale+alpha, RGB, RGBA or palette) to RGBA. */
export const decodePng = (
  bytes: Uint8Array,
): { readonly data: Uint8Array; readonly width: number; readonly height: number } => {
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (source.length < 8 || PNG_SIGNATURE.some((value, index) => source[index] !== value)) {
    throw new Error("Not a PNG: the signature is missing.");
  }
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Buffer | undefined;
  let paletteAlpha: Buffer | undefined;
  const parts: Buffer[] = [];
  let sawHeader = false;
  let sawEnd = false;
  let offset = 8;
  while (offset + 8 <= source.length && !sawEnd) {
    const length = source.readUInt32BE(offset);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length + 4 > source.length) throw new Error(`PNG chunk ${type} is truncated.`);
    const body = source.subarray(start, start + length);
    if (type === "IHDR") {
      if (length !== 13) throw new Error("PNG header is malformed.");
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9]!;
      if (body[8] !== 8) {
        throw new Error(`Unsupported PNG bit depth ${String(body[8])}: only 8-bit images decode.`);
      }
      if (channelsOf(colorType) === undefined) {
        throw new Error(`Unsupported PNG color type ${String(colorType)}.`);
      }
      if (body[12] !== 0) throw new Error("Interlaced PNGs are not supported.");
      if (width === 0 || height === 0 || width * height > MAX_DECODED_PIXELS) {
        throw new Error(`PNG dimensions ${String(width)}x${String(height)} are not supported.`);
      }
      sawHeader = true;
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      paletteAlpha = body;
    } else if (type === "IDAT") {
      parts.push(body);
    } else if (type === "IEND") {
      sawEnd = true;
    }
    offset = start + length + 4;
  }
  if (!sawHeader) throw new Error("PNG has no header chunk.");
  if (parts.length === 0) throw new Error("PNG has no image data.");
  if (colorType === 3 && palette === undefined) throw new Error("Palette PNG has no palette.");

  let raw: Buffer;
  try {
    raw = NodeZlib.inflateSync(Buffer.concat(parts), {
      maxOutputLength: (width * (channelsOf(colorType) ?? 4) + 1) * height,
    });
  } catch (cause) {
    throw new Error(
      `PNG image data is corrupt: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const channels = channelsOf(colorType)!;
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("PNG image data is truncated.");

  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const input = y * (stride + 1) + 1;
    const row = y * stride;
    const above = row - stride;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[input + i]!;
      const left = i >= channels ? pixels[row + i - channels]! : 0;
      const up = y > 0 ? pixels[above + i]! : 0;
      const upLeft = y > 0 && i >= channels ? pixels[above + i - channels]! : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`PNG row ${String(y)} uses unknown filter ${String(filter)}.`);
      }
      pixels[row + i] = result & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const from = index * channels;
    const to = index * 4;
    if (colorType === 6) {
      rgba.set(pixels.subarray(from, from + 4), to);
    } else if (colorType === 2) {
      rgba[to] = pixels[from]!;
      rgba[to + 1] = pixels[from + 1]!;
      rgba[to + 2] = pixels[from + 2]!;
      rgba[to + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      const grey = pixels[from]!;
      rgba[to] = grey;
      rgba[to + 1] = grey;
      rgba[to + 2] = grey;
      rgba[to + 3] = colorType === 4 ? pixels[from + 1]! : 255;
    } else {
      const entry = pixels[from]!;
      if (entry * 3 + 2 >= palette!.length) throw new Error("PNG pixel points past the palette.");
      rgba[to] = palette![entry * 3]!;
      rgba[to + 1] = palette![entry * 3 + 1]!;
      rgba[to + 2] = palette![entry * 3 + 2]!;
      rgba[to + 3] =
        paletteAlpha !== undefined && entry < paletteAlpha.length ? paletteAlpha[entry]! : 255;
    }
  }
  return { data: rgba, width, height };
};

/** Lays RGBA images out row-major in a grid of equal cells, separated by `gap` pixels. */
export const tileRgba = (
  images: ReadonlyArray<{
    readonly data: Uint8Array;
    readonly width: number;
    readonly height: number;
  }>,
  columns: number,
  options: { readonly gap?: number; readonly background?: readonly [number, number, number] } = {},
): { readonly data: Uint8Array; readonly width: number; readonly height: number } => {
  const gap = options.gap ?? 4;
  const background = options.background ?? [24, 24, 24];
  const cols = Math.max(1, Math.min(columns, images.length));
  const rows = Math.max(1, Math.ceil(images.length / cols));
  const cellWidth = Math.max(1, ...images.map((image) => image.width));
  const cellHeight = Math.max(1, ...images.map((image) => image.height));
  const width = cols * cellWidth + (cols + 1) * gap;
  const height = rows * cellHeight + (rows + 1) * gap;
  const out = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    out[index * 4] = background[0];
    out[index * 4 + 1] = background[1];
    out[index * 4 + 2] = background[2];
    out[index * 4 + 3] = 255;
  }
  for (const [index, image] of images.entries()) {
    const originX = gap + (index % cols) * (cellWidth + gap);
    const originY = gap + Math.floor(index / cols) * (cellHeight + gap);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const from = (y * image.width + x) * 4;
        const to = ((originY + y) * width + originX + x) * 4;
        out[to] = image.data[from]!;
        out[to + 1] = image.data[from + 1]!;
        out[to + 2] = image.data[from + 2]!;
        out[to + 3] = 255;
      }
    }
  }
  return { data: out, width, height };
};
