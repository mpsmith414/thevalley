/** What the soundscape needs to know about the listener's surroundings, read from the Valley (pure, given the Valley). */
import type { Valley } from '../valley/valley';

/** Metres between probes of the lake search, the default search limit, and how far the camera moves before searching again. */
const STEP = 2, LIMIT = 100, RECHECK = 5;

/**
 * Metres from (x, z) to the nearest point where `isLake` holds: a spiral of square rings, `step` m apart, out to `limit` m
 * (returned when nothing is found). Stops as soon as no further ring can hold a nearer point.
 */
export function lakeDistance(isLake: (x: number, z: number) => boolean, x: number, z: number, limit = LIMIT, step = STEP): number {
  if (isLake(x, z)) return 0;
  let best = limit;
  const rings = Math.ceil(limit / step);
  for (let r = 1; r <= rings && r * step < best; r++) {
    for (let i = -r; i <= r; i++) {
      // the ring's four sides: top and bottom rows in full, left and right columns without their corners
      const probes = Math.abs(i) === r ? [[i, -r], [i, r]] : [[i, -r], [i, r], [-r, i], [r, i]];
      for (const [a, b] of probes) {
        const d = step * Math.hypot(a, b);
        if (d < best && isLake(x + a * step, z + b * step)) best = d;
      }
    }
  }
  return best;
}

/** The mean forest weight of 8 points `r` m around (x, z). */
export function forestAround(valley: Valley, x: number, z: number, r = 15): number {
  let sum = 0;
  for (let k = 0; k < 8; k++) sum += valley.biomeAt(x + r * Math.cos((k * Math.PI) / 4), z + r * Math.sin((k * Math.PI) / 4)).forest;
  return sum / 8;
}

export type Place = { heightAboveGround: number; lakeDistance: number; riverDistance: number; riverSlope: number; forestAround: number };

/**
 * The listener's place at (x, y, z): height above the ground (or water), distances to the lake and river, the river's slope at
 * its nearest point, and the forest around. The lake search reruns only once the camera has moved `RECHECK` m.
 */
export function listenerPlace(valley: Valley, isLake: (x: number, z: number) => boolean) {
  let at = { x: NaN, z: NaN, d: LIMIT };
  return (x: number, y: number, z: number): Place => {
    if (!(Math.hypot(x - at.x, z - at.z) < RECHECK)) at = { x, z, d: lakeDistance(isLake, x, z) };
    const floor = valley.isWater(x, z) ? Math.max(valley.heightAt(x, z), valley.waterLevelAt(x, z)) : valley.heightAt(x, z);
    const river = valley.distanceToRiver(x, z);
    return {
      heightAboveGround: Math.max(0, y - floor), lakeDistance: at.d, riverDistance: river.d, riverSlope: river.sample.slope,
      forestAround: forestAround(valley, x, z),
    };
  };
}
