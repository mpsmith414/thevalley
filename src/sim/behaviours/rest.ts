import { LOW, MEDIUM, TICK, type Agent } from '../types';
import type { SimCtx } from '../sim';
import { outside } from './feed';
import type { Traits } from '../traits';

/** Walking to its resting place (speed fraction); there within AT m. */
const TRAVEL = 0.25, AT = 0.6;
/** Lying awake (`rest`) and asleep: how far it lies down, and the head down in sleep (fish keep theirs level). */
const LIE = 0.6, SLEEP_HEAD = 0.6;
/** A nap in the active hours ends at this tiredness, a sleep at this. */
const RESTED = 0.15, SLEPT = 0.05;
/** Group-mates within this many metres lying down together make a moment; ducks on the water in the evening, a raft. */
const GROUP_NEAR = 40, GROUP = 2, EVENING_SUN = 6;
/** Standing watch for this many animal seconds, glancing somewhere new every GLANCE s, up to GLANCE_FAR m away. */
const WATCH = 10, GLANCE = 3, GLANCE_FAR = 30;
/** A watcher left more than KEEP_UP m from its group's centre walks after it (at TRAVEL), still watching. */
const KEEP_UP = 10;

/**
 * Resting and sleeping at its resting place (beside its leader's, when it follows one; a hunter's away from its prey's
 * homes and cover; away from its own kind, when
 * solitary): there (a soaring flier comes down to it) it lies down, head up when only resting, head down asleep. Lying
 * down with group-mates is a moment, and ducks settling on open water in the evening are a raft. Outside its resting
 * hours it gets up once rested (a hunter resting after a hunt, not before its `until`).
 */
export function rest(a: Agent, t: Traits, s: SimCtx): void {
  // a hunter that rested where a hunt ended (inside its prey's ground) picks a place again once its rest there is over (or it turns to sleep)
  const over = a.until > 0 && s.t >= a.until;
  if (over) a.until = 0;
  if (a.place && s.t >= a.until && (over || a.since === s.t)) {
    const keep = s.keepOff(a);
    if (keep && keep(a.place) < 0) (a.place = null), (a.pose.sleep = 0); // it gets up and goes
  }
  if (!a.place) {
    const keep = s.keepOff(a);
    a.place = outside(s.beside(a), keep) ?? s.apart(a, (p) => s.places.restSpot(s.home(a), t, p, keep));
  }
  const settled = a.pose.sleep > 0;
  if (!settled && !s.at(a, a.place, AT)) {
    s.go(a, t, a.place, TRAVEL);
    s.pose(a, 0, 0);
    return;
  }
  s.stop(a);
  const asleep = a.doing === 'sleep';
  s.pose(a, asleep ? (t.swimmer ? 0 : SLEEP_HEAD) : 0, asleep ? 1 : LIE);
  if (!settled) settleMoment(a, t, s);
  if (!s.resting(t) && a.needs.tired <= (asleep ? SLEPT : RESTED) && s.t >= a.until) s.done(a);
}

/**
 * The moment of lying down: a raft of ducks, or a group resting or asleep together (a lone animal settling is no moment:
 * the solitary ones nap many times a day, and would crowd the stream).
 */
function settleMoment(a: Agent, t: Traits, s: SimCtx) {
  const kind = a.doing === 'sleep' ? 'sleep' : 'rest', m = a.motion;
  const lying = (b: Agent) => b === a || ((b.doing === 'rest' || b.doing === 'sleep') && b.pose.sleep > 0);
  if (!a.group) return;
  const group = s.mates(a, GROUP_NEAR, lying);
  if (group.length < GROUP) return;
  const water = s.world.isWater(m.x, m.z);
  if (t.floater && water && s.hour > 12 && s.sun < EVENING_SUN) {
    const raft = group.filter((b) => s.world.isWater(b.motion.x, b.motion.z));
    if (raft.length >= GROUP) return s.moment('raft', a, raft, MEDIUM);
  }
  s.moment(kind, a, group, LOW);
}

/**
 * Standing watch: still, head up, ears pricked, glancing about (walking after its group, should it be left behind), for a
 * stint, or after a flight for as long as it is still wary.
 */
export function watch(a: Agent, t: Traits, s: SimCtx): void {
  const c = s.centre(a);
  if (c && Math.hypot(c.x - a.motion.x, c.z - a.motion.z) > KEEP_UP) s.go(a, t, c, TRAVEL);
  else s.stop(a);
  const look = a.pose.look;
  s.pose(a, 0, 0, 'shut', 'alert');
  const time = s.t - a.since;
  if (!look || Math.floor(time / GLANCE) !== Math.floor((time - TICK) / GLANCE)) {
    const ang = s.rng.next() * Math.PI * 2, d = s.rng.range(5, GLANCE_FAR), x = a.motion.x + Math.sin(ang) * d, z = a.motion.z + Math.cos(ang) * d;
    a.pose.look = { x, y: s.world.heightAt(x, z) + t.size, z };
  } else a.pose.look = look;
  if (a.wary > 0) {
    a.wary = Math.max(0, a.wary - TICK);
    if (!a.wary) s.done(a);
  } else if (time >= WATCH) s.done(a);
}
