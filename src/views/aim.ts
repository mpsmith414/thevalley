/**
 * Picking an animal by looking at it: which animal in free flight the valley highlights (the one nearest the centre of
 * the screen), how the highlight holds on without flickering between two deer in a herd, and the left-to-right order of
 * the animals round a locked one (what LB / RB step through). Pure: no three.js, no terrain; the caller supplies the
 * camera's eye and look direction and the line-of-sight check.
 */
import { cross, dist, dot, norm, sub, type Vec3 } from '../util/vec';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** An animal that could be aimed at: where it is, how big (m), and whether it is drawn (not stowed or too deep under water to see). */
export type Candidate = { id: string; pos: Vec3; size: number; drawn: boolean };

/** The cone is never narrower than this (rad, 10 degrees) from the centre of the screen. */
const MIN_CONE = (10 * Math.PI) / 180;
/** Round every animal an imaginary circle of this radius (m) counts as the animal: nearby ones are easier to catch. */
const CATCH_RADIUS = 1.5;
/** A new animal takes the highlight only when its angle is under this fraction of the held one's (30% nearer the centre). */
const SWITCH_RATIO = 0.7;
/** The held animal is let go after being out of the cone this long (s). */
const LET_GO_S = 0.3;
/** The default reach of the neighbour order (m) round the locked animal. */
const NEIGHBOUR_REACH = 150;
const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** How far (m) the valley will look for an animal of this size: 20 m for a frog up to 150 m for a big deer. */
export const aimReach = (size: number) => clamp(60 * size ** 0.6, 20, 150);

/** The angle (rad) off the centre of the screen an animal `distance` m away may be and still be picked: at least 10 degrees, wider when near. */
export const coneAt = (distance: number) => Math.max(MIN_CONE, Math.atan2(CATCH_RADIUS, distance));

/**
 * How far (rad) the candidate is from the centre of the screen, or null when it is not aimable: not drawn, beyond its
 * reach, or outside the cone. Occlusion is the caller's to test (see `pickAim`). This is what `AimHold.update`'s
 * `angleOf` should return for the held animal (looked up from the current candidates), so the hold knows when it has
 * left the cone.
 */
export function aimAngle(c: Candidate, eye: Vec3, forward: Vec3): number | null {
  if (!c.drawn) return null;
  const d = sub(c.pos, eye);
  const distance = Math.hypot(d.x, d.y, d.z);
  if (distance < 1e-6 || distance > aimReach(c.size)) return null;
  const angle = Math.acos(clamp(dot(d, forward) / distance, -1, 1));
  return angle <= coneAt(distance) ? angle : null;
}

/**
 * The animal nearest the centre of the screen among those drawn, in reach, inside the cone and not hidden behind the
 * terrain (`occluded(from, to)` is the coarse line check); ties go to the nearer. `forward` is the camera's unit look direction.
 */
export function pickAim(
  cands: Candidate[],
  eye: Vec3,
  forward: Vec3,
  occluded: (from: Vec3, to: Vec3) => boolean,
): { id: string; angle: number } | null {
  let best: { id: string; angle: number; d: number } | null = null;
  for (const c of cands) {
    const angle = aimAngle(c, eye, forward);
    if (angle === null) continue;
    const d = dist(c.pos, eye);
    if (best && (angle > best.angle + 1e-9 || (Math.abs(angle - best.angle) <= 1e-9 && d >= best.d))) continue;
    if (occluded(eye, c.pos)) continue;
    best = { id: c.id, angle, d };
  }
  return best && { id: best.id, angle: best.angle };
}

/**
 * The highlight's memory, so it never flickers between two deer in a herd: it holds the animal it has until a new one is
 * clearly nearer the centre (under 0.7 of the held one's angle) or the held one has been out of the cone for 0.3 s.
 */
export class AimHold {
  private held: string | null = null;
  private outFor = 0;

  /**
   * One frame (`dt` s): `pick` is this frame's `pickAim`; `angleOf(id)` gives an animal's current angle off the centre,
   * or null once it is no longer aimable (`aimAngle` is null outside the cone). Returns the id to highlight.
   */
  update(pick: { id: string; angle: number } | null, angleOf: (id: string) => number | null, dt: number): string | null {
    if (this.held === null) {
      this.held = pick ? pick.id : null;
      this.outFor = 0;
      return this.held;
    }
    const heldAngle = angleOf(this.held);
    if (heldAngle === null) {
      this.outFor += dt;
      if (this.outFor >= LET_GO_S - 1e-9) {
        this.held = pick ? pick.id : null;
        this.outFor = 0;
      }
    } else {
      this.outFor = 0;
      if (pick && pick.id !== this.held && pick.angle < SWITCH_RATIO * heldAngle) this.held = pick.id;
    }
    return this.held;
  }

  /** Hold nothing: the next frame's pick takes the highlight at once (a lock starting or ending). */
  reset(): void {
    this.held = null;
    this.outFor = 0;
  }
}

/**
 * The animals LB / RB step through from a locked one: the locked animal and every drawn one within `within` m of it,
 * ordered left to right as the camera (at `eye`, looking along the unit `forward`, up being +y) sees them. The locked
 * one is always in the list, drawn or not.
 */
export function neighbours(
  lockedId: string,
  cands: Candidate[],
  eye: Vec3,
  forward: Vec3,
  within = NEIGHBOUR_REACH,
): string[] {
  const locked = cands.find((c) => c.id === lockedId);
  if (!locked) return [lockedId];
  const right = norm(cross(forward, UP), { x: 1, y: 0, z: 0 });
  const ahead = cross(UP, right);
  const bearing = (c: Candidate) => {
    const d = sub(c.pos, eye);
    return Math.atan2(dot(d, right), dot(d, ahead));
  };
  return cands
    .filter((c) => c.id === lockedId || (c.drawn && dist(c.pos, locked.pos) <= within))
    .map((c) => ({ id: c.id, b: bearing(c) }))
    .sort((a, b) => a.b - b.b || (a.id < b.id ? -1 : 1))
    .map((c) => c.id);
}

/** The animal one step left (-1) or right (+1) of `id` in a neighbour `order`, wrapping round; `id` itself if it is not in the order. */
export const stepNeighbour = (order: string[], id: string, dir: -1 | 1): string => {
  const i = order.indexOf(id);
  return i < 0 ? id : order[(i + dir + order.length) % order.length];
};
