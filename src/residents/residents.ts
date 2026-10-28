import { Frustum, Group, Matrix4, Sphere, Vector3, type Camera, type Object3D, type Scene } from 'three/webgpu';
import { individualVariation, type BodyData } from '../builder/build';
import type { BuilderClient } from '../builder/client';
import { CAST } from '../cast';
import type { GalleryItem, ValleyRecord } from '../lab/gallery';
import { CreatureRig, type DrivenPose } from '../motion/rig';
import type { Recipe } from '../recipe/schema';
import { createCreatureObject, type CreatureLook, type CreatureObject } from '../render/creature';
import { QUALITY, type Tier } from '../render/quality';
import { Sim } from '../sim/sim';
import type { Agent, Doing, Needs, Pt, SimState, SpeciesDef } from '../sim/types';
import { mulberry32 } from '../util/rng';
import type { Vec3 } from '../util/vec';
import type { HomeRange, Layout } from '../valley/types';
import type { Valley } from '../valley/valley';

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
/** At most this much animal time (s) goes to the simulation in one frame (Ruling R7): a long hidden-tab frame is let go. */
const MAX_STEP = 2;
/**
 * A rig steps in up to SUBSTEPS steps a frame, so feet stay planted when fast: one step for each STRIDE_STEP m the animal
 * travels (walking pace for 1/15 s), and at least one per RIG_STEP s for one standing about (its springs keep themselves
 * steady at any step); FAR_STRIDE times as far per step beyond full detail's range.
 */
const STRIDE_STEP = 2 / 15, RIG_STEP = 0.3, SUBSTEPS = 4, FAR_STRIDE = 2;
/** A point the simulation asks about is seen if a sphere this big (m), a metre above the ground there, is in the picture. */
const POINT_R = 2;
/** Seconds between glances (2 to 5); the share at the camera, and of the rest the share somewhere about, 5 to 20 m off. */
const GLANCE_MIN = 2, GLANCE_SPAN = 3, AT_CAMERA = 0.4, LOOK_ABOUT = 0.5, ABOUT_NEAR = 5, ABOUT_SPAN = 15;
/** What a released creature is called when its kid card has no name (as the release's welcome says). */
const NO_NAME = 'A new friend';

export type Band = 'full' | 'quarter' | 'paused';

/** A released creature with its saved home: its family lives in the valley. */
export type Family = GalleryItem & { valley: ValleyRecord & { home: HomeRange } };

/** A released creature's name in the valley: its kid card's. */
export const familyName = (item: GalleryItem) => item.cards?.name || NO_NAME;

/**
 * Now and then an animal glances about, often at whoever is watching (its ears prick up for them): cosmetic only, the
 * simulation never knows.
 */
export class Glance {
  look: Vec3 | null = null;
  atCamera = false;
  private timer = 0;

  constructor(private rng: () => number) {}

  /** `dt` real seconds on, for an animal at `at` watched from `eye`; `ground` gives the ground's height for a look about. */
  update(dt: number, at: Pt, eye: Vec3, ground: (x: number, z: number) => number): void {
    this.timer -= dt;
    if (this.timer >= 0) return;
    const r = this.rng;
    this.timer = GLANCE_MIN + r() * GLANCE_SPAN;
    this.atCamera = r() < AT_CAMERA;
    if (this.atCamera) this.look = { x: eye.x, y: eye.y, z: eye.z };
    else if (r() < LOOK_ABOUT) {
      const a = r() * Math.PI * 2, d = ABOUT_NEAR + r() * ABOUT_SPAN, x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d;
      this.look = { x, y: ground(x, z), z };
    } else this.look = null;
  }
}

/** One resident: the body and rig showing one animal of the simulation (`id`), and where it lives. */
export type Resident = { id: string; species: string; home: HomeRange; recipe: Recipe; obj: CreatureObject; rig: CreatureRig;
  band: Band;
  /** Which of every 4 frames it updates on in the quarter band. */
  slot: number;
  glance: Glance };

/** A species as the residents know it: its body (from the builder), recipe, and its homes in the simulation's order. */
type Kind = { body: BodyData; recipe: Recipe; homes: HomeRange[] };
/** A body and rig made for an animal, not yet in the valley. */
type Made = { obj: CreatureObject; rig: CreatureRig };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The motion `t` of the way from `a` to `b` (the heading by the short way round), written into `out`. */
function between(a: DrivenPose, b: DrivenPose, t: number, out: DrivenPose): DrivenPose {
  out.x = lerp(a.x, b.x, t);
  out.z = lerp(a.z, b.z, t);
  out.yaw = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * t;
  out.speed = lerp(a.speed, b.speed, t);
  out.turnRate = lerp(a.turnRate, b.turnRate, t);
  out.altitude = lerp(a.altitude, b.altitude, t);
  out.flying = b.flying;
  return out;
}
const newPose = (): DrivenPose => ({ x: 0, z: 0, yaw: 0, speed: 0, turnRate: 0, altitude: 0, flying: false });

const frustum = new Frustum(), viewProj = new Matrix4(), sphere = new Sphere(), eye = new Vector3();
/** Where the last banded animal's body stands (on the ground, the water, or in the air at its height). */
const standing = new Vector3();
const shown = newPose(), from = newPose(), sub = newPose();

/**
 * The valley's animals, natives and released families, as the simulation (`sim`) lives their lives: the lab's bodies and
 * rigs showing where each is and what it is doing. Near ones update every frame, farther ones every 4th, and ones out of
 * view are hidden (the simulation runs for everyone).
 */
export class Residents {
  readonly animals: Resident[] = [];
  /** Every animal's body hangs off this group. */
  readonly object = new Group();
  /** The animals' lives (made in `spawn`). */
  sim!: Sim;
  private frame = 0;
  private byId = new Map<string, Resident>();
  /** Each species (natives by recipe id, released ones by item id) the residents can make a body for. */
  private kinds = new Map<string, Kind>();
  /** Each species' materials now (made by the first of it), and for each set of materials who made (and frees) it and how many wear it. */
  private looks = new Map<string, CreatureLook>();
  private wearers = new Map<CreatureLook, { owner: CreatureObject; n: number }>();
  /** The native species, and the released families in the valley (not gone exploring): newcomers may come for them. */
  private natives = new Set<string>();
  private families = new Set<string>();
  /** Animals walking in with an onward leg to come (arrival v2). */
  private onward = new Set<string>();
  /** Families walking out to go exploring: who is still in the valley, and the promise to keep once they are all gone. */
  private leavers = new Map<string, { ids: Set<string>; done: () => void; gone: Promise<void> }>();
  /** Families being added (built and compiled), so a second call for the same one waits for it rather than adding it twice. */
  private adding = new Map<string, Promise<void>>();
  /** The camera as the simulation sees it: where it is, which animals it sees (by the last bands) and whether it sees a point. */
  private view = {
    eye: { x: 0, z: 0 },
    seen: (id: string) => (this.byId.get(id)?.band ?? 'paused') !== 'paused',
    seenAt: (p: Pt) => this.sees(p),
  };

  constructor(
    private valley: Valley,
    private layout: Layout,
    private homes: HomeRange[],
    private builder: Pick<BuilderClient, 'build'>,
    private tier: Tier,
    scene: Scene,
  ) {
    this.object.name = 'residents';
    scene.add(this.object);
  }

  /**
   * Build each species' body once (all at once, in the builder's worker), start the simulation with the natives and a
   * family for each creature in `released` that is released and has its home (carrying on from `state` if given), and
   * make a body for every animal. A species whose body fails to build is left out (and logged); the rest still come.
   */
  async spawn(released: GalleryItem[] = [], state?: SimState): Promise<void> {
    const recipeOf = (id: string) => {
      const r = CAST.find((c) => c.recipe.id === id)?.recipe;
      if (!r) throw new Error(`no cast member called ${id}`);
      return r;
    };
    const species = [...new Set(this.homes.map((h) => h.species))];
    const families = familiesOf(released);
    const keys = [...species, ...families.map((f) => f.id)];
    const recipes = [...species.map(recipeOf), ...families.map((f) => f.recipe)];
    const built = await Promise.allSettled(recipes.map((r) => this.builder.build(r)));
    const bodies = new Map<string, BodyData>();
    built.forEach((b, i) => {
      if (b.status === 'fulfilled') bodies.set(keys[i], b.value);
      else console.error(`the ${keys[i]} could not be built`, b.reason);
    });
    const defs: SpeciesDef[] = [];
    for (const id of species) {
      const body = bodies.get(id);
      if (!body) continue;
      const homes = this.homes.filter((h) => h.species === id);
      this.kinds.set(id, { body, recipe: recipeOf(id), homes });
      this.natives.add(id);
      for (const home of homes) defs.push(nativeDef(home));
    }
    for (const f of families) {
      const body = bodies.get(f.id);
      if (!body) continue;
      this.kinds.set(f.id, { body, recipe: f.recipe, homes: [f.valley.home] });
      this.families.add(f.id);
      defs.push(familyDef(f));
    }
    this.sim = new Sim(this.valley, { seed: this.layout.seed, species: defs, state });
    this.sim.drain();
    for (const g of this.sim.agents) this.join(g);
  }

  /**
   * Add one released family live: built, compiled by `opts.compile` (before anyone sees it), then into the simulation and
   * the valley. With `entry` each member starts at its entry point and walks to its new home (then on to its `onward`
   * point, if given, before its life starts); without, they start at spots in the home.
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
    await this.leavers.get(item.id)?.gone; // coming back while still walking out: let it go first
    if (this.families.has(item.id) || this.natives.has(item.id)) return;
    const kind: Kind = { body: await this.builder.build(item.recipe), recipe: item.recipe, homes: [item.valley.home] };
    const first = this.body(kind, item.id, 0, null);
    const made = [first, ...item.valley.seeds.slice(1).map((_, k) => this.body(kind, item.id, k + 1, first.obj.look))];
    const stage = new Group(); // out of the valley while compiling, with every level of detail and the fur drawable
    for (const m of made) {
      stage.add(m.obj.root);
      m.obj.root.traverse((o) => (o.visible = true));
    }
    try {
      await opts.compile(stage);
    } catch (e) {
      this.discard(made);
      throw e;
    }
    for (const m of made) {
      m.obj.root.removeFromParent();
      m.obj.setLod(m.obj.lod); // its meshes and shells as they were
    }
    this.kinds.set(item.id, kind);
    this.families.add(item.id);
    const members = this.sim.addSpecies(familyDef(item), { entry: opts.entry, onward: opts.onward });
    members.forEach((g, k) => {
      if (opts.onward?.[k]) this.onward.add(g.id);
      this.join(g, made[k]);
    });
    this.discard(made.slice(members.length));
  }

  /**
   * Off exploring: the family walks out of the valley away from the camera (the simulation's leaving), and once all of it
   * has gone (out of view, or after 20 s) its bodies are disposed; no newcomers come for it. Natives stay.
   */
  removeSpecies(id: string): Promise<void> {
    const adding = this.adding.get(id); // still arriving: let it arrive (or fail), then send it off
    if (adding) return adding.then(() => this.removeSpecies(id), () => {});
    const going = this.leavers.get(id);
    if (going) return going.gone;
    if (!this.families.has(id)) return Promise.resolve(); // a native, or not in the valley
    this.families.delete(id);
    const members = this.familyOf(id);
    this.sim.removeSpecies(id);
    if (!members.length) {
      // all caught, its newcomers not come: nobody wears its materials now
      const look = this.looks.get(id);
      if (look) this.tidy(id, look);
      return Promise.resolve();
    }
    let done!: () => void;
    const gone = new Promise<void>((r) => (done = r));
    this.leavers.set(id, { ids: new Set(members.map((a) => a.id)), done, gone });
    return gone;
  }

  /** The members of a family (or of a native species) now in the valley. */
  familyOf(id: string): Resident[] {
    return this.animals.filter((a) => a.species === id);
  }

  /** The animal with simulation id `id`, if it is in the valley. */
  animal(id: string): Resident | undefined {
    return this.byId.get(id);
  }

  /** 'in' walking to its spot, 'onward' on its second leg, null living its life. */
  arriving(a: Resident): 'in' | 'onward' | null {
    const g = this.sim.get(a.id);
    if (g?.doing !== 'arrive') return null;
    return g.route.length || !this.onward.has(a.id) ? 'in' : 'onward';
  }

  /** Walking out of the valley (off exploring). */
  leaving(a: Resident): boolean {
    return this.sim.get(a.id)?.doing === 'leave';
  }

  /**
   * An animal's body and rig, wearing `look` (by default its species' materials; with none, it makes them and is their
   * owner), not yet in the valley.
   */
  private body(kind: Kind, species: string, n: number, look: CreatureLook | null | undefined = this.looks.get(species)): Made {
    const { body, recipe } = kind, bones = body.skeleton.bones;
    const obj = createCreatureObject(body, recipe, this.tier, individualVariation(recipe, n, bones.length, bones.map((b) => b.partId)), look ?? undefined);
    if (!look) this.wearers.set(obj.look, { owner: obj, n: 0 });
    obj.root.traverse((o) => o.layers.set(CREATURE_LAYER));
    obj.root.name = `${species}-${n}`;
    return { obj, rig: new CreatureRig(obj, body, recipe, this.valley, SPEED_CAP) };
  }

  /** Simulated animal `g` comes into the valley in `made` (by default a new body), hidden until the next update bands it. */
  private join(g: Agent, made?: Made): void {
    const kind = this.kinds.get(g.species);
    if (!kind) return;
    const { obj, rig } = made ?? this.body(kind, g.species, g.n);
    const was = this.looks.get(g.species);
    this.looks.set(g.species, obj.look);
    if (was && was !== obj.look) this.tidy(g.species, was); // a family back with new materials: the old ones may go
    this.wearers.get(obj.look)!.n++;
    const a: Resident = {
      id: g.id, species: g.species, home: kind.homes[g.home] ?? kind.homes[0], recipe: kind.recipe, obj, rig,
      band: 'paused', slot: this.animals.length % 4, glance: new Glance(mulberry32(g.seed)),
    };
    obj.root.visible = false;
    this.object.add(obj.root);
    this.animals.push(a);
    this.byId.set(a.id, a);
    rig.drive(g.motion);
    this.intents(a, g, 0);
    rig.update(0); // on its feet (or wings) where the simulation put it
  }

  /** Out of the valley: its body freed, but the materials its species wears stay with their owner until nobody needs them. */
  private drop(a: Resident): void {
    this.animals.splice(this.animals.indexOf(a), 1);
    this.byId.delete(a.id);
    this.onward.delete(a.id);
    a.obj.root.removeFromParent();
    const w = this.wearers.get(a.obj.look)!;
    w.n--;
    if (w.owner !== a.obj) a.obj.dispose();
    this.tidy(a.species, a.obj.look);
    const going = this.leavers.get(a.species);
    if (going?.ids.delete(a.id) && !going.ids.size) {
      this.leavers.delete(a.species);
      going.done();
    }
  }

  /**
   * Frees a set of materials (with the body that made them, the last of its wearers) once nobody wears it and its species
   * will not again: gone from the valley, or wearing new ones.
   */
  private tidy(species: string, look: CreatureLook): void {
    const w = this.wearers.get(look);
    if (!w || w.n > 0) return;
    const current = this.looks.get(species) === look;
    if (current && (this.natives.has(species) || this.families.has(species))) return; // newcomers will wear them
    w.owner.dispose();
    this.wearers.delete(look);
    if (current) {
      this.looks.delete(species);
      this.kinds.delete(species);
    }
  }

  /** Bodies that never came into the valley, freed: the one that made the materials last. */
  private discard(made: Made[]): void {
    for (const { obj } of [...made].reverse()) {
      obj.dispose();
      if (this.wearers.get(obj.look)?.owner === obj) this.wearers.delete(obj.look);
    }
  }

  /**
   * `dtAnimal` animal seconds on (at most 2 go to the simulation) and `dtReal` real ones (the glances), the valley clock
   * at `hours`, seen from `camera`: the simulation steps, animals come and go with it, and each animal in view shows its
   * motion, smoothed between the simulation's ticks, and its pose. With no animal time (paused) no rig moves.
   */
  update(dtAnimal: number, dtReal: number, camera: Camera, hours: number): void {
    if (!this.sim) return;
    this.frame++;
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    camera.getWorldPosition(eye);
    this.view.eye.x = eye.x;
    this.view.eye.z = eye.z;
    this.sim.setView(this.view);
    const dt = Math.min(Math.max(0, dtAnimal), MAX_STEP);
    this.sim.step(dt, hours);
    this.comings();
    const alpha = this.sim.alpha;
    for (const a of this.animals) {
      const g = this.sim.get(a.id), prev = this.sim.prev(a.id);
      if (!g || !prev) continue;
      const { rig, obj } = a, p = between(prev, g.motion, alpha, shown), was = a.band;
      const d = this.band(a, p);
      if (a.band === 'paused') {
        obj.root.visible = false;
        this.stow(a, true);
        rig.drive(p); // where it is, for whoever asks (Visit), without the cost of a pose
        obj.root.position.copy(standing); // and its body with it, for whoever follows it (Fly there); detached, so no matrices
        continue;
      }
      this.stow(a, false);
      const back = was === 'paused'; // back in view: its body is where it was last seen
      if (back) rig.legs.forEach((l) => (l.planted = null));
      obj.root.visible = !this.hidden(g);
      const k = Math.min(1, Math.max(SMALLEST, a.recipe.life.sizeM)), fur = d < FUR_RANGE * k;
      const lod = Math.max(QUALITY[this.tier].lod, d < LOD0_RANGE * k ? 0 : d < LOD1_RANGE * k ? 1 : 2) as 0 | 1 | 2;
      if (lod !== obj.lod) obj.setLod(lod);
      if (obj.furOn !== fur) obj.setFur(fur);
      if (!obj.root.visible || (!back && (dt === 0 || (a.band === 'quarter' && (this.frame + a.slot) % 4 !== 0)))) {
        rig.drive(p);
        continue;
      }
      const every = a.band === 'full' ? 1 : 4; // frames between its updates
      this.intents(a, g, dt === 0 ? 0 : dtReal * every);
      const step = dt * every;
      const travel = (Math.max(p.speed, rig.speed) + Math.abs(p.turnRate) * a.recipe.life.sizeM * 0.5) * step;
      const stride = d < LOD0_RANGE * k ? STRIDE_STEP : STRIDE_STEP * FAR_STRIDE; // farther off, a foot's slip is too small to see
      const n = back || a.band === 'quarter' ? 1 : Math.min(SUBSTEPS, Math.max(1, Math.ceil(step / RIG_STEP - 1e-9), Math.ceil(travel / stride - 1e-9)));
      Object.assign(from, { x: rig.position.x, z: rig.position.z, yaw: rig.yaw, speed: rig.speed, turnRate: rig.turnRate, altitude: rig.altitude, flying: rig.flying });
      for (let i = 1; i <= n; i++) {
        rig.drive(i === n ? p : between(from, p, i / n, sub), back); // back in view: no climb from where it was last shown
        rig.update(step / n);
      }
      // going back to the earth: down into the ground
      if (g.sink > 0) obj.root.position.y -= g.sink * (rig.restHeight + a.recipe.life.sizeM * 0.3);
    }
  }

  /** The animals the simulation added and removed this step: a body for each newcomer (out of view), the gone ones freed. */
  private comings(): void {
    const events = this.sim.drain();
    const removed = new Set(events.filter((e) => e.type === 'removed').map((e) => e.id));
    for (const e of events) {
      if (e.type === 'removed') {
        const a = this.byId.get(e.id);
        if (a) this.drop(a);
      } else if (!removed.has(e.id) && !this.byId.has(e.id)) {
        const g = this.sim.get(e.id);
        if (g) this.join(g);
      }
    }
  }

  /** Sets `a.band` for an animal showing motion `p` (and `standing`, where its body stands), and returns how far it is from the camera (m). */
  private band(a: Resident, p: DrivenPose): number {
    const v = this.valley, size = a.recipe.life.sizeM;
    const afloat = !p.flying && (a.rig.swimmer || a.rig.floater) && v.isWater(p.x, p.z);
    standing.set(p.x, afloat ? v.waterLevelAt(p.x, p.z) : v.heightAt(p.x, p.z) + p.altitude, p.z);
    sphere.center.set(p.x, standing.y + size * 0.3, p.z);
    sphere.radius = size;
    const d = sphere.center.distanceTo(eye), seen = frustum.intersectsSphere(sphere);
    a.band = seen && d < FULL_RANGE ? 'full' : seen && d < QUARTER_RANGE ? 'quarter' : 'paused';
    return d;
  }

  /** Whether the camera of the last update sees point `p` (within the bands' reach): where a newcomer must not appear. */
  private sees(p: Pt): boolean {
    const v = this.valley, wet = v.isWater(p.x, p.z);
    sphere.center.set(p.x, (wet ? v.waterLevelAt(p.x, p.z) : v.heightAt(p.x, p.z)) + 1, p.z);
    sphere.radius = POINT_R;
    return sphere.center.distanceTo(eye) < QUARTER_RANGE && frustum.intersectsSphere(sphere);
  }

  /**
   * Out of view (`on`), an animal's body is taken out of the scene: three works out the matrices of every part of every
   * body in the scene each frame, drawn or not (about 1700 parts for the cast, half a millisecond); back in view, it is put
   * back in, its matrices worked out at once.
   */
  private stow(a: Resident, on: boolean): void {
    const root = a.obj.root, stowed = root.parent !== this.object;
    if (on === stowed) return;
    if (on) root.removeFromParent();
    else {
      this.object.add(root);
      root.updateMatrixWorld(true);
    }
  }

  /** Hiding under the water (Ruling P3): not drawn; the simulation keeps it still there. */
  private hidden(g: Agent): boolean {
    return g.doing === 'hide' && this.valley.isWater(g.motion.x, g.motion.z);
  }

  /** The animal's pose into its rig's intents, with a glance about (`dt` real seconds on) when it is awake and looking at nothing. */
  private intents(a: Resident, g: Agent, dt: number): void {
    const { rig, glance } = a, p = g.pose, idle = p.sleep === 0 && !p.look;
    if (idle) glance.update(dt, g.motion, eye, (x, z) => this.valley.heightAt(x, z));
    rig.headDown = p.headDown;
    rig.sleep = p.sleep;
    rig.calling = p.calling;
    rig.mouth = p.mouth;
    rig.look = p.look ?? (idle ? glance.look : null);
    rig.ears = p.ears === 'rest' && idle && glance.atCamera ? 'alert' : p.ears;
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
      if (!firsts.has(a)) continue;
      this.stow(a, false);
      a.obj.root.traverse((o) => (o.visible = true));
    }
    try {
      return fn();
    } finally {
      for (const a of this.animals) {
        const g = this.sim.get(a.id);
        a.obj.root.visible = a.band !== 'paused' && !(g && this.hidden(g));
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
    const at = camera.getWorldPosition(new Vector3());
    this.compile(() => {
      let i = 0;
      for (const a of this.animals) {
        if (!a.obj.root.visible) continue; // `compile` shows one of each species
        a.obj.root.position.copy(at).addScaledVector(ahead, 12).addScaledVector(side, (i++ - 4) * 1.5);
      }
      try {
        render();
      } finally {
        this.animals.forEach((a, k) => a.obj.root.position.copy(saved[k]));
      }
    });
  }

  /** Each animal as plain data (for the dev hooks): who, where, what it is doing, its update band and detail, and its needs. */
  info(): { id: string; species: string; position: Vec3; doing: Doing; band: Band; lod: 0 | 1 | 2; flying: boolean; needs: Needs }[] {
    return this.animals.map((a) => {
      const g = this.sim.get(a.id)!;
      return {
        id: a.id, species: a.species, position: { x: g.motion.x, y: a.obj.root.position.y, z: g.motion.z }, doing: g.doing,
        band: a.band, lod: a.obj.lod, flying: g.motion.flying, needs: { ...g.needs },
      };
    });
  }

  /**
   * No animals at all, as before `spawn` (their bodies and materials freed): after a spawn that failed part-way, so the
   * next spawn does not leave a second set of bodies.
   */
  clear(): void {
    for (const a of this.animals) {
      a.obj.root.removeFromParent();
      if (this.wearers.get(a.obj.look)?.owner !== a.obj) a.obj.dispose();
    }
    this.wearers.forEach((w) => w.owner.dispose()); // each set of materials with the body that made it, last
    this.wearers.clear();
    this.animals.length = 0;
    this.byId.clear();
    this.looks.clear();
    this.kinds.clear();
    this.natives.clear();
    this.families.clear();
    this.onward.clear();
  }

  dispose(): void {
    this.clear();
    this.leavers.forEach((l) => l.done()); // nobody waits for a family that has gone with the rest
    this.leavers.clear();
    this.object.removeFromParent();
  }
}

/** The released creatures that live in the valley (released, with a home), each once. */
export const familiesOf = (released: GalleryItem[]): Family[] =>
  released.filter((i, k): i is Family => i.valley?.status === 'released' && !!i.valley.home && released.findIndex((j) => j.id === i.id) === k);

/** A native species' family at one of its homes as the simulation takes it: named by its kid card. */
export function nativeDef(home: HomeRange): SpeciesDef {
  const c = CAST.find((m) => m.recipe.id === home.species);
  if (!c) throw new Error(`no cast member called ${home.species}`);
  return { id: home.species, name: c.cards.name, recipe: c.recipe, home, target: home.count, released: false };
}

/** Every species the valley holds: a def for each native home, then each released family (the list a saved valley loads into). */
export const speciesDefs = (homes: HomeRange[], released: GalleryItem[]): SpeciesDef[] => [...homes.map(nativeDef), ...familiesOf(released).map(familyDef)];

/** A released family as the simulation takes it: named by its kid card, three animals from its own saved seeds. */
function familyDef(item: Family): SpeciesDef {
  const { home, seeds } = item.valley;
  return { id: item.id, name: familyName(item), recipe: item.recipe, home, target: seeds.length, released: true, seeds };
}
