/**
 * The documentary's own camera moves: a hold, a drift between two poses, or an orbit round a point. Pure: `movePose` says
 * where the camera is `t` seconds into a move; the views play it (see `Views.direct`).
 */
import { surfaceAt, type FlyWorld } from '../camera/freefly';
import type { Vec3 } from '../util/vec';
import type { Pose } from './types';

/**
 * A shot lasting `s` seconds: held still at `pose`; drifting from `from` to `to`; or going round `centre` from camera
 * yaw `yaw0` by `turn` radians, `radius` away and `height` above it, always looking at it.
 */
export type Move =
  | { kind: 'hold'; pose: Pose; s: number }
  | { kind: 'drift'; from: Pose; to: Pose; s: number }
  | { kind: 'orbit'; centre: Vec3; radius: number; height: number; yaw0: number; turn: number; s: number };

/** The camera never goes nearer than this to the ground (m). */
const CLEAR = 1.5;

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** Where the camera is `t` seconds into move `m` (eased in and out), at least 1.5 m above the ground. */
export function movePose(m: Move, t: number, world: FlyWorld): Pose {
  const e = smooth(t / Math.max(m.s, 1e-6));
  let pose: Pose;
  if (m.kind === 'hold') pose = { ...m.pose, pos: { ...m.pose.pos } };
  else if (m.kind === 'drift') {
    const mix = (a: number, b: number) => a + (b - a) * e;
    pose = {
      pos: { x: mix(m.from.pos.x, m.to.pos.x), y: mix(m.from.pos.y, m.to.pos.y), z: mix(m.from.pos.z, m.to.pos.z) },
      yaw: m.from.yaw + wrap(m.to.yaw - m.from.yaw) * e,
      pitch: mix(m.from.pitch, m.to.pitch),
    };
  } else {
    // the camera at angle `yaw` round the centre faces back towards it (yaw 0 faces -z: behind is (sin, cos))
    const yaw = m.yaw0 + m.turn * e;
    pose = {
      pos: { x: m.centre.x + Math.sin(yaw) * m.radius, y: m.centre.y + m.height, z: m.centre.z + Math.cos(yaw) * m.radius },
      yaw,
      pitch: Math.atan2(-m.height, m.radius),
    };
  }
  pose.pos.y = Math.max(pose.pos.y, surfaceAt(world, pose.pos.x, pose.pos.z) + CLEAR);
  return pose;
}
