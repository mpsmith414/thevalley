import type { Node } from 'three/webgpu';
import { abs, clamp, dot, float, floor, fract, hash, int, max, mix, select, sin, smoothstep, uint, vec3 } from 'three/tsl';
import { inferCoat } from '../recipe/hints';
import { COATS, type Coat, type Region } from '../recipe/schema';
import { add, cross, dot as dot3, len, scale, sub, v3, type Vec3 } from '../util/vec';

type F = Node<'float'>;
type C = Node<'vec3'>;

/** How a coat word draws in the fur shells (see `furMaterial`). Tuned by eye. */
export type CoatLook = {
  lean: number; // 0 stands up … 1 lies flat along the groom
  density: number; // strand cells per fur length (scales the cell size down)
  radius: number; // strand radius as a fraction of its cell (0..0.5)
  guard: number; // share of guard-hair cells (0 none … 1 every guard cell)
  guardLen: number; // guard hair length × fur length
  clump: number; // 0..1 how much strand tips gather to clump centres
  crimp: number; // 0..1 wave amplitude along the strand
  sheen: number; // specular strength for the strand lighting
  droop: number; // gravity sag × fur length
};

export const COAT_LOOK: Record<Coat, CoatLook> = {
  sleek: { lean: 0.85, density: 1.3, radius: 0.32, guard: 0.15, guardLen: 1.1, clump: 0, crimp: 0, sheen: 0.8, droop: 0.1 },
  soft: { lean: 0.55, density: 1.1, radius: 0.36, guard: 0.35, guardLen: 1.2, clump: 0.25, crimp: 0, sheen: 0.5, droop: 0.2 },
  shaggy: { lean: 0.45, density: 0.8, radius: 0.38, guard: 0.6, guardLen: 1.3, clump: 0.55, crimp: 0.15, sheen: 0.45, droop: 0.5 },
  woolly: { lean: 0.15, density: 1.6, radius: 0.42, guard: 0, guardLen: 1, clump: 0.35, crimp: 0.8, sheen: 0.15, droop: 0.1 },
  bristly: { lean: 0.25, density: 0.6, radius: 0.3, guard: 0.7, guardLen: 1.2, clump: 0, crimp: 0, sheen: 0.25, droop: 0 },
  smooth: { lean: 0.9, density: 1, radius: 0.3, guard: 0, guardLen: 1, clump: 0, crimp: 0, sheen: 0.6, droop: 0 },
  downy: { lean: 0.3, density: 1.4, radius: 0.4, guard: 0, guardLen: 1, clump: 0.4, crimp: 0.3, sheen: 0.2, droop: 0.15 },
};

const MIN_CELL = 0.0004, MAX_CELL = 0.0025;

/**
 * The strand cell size (m): clamp(furLength / (density × 8.3), 0.4 mm, 2.5 mm), about 0.12 × length at density 1, so
 * strands scale with the animal (a deer's 12 mm coat gets ~1.1 mm strands, not the old fixed 3 mm studs). 0.4 mm for
 * length ≤ 0.
 */
export function strandCell(furLength: number, density: number): number {
  if (!(furLength > 0)) return MIN_CELL;
  return Math.min(MAX_CELL, Math.max(MIN_CELL, furLength / (density * 8.3)));
}

/** The coat a region shows (its own, or inferred), or null for regions without hair or feathers. */
export function regionCoat(r: Region): Coat | null {
  if (r.covering !== 'fur' && r.covering !== 'feathers') return null;
  return r.coat ?? inferCoat(r);
}

/** Smooth (contour) feathers are drawn as feathers on the shells; downy ones, like every hair coat, as strands. */
export const drawsFeathers = (c: Coat | null) => c === 'smooth';
/** `drawsFeathers` for a coat index into COATS (-1 for none), as `RegionPack.coat` holds them. */
export const drawsFeathersAt = (coat: number) => coat >= 0 && drawsFeathers(COATS[coat]);

/**
 * A feather's vane, in feather cells (`featherCell`): `span` long down the groom from its root and at most `width` either
 * side of the shaft, × sin(π(0.15 + 0.85u)) at u along it (narrow at the root, widest two fifths along, pointed at the tip);
 * the shaft is the middle `shaft` of the vane's half-width. (Width 0.7, not 0.55: at 0.55 the 2×2×2 block searched left
 * holes, 1–3 % of a flat plane.)
 */
export const FEATHER = { span: 1.8, width: 0.7, shaft: 0.04 } as const;
/** How far a feather's root strays from its cell's centre, × the cell: rows with a little give, not a grid. */
const JITTER = 0.15;
/**
 * The 2×2×2 block of cells searched round a point is centred half a feather upstream of it, where the roots of the feathers
 * that can cover it lie (a block chosen by the groom's signs alone left more holes and more seams at the block's edges).
 */
const REACH = FEATHER.span / 2;
/** Offsets the lattice so its cell ids stay clear of zero (rest positions are within metres of the origin). */
const OFFSET = 1000;
const MIN_FCELL = 0.006, MAX_FCELL = 0.025;

/** Feather cell size (m): clamp(0.5 × furLength, 6 mm, 25 mm); 6 mm without a length. */
export function featherCell(furLength: number): number {
  if (!(furLength > 0)) return MIN_FCELL;
  return Math.min(MAX_FCELL, Math.max(MIN_FCELL, 0.5 * furLength));
}
/** `featherCell` in TSL. */
export const featherCellNode = (furLength: F) => clamp(furLength.mul(0.5), MIN_FCELL, MAX_FCELL);

/** A uint seed for a lattice cell (`o` integer-valued; negative cells are fine: i32 → u32 keeps the bits). */
export function cellSeed(o: C) {
  const u = (x: F) => int(x).toUint();
  return u(o.x).mul(uint(73856093)).bitXor(u(o.y).mul(uint(19349663))).bitXor(u(o.z).mul(uint(83492791)));
}
/** CPU twin of `cellSeed`. */
const cellSeedCPU = (o: Vec3) => (Math.imul(o.x | 0, 73856093) ^ Math.imul(o.y | 0, 19349663) ^ Math.imul(o.z | 0, 83492791)) >>> 0;
/** CPU twin of three's TSL `hash` (PCG; a float in [0, 1), rounded to f32 as on the GPU). */
function hashCPU(seed: number): number {
  const state = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> (((state >>> 28) + 4) & 31)) ^ state) >>> 0, 277803737) >>> 0;
  return Math.fround(((word >>> 22) ^ word) >>> 0) / 2 ** 32;
}
/** Where in its cell a feather is rooted, from the cell's one hash (three lanes of its bits). */
const rootOf = (o: Vec3, h: number): Vec3 => {
  const j = (x: number) => (x - 0.5) * 2 * JITTER + 0.5;
  return add(o, v3(j(h), j(frac(h * 64)), j(frac(h * 4096))));
};
const frac = (x: number) => x - Math.floor(x);
/** The vane's half-width (cells) u along it. */
const halfWidth = (u: number) => FEATHER.width * Math.sin(Math.PI * (0.15 + 0.85 * u));

/**
 * CPU twin: which feather covers point p (frontmost of the 2×2×2 block of cells half a feather upstream) and where on it
 * (u along, v across, both 0..1), or null (no groom along the surface, or a hole). The frontmost is the one rooted
 * furthest upstream: its tip lies over the roots of the next row, as on a bird (and as roof tiles do). Change it with
 * `featherAt` below.
 */
export function featherAtCPU(p: Vec3, groom: Vec3, normal: Vec3, cell: number): { id: number; u: number; v: number } | null {
  const n = scale(normal, 1 / len(normal));
  const gp = sub(groom, scale(n, dot3(groom, n)));
  const gl = len(gp);
  if (gl < 1e-4) return null;
  const gs = scale(gp, 1 / gl), b = cross(n, gs);
  const P = add(scale(p, 1 / cell), v3(OFFSET, OFFSET, OFFSET));
  const base = v3(...(['x', 'y', 'z'] as const).map((k) => Math.floor(P[k] - gs[k] * REACH - 0.5)) as [number, number, number]);
  let best: { id: number; u: number; v: number } | null = null, front = Infinity;
  for (let m = 0; m < 8; m++) {
    const o = add(base, v3(m & 1, (m >> 1) & 1, (m >> 2) & 1));
    const id = cellSeedCPU(o), c = rootOf(o, hashCPU(id)), d = sub(P, c);
    const u = dot3(d, gs) / FEATHER.span;
    if (u < 0 || u > 1) continue;
    const v = Math.abs(dot3(d, b)) / halfWidth(u);
    const k = dot3(c, gs);
    if (v < 1 && k < front) {
      front = k;
      best = { id, u, v };
    }
  }
  return best;
}

/**
 * The feather lattice in TSL (the twin of `featherAtCPU`: change them together), for `p` a rest position in metres, `gs`
 * the rest groom along the surface (unit) and `b` = normal × gs. Returns vars: found (bool), u, v, h (the feather's hash),
 * w (its half-width at u, in cells). Call it inside a `Fn`.
 */
export function featherAt(p: C, cell: F, gs: C, b: C) {
  const P = p.div(cell).add(OFFSET).toVar();
  const base = floor(P.sub(gs.mul(REACH)).sub(0.5)).toVar();
  const front = float(1e9).toVar(), u = float(0).toVar(), v = float(0).toVar(), h = float(0).toVar();
  for (let m = 0; m < 8; m++) {
    const o = base.add(vec3(m & 1, (m >> 1) & 1, (m >> 2) & 1));
    const hm = hash(cellSeed(o)).toVar();
    const c = o.add(vec3(hm, fract(hm.mul(64)), fract(hm.mul(4096))).sub(0.5).mul(2 * JITTER).add(0.5)).toVar();
    const d = P.sub(c).toVar();
    const um = dot(d, gs).div(FEATHER.span).toVar();
    const vm = abs(dot(d, b)).div(max(sin(um.mul(0.85).add(0.15).mul(Math.PI)).mul(FEATHER.width), 1e-4));
    const k = dot(c, gs).toVar();
    const take = um.greaterThanEqual(0).and(um.lessThanEqual(1)).and(vm.lessThan(1)).and(k.lessThan(front)).toVar();
    front.assign(select(take, k, front));
    u.assign(select(take, um, u));
    v.assign(select(take, vm, v));
    h.assign(select(take, hm, h));
  }
  const w = sin(u.mul(0.85).add(0.15).mul(Math.PI)).mul(FEATHER.width);
  return { found: front.lessThan(1e8), u, v, h, w };
}

/** Each feather's own shade, ± this. */
const FEATHER_TONE = 0.08;
/** How dark a feather is in the shadow of the tip lying over it (towards its root), × its colour. */
const FEATHER_SHADOW = 0.72;
/** A feather's average shade: what the pattern fades to where feathers are only a few pixels (it read as a knitted grid). */
const FEATHER_MEAN = 0.87;
/**
 * A feather's shade at (u, v) (× its colour): a darker shaft line, barbs streaking across the vane, a slightly lighter edge,
 * darker towards its root, where the tips of the row before lie over it (the overlap reads at any distance), and each
 * feather a little lighter or darker than the next. `px` is cells per pixel: the shaft and barbs fade out before they would
 * shimmer, and the whole pattern to its average where a feather is only a few pixels.
 */
export function featherShade(u: F, v: F, h: F, px: F): F {
  const fine = float(1).sub(smoothstep(0.015, 0.05, px)).toVar();
  const shaft = mix(float(1), float(0.8), select(v.lessThan(FEATHER.shaft), fine, float(0)));
  const barbs = float(0.92).add(sin(u.add(v.mul(0.5)).mul(60)).mul(0.08).mul(fine));
  const edge = mix(float(1), float(1.08), smoothstep(0.8, 1, v));
  const shadow = mix(float(FEATHER_SHADOW), float(1), smoothstep(0.35, 0.85, u));
  const tone = float(1).add(fract(h.mul(97.31)).sub(0.5).mul(2 * FEATHER_TONE));
  return mix(shaft.mul(barbs).mul(edge).mul(shadow).mul(tone), float(FEATHER_MEAN), smoothstep(0.08, 0.25, px)) as unknown as F;
}
