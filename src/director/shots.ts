/**
 * The documentary's camera work, one shot at a time: where a directed shot's camera goes (an establishing drift, a slow
 * orbit round a group, a look away before a catch, a view from a viewpoint, a time-lapse), how a tracking shot frames its
 * animal, and how a shot joins the one before it. Every shot frames its animal by its size, so a frog, a duck, a fox or a
 * herd each shows clearly on the TV. Pure; the planner (planner.ts) chooses which to use.
 */
import { surfaceAt } from '../camera/freefly';
import { between } from '../util/rng';
import type { Vec3 } from '../util/vec';
import type { Move } from '../views/directed';
import { followFraming, type FollowOpts } from '../views/follow';
import type { Pose } from '../views/types';
import type { ViewName } from '../views/views';
import type { Viewpoint } from '../valley/types';
import type { AgentView } from './types';
import { AIM, findVantage, type VantageWorld } from './vantage';

const DEG = Math.PI / 180;
/** A shot starting more than this far (m) from the camera joins through black (a dip), so nothing pops in. */
export const FAR_CUT_M = 150;
/** A shot cuts (rather than eases) when the camera would move more than this (m) or turn more than `CUT_TURN` (radians). */
export const CUT_MOVE_M = 20, CUT_TURN = 60 * DEG;
/** The camera keeps at least this much (m) above the ground or water. */
const CLEAR = 1.5;
/** An establishing shot looks this much (radians) above its subject, so the subject sits in the lower third. */
const LOWER_THIRD = 7 * DEG;
/** An establishing shot drifts this fraction of the way in towards its subject. */
const PUSH_IN = 0.12;
/** A cut-away faces at least this far (radians) from the hunter and its prey. */
const AWAY = 75 * DEG;
/** The chase framing stands this many times further back than plain Follow (as follow.ts's wide framing). */
const WIDE = 2.5;
/** The valley camera's vertical field of view (degrees): the picture every shot is framed for. */
export const CAMERA_FOV = 55;
/**
 * How much of the picture's height a shot's subject fills: an establishing shot 0.12–0.2 (0.17 at the most as its drift
 * in starts, so it ends by 0.2), a group's whole spread 0.4–0.5, a cut-away's bystander 0.2–0.3; a tracking shot never
 * stands so far back that its animal fills less than 0.1.
 */
const ESTABLISH_FILL: [number, number] = [0.12, 0.17], GROUP_FILL: [number, number] = [0.4, 0.5],
  BYSTANDER_FILL: [number, number] = [0.2, 0.3], TRACK_FILL = 0.1;
/** A directed camera stands at least this high (m) above its subject's feet: the 1.5 m clearance, with a little to spare. */
const LOW_UP = 1.7;
/** A directed camera looks down on its subject at most this steeply (radians), so it is never nearer than NEAR_M. */
const STEEPEST = 50 * DEG;
/** The nearest (m) a directed shot frames its subject from, and the farthest. */
const NEAR_M = LOW_UP / Math.sin(STEEPEST), FAR_M = 80;
/** How steeply (radians) an establishing shot, a group's orbit and a cut-away look down on their subject, when they can. */
const ESTABLISH_EL: [number, number] = [10 * DEG, 20 * DEG], GROUP_EL: [number, number] = [16 * DEG, 26 * DEG],
  BYSTANDER_EL: [number, number] = [8 * DEG, 18 * DEG];

/**
 * How far (m) from something `size` m across the camera stands for it to fill `fill` of the picture's height, with a
 * vertical field of view of `fovDeg` degrees.
 */
export function framingDistance(size: number, fill: number, fovDeg: number): number {
  return size / (2 * Math.tan((fovDeg * DEG) / 2) * fill);
}

/** How big a group is: the largest distance between two of its members (`members`, their positions), at least `size`. */
export function groupSpread(members: readonly Vec3[], size: number): number {
  let most = size;
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++)
    most = Math.max(most, Math.hypot(members[i].x - members[j].x, members[i].z - members[j].z));
  return most;
}

/**
 * Where to look for a directed camera framing something `size` m across at `fill` (a range) of the picture: the distances
 * out along the ground and the heights above the subject's feet for the vantage search, which looks at a point `aimUp` m
 * above them. It looks down at elevation `el` (radians), or more steeply where the subject is so small the camera must
 * come near (it keeps LOW_UP above the feet). Every pairing of them is NEAR_M–FAR_M from the point it looks at.
 */
function ring(size: number, fill: [number, number], el: number, aimUp: number): { dist: [number, number]; up: [number, number] } {
  const d = (f: number) => Math.min(FAR_M, Math.max(NEAR_M, framingDistance(size, f, CAMERA_FOV)));
  const lo = d(fill[1]), hi = d(fill[0]), e = Math.max(el, Math.asin(Math.max(0, Math.min(1, (LOW_UP - aimUp) / lo))));
  return { dist: [lo * Math.cos(e), hi * Math.cos(e)], up: [lo * Math.sin(e) + aimUp, hi * Math.sin(e) + aimUp] };
}

/** A pose at `from` looking at `to` (yaw 0 faces -z, positive turns left, as the free-fly camera's). */
export function lookAt(from: Vec3, to: Vec3): Pose {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return { pos: from, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** The point lifted, if need be, to the least height the camera keeps above the ground or water there. */
const lift = (world: VantageWorld, p: Vec3): Vec3 => ({ ...p, y: Math.max(p.y, surfaceAt(world, p.x, p.z) + CLEAR) });

/** Which way a pose faces, as a unit vector. */
const facing = (p: Pose): Vec3 => ({ x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) });

/** The angle (radians) between the ways two poses face. */
const turnBetween = (a: Pose, b: Pose) => {
  const f = facing(a), g = facing(b);
  return Math.acos(Math.max(-1, Math.min(1, f.x * g.x + f.y * g.y + f.z * g.z)));
};

/** The angle (radians) between the way a pose faces and the direction to `at`. */
const offAxis = (p: Pose, at: Vec3) => {
  const f = facing(p), dx = at.x - p.pos.x, dy = at.y - p.pos.y, dz = at.z - p.pos.z, l = Math.hypot(dx, dy, dz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (f.x * dx + f.y * dy + f.z * dz) / l)));
};

/**
 * How a shot starting at pose `to` joins the camera at `from`: through black when it is far (over 150 m), a hard cut
 * when the camera would move over 20 m or turn over 60°, otherwise an eased switch.
 */
export function joinOf(from: Pose, to: Pose): 'cut' | 'ease' | 'dip' {
  const moved = Math.hypot(to.pos.x - from.pos.x, to.pos.y - from.pos.y, to.pos.z - from.pos.z);
  if (moved > FAR_CUT_M) return 'dip';
  return moved > CUT_MOVE_M || turnBetween(from, to) > CUT_TURN ? 'cut' : 'ease';
}

/** The farthest (m) a tracking shot stands from animal `a`: where it fills 0.1 of the picture, or Follow's own spot if that is farther. */
function trackReach(a: AgentView): number {
  const { back, up } = followFraming(a.size, a.flying ? { altitude: a.altitude } : undefined);
  return Math.min(FAR_M, Math.max(Math.hypot(back, up), framingDistance(a.size, TRACK_FILL, CAMERA_FOV)));
}

/**
 * Roughly where a view of animal `a` puts the camera, to judge the join: Follow at its framing's distance on the side
 * the camera is already on (further back for the chase framing, as far as its animal still shows), Close and Eyes at
 * the animal, all looking at it.
 */
export function viewSpot(a: AgentView, from: Pose, view: ViewName, wide = false): Pose {
  const { back, up, lookUp } = followFraming(a.size, a.flying ? { altitude: a.altitude } : undefined);
  const aim = { x: a.pos.x, y: a.pos.y + lookUp, z: a.pos.z };
  if (view !== 'follow') return { pos: aim, yaw: lookAt(from.pos, aim).yaw, pitch: 0 };
  const dx = from.pos.x - a.pos.x, dz = from.pos.z - a.pos.z, d = Math.hypot(dx, dz);
  const k = wide ? Math.min(WIDE, trackReach(a) / Math.hypot(back, up)) : 1;
  const [ux, uz] = d > 1e-3 ? [dx / d, dz / d] : [Math.sin(from.yaw), Math.cos(from.yaw)];
  return lookAt({ x: a.pos.x + ux * back * k, y: a.pos.y + up * k, z: a.pos.z + uz * back * k }, aim);
}

/**
 * A tracking shot's framing of animal `a`: the chase framing when `wide`, else side-on (orbit 70–90° either way) or low
 * (8–12°); never farther back than where the animal fills 0.1 of the picture (Follow's own spot up close is kept).
 */
export function trackingFraming(rng: () => number, a: AgentView, wide = false): FollowOpts {
  const farthest = trackReach(a);
  if (wide) return { wide: true, farthest };
  if (rng() < 0.6) return { orbit: { yaw: (rng() < 0.5 ? -1 : 1) * between(rng, 70, 90) * DEG, pitch: between(rng, 8, 14) * DEG }, farthest };
  return { orbit: { yaw: between(rng, -15, 15) * DEG, pitch: between(rng, 8, 12) * DEG }, farthest };
}

/** A slow drift from pose `p`, panning `pan` radians (half each side of where it faces), over `s` seconds. */
const panFrom = (p: Pose, pan: number, s: number): Move =>
  ({ kind: 'drift', from: { ...p, yaw: p.yaw - pan / 2 }, to: { ...p, yaw: p.yaw + pan / 2 }, s });

/**
 * An establishing shot of a subject: from a good vantage looking down 10–20° (more on a small animal, which the camera
 * must come near), as far off as lets the subject fill 0.12–0.2 of the picture, so the place shows and the animal is
 * clearly there; drifting a little in, with the subject in the lower third of the picture.
 */
export function establishing(subject: { pos: Vec3; size: number }, world: VantageWorld, rng: () => number, avoid: Vec3, s: number): Move {
  const v = findVantage(subject, world, { ...ring(subject.size, ESTABLISH_FILL, between(rng, ...ESTABLISH_EL), subject.size * AIM), rng, avoid });
  const aim = { x: subject.pos.x, y: subject.pos.y + subject.size * AIM, z: subject.pos.z };
  const near = lift(world, { x: v.pos.x + (aim.x - v.pos.x) * PUSH_IN, y: v.pos.y, z: v.pos.z + (aim.z - v.pos.z) * PUSH_IN });
  const to = lookAt(near, aim), side = rng() < 0.5 ? -1 : 1;
  return { kind: 'drift', from: { ...v, yaw: v.yaw + side * 3 * DEG, pitch: v.pitch + LOWER_THIRD }, to: { ...to, pitch: to.pitch + LOWER_THIRD }, s };
}

/**
 * A shot of a whole herd or family (`members`, their positions; each animal `size` m long), slowly orbiting their middle
 * from a clear spot, near enough that the group's spread fills 0.4–0.5 of the picture. An orbit that would pass a
 * trunk or dip near the ground goes the other way, or becomes a slow pan.
 */
export function group(members: readonly Vec3[], size: number, world: VantageWorld, rng: () => number, avoid: Vec3, s: number): Move {
  const n = members.length || 1;
  const centre = members.reduce((c, p) => ({ x: c.x + p.x / n, y: c.y + p.y / n, z: c.z + p.z / n }), { x: 0, y: 0, z: 0 });
  const v = findVantage({ pos: centre, size: 0 }, world, { ...ring(groupSpread(members, size), GROUP_FILL, between(rng, ...GROUP_EL), 0), rng, avoid });
  const dx = v.pos.x - centre.x, dz = v.pos.z - centre.z, radius = Math.hypot(dx, dz), height = v.pos.y - centre.y;
  const yaw0 = Math.atan2(dx, dz), turn = (rng() < 0.5 ? -1 : 1) * between(rng, 15, 30) * DEG;
  const clear = (t: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = yaw0 + (t * i) / 6, x = centre.x + Math.sin(a) * radius, z = centre.z + Math.cos(a) * radius;
      if (!world.inside(x, z) || world.trunksNear(x, z, 3).length || centre.y + height < surfaceAt(world, x, z) + CLEAR) return false;
    }
    return true;
  };
  for (const t of [turn, -turn]) if (radius > 2 && height > 0 && clear(t)) return { kind: 'orbit', centre, radius, height, yaw0, turn: t, s };
  return panFrom(v, between(rng, 4, 8) * DEG, s);
}

/**
 * A cut-away before (or at) a catch: a look at a bystander nearby (one of `bystanders`, filling 0.2–0.3 of the picture),
 * or the sky and the treeline from where the camera is, turned away from `away` (the hunter and its prey). Its subject is
 * the bystander, or none.
 */
export function cutaway(o: { from: Pose; away: readonly Vec3[]; bystanders: readonly AgentView[]; world: VantageWorld; rng: () => number; s: number }): { move: Move; subject: string | null } {
  const { from, away, world, rng, s } = o;
  const clearOf = (p: Pose) => away.every((a) => offAxis(p, a) > AWAY);
  if (o.bystanders.length && rng() < 0.6) {
    const b = o.bystanders[Math.floor(rng() * o.bystanders.length)];
    const v = findVantage(b, world, { ...ring(b.size, BYSTANDER_FILL, between(rng, ...BYSTANDER_EL), b.size * AIM), rng, avoid: from.pos });
    const m = panFrom(v, 4 * DEG, s);
    if (m.kind === 'drift' && clearOf(m.from) && clearOf(m.to)) return { move: m, subject: b.id };
  }
  const n = away.length || 1;
  const c = away.reduce((m, p) => ({ x: m.x + p.x / n, z: m.z + p.z / n }), { x: 0, z: 0 });
  const dx = from.pos.x - c.x, dz = from.pos.z - c.z;
  // facing away from the hunt: forward is (-sin yaw, -cos yaw), so it points along (dx, dz)
  const yaw = Math.hypot(dx, dz) > 1 ? Math.atan2(-dx, -dz) : from.yaw + Math.PI;
  const pos = lift(world, { ...from.pos, y: from.pos.y + 2 });
  const pitch = between(rng, 12, 28) * DEG, side = rng() < 0.5 ? -1 : 1;
  return { move: { kind: 'drift', from: { pos, yaw, pitch }, to: { pos, yaw: yaw + side * 4 * DEG, pitch: pitch + 2 * DEG }, s }, subject: null };
}

/** Where a viewpoint's camera stands and the point it looks at, each its height above the ground (or water) there. */
function viewpointEye(vp: Viewpoint, world: VantageWorld): { eye: Vec3; look: Vec3 } {
  const eye = lift(world, { x: vp.pos.x, y: surfaceAt(world, vp.pos.x, vp.pos.z) + vp.pos.h, z: vp.pos.z });
  return { eye, look: { x: vp.look.x, y: surfaceAt(world, vp.look.x, vp.look.z) + vp.look.h, z: vp.look.z } };
}

/** With no viewpoint: from where the camera is, level or a little down. */
const here = (world: VantageWorld, from: Pose): Pose =>
  ({ pos: lift(world, from.pos), yaw: from.yaw, pitch: Math.max(-12 * DEG, Math.min(4 * DEG, from.pitch)) });

/**
 * A scenery shot from viewpoint `vp`: a slow pan from the viewpoint itself, or (every other shot, `n` odd) from a
 * vantage across the place it looks at. With no viewpoint, a slow pan from where the camera is.
 */
export function vista(vp: Viewpoint | null, world: VantageWorld, rng: () => number, from: Pose, n: number, s: number): Move {
  const pan = (rng() < 0.5 ? -1 : 1) * between(rng, 6, 12) * DEG;
  if (!vp) return panFrom(here(world, from), pan, s);
  const { eye, look } = viewpointEye(vp, world);
  if (n % 2 === 1) return panFrom(findVantage({ pos: look, size: 6 }, world, { dist: [40, 90], up: [10, 25], rng, avoid: eye }), pan, s);
  return panFrom(lookAt(eye, look), pan, s);
}

/** A time-lapse from viewpoint `vp` (or where the camera is): looking out over its place, pitched up for plenty of sky, barely drifting. */
export function lapse(vp: Viewpoint | null, world: VantageWorld, rng: () => number, from: Pose, s: number): Move {
  const p = vp ? (({ eye, look }) => lookAt(eye, look))(viewpointEye(vp, world)) : here(world, from);
  return panFrom({ ...p, pitch: between(rng, 8, 14) * DEG }, (rng() < 0.5 ? -1 : 1) * between(rng, 2, 4) * DEG, s);
}
