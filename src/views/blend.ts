/** The switch between views: an eased glide from where the last view left the camera to wherever the new view wants it. */
import type { Pose } from './types';

const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Carries the camera from one view's last pose to the next view's live pose: `start` it with the pose the camera had,
 * then pass each frame's pose of the new view through `apply` until it is no longer `active`. Never a cut: the weight
 * eases in and out, the position and tilt are blended, and the yaw turns the short way round.
 */
export class ViewBlend {
  private from: Pose | null = null;
  private t = 0;
  private seconds = 0.7;

  /** Begin a glide from `from`, taking `seconds` (0.6–0.8 reads as a move, not a cut). */
  start(from: Pose, seconds = 0.7): void {
    this.from = { ...from, pos: { ...from.pos } };
    this.t = 0;
    this.seconds = Math.max(1e-3, seconds);
  }

  /** True while a glide is under way. */
  get active(): boolean {
    return this.from !== null;
  }

  /** This frame (`dt` s later) of the glide towards `to`: the pose between; once it is over, `to` itself. */
  apply(to: Pose, dt: number): Pose {
    const from = this.from;
    if (!from) return to;
    this.t += dt;
    if (this.t >= this.seconds) {
      this.from = null;
      return to;
    }
    const k = ease(this.t / this.seconds);
    const mix = (a: number, b: number) => a + (b - a) * k;
    const pose: Pose = {
      pos: { x: mix(from.pos.x, to.pos.x), y: mix(from.pos.y, to.pos.y), z: mix(from.pos.z, to.pos.z) },
      yaw: from.yaw + wrap(to.yaw - from.yaw) * k,
      pitch: mix(from.pitch, to.pitch),
    };
    if (from.roll !== undefined || to.roll !== undefined) pose.roll = mix(from.roll ?? 0, to.roll ?? 0);
    return pose;
  }
}
