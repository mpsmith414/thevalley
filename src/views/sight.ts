import type { FlyWorld } from '../camera/freefly';
import type { Vec3 } from '../util/vec';

/** The line-of-sight check samples the ground every this many metres along the line (at most LINE_STEPS samples). */
const LINE_STEP = 3, LINE_STEPS = 64;

/**
 * Whether the ground hides `to` from `from`: a coarse check of the height field along the line (trunks do not count,
 * nor does the water), sampled every few metres; the ends themselves are not tested.
 */
export function lineBlocked(world: Pick<FlyWorld, 'heightAt'>, from: Vec3, to: Vec3): boolean {
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), n = Math.min(LINE_STEPS, Math.ceil(d / LINE_STEP));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
    if (world.heightAt(x, z) > y) return true;
  }
  return false;
}
