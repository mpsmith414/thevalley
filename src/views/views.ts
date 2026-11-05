/**
 * The views: the one small state machine that has the camera while you watch an animal. In free flight it lets the
 * free-fly camera be; locked on, it glides to the animal and rides along in Follow, Close or Eyes, switching between them
 * with an eased move, widening for a chase, letting go when the animal goes, and handing the camera back when the player
 * moves off. `main.ts`'s drive hands it each frame; the Director and the dev hooks drive it through its methods.
 */
import { surfaceAt, type FlyWorld } from '../camera/freefly';
import { Glide, viewpointPose } from '../camera/viewpoints';
import type { Doing } from '../sim/types';
import { dist, type Vec3 } from '../util/vec';
import type { Viewpoint } from '../valley/types';
import { neighbours, stepNeighbour, type Candidate } from './aim';
import { ViewBlend } from './blend';
import { CLOSE_LOOK, CloseCam } from './close';
import { EYES_LOOK, EyesCam } from './eyes';
import { FOLLOW_CLEAR, FOLLOW_EASE_BACK_S, FollowCam, followFraming, type FollowOpts } from './follow';
import { Dive, RISE_S, between } from './map';
import { nextSense } from './senses';
import type { AnimalPose, Pose, SenseName } from './types';

/** The three ways of watching a locked animal: from behind (Follow), riding at its shoulder (Close), through its eyes (Eyes). */
export type ViewName = 'follow' | 'close' | 'eyes';
/**
 * Who has the camera: free flight, the glide to an animal, riding along, steering it, the map, or the dive down from the
 * map to a spot (then free flight).
 */
export type Mode = 'free' | 'gliding' | 'locked' | 'reins' | 'map' | 'diving';

/**
 * The animal the views ride, as the valley sees it this frame: its pose (see AnimalPose), its eye point and the way its
 * head faces (camera convention), its display name (the species for a native, its own for a released creature), whether
 * it is a native, what it is doing, whether it swims, whether it is in a chase (hunter or prey: `chase` or `dive`, or
 * fleeing a charging threat; a caught prey stays in the chase until it has gone), and whether it has gone (back to the
 * earth, or exploring out of the valley).
 */
export type ViewAnimal = {
  pose: AnimalPose;
  eye: { pos: Vec3; yaw: number; pitch: number };
  name: string;
  native: boolean;
  doing: Doing;
  swimmer: boolean;
  chasing: boolean;
  gone: 'earth' | 'exploring' | null;
};

/**
 * What the views need of the valley: its ground and trees, the animal by id (null once it has left the valley), the soft
 * caption, the real time in milliseconds (`performance.now()`), for the player's own timers, and where the map's camera
 * stands now (as the player zooms and pans it; see the map's `mapPose`).
 */
export type ViewsDeps = { world: FlyWorld; animal(id: string): ViewAnimal | null; say(text: string): void; now(): number; mapPose?(): Pose };

/**
 * The player's hands this frame: `look` the right stick's (or mouse's) turn (radians, positive turns the view left and
 * up), `zoom` RT minus LT, `moved` the left stick or WASD pushed, `any` any input at all (for the hints and idle timers).
 */
export type ViewInput = { look: { yaw: number; pitch: number }; zoom: number; moved: boolean; any: boolean };

/** What is drawn: one of the views, or the wide Follow a chase in Close or Eyes eases out to. */
export type Shown = ViewName | 'wide';

/** A view switch takes this long (s): a move, not a cut. */
const SWITCH_S = 0.7;
/** Stepping to a neighbour glides across in 1 s, plus 1 s per this many metres between them, at most 2 s. */
const NEIGHBOUR_M = 150;
/** The reins hand back after this many real seconds with no input. */
const REINS_IDLE_S = 20;
/** The look in Close and Eyes springs back to straight ahead with this time constant (s): gone within a second. */
const SPRING_TAU = 0.2;
/** A left-alone orbit eases back to behind the animal with this time constant (s), slowly. */
const EASE_BACK_TAU = 1.5;
/** RT and LT change Follow's distance by a factor of e every this many seconds, between 0.6 and 2.5 times the framing's. */
const ZOOM_S = 1, ZOOM_MIN = 0.6, ZOOM_MAX = 2.5;
/** The orbit's elevation stays within 5°–60° above the horizon (as Follow's own). */
const ORBIT_MIN = (5 * Math.PI) / 180, ORBIT_MAX = (60 * Math.PI) / 180;
/** At Fastest (the animals at 16×) the Follow framing stands back this much more, so the motion reads. */
const FASTEST_RATE = 16, FASTEST_WIDEN = 1.5;
/** The animal moves at least this fast (m/s) to count as moving (the orbit's ease back, the faster follow). */
const MOVING = 0.3;
/** During an eased switch the camera keeps at least this far (m) above the ground or water (or as high as the view it goes to, if lower). */
const BLEND_CLEAR = 0.5;

/** The way back from the map: watching an animal or in free flight, the animal and view, the sense on, and where the camera stood (once seen). */
type Before = { mode: 'locked' | 'free'; id: string | null; view: ViewName; sense: SenseName | null; pose: Pose | null };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const smooth = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const copy = (p: Pose): Pose => ({ ...p, pos: { ...p.pos } });
/** The way the camera faces (unit). */
const forwardOf = (p: Pose): Vec3 => ({ x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) });

/** The Follow spot of an animal: straight behind and above it at the framing's distance, and the point it looks at. */
function followSpot(a: AnimalPose, world: FlyWorld): { pos: Vec3; look: Vec3 } {
  const { back, up, lookUp } = followFraming(a.size, a.flying ? { altitude: a.pos.y - surfaceAt(world, a.pos.x, a.pos.z) } : undefined);
  // yaw 0 faces -z: behind is (sin, cos)
  const x = a.pos.x + Math.sin(a.yaw) * back, z = a.pos.z + Math.cos(a.yaw) * back;
  return { pos: { x, y: Math.max(a.pos.y + up, surfaceAt(world, x, z) + FOLLOW_CLEAR), z }, look: { x: a.pos.x, y: a.pos.y + lookUp, z: a.pos.z } };
}

/** The elevation (radians) Follow stands at before the player orbits it: its framing's height over its distance. */
function elevation(a: AnimalPose, world: FlyWorld): number {
  const { back, up } = followFraming(a.size, a.flying ? { altitude: a.pos.y - surfaceAt(world, a.pos.x, a.pos.z) } : undefined);
  return clamp(Math.atan2(up, back), ORBIT_MIN, ORBIT_MAX);
}

/** The caption for an animal that has gone: "The rabbit has gone back to the earth." / "Bramble has gone exploring.". */
const goneCaption = (a: ViewAnimal) =>
  `${a.native ? `The ${a.name.toLowerCase()}` : a.name} has gone ${a.gone === 'earth' ? 'back to the earth' : 'exploring'}.`;

/**
 * The camera's state machine while watching an animal (spec §1). Each frame `update` is handed the player's input and the
 * camera's pose now, and gives back the pose the camera should take, or null when free flight has it.
 *
 * Seams for the wiring:
 * - The map (`openMap`): the camera glides up to the map's pose (`deps.mapPose`, as the player zooms and pans it) and
 *   holds there; `chooseAnimal` dives down to an animal and locks on in Follow, `diveTo` dives down to a spot into free
 *   flight, `closeMap` dives back where you were (the lock, in the view and with the sense you had, or the free-flight
 *   pose the map was opened from). `mapIn` says how far up the map is (for its night light and trims).
 * - A stick still held when the camera changes hands (from flying to a lock, from steering the reins or the map's cursor
 *   back to riding along or a dive) does not take the camera: it has to be let go first.
 * - The reins (`reins`): only the mode and the 20 s idle hand-back (paused while a steered hunter eats) live here. `onReinsOff` is called whenever the reins
 *   end, however (B, idle, letting go, the animal going, the map, a new lock), so the wiring can stop steering in the
 *   simulation and give the clock back; `state.reins` says whether they are on.
 * - The senses (`sense`, `nextSense`): only stored here, while locked; it is cleared when the lock moves to another animal or ends.
 */
export class Views {
  /** The Director's say on Follow: its distance factor (on top of the player's), its orbit (until the player orbits) and the chase framing. */
  framing: FollowOpts = {};
  /** Called whenever the reins are handed back. */
  onReinsOff: (() => void) | null = null;

  private mode: Mode = 'free';
  private id: string | null = null;
  private view: ViewName = 'follow';
  private senseOn: SenseName | null = null;
  /**
   * The glide to the animal's Follow spot: made on the first frame from the camera's pose then, with where the animal was
   * (the Fly there glide, or a dive down from the map); `dive` makes the next one a dive.
   */
  private glide: { g: Glide | Dive; t: number; start: Vec3; dive: boolean } | null = null;
  private dive = false;
  private showing: Shown | null = null;
  private follow: FollowCam | null = null;
  private close: CloseCam | null = null;
  private eyes: EyesCam | null = null;
  private blend = new ViewBlend();
  /** How long the next switch takes (s). */
  private switchS = SWITCH_S;
  /** The chase's wide Follow is holding (from the chase on, and through a hunter's meal after a catch). */
  private wide = false;
  /** The player's orbit round the animal in Follow (null: straight behind), how long since it was touched (s), and the zoom factor. */
  private orbit: { yaw: number; pitch: number } | null = null;
  private orbitIdle = 0;
  private zoom = 1;
  /** The player's look off straight ahead in Close and Eyes (radians), springing back when let go. */
  private look = { yaw: 0, pitch: 0 };
  /** Where the animal was last frame (for "is it moving"). */
  private seen: Vec3 | null = null;
  /** The real time (ms) of the last input while steering. */
  private touched = 0;
  /** Where you were when the map opened; the glide up (from the pose then, once seen, and how long it has gone, s). */
  private beforeMap: Before | null = null;
  private rise: { from: Pose | null; t: number } | null = null;
  /** The dive down to a spot ('diving'): where to, and once begun, the dive and how long it has gone (s). */
  private down: { to: Pose; g: Dive | null; t: number } | null = null;
  /** How far up the map is (0..1, eased): rising, on it, or diving down from it. */
  private up = 0;
  /** The stick is still held from before the camera changed hands (flying, steering, the map's cursor): it does not take the camera until it has been let go. */
  private stickHeld = false;
  /** The camera's pose last frame. */
  private last: Pose | null = null;

  constructor(private readonly deps: ViewsDeps) {}

  /** The mode, the locked animal, the player's view, the sense on, and whether the reins are taken. */
  get state(): { mode: Mode; id: string | null; view: ViewName; sense: SenseName | null; reins: boolean } {
    return { mode: this.mode, id: this.id, view: this.view, sense: this.senseOn, reins: this.mode === 'reins' };
  }

  /** How far up the map is (0..1, eased): 0 down in the valley, 1 on the map; in between while gliding up or diving down. */
  get mapIn(): number {
    return this.up;
  }

  /** Where the camera stood when the map opened (for its "you were here"), or null. */
  get wasAt(): Pose | null {
    return this.beforeMap?.pose ?? null;
  }

  /** What is drawn while riding along (locked, or with the reins): a view, or a chase's wide Follow; null in free flight, gliding there or on the map. */
  get shown(): Shown | null {
    return this.mode === 'locked' || this.mode === 'reins' ? this.showing : null;
  }

  /** Lock on to animal `id`: from wherever the camera is, a glide to its Follow spot, then riding along in `view`. */
  lock(id: string, view: ViewName = 'follow'): void {
    this.release();
    this.orbit = null;
    this.zoom = 1;
    this.glideTo(id, view);
  }

  /** Change view (an eased move); during a chase's wide Follow the choice waits for the chase to end. */
  setView(v: ViewName): void {
    this.view = v;
  }

  /** The next view: Follow, Close, Eyes, and round. */
  cycleView(): void {
    this.setView(this.view === 'follow' ? 'close' : this.view === 'close' ? 'eyes' : 'follow');
  }

  /** The sense on (or none); only while watching an animal. */
  sense(name: SenseName | null): void {
    if (this.id !== null && this.mode !== 'free') this.senseOn = name;
  }

  /** X: the next of the animal's senses in `list` (its own, in order), off after the last (see `nextSense`); only while watching an animal. */
  nextSense(list: SenseName[]): void {
    this.sense(nextSense(list, this.senseOn));
  }

  /** Take (true, only while locked) or hand back (false) the reins. */
  reins(on: boolean): void {
    if (on && this.mode === 'locked') (this.mode = 'reins'), (this.touched = this.deps.now());
    else if (!on) this.handBack();
  }

  /** Let go: free flight has the camera, where it is (the reins are handed back first). */
  letGo(): void {
    this.release();
  }

  /** Open the map, remembering where you were (the reins are handed back: nobody steers from the map), and glide up to it. */
  openMap(): void {
    if (this.mode === 'map') return;
    this.handBack();
    const watching = this.id !== null && (this.mode === 'gliding' || this.mode === 'locked');
    this.beforeMap = { mode: watching ? 'locked' : 'free', id: this.id, view: this.view, sense: this.senseOn, pose: null };
    this.mode = 'map';
    this.down = null;
    this.rise = { from: null, t: 0 };
  }

  /**
   * Close the map and go back where you were: a dive back to the lock (in the view, and with the sense, you had), or to
   * where the camera stood in free flight (also when the animal went while the map was up: its caption says so).
   */
  closeMap(): void {
    if (this.mode !== 'map') return;
    const back = this.beforeMap!;
    const a = back.mode === 'locked' && back.id !== null ? this.deps.animal(back.id) : null;
    if (a && !a.gone) return this.diveToAnimal(back.id!, back.view, back.sense);
    if (a) this.deps.say(goneCaption(a)); // it went while the map was up
    if (back.pose) this.diveDown(back.pose);
    else this.release();
  }

  /** On the map: dive down to animal `id` and lock on in Follow (the animal you were watching keeps its sense). */
  chooseAnimal(id: string): void {
    if (this.mode !== 'map') return;
    const back = this.beforeMap!, same = back.mode === 'locked' && back.id === id;
    if (!same) (this.orbit = null), (this.zoom = 1);
    this.diveToAnimal(id, 'follow', same ? back.sense : null);
  }

  /** On the map: dive down to `spot` (see the map's `diveTo`: 30 m back from the point chosen, 15 m up, looking at it) into free flight. */
  diveTo(spot: Viewpoint): void {
    if (this.mode === 'map') this.diveDown(viewpointPose(spot, this.deps.world));
  }

  /** Step to the neighbouring animal to the left (-1) or right (+1) on screen among `cands`, gliding across in the same view. */
  neighbour(dir: -1 | 1, cands: Candidate[]): void {
    if (this.mode !== 'locked' || this.id === null || !this.last) return;
    const next = stepNeighbour(neighbours(this.id, cands, this.last.pos, forwardOf(this.last)), this.id, dir);
    if (next === this.id) return;
    const from = cands.find((c) => c.id === this.id), to = cands.find((c) => c.id === next);
    this.switchS = clamp(1 + (from && to ? dist(from.pos, to.pos) : 0) / NEIGHBOUR_M, 1, 2);
    this.id = next;
    this.newAnimal();
  }

  /**
   * One frame of `dt` real seconds: the player's `input`, the camera's pose now (`from`), the animals' rate (1 = Normal).
   * The pose the camera should take, or null when free flight has it.
   */
  update(dt: number, input: ViewInput, from: Pose, rate: number): Pose | null {
    this.last = copy(from);
    this.stickHeld &&= input.moved;
    if (this.mode !== 'gliding') this.up = 0; // (a dive from the map sets it as it goes)
    if (this.mode === 'free') return null;
    if (this.mode === 'map') return this.mapFrame(dt, from);
    if (this.mode === 'diving') return this.diveFrame(dt, input, from);
    const a = this.deps.animal(this.id!);
    if (!a || a.gone) {
      if (a) this.deps.say(goneCaption(a));
      this.release();
      return null;
    }
    if (input.moved && !this.stickHeld && this.mode !== 'reins') {
      this.release(); // the player takes the camera
      return null;
    }
    if (this.mode === 'reins') {
      const now = this.deps.now();
      if (input.any || a.doing === 'eat') this.touched = now; // the reins pause through a catch's meal: no idle hand-back then
      else if (now - this.touched >= REINS_IDLE_S * 1000) this.handBack();
    }
    if (this.mode === 'gliding') {
      const pose = this.glideStep(dt, a.pose, from);
      if (this.mode === 'gliding') return (this.last = pose);
      from = pose; // arrived: the view takes over from here, this frame
    }
    return (this.last = this.ride(dt, a, input, from, rate));
  }

  /** Glide to animal `id`'s Follow spot, then ride along in `view` (the orbit and zoom stand); a stick held from flying there waits to be let go. */
  private glideTo(id: string, view: ViewName): void {
    this.id = id;
    this.view = view;
    this.mode = 'gliding';
    this.stickHeld = true;
    this.newAnimal();
  }

  /** From the map: dive down to animal `id` and ride along in `view`, with `sense` on. */
  private diveToAnimal(id: string, view: ViewName, sense: SenseName | null): void {
    this.leaveMap();
    this.glideTo(id, view);
    this.dive = true;
    this.senseOn = sense;
  }

  /** From the map: dive down to pose `to`, then free flight has the camera there. */
  private diveDown(to: Pose): void {
    this.release();
    this.leaveMap();
    this.mode = 'diving';
    this.down = { to: copy(to), g: null, t: 0 };
    this.up = 1;
  }

  /** Off the map (the mode is the caller's): a stick held from its cursor waits to be let go before it takes the camera. */
  private leaveMap(): void {
    this.beforeMap = this.rise = null;
    this.stickHeld = true;
  }

  /** One frame on the map: the glide up from the pose it was opened from to the map's pose, then holding it (as it zooms and pans). */
  private mapFrame(dt: number, from: Pose): Pose {
    const r = this.rise!;
    if (!r.from) r.from = this.beforeMap!.pose = copy(from);
    r.t += dt;
    const to = this.deps.mapPose?.() ?? r.from, k = Math.min(1, r.t / RISE_S);
    this.up = smooth(k);
    return between(r.from, to, k, this.deps.world, true);
  }

  /** One frame of the dive down to a spot; landed, free flight has the camera there (a stick pushed afresh takes it at once). */
  private diveFrame(dt: number, input: ViewInput, from: Pose): Pose | null {
    if (input.moved && !this.stickHeld) {
      this.release();
      return null;
    }
    const d = this.down!;
    d.g ??= new Dive(from, d.to, this.deps.world);
    d.t += dt;
    const p = d.g.sample(d.t);
    this.up = 1 - smooth(d.t / d.g.duration);
    if (p.done) (this.mode = 'free'), (this.down = null);
    return { pos: p.pos, yaw: p.yaw, pitch: p.pitch };
  }

  /** A new animal (or the same one afresh): fresh cameras, no chase, no sense, the look straight ahead, a glide (not a dive) there. */
  private newAnimal(): void {
    this.glide = null;
    this.dive = false;
    this.showing = null;
    this.follow = this.close = this.eyes = null;
    this.wide = false;
    this.seen = null;
    this.senseOn = null;
    this.look = { yaw: 0, pitch: 0 };
  }

  /** End the reins (back to riding along, locked on: a stick still held from steering waits to be let go), telling the wiring. */
  private handBack(): void {
    if (this.mode !== 'reins') return;
    this.mode = 'locked';
    this.stickHeld = true;
    this.onReinsOff?.();
  }

  /** Back to free flight, the reins handed back first. */
  private release(): void {
    this.handBack();
    this.mode = 'free';
    this.id = null;
    this.beforeMap = this.rise = this.down = null;
    this.up = 0;
    this.newAnimal();
    this.blend = new ViewBlend();
    this.switchS = SWITCH_S;
  }

  /**
   * One frame of the glide to the Follow spot: the Fly there glide to where the animal was, carried along by as much of the
   * way as it has walked since (so it lands behind it, however far it went). Arriving, the mode is 'locked'.
   */
  private glideStep(dt: number, a: AnimalPose, from: Pose): Pose {
    const { world } = this.deps;
    if (!this.glide) {
      const s = followSpot(a, world), h = (p: Vec3) => p.y - surfaceAt(world, p.x, p.z);
      const vp: Viewpoint = { name: '', pos: { x: s.pos.x, z: s.pos.z, h: h(s.pos) }, look: { x: s.look.x, z: s.look.z, h: h(s.look) } };
      const g = this.dive ? new Dive(from, viewpointPose(vp, world), world) : new Glide(from, vp, world);
      this.glide = { g, t: 0, start: { ...a.pos }, dive: this.dive };
    }
    const gl = this.glide;
    gl.t += dt;
    const p = gl.g.sample(gl.t), k = smooth(gl.t / gl.g.duration);
    this.up = gl.dive ? 1 - k : 0;
    const x = p.pos.x + (a.pos.x - gl.start.x) * k, z = p.pos.z + (a.pos.z - gl.start.z) * k;
    // keep the glide's own clearance (up to Follow's) over the ground it is carried over
    const clear = Math.min(FOLLOW_CLEAR, p.pos.y - surfaceAt(world, p.pos.x, p.pos.z));
    const y = Math.max(p.pos.y + (a.pos.y - gl.start.y) * k, surfaceAt(world, x, z) + clear);
    if (p.done) (this.mode = 'locked'), (this.glide = null);
    return { pos: { x, y, z }, yaw: p.yaw, pitch: p.pitch };
  }

  /** One frame riding along: the chase rule, the switch to the view wanted, the player's look or orbit, and the eased switch. */
  private ride(dt: number, a: ViewAnimal, input: ViewInput, from: Pose, rate: number): Pose {
    const { world } = this.deps, p = a.pose;
    const moving = this.seen !== null && dt > 0 && Math.hypot(p.pos.x - this.seen.x, p.pos.z - this.seen.z) > MOVING * dt;
    this.seen = { ...p.pos };
    // a chase in Close or Eyes eases out to a wide Follow, and a hunter at its meal is seen wide however the view came to
    // it (only the meal after a catch is `eat`): no catch is ever seen up close; a miss gives the view back
    this.wide = this.view !== 'follow' && (a.chasing || a.doing === 'eat');
    const want: Shown = this.wide ? 'wide' : this.view;
    if (want !== this.showing) this.show(want, p, from);
    this.steer(dt, input, p, moving);

    let pose: Pose;
    if (this.showing === 'close') pose = this.close!.update(dt, p, this.look, world);
    else if (this.showing === 'eyes') pose = this.eyes!.update(dt, a.eye, this.look, world, a.swimmer);
    else {
      const f = this.framing, widen = rate >= FASTEST_RATE ? FASTEST_WIDEN : 1;
      pose = this.follow!.update(dt, p.pos, world, {
        orbit: this.orbit ?? f.orbit,
        distance: (f.distance ?? 1) * this.zoom * widen,
        // the faster rate only while it moves: a still animal's orbit should not swing 16 times as fast
        rate: moving ? rate : 1,
        wide: this.showing === 'wide' || f.wide,
      });
    }
    if (!this.blend.active) return pose;
    const out = this.blend.apply(pose, dt);
    // a straight blend could cut a hill: keep it above the ground (or as low as the view it goes to, under the water)
    const floor = Math.min(surfaceAt(world, out.pos.x, out.pos.z) + BLEND_CLEAR, pose.pos.y);
    return { ...out, pos: { ...out.pos, y: Math.max(out.pos.y, floor) } };
  }

  /** Switch to `want` with fresh cameras (Follow starts settled at its spot), eased from the camera's pose now. */
  private show(want: Shown, a: AnimalPose, from: Pose): void {
    this.showing = want;
    this.look = { yaw: 0, pitch: 0 };
    this.follow = this.close = this.eyes = null;
    if (want === 'close') this.close = new CloseCam(a.size);
    else if (want === 'eyes') this.eyes = new EyesCam();
    else {
      const s = followSpot(a, this.deps.world);
      this.follow = new FollowCam(s.pos, s.look, a.pos, a.size, a.flying);
    }
    this.blend.start(from, this.switchS);
    this.switchS = SWITCH_S;
  }

  /**
   * The player's hands on the view: in Close and Eyes the look turns within the view's reach and springs back when let
   * go (not with Sharp eyes' zoom in Eyes: it stays where it was aimed); in Follow the look orbits the camera round the animal (eased back to behind it after 8 s left alone while the
   * animal moves) and RT / LT push it back or bring it nearer (not with the reins, where they fly up and down).
   */
  private steer(dt: number, input: ViewInput, a: AnimalPose, moving: boolean): void {
    const { yaw, pitch } = input.look, turned = yaw !== 0 || pitch !== 0;
    if (this.showing === 'close' || this.showing === 'eyes') {
      const reach = this.showing === 'close' ? CLOSE_LOOK : EYES_LOOK;
      if (turned) this.look = { yaw: clamp(this.look.yaw + yaw, -reach.yaw, reach.yaw), pitch: clamp(this.look.pitch + pitch, -reach.pitch, reach.pitch) };
      else if (!(this.senseOn === 'sharp' && this.showing === 'eyes')) {
        const k = Math.exp(-dt / SPRING_TAU);
        this.look = { yaw: this.look.yaw * k, pitch: this.look.pitch * k };
      }
      return;
    }
    if (input.zoom && this.mode !== 'reins') this.zoom = clamp(this.zoom * Math.exp((input.zoom * dt) / ZOOM_S), ZOOM_MIN, ZOOM_MAX);
    const rest = elevation(a, this.deps.world);
    if (turned) {
      // the picture turns the way the look does: turning left swings the camera the other way round the animal, looking up lowers it
      const o = this.orbit ?? { yaw: 0, pitch: rest };
      this.orbit = { yaw: wrap(o.yaw - yaw), pitch: clamp(o.pitch - pitch, ORBIT_MIN, ORBIT_MAX) };
      this.orbitIdle = 0;
    } else if ((this.orbitIdle += dt) >= FOLLOW_EASE_BACK_S && moving && this.orbit) {
      const k = 1 - Math.exp(-dt / EASE_BACK_TAU), o = this.orbit;
      this.orbit = { yaw: o.yaw - wrap(o.yaw) * k, pitch: o.pitch + (rest - o.pitch) * k };
      if (Math.abs(this.orbit.yaw) < 1e-3 && Math.abs(this.orbit.pitch - rest) < 1e-3) this.orbit = null;
    }
  }
}
