import { Frustum, Group, Matrix4, Sphere, Vector3, type Camera, type Object3D, type Scene } from 'three/webgpu';
import { individualVariation, type BodyData } from '../builder/build';
import type { BuilderClient } from '../builder/client';
import { CAST } from '../cast';
import type { GalleryItem, ValleyRecord } from '../lab/gallery';
import { ActionController, type Action, type Flight, type Habitat } from '../motion/actions';
import { CreatureRig } from '../motion/rig';
import type { Recipe } from '../recipe/schema';
import { createCreatureObject, type CreatureLook, type CreatureObject } from '../render/creature';
import { QUALITY, type Tier } from '../render/quality';
import { mulberry32 } from '../util/rng';
import type { HomeRange, Layout } from '../valley/types';
import type { Valley } from '../valley/valley';
import { elevationDeg, sunDirection } from '../world/clock';
import { avoid } from './avoid';
import { valleyHabitat } from './habitat';

/** The render layer the animals draw on (the camera and the two nearest shadow cascades enable it). */
export const CREATURE_LAYER = 6;

/** Top speed in the valley (m/s): the lab's stage is small, the valley lets them stretch their legs a little more. */
const SPEED_CAP = 8;
/** Update bands (m): every frame when near, every 4th frame farther out, paused beyond (or out of view). */
const FULL_RANGE = 120, QUARTER_RANGE = 300;
/**
 * Level of detail by distance (m): full detail, then the middle mesh, then the coarse one; fur only up close. The ranges
 * are for animals of 1 m and up; smaller ones (down to 0.4 of them) switch sooner, as they are smaller on screen.
 */
const LOD0_RANGE = 25, LOD1_RANGE = 70, FUR_RANGE = 40, SMALLEST = 0.4;
/** Seconds between choices of what to do: 20 to 40. */
const CHOOSE_MIN = 20, CHOOSE_SPAN = 20;
/** An animal out of view for this long (s) may drift to another spot in its home, about once every DRIFT_EVERY seconds. */
const DRIFT_AFTER = 60, DRIFT_EVERY = 20;
/** The sun's elevation (degrees) below which it is night, above which it is midday, and below which it is deep night. */
const NIGHT = -6, MIDDAY = 45, DEEP_NIGHT = -12;
/** The hawk circles high (28–45 m) and spends most of its wanders aloft, a long string of laps each time. */
const SOAR: Flight = { chance: 0.9, laps: [16, 32] }, SOAR_HEIGHT = [28, 45] as const;
/** Its laps go round circles (35–70 m across, 8 laps a turn), 1.5 to 3 turns before it drifts off to the next. */
const CIRCLE_R = [35, 70] as const, CIRCLE_STEPS = 8, CIRCLE_LAPS = [12, 24] as const;
/** Ducks paddle about the lake and only now and then waddle up the bank. */
const DUCK_WATER = 0.85;
/** Path checks every this many metres (for a dry walk, or a swim that stays in the water). */
const PATH_STEP = 2, PATH_TRIES = 6;
/**
 * A released family walks in briskly, at about ARRIVE_MS m/s (but at least ARRIVE_SPEED of its top speed, and at most all
 * of it: Ruling R6, so a slow one is in the picture within about 3 s too), to a spot within ARRIVE_NEAR of its home's
 * radius from the centre; it has arrived within ARRIVED m of the spot or anywhere that near the centre (a quick walker can
 * circle it). A flier comes in low (ARRIVE_LOW m up, where the release camera sees it) and climbs to its cruise on arrival.
 */
const ARRIVE_MS = 2.5, ARRIVE_SPEED = 0.5, ARRIVE_NEAR = 0.25, ARRIVED = 2, ARRIVE_LOW = 3;
/**
 * A family that walks on (arrival v2) comes in to the middle of the picture first: to this fraction of the way from the
 * home centre to its onward point; each leg is done within ON_ARRIVED m (loose, so a quick walker does not circle).
 */
const ON_START = 0.15, ON_ARRIVED = 4;
/** Off exploring: it walks (a little faster) to a point this far out from its home and is gone once out of view, or after LEAVE_TIME s. */
const LEAVE_DIST = 80, LEAVE_SPEED = 0.4, LEAVE_TIME = 20, LEAVE_GAP = 4, EDGE = 20;

export type Band = 'full' | 'quarter' | 'paused';
type Where = 'land' | 'water' | 'shore';
type Pt = { x: number; z: number };

/** A released creature with its saved home: its family lives in the valley. */
export type Family = GalleryItem & { valley: ValleyRecord & { home: HomeRange } };

/** One resident: its body, rig, actions and where it lives. */
export type Resident = {
  species: string;
  home: HomeRange;
  recipe: Recipe;
  obj: CreatureObject;
  rig: CreatureRig;
  actions: ActionController;
  /** The home-range habitat, before the resident's own path checks. */
  habitat: Habitat;
  rng: () => number;
  /** Where its spots are: land, water or shore. */
  where: Where;
  /** Roughly half its width (m), for passing trunks. */
  radius: number;
  band: Band;
  /** Seconds since it was last seen (paused), and until it next chooses what to do. */
  hidden: number;
  choose: number;
  wanted: Action;
  /** A side step round a trunk, and the target it is heading back to afterwards. */
  detour: { wp: Vector3; final: Vector3 } | null;
  /** Which of every 4 frames it updates on in the quarter band. */
  slot: number;
  /**
   * Where it is walking on its own (into a new home, or out of view to go exploring) before the actions take over; a flier
   * coming in low keeps its own cruising height here until it has arrived. `then` is where it walks on to once there
   * (arrival v2), and `onward` marks that second leg.
   */
  errand: { to: Pt; out: boolean; cruise?: number | null; then?: Pt; onward?: boolean } | null;
};

/**
 * What an animal wants to do at `hour`: day animals sleep once the sun is 6° below the horizon (night animals by day);
 * twilight animals are up at dawn and dusk but sleep half the time at midday and deep night. Otherwise it wanders,
 * now and then eats (10%) or calls (5%, never at night).
 */
export function wantedAction(recipe: Recipe, hour: number, rng: () => number): Action {
  const sun = elevationDeg(sunDirection(hour)), night = sun < NIGHT;
  const activity = recipe.mind.activity;
  if (activity === 'day' && night) return 'sleep';
  if (activity === 'night' && sun > -NIGHT) return 'sleep';
  if (activity === 'twilight' && (sun > MIDDAY || sun < DEEP_NIGHT) && rng() < 0.5) return 'sleep';
  const roll = rng();
  if (roll < 0.1) return 'eat';
  if (roll < 0.15 && !night) return 'call';
  return 'wander';
}

const BUSY = new Set<Action>(['eat', 'call', 'drink', 'flee']);
const frustum = new Frustum(), viewProj = new Matrix4(), sphere = new Sphere(), eye = new Vector3();

/**
 * The valley's animals, natives and released families: the lab's bodies, rigs and actions living in their home ranges. Near ones update every
 * frame, farther ones every 4th, and ones out of view are paused, hidden and now and then moved within their homes.
 */
export class Residents {
  readonly animals: Resident[] = [];
  /** Every animal's body hangs off this group. */
  readonly object = new Group();
  /** Counts since spawn: side steps round trunks, those that ended back on course, and pushes out of a trunk (the safety net). */
  readonly stats = { detours: 0, restored: 0, pushedOut: 0 };
  private frame = 0;
  /** Each species' materials (natives by recipe id, released ones by item id), made by its first animal. */
  private looks = new Map<string, CreatureLook>();
  /** Families walking out to go exploring: seconds since they set off, and the promise to keep once they are gone. */
  private leaving = new Map<string, { members: Resident[]; t: number; done: () => void; gone: Promise<void> }>();
  /** Families being added (built and compiled), so a second call for the same one waits for it rather than adding it twice. */
  private adding = new Map<string, Promise<void>>();
  /** Where the camera was at the last update (null before the first). */
  private seenFrom: Vector3 | null = null;

  constructor(
    private valley: Valley,
    private layout: Layout,
    private builder: Pick<BuilderClient, 'build'>,
    private tier: Tier,
    scene: Scene,
  ) {
    this.object.name = 'residents';
    scene.add(this.object);
  }

  /**
   * Build each species' body once (all at once, in the builder's worker) and place every animal in its home: the natives,
   * then a family of three for each creature in `released` that is released and has its home. A species whose body fails
   * to build is left out (and logged); the rest still come.
   */
  async spawn(released: GalleryItem[] = []): Promise<void> {
    const recipeOf = (id: string) => {
      const r = CAST.find((c) => c.recipe.id === id)?.recipe;
      if (!r) throw new Error(`no cast member called ${id}`);
      return r;
    };
    const species = [...new Set(this.layout.homes.map((h) => h.species))];
    const families = released.filter((i): i is Family => i.valley?.status === 'released' && !!i.valley.home);
    const keys = [...species, ...families.map((f) => f.id)];
    const recipes = [...species.map(recipeOf), ...families.map((f) => f.recipe)];
    const built = await Promise.allSettled(recipes.map((r) => this.builder.build(r)));
    const bodies = new Map<string, BodyData>();
    built.forEach((b, i) => {
      if (b.status === 'fulfilled') bodies.set(keys[i], b.value);
      else console.error(`the ${keys[i]} could not be built`, b.reason);
    });
    const counts = new Map<string, number>();
    for (const home of this.layout.homes) {
      if (!bodies.has(home.species)) continue;
      for (let k = 0; k < home.count; k++) {
        const n = counts.get(home.species) ?? 0; // individual number within the species (0 is the species' own look)
        counts.set(home.species, n + 1);
        const seed = (this.layout.seed ^ Math.imul(this.animals.length + 1, 0x9e3779b1)) >>> 0;
        this.place(this.make(home.species, home, recipeOf(home.species), bodies.get(home.species)!, n, seed));
      }
    }
    for (const f of families) {
      const body = bodies.get(f.id);
      if (body && !this.has(f.id)) this.family(f, body).forEach((a) => this.place(a));
    }
  }

  /**
   * Add one released family live: built, compiled by `opts.compile` (before anyone sees it), then into the valley. With
   * `entry` each member starts at its entry point and walks to its new home (then on to its `onward` point, if given, before
   * its normal life starts); without, they start at spots in the home.
   * Rejects (with nothing added) when the body cannot be built or the compile fails. A second call for a family still
   * being added gets the first call's promise (a double release adds it once).
   */
  addSpecies(item: Family, opts: { compile: (root: Object3D) => Promise<void>; entry?: Pt[]; onward?: Pt[] }): Promise<void> {
    const pending = this.adding.get(item.id);
    if (pending) return pending;
    const adding = this.arrive(item, opts).finally(() => this.adding.delete(item.id));
    this.adding.set(item.id, adding);
    return adding;
  }

  private async arrive(item: Family, opts: { compile: (root: Object3D) => Promise<void>; entry?: Pt[]; onward?: Pt[] }): Promise<void> {
    await this.leaving.get(item.id)?.gone; // coming back while still walking out: let it go first
    if (this.has(item.id)) return;
    const body = await this.builder.build(item.recipe);
    const family = this.family(item, body, opts.entry, opts.onward);
    const stage = new Group(); // out of the valley while compiling, with every level of detail and the fur drawable
    for (const a of family) {
      stage.add(a.obj.root);
      a.obj.root.traverse((o) => (o.visible = true));
    }
    try {
      await opts.compile(stage);
    } catch (e) {
      this.discard(family);
      throw e;
    }
    for (const a of family) {
      a.obj.setLod(a.obj.lod); // its meshes and shells as they were
      this.place(a);
    }
  }

  /**
   * Off exploring: the family walks 80 m out from its home, away from the camera (each straight out from the centre if
   * the camera is not known yet), and once all are out of view (or after 20 s) it is removed and disposed. Natives stay.
   */
  removeSpecies(id: string): Promise<void> {
    const adding = this.adding.get(id); // still arriving: let it arrive (or fail), then send it off
    if (adding) return adding.then(() => this.removeSpecies(id), () => {});
    const going = this.leaving.get(id);
    if (going) return going.gone;
    const members = this.layout.homes.some((h) => h.species === id) ? [] : this.familyOf(id);
    if (!members.length) return Promise.resolve();
    const c = members[0].home.center, half = this.valley.size / 2 - EDGE;
    members.forEach((a, k) => {
      const { rig } = a, from = this.seenFrom ?? { x: c.x - (rig.position.x - c.x), z: c.z - (rig.position.z - c.z) };
      let ux = c.x - from.x, uz = c.z - from.z;
      const d = Math.hypot(ux, uz);
      if (d > 1e-6) (ux /= d), (uz /= d);
      else (ux = 1), (uz = 0);
      const side = (k - (members.length - 1) / 2) * LEAVE_GAP; // side by side, not into one spot
      const x = c.x + ux * LEAVE_DIST - uz * side, z = c.z + uz * LEAVE_DIST + ux * side;
      a.actions.set('idle'); // the actions stand aside (keeping a flier in the air) while it walks
      rig.wantFly = rig.flying;
      const to = { x: Math.max(-half, Math.min(half, x)), z: Math.max(-half, Math.min(half, z)) };
      rig.moveTo({ x: to.x, y: 0, z: to.z });
      rig.setSpeed(LEAVE_SPEED);
      a.detour = null;
      a.errand = { to, out: true };
    });
    let done!: () => void;
    const gone = new Promise<void>((r) => (done = r));
    this.leaving.set(id, { members, t: 0, done, gone });
    return gone;
  }

  /** The members of a family (or of a native species) now in the valley. */
  familyOf(id: string): Resident[] {
    return this.animals.filter((a) => a.species === id);
  }

  private has(species: string) {
    return this.animals.some((a) => a.species === species);
  }

  /** A released family (not yet in the valley): looks 0, 1, 2, each from its own saved seed, so it is the same after a reload. */
  private family(item: Family, body: BodyData, entry?: Pt[], onward?: Pt[]): Resident[] {
    const { home, seeds } = item.valley;
    return seeds.map((seed, n) => this.make(item.id, home, item.recipe, body, n, seed, entry?.[n], onward?.[n]));
  }

  /** Into the valley: its body under the group, and among the animals that update. */
  private place(a: Resident) {
    a.slot = this.animals.length % 4;
    this.object.add(a.obj.root);
    this.animals.push(a);
  }

  /** Out of the valley and freed; the first of the species (which owns the shared materials) last. */
  private discard(members: Resident[]) {
    for (const a of [...members].reverse()) {
      const i = this.animals.indexOf(a);
      if (i >= 0) this.animals.splice(i, 1);
      a.obj.root.removeFromParent();
      a.obj.dispose();
      if (this.looks.get(a.species) === a.obj.look && !this.has(a.species)) this.looks.delete(a.species);
    }
  }

  /** One animal, ready for the valley but not in it: its body (sharing the species' materials), rig, actions and start. */
  private make(species: string, home: HomeRange, recipe: Recipe, body: BodyData, n: number, seed: number, entry?: Pt, onward?: Pt): Resident {
    const rng = mulberry32(seed);
    const bones = body.skeleton.bones;
    const look = this.looks.get(species);
    const obj = createCreatureObject(body, recipe, this.tier, individualVariation(recipe, n, bones.length, bones.map((b) => b.partId)), look);
    if (!look) this.looks.set(species, obj.look); // one set of materials (and so of shaders) per species
    obj.root.traverse((o) => o.layers.set(CREATURE_LAYER));
    obj.root.name = `${species}-${n}`;
    const rig = new CreatureRig(obj, body, recipe, this.valley, SPEED_CAP);
    const habitat = valleyHabitat(this.valley, home, rng);
    const where: Where = home.medium === 'air' ? 'land' : home.medium;
    const actions = new ActionController(rig, this.pathChecked(habitat, rig, home, rng), rng, {
      shore: home.medium === 'shore',
      flight: home.medium === 'air' ? SOAR : undefined,
    });
    const v = this.valley;
    const start = entry
      ? { x: entry.x, y: where === 'water' && v.isWater(entry.x, entry.z) ? v.waterLevelAt(entry.x, entry.z) : v.heightAt(entry.x, entry.z), z: entry.z }
      : habitat.randomSpot(where, 0.8);
    rig.position.set(start.x, start.y, start.z);
    rig.yaw = rng() * Math.PI * 2;
    if (rig.canFly && home.medium === 'air') {
      rig.cruise = SOAR_HEIGHT[0] + rng() * (SOAR_HEIGHT[1] - SOAR_HEIGHT[0]);
      rig.flying = true;
      rig.wantFly = true;
      rig.altitude = rig.cruise;
    }
    let errand: Resident['errand'] = null;
    if (entry) {
      // walking in: the actions stand aside (a flier stays up) until it reaches a spot near the middle of its home
      actions.set('idle');
      rig.wantFly = rig.flying;
      const c = home.center;
      const to = onward ? { x: c.x + (onward.x - c.x) * ON_START, y: 0, z: c.z + (onward.z - c.z) * ON_START } : habitat.randomSpot(where, ARRIVE_NEAR);
      rig.moveTo(to);
      rig.setSpeed(Math.min(1, Math.max(ARRIVE_SPEED, ARRIVE_MS / rig.topSpeed)));
      errand = { to: { x: to.x, z: to.z }, out: false };
      if (onward) errand.then = { x: onward.x, z: onward.z };
      if (rig.flying) {
        errand.cruise = rig.cruise;
        rig.cruise = Math.min(rig.cruise ?? ARRIVE_LOW, ARRIVE_LOW);
        rig.altitude = Math.min(rig.altitude, ARRIVE_LOW);
      }
    } else actions.set('wander');
    rig.update(0); // on its feet (or wings) before the first frame
    return {
      species, home, recipe, obj, rig, actions, habitat, rng, where,
      radius: Math.max(0.1, recipe.life.sizeM * 0.2) * obj.root.scale.x,
      band: 'full', hidden: 0, choose: rng() * CHOOSE_MIN, wanted: 'wander', detour: null, slot: 0, errand,
    };
  }

  /**
   * The home habitat, with spots the animal can reach in a straight line: dry all the way for walkers, wet all the way
   * for fish (fliers in the air go anywhere). Ducks pick spots on the water most of the time; the hawk circles.
   */
  private pathChecked(habitat: Habitat, rig: CreatureRig, home: HomeRange, rng: () => number): Habitat {
    const v = this.valley;
    const circle = { x: 0, z: 0, r: 0, a: 0, dir: 1, left: 0 };
    /** The next point on the hawk's circle, starting a new circle somewhere in its home when this one is done. */
    const soar = () => {
      if (circle.left <= 0) {
        const c = habitat.randomSpot('land', 0.7);
        Object.assign(circle, { x: c.x, z: c.z, r: CIRCLE_R[0] + rng() * (CIRCLE_R[1] - CIRCLE_R[0]), dir: rng() < 0.5 ? 1 : -1 });
        circle.a = Math.atan2(rig.position.z - c.z, rig.position.x - c.x);
        circle.left = CIRCLE_LAPS[0] + Math.floor(rng() * (CIRCLE_LAPS[1] - CIRCLE_LAPS[0]));
      }
      circle.a += (circle.dir * Math.PI * 2) / CIRCLE_STEPS;
      circle.left--;
      return habitat.clamp({ x: circle.x + Math.cos(circle.a) * circle.r, y: 0, z: circle.z + Math.sin(circle.a) * circle.r });
    };
    const clear = (to: { x: number; z: number }) => {
      if (rig.wantFly || (!rig.swimmer && home.medium !== 'land' && home.medium !== 'air')) return true;
      const from = rig.position, d = Math.hypot(to.x - from.x, to.z - from.z), n = Math.ceil(d / PATH_STEP);
      for (let i = 1; i <= n; i++) {
        const x = from.x + ((to.x - from.x) * i) / n, z = from.z + ((to.z - from.z) * i) / n;
        if (v.isWater(x, z) !== rig.swimmer) return false;
      }
      return true;
    };
    return {
      ...habitat,
      randomSpot(where, frac) {
        if (home.medium === 'air' && rig.wantFly) return soar();
        if (home.medium === 'water' && !rig.swimmer && where !== 'water') where = rng() < DUCK_WATER ? 'water' : 'shore';
        let p = habitat.randomSpot(where, frac);
        for (let i = 0; i < PATH_TRIES && !clear(p); i++) p = habitat.randomSpot(where, frac);
        return p;
      },
    };
  }

  /** Advance the animals by `dt` seconds of the valley's time at `hour` o'clock, seen from `camera`. */
  update(dt: number, camera: Camera, hour: number): void {
    this.frame++;
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    camera.getWorldPosition(eye);
    (this.seenFrom ??= new Vector3()).copy(eye);
    for (const a of this.animals) {
      const { rig, obj } = a, p = rig.position;
      const afloat = rig.inWater && (rig.swimmer || rig.floater);
      const water = afloat ? this.valley.waterLevelAt(p.x, p.z) : NaN; // NaN off the water's map (dry land): use the ground
      sphere.center.set(p.x, (water === water ? water : this.valley.heightAt(p.x, p.z) + rig.altitude) + a.recipe.life.sizeM * 0.3, p.z);
      sphere.radius = a.recipe.life.sizeM;
      const d = sphere.center.distanceTo(eye), seen = frustum.intersectsSphere(sphere);
      a.band = seen && d < FULL_RANGE ? 'full' : seen && d < QUARTER_RANGE ? 'quarter' : 'paused';
      if (a.band === 'paused') {
        obj.root.visible = false;
        if (a.errand) {
          this.step(a, dt, hour); // walking in from (or out to) out of view: it must not freeze there
          continue;
        }
        a.hidden += dt;
        if (a.hidden > DRIFT_AFTER && a.rng() < dt / DRIFT_EVERY) this.drift(a);
        continue;
      }
      obj.root.visible = true;
      a.hidden = 0;
      const k = Math.min(1, Math.max(SMALLEST, a.recipe.life.sizeM)), fur = d < FUR_RANGE * k;
      const lod = Math.max(QUALITY[this.tier].lod, d < LOD0_RANGE * k ? 0 : d < LOD1_RANGE * k ? 1 : 2) as 0 | 1 | 2;
      if (lod !== obj.lod) obj.setLod(lod);
      if (obj.furOn !== fur) obj.setFur(fur);
      if (a.band === 'quarter' && (this.frame + a.slot) % 4 !== 0) continue;
      this.step(a, a.band === 'full' ? dt : dt * 4, hour);
    }
    // families gone exploring leave once none of them is in view, or after 20 s
    for (const [id, l] of this.leaving) {
      l.t += dt;
      if (l.t < LEAVE_TIME && l.members.some((a) => a.band !== 'paused')) continue;
      this.leaving.delete(id);
      this.discard(l.members);
      l.done();
    }
  }

  /** One update of one animal: choose, act, steer round trunks, move, and keep to its own medium. */
  private step(a: Resident, dt: number, hour: number) {
    const { rig, actions } = a, valley = this.valley;
    if (a.errand) {
      // walking in (handed to the actions on arrival, or if it had to stop at the water) or out (back on its way if stopped)
      const { to, out, then, onward } = a.errand, p = rig.position, c = a.home.center;
      const there = then || onward ? Math.hypot(to.x - p.x, to.z - p.z) < ON_ARRIVED
        : Math.hypot(to.x - p.x, to.z - p.z) < ARRIVED || Math.hypot(c.x - p.x, c.z - p.z) < ARRIVE_NEAR * a.home.radius;
      if (!out && then && (!rig.target || there)) {
        // at its spot: on together into the valley (arrival v2), still low if it flies
        rig.moveTo({ x: then.x, y: 0, z: then.z });
        const { cruise } = a.errand;
        a.errand = { to: then, out: false, onward: true, ...(cruise !== undefined ? { cruise } : {}) };
      } else if (!out && (!rig.target || there)) {
        if (a.errand.cruise !== undefined) rig.cruise = a.errand.cruise; // up to its own height now it is home
        a.errand = null;
        actions.set('wander');
      } else if (out && !rig.target) rig.moveTo({ x: to.x, y: 0, z: to.z });
    }
    // what to do: re-chosen every 20–40 s; eating and calling are one-offs, then back to wandering
    if (!a.errand) a.choose -= dt;
    if (!a.errand && a.choose <= 0) {
      a.choose = CHOOSE_MIN + a.rng() * CHOOSE_SPAN;
      let want = wantedAction(a.recipe, hour, a.rng);
      if (a.home.medium === 'air' && want !== 'sleep') want = 'wander'; // the hawk hunts on the wing
      if (want === 'eat' || want === 'call') {
        if (!rig.flying) actions.set(want, eye); // a one-off, skipped in the air (it would bring a flier down)
        want = 'wander';
      }
      a.wanted = want;
    }
    if (!a.errand && !BUSY.has(actions.current) && actions.current !== a.wanted) {
      if (a.wanted === 'sleep' && rig.flying) {
        if (actions.current !== 'walk') actions.set('walk'); // come down somewhere dry first
      } else actions.set(a.wanted, eye);
    }

    // a side step round a trunk ends when the animal reaches (or passes) it, or when the actions choose a new target
    if (a.detour) {
      const { wp, final } = a.detour;
      if (rig.target !== wp) a.detour = null;
      else {
        const dx = wp.x - rig.position.x, dz = wp.z - rig.position.z;
        if (Math.hypot(dx, dz) < Math.max(0.5, a.radius) || dx * (final.x - rig.position.x) + dz * (final.z - rig.position.z) < 0) {
          rig.target = final;
          a.detour = null;
          this.stats.restored++;
        }
      }
    }
    actions.update(dt, eye);
    const onFoot = !rig.flying && !rig.swimmer && !(rig.inWater && rig.floater);
    // look ahead for trunks, on the way to the target or (mid side step) to the waypoint, which may be blocked too
    if (rig.target && onFoot) {
      const trunks = valley.trunksNear(rig.position.x, rig.position.z, 7);
      const wp = trunks.length ? avoid(rig.position, rig.target, trunks, a.radius) : null;
      if (wp) {
        const final = a.detour?.final ?? rig.target;
        rig.moveTo({ x: wp.x, y: 0, z: wp.z });
        a.detour = { wp: rig.target!, final };
        this.stats.detours++;
      }
    }

    const px = rig.position.x, pz = rig.position.z;
    rig.update(dt);
    // keep to its own medium: walkers never wade in, fish never beach
    const { x, z } = rig.position;
    const walker = !rig.swimmer && !rig.floater && !rig.flying;
    if ((walker && valley.isWater(x, z)) || (rig.swimmer && !valley.isWater(x, z))) {
      if (valley.isWater(px, pz) === rig.swimmer) rig.position.set(px, rig.position.y, pz);
      else if (walker) {
        const bank = a.habitat.nearestBank(rig.position); // came down over the water: out onto the bank
        if (bank) rig.position.set(bank.x, bank.y, bank.z);
      }
      rig.moveTo(null); // the actions pick somewhere else to go
      a.detour = null;
    }
    // and never inside a trunk
    if (!rig.flying) {
      for (const t of valley.trunksNear(rig.position.x, rig.position.z, a.radius)) {
        const dx = rig.position.x - t.x, dz = rig.position.z - t.z, d = Math.hypot(dx, dz) || 1e-6, min = t.r + a.radius * 0.5;
        if (d >= min) continue;
        rig.position.set(t.x + (dx / d) * min, rig.position.y, t.z + (dz / d) * min);
        this.stats.pushedOut++;
      }
    }
  }

  /** Out of view for a while: wake up somewhere else in the home, so the valley never looks frozen. */
  private drift(a: Resident) {
    const { rig } = a;
    const where = a.home.medium === 'water' ? 'water' : a.where;
    const p = a.habitat.randomSpot(where, 1);
    rig.position.set(p.x, p.y, p.z);
    rig.yaw = a.rng() * Math.PI * 2;
    rig.speed = 0;
    rig.moveTo(null);
    rig.legs.forEach((l) => (l.planted = null));
    a.detour = null;
    a.hidden = 0;
    a.actions.set(a.wanted === 'sleep' ? 'sleep' : 'wander');
    rig.update(0); // the body moves with it, so it is where it says it is when it comes back into view
  }

  /**
   * Start `fn` (a compile that gathers what it compiles before it returns, as `compileTogether` does) with one animal of
   * each species drawable at every level of detail with its fur, and the rest hidden: a species shares its materials, so
   * that covers them all and nothing compiles mid-flight later. The animals are back as they were when this returns.
   */
  compile<T>(fn: () => T): T {
    const firsts = new Set(this.animals.filter((a, i) => this.animals.findIndex((b) => b.species === a.species) === i)); // natives and released
    for (const a of this.animals) {
      a.obj.root.visible = firsts.has(a);
      if (firsts.has(a)) a.obj.root.traverse((o) => (o.visible = true));
    }
    try {
      return fn();
    } finally {
      for (const a of this.animals) {
        a.obj.root.visible = a.band !== 'paused';
        a.obj.setLod(a.obj.lod); // and its meshes and shells as they were
      }
    }
  }

  /**
   * Draw one frame (`render`) with one animal of each species, at every level of detail with its fur, in a row a few metres in
   * front of `camera`, inside the nearest shadow cascade: three's `compileAsync` (r186) skips the shadow passes, so otherwise each
   * species' shadow pipelines compile the first time it comes near, stalling that frame (90–430 ms measured on D3D12). The
   * animals are back where they were when this returns.
   */
  warmShadows(camera: Camera, render: () => void): void {
    const saved = this.animals.map((a) => a.obj.root.position.clone());
    const ahead = camera.getWorldDirection(new Vector3()), side = new Vector3(-ahead.z, 0, ahead.x); // across the screen
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); // looking straight down
    side.normalize();
    camera.getWorldPosition(eye);
    this.compile(() => {
      let i = 0;
      for (const a of this.animals) {
        if (!a.obj.root.visible) continue; // `compile` shows one of each species
        a.obj.root.position.copy(eye).addScaledVector(ahead, 12).addScaledVector(side, (i++ - 4) * 1.5);
      }
      try {
        render();
      } finally {
        this.animals.forEach((a, k) => a.obj.root.position.copy(saved[k]));
      }
    });
  }

  /** Each animal as plain data (for the dev hooks): species, position, action and update band. */
  info() {
    return this.animals.map((a) => ({
      species: a.species,
      position: { x: a.rig.position.x, y: a.obj.root.position.y, z: a.rig.position.z },
      action: a.actions.current,
      band: a.band,
      lod: a.obj.lod,
      flying: a.rig.flying,
    }));
  }

  dispose(): void {
    this.animals.forEach((a) => a.obj.dispose()); // the first of each species owns (and disposes) the species' materials
    this.animals.length = 0;
    this.looks.clear();
    this.leaving.forEach((l) => l.done()); // nobody waits for a family that has gone with the rest
    this.leaving.clear();
    this.object.removeFromParent();
  }
}
