import { FRIGHT, URGENT_FEAR } from '../needs';
import { notices } from '../senses';
import type { SimCtx } from '../sim';
import type { Traits } from '../traits';
import { MEDIUM, TICK, type Agent, type Pt, type Threat } from '../types';

/** A hunter frightens within FLIGHT_BASE m plus FLIGHT_SIZE m per metre of the animal's size, at most FLIGHT_MAX m (small animals let it nearer). */
const FLIGHT_BASE = 10, FLIGHT_SIZE = 30, FLIGHT_MAX = 50;
/** How near (m) a hunter comes before it frightens an animal (twice as far when it runs); farther off it is only watched. */
export const flight = (t: Traits) => Math.min(FLIGHT_MAX, FLIGHT_BASE + FLIGHT_SIZE * t.size);
/** A flight runs this many metres at full speed toward safety, leg after leg while the danger stays close. */
const RUN = [25, 40] as const;
/** Cover is looked for this far off (m), water (for water birds and shore animals) this far; within IN_COVER m of cover it is in it. */
const COVER_REACH = 200, WATER_REACH = 60, IN_COVER = 5;
/** A fleeing group member frightens mates within this many metres that notice it, to this fear. */
const CONTAGION = 30, MATE_FEAR = 0.8;
/** Below this fear a flight is over: it stands watch, wary, for this many animal seconds. */
const CALMED = 0.2, WARY = [10, 20] as const;
/**
 * A freezer bolts once the danger is within BOLT m or runs at it, or once it has been frozen FREEZE_MAX animal s with the
 * danger still in sight (it does not freeze for hours by a resting fox); it stops freezing once the danger has gone
 * unnoticed for OUT_OF_SIGHT s.
 */
const BOLT = 12, FREEZE_MAX = 15, OUT_OF_SIGHT = 5;
/** A herd animal that noticed the danger itself calls an alarm for this many animal seconds as it flees. */
const ALARM = 0.8;
/** A hider stays under the water this long (animal s), and comes back out onto the bank at this speed fraction. */
const HIDE = [20, 40] as const, OUT = 0.3;
/** A fish darts this long (animal s), aiming this far (m), into water at least this deep (m) where it can. */
const DART = 2, DART_RUN = 8, DEEP = 0.6;
/** A water bird farther than this (m) from the water it flees to flaps there; nearer, it walks. */
const FLAP = 12;
/** Near enough to where it flees to (m); flights stay this far inside the valley's edge (m). */
const AT = 1, EDGE = 20;
/** A group member runs its mates' way only when that way is within about 60° of straight away from the danger. */
const SHARED_AWAY = 0.5;
/** The ways tried (radians off the way it would rather go) when that way is barred. */
const TURNS = [0, 0.5, -0.5, 1, -1, 1.5, -1.5];

/** Whether it hides under the water from danger rather than running (frogs: shore animals that do not swim). */
const hides = (t: Traits) => t.medium === 'shore' && !t.swimmer;

/**
 * Fleeing from the danger it knows of (its `threat`). A fish darts. A shore animal hides under the nearest water. A
 * freezer (the rabbit) freezes first, unless the danger is close, running at it, or its mates are already off. The rest
 * run 25–40 m at full speed toward safety (cover for land animals, open water for water birds, which flap there from
 * farther off), leg after leg while the danger stays close, then stand alert, eyes on it. A herd animal that noticed the
 * danger itself calls an alarm as it goes; a fleeing group member frightens the mates that notice it; a flight startles
 * the group (a moment, once per flight). Once its fear has faded it settles, wary, to watch. Afraid of nothing it knows
 * of, it stands alert.
 */
export function flee(a: Agent, t: Traits, s: SimCtx): void {
  if (t.swimmer) return dart(a, t, s);
  const th = a.threat, first = s.t === a.since;
  if (th && hides(t)) {
    // a hider always goes under (never across open water), whichever tick of the flight it is
    const water = s.places.water(a.motion, th, WATER_REACH, false);
    if (water) {
      s.become(a, 'hide');
      a.place = water;
      if (first) startle(a, s);
      return hide(a, t, s);
    }
  }
  if (th && first) {
    if (t.freezes && !closing(a, th) && !matesFleeing(a, t, s)) {
      s.become(a, 'freeze');
      return freeze(a, t, s);
    }
    startle(a, s);
  }
  bolt(a, t, s);
}

/** The flight itself (after any first freeze or hide): legs toward safety while the danger is close, then alert. */
function bolt(a: Agent, t: Traits, s: SimCtx) {
  const th = a.threat;
  if (a.needs.fear < CALMED) return settle(a, s);
  s.pose(a, 0, 0, 'shut', 'alert');
  if (!th) return s.stop(a);
  if (th.noticed && a.group && t.social === 'herd' && s.t - a.since < ALARM) a.pose.calling = 1;
  alarm(a, t, s, th);
  // there (or not yet off): another leg while the danger is still close
  const going = a.place && !s.at(a, a.place, AT);
  if (!going && Math.hypot(th.x - a.motion.x, th.z - a.motion.z) < flight(t)) a.place = refuge(a, t, s, th);
  if (a.place && !s.at(a, a.place, AT)) return run(a, t, s, a.place);
  s.stop(a);
  look(a, t, s, th);
}

/**
 * Freezing (the rabbit): stock-still, ears up, eyes on the danger, until it comes within 12 m or runs at it, a mate
 * bolts, or 15 animal s pass with it still in sight (then it bolts too), or it has gone unnoticed for 5 animal s (then
 * it settles, wary, to watch).
 */
export function freeze(a: Agent, t: Traits, s: SimCtx): void {
  const th = a.threat;
  if (!th || s.t - th.t >= OUT_OF_SIGHT) return settle(a, s);
  if (closing(a, th) || s.t - a.since >= FREEZE_MAX || matesFleeing(a, t, s)) {
    s.become(a, 'flee');
    startle(a, s);
    return bolt(a, t, s);
  }
  s.stop(a);
  s.pose(a, 0, 0, 'shut', 'alert');
  look(a, t, s, th);
}

/**
 * Hiding under the water (frogs): to its spot in the nearest water (`a.place`) at full speed, then still there, out of
 * sight, for 20–40 animal s (as long again while the hunter is still close); then (unless it swims or floats) back out
 * onto the bank. Then it chooses again.
 */
export function hide(a: Agent, t: Traits, s: SimCtx): void {
  const m = a.motion, w = s.world;
  s.pose(a, 0, 0);
  if (a.wary > 0) {
    // under the water
    s.stop(a);
    a.wary = Math.max(0, a.wary - TICK);
    if (a.wary) return;
    // the hunter still close (it keeps its fear up): it stays under, rather than surfacing into a run across the water
    if (a.threat && a.needs.fear >= URGENT_FEAR) return void (a.wary = s.rng.range(...HIDE));
    a.threat = null;
    const bank = t.floater || !w.isWater(m.x, m.z) ? null : s.places.bank(m);
    if (!bank) return s.done(a);
    a.place = bank;
  }
  if (a.place && !w.isWater(a.place.x, a.place.z)) {
    // coming back out
    if (!s.at(a, a.place, AT)) return s.go(a, t, a.place, OUT);
    s.stop(a);
    return s.done(a);
  }
  a.place ??= a.threat && s.places.water(m, a.threat, WATER_REACH, false);
  if (!a.place) return settle(a, s);
  if (!s.at(a, a.place, AT)) return s.go(a, t, a.place, 1);
  s.stop(a);
  a.wary = s.rng.range(...HIDE);
}

/** A fish's dart: away from what passed over it, for 2 animal s at full speed, into deeper water where it can; then done (it is not afraid). */
function dart(a: Agent, t: Traits, s: SimCtx) {
  const th = a.threat, m = a.motion;
  s.pose(a, 0, 0);
  if (!th || s.t - a.since >= DART) {
    a.threat = null;
    s.stop(a);
    return s.done(a);
  }
  const off = way(th, m);
  a.place ??= aside(m, off, DART_RUN, (p) => s.places.open(t, m, p.x, p.z) && s.world.waterDepthAt(p.x, p.z) >= DEEP)
    ?? aside(m, off, DART_RUN, (p) => s.places.open(t, m, p.x, p.z));
  if (a.place) s.go(a, t, a.place, 1);
  else s.stop(a);
}

/** Over: wary for a while (it stands watch, choosing that), the danger forgotten. */
function settle(a: Agent, s: SimCtx) {
  a.wary = s.rng.range(...WARY);
  a.threat = null;
  s.stop(a);
  s.done(a);
}

/** The moment a group's flight begins: the members near it startled (a lone animal's flight is no moment). */
function startle(a: Agent, s: SimCtx) {
  const group = a.group ? s.mates(a, CONTAGION, () => true) : [];
  if (group.length >= 2) s.moment('startle', a, group, MEDIUM);
}

/** A fleeing group member frightens its calm mates nearby that notice it (not those still wary after a flight), passing on its threat. */
function alarm(a: Agent, t: Traits, s: SimCtx, th: Threat) {
  if (!a.group) return;
  for (const b of s.mates(a, CONTAGION, (b) => b !== a && !b.wary && b.needs.fear < MATE_FEAR && !FRIGHT.has(b.doing))) {
    if (!notices(b, t, a, t, s.light, false)) continue;
    b.needs.fear = MATE_FEAR;
    b.threat = { ...th, noticed: false, charging: false };
  }
}

/** Whether the danger is close enough, or coming fast enough, that a freezer bolts. */
const closing = (a: Agent, th: Threat) => th.charging || Math.hypot(th.x - a.motion.x, th.z - a.motion.z) <= BOLT;

/** Whether a group-mate it notices nearby is fleeing. */
function matesFleeing(a: Agent, t: Traits, s: SimCtx) {
  return !!a.group && s.mates(a, CONTAGION, (b) => b !== a && b.doing === 'flee' && notices(a, t, b, t, s.light, false)).length > 0;
}

/** Running to `p` at full speed (a water bird on land flaps there when it is far). */
function run(a: Agent, t: Traits, s: SimCtx, p: Pt) {
  const m = a.motion;
  s.go(a, t, p, 1);
  if (t.floater && t.canFly && !s.world.isWater(m.x, m.z)) m.wantFly = Math.hypot(p.x - m.x, p.z - m.z) > FLAP;
}

/** Looking at where the danger was last noticed. */
function look(a: Agent, t: Traits, s: SimCtx, th: Threat) {
  a.pose.look = { x: th.x, y: s.world.heightAt(th.x, th.z) + t.size, z: th.z };
}

/**
 * Where to run from the danger: a water bird on land straight to the nearest open water; else a spot 25–40 m off,
 * toward cover on the far side from the danger (unless it is in cover already) or else straight away from the danger.
 * A group member near its mates, not in cover itself, runs the way they all do (as if from their middle: so the herd
 * keeps together) when that way also leads away from the danger from where it stands. It turns aside where its way is
 * barred, and never runs toward the danger (not even past it), nor out of the valley; a water bird on the water keeps to
 * open water. Null when cornered.
 */
function refuge(a: Agent, t: Traits, s: SimCtx, th: Threat): Pt | null {
  const m = a.motion, w = s.world, len = s.rng.range(...RUN), wet = w.isWater(m.x, m.z);
  if (t.floater && !wet) {
    const water = s.places.water(m, th, WATER_REACH, true);
    if (water) return water;
  }
  const away = way(th, m), cover = t.floater ? null : s.places.cover(m, th, COVER_REACH);
  const inCover = !!cover && Math.hypot(cover.x - m.x, cover.z - m.z) <= IN_COVER;
  let u = cover && !inCover ? way(m, cover) : away;
  const c = s.centre(a);
  if (c && !inCover && Math.hypot(c.x - m.x, c.z - m.z) < CONTAGION && Math.hypot(c.x - th.x, c.z - th.z) > AT) {
    const herdCover = t.floater ? null : s.places.cover(c, th, COVER_REACH);
    const herd = herdCover && Math.hypot(herdCover.x - c.x, herdCover.z - c.z) > IN_COVER ? way(c, herdCover) : way(th, c);
    if (herd.x * away.x + herd.z * away.z >= SHARED_AWAY) u = herd;
  }
  const from = Math.hypot(m.x - th.x, m.z - th.z);
  return aside(m, u, len, (p) => {
    // farther from the danger all the way there: the end farther off, and the first step not toward it
    if (!w.inside(p.x, p.z, EDGE) || Math.hypot(p.x - th.x, p.z - th.z) <= from || (p.x - m.x) * away.x + (p.z - m.z) * away.z < 0) return false;
    return t.floater && wet ? w.isWater(p.x, p.z) && w.isWater((p.x + m.x) / 2, (p.z + m.z) / 2) : s.places.open(t, m, p.x, p.z);
  });
}

/** The unit way from `from` to `to` (any way, when they meet). */
function way(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
  return d > 1e-6 ? { x: dx / d, z: dz / d } : { x: 0, z: 1 };
}

/** The first spot `len` m from `m` along `u`, or turned aside a little and then more, that passes `ok`; null if none does. */
function aside(m: Pt, u: Pt, len: number, ok: (p: Pt) => boolean): Pt | null {
  for (const turn of TURNS) {
    const c = Math.cos(turn), sn = Math.sin(turn);
    const p = { x: m.x + (u.x * c + u.z * sn) * len, z: m.z + (u.z * c - u.x * sn) * len };
    if (ok(p)) return p;
  }
  return null;
}
