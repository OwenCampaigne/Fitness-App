/**
 * The PNG encoder behind the app icons.
 *
 * Why this is worth testing: the icons are generated once and committed, so
 * nothing in the normal build ever exercises this encoder. A malformed IHDR or
 * a mis-filtered row would sail through `next build` and only show up as a
 * blank favicon on someone's phone. These tests decode the bytes back
 * independently — magic, chunk framing, declared dimensions, and every pixel —
 * so a regression fails here instead of in the wild.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { encodePng } from '../generate-icons';

// ── A minimal, independent PNG reader ────────────────────────────────────
// Deliberately not sharing code with the encoder: a decoder built from the
// same helpers would happily agree with a broken encoder.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  chunkTypes: string[];
  pixels: Uint8Array;
}

function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const chunkTypes: string[] = [];
  const idat: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunkTypes.push(type);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    }
    if (type === 'IDAT') idat.push(Buffer.from(data));
    offset += 12 + length;
  }

  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`inflated ${raw.length} bytes, expected ${(stride + 1) * height}`);
  }

  const pixels = new Uint8Array(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? pixels[y * stride + i - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = i >= bpp && y > 0 ? pixels[(y - 1) * stride + i - bpp] : 0;
      const x = raw[p + i];
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + left;
      else if (filter === 2) v = x + up;
      else if (filter === 3) v = x + ((left + up) >> 1);
      else if (filter === 4) {
        const est = left + up - upLeft;
        const pa = Math.abs(est - left);
        const pb = Math.abs(est - up);
        const pc = Math.abs(est - upLeft);
        v = x + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else throw new Error(`unknown filter type ${filter}`);
      pixels[y * stride + i] = v & 0xff;
    }
    p += stride;
  }

  return { width, height, bitDepth, colourType, chunkTypes, pixels };
}

/** A recognisable, non-uniform test image: a per-pixel gradient with varying alpha. */
function gradientRgba(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[i] = (x * 7) & 0xff;
      out[i + 1] = (y * 11) & 0xff;
      out[i + 2] = (x * y) & 0xff;
      out[i + 3] = x === 0 || y === 0 ? 0 : 255;
    }
  }
  return out;
}

describe('encodePng', () => {
  it('starts with the PNG magic bytes', () => {
    const png = encodePng(4, 4, gradientRgba(4, 4));
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('emits exactly IHDR, IDAT and IEND, in that order', () => {
    const { chunkTypes } = decodePng(encodePng(8, 5, gradientRgba(8, 5)));
    expect(chunkTypes).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares 8-bit RGBA in the IHDR', () => {
    const { bitDepth, colourType } = decodePng(encodePng(8, 8, gradientRgba(8, 8)));
    expect(bitDepth).toBe(8);
    expect(colourType).toBe(6);
  });

  it.each([
    [1, 1],
    [32, 32],
    [180, 180],
    [17, 5],
    [5, 17],
  ])('round-trips a %ix%i image to the same dimensions and pixels', (w, h) => {
    const rgba = gradientRgba(w, h);
    const decoded = decodePng(encodePng(w, h, rgba));
    expect([decoded.width, decoded.height]).toEqual([w, h]);
    expect(decoded.pixels.length).toBe(w * h * 4);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(rgba));
  });

  it('carries a CRC that a corrupted chunk would fail', () => {
    // Flip one byte of IDAT and confirm the stored CRC no longer matches, which
    // is the only thing standing between a truncated write and a silent
    // half-rendered icon.
    const png = encodePng(16, 16, gradientRgba(16, 16));
    const ihdrEnd = 8 + 12 + 13;
    const idatLength = png.readUInt32BE(ihdrEnd);
    const stored = png.readUInt32BE(ihdrEnd + 8 + idatLength);
    const body = png.subarray(ihdrEnd + 4, ihdrEnd + 8 + idatLength);
    expect(stored).toBe(crc32(body));
    const tampered = Buffer.from(body);
    tampered[tampered.length - 1] ^= 0xff;
    expect(crc32(tampered)).not.toBe(stored);
  });

  it('rejects a buffer that is not exactly width × height × 4 bytes', () => {
    expect(() => encodePng(4, 4, new Uint8Array(4 * 4 * 3))).toThrow(/expected 64 bytes/);
  });
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ── The committed icons ──────────────────────────────────────────────────
// These are build artefacts checked into the repo, so the thing most likely to
// go wrong is that someone changes the generator and forgets to re-run it.

describe('the icons committed to public/', () => {
  const publicDir = join(__dirname, '..', '..', 'public');
  const expected: Array<[string, number]> = [
    ['icon.png', 32],
    ['apple-icon.png', 180],
    ['icon-192x192.png', 192],
    ['icon-512x512.png', 512],
  ];

  it.each(expected)('%s is a valid %ipx square PNG', (file, size) => {
    const path = join(publicDir, file);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);

    const decoded = decodePng(readFileSync(path));
    expect([decoded.width, decoded.height]).toEqual([size, size]);
    expect(decoded.colourType).toBe(6);
    expect(decoded.pixels.length).toBe(size * size * 4);
  });

  it.each(expected)('%s is actual artwork, not a blank square', (file) => {
    const { pixels } = decodePng(readFileSync(join(publicDir, file)));

    const distinct = new Set<number>();
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      distinct.add((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]);
      // The pulse bars are the only non-grey thing in any of these icons.
      if (pixels[i + 1] > pixels[i] + 30 && pixels[i + 1] > pixels[i + 2] + 20) green++;
    }

    expect(distinct.size).toBeGreaterThan(4);
    expect(green).toBeGreaterThan(0);
  });
});
