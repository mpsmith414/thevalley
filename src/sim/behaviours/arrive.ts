import type { HomeRange } from '../../valley/types';
import type { SimCtx } from '../sim';
import type { Traits } from '../traits';
import type { Agent, Doing, Pt, SimWorld, SpeciesDef } from '../types';
import { soarHeight, soars } from './feed';

/**
 * A family (or a newcomer) walks in briskly, at about ARRIVE_MS m/s (but at least ARRIVE_SPEED of its top speed, and at
 * most all of it: Ruling R6, so a slow one is in the picture within about 3 s too), to a spot within ARRIVE_NEAR of its
 * home's radius from the centre; it has arrived within ARRIVED m of the spot or anywhere that near the centre (a quick
 * walker can circle it). A flier comes in low (ARRIVE_LOW m up, where the release camera sees it) and climbs to its cruise
 * on arrival.
 */
export const ARRIVE_MS = 2.5, ARRIVE_SPEED = 0.5, ARRIVE_NEAR = 0.25, ARRIVED = 2, ARRIVE_LOW = 3;
/**
 * A family that walks on (arrival v2) comes in to the middle of the picture first: to this fraction of the way from the
 * home centre to its onward point; each leg is done within ON_ARRIVED m (loose, so a quick walker does not circle).
 */
export const ON_START = 0.15, ON_ARRIVED = 4;
/** Off exploring: it walks (a little faster) to a point this far out from its home and is gone once out of view, or after LEAVE_TIME s. */
export const LEAVE_DIST = 80, LEAVE_SPEED = 0.4, LEAVE_TIME = 20, LEAVE_GAP = 4, EDGE = 20;
/** A walk in that has not got anywhere in this many animal seconds is given up (the animal chooses its own way). */
export const GIVE_UP = 1800;
/** A newcomer's spot in its home is drawn up to this many times, for one near the middle. */
const SPOT_TRIES = 6;
/** A species below its usual number is made up by a newcomer after this many valley hours (varied), or after RETRY animal s when it was seen. */
export const NEWCOMER_HOURS = [2, 4] as const, RETRY = 10;
/** The errands that take an animal out of its usual life: walking in, and walking out. */
export const ERRAND = new Set<Doing>(['arrive', 'leave']);

/**
 * Where an animal coming in from `from` walks first: for a family with an `onward` point, ON_START of the way from the home
 * centre to it; else a spot in the home near its middle (reachable from `from`).
 */
export function arrivalSpot(s: SimCtx, home: HomeRange, t: Traits, from: Pt, onward?: Pt): Pt {
  const c = home.center;
  if (onward) return { x: c.x + (onward.x - c.x) * ON_START, z: c.z + (onward.z - c.z) * ON_START };
  let best = from, nearest = Infinity;
  for (let i = 0; i < SPOT_TRIES; i++) {
    const p = s.places.roamSpot(home, t, from), d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d <= ARRIVE_NEAR * home.radius) return p;
    if (d < nearest) (best = p), (nearest = d);
  }
  return best;
}

/**
 * Sets `a` walking in to `spot` (`a.place`), then on to `onward` (held in `a.route` until the first leg is done, so its
 * length says which leg it is on); a flier comes in low. The first leg faces the way it goes.
 */
export function beginArrival(a: Agent, t: Traits, s: SimCtx, spot: Pt, onward?: Pt): void {
  s.become(a, 'arrive');
  a.place = spot;
  a.route = onward ? [onward] : [];
  const m = a.motion;
  m.yaw = Math.atan2(spot.x - m.x, spot.z - m.z);
  if (soars(t)) Object.assign(m, { flying: true, wantFly: true, cruise: ARRIVE_LOW, altitude: Math.min(m.altitude, ARRIVE_LOW) });
}

/**
 * Walking in (the actions stand aside): to its spot, then on to its onward point when it has one, and then it chooses freely.
 * A leg is done within ARRIVED m of its spot or anywhere near the home's centre (a spot near it), within ON_ARRIVED m for a
 * leg on a family's way (the first of two, or the second), or when the way is barred (water, a cliff: the actions take over).
 * It gives up after a long time. A flier climbs to its own height on arrival. Fear still sends it off its errand.
 */
export function arrive(a: Agent, t: Traits, s: SimCtx): void {
  const m = a.motion, home = s.home(a), c = home.center, near = ARRIVE_NEAR * home.radius;
  s.pose(a, 0, 0);
  const lost = s.t - a.since >= GIVE_UP;
  let leg = lost ? null : a.place;
  if (lost) a.route = [];
  if (leg) {
    const loose = a.route.length > 0 || Math.hypot(leg.x - c.x, leg.z - c.z) > near;
    const d = Math.hypot(leg.x - m.x, leg.z - m.z);
    if (loose ? d < ON_ARRIVED : d < ARRIVED || Math.hypot(c.x - m.x, c.z - m.z) < near) leg = null;
  }
  if (!leg) {
    // that leg is done (or its way was barred): on to the next, or into its own life
    const next = a.route.shift();
    if (next) leg = a.place = next;
    else {
      if (soars(t)) m.cruise = soarHeight(a);
      else s.stop(a);
      a.place = null;
      return s.done(a);
    }
  }
  s.go(a, t, leg, Math.min(1, Math.max(ARRIVE_SPEED, ARRIVE_MS / t.topSpeed)));
  if (soars(t)) m.wantFly = true; // stays up, low
}

/**
 * Where member `k` of `n` leaving walks to: LEAVE_DIST m out from the home centre `c` away from `from` (where the camera is;
 * the member's own side of the centre when it is not known), side by side with the others LEAVE_GAP m apart, kept in the valley.
 */
export function leaveSpot(world: SimWorld, c: Pt, from: Pt, k: number, n: number): Pt {
  let ux = c.x - from.x, uz = c.z - from.z;
  const d = Math.hypot(ux, uz);
  if (d > 1e-6) (ux /= d), (uz /= d);
  else (ux = 1), (uz = 0);
  const side = (k - (n - 1) / 2) * LEAVE_GAP, half = world.size / 2 - EDGE;
  const clamp = (v: number) => Math.max(-half, Math.min(half, v));
  return { x: clamp(c.x + ux * LEAVE_DIST - uz * side), z: clamp(c.z + uz * LEAVE_DIST + ux * side) };
}

/** Sends `a` off to `to` (held in `a.route`), to be gone by animal second `until` at the latest; a flier stays up. */
export function beginLeaving(a: Agent, s: SimCtx, to: Pt, until: number): void {
  s.become(a, 'leave');
  a.route = [to];
  a.until = until;
}

/**
 * Walking out of the valley, a little faster than a stroll (as fast as it is afraid, if more), whatever else happens: it
 * does not stop for fear, for it is going anyway. It keeps pressing on to its point if the way was barred.
 */
export function leave(a: Agent, t: Traits, s: SimCtx): void {
  s.pose(a, 0, 0);
  if (!a.route[0]) return; // (nowhere to go: it is gone when its time is up)
  s.go(a, t, a.route[0], Math.max(LEAVE_SPEED, a.needs.fear));
  if (soars(t)) a.motion.wantFly = true;
}

/**
 * The leavers to take out of the valley now: a species' leavers go together, once none of them is seen (by `seen`) or
 * their time is up.
 */
export function leaversGone(agents: readonly Agent[], seen: (id: string) => boolean, t: number): Agent[] {
  const bySpecies = new Map<string, Agent[]>();
  for (const a of agents) if (a.doing === 'leave') (bySpecies.get(a.species) ?? bySpecies.set(a.species, []).get(a.species)!).push(a);
  const out: Agent[] = [];
  for (const members of bySpecies.values()) if (t >= members[0].until || !members.some((a) => seen(a.id))) out.push(...members);
  return out;
}

/**
 * The species that are short of their usual number, and by how many: the sum of their homes' targets, less their animals
 * (not those going back to the earth) and the newcomers already on the way.
 */
export function shortOf(defs: readonly SpeciesDef[], agents: readonly Agent[], pending: readonly { species: string }[]): { species: string; n: number }[] {
  const usual = new Map<string, number>();
  for (const d of defs) usual.set(d.id, (usual.get(d.id) ?? 0) + d.target);
  for (const a of agents) if (a.doing !== 'returning' && usual.has(a.species)) usual.set(a.species, usual.get(a.species)! - 1);
  for (const p of pending) if (usual.has(p.species)) usual.set(p.species, usual.get(p.species)! - 1);
  return [...usual].filter(([, n]) => n > 0).map(([species, n]) => ({ species, n }));
}

/** The home of a species that is shortest of animals (not counting those going back to the earth); the first on a tie. */
export function emptiestHome(defs: readonly SpeciesDef[], agents: readonly Agent[], species: string): SpeciesDef {
  const homes = defs.filter((d) => d.id === species);
  let best = homes[0], most = -Infinity;
  homes.forEach((d, i) => {
    const gap = d.target - agents.filter((a) => a.species === species && a.home === i && a.doing !== 'returning').length;
    if (gap > most) (best = d), (most = gap);
  });
  return best;
}

/** Water this deep (m) is the lake's; a home's water is looked for on rings this many radii out, at 12 bearings. */
const LAKE_DEPTH = 3, RINGS = [0.5, 1, 2];

/** Where a home is, in a newcomer's moment: the meadow, the forest, the lake or the river. */
export function placeName(world: SimWorld, home: HomeRange): string {
  const c = home.center;
  if (home.medium !== 'land' && home.medium !== 'air') {
    // wet or shore: a lake is deep, a river shallow (the deepest water in the home's reach decides)
    let deep = world.isWater(c.x, c.z) ? world.waterDepthAt(c.x, c.z) : 0;
    for (const r of RINGS) {
      for (let k = 0; k < 12; k++) {
        const x = c.x + Math.cos((k * Math.PI) / 6) * home.radius * r, z = c.z + Math.sin((k * Math.PI) / 6) * home.radius * r;
        if (world.isWater(x, z)) deep = Math.max(deep, world.waterDepthAt(x, z));
      }
    }
    return deep >= LAKE_DEPTH ? 'lake' : 'river';
  }
  const like = home.prefer[0]; // the biome it is made for, or else the one at its centre
  if (like === 'forest' || like === 'meadow') return like;
  const b = world.biomeAt(c.x, c.z);
  return b.forest > b.meadow ? 'forest' : 'meadow';
}
