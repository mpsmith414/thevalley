import { URGENT_FEAR } from '../needs';
import type { SimCtx } from '../sim';
import type { Traits } from '../traits';
import type { Agent, Doing, Needs, Pt } from '../types';

/** How far (m) a member may be from the rest of its group before it counts as apart (and wants company), by kind of group. */
export const GROUP_DISTANCE: Record<Traits['social'], number> = { herd: 25, flock: 15, pack: 30, pair: 12, solitary: 0 };
/** Group-mates keep this many body sizes apart (and stand this far apart round their leader). */
const SPACE = 1.5;
/** Cohesion: a member farther from its mates' centre than this share of its group distance is drawn back by COHESION of the excess. */
const LOOSE = 0.4, COHESION = 0.5;
/** Alignment: a member leans the way its moving (faster than MOVING m/s) leader heads, as far as the leader goes in ALIGN_STEPS steps. */
const ALIGN_STEPS = 10, MOVING = 0.2;
/** A grazing herd keeps one watcher once this many of it graze. */
const WATCHED = 3;
/** Rejoining: walking speed fraction; among its group again within this share of its group distance; gives up after LOST animal seconds. */
const TRAVEL = 0.3, AMONG = 0.5, LOST = 120;
/** The golden angle, for spots spread evenly round a point. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** A group-mate drinking with more thirst than this is still drinking its fill (its leader waits for it). */
const STILL_THIRSTY = 0.1;

/** Resting and sleeping: they share a place, and group-mates lying down go together. */
export const LYING = new Set<Doing>(['rest', 'sleep']);
/** Feeding, which a follower does round its leader (a hunting leader's mate forages along). */
export const FEEDING = new Set<Doing>(['graze', 'forage', 'search']);
/** A group's state for a tick: its members, the sum of their positions, and its leader. */
export type Group = { members: Agent[]; x: number; z: number; leader: Agent | null };

/** How far apart group-mates keep (m). */
export const spacing = (t: Traits) => SPACE * t.size;

/**
 * Puts every social animal in its group, `${species}:${home index}`, led by the member with the lowest `n` (so the lead
 * passes to the lowest `n` present when a leader goes); solitary animals have none. Runs whenever animals come or go.
 */
export function assignGroups(agents: Agent[], traits: (species: string) => Traits): void {
  const lead = new Map<string, Agent>();
  for (const a of agents) {
    a.group = traits(a.species).social === 'solitary' ? null : `${a.species}:${a.home}`;
    a.leader = false;
    if (!a.group) continue;
    const l = lead.get(a.group);
    if (!l || a.n < l.n) lead.set(a.group, a);
  }
  for (const l of lead.values()) l.leader = true;
}

/** Member `k`'s spot round its leader's (at the centre, k = 0): spots `space` m apart in a sunflower, turned by `turn`. */
export function slot(k: number, space: number, turn = 0): Pt {
  const r = space * Math.sqrt(k), ang = k * GOLDEN + turn;
  return { x: Math.sin(ang) * r, z: Math.cos(ang) * r };
}

/** Separation: the step (into `out`) that takes `a` out of the space (`gap` m) of any of `others` too close. */
export function spread(a: Agent, others: readonly Agent[], gap: number, out: Pt = { x: 0, z: 0 }): Pt {
  const m = a.motion;
  out.x = out.z = 0;
  for (const b of others) {
    if (b.id === a.id) continue;
    const dx = m.x - b.motion.x, dz = m.z - b.motion.z, d = Math.hypot(dx, dz);
    if (d >= gap) continue;
    if (d > 1e-6) (out.x += (dx / d) * (gap - d)), (out.z += (dz / d) * (gap - d));
    else out.x += a.n < b.n ? gap : -gap; // standing on the same spot: the two step opposite ways
  }
  return out;
}

/**
 * Gentle flocking: an offset (into `out`) to add to the target `a` chose. Cohesion toward its mates' centre once it is
 * loose, separation from mates within 1.5 body sizes, and alignment with its leader's heading (as far as the leader goes
 * in a few steps of `dt` s).
 */
export function flock(a: Agent, mates: readonly Agent[], t: Traits, dt: number, out: Pt = { x: 0, z: 0 }): Pt {
  const m = a.motion;
  spread(a, mates, spacing(t), out);
  let cx = 0, cz = 0, n = 0;
  for (const b of mates) {
    if (b.id === a.id) continue;
    cx += b.motion.x;
    cz += b.motion.z;
    n++;
    const lm = b.motion;
    if (b.leader && lm.speed > MOVING) {
      const ahead = lm.speed * dt * ALIGN_STEPS;
      out.x += Math.sin(lm.yaw) * ahead;
      out.z += Math.cos(lm.yaw) * ahead;
    }
  }
  if (!n) return out;
  const dx = cx / n - m.x, dz = cz / n - m.z, d = Math.hypot(dx, dz), loose = GROUP_DISTANCE[t.social] * LOOSE;
  if (d > loose) (out.x += dx * ((d - loose) / d) * COHESION), (out.z += dz * ((d - loose) / d) * COHESION);
  return out;
}

/**
 * The one member of a grazing herd standing watch: the one already watching (until its stint is over and it chooses
 * again), else, once at least three graze, the grazer that has fed longest (a feeding one before one still walking to
 * its patch; the lowest `n` on a tie). Null while fewer graze. An animal still wary after a flight watches for itself,
 * not for the herd: it is never the watcher.
 */
export function watcher(group: Agent[]): string | null {
  return onWatch(group)?.id ?? null;
}

/** The herd member that should start standing watch now (none for other groups, or while the watcher already watches). */
export function nextWatcher(g: Group, t: Traits): Agent | null {
  if (t.social !== 'herd' || !t.grazer) return null;
  const w = onWatch(g.members);
  return w && w.doing !== 'watch' ? w : null;
}

/** `watcher`'s pick, the animal itself. */
function onWatch(group: Agent[]): Agent | null {
  let grazing = 0, pick: Agent | null = null;
  for (const b of group) {
    if (b.doing === 'watch' && !b.wary) return b;
    if (b.doing !== 'graze') continue;
    grazing++;
    if (!pick || before(b, pick)) pick = b;
  }
  return pick && grazing >= WATCHED ? pick : null;
}

/** Whether `b` is next to look up before `p`: feeding before walking, then grazing longer, then the lower `n`. */
function before(b: Agent, p: Agent) {
  const fb = b.pose.headDown >= 1, fp = p.pose.headDown >= 1;
  if (fb !== fp) return fb;
  return b.since !== p.since ? b.since < p.since : b.n < p.n;
}

/**
 * Walking back to its group after too long apart: toward its mates' centre, head up, until it is among them again. If it
 * cannot get there (water in the way) it gives up for now and settles where it is.
 */
export function rejoin(a: Agent, t: Traits, s: SimCtx): void {
  const c = s.centre(a), m = a.motion, lost = s.t - a.since >= LOST;
  s.pose(a, 0, 0);
  if (!c || lost || Math.hypot(c.x - m.x, c.z - m.z) < GROUP_DISTANCE[t.social] * AMONG) {
    if (lost) a.needs.company = 0;
    s.stop(a);
    return s.done(a);
  }
  s.go(a, t, c, TRAVEL);
}

/** A member's rank in its group: how many members have a lower `n` (the leader is 0). */
export function rank(a: Agent, g: Group): number {
  let k = 0;
  for (const b of g.members) if (b.n < a.n) k++;
  return k;
}

/** Whether two doings go together: the same, both lying down, or both feeding. */
export function alike(d: Doing, e: Doing): boolean {
  return d === e || (LYING.has(d) && LYING.has(e)) || (FEEDING.has(d) && FEEDING.has(e));
}

/** Whether most of a leader's group (more than half of the others) is still drinking, and thirsty. */
export function mostDrinking(a: Agent, g: Group): boolean {
  let k = 0;
  for (const b of g.members) if (b !== a && b.doing === 'drink' && b.needs.thirst > STILL_THIRSTY) k++;
  return k * 2 > g.members.length - 1;
}

/**
 * Whether a group member that has finished drinking or lying down carries on where it is: it still chooses to, or (a
 * leader that has drunk) most of its group is still drinking. Never when it is afraid.
 */
export function carriesOn(a: Agent, g: Group, next: Doing): boolean {
  if (a.needs.fear >= URGENT_FEAR) return false;
  return a.doing === 'drink' ? next === 'drink' || (a.leader && mostDrinking(a, g)) : LYING.has(a.doing) && next === a.doing;
}

/**
 * What a leader chooses by (into `out`), so it takes the group where it needs to go: the greater of its own hunger and
 * tiredness and its group's mean, and the thirst of its thirstiest member (a long walk to the water is made together,
 * before one goes alone).
 */
export function groupNeeds(a: Agent, g: Group, out: Needs): Needs {
  const n = Object.assign(out, a.needs), k = g.members.length;
  let hunger = 0, thirst = 0, tired = 0;
  for (const b of g.members) (hunger += b.needs.hunger), (thirst = Math.max(thirst, b.needs.thirst)), (tired += b.needs.tired);
  n.hunger = Math.max(n.hunger, hunger / k);
  n.thirst = thirst;
  n.tired = Math.max(n.tired, tired / k);
  return n;
}

/** A follower's place in its leader `L`'s train: its spot round the leader, turned to the leader's heading, `space` m behind. */
export function trainSpot(a: Agent, g: Group, L: Agent, space: number): Pt {
  const lm = L.motion, o = slot(rank(a, g), space), c = Math.cos(lm.yaw), sn = Math.sin(lm.yaw);
  return { x: lm.x + o.x * c + o.z * sn - sn * space, z: lm.z - o.x * sn + o.z * c - c * space };
}

/** Whether another of `a`'s kind among `agents` stands, or is going, within `gap` m of (x, z). */
export function crowded(agents: readonly Agent[], a: Agent, x: number, z: number, gap: number): boolean {
  for (const b of agents) {
    if (b === a || b.species !== a.species) continue;
    if (Math.hypot(b.motion.x - x, b.motion.z - z) < gap || (b.place && Math.hypot(b.place.x - x, b.place.z - z) < gap)) return true;
  }
  return false;
}
