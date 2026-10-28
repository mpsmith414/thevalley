import { avoid } from './avoid';
import type { Traits } from './traits';
import type { Agent, Motion, Pt, SimWorld } from './types';

/** Turning (rad/s): 3 times the heading error, at most 2.5 / body length held between 0.8 and 4, half that in the air. */
const TURN_GAIN = 3, TURN_REACH = 2.5, TURN_MIN = 0.8, TURN_MAX = 4, AIR_TURN = 0.5;
/** Climbing (m/s): 1.2 times the height still to go, at most 1.5 up and 1.2 down; landed below 0.03 m. */
const CLIMB_GAIN = 1.2, CLIMB_UP = 1.5, CLIMB_DOWN = 1.2, LANDED = 0.03;
/** A flier aloft (above 0.3 m) keeps up at least 1.2 m/s to stay in the air, unless it hovers. */
const ALOFT = 0.3, GLIDE = 1.2;
/** How far round (m) an animal looks for trunks in its way, and how near a side step's waypoint counts as reached. */
const TRUNK_LOOK = 7, WAYPOINT_NEAR = 0.5;
/** A step that strays out of an animal's medium slides along the edge when this share of it stays in. */
const SLIDE = 0.25;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** An animal standing still at (x, z), facing `yaw`, with nowhere to go. */
export function newMotion(x: number, z: number, yaw: number): Motion {
  return { x, z, yaw, speed: 0, turnRate: 0, altitude: 0, flying: false, cruise: null, target: null, speedFrac: 0, wantFly: false, climb: 0 };
}

/**
 * One step of `dt` animal seconds toward `m.target` at `m.speedFrac` of its top speed: turning, speeding up and slowing
 * (for sharp turns and on arrival), taking off, climbing to `cruise` (or a couple of body lengths up) and landing. Moves
 * `m` in place. An animal `lying` down neither takes off nor walks. The lab's rig steers with this too.
 */
export function steer(m: Motion, t: Traits, dt: number, lying = false): void {
  // take off and land
  if (t.canFly && m.wantFly && !m.flying && !lying) m.flying = true;
  if (m.flying) {
    const cruise = m.wantFly ? (m.cruise ?? 2.2 + t.bodyLength * 2) : 0;
    const before = m.altitude;
    m.altitude += Math.max(-CLIMB_DOWN, Math.min(CLIMB_UP, (cruise - m.altitude) * CLIMB_GAIN)) * dt;
    m.climb = (m.altitude - before) / Math.max(dt, 1e-6);
    if (!m.wantFly && m.altitude < LANDED) {
      m.flying = false;
      m.altitude = 0;
      m.climb = 0;
    }
  }
  const top = m.flying ? t.flySpeed : t.topSpeed;
  let want = 0;
  if (m.target && !lying) {
    const dx = m.target.x - m.x, dz = m.target.z - m.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.05) {
      const diff = wrapAngle(Math.atan2(dx, dz) - m.yaw);
      const maxTurn = Math.min(TURN_MAX, Math.max(TURN_MIN, TURN_REACH / t.bodyLength)) * (m.flying ? AIR_TURN : 1);
      m.turnRate = Math.max(-maxTurn, Math.min(maxTurn, diff * TURN_GAIN));
      m.yaw = wrapAngle(m.yaw + m.turnRate * dt);
      // slow for sharp turns and when arriving (fliers keep gliding)
      const arrive = m.flying && m.wantFly ? 1 : Math.min(1, d / 0.6);
      want = m.speedFrac * top * Math.max(0.15, Math.cos(Math.min(Math.PI / 2, Math.abs(diff)))) * arrive;
    } else m.turnRate = 0;
  } else m.turnRate *= Math.max(0, 1 - dt * 6);
  if (m.flying && m.altitude > ALOFT) want = Math.max(want, t.hover ? 0 : GLIDE);
  const accel = top * 1.5;
  m.speed += Math.max(-accel * dt, Math.min(accel * dt, want - m.speed));
  m.x += Math.sin(m.yaw) * m.speed * dt;
  m.z += Math.cos(m.yaw) * m.speed * dt;
}

/** Close enough to the target, on the ground plan (or no target at all). */
export function arrived(m: Motion, within = 0.3): boolean {
  return !m.target || Math.hypot(m.target.x - m.x, m.target.z - m.z) < within;
}

/**
 * After a step from `prev`: keeps the animal to its own medium (a walker that stepped into water, unless it is hiding
 * there, or a swimmer onto land, slides along the edge when part of the step stays in, else goes back to `prev`, which is
 * left alone if that is no better, and loses its target), pushes it out of any trunk it walked into (to `r + radius / 2` from the centre), and
 * side-steps trunks in its way. A side step parks the real target in `a.detour`, aims `motion.target` at a waypoint
 * beside the trunk, and puts the target back once the waypoint is reached or passed; a behaviour that sets a new target
 * clears `a.detour`. Returns true when it had to stop (the behaviour picks somewhere else to go).
 */
export function keepClear(a: Agent, t: Traits, world: SimWorld, prev: Pt, radius: number): boolean {
  const m = a.motion;
  let stopped = false;
  // keep to its own medium: walkers never wade in (unless hiding under the water), swimmers never beach
  const walker = !t.swimmer && !t.floater && !m.flying && a.doing !== 'hide';
  if ((walker && world.isWater(m.x, m.z)) || (t.swimmer && !world.isWater(m.x, m.z))) {
    // slide along the edge on the part of the step (east-west or north-south) that stays in its medium, if that is a
    // fair part of it (a corner of the water clipped); else back where it was, stopped
    const mine = (x: number, z: number) => world.isWater(x, z) === t.swimmer, from = mine(prev.x, prev.z);
    const dx = m.x - prev.x, dz = m.z - prev.z, step = Math.hypot(dx, dz);
    const alongX = from && Math.abs(dx) > SLIDE * step && mine(m.x, prev.z), alongZ = from && Math.abs(dz) > SLIDE * step && mine(prev.x, m.z);
    if (alongX && (!alongZ || Math.abs(dx) >= Math.abs(dz))) m.z = prev.z;
    else if (alongZ) m.x = prev.x;
    else {
      if (from) (m.x = prev.x), (m.z = prev.z);
      m.target = null;
      a.detour = null;
      stopped = true;
    }
  }
  // and never inside a trunk
  if (!m.flying) {
    for (const tr of world.trunksNear(m.x, m.z, radius)) {
      const dx = m.x - tr.x, dz = m.z - tr.z, d = Math.hypot(dx, dz) || 1e-6, min = tr.r + radius * 0.5;
      if (d >= min) continue;
      m.x = tr.x + (dx / d) * min;
      m.z = tr.z + (dz / d) * min;
    }
  }
  // a side step ends when the animal reaches (or passes) its waypoint
  if (a.detour) {
    const wp = m.target;
    if (!wp) a.detour = null;
    else {
      const dx = wp.x - m.x, dz = wp.z - m.z;
      if (Math.hypot(dx, dz) < Math.max(WAYPOINT_NEAR, radius) || dx * (a.detour.x - m.x) + dz * (a.detour.z - m.z) < 0) {
        m.target = a.detour;
        a.detour = null;
      }
    }
  }
  // look ahead for trunks, on the way to the target or (mid side step) to the waypoint, which may be blocked too
  const onFoot = !m.flying && !t.swimmer && !(t.floater && world.isWater(m.x, m.z));
  if (m.target && onFoot) {
    const trunks = world.trunksNear(m.x, m.z, TRUNK_LOOK);
    const wp = trunks.length ? avoid(m, m.target, trunks, radius) : null;
    if (wp) {
      a.detour = a.detour ?? m.target;
      m.target = wp;
    }
  }
  return stopped;
}
