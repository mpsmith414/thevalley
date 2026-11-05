/**
 * Sharp eyes, the hawk's zoom (spec section 5): in Eyes the view narrows to about 20° where you are looking and the right
 * stick aims slowly (Ruling R12: the zoom is the Eyes view's only; Follow and Close keep their width), and in every view
 * the moving animals within its sight get a faint shimmer ring, its prey brighter. Pure: the wiring eases the camera's
 * width and puts the rings where `sharpPick` says.
 */
import type { Vec3 } from '../util/vec';
import type { AnimalPose } from './types';

/** The view narrows to this field of view across (degrees). */
export const SHARP_FOV = 20;
/** Zoomed in, the right stick aims this share as fast as it looks round, so the narrow view moves slowly across the screen. */
export const SHARP_AIM = 0.25;
/** At most this many animals shimmer at once. */
export const SHARP_MAX = 8;
/** An animal moving faster than this (m/s) is moving (it catches a sharp eye). */
const MOVING = 0.3;
/** Zoomed in, one shimmers while within this angle (degrees) of where the view looks: the zoomed view's width either side, so one just off its edge shows as you aim. */
export const SHARP_CONE = SHARP_FOV;

/** Another animal as a sharp eye sees it: where it is drawn (its pose, for its ring), how fast it moves (m/s), and whether it is the watcher's prey. */
export type Sighting = { id: string; pose: AnimalPose; speed: number; prey: boolean };

/**
 * The animals that shimmer for an eye at `eye` looking along `forward` (unit) with a sight reaching `range` m: those
 * moving within that range and within `coneDeg` degrees of where it looks (the zoom's SHARP_CONE; outside Eyes, the
 * picture's own half width), its prey first, then the nearest the middle of the view.
 */
export function sharpPick(cands: Sighting[], eye: Vec3, forward: Vec3, range: number, coneDeg = SHARP_CONE): string[] {
  const cone = Math.cos((coneDeg * Math.PI) / 180), out: { id: string; prey: boolean; cos: number }[] = [];
  for (const c of cands) {
    if (c.speed <= MOVING) continue;
    const p = c.pose.pos, dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z, d = Math.hypot(dx, dy, dz);
    if (d > range || d < 1e-6) continue;
    const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
    if (cos >= cone) out.push({ id: c.id, prey: c.prey, cos });
  }
  out.sort((a, b) => (a.prey !== b.prey ? (a.prey ? -1 : 1) : b.cos - a.cos));
  return out.slice(0, SHARP_MAX).map((c) => c.id);
}
