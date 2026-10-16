/** The chase camera at the end of an arrival (arrival v2): behind and a little above the lead animal, lagging smoothly. */
import { MAX_PITCH, surfaceAt, type FlyWorld } from '../camera/freefly';
import type { Vec3 } from '../util/vec';

/** Metres above the ground (or water) the camera keeps at the least. */
export const FOLLOW_CLEAR = 1.5;

/**
 * How far behind and above a lead `size` m long the camera follows, and how high above it it looks: 6.5 lengths back
 * (3.5–9 m), 0.4 of that up (1.6–3.5 m), half a length up (0.3–0.8 m), so the lead fills a good part of the picture.
 * No size: the largest (9 m, 3.5 m).
 */
export function followFraming(size = Infinity): { back: number; up: number; lookUp: number } {
  const back = Math.min(9, Math.max(3.5, 6.5 * size));
  return { back, up: Math.min(3.5, Math.max(1.6, back * 0.4)), lookUp: Math.min(0.8, Math.max(0.3, size / 2)) };
}
/** Time constants (s): the position's lag, the look's, and how slowly "behind" turns with the lead. */
const TAU = 0.9, TAU_LOOK = 0.4, TAU_TURN = 1.6;
/** The camera never moves faster than this (m/s), so a change of side is a glide, not a jump. */
export const FOLLOW_MAX_SPEED = 12;
/**
 * The valley knows trunks only (x, z, r), not crowns, so generous gaps stand in for the leaves: a trunk this close (m,
 * past its bark) to the line to the lead is in the way, and the camera wants none this close to itself; it is never
 * nearer the bark than BARK.
 */
const GAP = 2, CROWN = 3, BARK = 1;
/**
 * Where it tries to stand while a tree is in the way: swung round the lead (radians off straight behind), then nearer
 * (a fraction of its distance back); and the rise when nothing clears.
 */
const SWINGS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4], NEARER = [1, 0.7];
const RISE = 3;
/** Swung or nearer, it goes back to straight behind once that has been clear this long (s): no flicking between them. */
const SETTLE = 0.8;
/** The lead moves at least this fast (m/s) for "behind" to follow its way. */
const MOVING = 0.3;

export type Pose = { pos: Vec3; yaw: number; pitch: number };
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/**
 * Points along the line from `a` to `b` (every metre, the last 1.5 m left out: the lead's own ground) that a trunk or the
 * ground blocks; with `first`, it stops at the first (all that "is it clear?" needs).
 */
function blockers(w: FlyWorld, a: Vec3, b: Vec3, first = false): number {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d));
  let count = 0;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    if (d * (1 - s) < 1.5) break;
    const x = a.x + (b.x - a.x) * s, y = a.y + (b.y - a.y) * s, z = a.z + (b.z - a.z) * s;
    if (w.trunksNear(x, z, GAP).length || surfaceAt(w, x, z) > y) {
      count++;
      if (first) break;
    }
  }
  return count;
}

/**
 * Follows a moving target from behind (its way of walking, eased) and above. Each frame it chooses where it would like
 * to be — straight behind, or swung round the lead when a trunk is on the line, or higher when nothing clears — and
 * eases there (never faster than FOLLOW_MAX_SPEED), keeps off the bark and above the ground, and eases its look.
 */
export class FollowCam {
  pos: Vec3;
  look: Vec3;
  private heading: number;
  private last: Vec3;
  private swing = 0;
  private near = 1;
  /** Seconds straight behind has been clear while it stood elsewhere. */
  private behindClear = 0;
  private readonly framing: ReturnType<typeof followFraming>;

  /** From the camera's pose now (`pos`, looking at `look`), following `target`, a creature `size` m long. */
  constructor(pos: Vec3, look: Vec3, target: Vec3, size?: number) {
    this.framing = followFraming(size);
    this.pos = { ...pos };
    this.look = { ...look };
    this.last = { ...target };
    // "behind" starts as where the camera already is, so the first frames do not swing round
    this.heading = Math.atan2(target.z - pos.z, target.x - pos.x);
  }

  /** One frame of `dt` s following `target` (its ground or body point) in `world`: the camera's pose. */
  update(dt: number, target: Vec3, world: FlyWorld): Pose {
    const mx = target.x - this.last.x, mz = target.z - this.last.z;
    if (dt > 0 && Math.hypot(mx, mz) > MOVING * dt) this.heading += wrap(Math.atan2(mz, mx) - this.heading) * (1 - Math.exp(-dt / TAU_TURN));
    this.last = { ...target };

    const { back, up, lookUp } = this.framing;
    const aim = { x: target.x, y: target.y + lookUp, z: target.z };
    const spot = (swing: number, near: number, rise: number): Vec3 => {
      const a = this.heading + Math.PI + swing, x = target.x + Math.cos(a) * back * near, z = target.z + Math.sin(a) * back * near;
      return { x, y: Math.max(target.y + up, surfaceAt(world, x, z) + FOLLOW_CLEAR) + rise, z };
    };
    const clear = (p: Vec3) => !world.trunksNear(p.x, p.z, CROWN).length && blockers(world, p, aim, true) === 0;
    // swung or nearer: back to straight behind once that has stayed clear a moment
    const behind = this.swing === 0 && this.near === 1;
    this.behindClear = !behind && clear(spot(0, 1, 0)) ? this.behindClear + dt : 0;
    // where it is first (no flicking between equals), then straight behind and swinging further out, then nearer
    const tries = [...(this.behindClear >= SETTLE ? [[0, 1]] : []), [this.swing, this.near], ...NEARER.flatMap((n) => SWINGS.map((s) => [s, n]))];
    let want: Vec3 | null = null;
    for (const [s, n] of tries) {
      const p = spot(s, n, 0);
      if (clear(p)) {
        want = p;
        [this.swing, this.near] = [s, n];
        break;
      }
    }
    if (!want) {
      // nothing clears: the least blocked swing, higher up
      let best = Infinity;
      for (const s of SWINGS) {
        const p = spot(s, 1, RISE), n = blockers(world, p, aim) + (world.trunksNear(p.x, p.z, BARK).length ? 99 : 0);
        if (n < best) (best = n), (want = p), [this.swing, this.near] = [s, 1];
      }
    }

    // ease there, at a capped speed
    const k = 1 - Math.exp(-dt / TAU);
    let sx = (want!.x - this.pos.x) * k, sy = (want!.y - this.pos.y) * k, sz = (want!.z - this.pos.z) * k;
    const step = Math.hypot(sx, sy, sz), cap = FOLLOW_MAX_SPEED * dt;
    if (step > cap) (sx *= cap / step), (sy *= cap / step), (sz *= cap / step);
    let x = this.pos.x + sx, z = this.pos.z + sz;
    // off the bark (a small push: it was heading round it anyway)
    for (const t of world.trunksNear(x, z, BARK)) {
      const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), min = t.r + BARK;
      if (d >= min) continue;
      const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
      x = t.x + ux * min;
      z = t.z + uz * min;
    }
    this.pos = { x, y: Math.max(this.pos.y + sy, surfaceAt(world, x, z) + FOLLOW_CLEAR), z };

    const kl = 1 - Math.exp(-dt / TAU_LOOK);
    this.look = { x: this.look.x + (aim.x - this.look.x) * kl, y: this.look.y + (aim.y - this.look.y) * kl, z: this.look.z + (aim.z - this.look.z) * kl };
    const dx = this.look.x - this.pos.x, dy = this.look.y - this.pos.y, dz = this.look.z - this.pos.z;
    // yaw 0 faces -z and positive yaw turns left (as the free-fly camera's)
    const yaw = Math.atan2(-dx, -dz), pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(dy, Math.hypot(dx, dz))));
    return { pos: { ...this.pos }, yaw, pitch };
  }
}
