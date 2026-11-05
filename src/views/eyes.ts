/**
 * The Eyes view, seeing as the animal sees: at its eye point, facing where its head faces, with the head's bob smoothed
 * away (the horizontal travel is never lagged). The player's look turns within the animal's own field of view's reach and springs back (the controller's job).
 */
import { MAX_PITCH, surfaceAt, type FlyWorld } from '../camera/freefly';
import type { Vec3 } from '../util/vec';
import type { Pose } from './types';

/** The eye's height and its head's facing are eased over this long (s), which takes the walk's bob out of the picture. */
const TAU = 0.15;
/** The eased height never strays further than this (m) from the eye's own, so a climb or a fall (or a fast clock) is not left behind. */
const MAX_LAG = 0.1;
/** The head's tilt is kept within 35° of level; the look reaches 60° to the sides and 40° up and down (radians). */
const HEAD_PITCH = (35 * Math.PI) / 180, LOOK_YAW = (60 * Math.PI) / 180, LOOK_PITCH = (40 * Math.PI) / 180;
/** How far the player's look reaches round in Eyes (radians), for the controller that springs it back. */
export const EYES_LOOK = { yaw: LOOK_YAW, pitch: LOOK_PITCH };
/** The least above the ground (or, for a land animal, the water) the eye keeps (m), and the gap kept off a trunk's bark (m). */
const CLEAR = 0.02, BARK = 0.05;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** Sees through an animal's eyes: keeps to the eye point, easing only its height and the head's facing, and each frame hands back the camera's pose. */
export class EyesCam {
  private y: number | null = null;
  private yaw = 0;
  private pitch = 0;

  /**
   * One frame of `dt` s through `eye` (the midpoint of its eyes, and its head's yaw and pitch in the camera's convention:
   * yaw 0 faces -z, positive turns left), with the player's `look` (within ±60° and ±40°). A land animal's eye stays above
   * the water and the ground, a `swimmer`'s may go under the water but not the ground; neither goes inside a trunk.
   */
  update(dt: number, eye: { pos: Vec3; yaw: number; pitch: number }, look: { yaw: number; pitch: number }, world: FlyWorld, swimmer: boolean): Pose {
    const k = 1 - Math.exp(-Math.max(0, dt) / TAU), head = clamp(eye.pitch, -HEAD_PITCH, HEAD_PITCH);
    if (this.y === null) (this.y = eye.pos.y), (this.yaw = eye.yaw), (this.pitch = head);
    else {
      this.y = clamp(this.y + (eye.pos.y - this.y) * k, eye.pos.y - MAX_LAG, eye.pos.y + MAX_LAG);
      this.yaw += wrap(eye.yaw - this.yaw) * k;
      this.pitch += (head - this.pitch) * k;
    }
    let { x, z } = eye.pos, y: number = this.y;
    for (let pass = 0; pass < 2; pass++) for (const t of world.trunksNear(x, z, BARK)) { // twice: a push can land in the next trunk
      const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), min = t.r + BARK;
      if (d >= min) continue;
      const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
      x = t.x + ux * min;
      z = t.z + uz * min;
    }
    y = Math.max(y, (swimmer ? world.heightAt(x, z) : surfaceAt(world, x, z)) + CLEAR);
    return {
      pos: { x, y, z },
      yaw: this.yaw + clamp(look.yaw, -LOOK_YAW, LOOK_YAW),
      pitch: clamp(this.pitch + clamp(look.pitch, -LOOK_PITCH, LOOK_PITCH), -MAX_PITCH, MAX_PITCH),
    };
  }
}
