/**
 * PWA icon rasteriser — draws the four app icons and writes them to `public/`.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * Why this exists: these icons used to be rendered at build time by `next/og`.
 * Its module body runs `fileURLToPath(path.join(import.meta.url, '../yoga.wasm'))`
 * at import time, and on Windows `path.win32.join` rewrites the `file://` URL's
 * separators to backslashes, so `fileURLToPath` rejects it and merely
 * *importing* `next/og` throws `TypeError: Invalid URL`. Every icon route then
 * fails to prerender and `next build` cannot finish locally. No constructor
 * option avoids it, because none of that is inside the constructor.
 *
 * The icons are pure geometry — no text — so `next/og` was buying us nothing a
 * few hundred lines of rasteriser cannot. We draw them once, commit the PNGs,
 * and serve them as static files. Regenerate by re-running this script.
 *
 * No new dependencies: coverage comes from signed-distance fields (which
 * antialias correctly even at 32px), blur from three box passes, and PNG
 * compression from Node's own zlib.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── PNG encoding ─────────────────────────────────────────────────────────
// A minimal colour-type-6 (RGBA) encoder: IHDR, one IDAT, IEND. Rows are
// filtered adaptively because these icons are mostly large flat gradients,
// where an unfiltered IDAT is several times larger for no benefit.

const BYTES_PER_PIXEL = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Writes one PNG row filter into `out` and returns the sum of absolute
 * differences, which is the heuristic the spec itself recommends for choosing
 * between the five filter types.
 */
function applyFilter(type: number, cur: Uint8Array, prev: Uint8Array, out: Uint8Array): number {
  let score = 0;
  for (let i = 0; i < cur.length; i++) {
    const left = i >= BYTES_PER_PIXEL ? cur[i - BYTES_PER_PIXEL] : 0;
    const up = prev[i];
    const upLeft = i >= BYTES_PER_PIXEL ? prev[i - BYTES_PER_PIXEL] : 0;
    let v: number;
    if (type === 0) {
      v = cur[i];
    } else if (type === 1) {
      v = cur[i] - left;
    } else if (type === 2) {
      v = cur[i] - up;
    } else if (type === 3) {
      v = cur[i] - ((left + up) >> 1);
    } else {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      v = cur[i] - (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
    }
    v &= 0xff;
    out[i] = v;
    score += v < 128 ? v : 256 - v;
  }
  return score;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * BYTES_PER_PIXEL;
  if (rgba.length !== stride * height) {
    throw new Error(`encodePng: expected ${stride * height} bytes, got ${rgba.length}`);
  }

  const raw = Buffer.alloc((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestScore = Infinity;
    for (let type = 0; type <= 4; type++) {
      const score = applyFilter(type, cur, prev, candidate);
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best.set(candidate);
      }
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
    prev = Uint8Array.from(cur);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 — truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ── Colour ───────────────────────────────────────────────────────────────
// Channels stay in 0..1 sRGB and composite without linearising, because that
// is what browsers (and the resvg backend these icons used to go through) do.
// Blending in linear light would quietly change the artwork.

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function hex(value: string, alpha = 1): Rgba {
  const n = parseInt(value.replace('#', ''), 16);
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255, a: alpha };
}

const GREEN = (alpha: number): Rgba => ({ r: 74 / 255, g: 222 / 255, b: 128 / 255, a: alpha });

type Paint = (x: number, y: number) => Rgba;

const solid =
  (color: Rgba): Paint =>
  () =>
    color;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A CSS `linear-gradient(<deg>, from, to)` across a `w`×`h` box: 0deg points
 * up, angles run clockwise, and the gradient line is sized so the end stops
 * land exactly on the corners.
 */
function linearGradient(angleDeg: number, w: number, h: number, from: Rgba, to: Rgba): Paint {
  const t = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(t);
  const dy = -Math.cos(t);
  const length = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  return (x, y) => {
    const p = clamp01(((x - cx) * dx + (y - cy) * dy) / length + 0.5);
    return {
      r: lerp(from.r, to.r, p),
      g: lerp(from.g, to.g, p),
      b: lerp(from.b, to.b, p),
      a: lerp(from.a, to.a, p),
    };
  };
}

// ── Canvas ───────────────────────────────────────────────────────────────

/** Premultiplied RGBA in 0..1 — premultiplied so source-over is a plain lerp. */
class Canvas {
  readonly data: Float32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Float32Array(w * h * 4);
  }

  blend(index: number, color: Rgba, coverage: number): void {
    const a = color.a * coverage;
    if (a <= 0) return;
    const inv = 1 - a;
    const d = this.data;
    d[index] = color.r * a + d[index] * inv;
    d[index + 1] = color.g * a + d[index + 1] * inv;
    d[index + 2] = color.b * a + d[index + 2] * inv;
    d[index + 3] = a + d[index + 3] * inv;
  }
}

const toByte = (v: number) => {
  const n = Math.round(v * 255);
  return n < 0 ? 0 : n > 255 ? 255 : n;
};

/** Box-average the supersampled canvas down to the finished icon size. */
function downsample(canvas: Canvas, ss: number): Uint8Array {
  const ow = canvas.w / ss;
  const oh = canvas.h / ss;
  const out = new Uint8Array(ow * oh * 4);
  const norm = 1 / (ss * ss);
  const d = canvas.data;
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        let i = ((oy * ss + sy) * canvas.w + ox * ss) * 4;
        for (let sx = 0; sx < ss; sx++, i += 4) {
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          a += d[i + 3];
        }
      }
      r *= norm;
      g *= norm;
      b *= norm;
      a *= norm;
      const o = (oy * ow + ox) * 4;
      if (a > 0) {
        out[o] = toByte(r / a);
        out[o + 1] = toByte(g / a);
        out[o + 2] = toByte(b / a);
        out[o + 3] = toByte(a);
      }
    }
  }
  return out;
}

// ── Shapes ───────────────────────────────────────────────────────────────

/** Signed distance to a rounded rectangle, in canvas pixels; negative inside. */
function roundRectSdf(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): number {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  const qx = Math.abs(px - (x + hw)) - (hw - rr);
  const qy = Math.abs(py - (y + hh)) - (hh - rr);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - rr;
}

/**
 * The field is measured in pixels, so a one-pixel linear ramp across the
 * boundary is exactly the antialiasing we want — and one primitive then
 * covers the corners, the ring and the bar caps alike, since a circle is
 * just a rounded rect whose radius is half its side.
 */
const coverageOf = (distance: number) => clamp01(0.5 - distance);

function blurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  const clampX = (x: number) => (x < 0 ? 0 : x > w - 1 ? w - 1 : x);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + clampX(i)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      sum += src[row + clampX(x + r + 1)] - src[row + clampX(x - r)];
    }
  }
}

function blurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  const clampY = (y: number) => (y < 0 ? 0 : y > h - 1 ? h - 1 : y);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[clampY(i) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm;
      sum += src[clampY(y + r + 1) * w + x] - src[clampY(y - r) * w + x];
    }
  }
}

// ── Drawing context ──────────────────────────────────────────────────────
// Each design below is written in the finished icon's own CSS pixels; the
// context multiplies by the supersample factor on the way in, so the numbers
// stay readable against the JSX they replace.

class Ctx {
  readonly canvas: Canvas;

  constructor(
    readonly size: number,
    readonly ss: number,
  ) {
    this.canvas = new Canvas(size * ss, size * ss);
  }

  rect(x: number, y: number, w: number, h: number, radius: number, paint: Paint | Rgba): void {
    const s = this.ss;
    const fill: Paint = typeof paint === 'function' ? paint : solid(paint);
    const sx = x * s;
    const sy = y * s;
    const sw = w * s;
    const sh = h * s;
    const sr = radius * s;
    const c = this.canvas;
    const x0 = Math.max(0, Math.floor(sx - 1));
    const x1 = Math.min(c.w - 1, Math.ceil(sx + sw + 1));
    const y0 = Math.max(0, Math.floor(sy - 1));
    const y1 = Math.min(c.h - 1, Math.ceil(sy + sh + 1));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const cov = coverageOf(roundRectSdf(px + 0.5, py + 0.5, sx, sy, sw, sh, sr));
        if (cov <= 0) continue;
        c.blend((py * c.w + px) * 4, fill((px + 0.5) / s, (py + 0.5) / s), cov);
      }
    }
  }

  /**
   * A CSS `box-shadow: 0 0 <blur>px <color>`. Three box passes stand in for
   * the Gaussian: at these radii the difference is under a colour level, and
   * it keeps the script dependency-free.
   */
  glow(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    blur: number,
    color: Rgba,
  ): void {
    const s = this.ss;
    const c = this.canvas;
    const sx = x * s;
    const sy = y * s;
    const sw = w * s;
    const sh = h * s;
    const sr = radius * s;
    const pad = blur * s + 2;

    const mask = new Float32Array(c.w * c.h);
    const x0 = Math.max(0, Math.floor(sx - pad));
    const x1 = Math.min(c.w - 1, Math.ceil(sx + sw + pad));
    const y0 = Math.max(0, Math.floor(sy - pad));
    const y1 = Math.min(c.h - 1, Math.ceil(sy + sh + pad));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        mask[py * c.w + px] = coverageOf(roundRectSdf(px + 0.5, py + 0.5, sx, sy, sw, sh, sr));
      }
    }

    // A CSS blur radius B is a Gaussian of sigma B/2, which three box passes
    // of width B reproduce closely enough to be indistinguishable.
    const boxRadius = Math.max(1, Math.round((blur * s) / 2));
    const tmp = new Float32Array(c.w * c.h);
    for (let pass = 0; pass < 3; pass++) {
      blurH(mask, tmp, c.w, c.h, boxRadius);
      blurV(tmp, mask, c.w, c.h, boxRadius);
    }

    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0.001) c.blend(i * 4, color, mask[i]);
    }
  }

  toPng(): Buffer {
    return encodePng(this.size, this.size, downsample(this.canvas, this.ss));
  }
}

// ── Icon designs ─────────────────────────────────────────────────────────

/** Seven EKG pulse bars: a centred flex row with a gap, every bar centred. */
function pulseBars(
  ctx: Ctx,
  opts: {
    centerX: number;
    centerY: number;
    heights: number[];
    barW: number;
    gap: number;
    barRadius: number;
    color: (i: number) => Rgba;
    glow?: { index: number; blur: number; color: Rgba };
  },
): void {
  const { heights, barW, gap } = opts;
  const total = heights.length * barW + (heights.length - 1) * gap;
  const startX = opts.centerX - total / 2;
  const boxOf = (i: number) => ({
    x: startX + i * (barW + gap),
    y: opts.centerY - heights[i] / 2,
    h: heights[i],
  });

  // The glow goes down first so the bar itself sits on top of it, the way a
  // box-shadow renders behind its own element.
  if (opts.glow) {
    const { x, y, h } = boxOf(opts.glow.index);
    ctx.glow(x, y, barW, h, opts.barRadius, opts.glow.blur, opts.glow.color);
  }

  heights.forEach((_, i) => {
    const { x, y, h } = boxOf(i);
    ctx.rect(x, y, barW, h, opts.barRadius, opts.color(i));
  });
}

/** The 32px favicon: flat ground and no ring, because detail that small muddies. */
function drawFavicon(ctx: Ctx): void {
  ctx.rect(0, 0, 32, 32, 7, hex('#0a0a0a'));
  pulseBars(ctx, {
    centerX: 16,
    centerY: 16,
    heights: [3, 3, 18, 2, 10, 3, 3],
    barW: 2,
    gap: 2,
    barRadius: 1,
    color: (i) => (i === 2 ? GREEN(1) : GREEN(0.55)),
  });
}

interface RingSpec {
  size: number;
  radius: number;
  ringInset: number;
  ringSize: number;
  ringBorder: number;
  ringGlowBlur: number;
  ringGlowAlpha: number;
  barHeights: number[];
  barW: number;
  gap: number;
  barRadius: number;
  centerGlowBlur: number;
  centerGlowAlpha: number;
}

/** The watch-ring icon: gradient ground, dark ring, pulse bars inside it. */
function drawRingIcon(ctx: Ctx, spec: RingSpec): void {
  const s = spec.size;
  ctx.rect(0, 0, s, s, spec.radius, linearGradient(145, s, s, hex('#111111'), hex('#080808')));

  const inset = spec.ringInset;
  const ringRadius = spec.ringSize / 2;
  ctx.glow(
    inset,
    inset,
    spec.ringSize,
    spec.ringSize,
    ringRadius,
    spec.ringGlowBlur,
    GREEN(spec.ringGlowAlpha),
  );

  // Border-box sizing, the way Yoga laid this out: the border eats into the
  // circle rather than growing it, so the dark fill is inset by exactly that.
  ctx.rect(inset, inset, spec.ringSize, spec.ringSize, ringRadius, hex('#1f1f1f'));
  const inner = spec.ringSize - spec.ringBorder * 2;
  ctx.rect(inset + spec.ringBorder, inset + spec.ringBorder, inner, inner, inner / 2, hex('#0d0d0d'));

  pulseBars(ctx, {
    centerX: inset + ringRadius,
    centerY: inset + ringRadius,
    heights: spec.barHeights,
    barW: spec.barW,
    gap: spec.gap,
    barRadius: spec.barRadius,
    color: (i) => (i === 2 ? GREEN(1) : i === 4 ? GREEN(0.75) : GREEN(0.4)),
    glow: { index: 2, blur: spec.centerGlowBlur, color: GREEN(spec.centerGlowAlpha) },
  });
}

/** apple-touch-icon — its own proportions, carried over verbatim from the JSX. */
const APPLE_SPEC: RingSpec = {
  size: 180,
  radius: 40,
  ringInset: 20,
  ringSize: 140,
  ringBorder: 4,
  ringGlowBlur: 24,
  ringGlowAlpha: 0.15,
  barHeights: [10, 10, 62, 8, 36, 10, 10],
  barW: 9,
  gap: 5,
  barRadius: 4,
  centerGlowBlur: 8,
  centerGlowAlpha: 0.6,
};

/**
 * The manifest icons run off one ratio sheet, so 192 and 512 stay identical
 * apart from scale. Only the two shadow radii are absolute, exactly as they
 * were authored.
 */
function pwaSpec(
  s: number,
  ringGlowBlur: number,
  ringGlowAlpha: number,
  centerGlowBlur: number,
  centerGlowAlpha: number,
): RingSpec {
  const heightRatios = [0.1, 0.1, 0.65, 0.08, 0.37, 0.1, 0.1];
  return {
    size: s,
    radius: Math.round(s * 0.22),
    ringInset: s * 0.11,
    ringSize: s * 0.78,
    ringBorder: Math.round(s * 0.022),
    ringGlowBlur,
    ringGlowAlpha,
    barHeights: heightRatios.map((r) => s * r * 0.62),
    barW: s * 0.048,
    gap: s * 0.028,
    barRadius: s * 0.01,
    centerGlowBlur,
    centerGlowAlpha,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────

/**
 * Supersampling is chosen so every icon rasterises around 1–2k px square: the
 * 32px favicon needs 16× before its corners stop stair-stepping, while 512 is
 * already big enough that 4× is plenty.
 */
const ICONS: Array<{ file: string; size: number; ss: number; draw: (ctx: Ctx) => void }> = [
  { file: 'icon.png', size: 32, ss: 16, draw: drawFavicon },
  { file: 'apple-icon.png', size: 180, ss: 8, draw: (c) => drawRingIcon(c, APPLE_SPEC) },
  {
    file: 'icon-192x192.png',
    size: 192,
    ss: 8,
    draw: (c) => drawRingIcon(c, pwaSpec(192, 24, 0.15, 10, 0.6)),
  },
  {
    file: 'icon-512x512.png',
    size: 512,
    ss: 4,
    draw: (c) => drawRingIcon(c, pwaSpec(512, 60, 0.18, 28, 0.7)),
  },
  // The notification badge. sw.js, notifications.ts and /api/push/check have
  // all referenced this path for as long as they have existed, against a file
  // that was never generated — the same geometry, one size down.
  {
    file: 'icon-96x96.png',
    size: 96,
    ss: 8,
    draw: (c) => drawRingIcon(c, pwaSpec(96, 12, 0.15, 5, 0.6)),
  },
];

function main(): void {
  const outDir = join(__dirname, '..', 'public');
  for (const icon of ICONS) {
    const ctx = new Ctx(icon.size, icon.ss);
    icon.draw(ctx);
    const png = ctx.toPng();
    writeFileSync(join(outDir, icon.file), png);
    console.log(
      `  public/${icon.file}  ${icon.size}x${icon.size}  ${(png.length / 1024).toFixed(1)} KB`,
    );
  }
}

if (require.main === module) main();
