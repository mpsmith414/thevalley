/** Trees: a wandering, tapering trunk; phyllotactic level-1 branches shaped by the crown profile; twigs; leaf cards. */
import { type Vec3, v3 } from '../../util/vec';
import { between } from '../../util/rng';
import type { TreeSpec } from '../species';
import type { PlantMesh } from '../generator';
import { DEG } from '../mesh';
import { FLOOR, type Limb, branchedLods, branchedShade, crownOf, growLimb, sprout, twigCards } from './limbs';

const GOLDEN = 137.5 * DEG;
const PROFILE: Record<TreeSpec['lengthProfile'], (u: number) => number> = {
  conical: (u) => 1 - u,
  oval: (u) => Math.sin(Math.PI * u),
  'high-round': (u) => Math.sin(Math.PI * (0.3 + 0.7 * u)),
};

/** Both LODs of a tree `h` m tall (before the generator's exact height fit), within `budget`. Young trees get fewer branches. */
export function buildTree(s: TreeSpec, rng: () => number, h: number, young: boolean, budget: [number, number]): [PlantMesh, PlantMesh] {
  // Trunk: a gently wandering spline (upright at the foot), set just into the ground, with a root flare.
  const base = FLOOR, len = h * 0.97 - base, R = s.trunkRadius * Math.pow(h / ((s.height[0] + s.height[1]) / 2), 0.8);
  const wave = () => ({ a: between(rng, 0.6, 1.2), b: between(rng, 2, 3.5), p: rng() * 2 * Math.PI, q: rng() * 2 * Math.PI });
  const wx = wave(), wz = wave();
  const drift = (w: typeof wx, t: number) => s.trunkWander * Math.pow(t, 1.2) * (0.7 * Math.sin(2 * Math.PI * w.a * t + w.p) + 0.3 * Math.sin(2 * Math.PI * w.b * t + w.q));
  const trunkAt = (t: number): Vec3 => v3(drift(wx, t), base + t * len, drift(wz, t));
  const radiusAt = (t: number) => R * (0.15 + 0.85 * Math.pow(1 - t, s.taper)) * (1 + 0.5 * Math.exp(-(t * len) / 0.3));
  const segs = Math.ceil(len / 0.5), trunk: Limb = { pts: [], rad: [], level: 0, length: len, reach0: 0, reach1: 0 };
  for (let i = 0; i <= segs; i++) trunk.pts.push(trunkAt(i / segs)), trunk.rad.push(radiusAt(i / segs));
  trunk.pts[0] = v3(trunk.pts[1].x, base, trunk.pts[1].z); // a vertical foot keeps the flared base ring level

  // Level-1 branches up the crown, 137.5° apart; crooked trees (high trunkWander) get more irregular crowns, and
  // young trees keep branches lower down.
  const n1 = young ? Math.max(4, Math.round(s.branches[0] * 0.6)) : s.branches[0];
  const maxLen = s.length * h, irregular = 0.15 + 0.4 * s.trunkWander, t0 = (s.crownStart * (young ? 0.6 : 1) * h - base) / len;
  const l1: Limb[] = [];
  for (let i = 0; i < n1; i++) {
    const u = Math.min(1, Math.max(0, (i + 0.5 + (rng() - 0.5) * 0.6) / n1)), t = t0 + (0.985 - t0) * u;
    const az = i * GOLDEN + (rng() - 0.5) * 25 * DEG, a = ((s.angle + (s.angleTop - s.angle) * u) + (rng() - 0.5) * 12) * DEG;
    const length = Math.max(0.06 * maxLen, maxLen * PROFILE[s.lengthProfile](u) * (1 + (rng() - 0.5) * 2 * irregular));
    const dir = v3(Math.sin(a) * Math.cos(az), Math.cos(a), Math.sin(a) * Math.sin(az));
    l1.push(growLimb(rng, trunkAt(t), dir, length, Math.max(0.012, radiusAt(t) * 0.55 * Math.sqrt(length / maxLen)), 1, s.levels, s.gravity, 5));
  }
  // Twigs: the same rule at a smaller scale, drooping more on each level. A high-round (pine-like) crown carries its
  // twigs on the outer part of each branch only, so foliage gathers in clumps with gaps between them.
  const twigs = young ? 0.7 : 1, spray = s.levels === 3 ? 70 : 35, from = s.lengthProfile === 'high-round' ? 0.45 : 0.15;
  const l2 = l1.flatMap((b) => sprout(rng, b, maxLen, { count: s.branches[1] * twigs, lengthFrac: 0.42, angle: 50, gravity: s.gravity - 0.3, maxSegs: 2, azimuth: spray, from }, s.levels));
  const l2Max = Math.max(...l2.map((b) => b.length));
  const l3 = s.levels === 3
    ? l2.flatMap((b) => sprout(rng, b, l2Max, { count: s.branches[2], lengthFrac: 0.5, angle: 45, gravity: s.gravity - 0.6, maxSegs: 1, azimuth: 80 }, s.levels))
    : [];
  const limbs = [...l1, ...l2, ...l3], last = s.levels === 3 ? l3 : l2;

  const c = crownOf(limbs), shade = branchedShade(h, c.depth);
  const maxTwig = Math.max(...last.map((t) => t.length)), cards = last.flatMap((t) => twigCards(rng, t, maxTwig, s.leaf, c.outward));
  return branchedLods(trunk, limbs, cards, s.leaf.type === 'needle', shade, c.outward, budget);
}
