import { fnv1a } from '../util/hash';
import type { HomeRange } from '../valley/types';
import { slot } from './behaviours/group';
import { Rng } from './rng';
import type { Traits } from './traits';
import type { Pt, SimWorld } from './types';

/** Spots stay this far inside the valley's edge (m), on slopes under this many degrees, this far from a trunk (m). */
const EDGE = 20, MAX_SLOPE_DEG = 30, TRUNK_GAP = 0.8;
/** Open water is at least this deep (m); the shore is dry land within this many metres of water. */
const DEEP = 0.6, SHORE_REACH = 6;
/** A fish's water is at least this deep (m), so it does not nose into the edge. */
const SWIM = 0.3;
/** Forest edge (cover for prey), deep forest (a den), meadow, and crags (rock) for a roost. */
const EDGE_FOREST = [0.3, 0.7] as const, DEN_FOREST = 0.6, MEADOW = 0.4, CRAG = 0.4;
/** An animal feeds where it is when that suits it and is within this many home radii of the centre. */
const ROAM = 2;
/** Each kind of spot in a home: up to this many tries to find this many, then the few spots nearest a point to choose among. */
const SAMPLES = 400, KEEP = 24, NEAREST = 4;
/** Searching outward when the home has (almost) none: spiral step and reach beyond the home (m). */
const SPIRAL_STEP = 4, SPIRAL_REACH = 200, FEW = 4;
/** Path checks every this many metres; bank search: spiral step and reach (m), and steps back onto the land. */
const PATH_STEP = 2, BANK_STEP = 3, BANK_REACH = 300, BANK_BACK = 0.5, BANK_ON = 0.4;
/** A bank point on a trunk or a steep slope moves up to this far (m) further onto the land (still within reach of the water). */
const BANK_UP = 1;
/** A bank outside a keep-off is looked for with this coarser spiral step (m), so the search stays cheap (and as far again outside). */
const KEPT_BANK_STEP = 6;
/** A search out to a long reach steps at most this many times across it (a coarser spiral, so it stays cheap). */
const FAR_STEPS = 25;
/** Newcomers' entry points lie this far apart (m) along the valley's edge, and keep this far (m) from the camera where they can. */
const ENTRY_STEP = 20, ENTRY_EYE = 80;
/** Of the spots outside a keep-off, an animal picks among this share lying farthest out of it. */
const KEPT_SHARE = 1 / 3;
/** An animal's way is checked every PATH_FINE m over its first PATH_NEAR m (it may stand at the water's edge). */
const PATH_FINE = 0.4, PATH_NEAR = 4;

type Test = (x: number, z: number) => boolean;
/** How far (m) a spot lies outside the ground an animal keeps off (negative inside it): a hunter's keep-off from its prey. */
export type KeepOff = (p: Pt) => number;
/** The kinds of ground a spot can be on. */
type Ground = 'deep' | 'swim' | 'shallows' | 'shore' | 'dry' | 'cover' | 'den' | 'crag' | 'pasture' | 'meadow';

/** First point on an Archimedean spiral (radial step `step`, arc steps of `step`) round (cx, cz) out to `maxR` that passes `test`. */
function spiral(cx: number, cz: number, step: number, maxR: number, test: Test, each?: (x: number, z: number) => boolean): Pt | null {
  let theta = 0, r = 0;
  while (r <= maxR) {
    const x = cx + Math.cos(theta) * r, z = cz + Math.sin(theta) * r;
    if (test(x, z) && (!each || each(x, z))) return { x, z };
    theta += step / Math.max(r, step);
    r = (step * theta) / (Math.PI * 2);
  }
  return null;
}

/**
 * Where animals go: resting places, feeding grounds, banks and cover, read from the terrain and biome maps. Each kind of
 * spot is sampled once per home (from its own numbers, so the spots do not depend on when they are first asked for) and
 * kept; picking among them uses the simulation's `rng`. Spots suit the animal (dry for walkers, wet for fish) and, for
 * walkers and fish, can be reached in a straight line from where it asks.
 */
export class Places {
  private spots = new Map<string, Pt[]>();
  private tests = new Map<Ground, Test>();

  constructor(private world: SimWorld, private rng: Rng) {}

  /**
   * Where it rests: cover at the forest edge for prey, deep forest (a den) for hunters, a crag or high tree for fliers,
   * open water for water birds, deep water for fish, the shore for shore animals; outside `keep` (see `kept`) if given.
   */
  restSpot(home: HomeRange, t: Traits, near: Pt, keep?: KeepOff): Pt {
    const g = this.restGround(home, t);
    return keep ? this.pickKept(home, t, g, near, keep) : this.pick(home, t, g, near, true);
  }

  /** The kept resting spots of animals of these traits in a home (where they lie up: a prey's cover). */
  restSpots(home: HomeRange, t: Traits): readonly Pt[] {
    return this.candidates(home, this.restGround(home, t));
  }

  /**
   * Where its plants grow: the open meadow on land (or the forest edge too, for a browser that eats leaves), the shallows for
   * water birds; where it is, if that will do.
   */
  grazeSpot(home: HomeRange, t: Traits, near: Pt): Pt {
    return this.feed(home, t, near, undefined, true);
  }

  /**
   * Where it finds small food or berries: the water for fish, the shallows for water birds, the shore for shore animals,
   * else the meadow or forest edge; where it is, if that will do; outside `keep` (see `kept`) if given.
   */
  forageSpot(home: HomeRange, t: Traits, near: Pt, keep?: KeepOff): Pt {
    return this.feed(home, t, near, keep);
  }

  /** Anywhere in its home that suits it (a patrol point, a start), chosen at random rather than nearest. */
  roamSpot(home: HomeRange, t: Traits, near: Pt): Pt {
    return this.pick(home, t, this.roamGround(home, t), near, false);
  }

  /**
   * Where a newcomer walks in from: a spot just inside the valley's edge that suits it (dry for walkers, water for fish,
   * anywhere for water birds and fliers) and from which it can walk to the home, the nearest to the home of those away
   * from the camera at `eye` (any, if all are near it); null if the edge has none.
   */
  edgeEntry(home: HomeRange, eye: Pt, t: Traits): Pt | null {
    const w = this.world, half = w.size / 2 - EDGE - 1, c = home.center;
    const suits: Test = t.swimmer ? this.test('swim') : t.floater || (t.canFly && t.medium === 'air') ? () => true : this.test('dry');
    const goals = this.candidates(home, this.roamGround(home, t));
    const edge: Pt[] = [];
    for (let s = -half; s <= half + 1e-9; s += ENTRY_STEP) edge.push({ x: s, z: -half }, { x: s, z: half }, { x: -half, z: s }, { x: half, z: s });
    const homeward = (p: Pt) => Math.hypot(p.x - c.x, p.z - c.z);
    edge.sort((a, b) => homeward(a) - homeward(b));
    const away = edge.filter((p) => Math.hypot(p.x - eye.x, p.z - eye.z) >= ENTRY_EYE);
    return (away.length ? away : edge).find((p) => suits(p.x, p.z) && !w.trunksNear(p.x, p.z, TRUNK_GAP).length && goals.some((g) => this.open(t, p, g.x, g.z))) ?? null;
  }

  /**
   * A dry spot at the edge of the water nearest `from` (today's nearest bank: clear of trunks and not steep, where such a
   * spot is a step or two up from the water), or null if there is none within 300 m; with `keep`, the nearest whose water
   * lies outside it (a hunter drinks away from its prey), if there is one.
   */
  bank(from: Pt, keep?: KeepOff): Pt | null {
    const w = this.world;
    let water = spiral(from.x, from.z, BANK_STEP, BANK_REACH, w.isWater);
    if (!water) return null;
    if (keep && keep(water) < 0) {
      // water at the edge on its side (a step toward it is dry), far enough out that its bank is outside too
      const edge = (x: number, z: number) => {
        const d = Math.hypot(from.x - x, from.z - z) || 1, s = KEPT_BANK_STEP / d;
        return w.isWater(x, z) && !w.isWater(x + (from.x - x) * s, z + (from.z - z) * s) && keep({ x, z }) >= KEPT_BANK_STEP;
      };
      water = spiral(from.x, from.z, KEPT_BANK_STEP, BANK_REACH, edge) ?? water;
    }
    // back toward the animal until dry, then a little further onto the land
    let dx = from.x - water.x, dz = from.z - water.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) (dx /= d), (dz /= d);
    else (dx = 1), (dz = 0); // standing in the water: any way out will do
    let s = 0;
    while (w.isWater(water.x + dx * s, water.z + dz * s)) if ((s += BANK_BACK) > BANK_REACH) return null;
    s += BANK_ON;
    // where a trunk or a steep bank is in the way, a little further up onto ground it can stand on (if there is any near)
    const dry = this.test('dry');
    for (let up = 0; up <= BANK_UP; up += BANK_BACK) {
      const p = { x: water.x + dx * (s + up), z: water.z + dz * (s + up) };
      if (dry(p.x, p.z)) return p;
    }
    return { x: water.x + dx * s, z: water.z + dz * s };
  }

  /** The nearest dry deep forest within `within` m of `from` on the side away from `away` (looked for more coarsely far off), or null. */
  cover(from: Pt, away: Pt, within: number): Pt | null {
    const ux = from.x - away.x, uz = from.z - away.z, dry = this.test('dry');
    return spiral(from.x, from.z, Math.max(BANK_STEP, within / FAR_STEPS), within, (x, z) => (x - from.x) * ux + (z - from.z) * uz >= 0 && this.world.biomeAt(x, z).forest >= DEN_FOREST && dry(x, z));
  }

  /**
   * The nearest water within `within` m of `from` deep enough to swim in (open water, when `open`), on the side away
   * from `away` when there is any there, else on any side; null if none.
   */
  water(from: Pt, away: Pt, within: number, open: boolean): Pt | null {
    const ux = from.x - away.x, uz = from.z - away.z, wet = this.test(open ? 'deep' : 'swim'), step = Math.max(BANK_STEP, within / FAR_STEPS);
    return spiral(from.x, from.z, step, within, (x, z) => (x - from.x) * ux + (z - from.z) * uz >= 0 && wet(x, z)) ?? spiral(from.x, from.z, step, within, wet);
  }

  /** Whether an animal of these traits can stand at `p`: dry land for walkers, water for fish, either for water birds. */
  suits(t: Traits, p: Pt): boolean {
    return t.floater || this.world.isWater(p.x, p.z) === t.swimmer;
  }

  /** Whether an animal of these traits can go straight from `from` to (x, z): no water in a walker's way, no land in a fish's. */
  open(t: Traits, from: Pt, x: number, z: number): boolean {
    if (t.floater || (t.canFly && t.medium === 'air')) return true;
    const d = Math.hypot(x - from.x, z - from.z), w = this.world;
    for (let s = PATH_FINE; s < d; s += s < PATH_NEAR ? PATH_FINE : PATH_STEP) if (w.isWater(from.x + ((x - from.x) * s) / d, from.z + ((z - from.z) * s) / d) !== t.swimmer) return false;
    return w.isWater(x, z) === t.swimmer;
  }

  /** Whether an animal can get to `p`: straight there when it is within `far` m; farther, it is led there (following its leader). */
  reaches(t: Traits, from: Pt, p: Pt, far: number): boolean {
    return Math.hypot(p.x - from.x, p.z - from.z) > far || this.open(t, from, p.x, p.z);
  }

  /**
   * The `k`th spot round `base` (k = 0 is `base` itself), `space` m apart, on the same ground as `base` and clear of
   * trunks, turned into the final spot by `finish` if given, and passing `ok` if given (eight turns of it are tried).
   * Null if there is none.
   */
  spotBeside(base: Pt, k: number, t: Traits, space: number, finish?: (p: Pt) => Pt | null, ok?: (p: Pt) => boolean): Pt | null {
    const w = this.world, wet = w.isWater(base.x, base.z);
    for (let j = 0; j < 8; j++) {
      const o = slot(k, space, (j * Math.PI) / 4), q = { x: base.x + o.x, z: base.z + o.z };
      if (w.isWater(q.x, q.z) !== wet || (!wet && w.trunksNear(q.x, q.z, t.size * 0.5).length)) continue;
      const p = finish ? finish(q) : q;
      if (p && (!ok || ok(p))) return p;
    }
    return null;
  }

  /**
   * A feeding ground (a grazer's, `grazing`: out in the meadow unless it browses too): right here when it suits and is not
   * far out of its home (needs take it beyond), else the nearest kept one.
   */
  private feed(home: HomeRange, t: Traits, near: Pt, keep?: KeepOff, grazing = false): Pt {
    const g: Ground = t.swimmer ? 'swim' : t.floater ? (home.medium === 'water' ? 'shallows' : 'shore') : home.medium === 'shore' ? 'shore'
      : grazing && !t.browser ? 'meadow' : 'pasture';
    const inHome = Math.hypot(near.x - home.center.x, near.z - home.center.z) <= home.radius * ROAM;
    if (inHome && this.test(g)(near.x, near.z) && (!keep || keep(near) >= 0)) return { x: near.x, z: near.z };
    return keep ? this.pickKept(home, t, g, near, keep) : this.pick(home, t, g, near, true);
  }

  /** The ground an animal of these traits roams in a home. */
  private roamGround(home: HomeRange, t: Traits): Ground {
    return t.swimmer ? 'swim' : t.floater ? (home.medium === 'water' ? 'deep' : 'shore') : home.medium === 'shore' ? 'shore' : 'dry';
  }

  /** The ground an animal of these traits rests on in a home. */
  private restGround(home: HomeRange, t: Traits): Ground {
    return t.swimmer ? 'deep' : t.floater ? (home.medium === 'water' ? 'deep' : 'shore') : home.medium === 'shore' ? 'shore'
      : t.canFly && home.medium === 'air' ? 'crag' : t.prey[1] > 0 && !t.smallFood ? 'den' : 'cover';
  }

  /**
   * A spot of ground `g` outside `keep` that `near` can walk to, from the first of these that has one: the farthest-out
   * third of the kept spots of `g` in the home outside it; a walker's plain dry ground in its home outside it (likewise);
   * spots of `g` (or a walker's dry ground) spread over and beyond the home outside it (its prey lives all over it); the
   * one spot of `g` farthest out of it. Where it can walk to none, it stays where it is.
   */
  private pickKept(home: HomeRange, t: Traits, g: Ground, near: Pt, keep: KeepOff): Pt {
    const farthest = (ps: readonly Pt[]) => {
      const out = ps.map((p) => ({ p, k: keep(p) })).filter((x) => x.k >= 0).sort((a, b) => b.k - a.k);
      return out.slice(0, Math.ceil(out.length * KEPT_SHARE)).map((x) => x.p);
    };
    const walker = !t.swimmer && !t.floater && !t.canFly, grounds: Ground[] = walker && g !== 'dry' ? [g, 'dry'] : [g];
    const c = home.center, reach = home.radius + SPIRAL_REACH;
    const beyond = (ground: Ground) => {
      const suits = this.test(ground), rng = new Rng(parseInt(fnv1a(`beyond|${ground}|${c.x},${c.z},${home.radius}`), 16)), out: Pt[] = [];
      for (let i = 0; i < SAMPLES && out.length < KEEP; i++) {
        const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * reach, p = { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
        if (suits(p.x, p.z) && keep(p) >= 0) out.push(p);
      }
      return out;
    };
    const tiers = [...grounds.map((ground) => () => farthest(this.candidates(home, ground))), ...grounds.map((ground) => () => beyond(ground)),
      () => [this.candidates(home, g).reduce((best, p) => (keep(p) > keep(best) ? p : best))]];
    for (const tier of tiers) {
      const spots = tier(), p = spots.length ? this.tryPick(home, t, g, near, true, spots) : null;
      if (p) return p;
    }
    return { x: near.x, z: near.z };
  }

  /** Whether a point is ground of the kind. */
  private test(g: Ground): Test {
    let test = this.tests.get(g);
    if (!test) this.tests.set(g, (test = this.makeTest(g)));
    return test;
  }

  private makeTest(g: Ground): Test {
    const w = this.world;
    const dry: Test = (x, z) => !w.isWater(x, z) && w.inside(x, z, EDGE) && (Math.acos(w.normalAt(x, z).y) * 180) / Math.PI < MAX_SLOPE_DEG && w.trunksNear(x, z, TRUNK_GAP).length === 0;
    const forest = (x: number, z: number) => w.biomeAt(x, z).forest;
    const edge = (x: number, z: number) => forest(x, z) >= EDGE_FOREST[0] && forest(x, z) <= EDGE_FOREST[1];
    switch (g) {
      case 'deep': return (x, z) => w.isWater(x, z) && w.waterDepthAt(x, z) >= DEEP;
      case 'swim': return (x, z) => w.isWater(x, z) && w.waterDepthAt(x, z) >= SWIM;
      case 'shallows': return (x, z) => w.isWater(x, z) && w.waterDepthAt(x, z) < DEEP;
      case 'shore': return (x, z) => {
        if (!dry(x, z)) return false;
        for (let k = 0; k < 8; k++) if (w.isWater(x + Math.cos((k * Math.PI) / 4) * SHORE_REACH, z + Math.sin((k * Math.PI) / 4) * SHORE_REACH)) return true;
        return false;
      };
      case 'dry': return dry;
      case 'cover': return (x, z) => edge(x, z) && dry(x, z);
      case 'den': return (x, z) => forest(x, z) >= DEN_FOREST && dry(x, z);
      case 'crag': return (x, z) => (w.biomeAt(x, z).rock >= CRAG || forest(x, z) >= DEN_FOREST) && dry(x, z);
      case 'pasture': return (x, z) => (w.biomeAt(x, z).meadow >= MEADOW || edge(x, z)) && dry(x, z);
      case 'meadow': return (x, z) => w.biomeAt(x, z).meadow >= MEADOW && forest(x, z) < EDGE_FOREST[0] && dry(x, z);
    }
  }

  /** The kept spots of a kind in a home: sampled in the disc, else the nearest found by spiralling out, else plainer ground. */
  private candidates(home: HomeRange, g: Ground): Pt[] {
    const key = `${g}|${home.center.x},${home.center.z},${home.radius}`;
    let out = this.spots.get(key);
    if (out) return out;
    out = [];
    const rng = new Rng(parseInt(fnv1a(key), 16)), test = this.test(g), { center: c, radius } = home;
    for (let i = 0; i < SAMPLES && out.length < KEEP; i++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * radius;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (test(x, z)) out.push({ x, z });
    }
    if (out.length < FEW) {
      const found = out;
      spiral(c.x, c.z, SPIRAL_STEP, radius + SPIRAL_REACH, test, (x, z) => (found.push({ x, z }), found.length >= KEEP));
    }
    if (!out.length) {
      const plainer: Ground | null = g === 'deep' || g === 'shallows' ? 'swim' : g === 'swim' || g === 'dry' ? null : 'dry';
      out = plainer ? this.candidates(home, plainer) : [{ ...c }];
    }
    this.spots.set(key, out);
    return out;
  }

  /**
   * One spot of a kind (among `spots`, by default all its kept ones): among the few nearest `near` (or any, when not
   * `nearest`), at random, the first a walker can reach dry or a fish wet in a straight line from `near` (checked only
   * when `near` is in its own medium); `near` itself if none.
   */
  private pick(home: HomeRange, t: Traits, g: Ground, near: Pt, nearest: boolean, spots = this.candidates(home, g)): Pt {
    return this.tryPick(home, t, g, near, nearest, spots) ?? { x: near.x, z: near.z };
  }

  /** `pick`, or null when none of the spots can be walked (or swum) to. */
  private tryPick(home: HomeRange, t: Traits, g: Ground, near: Pt, nearest: boolean, spots: readonly Pt[]): Pt | null {
    const order = nearest ? [...spots].sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z)) : spots;
    const first = Math.floor(this.rng.next() * (nearest ? Math.min(NEAREST, order.length) : order.length));
    const walker = !t.swimmer && !t.floater && !(t.canFly && home.medium === 'air');
    const check = (walker || t.swimmer) && this.world.isWater(near.x, near.z) === t.swimmer;
    for (let i = 0; i < order.length; i++) {
      const p = order[(first + i) % order.length];
      if (!check || this.clear(near, p, t.swimmer)) return { x: p.x, z: p.z };
    }
    return null;
  }

  /** Whether the straight way from `a` to `b` stays wet (`wet`) or dry all along. */
  private clear(a: Pt, b: Pt, wet: boolean): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / PATH_STEP);
    for (let i = 1; i <= n; i++) if (this.world.isWater(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n) !== wet) return false;
    return true;
  }
}
