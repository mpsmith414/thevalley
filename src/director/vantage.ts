import { surfaceAt, type FlyWorld } from '../camera/freefly';
import { lineBlocked } from '../views/sight';
import type { Pose } from '../views/types';
import type { Vec3 } from '../util/vec';
import type { Valley } from '../valley/valley';

/** What the vantage search needs of the valley: the camera's world plus its trunks and water (the real `Valley` fits). */
export type VantageWorld = FlyWorld & Pick<Valley, 'trunksNear' | 'isWater' | 'waterLevelAt'>;

/** The camera spots tried round a subject: this many directions, at three distances and two heights. */
const DIRECTIONS = 8;
/** The camera stays at least this high (m) above the ground or water under it. */
const MIN_ABOVE = 1.5;
/** The camera never comes nearer than this (m) to a tree's bark. */
const BARK = 3;
/** When nothing passes, the search lifts every height by this much (m), up to RAISES times. */
const RAISE = 10, RAISES = 3;
/** The line of sight is checked for trunks this close (m) to it, except near the subject. */
const SIGHT_TRUNK = 0.6;
/** Trunk clearance scores up to this distance from the bark (m). */
const ROOMY = 12;
/** Where on the subject the camera looks, as a fraction of its size above its feet. */
export const AIM = 0.4;
/** How far a spot must be from the last shot's camera (m) before the variety nudge stops growing. */
const FRESH = 40;

/**
 * Find a good, safe place to film a subject from: spots on rings round it (8 directions, 3 distances in `dist`, 2 heights
 * in `up` above the subject), refusing any under the ground or water, within 3 m of a tree's bark, or that lose sight of
 * the subject (terrain along the line, trunks beside it). The rest are scored on room round the camera, the sun behind it,
 * how much of the place shows, and being away from `avoid` (the last shot's camera); if nothing passes the heights go up
 * by 10 m, up to three times. The pose looks at the subject; `rng` only breaks near-ties and turns the ring.
 */
export function findVantage(
  subject: { pos: Vec3; size: number },
  world: VantageWorld,
  o: {
    dist: [number, number]; up: [number, number];
    /** The unit direction TO the sun (as `sunDirection()` gives): the camera prefers that side, with the sun behind it. */
    sun?: Vec3; rng: () => number;
    /** The last shot's camera, to push variety. */
    avoid?: Vec3;
  },
): Pose {
  const { pos, size } = subject;
  const aim: Vec3 = { x: pos.x, y: pos.y + size * AIM, z: pos.z };
  const turn = o.rng() * Math.PI * 2;
  const sunLen = o.sun ? Math.hypot(o.sun.x, o.sun.z) : 0;
  const dists = [o.dist[0], (o.dist[0] + o.dist[1]) / 2, o.dist[1]];

  const valid = (p: Vec3) => {
    if (!world.inside(p.x, p.z) || p.y < surfaceAt(world, p.x, p.z) + MIN_ABOVE) return false;
    if (world.trunksNear(p.x, p.z, BARK).length) return false;
    if (lineBlocked(world, p, aim)) return false;
    const d = Math.hypot(aim.x - p.x, aim.y - p.y, aim.z - p.z), n = Math.ceil(d / 3);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (t < 0.85 && world.trunksNear(p.x + (aim.x - p.x) * t, p.z + (aim.z - p.z) * t, SIGHT_TRUNK).length) return false;
    }
    return true;
  };

  /** Higher is better: room, light, an open view, variety. (dx, dz) is the spot's offset from the subject. */
  const score = (p: Vec3, dx: number, dz: number, d: number) => {
    const bark = world.trunksNear(p.x, p.z, ROOMY).reduce((m, t) => Math.min(m, Math.hypot(t.x - p.x, t.z - p.z) - t.r), ROOMY);
    let s = bark / ROOMY;
    if (o.sun && sunLen > 0) s += (dx * o.sun.x + dz * o.sun.z) / (d * sunLen) * 1.5; // the camera on the sun's side, so the sun is behind it
    // how much of the place shows: the view past the subject is not a wall of ground
    const far = { x: aim.x + (aim.x - p.x), y: aim.y, z: aim.z + (aim.z - p.z) };
    if (!lineBlocked(world, p, far)) s += 0.5;
    if (o.avoid) s += Math.min(1, Math.hypot(p.x - o.avoid.x, p.z - o.avoid.z) / FRESH) * 0.5;
    return s + o.rng() * 0.05;
  };

  for (let raise = 0; raise <= RAISES; raise++) {
    let best: { p: Vec3; s: number } | undefined;
    for (let k = 0; k < DIRECTIONS; k++) {
      const a = turn + (k / DIRECTIONS) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
      for (const d of dists) for (const up of o.up) {
        const p = { x: pos.x + ux * d, y: pos.y + up + raise * RAISE, z: pos.z + uz * d };
        if (!valid(p)) continue;
        const s = score(p, ux * d, uz * d, d);
        if (!best || s > best.s) best = { p, s };
      }
    }
    if (best) return look(best.p, aim);
  }
  // Nothing passed even from the top: hang high over the far ring, clear of the ground and water.
  const p = { x: pos.x + Math.cos(turn) * dists[2], y: 0, z: pos.z + Math.sin(turn) * dists[2] };
  p.y = Math.max(pos.y + o.up[1] + (RAISES + 1) * RAISE, surfaceAt(world, p.x, p.z) + MIN_ABOVE + RAISE);
  return look(p, aim);
}

/** A pose at `from` looking at `to` (yaw 0 faces -z, positive turns left, as the free-fly camera's). */
function look(from: Vec3, to: Vec3): Pose {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return { pos: from, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
