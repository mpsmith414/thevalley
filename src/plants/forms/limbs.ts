/** Branch skeletons and foliage shared by trees and shrubs: grow limbs, sprout children, dress twigs with leaf cards. */
import { type Vec3, v3, add, sub, scale, dot, cross, norm, lerp } from '../../util/vec';
import { between } from '../../util/rng';
import type { LeafSpec } from '../species';
import type { PlantMesh } from '../generator';
import { DEG, UP, MeshBuilder, type Card, type Shade, card, cardBottom, crown, evenly, mergeCards, perpendicular, rotate, tube } from '../mesh';

/** Nothing of a tree or shrub reaches below this (m); it sits at the terrain height minus a few centimetres. */
export const FLOOR = -0.08;

/** One branch (or stem, or twig): points along it with radii, its level (1 = off the trunk) and reach at base and tip. */
export type Limb = { pts: Vec3[]; rad: number[]; level: number; length: number; reach0: number; reach1: number };
/** How one level of children sprouts from its parent. */
export type Sprout = { count: number; lengthFrac: number; angle: number /*deg from parent*/; gravity: number; maxSegs: number; azimuth: number /*deg of roll jitter*/; from?: number /*first fraction along the parent, default 0.15*/ };

/**
 * Grows a limb from `start` along `dir`: `gravity` bends it up (+) or down (−) over its whole length; a little wobble
 * keeps it natural. Sections every 0.5 m, at most `maxSegs`. Radius tapers to 20% at the tip. A limb that droops to
 * the ground runs along it instead of into it (its surface stays above `FLOOR`).
 */
export function growLimb(rng: () => number, start: Vec3, dir: Vec3, length: number, r0: number, level: number, levels: number,
  gravity: number, maxSegs: number): Limb {
  const segs = Math.max(1, Math.min(maxSegs, Math.ceil(length / 0.5))), ds = length / segs;
  const pts = [start], rad = [r0];
  let d = norm(dir), p = start;
  for (let i = 1; i <= segs; i++) {
    const side = perpendicular(d);
    d = norm(add(add(d, scale(UP, (gravity * 1.6) / segs)), scale(rotate(side, d, rng() * 2 * Math.PI), 0.12 * (rng() - 0.5))));
    const r = r0 * (1 - (0.8 * i) / segs), prev = p;
    p = add(p, scale(d, ds));
    if (p.y - r < FLOOR) (p = v3(p.x, FLOOR + r, p.z)), (d = norm(sub(p, prev), d));
    pts.push(p);
    rad.push(r);
  }
  return { pts, rad, level, length, reach0: (level - 1) / levels, reach1: level / levels };
}

/** Point, direction, radius and reach at fraction `s` (0..1) along a limb. */
export function limbAt(l: Limb, s: number) {
  const n = l.pts.length - 1, f = Math.min(n - 1e-9, Math.max(0, s * n)), i = Math.floor(f), t = f - i;
  return {
    p: lerp(l.pts[i], l.pts[i + 1], t), d: norm(sub(l.pts[i + 1], l.pts[i])), r: l.rad[i] + (l.rad[i + 1] - l.rad[i]) * t,
    reach: l.reach0 + (l.reach1 - l.reach0) * s,
  };
}

/** Children of `parent` (`sp.count` of them, fewer on short parents), alternating sides in the parent's spray plane. */
export function sprout(rng: () => number, parent: Limb, maxParentLength: number, sp: Sprout, levels: number): Limb[] {
  const n = Math.max(1, Math.round(sp.count * Math.sqrt(parent.length / maxParentLength))), out: Limb[] = [];
  for (let k = 0; k < n; k++) {
    const s0 = sp.from ?? 0.15, s = s0 + ((0.95 - s0) * (k + 0.5 + (rng() - 0.5) * 0.5)) / n, at = limbAt(parent, Math.min(0.98, s));
    const flat = cross(UP, at.d), side0 = dot(flat, flat) < 1e-6 ? perpendicular(at.d) : norm(flat);
    const side = rotate(scale(side0, k % 2 ? 1 : -1), at.d, (rng() - 0.5) * 2 * sp.azimuth * DEG);
    const a = (sp.angle + (rng() - 0.5) * 20) * DEG, dir = add(scale(at.d, Math.cos(a)), scale(side, Math.sin(a)));
    const length = parent.length * sp.lengthFrac * (1 - 0.55 * s) * between(rng, 0.8, 1.15);
    out.push(growLimb(rng, at.p, dir, length, Math.max(0.003, at.r * 0.55), parent.level + 1, levels, sp.gravity, sp.maxSegs));
  }
  return out;
}

/** The crown's bounding ellipsoid from its limbs: centre height and radii. */
export function crownOf(limbs: Limb[]) {
  let y0 = Infinity, y1 = -Infinity, r = 0;
  for (const l of limbs) for (const p of l.pts) (y0 = Math.min(y0, p.y)), (y1 = Math.max(y1, p.y)), (r = Math.max(r, Math.hypot(p.x, p.z)));
  return crown((y0 + y1) / 2, r + 0.3, (y1 - y0) / 2 + 0.3);
}

/**
 * Leaf cards along a twig's outer part: they face outward from the crown (`outward`) with ±30° jitter and point
 * roughly along the twig, alternating sides. Shorter twigs (relative to `maxTwig`) get smaller cards, so tops stay pointed.
 */
export function twigCards(rng: () => number, twig: Limb, maxTwig: number, leaf: LeafSpec, outward: (p: Vec3) => Vec3): Card[] {
  const sizeK = 0.55 + 0.45 * Math.sqrt(Math.min(1, twig.length / maxTwig));
  const out: Card[] = [], s0 = leaf.type === 'needle' ? 0.35 : 0.2, jit = 30 * DEG;
  for (let k = 0; k < leaf.perTwig; k++) {
    const at = limbAt(twig, s0 + ((1 - s0) * (k + 0.5 + (rng() - 0.5) * 0.6)) / leaf.perTwig);
    const o = outward(at.p), normal = rotate(o, rotate(perpendicular(o), o, rng() * 2 * Math.PI), (rng() - 0.5) * 2 * jit);
    const flat = cross(at.d, UP), side = dot(flat, flat) < 1e-6 ? perpendicular(at.d) : norm(flat);
    const a = add(scale(at.d, 0.8), scale(side, k % 2 ? 0.5 : -0.5));
    const axis = rotate(norm(sub(a, scale(normal, dot(a, normal))), perpendicular(normal)), normal, (rng() - 0.5) * 2 * jit);
    const size = leaf.size * sizeK * between(rng, 0.85, 1.15);
    out.push({ p: sub(at.p, scale(axis, size * 0.1)), axis, normal, size, reach: at.reach, level: twig.level });
  }
  return out;
}

/** Keeps every `k`-th point of a path (always the first and last): a coarser path for LOD1. */
export function coarsen(pts: Vec3[], k: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < pts.length - 1; i += k) ids.push(i);
  ids.push(pts.length - 1);
  return ids;
}

/** Tube sides per limb level at LOD0 (index = level; 0 = trunk). */
const SIDES0 = [8, 5, 3, 3];

/**
 * Both LODs of a branched plant. LOD0: every limb, leaf cards capped (evenly) to fit `budget[0]`. LOD1: the trunk and
 * level-1 limbs only as coarse 5-sided tubes, cards merged into a quarter as many at twice the size (fewer if the
 * budget needs it). `trunk` may be absent (shrubs); `sides1` overrides LOD1 tube sides.
 */
export function branchedLods(trunk: Limb | null, limbs: Limb[], cards: Card[], needle: boolean, shade: Shade,
  outward: (p: Vec3) => Vec3, budget: [number, number], sides1 = 5): [PlantMesh, PlantMesh] {
  const perCard = needle ? 4 : 2, all = trunk ? [trunk, ...limbs] : limbs;
  const limbTube = (mb: MeshBuilder, l: Limb, ids: number[], sides: number) =>
    tube(mb, ids.map((i) => l.pts[i]), ids.map((i) => l.rad[i]), sides, l.level, shade,
      (j) => l.reach0 + ((l.reach1 - l.reach0) * ids[j]) / (l.pts.length - 1));

  const mb0 = new MeshBuilder();
  mb0.begin('bark');
  for (const l of all) limbTube(mb0, l, l.pts.map((_, i) => i), SIDES0[l.level]);
  mb0.begin('leaf');
  const cards0 = evenly(cards, Math.max(0, Math.floor((budget[0] - mb0.tris) / perCard))).map((c) => lift(c, needle));
  for (const c of cards0) card(mb0, c, needle, outward, shade);

  const mb1 = new MeshBuilder();
  mb1.begin('bark');
  for (const l of all.filter((l) => l.level <= 1)) limbTube(mb1, l, l.level === 0 ? coarsen(l.pts, 2) : coarsen(l.pts, Math.ceil((l.pts.length - 1) / 2)), sides1);
  mb1.begin('leaf');
  const n1 = Math.min(Math.floor(cards0.length / 4), Math.floor((budget[1] - mb1.tris) / perCard));
  for (const c of mergeCards(cards0, Math.max(0, n1))) card(mb1, lift(c, needle), needle, outward, shade);
  return [mb0.build(), mb1.build()];
}

/** Raises a card that would dip below `FLOOR` just enough to clear it. */
const lift = (c: Card, crossed: boolean): Card => {
  const below = FLOOR - cardBottom(c, crossed);
  return below > 0 ? { ...c, p: v3(c.p.x, c.p.y + below, c.p.z) } : c;
};

/** Plant-wide shading: wind weight grows with height (of `height`) and reach; AO darkens towards the crown centre. */
export const branchedShade = (height: number, depth: (p: Vec3) => number): Shade => (p, reach) => [
  Math.min(1, 0.45 * Math.min(1, Math.max(0, p.y / height)) + 0.55 * reach),
  Math.min(1, Math.max(0.25, 0.25 + 0.75 * depth(p))),
];
