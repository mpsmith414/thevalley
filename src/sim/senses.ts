import type { Traits } from './traits';
import type { Agent, SimWorld } from './types';

/** Sight: this many metres plus this many per unit of acuity, for an animal of REF_SIZE m (scaled by size within SIZE_SCALE). */
const SIGHT_BASE = 15, SIGHT_ACUITY = 60, REF_SIZE = 0.5, SIZE_SCALE = [0.4, 2] as const;
/** Smell and hearing, all round: this many metres, plus this many per unit of the keener of the two; twice as far for a runner. */
const NEAR_BASE = 8, NEAR_KEEN = 20, LOUD = 2;
/** A flier higher than this (m) is aloft: it counts as running only in a dive, not when cruising or soaring. */
const ALOFT = 5;
/** A runner moves faster than this share of its top speed; it runs at an animal heading within AT_IT radians of it. */
const RUNNING = 0.5, AT_IT = Math.PI / 4;
/** A stalker in cover is seen only this share as far off (a wolf stalking in cover 40 m ahead of a deer goes unseen). */
const STALK_COVER = 0.25;
/** Daylight: none with the sun this many degrees below the horizon, full this many above. */
const DARK_SUN = -12, LIGHT_SUN = 6;
/** Forest at least this thick is cover (the forest edge and deeper). */
const COVER_FOREST = 0.3;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** How light it is with the sun at `sun` degrees: 1 by day, 0 at deep night. */
export const daylight = (sun: number) => clamp((sun - DARK_SUN) / (LIGHT_SUN - DARK_SUN), 0, 1);

/** Whether a point is in cover (forest thick enough to hide in). */
export const inCover = (world: SimWorld, x: number, z: number) => world.biomeAt(x, z).forest >= COVER_FOREST;

/** How far apart two animals are (m), counting height above the ground (a bird aloft is farther off). */
export const between = (a: Agent, b: Agent) => Math.hypot(b.motion.x - a.motion.x, b.motion.z - a.motion.z, b.motion.altitude - a.motion.altitude);

/**
 * Whether an animal runs: it moves faster than half its top speed. A flier aloft runs only when it dives (its `doing` is
 * `dive`: the seam for the hawk's stoop): cruising or soaring high over the ground is not running at anything.
 */
export const running = (a: Agent, t: Traits) =>
  a.motion.speed > RUNNING * t.topSpeed && !(t.canFly && a.motion.altitude > ALOFT && a.doing !== 'dive');

/** How far (m) an animal with senses `ot` sees one of size `size` at full `light`. */
export function sightRange(ot: Traits, size: number, light: number): number {
  const s = ot.senses;
  return (SIGHT_BASE + SIGHT_ACUITY * s.acuity) * clamp(size / REF_SIZE, ...SIZE_SCALE) * (light + (1 - light) * s.night);
}

/** How far (m) an animal with senses `ot` smells or hears another (all round), `loud` when the other runs. */
export function nearRange(ot: Traits, loud: boolean): number {
  return (NEAR_BASE + NEAR_KEEN * Math.max(ot.senses.smell, ot.senses.hearing)) * (loud ? LOUD : 1);
}

/** The farthest (m) an animal with senses `ot` could notice an animal of size `size` (by day, running). */
export const senseReach = (ot: Traits, size: number) => Math.max(sightRange(ot, size, 1), nearRange(ot, true));

/**
 * Whether `o` notices `other` (at its distance counting height): smelled or heard all round at short range (farther
 * when `other` runs), or seen within its field of view (centred on where it faces) out to a range that grows with its acuity and the other's size and
 * shrinks in the dark (unless it sees well at night). A stalker in cover is much harder to see. `light` is 1 by day
 * and 0 at deep night.
 */
export function notices(o: Agent, ot: Traits, other: Agent, tt: Traits, light: number, otherInCover: boolean): boolean {
  const dx = other.motion.x - o.motion.x, dz = other.motion.z - o.motion.z, d = between(o, other);
  if (d <= nearRange(ot, running(other, tt))) return true;
  const sight = sightRange(ot, tt.size, light) * (other.doing === 'stalk' && otherInCover ? STALK_COVER : 1);
  if (d > sight) return false;
  const turn = Math.atan2(dx, dz) - o.motion.yaw;
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) <= (ot.senses.fov * Math.PI) / 360;
}

/** Whether `other` runs at `o`: faster than half its top speed, heading within 45° of straight at it. */
export function runsAt(other: Agent, tt: Traits, o: Agent): boolean {
  if (!running(other, tt)) return false;
  const dx = o.motion.x - other.motion.x, dz = o.motion.z - other.motion.z, d = Math.hypot(dx, dz);
  return d < 1e-6 || (Math.sin(other.motion.yaw) * dx + Math.cos(other.motion.yaw) * dz) / d >= Math.cos(AT_IT);
}
