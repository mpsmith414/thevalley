import type { Habitat } from '../motion/actions';
import type { Vec3 } from '../util/vec';
import type { HomeRange } from '../valley/types';
import type { Valley } from '../valley/valley';

type Where = 'land' | 'water' | 'shore';
const MAX_SLOPE_DEG = 30, EDGE_MARGIN = 20, TRUNK_GAP = 0.8, DEEP = 0.6, SHORE_REACH = 6, TRIES = 60;

/** First point on an Archimedean spiral (radial step `step`, arc steps of `step`) out to `maxR` that passes `test`. */
function spiral(cx: number, cz: number, step: number, maxR: number, test: (x: number, z: number) => boolean): { x: number; z: number } | null {
  let theta = 0, r = 0;
  while (r <= maxR) {
    const x = cx + Math.cos(theta) * r, z = cz + Math.sin(theta) * r;
    if (test(x, z)) return { x, z };
    theta += step / Math.max(r, step);
    r = (step * theta) / (Math.PI * 2);
  }
  return null;
}

/**
 * One animal's ground in the Valley: its home disc, the dry land, water and shore inside it, and the way to the
 * nearest bank. Spots are random (from `rng`) but always suit the animal; if sampling finds none the nearest valid
 * spot to the home centre is used.
 */
export function valleyHabitat(valley: Valley, home: HomeRange, rng: () => number): Habitat {
  const { center, radius } = home;
  const half = valley.size / 2 - EDGE_MARGIN;

  const dry = (x: number, z: number) =>
    !valley.isWater(x, z) && valley.inside(x, z, EDGE_MARGIN) && (Math.acos(valley.normalAt(x, z).y) * 180) / Math.PI < MAX_SLOPE_DEG;
  const wetNear = (x: number, z: number) => {
    for (let k = 0; k < 8; k++) if (valley.isWater(x + Math.cos((k * Math.PI) / 4) * SHORE_REACH, z + Math.sin((k * Math.PI) / 4) * SHORE_REACH)) return true;
    return false;
  };
  /** Does the spot suit the animal? (No dice: the biome preference is only rolled when sampling.) */
  const suits = (where: Where, x: number, z: number) => {
    if (where === 'water') return valley.waterDepthAt(x, z) >= DEEP;
    if (!dry(x, z)) return false;
    if (home.medium === 'air' && where === 'land') return true; // fliers pick land targets; the rig handles altitude
    return valley.trunksNear(x, z, TRUNK_GAP).length === 0 && (where === 'land' || wetNear(x, z));
  };
  const liked = (x: number, z: number) => {
    if (home.medium === 'air' || home.prefer.length === 0) return true;
    const b = valley.biomeAt(x, z);
    return rng() < 0.3 + Math.max(...home.prefer.map((k) => b[k]));
  };
  const at = (where: Where, x: number, z: number): Vec3 => ({ x, y: where === 'water' && valley.isWater(x, z) ? valley.waterLevelAt(x, z) : valley.heightAt(x, z), z });

  return {
    heightAt: valley.heightAt,
    isWater: valley.isWater,
    randomSpot(where, frac) {
      for (let i = 0; i < TRIES; i++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * radius * frac;
        const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
        if (suits(where, x, z) && (where === 'water' || liked(x, z))) return at(where, x, z);
      }
      const p = spiral(center.x, center.z, 4, radius + 200, (x, z) => suits(where, x, z)) ?? center;
      return at(where, p.x, p.z);
    },
    nearestBank(from) {
      const w = spiral(from.x, from.z, 3, 300, (x, z) => valley.isWater(x, z));
      if (!w) return null;
      // back towards where the animal is until dry, then a little further onto the land
      let dx = from.x - w.x, dz = from.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) (dx /= d), (dz /= d);
      else (dx = 1), (dz = 0); // it is standing in the water: any way out will do
      let t = 0;
      while (valley.isWater(w.x + dx * t, w.z + dz * t)) if ((t += 0.5) > 300) return null;
      t += 0.4;
      return at('land', w.x + dx * t, w.z + dz * t);
    },
    clamp(p) {
      let x = p.x, z = p.z;
      const dx = x - center.x, dz = z - center.z, d = Math.hypot(dx, dz);
      if (d > radius) (x = center.x + (dx / d) * radius), (z = center.z + (dz / d) * radius);
      return { x: Math.min(half, Math.max(-half, x)), y: p.y, z: Math.min(half, Math.max(-half, z)) };
    },
  };
}
