/**
 * The Close view, riding along: just behind and above the animal's shoulder, looking ahead along its heading, carried by it
 * with only a small lag. The player's look turns the camera round it and springs back (the controller's job); a flier banks
 * a little with its turns.
 */
import { MAX_PITCH, surfaceAt, type FlyWorld } from '../camera/freefly';
import { nearPlane, type AnimalPose, type Pose } from './types';

/** How far back (body lengths, at least MIN_BACK m), how far above its back (body lengths), and how far ahead it looks (body lengths). */
const BACK = 1.2, MIN_BACK = 0.5, ABOVE = 1 / 3, AHEAD = 3;
/** The camera turns with the animal with this lag (s): the heading's within a quarter of a second. The camera keeps to the animal's point rigidly, so it keeps up at any speed. */
const TAU = 0.1;
/** The look reaches this far round (radians): 100° to the sides, 35° up and down. */
export const CLOSE_LOOK = { yaw: (100 * Math.PI) / 180, pitch: (35 * Math.PI) / 180 };
/** A flier banks this much (radians) per rad/s of turn, no more than 10°, and the bank eases in over its own lag (s). */
const BANK = 0.3, BANK_MAX = (10 * Math.PI) / 180, TAU_BANK = 0.3;
/** The least above the ground or water the camera keeps (m), and the gap kept off a trunk's bark (m). */
const CLEAR = 0.05, BARK = 0.05;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** Rides behind an animal `size` m long: it eases the animal's heading (never its point), and each frame hands back the camera's pose. */
export class CloseCam {
  private ready = false;
  private heading = 0;
  private bank = 0;

  constructor(private readonly size: number) {}

  /** The near plane (m) this animal's size asks for. */
  get near(): number {
    return nearPlane(this.size);
  }

  /**
   * One frame of `dt` s riding `a` in `world`, with the player's `look` (radians off straight ahead, within ±100° and ±35°;
   * the controller springs it back). The pose is never below the ground or water by less than 5 cm nor inside a trunk.
   */
  update(dt: number, a: AnimalPose, look: { yaw: number; pitch: number }, world: FlyWorld): Pose {
    const k = 1 - Math.exp(-Math.max(0, dt) / TAU);
    if (!this.ready) (this.ready = true), (this.heading = a.yaw);
    else this.heading += wrap(a.yaw - this.heading) * k;
    const target = a.flying ? clamp(a.turnRate * BANK, -BANK_MAX, BANK_MAX) : 0;
    this.bank += (target - this.bank) * (1 - Math.exp(-Math.max(0, dt) / TAU_BANK));

    // yaw 0 faces -z: forward is (-sin, -cos), so behind is (sin, cos)
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading), back = Math.max(MIN_BACK, BACK * a.bodyLength);
    let x = a.pos.x - fx * back, z = a.pos.z - fz * back;
    for (let pass = 0; pass < 2; pass++) for (const t of world.trunksNear(x, z, BARK)) { // twice: a push can land in the next trunk
      const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), min = t.r + BARK;
      if (d >= min) continue;
      const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
      x = t.x + ux * min;
      z = t.z + uz * min;
    }
    const y = Math.max(a.pos.y + a.backHeight + ABOVE * a.bodyLength, surfaceAt(world, x, z) + CLEAR);

    // looking at its back's height a few body lengths ahead, then where the player looks
    const reach = AHEAD * a.bodyLength + back, drop = a.pos.y + a.backHeight - y;
    const pitch = clamp(Math.atan2(drop, reach) + clamp(look.pitch, -CLOSE_LOOK.pitch, CLOSE_LOOK.pitch), -MAX_PITCH, MAX_PITCH);
    const pose: Pose = { pos: { x, y, z }, yaw: this.heading + clamp(look.yaw, -CLOSE_LOOK.yaw, CLOSE_LOOK.yaw), pitch };
    if (a.flying) pose.roll = this.bank;
    return pose;
  }
}
