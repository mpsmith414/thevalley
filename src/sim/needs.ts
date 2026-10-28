import type { Traits } from './traits';
import { ANIMAL_S_PER_HOUR, type Agent, type Doing, type Needs } from './types';

/**
 * How fast needs rise, per valley hour: hunger by diet (grazers often, hunters rarely, small-food eaters in between),
 * thirst, and company while apart from the group; fear fades per animal second once nothing is noticed.
 */
export const RATES = { hunger: { grazer: 0.15, hunter: 0.06, small: 0.12 }, thirst: 0.08, companyApart: 0.3, fearDecay: 0.15 };
/** What eating and drinking take off per valley hour: grazing, foraging, a hunter's small food, drinking. */
const GRAZE = 0.6, FORAGE = 0.5, HUNTER_FORAGE = 0.3, DRINK = 1.5;
/** Small food only takes the edge off a hunter's hunger: never below this (a catch fills it). */
const TOPPED = 0.4;
/**
 * An animal runs (on foot or swimming, faster than RUNNING of its top speed) for STAMINA_S animal s per unit of its
 * recipe's stamina, and gets its breath back RECOVER times slower; spent, it can only go at SPENT of its top speed.
 */
export const STAMINA_S = 20, RECOVER = 3, RUNNING = 0.5, SPENT = 0.5;
/** Company falls this much a valley hour while an animal is with its group. */
const TOGETHER = 1;
/** Tiredness eases toward its target this much an hour, and falls this much an hour in sleep. */
const TIRED_EASE = 0.5, SLEEP = 0.4;
/** Tiredness targets: low in an animal's active hours, high in its resting ones. */
const TIRED_LOW = 0.1, TIRED_HIGH = 0.85;
/** At this target or above it is an animal's resting time. */
const RESTING = 0.5;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ramp = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));

/**
 * How tired an animal should feel with the sun at `sun` degrees: day animals rest once it is a few degrees below the
 * horizon, night animals once it is a few above; twilight animals rest when it is high (midday) and at deep night.
 */
export function tiredTarget(activity: Traits['activity'], sun: number): number {
  const k = activity === 'day' ? ramp(-sun, 0, 6) : activity === 'night' ? ramp(sun, 0, 6) : Math.max(ramp(sun, 30, 42), ramp(-sun, 10, 16));
  return TIRED_LOW + (TIRED_HIGH - TIRED_LOW) * k;
}

/** Whether it is an animal's resting time. */
export const resting = (activity: Traits['activity'], sun: number) => tiredTarget(activity, sun) >= RESTING;

/**
 * One step of `dt` animal seconds of needs: hunger and thirst rise (swimmers never thirst), eating (head down, chewing)
 * and drinking (lapping) bring them down, tiredness eases toward `tiredTo` or falls in sleep, fear fades, and a group
 * member's company rises while it is `apart` from its group and falls while with it. A hunter (`hunter`) only tops up
 * on small food, down to TOPPED. Stamina runs down while it runs and comes back at a third of that rate otherwise.
 */
export function updateNeeds(a: Agent, t: Traits, hunter: boolean, dt: number, tiredTo: number, apart = false): void {
  const n = a.needs, dh = dt / ANIMAL_S_PER_HOUR;
  n.hunger += dh * (hunter ? RATES.hunger.hunter : t.grazer ? RATES.hunger.grazer : RATES.hunger.small);
  if (a.pose.mouth === 'chew' && (a.doing === 'graze' || a.doing === 'forage')) {
    if (!hunter) n.hunger -= dh * (a.doing === 'graze' ? GRAZE : FORAGE);
    else if (n.hunger > TOPPED) n.hunger = Math.max(TOPPED, n.hunger - dh * HUNTER_FORAGE);
  }
  const full = STAMINA_S * Math.max(0.05, t.stamina);
  const runs = !a.motion.flying && a.motion.speed > RUNNING * t.topSpeed;
  a.stamina = clamp01(a.stamina + (runs ? -dt / full : dt / (full * RECOVER)));
  if (!t.swimmer) n.thirst += dh * RATES.thirst;
  if (a.pose.mouth === 'lap') n.thirst -= dh * DRINK;
  if (a.doing === 'sleep' && a.pose.sleep >= 1) n.tired -= dh * SLEEP;
  else n.tired += Math.max(-TIRED_EASE * dh, Math.min(TIRED_EASE * dh, tiredTo - n.tired));
  n.fear -= dt * RATES.fearDecay;
  if (a.group) n.company += dh * (apart ? RATES.companyApart : -TOGETHER);
  n.hunger = clamp01(n.hunger);
  n.thirst = clamp01(n.thirst);
  n.tired = clamp01(n.tired);
  n.fear = clamp01(n.fear);
  n.company = clamp01(n.company);
}

/**
 * What the choice needs to know besides the animal: the sun's elevation (degrees), whether it is dusk, whether the
 * species hunts (another species in the valley is its prey) and has plants or small food to forage, a uniform number
 * for the rare random choice (drawn by the simulation only when the animal is done), for a group member that follows a
 * leader what the leader is doing, the needs to choose by when not the animal's own (a leader chooses by its group's),
 * whether a hunter is letting hunting be after a miss (`cooling`), and whether the animal keeps on at what it is doing
 * whatever else presses (`hold`: a hunter resting after a hunt).
 */
export type ChoiceCtx = { sun: number; dusk: boolean; hunter: boolean; forages: boolean; roll: number; lead?: Doing | null; needs?: Needs;
  cooling?: boolean; hold?: boolean };

/** At this fear an animal flees, before anything else is weighed (no hysteresis, watch stint or leader holds it). */
export const URGENT_FEAR = 0.5;
/** Fear on noticing a hunter close by: this much, plus this much of its jumpiness, less this much of its boldness. */
const FRIGHT_BASE = 0.5, FRIGHT_JUMPY = 0.5, FRIGHT_BOLD = 0.3;
/** How afraid an animal becomes on noticing a hunter close by: jumpy ones more, bold ones less. */
export const fright = (t: Traits) => clamp01(FRIGHT_BASE + FRIGHT_JUMPY * t.jumpiness - FRIGHT_BOLD * t.boldness);
/** Fleeing, freezing and hiding: once started they go on until the behaviour itself has done with them. */
export const FRIGHT = new Set<Doing>(['flee', 'freeze', 'hide']);
/** The hunt: once started it goes on until the behaviour has done with it. */
export const HUNTING = new Set<Doing>(['stalk', 'chase', 'dive', 'eat']);
/** A calm animal's score in its active and its resting hours. */
const CALM = 0.3, CALM_RESTING = 0.5;
/** Something else must matter this much more to interrupt what an animal is doing. */
const MARGIN = 0.15;
/** A hunter waits for its moment: its hunger presses it this much less, so it still drinks and sleeps. */
const HUNTER_PATIENCE = 0.7;
/** A hunter this hungry hunts; below it, one with plants or small food forages. */
export const HUNT_AT = 0.5;
/** Once off to drink an animal keeps going (and drinks its fill) unless something else scores more than this plus MARGIN. */
const DRINK_HOLD = 0.6;
/** A grazer that has finished a calm bout stands watch this often (not in a herd: the herd keeps its own watcher). */
const WATCH_CHANCE = 0.3;
/** A stint of watch (a few seconds) is seen through: nothing scores more than this plus MARGIN (fear will). */
const WATCH_HOLD = 1;
/** A follower goes its own way rather than its leader's only for a need this pressing. */
const PRESSING = 0.9;
/**
 * Errands a follower finishes once started, whatever its leader does next, while the need behind it is above LET_GO (it
 * gets up when its leader does, unless worn out).
 */
const ERRANDS = new Set<Doing>(['drink', 'walk']), LET_GO = 0.25;
/** Feeding and standing about: a follower whose leader does one of these feeds too (or stands about, in its active hours). */
const LEAN_FEED = new Set<Doing>(['graze', 'forage', 'search', 'watch', 'call']);

/**
 * What to do next: a caught animal only goes back to the earth, and one walking out of the valley walks on (it is going
 * anyway); carry on fleeing, freezing or hiding until that is done;
 * flee when afraid (its own fear at URGENT_FEAR always wins, before anything below: a newcomer or family walking in
 * breaks off its walk, and lives from where it stands); carry on a walk in until it is done; carry on a hunt until it is done,
 * and keep on at a held doing; stand watch while still wary after a flight; else a small
 * utility choice over the needs (thirst → drink, hunger → graze, forage or search, tiredness → sleep in the resting
 * hours or rest otherwise, company → walk back to the group, and else a calm default; a hunter forages rather than
 * hunts while it is not yet hungry enough, or is letting hunting be after a miss, if it can), with
 * hysteresis: the current doing is kept unless another scores more by a clear margin (a drink is held until fairly
 * pressing), or it is done (`a.since < 0`), when the best is taken. Ties go to drink, then food, then rest. The calm
 * default: rest in the resting hours; else frogs and other shore animals call at dusk, a flock of water birds gathers to
 * rest (a raft) at dusk, grazers graze (now and then standing watch, unless in a herd), hunters forage or search as they
 * would when hungry, the rest forage. A follower
 * leans on its leader (`ctx.lead`): it drinks, lies down or feeds when its leader does, unless a need of its own presses
 * or it is finishing an errand, so a group drinks, beds down and grazes together; a hunter whose leader stalks or chases
 * goes to search (and joins it there), unless it is letting hunting be.
 */
export function choose(a: Agent, t: Traits, ctx: ChoiceCtx): Doing {
  if (a.doing === 'returning' || (a.doing === 'leave' && a.since >= 0)) return a.doing;
  if (FRIGHT.has(a.doing) && a.since >= 0) return a.doing;
  if (a.needs.fear >= URGENT_FEAR) return 'flee';
  if (a.doing === 'arrive' && a.since >= 0) return a.doing;
  if ((HUNTING.has(a.doing) && a.since >= 0) || ctx.hold) return a.doing;
  if (a.wary > 0) return 'watch';
  const n = ctx.needs ?? a.needs, cur = a.doing, done = a.since < 0, rests = resting(t.activity, ctx.sun);
  const feed: Doing = ctx.hunter ? (ctx.forages && (n.hunger < HUNT_AT || ctx.cooling) ? 'forage' : 'search') : t.grazer ? 'graze' : 'forage';
  const feedScore = n.hunger * (ctx.hunter ? HUNTER_PATIENCE : 1);
  const tired: Doing = rests ? 'sleep' : 'rest';
  let calm: Doing = 'rest', calmScore = CALM_RESTING;
  if (!rests) {
    calmScore = CALM;
    if (ctx.dusk && t.medium === 'shore') calm = 'call';
    else if (ctx.dusk && t.floater && t.social === 'flock') (calm = 'rest'), (calmScore = CALM_RESTING); // a raft gathers on the water
    else if (ctx.hunter || !t.grazer) calm = feed;
    else calm = (cur === 'watch' && !done) || (t.social !== 'herd' && cur === 'graze' && done && ctx.roll < WATCH_CHANCE) ? 'watch' : 'graze';
  }
  const thirst = t.swimmer ? -1 : n.thirst, company = a.group ? n.company : -1;
  let best: Doing = 'drink', bestScore = thirst;
  if (feedScore > bestScore) (best = feed), (bestScore = feedScore);
  if (n.tired > bestScore) (best = tired), (bestScore = n.tired);
  if (company > bestScore) (best = 'walk'), (bestScore = company);
  if (calmScore > bestScore) (best = calm), (bestScore = calmScore);
  let pick: Doing = best, score = bestScore;
  if (!done) {
    let curScore = -1;
    if (cur === 'drink') curScore = Math.max(thirst, DRINK_HOLD);
    if (cur === 'watch') curScore = WATCH_HOLD;
    if (cur === feed) curScore = Math.max(curScore, feedScore);
    if (cur === tired) curScore = Math.max(curScore, n.tired);
    if (cur === 'walk') curScore = Math.max(curScore, company);
    if (cur === calm) curScore = Math.max(curScore, calmScore);
    if (bestScore <= curScore + MARGIN) (pick = cur), (score = curScore);
  }
  const errand = pick === 'drink' ? thirst : pick === 'walk' ? company : 0;
  if (!ctx.lead || (ERRANDS.has(pick) && pick === cur && !done && errand > LET_GO)) return pick;
  const lead = ctx.lead;
  const led: Doing | null = lead === 'drink' ? (t.swimmer ? null : 'drink') : lead === 'rest' || lead === 'sleep' ? tired
    : LEAN_FEED.has(lead) ? (pick === feed || (pick === calm && calm !== 'rest') ? pick : feed)
    : (lead === 'stalk' || lead === 'chase') && ctx.hunter && !ctx.cooling ? 'search' : null;
  // (a need already being met is let go of only once it is well below PRESSING: it must not tip back and forth at the line)
  return led && led !== pick && score < (pick === cur ? PRESSING - MARGIN : PRESSING) ? led : pick;
}
