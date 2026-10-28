import { HUNT_AT } from '../needs';
import { between, inCover } from '../senses';
import type { SimCtx } from '../sim';
import type { Traits } from '../traits';
import { HIGH, TICK, type Agent, type Pt } from '../types';
import { soar, soars } from './feed';
import { GROUP_DISTANCE } from './group';

/** Searching: patrolling at this speed fraction, a round lasting ROUND animal s; this share of patrol spots on the nearest prey's ground. */
const PATROL = 0.3, ROUND = 60, PREY_GROUND = 0.7;
/** Near enough to a patrol spot (m); a searcher looks for prey every SCAN ticks (in turn). */
const AT = 0.4, SCAN = 4;
/** Stalking: speed fraction, head this low, for at most STALK_MAX animal s, creeping in steps of STEP m. */
const STALK = 0.15, STALK_HEAD = 0.3, STALK_MAX = 60, STEP = 8;
/** The ways a stalker tries (radians off straight at the prey), keeping to cover where one of them does. */
const TURNS = [0, 0.4, -0.4, 0.8, -0.8];
/** A stalker the prey has seen and fled from chases only from within this many lunges; farther off it gives up. */
const CHASE_FROM = 2.5;
/** A chase aims where the prey will be, up to this far ahead (animal s); it is over after CHASE_MAX animal s whatever its stamina. */
const AHEAD = 1, CHASE_MAX = 30;
/** The catch: at most this chance, less the prey's lead (the share of its stamina it still has), and this much less for prey among its group. */
const CATCH = 0.6, IN_HERD = 0.8;
/** After a miss it rests where it is this long (animal s), and leaves hunting alone for this many valley hours (GAVE_UP after a stalk it gave up). */
const MISS_REST = 20, COOLDOWN = 2, GAVE_UP = 1;
/** Eating at the place takes this long (animal s); then it walks off to rest, for at least MEAL_REST animal s. */
const EAT = 30, MEAL_REST = 120;
/** A mate walks to the meal at this speed fraction, there within AT_MEAL m. */
const MEAL_WALK = 0.3, AT_MEAL = 0.5;
/** A caught animal sinks into the earth over this many animal s. */
const SINK = 5;
/** A hawk's dive lasts 3–4 animal s (by its seed). */
const DIVE = [3, 4] as const;
/** Pack and pair mates within this many metres hunt together: a stalk, a chase, a meal. */
const PACK_NEAR = 40;
/** A pack calls together for 2–3 animal s (by the leader's seed) before it sets off at dusk. */
const CALL = [2, 3] as const;
/** Herd mates nearer their herd's centre than this share of their mean distance from it are in the middle (not singled out). */
const MIDDLE = 0.5;

/** How near (m) it lunges from: 8 m plus 4 m per metre of its size. */
export const lunge = (t: Traits) => 8 + 4 * t.size;
/** How near (m) it must be to take its prey: half its size plus 0.3 m. */
export const reach = (t: Traits) => 0.5 * t.size + 0.3;
/** A number in [lo, hi) from the animal's seed (its own, always the same). */
const own = (a: Agent, [lo, hi]: readonly [number, number]) => lo + ((a.seed % 1000) / 1000) * (hi - lo);
const dist = (a: Agent, b: Agent) => Math.hypot(b.motion.x - a.motion.x, b.motion.z - a.motion.z);
/** Whether its kind hunts together: a pack, or a pair. */
const together = (t: Traits) => t.social === 'pack' || t.social === 'pair';

/**
 * Searching: a hungry hunter patrols its home and the nearest prey's ground (the hawk soars), ears forward, a round at a
 * time, looking for prey it can hunt. A pack sets off at dusk with a call together. A pack or pair mate joins its mates'
 * stalk or chase. On noticing prey, it stalks it (the hawk dives at it when near enough and the valley's turn is free, else
 * glides over toward it), but only when hungry enough to hunt and it has not eaten a catch today. After a miss it only
 * patrols until its cooldown is over.
 */
export function search(a: Agent, t: Traits, s: SimCtx): void {
  if (packCall(a, t, s)) {
    s.stop(a);
    s.pose(a, 0, 0, 'shut', 'alert');
    a.pose.calling = 1;
    return;
  }
  if (soars(t)) soar(a, t, s);
  else {
    if (a.place && s.at(a, a.place, AT)) a.place = null;
    const ground = s.preyGround(a);
    a.place ??= s.places.roamSpot(ground && s.rng.next() < PREY_GROUND ? ground : s.home(a), t, a.motion);
    s.go(a, t, a.place, PATROL);
  }
  s.pose(a, 0, 0, 'shut', 'alert');
  if (s.hours >= a.cooldown) {
    const mate = huntingMate(a, t, s);
    if (mate) return join(a, t, s, mate);
    const keen = a.needs.hunger >= HUNT_AT && a.fedDay !== s.day;
    if (keen && (Math.round(s.t / TICK) + a.seed) % SCAN === 0) {
      // prey already running is not worth creeping up on (one frozen still is)
      const prey = s.prey(a, t);
      if (prey && soars(t)) return stoop(a, t, s, prey);
      if (prey && prey.doing !== 'flee') return startStalk(a, t, s, prey);
    }
  }
  if (s.t - a.since >= ROUND) s.done(a);
}

/** Whether a pack member calls now: the leader for the first 2–3 s of a search at dusk, the others while it does. */
function packCall(a: Agent, t: Traits, s: SimCtx): boolean {
  if (t.social !== 'pack' || !s.dusk) return false;
  if (a.leader) return s.t - a.since < own(a, CALL);
  return s.mates(a, PACK_NEAR, (b) => b.leader && b.doing === 'search' && b.pose.calling > 0).length > 0;
}

/** A pack or pair mate nearby that is stalking or chasing (null for animals that hunt alone). */
function huntingMate(a: Agent, t: Traits, s: SimCtx): Agent | null {
  if (!together(t)) return null;
  return s.mates(a, PACK_NEAR, (b) => b !== a && (b.doing === 'stalk' || b.doing === 'chase') && b.focus !== null)[0] ?? null;
}

/** Joins a mate's stalk or chase, after the same prey. */
function join(a: Agent, t: Traits, s: SimCtx, mate: Agent) {
  s.become(a, mate.doing);
  a.focus = mate.focus;
  if (a.doing === 'stalk') stalk(a, t, s);
  else chase(a, t, s);
}

/** The pack or pair mates nearby doing one of `doings` (with `a` first), or just `a` for an animal that hunts alone. */
function pack(a: Agent, t: Traits, s: SimCtx, ...doings: Agent['doing'][]): Agent[] {
  if (!together(t)) return [a];
  return [a, ...s.mates(a, PACK_NEAR, (b) => b !== a && doings.includes(b.doing))];
}

/** Starts creeping up on `prey` (a moment, once per hunt). */
function startStalk(a: Agent, t: Traits, s: SimCtx, prey: Agent) {
  s.become(a, 'stalk');
  a.focus = prey.id;
  s.moment('stalk', a, pack(a, t, s, 'search', 'stalk'), HIGH, '', prey);
  stalk(a, t, s);
}

/**
 * Stalking: slow and low, ears forward, eyes on the prey, from cover to cover where there is cover, for at most 60
 * animal s. Within lunging range, or once the prey has seen it (or its mates) and fled, it chases when the valley's turn
 * is free; until then it waits, crouched, within lunging range, and gives up once the prey has fled too far. Prey running
 * from something else it waits out. It gives up when the prey is gone, hidden or out of reach.
 */
export function stalk(a: Agent, t: Traits, s: SimCtx): void {
  const prey = s.get(a.focus);
  if (!prey || !s.huntable(a, t, prey)) return giveUp(a, s);
  const mate = huntingMate(a, t, s);
  if (mate?.doing === 'chase') return join(a, t, s, mate);
  const d = dist(a, prey), from = s.get(prey.threat?.id ?? null);
  const fled = prey.doing === 'flee' && !!from && (from === a || (a.group !== null && from.group === a.group));
  if (d <= lunge(t) || fled) {
    if (d <= lunge(t) * CHASE_FROM && s.governor.mayChase(a, s.day)) return startChase(a, t, s, prey);
    if (fled && d > lunge(t) * CHASE_FROM) return giveUp(a, s);
  }
  if (s.t - a.since >= STALK_MAX) return giveUp(a, s);
  const pm = prey.motion;
  if (d <= lunge(t)) s.stop(a); // crouched, waiting for its turn
  else {
    if (!a.place || s.at(a, a.place, 1)) a.place = creep(a, t, s, pm);
    s.go(a, t, a.place, STALK);
  }
  s.pose(a, STALK_HEAD, 0, 'shut', 'alert');
  a.pose.look = { x: pm.x, y: s.world.heightAt(pm.x, pm.z) + s.traits(prey.species).size * 0.5, z: pm.z };
}

/** The next spot STEP m on toward `to`: one in cover if any of the ways tried is, else straight on (or the first way open). */
function creep(a: Agent, t: Traits, s: SimCtx, to: Pt): Pt {
  const m = a.motion, base = Math.atan2(to.x - m.x, to.z - m.z);
  let open: Pt | null = null;
  for (const turn of TURNS) {
    const p = { x: m.x + Math.sin(base + turn) * STEP, z: m.z + Math.cos(base + turn) * STEP };
    if (!s.places.open(t, m, p.x, p.z)) continue;
    if (inCover(s.world, p.x, p.z)) return p;
    open ??= p;
  }
  return open ?? { x: to.x, z: to.z };
}

/** Gives up the hunt (no chase was started), leaves hunting alone a while, and chooses afresh. */
function giveUp(a: Agent, s: SimCtx) {
  a.focus = null;
  a.cooldown = s.hours + GAVE_UP;
  s.stop(a);
  s.done(a);
}

/** Starts the valley's one chase: a pack singles out the nearest of the herd not in its middle; mates chase together (a moment). */
function startChase(a: Agent, t: Traits, s: SimCtx, prey: Agent) {
  const target = t.social === 'pack' ? singleOut(a, t, s, prey) : prey;
  const members = pack(a, t, s, 'search', 'stalk');
  s.governor.startChase(a);
  s.become(a, 'chase');
  a.focus = target.id;
  s.moment('chase', a, members, HIGH, '', target);
  chase(a, t, s);
}

/** The herd member nearest the pack that is not in the middle of its herd (the prey itself when it has no herd about it). */
function singleOut(a: Agent, t: Traits, s: SimCtx, prey: Agent): Agent {
  const pt = s.traits(prey.species);
  const herd = prey.group ? s.mates(prey, GROUP_DISTANCE[pt.social] * 2, (b) => s.huntable(a, t, b)) : [];
  if (herd.length < 3) return prey;
  const cx = herd.reduce((n, b) => n + b.motion.x, 0) / herd.length, cz = herd.reduce((n, b) => n + b.motion.z, 0) / herd.length;
  const off = (b: Agent) => Math.hypot(b.motion.x - cx, b.motion.z - cz), mean = herd.reduce((n, b) => n + off(b), 0) / herd.length;
  let pick = prey, best = Infinity;
  for (const b of herd) {
    const d = dist(a, b);
    if (off(b) >= MIDDLE * mean && d < best) (pick = b), (best = d);
  }
  return pick;
}

/**
 * Chasing: flat out at where the prey is going while stamina lasts, ears back, mates together. Reaching the prey
 * rolls the catch, once per chase; running out of stamina, or the prey getting away out of reach (into water, hiding),
 * is an escape. A mate stops when its group's chase is over.
 */
export function chase(a: Agent, t: Traits, s: SimCtx): void {
  const lead = s.get(s.governor.chase);
  if (lead !== a && !(lead && lead.doing === 'chase' && lead.group !== null && lead.group === a.group)) return missed(a, t, s);
  const prey = s.get(a.focus);
  if (!prey || prey.doing === 'returning') return ended(a, t, s, null);
  if (!s.huntable(a, t, prey) || a.stamina <= 0 || s.t - a.since >= CHASE_MAX) return ended(a, t, s, prey);
  if (dist(a, prey) <= reach(t)) return contact(a, t, s, prey);
  const pm = prey.motion, ahead = Math.min(AHEAD, dist(a, prey) / t.topSpeed);
  const to = { x: pm.x + Math.sin(pm.yaw) * pm.speed * ahead, z: pm.z + Math.cos(pm.yaw) * pm.speed * ahead };
  s.go(a, t, s.places.open(t, a.motion, to.x, to.z) ? to : { x: pm.x, z: pm.z }, 1);
  s.pose(a, 0, 0, 'shut', 'back');
}

/** Stoops at `prey` when the valley's turn is free and it can reach it in a dive; else glides on over toward it. */
function stoop(a: Agent, t: Traits, s: SimCtx, prey: Agent) {
  if (between(a, prey) <= t.flySpeed * own(a, DIVE) && s.governor.mayChase(a, s.day)) {
    s.governor.startChase(a);
    s.become(a, 'dive');
    a.focus = prey.id;
    s.moment('dive', a, [a], HIGH, '', prey);
    return dive(a, t, s);
  }
  a.route = [];
  a.motion.target = { x: prey.motion.x, z: prey.motion.z };
  a.detour = null;
}

/**
 * The hawk's dive: straight down from its height at where the prey will be when its 3–4 s stoop ends (counting as
 * running at it, so the prey sees it coming). Reaching the prey rolls the catch; a dive that ends out of reach of it (the
 * prey dodged) is an escape. Prey that gets into cover or out of reach (a frog under the water) has got away.
 */
export function dive(a: Agent, t: Traits, s: SimCtx): void {
  const prey = s.get(a.focus), m = a.motion;
  if (!prey || prey.doing === 'returning') return ended(a, t, s, null);
  if (!s.huntable(a, t, prey)) return ended(a, t, s, prey);
  if (between(a, prey) <= reach(t)) return contact(a, t, s, prey);
  const pm = prey.motion, left = a.since + own(a, DIVE) - s.t;
  if (left < TICK / 2) return ended(a, t, s, prey);
  // the ticks left, the last one bringing it all the way, and where the prey will be by then if it runs on straight
  const n = Math.max(1, Math.round(left / TICK)), ahead = n * TICK;
  s.go(a, t, { x: pm.x + Math.sin(pm.yaw) * pm.speed * ahead, z: pm.z + Math.cos(pm.yaw) * pm.speed * ahead }, 1);
  // the stoop itself: heading and pace to be there when the dive ends, the height going down with it
  const to = m.target ?? pm, f = 1 / n, dx = to.x - m.x, dz = to.z - m.z;
  m.wantFly = true;
  m.yaw = Math.atan2(dx, dz);
  m.speed = (Math.hypot(dx, dz) * f) / TICK;
  m.speedFrac = m.speed / t.flySpeed;
  m.altitude += (pm.altitude - m.altitude) * f;
  m.cruise = m.altitude;
  s.pose(a, 0, 0, 'shut', 'back');
}

/**
 * Reaching the prey: the catch is rolled once. The chance falls with the prey's lead (prey with breath left still dodges
 * away; one run out of stamina does not) and for prey among its herd or flock (harder to single out); it takes the prey
 * only if the valley's limit allows.
 */
function contact(a: Agent, t: Traits, s: SimCtx, prey: Agent) {
  const near = GROUP_DISTANCE[s.traits(prey.species).social];
  const herded = prey.group !== null && s.mates(prey, near, (b) => b !== prey && b.doing !== 'returning').length > 0;
  const roll = s.rng.next(), p = CATCH * (1 - prey.stamina) * (herded ? IN_HERD : 1);
  if ((s.forceCatch || roll < p) && s.governor.mayCatch(a, s.day)) caught(a, t, s, prey);
  else ended(a, t, s, prey);
}

/** A catch: the prey lies down and goes back to the earth; the hunter (and its mates) eat at the place (a moment). */
function caught(a: Agent, t: Traits, s: SimCtx, prey: Agent) {
  s.governor.caught(a, s.day);
  endChase(s);
  s.become(prey, 'returning');
  s.pose(prey, 0, 1);
  Object.assign(prey, { threat: null, wary: 0, sink: 0 });
  prey.needs.fear = 0;
  prey.motion.speed = 0; // the pounce stops it where it is
  const eaters = pack(a, t, s, 'chase', 'stalk');
  const pm = prey.motion;
  for (const e of eaters) {
    s.become(e, 'eat');
    e.focus = prey.id;
    e.fedDay = s.day;
    if (e === a) e.motion.speed = 0;
    else {
      // a mate comes to the place, to a spot beside the prey on its own side
      const d = dist(e, prey) || 1, k = Math.min(1, (t.size * 1.5) / d);
      e.place = { x: pm.x + (e.motion.x - pm.x) * k, z: pm.z + (e.motion.z - pm.z) * k };
    }
    eat(e, t, s);
  }
  s.moment('catch', a, eaters, HIGH, '', prey);
}

/** The chase is over without a catch: the prey got away (a moment, when there is one), and the hunters rest. */
function ended(a: Agent, t: Traits, s: SimCtx, prey: Agent | null) {
  endChase(s);
  if (prey) s.moment('escape', prey, [prey], HIGH);
  for (const e of pack(a, t, s, 'chase')) missed(e, t, s);
}

/** Frees the valley's turn, whoever held it. */
function endChase(s: SimCtx) {
  const lead = s.get(s.governor.chase);
  if (lead) s.governor.endChase(lead);
}

/**
 * After a miss it leaves hunting alone until its cooldown is over; it stops and rests where it is for a while (the hawk
 * pulls out of its dive and soars on instead of sitting among the prey).
 */
function missed(a: Agent, t: Traits, s: SimCtx) {
  a.cooldown = s.hours + COOLDOWN;
  a.focus = null;
  if (soars(t)) {
    s.become(a, 'search');
    return;
  }
  s.become(a, 'rest');
  a.place = { x: a.motion.x, z: a.motion.z };
  a.until = s.t + MISS_REST;
}

/**
 * Eating at the place (a mate walks over to it first): still, head down, chewing, for half a minute; then, full, it walks
 * off to rest a while.
 */
export function eat(a: Agent, t: Traits, s: SimCtx): void {
  if (a.place && !s.at(a, a.place, AT_MEAL)) {
    s.go(a, t, a.place, MEAL_WALK);
    s.pose(a, 0, 0);
  } else {
    s.stop(a);
    s.pose(a, 1, 0, 'chew');
  }
  if (s.t - a.since < EAT) return;
  a.needs.hunger = 0;
  a.focus = null;
  s.become(a, 'rest');
  a.until = s.t + MEAL_REST;
}

/** Going back to the earth: lying still, sinking into the ground over five animal seconds (then the simulation removes it). */
export function returning(a: Agent, _t: Traits, s: SimCtx): void {
  s.stop(a);
  s.pose(a, 0, 1);
  a.sink = Math.min(1, (s.t - a.since) / SINK);
}
