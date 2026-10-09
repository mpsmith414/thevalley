import type { Pt } from '../valley/types';

/** How far ahead an animal looks for trunks in its way (m), and the gap it keeps from the bark. */
const LOOK_AHEAD = 6, MARGIN = 0.3;

/**
 * A side step round the nearest trunk that blocks the straight way from `pos` to `target` within the next 6 m, or null
 * when the way is clear. A trunk blocks when the path passes within `r + bodyRadius + 0.3` of its centre; the waypoint
 * sits 1.5 times that from the centre, square to the path, on the side that needs the smaller turn.
 */
export function avoid(pos: Pt, target: Pt, trunks: { x: number; z: number; r: number }[], bodyRadius: number): Pt | null {
  const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) return null;
  const ux = dx / d, uz = dz / d, reach = Math.min(LOOK_AHEAD, d);
  let best: { t: number; x: number; z: number; R: number; side: number } | null = null;
  for (const c of trunks) {
    const R = c.r + bodyRadius + MARGIN;
    const along = (c.x - pos.x) * ux + (c.z - pos.z) * uz; // distance along the path to the trunk's closest approach
    const side = (c.x - pos.x) * -uz + (c.z - pos.z) * ux; // signed offset of the trunk from the path (+ to the left)
    if (Math.abs(side) >= R) continue;
    const t = along - Math.sqrt(R * R - side * side); // where the path first touches the circle
    if (along < 0 || t > reach) continue; // behind (or being passed), or beyond the look-ahead (or the target)
    if (!best || t < best.t) best = { t, x: c.x, z: c.z, R, side };
  }
  if (!best) return null;
  // pass on the side away from the trunk's centre: the smaller turn
  const s = best.side > 0 ? -1 : 1;
  return { x: best.x - uz * s * 1.5 * best.R, z: best.z + ux * s * 1.5 * best.R };
}
