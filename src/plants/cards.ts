/**
 * Leaf, needle and fern cards, and birch bark, painted in code. A card is a sprig drawn in a unit square (x right, y down, as on
 * a canvas): it grows from the bottom centre towards the top, with transparent space around it for alpha testing.
 * `cardStrokes` is the pure, seeded recipe (tested in Node); `paintCard` and `cardTextures` draw it (browser only).
 */
import {
  ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType,
} from 'three/webgpu';
import { between, mulberry32 } from '../util/rng';
import { fnv1a } from '../util/hash';
import type { LeafSpec } from './species';

/** The meadow's wildflowers (ground cover cards): lupine and fireweed spikes, oxeye daisies and harebells. */
export type FlowerCard = 'lupine' | 'daisy' | 'fireweed' | 'harebell';
export const FLOWER_CARDS: readonly FlowerCard[] = ['lupine', 'daisy', 'fireweed', 'harebell'];
export type CardKind = LeafSpec['card'] | 'birchBark' | FlowerCard;
export const CARD_KINDS: readonly CardKind[] = ['pine', 'spruce', 'birch', 'alder', 'willow', 'juniper', 'blueberry', 'fern', 'birchBark', ...FLOWER_CARDS];
export type RGB = [number, number, number];
export type LeafShape = 'ovate' | 'round' | 'lance' | 'oval' | 'pinna';

/**
 * One mark on a card, in unit card space. `h` is its height (0–1) for the height map, `a` its opacity (default 1).
 * `line`: a tapered polyline (`pts` = x0, y0, x1, y1, …) from width `w0` to `w1`. `leaf`: a blade from its base at (x, y) along
 * `angle` (radians, canvas frame), `len` long and `wid` wide, with `teeth` teeth along each edge. `dot`: an ellipse.
 */
export type Stroke =
  | { t: 'line'; pts: number[]; w0: number; w1: number; rgb: RGB; h: number; a?: number }
  | { t: 'leaf'; x: number; y: number; angle: number; len: number; wid: number; shape: LeafShape; teeth: number; rgb: RGB; vein: RGB; h: number; a?: number }
  | { t: 'dot'; x: number; y: number; rx: number; ry: number; rgb: RGB; h: number; a?: number };
type Leaf = Extract<Stroke, { t: 'leaf' }>;
type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** Strokes stay this far inside the card, so mipmaps never smear them across the edge. */
const MARGIN = 0.01;
/** Birch bark is a tiling sheet: this background under its strokes. */
const BARK_BG: RGB = [229, 225, 214];

// ---------- leaf outlines ----------

/** Half-width profile along the midrib (u = 0 at the base, 1 at the tip), before normalising to a peak of 1. */
const PROFILES: Record<LeafShape, (u: number) => number> = {
  ovate: (u) => u ** 0.5 * (1 - u) ** 1.1, // birch: broad low down, drawn out to a point
  round: (u) => u ** 0.7 * (1 - u) ** 0.3, // alder: broadest beyond the middle, blunt tip
  lance: (u) => u ** 0.6 * (1 - u) ** 0.8, // willow
  oval: (u) => Math.sqrt(u * (1 - u)), // blueberry
  pinna: (u) => u ** 0.3 * (1 - u) ** 0.9, // a fern pinna: broad base, tapering
};
const PEAK = Object.fromEntries(
  Object.entries(PROFILES).map(([k, f]) => [k, Math.max(...Array.from({ length: 401 }, (_, i) => f(i / 400)))]),
) as Record<LeafShape, number>;
/** How deep each shape's teeth cut, as a fraction of the half-width. */
const TOOTH: Record<LeafShape, number> = { ovate: 0.13, round: 0.07, lance: 0.05, oval: 0.03, pinna: 0.5 };
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const frac = (x: number) => x - Math.floor(x);

/** Half-width (unit card space) at `u` along the leaf, teeth included. Teeth rise gently and drop sharply, pointing to the tip. */
function halfWidth(s: Leaf, u: number): number {
  let m = 1;
  if (s.teeth > 0) {
    const d = TOOTH[s.shape] * smooth(0.04, 0.2, u) * (1 - smooth(0.85, 1, u)), f = frac(u * s.teeth);
    if (s.shape === 'pinna') m -= d * (1 - Math.sin(Math.PI * f)); // rounded lobes
    else {
      m -= d * (1 - f);
      if (s.shape === 'ovate') m -= 0.35 * d * (1 - frac(u * s.teeth * 3)); // birch: doubly toothed
    }
  }
  return ((PROFILES[s.shape](u) / PEAK[s.shape]) * m * s.wid) / 2;
}

/** The leaf's outline as a closed polygon (x0, y0, x1, y1, …): up one edge from the base to the tip, back down the other. */
export function leafOutline(s: Leaf): number[] {
  const n = Math.max(40, s.teeth * 6), c = Math.cos(s.angle), sn = Math.sin(s.angle), out: number[] = [];
  const at = (u: number, side: number) => {
    const w = halfWidth(s, u) * side, along = u * s.len;
    out.push(s.x + c * along - sn * w, s.y + sn * along + c * w);
  };
  for (let i = 0; i <= n; i++) at(i / n, 1);
  for (let i = n - 1; i > 0; i--) at(i / n, -1);
  return out;
}

/** The box a stroke covers, line widths included. */
export function strokeBounds(s: Stroke): Bounds {
  if (s.t === 'dot') return { x0: s.x - s.rx, y0: s.y - s.ry, x1: s.x + s.rx, y1: s.y + s.ry };
  const pts = s.t === 'line' ? s.pts : leafOutline(s), pad = s.t === 'line' ? Math.max(s.w0, s.w1) / 2 : 0.003;
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < pts.length; i += 2) {
    b.x0 = Math.min(b.x0, pts[i] - pad); b.x1 = Math.max(b.x1, pts[i] + pad);
    b.y0 = Math.min(b.y0, pts[i + 1] - pad); b.y1 = Math.max(b.y1, pts[i + 1] + pad);
  }
  return b;
}

const inside = (b: Bounds) => b.x0 >= MARGIN && b.y0 >= MARGIN && b.x1 <= 1 - MARGIN && b.y1 <= 1 - MARGIN;

/** Shrink a stroke towards its base until it fits on the card (null if it cannot). */
function fit(s: Stroke): Stroke | null {
  for (let k = 0; k < 24; k++, s = shrink(s)) if (inside(strokeBounds(s))) return s;
  return null;
}
function shrink(s: Stroke): Stroke {
  if (s.t === 'leaf') return { ...s, len: s.len * 0.9, wid: s.wid * 0.9 };
  if (s.t === 'dot') return { ...s, rx: s.rx * 0.9, ry: s.ry * 0.9 };
  const [x, y] = s.pts;
  return { ...s, pts: s.pts.map((v, i) => (i % 2 ? y + (v - y) * 0.9 : x + (v - x) * 0.9)) };
}

// ---------- the recipes ----------

const clamp255 = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
/** A colour varied in brightness by ±`amt` and a little in hue (green ↔ yellow). */
function vary(rng: () => number, c: RGB, amt: number): RGB {
  const b = 1 + between(rng, -amt, amt), warm = between(rng, -amt, amt) * 0.6;
  return [clamp255(c[0] * b * (1 + warm)), clamp255(c[1] * b), clamp255(c[2] * b * (1 - warm))];
}
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [clamp255(a[0] + (b[0] - a[0]) * t), clamp255(a[1] + (b[1] - a[1]) * t), clamp255(a[2] + (b[2] - a[2]) * t)];

/** A gently bent twig: a polyline from (x0, y0) to (x1, y1), bowed sideways by `bend`, with `zig` zigzag at its nodes. */
function twig(rng: () => number, x0: number, y0: number, x1: number, y1: number, bend: number, n = 12, zig = 0): number[] {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), px = -dy / l, py = dx / l, pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, off = bend * 4 * t * (1 - t) + (i > 0 && i < n ? zig * (i % 2 ? 1 : -1) * (0.6 + 0.4 * rng()) : 0);
    pts.push(x0 + dx * t + px * off, y0 + dy * t + py * off);
  }
  return pts;
}
/** Position and unit direction at fraction `t` along a polyline. */
function along(pts: number[], t: number): { x: number; y: number; dx: number; dy: number } {
  const n = pts.length / 2 - 1, f = Math.min(n - 1e-6, Math.max(0, t * n)), i = Math.floor(f), r = f - i;
  const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3], l = Math.hypot(bx - ax, by - ay) || 1;
  return { x: ax + (bx - ax) * r, y: ay + (by - ay) * r, dx: (bx - ax) / l, dy: (by - ay) / l };
}
const rotate = (dx: number, dy: number, a: number) => [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
const length = (pts: number[]) => {
  let l = 0;
  for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return l;
};
const DEG = Math.PI / 180;

/** A needle from (x, y) heading along (dx, dy) turned by `a`, `len` long, curling sideways by `curl`. */
function needle(x: number, y: number, dx: number, dy: number, a: number, len: number, curl: number, w: number, rgb: RGB, h: number): Stroke {
  const [nx, ny] = rotate(dx, dy, a), mx = x + nx * len * 0.5 - ny * curl, my = y + ny * len * 0.5 + nx * curl;
  return { t: 'line', pts: [x, y, mx, my, x + nx * len - ny * curl * 1.6, y + ny * len + nx * curl * 1.6], w0: w, w1: w * 0.22, rgb, h };
}

type Recipe = (rng: () => number) => Stroke[];

/** Needle sprigs: needles along every twig in `twigs`, `perSide` per side at each step, then the twigs on top. */
function needles(rng: () => number, twigs: { pts: number[]; w0: number; w1: number }[], o: {
  step: number; each: () => number; angle: [number, number]; len: (t: number) => number; w: number; old: RGB; young: RGB; twig: RGB;
}): Stroke[] {
  const out: Stroke[] = [];
  for (const tw of twigs) {
    const n = Math.round(length(tw.pts) / o.step);
    for (let i = 1; i <= n; i++) {
      const t = (i - between(rng, 0, 0.5)) / n, p = along(tw.pts, t), k = o.each();
      for (let j = 0; j < k; j++) {
        const side = (i + j) % 2 ? 1 : -1, a = side * between(rng, o.angle[0], o.angle[1]) * DEG * (1 - 0.35 * t);
        const rgb = vary(rng, mixRgb(o.old, o.young, t ** 4), 0.14);
        const len = o.len(t) * between(rng, 0.8, 1.15), curl = side * between(rng, -0.004, 0.012), wid = o.w * between(rng, 0.85, 1.15);
        out.push(needle(p.x, p.y, p.dx, p.dy, a, len, curl, wid, rgb, between(rng, 0.6, 0.8)));
      }
    }
  }
  for (const tw of twigs) out.push({ t: 'line', pts: tw.pts, w0: tw.w0, w1: tw.w1, rgb: vary(rng, o.twig, 0.1), h: 0.55 });
  return out;
}

/** Broad-leaved sprigs: a twig with leaves on stalks at alternate nodes, and one at the tip. */
function leafy(rng: () => number, o: {
  count: [number, number]; shape: LeafShape; len: [number, number]; ratio: [number, number]; teeth: number; angle: [number, number];
  stalk: number; rgb: RGB; vein: RGB; twig: RGB; twigW: number; zig: number; lean: number; from?: number;
}): Stroke[] {
  const tipX = 0.5 + between(rng, -o.lean, o.lean), pts = twig(rng, 0.5, 0.97, tipX, 0.2, between(rng, -0.06, 0.06), 10, o.zig);
  const out: Stroke[] = [{ t: 'line', pts, w0: o.twigW, w1: o.twigW * 0.45, rgb: vary(rng, o.twig, 0.1), h: 0.5 }];
  const n = Math.round(between(rng, o.count[0], o.count[1] + 1) - 0.5), from = o.from ?? 0.25;
  for (let i = 0; i <= n; i++) {
    const tip = i === n, t = tip ? 1 : from + ((1 - from) * (i + between(rng, -0.2, 0.2))) / n, p = along(pts, t);
    const side = i % 2 ? 1 : -1, a = tip ? between(rng, -8, 8) * DEG : side * between(rng, o.angle[0], o.angle[1]) * DEG;
    const [dx, dy] = rotate(p.dx, p.dy, a), stalk = o.stalk * between(rng, 0.8, 1.2);
    const sx = p.x + dx * stalk, sy = p.y + dy * stalk, len = between(rng, o.len[0], o.len[1]) * (tip ? 0.85 : 1);
    if (stalk > 0.005) {
      const pts = [p.x, p.y, (p.x + sx) / 2 + side * 0.004, (p.y + sy) / 2, sx, sy];
      out.push({ t: 'line', pts, w0: 0.006, w1: 0.004, rgb: vary(rng, o.twig, 0.15), h: 0.5 });
    }
    const rgb = vary(rng, o.rgb, 0.13), leaf: Stroke = {
      t: 'leaf', x: sx, y: sy, angle: Math.atan2(dy, dx) + between(rng, -6, 6) * DEG, len, wid: len * between(rng, o.ratio[0], o.ratio[1]),
      shape: o.shape, teeth: o.teeth, rgb, vein: mixRgb(rgb, o.vein, 0.7), h: 0.6,
    };
    out.push(leaf);
  }
  return out;
}

const RECIPES: Record<Exclude<CardKind, FlowerCard>, Recipe> = {
  // Scots pine: long, grey-green needles in pairs (now and then threes) all along a twig, sweeping forwards.
  pine: (rng) => {
    const pts = twig(rng, 0.5, 0.97, 0.5 + between(rng, -0.08, 0.08), 0.12, between(rng, -0.05, 0.05));
    return needles(rng, [{ pts, w0: 0.02, w1: 0.009 }], {
      step: 0.021, each: () => (rng() < 0.3 ? 3 : 2), angle: [18, 50], len: (t) => 0.36 - 0.1 * t ** 2, w: 0.0075,
      old: [52, 80, 58], young: [92, 122, 72], twig: [104, 82, 56],
    });
  },
  // Spruce: short, stiff, dark needles crowded on both sides of a twig and its side shoots, fresh green at the tips.
  spruce: (rng) => {
    const main = twig(rng, 0.5, 0.97, 0.5 + between(rng, -0.05, 0.05), 0.05, between(rng, -0.04, 0.04));
    const twigs = [{ pts: main, w0: 0.016, w1: 0.008 }];
    const sides = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < sides; i++) {
      const p = along(main, 0.22 + (0.55 * i) / sides + between(rng, -0.03, 0.03)), side = i % 2 ? 1 : -1;
      const [dx, dy] = rotate(p.dx, p.dy, side * between(rng, 42, 58) * DEG), l = between(rng, 0.24, 0.32);
      twigs.push({ pts: twig(rng, p.x, p.y, p.x + dx * l, p.y + dy * l, side * 0.02, 6), w0: 0.009, w1: 0.005 });
    }
    return needles(rng, twigs, {
      step: 0.0085, each: () => 2, angle: [48, 78], len: (t) => 0.072 - 0.02 * t, w: 0.0068,
      old: [34, 62, 42], young: [84, 128, 62], twig: [112, 84, 60],
    });
  },
  // Birch: small, toothed, triangular-ovate leaves on slim stalks, a fresh yellow-green that glows with the light through it.
  birch: (rng) => leafy(rng, {
    count: [5, 7], shape: 'ovate', len: [0.17, 0.23], ratio: [0.62, 0.72], teeth: 9, angle: [40, 65], stalk: 0.055,
    rgb: [112, 148, 58], vein: [176, 196, 110], twig: [92, 58, 44], twigW: 0.008, zig: 0.012, lean: 0.12,
  }),
  // Alder: round, dark, glossy leaves with a blunt or notched tip.
  alder: (rng) => leafy(rng, {
    count: [4, 5], shape: 'round', len: [0.24, 0.3], ratio: [0.8, 0.92], teeth: 8, angle: [45, 70], stalk: 0.05,
    rgb: [50, 86, 40], vein: [96, 130, 70], twig: [86, 74, 62], twigW: 0.011, zig: 0.008, lean: 0.1,
  }),
  // Willow: long, narrow, finely toothed grey-green leaves, swept forwards along a slim yellowish twig.
  willow: (rng) => leafy(rng, {
    count: [6, 9], shape: 'lance', len: [0.3, 0.4], ratio: [0.13, 0.18], teeth: 24, angle: [18, 34], stalk: 0.02,
    rgb: [92, 122, 72], vein: [160, 176, 136], twig: [140, 120, 66], twigW: 0.008, zig: 0, lean: 0.06, from: 0.15,
  }),
  // Juniper: prickly sprigs, short sharp blue-green needles in threes, and a few frosted blue berries.
  juniper: (rng) => {
    const main = twig(rng, 0.5, 0.97, 0.5 + between(rng, -0.08, 0.08), 0.08, between(rng, -0.05, 0.05));
    const twigs = [{ pts: main, w0: 0.014, w1: 0.006 }];
    for (let i = 0; i < 4; i++) {
      const p = along(main, 0.2 + 0.17 * i + between(rng, -0.03, 0.03)), side = i % 2 ? 1 : -1;
      const [dx, dy] = rotate(p.dx, p.dy, side * between(rng, 30, 50) * DEG), l = between(rng, 0.2, 0.3);
      twigs.push({ pts: twig(rng, p.x, p.y, p.x + dx * l, p.y + dy * l, side * 0.015, 6), w0: 0.008, w1: 0.004 });
    }
    const out = needles(rng, twigs, {
      step: 0.02, each: () => 3, angle: [25, 60], len: () => 0.07, w: 0.0075, old: [64, 98, 84], young: [96, 132, 104], twig: [110, 86, 64],
    });
    for (let i = 0; i < 3; i++) {
      const tw = twigs[1 + Math.floor(rng() * 4)], p = along(tw.pts, between(rng, 0.3, 0.8)), r = between(rng, 0.016, 0.022);
      out.push({ t: 'dot', x: p.x, y: p.y, rx: r, ry: r, rgb: vary(rng, [58, 72, 108], 0.1), h: 0.9 });
      out.push({ t: 'dot', x: p.x - r * 0.3, y: p.y - r * 0.3, rx: r * 0.55, ry: r * 0.55, rgb: [150, 166, 190], h: 1, a: 0.45 });
    }
    return out;
  },
  // Blueberry: green, angular stems with tiny oval leaves, and a few dusky blue berries.
  blueberry: (rng) => {
    const out = leafy(rng, {
      count: [6, 8], shape: 'oval', len: [0.1, 0.14], ratio: [0.55, 0.65], teeth: 10, angle: [45, 75], stalk: 0.008,
      rgb: [72, 122, 46], vein: [130, 170, 90], twig: [86, 124, 54], twigW: 0.01, zig: 0.018, lean: 0.15, from: 0.15,
    });
    const stem = out[0] as Extract<Stroke, { t: 'line' }>;
    const berries = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < berries; i++) {
      const p = along(stem.pts, between(rng, 0.25, 0.85)), side = rng() < 0.5 ? -1 : 1, r = between(rng, 0.024, 0.03);
      const x = p.x + side * between(rng, 0.03, 0.06), y = p.y + between(rng, 0.01, 0.03);
      out.push({ t: 'line', pts: [p.x, p.y, x, y - r], w0: 0.004, w1: 0.003, rgb: [96, 110, 60], h: 0.5 });
      out.push({ t: 'dot', x, y, rx: r, ry: r * 0.95, rgb: vary(rng, [46, 54, 100], 0.12), h: 0.9 });
      out.push({ t: 'dot', x: x - r * 0.3, y: y - r * 0.35, rx: r * 0.45, ry: r * 0.4, rgb: [128, 140, 184], h: 1, a: 0.5 });
      out.push({ t: 'dot', x, y: y + r * 0.7, rx: r * 0.28, ry: r * 0.18, rgb: [30, 30, 50], h: 0.7 });
    }
    return out;
  },
  // Fern: a once-pinnate frond, the lobed pinnae longest a third of the way up, tapering to the tip.
  fern: (rng) => {
    const rachis = twig(rng, 0.5, 0.98, 0.5 + between(rng, -0.06, 0.06), 0.03, between(rng, -0.05, 0.05), 16);
    const out: Stroke[] = [];
    const pairs = 20 + Math.floor(rng() * 4), base = vary(rng, [76, 122, 48], 0.08);
    for (let i = 0; i < pairs; i++) {
      const t = 0.1 + (0.88 * i) / pairs, p = along(rachis, t);
      const L = 0.44 * (t < 0.35 ? 0.6 + 0.4 * ((t - 0.1) / 0.25) : (1 - (t - 0.35) / 0.65) ** 0.85) + 0.02;
      for (const side of [-1, 1]) {
        const [dx, dy] = rotate(p.dx, p.dy, side * between(rng, 58, 68) * DEG), rgb = vary(rng, base, 0.07);
        out.push({ // narrow enough to leave light between neighbouring pinnae
          t: 'leaf', x: p.x, y: p.y, angle: Math.atan2(dy, dx) - side * 6 * DEG, len: L * between(rng, 0.92, 1.05), wid: Math.min(L * 0.24, 0.034),
          shape: 'pinna', teeth: Math.max(4, Math.round(L * 34)), rgb, vein: mixRgb(rgb, [150, 180, 100], 0.5), h: 0.6,
        });
      }
    }
    out.push({ t: 'line', pts: rachis, w0: 0.013, w1: 0.003, rgb: vary(rng, [98, 116, 56], 0.08), h: 0.7 });
    return out;
  },
  // Birch bark (tiling): chalk white, banded faintly, with dark horizontal lenticels and a few black scars.
  birchBark: (rng) => {
    const out: Stroke[] = [];
    for (let i = 0; i < 26; i++) {
      const rx = between(rng, 0.12, 0.3), ry = between(rng, 0.006, 0.02);
      out.push({ t: 'dot', x: between(rng, rx + MARGIN, 1 - rx - MARGIN), y: between(rng, ry + MARGIN, 1 - ry - MARGIN), rx, ry,
        rgb: vary(rng, rng() < 0.5 ? [206, 198, 186] : [240, 238, 232], 0.03), h: between(rng, 0.45, 0.55), a: 0.6 });
    }
    for (let i = 0; i < 140; i++) {
      const l = between(rng, 0.02, 0.12) * (rng() < 0.15 ? 1.8 : 1), w = between(rng, 0.004, 0.011);
      const x = between(rng, 0.02, 0.98 - l), y = between(rng, 0.02, 0.98), pts = [x, y, x + l / 2, y + between(rng, -0.003, 0.003), x + l, y];
      out.push({ t: 'line', pts, w0: w * 0.5, w1: w * 0.3, rgb: vary(rng, [62, 54, 50], 0.15), h: 0.3 });
    }
    for (let i = 0; i < 7; i++) { // black scars: broad, thin, ragged bands across the trunk
      const x = between(rng, 0.15, 0.85), y = between(rng, 0.1, 0.9), l = between(rng, 0.06, 0.14), w = between(rng, 0.012, 0.03);
      const sag = between(rng, -0.012, 0.012);
      out.push({ t: 'line', pts: [x - l, y + sag, x - l / 3, y - between(rng, 0, 0.006), x + l / 3, y + between(rng, 0, 0.006), x + l, y - sag],
        w0: w * 0.4, w1: w * 0.3, rgb: vary(rng, [40, 34, 32], 0.15), h: 0.25 });
      out.push({ t: 'dot', x: x + between(rng, -l / 2, l / 2), y, rx: l * 0.35, ry: w * 0.45, rgb: vary(rng, [36, 30, 30], 0.15), h: 0.25 });
    }
    return out;
  },
};

/** A flowering stem: a gently bent stalk from the card's foot at `x` up to (`tx`, `ty`). */
function stalk(rng: () => number, x: number, tx: number, ty: number, w: number, rgb: RGB): { pts: number[]; stroke: Stroke } {
  const pts = twig(rng, x, 0.985, tx, ty, between(rng, -0.03, 0.03), 10);
  return { pts, stroke: { t: 'line', pts, w0: w, w1: w * 0.6, rgb: vary(rng, rgb, 0.08), h: 0.6 } };
}
/** A tuft of `n` narrow leaves at the foot of a flower card. */
function basal(rng: () => number, n: number, len: [number, number], wid: number, rgb: RGB): Stroke[] {
  return Array.from({ length: n }, (): Stroke => {
    const l = between(rng, len[0], len[1]), c = vary(rng, rgb, 0.1);
    return { t: 'leaf', x: between(rng, 0.3, 0.7), y: 0.985, angle: -Math.PI / 2 + between(rng, -0.9, 0.9), len: l, wid: l * wid, shape: 'lance', teeth: 0,
      rgb: c, vein: mixRgb(c, [160, 190, 120], 0.4), h: 0.5 };
  });
}
/** Florets in pairs up the top of a stalk (from `from` to its tip), largest at the bottom, fading from `open` to `bud`. */
function spike(rng: () => number, pts: number[], from: number, n: number, r: number, open: RGB, bud: RGB, light: RGB): Stroke[] {
  const out: Stroke[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / n, p = along(pts, from + (1 - from) * u), rr = r * (1 - 0.6 * u), c = vary(rng, mixRgb(open, bud, u ** 1.5), 0.1);
    for (const side of [-1, 1]) {
      const x = p.x + side * rr * between(rng, 0.7, 1.1), y = p.y + between(rng, -0.004, 0.004);
      out.push({ t: 'dot', x, y, rx: rr, ry: rr * 0.8, rgb: c, h: 0.8 });
      out.push({ t: 'dot', x: x - side * rr * 0.2, y: y - rr * 0.35, rx: rr * 0.45, ry: rr * 0.35, rgb: light, h: 0.9, a: 0.7 });
    }
  }
  return out;
}

const FLOWER_RECIPES: Record<FlowerCard, Recipe> = {
  // Lupines: two or three tall spikes of violet-blue pea flowers, paler buds at the tip, over palmate leaves.
  lupine: (rng) => {
    const out: Stroke[] = [], n = 2 + Math.floor(rng() * 2);
    for (let j = 0; j < 2; j++) { // palmate leaves: leaflets fanned from a point low on the card
      const cx = between(rng, 0.3, 0.7), cy = between(rng, 0.78, 0.86), c = vary(rng, [64, 104, 52], 0.08);
      out.push({ t: 'line', pts: [cx, cy, cx + between(rng, -0.03, 0.03), 0.985], w0: 0.01, w1: 0.008, rgb: [70, 104, 54], h: 0.5 });
      for (let k = 0; k < 7; k++) {
        const l = between(rng, 0.09, 0.12);
        out.push({ t: 'leaf', x: cx, y: cy, angle: -Math.PI / 2 + (k - 3) * 0.42, len: l, wid: l * 0.3, shape: 'lance', teeth: 0, rgb: c,
          vein: mixRgb(c, [150, 180, 120], 0.5), h: 0.5 });
      }
    }
    for (let i = 0; i < n; i++) {
      const x = 0.5 + (i - (n - 1) / 2) * 0.16 + between(rng, -0.03, 0.03);
      const s = stalk(rng, x, x + between(rng, -0.06, 0.06), between(rng, 0.04, 0.2), 0.016, [70, 104, 54]);
      out.push(s.stroke, ...spike(rng, s.pts, 0.45, 13, 0.03, [92, 84, 196], [176, 170, 220], [190, 180, 240]));
    }
    return out;
  },
  // Oxeye daisies: white rays round a yellow disc on wiry stems of different heights, the heads seen a little from the side.
  daisy: (rng) => {
    const out = basal(rng, 6, [0.15, 0.25], 0.2, [70, 108, 50]), n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const tx = between(rng, 0.18, 0.82), ty = between(rng, 0.14, 0.5), s = stalk(rng, 0.5 + between(rng, -0.12, 0.12), tx, ty, 0.01, [74, 110, 52]);
      out.push(s.stroke);
      const r = between(rng, 0.08, 0.1), tilt = between(rng, 0.45, 0.75), rays = 16;
      for (let k = 0; k < rays; k++) {
        const a = (k / rays) * Math.PI * 2 + between(rng, -0.08, 0.08), l = r * (1 - (1 - tilt) * Math.abs(Math.sin(a)));
        out.push({ t: 'leaf', x: tx, y: ty, angle: a, len: l, wid: r * 0.32, shape: 'oval', teeth: 0, rgb: vary(rng, [238, 236, 226], 0.04), vein: [214, 214, 206], h: 0.8 });
      }
      out.push({ t: 'dot', x: tx, y: ty, rx: r * 0.32, ry: r * 0.32 * tilt, rgb: vary(rng, [226, 178, 40], 0.06), h: 1 });
    }
    return out;
  },
  // Fireweed: one or two tall stems with narrow alternate leaves, ending in a long raceme of magenta flowers, buds at the top.
  fireweed: (rng) => {
    const out: Stroke[] = [], n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const x = 0.5 + (n > 1 ? (i - 0.5) * 0.2 : 0), s = stalk(rng, x, x + between(rng, -0.05, 0.05), between(rng, 0.03, 0.1), 0.016, [96, 84, 60]);
      out.push(s.stroke);
      for (let k = 0; k < 9; k++) {
        const p = along(s.pts, 0.08 + k * 0.05), side = k % 2 ? 1 : -1, l = between(rng, 0.12, 0.16) * (1 - k * 0.05), c = vary(rng, [62, 98, 50], 0.08);
        out.push({ t: 'leaf', x: p.x, y: p.y, angle: -Math.PI / 2 + side * between(rng, 0.7, 1.0), len: l, wid: l * 0.22, shape: 'lance', teeth: 0, rgb: c,
          vein: mixRgb(c, [170, 190, 150], 0.6), h: 0.5 });
      }
      for (let k = 0; k < 11; k++) { // four-petalled flowers round the raceme, buds above
        const t = 0.55 + k * 0.04, p = along(s.pts, t), side = k % 2 ? 1 : -1, bud = t > 0.88;
        const x = p.x + side * between(rng, 0.02, 0.035), y = p.y, r = bud ? 0.01 : 0.017;
        if (bud) {
          out.push({ t: 'dot', x, y, rx: r * 0.7, ry: r, rgb: vary(rng, [150, 48, 96], 0.08), h: 0.8 });
          continue;
        }
        for (let q = 0; q < 4; q++) {
          const a = (q / 4) * Math.PI * 2 + 0.4;
          out.push({ t: 'dot', x: x + Math.cos(a) * r * 0.6, y: y + Math.sin(a) * r * 0.6, rx: r * 0.62, ry: r * 0.5, rgb: vary(rng, [190, 84, 150], 0.08), h: 0.85 });
        }
        out.push({ t: 'dot', x, y, rx: r * 0.25, ry: r * 0.25, rgb: [240, 200, 230], h: 1 });
      }
    }
    return out;
  },
  // Harebells: wiry, arching stems, each nodding a single blue-violet bell.
  harebell: (rng) => {
    const out = basal(rng, 4, [0.06, 0.1], 0.35, [76, 112, 56]), n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const tx = between(rng, 0.2, 0.8), ty = between(rng, 0.2, 0.55), s = stalk(rng, 0.5 + between(rng, -0.1, 0.1), tx, ty, 0.007, [84, 112, 60]);
      const c = vary(rng, [104, 112, 214], 0.08), l = between(rng, 0.07, 0.09);
      out.push(s.stroke);
      out.push({ t: 'leaf', x: tx, y: ty, angle: Math.PI / 2 + between(rng, -0.5, 0.5), len: l, wid: l * 0.8, shape: 'round', teeth: 5, rgb: c,
        vein: mixRgb(c, [60, 60, 150], 0.5), h: 0.8 });
    }
    return out;
  },
};

/** The strokes that paint card `kind` (same kind and seed, same strokes); every one lies inside the card. */
export function cardStrokes(kind: CardKind, seed: number): Stroke[] {
  const recipe = kind in FLOWER_RECIPES ? FLOWER_RECIPES[kind as FlowerCard] : RECIPES[kind as Exclude<CardKind, FlowerCard>];
  return recipe(mulberry32(seed)).map(fit).filter((s): s is Stroke => s !== null);
}

/** Each kind's own seed, so a kind always paints the same card. */
export const cardSeed = (kind: CardKind) => parseInt(fnv1a(`card:${kind}`), 16);

/**
 * Give fully transparent pixels (RGBA bytes, in place) the average colour of the opaque ones, so filtering and mipmaps
 * blend leaf edges with leaf colour instead of black.
 */
export function bleed(d: Uint8ClampedArray | Uint8Array): void {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  if (!n) return;
  [r, g, b] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
}

// ---------- painting (browser only) ----------

type Ctx = OffscreenCanvasRenderingContext2D;
const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
const grey = (h: number) => css([clamp255(h * 255), clamp255(h * 255), clamp255(h * 255)]);
const lighter = (c: RGB, k: number): RGB => [clamp255(c[0] * k + 12), clamp255(c[1] * k + 12), clamp255(c[2] * k)];

/** A tapered ribbon along a polyline, filled. */
function ribbon(g: Ctx, pts: number[], w0: number, w1: number) {
  const n = pts.length / 2, left: number[] = [], right: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1];
    const l = Math.hypot(dx, dy) || 1, w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push(pts[2 * i] - (dy / l) * w, pts[2 * i + 1] + (dx / l) * w);
    right.push(pts[2 * i] + (dy / l) * w, pts[2 * i + 1] - (dx / l) * w);
  }
  g.beginPath();
  g.moveTo(left[0], left[1]);
  for (let i = 2; i < left.length; i += 2) g.lineTo(left[i], left[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) g.lineTo(right[i], right[i + 1]);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(pts[0], pts[1], w0 / 2, 0, Math.PI * 2);
  g.fill();
}
const polygon = (g: Ctx, p: number[]) => {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath();
};
/** Points on a leaf's midrib (`u` along it) and out towards its edge (`v` of the half-width, signed by side). */
const leafPoint = (s: Leaf, u: number, v: number) => {
  const c = Math.cos(s.angle), sn = Math.sin(s.angle), w = halfWidth(s, u) * v, a = u * s.len;
  return [s.x + c * a - sn * w, s.y + sn * a + c * w];
};
/** The midrib and side veins of a leaf. */
function veins(g: Ctx, s: Leaf, w: number) {
  ribbon(g, [...leafPoint(s, 0, 0), ...leafPoint(s, 0.5, 0), ...leafPoint(s, 0.94, 0)], w, w * 0.3);
  const pairs = s.shape === 'pinna' ? 0 : s.shape === 'lance' ? 9 : 6;
  for (let i = 1; i <= pairs; i++) for (const side of [-1, 1]) {
    const u = 0.08 + (0.78 * i) / (pairs + 1);
    ribbon(g, [...leafPoint(s, u, 0), ...leafPoint(s, u + 0.08, side * 0.5), ...leafPoint(s, u + 0.14, side * 0.88)], w * 0.45, w * 0.15);
  }
}

function paintColour(g: Ctx, s: Stroke) {
  g.globalAlpha = s.a ?? 1;
  g.fillStyle = css(s.rgb);
  if (s.t === 'line') {
    ribbon(g, s.pts, s.w0, s.w1);
    if (s.w0 > 0.005) { // a sheen along one side: round needles and stems
      g.globalAlpha = 0.35 * (s.a ?? 1);
      g.fillStyle = css(lighter(s.rgb, 1.35));
      ribbon(g, s.pts.map((v, i) => v - (i % 2 ? 1 : 0) * s.w0 * 0.18), s.w0 * 0.35, s.w1 * 0.3);
    }
  } else if (s.t === 'dot') {
    g.beginPath();
    g.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    const outline = leafOutline(s);
    polygon(g, outline);
    g.fill();
    g.save();
    polygon(g, outline);
    g.clip();
    // folded along the midrib: one half a little in shade
    const [bx, by] = leafPoint(s, 0, 0), [tx, ty] = leafPoint(s, 1, 0), px = -(ty - by), py = tx - bx;
    g.globalAlpha = 0.13;
    g.fillStyle = '#000';
    g.beginPath();
    g.moveTo(bx - (tx - bx), by - (ty - by));
    g.lineTo(tx + (tx - bx), ty + (ty - by));
    g.lineTo(tx + (tx - bx) + px, ty + (ty - by) + py);
    g.lineTo(bx - (tx - bx) + px, by - (ty - by) + py);
    g.fill();
    // light through the blade: brighter towards the rim
    g.globalAlpha = 0.45;
    g.strokeStyle = css(lighter(s.rgb, 1.3));
    g.lineWidth = Math.max(0.004, s.wid * 0.08);
    polygon(g, outline);
    g.stroke();
    g.globalAlpha = 0.6;
    g.fillStyle = css(s.vein);
    veins(g, s, Math.max(0.003, s.wid * 0.055));
    g.restore();
  }
  g.globalAlpha = 1;
}

function paintHeight(g: Ctx, s: Stroke) {
  g.globalAlpha = s.a ?? 1;
  g.fillStyle = grey(s.h);
  if (s.t === 'line') {
    ribbon(g, s.pts, s.w0, s.w1);
    g.fillStyle = grey(Math.min(1, s.h + 0.18)); // round: higher along the middle
    ribbon(g, s.pts, s.w0 * 0.4, s.w1 * 0.4);
  } else if (s.t === 'dot') {
    const r = Math.max(s.rx, s.ry), grad = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    grad.addColorStop(0, grey(s.h));
    grad.addColorStop(1, grey(Math.max(0, s.h - 0.3)));
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    const outline = leafOutline(s);
    polygon(g, outline);
    g.fill();
    g.save();
    polygon(g, outline);
    g.clip();
    g.strokeStyle = grey(s.h - 0.15); // the rim curls down
    g.lineWidth = Math.max(0.005, s.wid * 0.1);
    polygon(g, outline);
    g.stroke();
    g.fillStyle = grey(s.h - 0.18); // veins sit in grooves
    veins(g, s, Math.max(0.003, s.wid * 0.05));
    g.restore();
  }
  g.globalAlpha = 1;
}

/** Paint card `kind` at `size` px: colour (RGBA, unpremultiplied, transparent around the sprig) and height (grey, same alpha). */
export function paintCard(kind: CardKind, size: number, seed = cardSeed(kind)): { color: ImageData; height: ImageData } {
  const make = () => {
    const g = new OffscreenCanvas(size, size).getContext('2d')!;
    g.scale(size, size);
    return g;
  };
  const cg = make(), hg = make();
  if (kind === 'birchBark') {
    cg.fillStyle = css(BARK_BG);
    cg.fillRect(0, 0, 1, 1);
    hg.fillStyle = grey(0.5);
    hg.fillRect(0, 0, 1, 1);
  }
  for (const s of cardStrokes(kind, seed)) {
    paintColour(cg, s);
    paintHeight(hg, s);
  }
  const color = cg.getImageData(0, 0, size, size), height = hg.getImageData(0, 0, size, size);
  for (let i = 3; i < color.data.length; i += 4) height.data[i] = color.data[i];
  bleed(color.data);
  bleed(height.data);
  return { color, height };
}

/** Image rows top-first (canvas) into a texture with the top at v = 1 (three's image convention). */
function toTexture(img: ImageData, srgb: boolean, tile: boolean): DataTexture {
  const { width: w, height: h, data } = img, flipped = new Uint8Array(data.length), row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(data.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  const t = new DataTexture(flipped, w, h, RGBAFormat, UnsignedByteType);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = tile ? RepeatWrapping : ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** An owner-supplied atlas at `public/assets/textures/leaves/<kind>.png`, as colour, with height from its brightness (null if absent). */
async function suppliedCard(kind: CardKind, size: number): Promise<{ color: ImageData; height: ImageData } | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}assets/textures/leaves/${kind}.png`);
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return null; // the dev server answers missing files with HTML
    const bmp = await createImageBitmap(await res.blob(), { resizeWidth: size, resizeHeight: size, premultiplyAlpha: 'none' });
    const g = new OffscreenCanvas(size, size).getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const color = g.getImageData(0, 0, size, size), height = new ImageData(size, size), c = color.data, h = height.data;
    for (let i = 0; i < c.length; i += 4) h[i] = h[i + 1] = h[i + 2] = Math.round(0.3 * c[i] + 0.59 * c[i + 1] + 0.11 * c[i + 2]), h[i + 3] = c[i + 3];
    bleed(c);
    return { color, height };
  } catch {
    return null;
  }
}

/**
 * Textures for card `kind` at `size` px: `color` (sRGB with alpha, for alpha testing) and `height` (linear grey), with mipmaps.
 * An owner-supplied `public/assets/textures/leaves/<kind>.png` wins over the painted card. Birch bark repeats; cards clamp.
 */
export async function cardTextures(kind: CardKind, size: number): Promise<{ color: DataTexture; height: DataTexture }> {
  const img = (kind !== 'birchBark' && (await suppliedCard(kind, size))) || paintCard(kind, size);
  const tile = kind === 'birchBark';
  return { color: toTexture(img.color, true, tile), height: toTexture(img.height, false, tile) };
}
