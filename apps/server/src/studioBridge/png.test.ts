import * as NodeZlib from "node:zlib";
import { describe, expect, it } from "@effect/vitest";

import { decodePng, downscaleRgba, encodePng, tileRgba } from "./png.ts";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, check]);
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

const buildPng = (input: {
  width: number;
  height: number;
  colorType: number;
  samples: number[];
  filters: number[];
  bitDepth?: number;
  interlace?: number;
  extra?: Buffer[];
}): Buffer => {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[input.colorType]!;
  const stride = input.width * channels;
  const rows: number[] = [];
  for (let y = 0; y < input.height; y += 1) {
    const filter = input.filters[y % input.filters.length]!;
    rows.push(filter);
    for (let i = 0; i < stride; i += 1) {
      const at = (row: number, column: number) =>
        row < 0 || column < 0 ? 0 : input.samples[row * stride + column]!;
      const value = at(y, i);
      const left = at(y, i - channels);
      const up = at(y - 1, i);
      const upLeft = at(y - 1, i - channels);
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth(left, up, upLeft);
      rows.push((value - predicted) & 0xff);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(input.width, 0);
  header.writeUInt32BE(input.height, 4);
  header[8] = input.bitDepth ?? 8;
  header[9] = input.colorType;
  header[12] = input.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(input.extra ?? []),
    chunk("IDAT", NodeZlib.deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const gradient = (count: number) =>
  Array.from({ length: count }, (_, i) => (i * 37 + (i % 5) * 11) & 0xff);

describe("decodePng", () => {
  it("round-trips what encodePng writes", () => {
    const rgba = Uint8Array.from({ length: 5 * 3 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 29) & 0xff,
    );
    expect(decodePng(encodePng(rgba, 5, 3))).toEqual({ data: rgba, width: 5, height: 3 });
  });

  it.each([0, 1, 2, 3, 4])("reverses filter %i on RGBA rows", (filter) => {
    const samples = gradient(6 * 4 * 4);
    const decoded = decodePng(
      buildPng({ width: 6, height: 4, colorType: 6, samples, filters: [filter] }),
    );
    expect(Array.from(decoded.data)).toEqual(samples);
  });

  it("decodes every filter mixed across rows of an RGB image", () => {
    const samples = gradient(7 * 6 * 3);
    const decoded = decodePng(
      buildPng({ width: 7, height: 6, colorType: 2, samples, filters: [1, 2, 3, 4, 0, 4] }),
    );
    expect(decoded.width).toBe(7);
    const expected = Array.from({ length: 7 * 6 }, (_, p) => [
      samples[p * 3],
      samples[p * 3 + 1],
      samples[p * 3 + 2],
      255,
    ]).flat();
    expect(Array.from(decoded.data)).toEqual(expected);
  });

  it("expands greyscale and greyscale with alpha", () => {
    const grey = decodePng(
      buildPng({ width: 2, height: 2, colorType: 0, samples: [10, 20, 30, 40], filters: [4] }),
    );
    expect(Array.from(grey.data)).toEqual([
      10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255,
    ]);
    const alpha = decodePng(
      buildPng({ width: 2, height: 1, colorType: 4, samples: [10, 128, 200, 5], filters: [1] }),
    );
    expect(Array.from(alpha.data)).toEqual([10, 10, 10, 128, 200, 200, 200, 5]);
  });

  it("looks palette entries up with their transparency", () => {
    const palette = chunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0]));
    const transparency = chunk("tRNS", Buffer.from([100]));
    const decoded = decodePng(
      buildPng({
        width: 2,
        height: 1,
        colorType: 3,
        samples: [0, 1],
        filters: [0],
        extra: [palette, transparency],
      }),
    );
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 100, 0, 255, 0, 255]);
  });

  it("explains what it cannot decode", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow(/signature/);
    expect(() =>
      decodePng(
        buildPng({ width: 1, height: 1, colorType: 0, samples: [0], filters: [0], bitDepth: 16 }),
      ),
    ).toThrow(/bit depth 16/);
    expect(() =>
      decodePng(
        buildPng({ width: 1, height: 1, colorType: 0, samples: [0], filters: [0], interlace: 1 }),
      ),
    ).toThrow(/Interlaced/);
    const valid = buildPng({
      width: 4,
      height: 4,
      colorType: 6,
      samples: gradient(64),
      filters: [0],
    });
    expect(() => decodePng(valid.subarray(0, valid.length - 30))).toThrow(/truncated|corrupt/);
  });
});

describe("tileRgba", () => {
  const solid = (value: number, width: number, height: number) => ({
    data: new Uint8Array(width * height * 4).fill(value),
    width,
    height,
  });

  it("places images row-major in a grid with gaps and a background", () => {
    const tiled = tileRgba([solid(10, 2, 2), solid(20, 2, 2), solid(30, 2, 2)], 2, {
      gap: 1,
      background: [0, 0, 0],
    });
    expect([tiled.width, tiled.height]).toEqual([7, 7]);
    const pixel = (x: number, y: number) => tiled.data[(y * tiled.width + x) * 4];
    expect(pixel(1, 1)).toBe(10);
    expect(pixel(4, 1)).toBe(20);
    expect(pixel(1, 4)).toBe(30);
    expect(pixel(4, 4)).toBe(0);
    expect(pixel(0, 0)).toBe(0);
  });

  it("survives a round trip through the encoder and downscaler", () => {
    const tiled = tileRgba([solid(200, 4, 4), solid(100, 4, 4)], 2, { gap: 2 });
    const small = downscaleRgba(tiled.data, tiled.width, tiled.height, 2);
    const decoded = decodePng(encodePng(small.data, small.width, small.height));
    expect(decoded.width).toBe(small.width);
  });
});

describe("decodePng limits", () => {
  it("rejects image data that inflates past what the header allows", () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 6;
    const bomb = NodeZlib.deflateSync(Buffer.alloc(8_000_000));
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", bomb),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => decodePng(png)).toThrow(/corrupt/u);
  });
});
