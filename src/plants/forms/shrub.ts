/** Shrubs: a few stems fanning out from the root, each with twigs dressed in leaf cards. */
import { v3 } from '../../util/vec';
import { between } from '../../util/rng';
import type { ShrubSpec } from '../species';
import type { PlantMesh } from '../generator';
import { type Limb, branchedLods, branchedShade, crownOf, growLimb, sprout, twigCards } from './limbs';

const DEG = Math.PI / 180;

/** Both LODs of a shrub `h` m tall (before the generator's exact height fit), within `budget`. Upright shrubs (low `spread`) get short twigs. */
export function buildShrub(s: ShrubSpec, rng: () => number, h: number, young: boolean, budget: [number, number]): [PlantMesh, PlantMesh] {
  const n = young ? Math.max(3, Math.round(s.stems * 0.6)) : s.stems, stems: Limb[] = [];
  for (let i = 0; i < n; i++) {
    const az = i * 137.5 * DEG + (rng() - 0.5) * 30 * DEG, tilt = s.spread * 70 * DEG * between(rng, 0.4, 1);
    const length = (h * between(rng, 0.75, 1)) / Math.max(0.45, Math.cos(tilt)), off = 0.04 * h;
    const dir = v3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    stems.push(growLimb(rng, v3(off * Math.cos(az), -0.03, off * Math.sin(az)), dir, length, 0.004 + 0.012 * h, 1, 2, 0.15, 4));
  }
  const maxLen = Math.max(...stems.map((b) => b.length)), count = Math.min(12, Math.max(4, Math.round(maxLen / s.leaf.size) + 3));
  const twigs = stems.flatMap((b) => sprout(rng, b, maxLen, { count, lengthFrac: 0.15 + 0.3 * s.spread, angle: 45, gravity: -0.15, maxSegs: 2, azimuth: 60 }, 2));
  const limbs = [...stems, ...twigs], c = crownOf(limbs);
  const maxTwig = Math.max(...twigs.map((t) => t.length)), cards = twigs.flatMap((t) => twigCards(rng, t, maxTwig, s.leaf, c.outward));
  return branchedLods(null, limbs, cards, s.leaf.type === 'needle', branchedShade(h, c.depth), c.outward, budget, 3);
}
