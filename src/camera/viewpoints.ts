import type { Viewpoint } from '../valley/types';
import type { Vec3 } from '../util/vec';
import { MAX_PITCH, surfaceAt, type FlyWorld } from './freefly';

type Pose = { pos: Vec3; yaw: number; pitch: number };
const CLEARANCE = 2;
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** Where the camera stands (h metres above the ground, or the water) and which way it faces for a viewpoint. */
export function viewpointPose(v: Viewpoint, world: FlyWorld): Pose {
  const pos = { x: v.pos.x, y: surfaceAt(world, v.pos.x, v.pos.z) + v.pos.h, z: v.pos.z };
  const dx = v.look.x - pos.x, dz = v.look.z - pos.z, dy = surfaceAt(world, v.look.x, v.look.z) + v.look.h - pos.y;
  // yaw 0 faces -z and positive yaw turns left: forward is (-sin yaw, -cos yaw)
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(dy, Math.hypot(dx, dz))));
  return { pos, yaw, pitch };
}

/** A smooth flight to a viewpoint: a quadratic Bezier that rises over the way, with eased timing. */
export class Glide {
  readonly duration: number;
  private readonly p0: Vec3;
  private readonly p1: Vec3;
  private readonly p2: Vec3;
  private readonly yaw0: number;
  private readonly dYaw: number;
  private readonly pitch0: number;
  private readonly end: Pose;
  /** Clearance above the ground the two ends already have (at most CLEARANCE), so a low viewpoint is reached exactly. */
  private readonly c0: number;
  private readonly c1: number;

  constructor(from: Pose, to: Viewpoint, private readonly world: FlyWorld) {
    this.end = viewpointPose(to, world);
    this.p0 = { ...from.pos };
    this.p2 = this.end.pos;
    const d = Math.hypot(this.p2.x - this.p0.x, this.p2.y - this.p0.y, this.p2.z - this.p0.z);
    this.duration = Math.min(5, Math.max(1.5, 1.5 + d / 400));
    this.p1 = { x: (this.p0.x + this.p2.x) / 2, y: Math.max(this.p0.y, this.p2.y) + 0.25 * d, z: (this.p0.z + this.p2.z) / 2 };
    this.yaw0 = from.yaw;
    this.dYaw = wrap(this.end.yaw - from.yaw);
    this.pitch0 = from.pitch;
    this.c0 = Math.min(CLEARANCE, this.p0.y - surfaceAt(world, this.p0.x, this.p0.z));
    this.c1 = Math.min(CLEARANCE, this.p2.y - surfaceAt(world, this.p2.x, this.p2.z));
  }

  /** The pose `t` seconds in; `done` once the flight is over (the pose is then exactly the viewpoint's). */
  sample(t: number): Pose & { done: boolean } {
    if (t >= this.duration) return { pos: { ...this.end.pos }, yaw: this.end.yaw, pitch: this.end.pitch, done: true };
    const s = smooth(t / this.duration), u = 1 - s;
    const b = (a: number, m: number, c: number) => u * u * a + 2 * u * s * m + s * s * c;
    const x = b(this.p0.x, this.p1.x, this.p2.x), z = b(this.p0.z, this.p1.z, this.p2.z);
    // stay clear of the ground along the way, easing to each end's own clearance there
    const clear = CLEARANCE - (CLEARANCE - this.c0) * (1 - smooth(s / 0.1)) - (CLEARANCE - this.c1) * smooth((s - 0.9) / 0.1);
    const y = Math.max(b(this.p0.y, this.p1.y, this.p2.y), surfaceAt(this.world, x, z) + clear);
    return { pos: { x, y, z }, yaw: this.yaw0 + this.dYaw * s, pitch: this.pitch0 + (this.end.pitch - this.pitch0) * s, done: false };
  }
}
