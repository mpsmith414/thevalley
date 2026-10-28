import { fnv1a } from '../util/hash';
import type { HomeRange } from '../valley/types';
import { elevationDeg, sunDirection } from '../world/clock';
import { ERRAND, LEAVE_TIME, NEWCOMER_HOURS, RETRY, arrivalSpot, arrive, beginArrival, beginLeaving, emptiestHome, leave, leaveSpot, leaversGone, placeName, shortOf } from './behaviours/arrive';
import { call } from './behaviours/call';
import { drink } from './behaviours/drink';
import { flee, flight, freeze, hide } from './behaviours/flee';
import { forage, graze, soarHeight, soars } from './behaviours/feed';
import { FEEDING, GROUP_DISTANCE, LYING, alike, assignGroups, carriesOn, crowded, flock, groupNeeds, nextWatcher, rank, rejoin, spacing, spread, trainSpot, type Group } from './behaviours/group';
import { chase, dive, eat, returning, search, stalk } from './behaviours/hunt';
import { rest, watch } from './behaviours/rest';
import { canHunt, isHunter } from './foodweb';
import { Governor } from './governor';
import { SpatialGrid } from './grid';
import { MomentStream, momentText } from './moments';
import { keepClear, newMotion, steer } from './mover';
import { FRIGHT, HUNTING, SPENT, choose, fright, resting, tiredTarget, updateNeeds } from './needs';
import { Places, type KeepOff } from './places';
import { Rng } from './rng';
import { between, daylight, inCover, notices, running, runsAt, senseReach } from './senses';
import { traitsFor, type Traits } from './traits';
import { ANIMAL_S_PER_HOUR, HIGH, MEDIUM, TICK, type Agent, type Doing, type MomentKind, type Motion, type Needs, type Pose, type Pt, type SimEvent, type SimState, type SimWorld, type SpeciesDef } from './types';

/** What a behaviour sees of the simulation, and the small helpers they share. */
export type SimCtx = {
  readonly world: SimWorld;
  readonly places: Places;
  readonly rng: Rng;
  /**
   * Simulation time (animal seconds), valley hours, the hour of the day, the sun's elevation (degrees), dusk, and how
   * light it is (1 by day, 0 at deep night).
   */
  t: number;
  hours: number;
  hour: number;
  sun: number;
  dusk: boolean;
  light: number;
  /** The valley day (whole valley days of `hours`), and the valley-wide limit on hunts. */
  day: number;
  readonly governor: Governor;
  /** A test hook: every catch roll succeeds (the valley's limit still holds). */
  forceCatch: boolean;
  /** A test hook: false keeps the cast as it is (no newcomers are scheduled or come; true by default). */
  newcomers: boolean;
  /** The agent with this id (none for null). */
  get(id: string | null): Agent | undefined;
  /** A species' traits (one object per species). */
  traits(species: string): Traits;
  /** The nearest animal `a` notices that it could hunt and reach where it is now, or null. */
  prey(a: Agent, t: Traits): Agent | null;
  /**
   * Whether `a` could hunt `b` where `b` is now: its kind is `a`'s prey, it is not hidden or going back to the earth, and
   * `a`'s body can get there (a walker not into water, a fish not out of it, a flier only on land in the open).
   */
  huntable(a: Agent, t: Traits, b: Agent): boolean;
  /** The home of `a`'s prey that lies nearest `a`'s own home, or null if it has none. */
  preyGround(a: Agent): HomeRange | null;
  /** For a hunter, how far a spot lies outside its prey's homes and cover and the prey about now (it rests and forages outside); else none. */
  keepOff(a: Agent): KeepOff | undefined;
  /** The home range the animal belongs to. */
  home(a: Agent): HomeRange;
  /** Whether it is the resting time of animals with these traits. */
  resting(t: Traits): boolean;
  /**
   * Head for `to` at `speedFrac` of top speed (a new target, by value, clears any side step); a soaring flier flies until
   * it is near enough to land. A group member keeps with its group on the way: a follower whose leader is doing the same
   * keeps its place in the leader's train while the leader is on a long walk (or its own place is far from the leader's),
   * and the way bends gently with its mates (flocking); a solitary animal's bends away from its own kind.
   */
  go(a: Agent, t: Traits, to: Pt, speedFrac: number): void;
  /** Stand still (and come down, if flying). */
  stop(a: Agent): void;
  /** Within `within` m of `p`, on the ground. */
  at(a: Agent, p: Pt, within: number): boolean;
  /** Body language: head down (0..1), lying or asleep (0..1), mouth and ears; not calling, no look. */
  pose(a: Agent, headDown: number, sleep: number, mouth?: Pose['mouth'], ears?: Pose['ears']): void;
  /** Finished: the animal chooses afresh, without hysteresis, on its next tick. */
  done(a: Agent): void;
  /** Turns to `doing` now, as a fresh start (nowhere to go yet, a plain pose), without choosing; the caller acts it out. */
  become(a: Agent, doing: Doing): void;
  /** Whether the camera sees the animal (false until the view is set). */
  seen(id: string): boolean;
  /** The centre of the animal's group-mates (not counting itself) at the start of the tick, or null when it has none. */
  centre(a: Agent): Pt | null;
  /**
   * A follower's own spot (on the same ground, turned into its final spot by `finish`, such as the bank by it) round its
   * leader's place when it does what its leader does, or round the leader itself when it feeds and the leader feeds or
   * watches (where it stands, when it is already by it); else null.
   */
  beside(a: Agent, finish?: (p: Pt) => Pt | null): Pt | null;
  /**
   * `pick(where it is)`, picked again a few times while that lands where another of its kind is or is going, then moved
   * a little to a spot round it (turned into the final spot by `finish`, such as the bank by it). Null if `pick` finds none.
   */
  apart<P extends Pt | null>(a: Agent, pick: (near: Pt) => P, finish?: (p: Pt) => Pt | null): P;
  /** The animal and its group-mates (its own species, if it has no group) within `within` m that pass `test`. */
  mates(a: Agent, within: number, test: (b: Agent) => boolean): Agent[];
  /** A moment about `a` and `members` (one of them: a lone animal; more: its group or species), and a hunt's `prey`. */
  moment(kind: MomentKind, a: Agent, members: Agent[], interest: number, where?: string, prey?: Agent): void;
};

/** A behaviour: sets the agent's target, speed, flying and pose for this tick, and calls `s.done` when it has finished. */
export type Behaviour = (a: Agent, t: Traits, s: SimCtx) => void;

const BEHAVIOURS: Partial<Record<Doing, Behaviour>> = {
  rest, sleep: rest, watch, graze, forage, search, drink, call, walk: rejoin, flee, freeze, hide, stalk, chase, dive, eat, returning, arrive, leave,
};
/** A follower feeding within this share of its group distance of its leader feeds where it stands. */
const BY = 0.4;
/** The cue that an agent has finished: a negative `since`. */
const DONE = -1;
/** Starting needs: hunger and thirst in this range, a little tired at most. */
const START_NEED = [0.2, 0.5] as const, START_TIRED = 0.2;
/** A soaring flier flies to a place on the ground at this speed fraction (at least), and comes down once this near (m), or 1.5 times its height if that is farther. */
const FLY_TRAVEL = 0.6, LAND_NEAR = 12;
/** Dusk: the sun within this many degrees of the horizon, after midday. */
const DUSK = 6;
/** Whether two points are the same place: by value, never by object (the state is plain data and may come back through JSON). */
const samePt = (p: Pt | null, q: Pt) => !!p && p.x === q.x && p.z === q.z;
/** Within `slack` m of `q` (exactly `q` at no slack). */
const nearPt = (p: Pt | null, q: Pt, slack: number) => (slack > 0 ? !!p && Math.hypot(p.x - q.x, p.z - q.z) <= slack : samePt(p, q));
/** Neighbour grid cell (m). */
const CELL = 32;
/** A leader whose target is farther than this (m) is on a long walk, and its followers keep with it. */
const LONG_WALK = 40;
/** A follower more than CATCH m behind its place in the train speeds up, to twice the leader's pace CATCH_RANGE m further back. */
const CATCH = 4, CATCH_RANGE = 16;
/** Flocking bends the way by at most this share of the distance still to go (so the animal still gets there). */
const BEND = 0.3;
/** A group member keeps its target while the bent one moves less than this share of the distance to go, up to SLACK m. */
const SLACK_SHARE = 0.1, SLACK = 1;
/** A mate in a group member's space bends its way as if where it is going were only this many metres ahead (so it steers clear). */
const STEER_NEAR = 2;
/** It walks at this share of its pace while it gives way to a mate in its space that is on the move (faster than ON_THE_MOVE m/s). */
const YIELD = 0.5, ON_THE_MOVE = 0.5;
/** Solitary animals keep this far (m) from their own kind; a place is picked again up to this many times to find room. */
const SOLITARY_GAP = 6, APART_TRIES = 4;
/** Spots round a place with no room are looked for out to this many rings. */
const ROOM_RINGS = 12;
/**
 * A group member closer than this share of its spacing to a mate makes room: standing or drinking, it walks out at
 * WALK_OUT of its top speed (feeding, at its own pace); and it eases away at up to NUDGE m/s (too slow to see the feet
 * slide), or up to VEER of its own speed when walking faster (a slight veer, its legs already moving).
 */
const PERSONAL = 0.75, WALK_OUT = 0.25, NUDGE = 0.15, VEER = 0.25;
/** A step out of a mate's space is at least this long (m). */
const STEP_OUT = 1;
/** Freezing and hiding animals keep stock-still, even in a mate's space. */
const STOCK_STILL = new Set<Doing>(['freeze', 'hide']);
/** A calm animal looks about for danger every SCAN ticks, one afraid or knowing of a danger every ALERT_SCAN (in turn). */
const SCAN = 4, ALERT_SCAN = 2;
/** A fish darts from another animal on or over the water within this many metres. */
const DART_NEAR = 3;
/** A hunter rests and forages this many metres beyond its prey's flight distance from their homes and cover. */
export const KEEP_OFF = 15;

/**
 * The valley's animals as a pure, deterministic simulation on a fixed tick of animal time: every animal's motion, needs,
 * what it is doing, and the moments worth watching. `species` lists one def per home (a native species with two homes
 * comes twice, with the same id); with `state` it carries on from a saved state instead of placing the animals afresh.
 */
export class Sim {
  readonly moments = new MomentStream();
  readonly agents: Agent[] = [];
  private byId = new Map<string, Agent>();
  private defs: SpeciesDef[] = [];
  private defOf = new Map<string, SpeciesDef>();
  private traitsBy = new Map<string, Traits>();
  private diet = new Map<string, { hunter: boolean; forages: boolean }>();
  /** Per species that is prey: the species that could hunt it, and how far off it could notice one. */
  private dangers = new Map<string, { hunters: Set<string>; reach: number }>();
  /** Per hunter species: the species it hunts, and how far off it could notice one. */
  private quarry = new Map<string, { prey: Set<string>; reach: number }>();
  /** Per hunter species: how far a spot lies outside the homes and cover of its prey. */
  private keeps = new Map<string, KeepOff>();
  private rng: Rng;
  private places: Places;
  private grid = new SpatialGrid(CELL);
  private seed: number;
  private t = 0;
  private acc = 0;
  private nextN: Record<string, number> = {};
  private pending: SimState['pending'] = [];
  private governor: SimState['governor'] = { day: 0, catches: 0, chase: null };
  private gov = new Governor(this.governor);
  private prevs = new Map<string, Motion>();
  private events: SimEvent[] = [];
  private view: { eye: Pt; seen: (id: string) => boolean; seenAt?: (p: Pt) => boolean } | null = null;
  private sctx: SimCtx;
  private from: Pt = { x: 0, z: 0 };
  private near: string[] = [];
  private groups = new Map<string, Group>();
  private kin: Agent[] = [];
  private off: Pt = { x: 0, z: 0 };
  private sep: Pt = { x: 0, z: 0 };
  private needs: Needs = { hunger: 0, thirst: 0, tired: 0, fear: 0, company: 0 };

  constructor(private world: SimWorld, opts: { seed: number; species: SpeciesDef[]; state?: SimState }) {
    this.seed = opts.seed;
    const st = opts.state;
    this.rng = new Rng(st ? st.rng : opts.seed);
    this.places = new Places(world, this.rng);
    this.sctx = this.makeCtx();
    for (const def of opts.species) this.learn(def);
    this.foodWeb();
    if (st) {
      this.t = st.t;
      this.acc = st.acc;
      this.nextN = { ...st.nextN };
      this.pending = structuredClone(st.pending).filter((p) => this.defs.some((d) => d.id === p.species));
      Object.assign(this.governor, st.governor);
      this.moments.next = st.nextMoment;
      this.moments.cooldowns = { ...st.cooldowns };
      for (const a of structuredClone(st.agents)) {
        const def = this.homeDef(a);
        if (def) this.place(a, def);
      }
      this.group();
    } else for (const def of opts.species) this.spawn(def);
    this.events.length = 0; // the first animals are not news
  }

  /** The agent with this id. */
  get(id: string): Agent | undefined {
    return this.byId.get(id);
  }

  /** A species' traits (one object per species, shared). */
  traits(species: string): Traits {
    return this.traitsBy.get(species)!;
  }

  /** How far into the next tick the animal time has run (0..1), for smoothing the view. */
  get alpha(): number {
    return this.acc / TICK;
  }

  /** The simulation's context, as behaviours see it (tests may set `forceCatch`). */
  get ctx(): SimCtx {
    return this.sctx;
  }

  /** The agent's motion at the start of the last tick. */
  prev(id: string): Motion | undefined {
    return this.prevs.get(id);
  }

  /**
   * Where the camera is, which animals it sees and (`seenAt`, when it can say) whether it sees a point: newcomers enter
   * and leavers go out of its sight. Nothing is seen until it is set.
   */
  setView(v: { eye: Pt; seen: (id: string) => boolean; seenAt?: (p: Pt) => boolean }): void {
    this.view = v;
  }

  /** Runs `dtAnimal` animal seconds as whole ticks (the rest waits for the next step), the clock at `hours` at the end. */
  step(dtAnimal: number, hours: number): void {
    if (!(dtAnimal > 0)) return;
    this.acc += dtAnimal;
    const n = Math.floor(this.acc / TICK + 1e-9);
    this.acc = Math.max(0, this.acc - n * TICK);
    for (let i = 0; i < n; i++) this.tick(hours - ((n - 1 - i) * TICK + this.acc) / ANIMAL_S_PER_HOUR);
  }

  /**
   * A species comes into the valley: its animals at spots in its home, or (`entry`) each at its entry point, walking in
   * to its home, then on to its `onward` point if given, before its life starts (a family's walk-in, and a moment).
   * Any of the same species still walking out (or sinking back into the earth) go at once, so no id is used twice.
   */
  addSpecies(def: SpeciesDef, opts?: { entry?: Pt[]; onward?: Pt[] }): Agent[] {
    for (const a of this.agents.filter((x) => x.species === def.id && (x.doing === 'leave' || x.doing === 'returning'))) this.remove(a);
    this.learn(def);
    this.foodWeb();
    const family = this.spawn(def, opts);
    if (opts?.entry && family.length) this.sctx.moment('arrive', family[0], family, HIGH);
    return family;
  }

  /**
   * A species leaves the valley: its animals walk out, away from the camera, and are removed once none of them is seen (or
   * after LEAVE_TIME animal seconds); no newcomers come for it. A caught animal just goes back to the earth.
   */
  removeSpecies(id: string): void {
    this.defs = this.defs.filter((d) => d.id !== id);
    this.pending = this.pending.filter((p) => p.species !== id);
    delete this.nextN[id];
    const members = this.agents.filter((x) => x.species === id && x.doing !== 'returning');
    members.forEach((a, k) => {
      const c = this.defOf.get(a.id)!.home.center, m = a.motion;
      beginLeaving(a, this.sctx, leaveSpot(this.world, c, this.view?.eye ?? { x: c.x - (m.x - c.x), z: c.z - (m.z - c.z) }, k, members.length), this.t + LEAVE_TIME);
    });
    if (!this.agents.some((x) => x.species === id)) this.forget(id);
  }

  /** The animals added and removed since the last call. */
  drain(): SimEvent[] {
    return this.events.splice(0);
  }

  /** Everything needed to carry on exactly from here, as a deep plain copy. */
  state(): SimState {
    return {
      version: 1, seed: this.seed, rng: this.rng.s, t: this.t, acc: this.acc, agents: structuredClone(this.agents),
      pending: structuredClone(this.pending), governor: { ...this.governor }, nextMoment: this.moments.next,
      nextN: { ...this.nextN }, cooldowns: { ...this.moments.cooldowns },
    };
  }

  /** Sets some of an animal's needs (for staging and tests). */
  setNeeds(id: string, n: Partial<Agent['needs']>): void {
    const a = this.byId.get(id);
    if (a) Object.assign(a.needs, n);
  }

  /** Lets go of a species that has left (its last animal is gone): its traits and diet, and its place in the food web. */
  private forget(id: string) {
    this.traitsBy.delete(id);
    this.diet.delete(id);
    this.foodWeb();
  }

  /** Takes a def's traits and diet (the first home of a species decides its medium). */
  private learn(def: SpeciesDef) {
    this.defs.push(def);
    if (this.traitsBy.has(def.id)) return;
    const t = traitsFor(def.recipe, def.home.medium);
    this.traitsBy.set(def.id, t);
    this.diet.set(def.id, { hunter: false, forages: def.recipe.mind.plants.length > 0 || t.smallFood });
  }

  /**
   * Who hunts, given everyone in the valley now (each species' one traits object, so none counts itself as prey), and so
   * who is danger to whom and who is whose prey (hunters never hunt hunters).
   */
  private foodWeb() {
    const all = [...this.traitsBy.values()];
    for (const [id, d] of this.diet) d.hunter = isHunter(this.traitsBy.get(id)!, all);
    this.dangers.clear();
    this.quarry.clear();
    for (const [id, t] of this.traitsBy) {
      const hunters = new Set<string>();
      let reach = 0;
      for (const [hid, ht] of this.traitsBy) {
        if (hid === id || !this.diet.get(hid)!.hunter || !canHunt(ht, t, this.diet.get(id)!.hunter)) continue;
        hunters.add(hid);
        reach = Math.max(reach, senseReach(t, ht.size));
        const q = this.quarry.get(hid) ?? { prey: new Set<string>(), reach: 0 };
        q.prey.add(id);
        q.reach = Math.max(q.reach, senseReach(ht, t.size));
        this.quarry.set(hid, q);
      }
      if (hunters.size) this.dangers.set(id, { hunters, reach });
    }
    this.keepOffPrey();
  }

  /**
   * Each hunter's keep-off: its prey's homes, widened by their flight distance plus KEEP_OFF m, and the spots where its
   * prey lie up (their cover), as far round; so a hunter does not doze or browse where its prey lives.
   */
  private keepOffPrey() {
    this.keeps.clear();
    for (const [hid, q] of this.quarry) {
      const discs: { x: number; z: number; r: number }[] = [];
      for (const d of this.defs) {
        if (!q.prey.has(d.id)) continue;
        const pt = this.traitsBy.get(d.id)!, gap = flight(pt) + KEEP_OFF;
        discs.push({ x: d.home.center.x, z: d.home.center.z, r: d.home.radius + gap });
        for (const p of this.places.restSpots(d.home, pt)) discs.push({ x: p.x, z: p.z, r: gap });
      }
      // kept spots are asked about again and again: each one's answer is kept (it depends only on the spot)
      const known = new WeakMap<Pt, number>();
      this.keeps.set(hid, (p) => {
        let k = known.get(p);
        if (k === undefined) known.set(p, (k = discs.reduce((m, c) => Math.min(m, Math.hypot(p.x - c.x, p.z - c.z) - c.r), Infinity)));
        return k;
      });
    }
  }

  /** Index of `def` among the homes of its species (part of the group id). */
  private homeIndex(def: SpeciesDef) {
    return this.defs.filter((d) => d.id === def.id).indexOf(def);
  }

  /** The home a restored agent belongs to: the one it names, else (its species has fewer homes now) the nearest. */
  private homeDef(a: Agent): SpeciesDef | undefined {
    const homes = this.defs.filter((d) => d.id === a.species);
    if (homes[a.home]) return homes[a.home];
    const dist = (d: SpeciesDef) => Math.hypot(d.home.center.x - a.motion.x, d.home.center.z - a.motion.z);
    const near = homes.reduce<SpeciesDef | undefined>((best, d) => (!best || dist(d) < dist(best) ? d : best), undefined);
    if (near) a.home = homes.indexOf(near);
    return near;
  }

  /**
   * A def's animals, `def.target` of them, at spots in its home (a group together, round the first); with `entry` the
   * `k`th starts at `entry[k]` and walks in (see `beginArrival`).
   */
  private spawn(def: SpeciesDef, opts?: { entry?: Pt[]; onward?: Pt[] }): Agent[] {
    const t = this.traits(def.id), out: Agent[] = [];
    for (let k = 0; k < def.target; k++) {
      const n = this.nextNumber(def.id), entry = opts?.entry?.[k];
      const together = !entry && t.social !== 'solitary' && out.length ? this.places.spotBeside(out[0].motion, k, t, spacing(t)) : null;
      const p = entry ?? together ?? this.places.roamSpot(def.home, t, def.home.center);
      const a = this.born(def, p, this.rng.next() * Math.PI * 2, n);
      if (entry) beginArrival(a, t, this.sctx, arrivalSpot(this.sctx, def.home, t, entry, opts?.onward?.[k]), opts?.onward?.[k]);
      out.push(a);
    }
    this.group();
    return out;
  }

  /** The next individual number of a species (0 is the species' own look). */
  private nextNumber(id: string): number {
    return (this.nextN[id] = (this.nextN[id] ?? 0) + 1) - 1;
  }

  /**
   * One new animal of `def`, individual number `n`, standing at `p` facing `yaw`: natives' seeds come from the valley's
   * seed and the animals so far, a released creature's from its own (its first three), then from its id and number.
   */
  private born(def: SpeciesDef, p: Pt, yaw: number, n: number): Agent {
    const t = this.traits(def.id), r = this.rng;
    const seed = def.released ? (def.seeds?.[n] ?? parseInt(fnv1a(`${n}:${def.id}`), 16)) : (this.seed ^ Math.imul(this.agents.length + 1, 0x9e3779b1)) >>> 0;
    const a: Agent = {
      id: `${def.id}#${n}`, species: def.id, n, seed, home: this.homeIndex(def), motion: newMotion(p.x, p.z, yaw),
      needs: { hunger: r.range(...START_NEED), thirst: r.range(...START_NEED), tired: r.range(0, START_TIRED), fear: 0, company: 0 },
      doing: 'watch', since: DONE, group: null, leader: false,
      focus: null, place: null, stamina: 1, cooldown: 0, fedDay: -1,
      pose: { headDown: 0, sleep: 0, calling: 0, mouth: 'shut', ears: 'rest', look: null }, route: [], detour: null, sink: 0,
      threat: null, wary: 0, until: 0,
    };
    if (soars(t)) {
      // the hawk starts aloft, circling at its own height
      Object.assign(a.motion, { flying: true, wantFly: true, cruise: soarHeight(a), altitude: soarHeight(a) });
    }
    this.place(a, def);
    this.events.push({ type: 'added', id: a.id });
    return a;
  }

  /** Puts every animal in its group, with its leader (the per-tick groups are rebuilt in the agents' order). */
  private group() {
    assignGroups(this.agents, (species) => this.traitsBy.get(species)!);
    this.groups.clear();
  }

  private place(a: Agent, def: SpeciesDef) {
    this.agents.push(a);
    this.byId.set(a.id, a);
    this.defOf.set(a.id, def);
    this.prevs.set(a.id, { ...a.motion });
  }

  private remove(a: Agent) {
    this.agents.splice(this.agents.indexOf(a), 1);
    this.byId.delete(a.id);
    this.defOf.delete(a.id);
    this.prevs.delete(a.id);
    this.events.push({ type: 'removed', id: a.id });
    this.group();
    // the last of a species that has left: the valley forgets it
    if (!this.defs.some((d) => d.id === a.species) && !this.agents.some((x) => x.species === a.species)) this.forget(a.species);
  }

  /**
   * One tick at `hours` valley hours: every animal in turn updates its needs, chooses, acts, moves and keeps clear; then
   * the animals that have gone back to the earth or out of the valley are removed, newcomers come, and a chase whose
   * hunter is no longer chasing is over.
   */
  private tick(hours: number) {
    const s = this.sctx;
    this.t += TICK;
    s.t = this.t;
    s.hours = hours;
    s.day = Math.floor(hours / 24);
    s.hour = hours - 24 * s.day;
    s.sun = elevationDeg(sunDirection(s.hour));
    s.dusk = s.hour > 12 && Math.abs(s.sun) < DUSK;
    s.light = daylight(s.sun);
    this.grid.clear();
    for (const g of this.groups.values()) (g.members.length = 0), (g.x = g.z = 0), (g.leader = null);
    for (const a of this.agents) {
      Object.assign(this.prevs.get(a.id)!, a.motion);
      this.grid.insert(a.id, a.motion.x, a.motion.z);
      if (!a.group || ERRAND.has(a.doing)) continue; // one walking in or out is not part of its group yet (or any more)
      let g = this.groups.get(a.group);
      if (!g) this.groups.set(a.group, (g = { members: [], x: 0, z: 0, leader: null }));
      g.members.push(a);
      g.x += a.motion.x;
      g.z += a.motion.z;
      if (a.leader) g.leader = a;
    }
    for (const a of this.agents) this.tickAgent(a, s);
    this.keepWatch(s);
    for (const a of this.agents.filter((x) => x.doing === 'returning' && x.sink >= 1)) this.remove(a);
    this.comings(s);
    const chaser = this.byId.get(this.governor.chase ?? '');
    if (this.governor.chase && !(chaser && (chaser.doing === 'chase' || chaser.doing === 'dive'))) this.governor.chase = null;
  }

  /**
   * The valley's comings and goings: a species short of its usual number gets a newcomer scheduled for each missing animal
   * (in NEWCOMER_HOURS valley hours, varied); when one is due it walks in from the edge (or, with no way in, from a
   * spot in its home) if nobody sees where it enters, else it tries again soon. Leavers that have gone out of sight, or
   * have had their time, are removed.
   */
  private comings(s: SimCtx) {
    if (s.newcomers) this.newcomersCome(s);
    for (const a of leaversGone(this.agents, (id) => s.seen(id), this.t)) this.remove(a);
  }

  /** Schedules and brings the newcomers (see `comings`). */
  private newcomersCome(s: SimCtx) {
    for (const { species, n } of shortOf(this.defs, this.agents, this.pending))
      for (let i = 0; i < n; i++) this.pending.push({ species, at: this.t + this.rng.range(...NEWCOMER_HOURS) * ANIMAL_S_PER_HOUR });
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.at > this.t) continue;
      if (!this.defs.some((d) => d.id === p.species)) this.pending.splice(i, 1); // its species has gone
      else if (this.newcomer(p.species, s)) this.pending.splice(i, 1);
      else p.at = this.t + RETRY;
    }
  }

  /** One newcomer of `species` at the valley's edge, walking in to its home (a moment); false, with nothing done, if the point is seen. */
  private newcomer(species: string, s: SimCtx): boolean {
    const def = emptiestHome(this.defs, this.agents, species), t = this.traits(species), home = def.home;
    const p = this.places.edgeEntry(home, this.view?.eye ?? home.center, t) ?? this.places.roamSpot(home, t, home.center);
    if (this.view?.seenAt?.(p)) return false;
    const a = this.born(def, p, 0, this.nextNumber(species));
    beginArrival(a, t, s, arrivalSpot(s, home, t, p));
    this.group();
    s.moment('newcomer', a, [a], MEDIUM, placeName(this.world, home));
    return true;
  }

  private tickAgent(a: Agent, s: SimCtx) {
    const t = this.traitsBy.get(a.species)!, diet = this.diet.get(a.species)!, m = a.motion, w = this.world;
    // apart: farther from its mates' centre than its group's distance (it has not moved yet this tick)
    const g = a.group && !ERRAND.has(a.doing) ? this.groups.get(a.group) : undefined, k = g ? g.members.length - 1 : 0;
    const apart = k > 0 && Math.hypot((g!.x - m.x) / k - m.x, (g!.z - m.z) / k - m.z) > GROUP_DISTANCE[t.social];
    updateNeeds(a, t, diet.hunter, TICK, tiredTarget(t.activity, s.sun), apart);
    this.sense(a, t, s);
    const done = a.since < 0, lead = g?.leader && g.leader !== a ? g.leader.doing : null;
    const needs = a.leader && g ? groupNeeds(a, g, this.needs) : undefined;
    const cooling = diet.hunter && s.hours < a.cooldown, hold = a.doing === 'rest' && a.until > this.t;
    const next = choose(a, t, { sun: s.sun, dusk: s.dusk, hunter: diet.hunter, forages: diet.forages, roll: done ? this.rng.next() : 0, lead, needs, cooling, hold });
    if (done && g && carriesOn(a, g, next)) a.since = this.t;
    else if (next !== a.doing || done) this.start(a, next);
    BEHAVIOURS[a.doing]?.(a, t, s);
    const roomy = g && a.pose.sleep === 0 && !m.flying && !STOCK_STILL.has(a.doing);
    if (roomy) this.walkOut(a, t, g);
    this.from.x = m.x;
    this.from.z = m.z;
    if (a.stamina <= 0 && !m.flying) m.speedFrac = Math.min(m.speedFrac, SPENT); // out of breath
    steer(m, t, TICK, a.pose.sleep > 0.1);
    if (roomy) this.easeAway(a, t, g);
    if (!keepClear(a, t, w, this.from, Math.max(0.1, t.size * 0.2))) return;
    a.place = null; // that way was barred: the behaviour looks again
    if (!t.swimmer && !t.floater && !m.flying && w.isWater(m.x, m.z)) {
      // came down over the water: out onto the bank
      const bank = this.places.bank(m);
      if (bank) (m.x = bank.x), (m.z = bank.z);
    }
  }

  /**
   * What `a` notices of danger. A fish darts from any other kind of animal on or over the water just by it. A prey animal
   * looks about for the hunters that could take it (a calm one every 0.4 animal s, in turn; one afraid or knowing of a
   * danger, every 0.2 s): the nearest it notices is its threat, and its fear jumps while that one is within its flight
   * distance (twice as far when it runs). A threat is forgotten once fear has gone and the animal has stopped fleeing.
   */
  private sense(a: Agent, t: Traits, s: SimCtx) {
    const m = a.motion;
    if (a.doing === 'returning' || a.doing === 'leave') return;
    if (t.swimmer && a.doing !== 'flee') {
      for (const id of this.grid.near(m.x, m.z, DART_NEAR, this.near)) {
        const b = this.byId.get(id)!;
        if (b.species === a.species || !this.world.isWater(b.motion.x, b.motion.z)) continue;
        this.start(a, 'flee');
        a.threat = { id: b.id, x: b.motion.x, z: b.motion.z, t: this.t, noticed: true, charging: false };
        return;
      }
    }
    const d = this.dangers.get(a.species);
    if (!d) return;
    const calm = !a.threat && !a.needs.fear && !FRIGHT.has(a.doing);
    if ((Math.round(this.t / TICK) + a.seed) % (calm ? SCAN : ALERT_SCAN) !== 0) return;
    // a calm animal looks only as far as a running hunter would frighten it; one knowing of a danger tracks it all the way
    let near: Agent | null = null, nearest = Infinity;
    for (const id of this.grid.near(m.x, m.z, calm ? Math.min(d.reach, 2 * flight(t)) : d.reach, this.near)) {
      const b = this.byId.get(id)!, bm = b.motion, bd = between(a, b);
      if (bd >= nearest || !d.hunters.has(b.species)) continue;
      const stalking = b.doing === 'stalk' && inCover(this.world, bm.x, bm.z);
      if (notices(a, t, b, this.traitsBy.get(b.species)!, s.light, stalking)) (near = b), (nearest = bd);
    }
    if (near) {
      const nt = this.traitsBy.get(near.species)!, nm = near.motion, close = nearest <= flight(t) * (running(near, nt) ? 2 : 1);
      if (close) a.needs.fear = Math.max(a.needs.fear, fright(t));
      if (close || a.threat) a.threat = { id: near.id, x: nm.x, z: nm.z, t: this.t, noticed: true, charging: runsAt(near, nt, a) };
    }
    if (a.threat && !a.needs.fear && !FRIGHT.has(a.doing)) a.threat = null;
  }

  /** A grazing herd keeps one watcher: when the watch passes (or the herd starts grazing), the next grazer looks up. */
  private keepWatch(s: SimCtx) {
    for (const g of this.groups.values()) {
      if (!g.members.length) continue;
      const t = this.traitsBy.get(g.members[0].species)!, w = nextWatcher(g, t);
      if (!w) continue;
      this.start(w, 'watch');
      watch(w, t, s);
    }
  }

  /**
   * A group member standing, drinking or feeding in a mate's personal space walks out of it: a short step away (or, water
   * that way, a quarter turn either side), steered like any other (a feeder keeps its slow pace; one walking somewhere
   * already bends away as it goes).
   */
  private walkOut(a: Agent, t: Traits, g: Group) {
    const m = a.motion, feeding = (a.doing === 'graze' || a.doing === 'forage') && a.pose.headDown >= 1;
    if (m.target && !feeding) return;
    const off = spread(a, g.members, spacing(t) * PERSONAL, this.off), d = Math.hypot(off.x, off.z);
    if (d < 1e-6) return;
    const k = Math.max(d, STEP_OUT) / d, dx = off.x * k, dz = off.z * k;
    for (const [x, z] of [[dx, dz], [-dz, dx], [dz, -dx]]) {
      if (!this.places.open(t, m, m.x + x, m.z + z)) continue;
      m.target = { x: m.x + x, z: m.z + z };
      a.detour = null; // a new target: any side step is over
      if (!feeding) m.speedFrac = WALK_OUT;
      return;
    }
  }

  /**
   * Eases a group member out of the personal space of any mate too close to it, barely visibly (a slow drift, or a
   * slight veer when walking): straight away, or (water that way) a quarter turn either side.
   */
  private easeAway(a: Agent, t: Traits, g: Group) {
    const off = spread(a, g.members, spacing(t) * PERSONAL, this.off), d = Math.hypot(off.x, off.z), m = a.motion;
    if (d < 1e-6) return;
    const step = Math.min(d, Math.max(NUDGE, m.speed * VEER) * TICK) / d, dx = off.x * step, dz = off.z * step;
    for (const [x, z] of [[dx, dz], [-dz, dx], [dz, -dx]]) {
      if (!this.places.suits(t, { x: m.x + x, z: m.z + z })) continue;
      m.x += x;
      m.z += z;
      return;
    }
  }

  /** A test for a spot for `a`: room there (none of its kind within `space` m, there or going there), and it can get there. */
  private room(a: Agent, t: Traits, space: number) {
    return (p: Pt) => !crowded(this.agents, a, p.x, p.z, space) && this.places.reaches(t, a.motion, p, LONG_WALK);
  }

  /** Others of `a`'s kind within `within` m of `p` (a shared list, refilled on each call). */
  private kinNear(a: Agent, p: Pt, within: number): Agent[] {
    this.kin.length = 0;
    for (const id of this.grid.near(p.x, p.z, within, this.near)) {
      const b = this.byId.get(id)!;
      if (b !== a && b.species === a.species) this.kin.push(b);
    }
    return this.kin;
  }

  /**
   * Where `a` actually heads on its way to `to`, and how fast: a follower doing what its leader does (or feeding while
   * it feeds; not fleeing, which each does its own way) keeps its place in the leader's train (catching up when behind)
   * while the leader is on a long walk or its own place is far from where the leader is going (and then it picks its
   * place again); a group member's way bends with its flock, a solitary animal's away from its own kind, by at most a
   * share of the way still to go when it is going to its own place (so it gets there). Neither leads it where it cannot
   * walk straight (water in the way of a walker, land in a fish's). A group member keeps its target while the new one is
   * within `slack` m of it. A group member steers round a mate in its space (see `steerClear`). A stalker or a chaser
   * goes its own way straight at where it is going.
   */
  private aim(a: Agent, t: Traits, to: Pt, speedFrac: number): { to: Pt; speedFrac: number; slack: number } {
    if (a.doing === 'chase' || a.doing === 'stalk') return { to, speedFrac, slack: 0 };
    const m = a.motion, g = a.group ? this.groups.get(a.group) : undefined, L = g?.leader;
    let x = to.x, z = to.z, train = false;
    if (g && L && L !== a && alike(L.doing, a.doing) && !L.motion.flying && !FRIGHT.has(a.doing) && !HUNTING.has(a.doing)) {
      const lm = L.motion, lt = L.detour ?? lm.target, dest = L.place ?? lt ?? lm, mine = a.place ?? to;
      const astray = Math.hypot(mine.x - dest.x, mine.z - dest.z) > GROUP_DISTANCE[t.social];
      const p = astray || (lt && Math.hypot(lt.x - lm.x, lt.z - lm.z) > LONG_WALK) ? this.train(a, t, g, L) : null;
      if (p && this.places.open(t, m, p.x, p.z)) {
        if (astray) a.place = null; // its place no longer goes with its leader's: it picks again, beside it, next tick
        const behind = Math.hypot(p.x - m.x, p.z - m.z);
        (x = p.x), (z = p.z), (train = true);
        speedFrac = Math.min(1, Math.max(speedFrac, lm.speedFrac) * (1 + Math.max(0, Math.min(1, (behind - CATCH) / CATCH_RANGE))));
      }
    }
    let off: Pt | null = null;
    if (g) off = flock(a, g.members, t, TICK, this.off);
    else if (t.social === 'solitary') off = spread(a, this.kinNear(a, m, SOLITARY_GAP), SOLITARY_GAP, this.off);
    const d = Math.hypot(x - m.x, z - m.z);
    if (off) {
      const mag = Math.hypot(off.x, off.z), cap = !train && samePt(a.place, to) ? BEND * d : Math.max(BEND * d, spacing(t));
      if (mag > cap) (off.x *= cap / mag), (off.z *= cap / mag);
      if (this.places.open(t, m, x + off.x, z + off.z)) (x += off.x), (z += off.z);
    }
    if (g) ({ x, z, speedFrac } = this.steerClear(a, t, g, x, z, speedFrac));
    return { to: x === to.x && z === to.z ? to : { x, z }, speedFrac, slack: g ? Math.min(SLACK, SLACK_SHARE * d) : 0 };
  }

  /**
   * A group member with a mate in its space steers round it (a step's push added to a far place would hardly turn it):
   * it heads for a point STEER_NEAR m along its way, pushed sideways only (round the mate's left side when it is dead
   * ahead), so it never stops by it; and, unless fleeing, it gives way, slowing, to a mate on the move ahead of it with a
   * lower `n`.
   */
  private steerClear(a: Agent, t: Traits, g: Group, x: number, z: number, speedFrac: number): { x: number; z: number; speedFrac: number } {
    const m = a.motion, d = Math.hypot(x - m.x, z - m.z), gap = spacing(t);
    const sep = spread(a, g.members, gap, this.sep), len = Math.hypot(sep.x, sep.z);
    if (len < 1e-6 || d < 1e-6) return { x, z, speedFrac };
    // sideways only: the part of the push straight back is dropped (a mate dead ahead: round its left side)
    const ux = (x - m.x) / d, uz = (z - m.z) / d, back = Math.min(0, sep.x * ux + sep.z * uz);
    let sx = sep.x - back * ux, sz = sep.z - back * uz;
    if (back < 0 && Math.hypot(sx, sz) < len * 0.5) (sx = -uz * len), (sz = ux * len);
    const dx = (b: Agent) => b.motion.x - m.x, dz = (b: Agent) => b.motion.z - m.z;
    const giveWay = (b: Agent) => b.n < a.n && b.motion.speed > ON_THE_MOVE && Math.hypot(dx(b), dz(b)) < gap && dx(b) * ux + dz(b) * uz > 0;
    if (!FRIGHT.has(a.doing) && g.members.some(giveWay)) speedFrac *= YIELD; // (one running for its life gives way to nobody)
    const step = Math.min(d, STEER_NEAR), px = m.x + ux * step + sx, pz = m.z + uz * step + sz;
    return this.places.open(t, m, px, pz) ? { x: px, z: pz, speedFrac } : { x, z, speedFrac };
  }

  /**
   * A follower's place in its leader's train; if it could not stand there, in single file on the leader's track behind
   * it; failing that, the leader's own spot.
   */
  private train(a: Agent, t: Traits, g: Group, L: Agent): Pt {
    const p = trainSpot(a, g, L, spacing(t));
    if (this.places.suits(t, p)) return p;
    const lm = L.motion, back = spacing(t) * (rank(a, g) + 1), q = { x: lm.x - Math.sin(lm.yaw) * back, z: lm.z - Math.cos(lm.yaw) * back };
    return this.places.suits(t, q) ? q : { x: lm.x, z: lm.z };
  }

  /** Starts `doing` afresh: a new start time, nowhere to go yet (resting and sleeping keep their place), a plain pose. */
  private start(a: Agent, doing: Doing) {
    if (!(LYING.has(a.doing) && LYING.has(doing))) a.place = null;
    a.doing = doing;
    a.since = this.t;
    a.route = [];
    a.focus = null;
    a.motion.target = null;
    a.detour = null;
    a.until = 0;
    this.sctx.pose(a, 0, 0);
  }

  private makeCtx(): SimCtx {
    const sim = this;
    return {
      world: this.world, places: this.places, rng: this.rng, t: 0, hours: 0, hour: 0, sun: 0, dusk: false, light: 1, day: 0,
      governor: this.gov, forceCatch: false, newcomers: true,
      home: (a) => sim.defOf.get(a.id)!.home,
      get: (id) => (id === null ? undefined : sim.byId.get(id)),
      traits: (species) => sim.traitsBy.get(species)!,
      prey(a, t) {
        const q = sim.quarry.get(a.species), m = a.motion;
        if (!q) return null;
        let near: Agent | null = null, nearest = Infinity;
        for (const id of sim.grid.near(m.x, m.z, q.reach, sim.near)) {
          const b = sim.byId.get(id)!, d = between(a, b);
          if (d >= nearest || !this.huntable(a, t, b)) continue;
          if (notices(a, t, b, sim.traitsBy.get(b.species)!, this.light, false)) (near = b), (nearest = d);
        }
        return near;
      },
      huntable(a, t, b) {
        const bm = b.motion, wet = sim.world.isWater(bm.x, bm.z);
        if (b.doing === 'returning' || b.doing === 'leave' || b.doing === 'hide' || !sim.quarry.get(a.species)?.prey.has(b.species)) return false;
        if (t.swimmer) return wet;
        if (wet || bm.flying) return false;
        return !t.canFly || !inCover(sim.world, bm.x, bm.z);
      },
      keepOff(a) {
        const keep = sim.keeps.get(a.species), q = sim.quarry.get(a.species);
        if (!keep || !q) return undefined;
        // and the prey where it is now (prey driven off its home grazes and lies up elsewhere)
        const now = sim.agents.filter((b) => q.prey.has(b.species)).map((b) => ({ x: b.motion.x, z: b.motion.z, r: flight(sim.traitsBy.get(b.species)!) + KEEP_OFF }));
        return (p) => now.reduce((m, c) => Math.min(m, Math.hypot(p.x - c.x, p.z - c.z) - c.r), keep(p));
      },
      preyGround(a) {
        const q = sim.quarry.get(a.species), c = sim.defOf.get(a.id)!.home.center;
        let best: HomeRange | null = null, bd = Infinity;
        for (const d of sim.defs) {
          const dd = Math.hypot(d.home.center.x - c.x, d.home.center.z - c.z);
          if (q?.prey.has(d.id) && dd < bd) (best = d.home), (bd = dd);
        }
        return best;
      },
      resting(t) {
        return resting(t.activity, this.sun);
      },
      go(a, t, to, speedFrac) {
        const m = a.motion;
        m.wantFly = soars(t) && Math.hypot(to.x - m.x, to.z - m.z) > Math.max(LAND_NEAR, m.altitude * 1.5);
        let slack = 0;
        if (!m.wantFly) ({ to, speedFrac, slack } = sim.aim(a, t, to, speedFrac));
        if (!nearPt(m.target, to, slack) && !nearPt(a.detour, to, slack)) (m.target = to), (a.detour = null);
        m.speedFrac = m.wantFly ? Math.max(speedFrac, FLY_TRAVEL) : speedFrac;
      },
      stop(a) {
        a.motion.target = null;
        a.detour = null;
        a.motion.wantFly = false;
      },
      at: (a, p, within) => !a.motion.flying && Math.hypot(p.x - a.motion.x, p.z - a.motion.z) < within,
      pose(a, headDown, sleep, mouth = 'shut', ears = 'rest') {
        const p = a.pose;
        p.headDown = headDown;
        p.sleep = sleep;
        p.mouth = mouth;
        p.ears = ears;
        p.calling = 0;
        p.look = null;
      },
      done(a) {
        a.since = DONE;
      },
      become: (a, doing) => sim.start(a, doing),
      seen: (id) => sim.view?.seen(id) ?? false,
      centre(a) {
        const g = a.group ? sim.groups.get(a.group) : undefined, n = g ? g.members.length : 0;
        if (!g || n < 2) return null;
        const p = sim.prevs.get(a.id)!; // where it stood when the sums were taken
        return { x: (g.x - p.x) / (n - 1), z: (g.z - p.z) / (n - 1) };
      },
      beside(a, finish) {
        const g = a.group ? sim.groups.get(a.group) : undefined, L = g?.leader;
        if (!g || !L || L === a) return null;
        // round the leader's place when doing the same; a feeder whose leader feeds (going nowhere) or watches feeds by it
        const same = alike(L.doing, a.doing), feeds = FEEDING.has(a.doing) && (same || L.doing === 'watch');
        const base = same && L.place ? L.place : feeds ? L.motion : null;
        if (!base) return null;
        const t = sim.traitsBy.get(a.species)!, m = a.motion;
        // a feeder already by it feeds where it stands
        if (FEEDING.has(a.doing) && Math.hypot(m.x - base.x, m.z - base.z) < GROUP_DISTANCE[t.social] * BY) return { x: m.x, z: m.z };
        // its own spot round it, or (that taken: a bank in a bay gathers the spots) the next free one farther out
        const k0 = rank(a, g), room = sim.room(a, t, spacing(t));
        for (let k = k0; k < k0 + ROOM_RINGS; k++) {
          const p = sim.places.spotBeside(base, k, t, spacing(t), finish, room);
          if (p) return p;
        }
        return null;
      },
      apart<P extends Pt | null>(a: Agent, pick: (near: Pt) => P, finish?: (p: Pt) => Pt | null): P {
        const t = sim.traitsBy.get(a.species)!, gap = a.group ? spacing(t) : SOLITARY_GAP;
        let p = pick(a.motion);
        for (let i = 1; i < APART_TRIES && p && crowded(sim.agents, a, p.x, p.z, gap); i++) p = pick(a.motion);
        // still taken (it may be the only spot it can reach): a spot round it with room
        for (let k = 1; k <= ROOM_RINGS && p && crowded(sim.agents, a, p.x, p.z, gap); k++) p = (sim.places.spotBeside(p, k, t, gap, finish, sim.room(a, t, gap)) as P) ?? p;
        return p;
      },
      mates(a, within, test) {
        const out: Agent[] = [];
        for (const id of sim.grid.near(a.motion.x, a.motion.z, within, sim.near)) {
          const b = sim.byId.get(id)!;
          if ((a.group ? b.group === a.group : b.species === a.species) && test(b)) out.push(b);
        }
        return out;
      },
      moment(kind, a, members, interest, where = '', prey) {
        const def = sim.defOf.get(a.id)!, plural = members.length > 1, pd = prey && sim.defOf.get(prey.id)!;
        const quarry = pd && { name: pd.name, native: !pd.released, plural: prey.group !== null };
        sim.moments.emit(
          {
            hours: this.hours, kind, actors: [...members.map((b) => b.id), ...(prey ? [prey.id] : [])],
            species: prey && prey.species !== a.species ? [a.species, prey.species] : [a.species], at: { x: a.motion.x, z: a.motion.z },
            follow: a.id, interest, text: momentText(kind, { name: def.name, native: !def.released, plural }, where, quarry),
          },
          plural ? (a.group ?? a.species) : a.id,
        );
      },
    };
  }
}
