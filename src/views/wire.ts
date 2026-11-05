/**
 * The views in the running valley: each frame it hands the views controller the player's hands, picks the animal you
 * are looking at in free flight (the ring and the name tag on it), brings the camera's near plane in for Close and Eyes,
 * hides the animal's own body from the camera in Eyes and eases its lens in there (the camera's width and the picture's
 * look, from its senses), and keeps the card and the hints at the bottom left. X steps through the animal's own senses
 * (see `senses.ts`), each explained in a line the first time; with Fear on, the edges pulse with its heartbeat, the
 * heartbeat sounds, and the danger gets a soft red ring (or an arc at the screen's edge, out of view); with Smell on, the
 * other animals' scent trails round it glow on the ground; with Hearing on, the ones making noise send out slow ripples
 * (one out of view, an arc at the edge on its side); with Sharp eyes on, the moving animals it spots shimmer, and in Eyes
 * the view narrows to 20° (Ruling R12). With the reins taken it steers the animal in the simulation every frame from the stick (the Do press
 * held until a tick has seen it, no move while a steered hunter eats its catch), holds the clock at Normal, says whose
 * the reins are and shows their buttons; handing back lets the animal go and gives the clock back. View / Select (Tab)
 * opens the overview map (see `map-view.ts`: its cursor is steered here, before the camera moves, and A chooses on it).
 * `main.ts` feeds it the frame and the presses; what it does with a press is `act` (see `keys.ts` for which press asks what).
 */
import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { FlyWorld } from '../camera/freefly';
import type { Recipe } from '../recipe/schema';
import { GRAIN_HZ, setLens, type LensUniforms } from '../render/lens';
import type { SteerInput } from '../sim/types';
import type { Vec3 } from '../util/vec';
import { AimHold, aimAngle, pickAim, type Candidate } from './aim';
import { FearBeat, bpm } from './fear';
import { cardLines, followHint, hintsFor, youAre, type ViewsHud } from './hud';
import type { ViewAction } from './keys';
import { NO_LENS, lensFor, type Lens } from './lens';
import type { MapHands } from './map-view';
import { DoLatch, steerFrom } from './reins';
import type { Ring } from './ring';
import type { RippleMesh, Sound } from './ripples';
import { firstLine, type Sensing } from './senses';
import { SHARP_AIM, SHARP_CONE, SHARP_FOV, sharpPick, type Sighting } from './sharp';
import type { TrailMesh } from './trail-mesh';
import type { Scents } from './trails';
import { nearPlane, type Pose, type SenseName } from './types';
import type { Mode, ViewAnimal, ViewInput, Views } from './views';

/** In Close and Eyes the far plane comes in to this (m) as the near plane does, still past the backdrop's ridges (6 km). */
export const CLOSE_FAR = 7000;
/**
 * The camera is riding close (Close or Eyes, or a switch to or from them on its way) while it is within this many body
 * lengths of the animal (at least NEAR_ZONE_MIN m): then its near plane comes in. Follow always stands farther off.
 */
const NEAR_ZONE = 2, NEAR_ZONE_MIN = 1;
/** Its body is hidden (Eyes) while the camera is within this many body lengths of its eyes (at least SELF_ZONE_MIN m). */
const SELF_ZONE = 1, SELF_ZONE_MIN = 0.3;
/** The hints show this long (real seconds) after locking on or a press. */
const HINTS_S = 5;
/** The line-of-sight check samples the ground every this many metres along the line (at most LINE_STEPS samples). */
const LINE_STEP = 3, LINE_STEPS = 64;
/** The name tag stands this far (m) over the animal's back, plus this share of its size. */
const TAG_UP = 0.3, TAG_SIZE = 0.4;
/** The Eyes view's lens eases in and out over this long (real seconds). */
const LENS_S = 0.5;
/** The line explaining a sense shows this long (real seconds), the first time it is switched on this session. */
const FIRST_LINE_S = 5;
/** Fear's pulse eases in and out over this long (real seconds), and follows the animal's fear with this time constant (s): never a jump. */
const FEAR_S = 0.5, FEAR_TAU = 0.6;
/** Smell's trails ease in and out over this long (real seconds), and are laid afresh round the animal this often (real seconds). */
const SMELL_S = 0.5, SNIFF_S = 0.25;
/** Hearing's ripples ease in and out over this long (real seconds). */
const HEAR_S = 0.5;
/**
 * Sharp eyes' zoom eases in and out over this long (real seconds); its shimmer rings glow this much (prey; the others
 * half that), breathing this many times as fast as the highlight's.
 */
const SHARP_S = 0.8, SHIMMER = 0.7, SHIMMER_RATE = 3;
/** "You're the fox!" shows this long (real seconds) on taking the reins. */
const YOU_S = 3;
/** The danger counts as in view while it projects within this share of the screen's half width and height; else the edge arc shows. */
const IN_VIEW = 0.95;
const DEG = Math.PI / 180;
const smooth = (t: number) => t * t * (3 - 2 * t);

const ahead = new Vector3(), tagAt = new Vector3(), threatAt = new Vector3();
/** `k` (0..1) moved `dt` s on toward 1 (`on`) or 0, all the way in `s` s. */
const fade = (k: number, on: boolean, dt: number, s: number) => Math.min(1, Math.max(0, k + (on ? dt : -dt) / s));
/** The way a pose faces (unit). */
const forwardOf = (p: Pose): Vec3 => ({ x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Whether the ground hides `to` from `from`: a coarse check of the height field along the line (trunks do not count,
 * nor does the water), sampled every few metres; the ends themselves are not tested.
 */
export function lineBlocked(world: Pick<FlyWorld, 'heightAt'>, from: Vec3, to: Vec3): boolean {
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), n = Math.min(LINE_STEPS, Math.ceil(d / LINE_STEP));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
    if (world.heightAt(x, z) > y) return true;
  }
  return false;
}

/** What the wiring needs: the controller, the valley's ground, the camera, the animals, the ring and the screen furniture. */
export type ViewsWireDeps = {
  views: Views;
  world: FlyWorld;
  camera: PerspectiveCamera;
  animals: {
    viewAnimal(id: string): ViewAnimal | null; candidates(): Candidate[]; hideFromCamera(id: string, on: boolean): void;
    /** Animal `id`'s senses (its recipe's), for its lens; null once it has left the valley. */
    sensesOf(id: string): Recipe['mind']['senses'] | null;
  };
  ring: Ring;
  hud: ViewsHud;
  /** Did the player last use the keyboard (the hints name its keys), or the controller? */
  keys(): boolean;
  /** Real time (ms), for the hints and the ring's breath. */
  now(): number;
  /** The screen's size (CSS px), for the tag. */
  screen(): { w: number; h: number };
  /** What animal `id` senses now (see `Sensing`: its senses in the order X steps through them, its fear and its danger); null once it has gone. */
  sensing?(id: string): Sensing | null;
  /** The red ring under the danger (Fear). */
  threatRing?: Ring;
  /** The heartbeat's sound (Fear): beating at a rate (beats a minute), or silent. */
  heartbeat?: { set(bpm: number, on: boolean, phase?: number): void };
  /** Smell: the trails' mesh, what animal `id` smells now (null once it has gone), and the animals' time now (animal seconds). */
  smell?: { mesh: TrailMesh; scents(id: string): Scents | null; time(): number };
  /**
   * The reins in the simulation: steer animal `id` (null: hand it back), the animals' time now (animal s), animal `id`'s
   * own heading now (the simulation's yaw; null once it has gone) and whether it can fly, and the clock held at Normal
   * while steering (`take`) and given back (`give`).
   */
  reins?: { steer(id: string, input: SteerInput | null): void; time(): number; heading(id: string): number | null; flies(id: string): boolean; take(): void; give(): void };
  /** Hearing: the ripples' mesh, and who animal `id` hears now (null once it has gone). */
  hearing?: { mesh: RippleMesh; heard(id: string): Sound[] | null };
  /** Sharp eyes: the shimmer rings (as many as shimmer at once), and what animal `id` could spot now at `light` (null once it has gone). */
  sharp?: { rings: Ring[]; sightings(id: string, light: number): { range: number; seen: Sighting[] } | null };
  /** The post pipeline's lens (none: the camera's width still changes in Eyes, the picture does not). */
  lens?: LensUniforms;
  /** How light it is now (the simulation's `daylight` of the sun's height: 1 by day, 0 at deep night); by day if not given. */
  daylight?(): number;
  /** The overview map's screen (see `MapView`): it has opened, the cursor's hands this frame, and A chosen on it. */
  map?: { open(): void; steer(dt: number, hands: MapHands): void; choose(): void };
};

/** The player's hands for the wiring: the views' (see `ViewInput`), with the left stick (x right, y up) and run held, for the reins. */
export type WireHands = ViewInput & { stick?: { x: number; y: number }; run?: boolean };

/** The views wired into the valley (see the file's note). */
export class ViewsWire {
  /** The animal highlighted in free flight (A locks on to it), or null. */
  highlighted: string | null = null;
  private hold = new AimHold();
  /** A button was pressed since the last frame (any input, for the reins' idle hand-back). */
  private poked = false;
  private hintsUntil = -Infinity;
  /** The animal whose body is hidden from the camera (the one we see through in Eyes). */
  private self: string | null = null;
  private was: Mode = 'free';
  /** The camera's own near and far planes, for every view but Close and Eyes, and its own (vertical) field of view. */
  private readonly planes: { near: number; far: number; fov: number };
  /** The lens being eased in or out, and whose it is (only the same animal's lens changes while any of it shows). */
  private lens: Lens = NO_LENS;
  private lensId: string | null = null;
  /** How far the lens is in (0..1, linear in time; the picture gets it eased), and the ease last put in. */
  private lensIn = 0;
  private lensK = 0;
  /**
   * The senses X steps through, as they were when it switched one on, and whose they are: kept until off or another
   * animal, so a fear that comes and goes mid-cycle never reorders them under the player's thumb.
   */
  private cycle: { id: string; list: SenseName[] } | null = null;
  /** The senses whose line has been shown this session, the line showing now and until when (real ms). */
  private told = new Set<SenseName>();
  private line: string | null = null;
  private lineUntil = -Infinity;
  /** Fear's pulse: whether it was on last frame, how far it is in (0..1, linear in time), the fear it shows (eased after the animal's), and its beat. */
  private fearOn = false;
  private fearIn = 0;
  private fearLevel = 0;
  private beat = new FearBeat();
  /** Smell's trails: how far in they are (0..1, linear in time), whose they were last laid for, and when they are laid next (real ms). */
  private smellIn = 0;
  private smellId: string | null = null;
  private sniffAt = -Infinity;
  /**
   * Hearing's ripples, Sharp eyes' shimmer and its zoom (Eyes only): how far in each is (0..1, linear in time); the
   * animals shimmering (kept while the shimmer eases out), and how many rings showed last frame.
   */
  private hearIn = 0;
  private sharpIn = 0;
  private zoomIn = 0;
  private picks: Sighting[] = [];
  private shimmering = 0;
  /** The animal steered in the simulation (null: none), its Do press, and "You're the fox!" while it shows (until real ms). */
  private steering: string | null = null;
  private doPress = new DoLatch();
  private you: { id: string; text: string; until: number } | null = null;

  constructor(private readonly d: ViewsWireDeps) {
    this.planes = { near: d.camera.near, far: d.camera.far, fov: d.camera.fov };
    d.views.onReinsOff = () => this.reinsOff(); // however the reins end (B, idle, letting go, the animal going, the map, the menu, an arrival)
  }

  /** A button or key went down: the hints show again (while watching an animal). */
  poke(): void {
    this.poked = true;
    this.hintsUntil = this.d.now() + HINTS_S * 1000;
  }

  /** Do what the player asked (see `viewAction` and `keyAction`). */
  act(a: ViewAction): void {
    const { views } = this.d;
    this.poke();
    switch (a) {
      case 'lock':
        if (this.highlighted) views.lock(this.highlighted);
        break;
      case 'cycleView':
        return views.cycleView();
      case 'sense':
        return this.nextSense();
      case 'prev':
      case 'next':
        return views.neighbour(a === 'prev' ? -1 : 1, this.d.animals.candidates());
      case 'reins':
        return views.reins(!views.state.reins);
      case 'letGo':
        return views.letGo();
      case 'map':
        views.openMap();
        return this.d.map?.open();
      case 'closeMap':
        return views.closeMap();
      case 'do':
        if (views.state.reins) this.doPress.press();
        return;
      case 'choose':
        return this.d.map?.choose();
    }
  }

  /**
   * One frame of `dt` real seconds, after the animals have moved: the map's cursor (while it is up), then the controller's
   * pose for the camera (null: free flight has it) from the player's `hands`, the camera's pose now and the animals' `rate`; then the highlight (only while
   * `aiming`: free flight with nothing else holding the camera), the near plane (in when the camera rides close), the
   * hidden body (while the camera is at its eyes in Eyes, or on its way out of them), the reins' steering, the lens (eased
   * in while Eyes is shown, out otherwise) and Sharp eyes' zoom, the card and hints, and the senses.
   */
  frame(dt: number, hands: WireHands, from: Pose, rate: number, aiming: boolean): Pose | null {
    const { views, animals, hud } = this.d;
    this.d.map?.steer(dt, hands); // the map's cursor, pan and zoom, before the views place the camera on it
    // zoomed in with Sharp eyes (in Eyes), the right stick aims slowly
    const slow = views.state.sense === 'sharp' && views.shown === 'eyes' ? SHARP_AIM : 1, look = { yaw: hands.look.yaw * slow, pitch: hands.look.pitch * slow };
    const pose = views.update(dt, { look, zoom: hands.zoom, moved: hands.moved, any: hands.any || this.poked }, from, rate);
    this.poked = false;
    const st = views.state;
    if ((st.mode === 'free') !== (this.was === 'free')) this.hold.reset(); // a lock starting or ending: the highlight starts afresh
    // locking on, and arriving from the glide there: the hints show (again)
    if ((this.was === 'free' && st.mode !== 'free') || (this.was === 'gliding' && st.mode === 'locked')) this.hintsUntil = this.d.now() + HINTS_S * 1000;
    this.was = st.mode;
    const watching = st.mode === 'gliding' || st.mode === 'locked' || st.mode === 'reins';
    const a = watching && st.id !== null ? animals.viewAnimal(st.id) : null;
    // what the camera is near decides, not the view switched to: a switch is a 0.7 s move, so the body goes only once the
    // camera is at its eyes, and comes back (and the near plane goes back out) only once the camera has left them
    const at = pose?.pos, bl = a ? a.pose.bodyLength : 0;
    const eyesNear = !!(a && at && dist(at, a.eye.pos) < Math.max(SELF_ZONE_MIN, SELF_ZONE * bl));
    this.hideSelf(eyesNear && (views.shown === 'eyes' || this.self === st.id) ? st.id : null);
    const close = !!(a && at && dist(at, a.pose.pos) < Math.max(NEAR_ZONE_MIN, NEAR_ZONE * bl));
    const here = a && !a.gone ? a : null, on = (s: SenseName) => (here && st.sense === s ? st.id : null);
    if (here && st.mode === 'reins') this.steer(st.id!, here, hands, (pose ?? from).yaw);
    const lensK = this.see(dt, here && views.shown === 'eyes' ? st.id : null, at);
    this.project(close ? nearPlane(a!.pose.size) : null, lensK, this.spot(dt, on('sharp'), views.shown === 'eyes', pose ?? from));
    hud.card(here ? cardLines(here.name, here.doing, st.view, st.sense) : null);
    const flies = st.mode === 'reins' && !!this.d.reins?.flies(st.id!);
    hud.hints(here && this.d.now() < this.hintsUntil ? hintsFor(st.mode, this.d.keys(), flies) : null);
    const fearArc = this.feel(dt, on('fear') !== null ? (this.d.sensing?.(st.id!) ?? null) : null), hearArc = this.hear(dt, on('hearing'));
    // one arc at the edge: the sense that is on has it (the other may still be easing out)
    if (hearArc !== undefined && (st.sense === 'hearing' || !fearArc)) hud.edgeArc(hearArc, 'sound');
    else if (fearArc !== undefined) hud.edgeArc(fearArc);
    this.sniff(dt, on('smell'));
    const you = here && this.you?.id === st.id && this.d.now() < this.you.until ? this.you.text : null;
    const youTagged = this.aim(dt, aiming && st.mode === 'free', you !== null ? here : null, you ?? '');
    // whose reins they are: on the tag over the animal, or in the card while that is not in the picture (Eyes)
    hud.senseLine(you && !youTagged ? you : here && st.sense && this.d.now() < this.lineUntil ? this.line : null);
    return pose;
  }

  /**
   * The reins, this frame, on animal `id` (`a` as the views see it): taken (the clock held, "You're the fox!"), then
   * steered from the stick, `cameraYaw` the camera's turn: run held, flying up or down (RT / LT, E / Q), Do held until a
   * tick has seen it. While a steered hunter eats its catch the reins pause: no move is sent until the meal is over.
   */
  private steer(id: string, a: ViewAnimal, hands: WireHands, cameraYaw: number): void {
    const r = this.d.reins;
    if (!r) return;
    if (this.steering !== id) {
      this.reinsOff(); // (another animal's: never in practice, a new lock hands back first)
      this.steering = id;
      this.doPress.clear();
      r.take();
      this.you = { id, text: youAre(a.name, a.native), until: this.d.now() + YOU_S * 1000 };
    }
    const act = this.doPress.at(r.time()), heading = r.heading(id) ?? undefined;
    if (a.doing === 'eat') return r.steer(id, steerFrom({ x: 0, y: 0 }, cameraYaw, false, 0, false, heading));
    const fly = hands.zoom > 0 ? 1 : hands.zoom < 0 ? -1 : 0;
    r.steer(id, steerFrom(hands.stick ?? { x: 0, y: 0 }, cameraYaw, !!hands.run, fly, act, heading));
  }

  /** The reins are handed back (however): the animal goes back to its own life and the clock to the player's speed. */
  private reinsOff(): void {
    const r = this.d.reins, id = this.steering;
    if (!r || id === null) return;
    this.steering = this.you = null;
    this.doPress.clear();
    r.steer(id, null);
    r.give();
  }

  /**
   * The highlight in free flight (`on`): the animal nearest the centre of the screen, held without flickering, with its
   * ring and tag. Otherwise the tag can say `text` over animal `you` (whose reins they are); whether it does (that is in
   * the picture).
   */
  private aim(dt: number, on: boolean, you: ViewAnimal | null, text: string): boolean {
    const { ring, hud } = this.d;
    const a = on ? this.pick(dt) : null;
    if (!on) (this.highlighted = null), this.hold.reset();
    ring.show(a && a.pose, this.d.now() / 1000);
    if (a) return hud.tag(this.tagAbove(a.pose), a.name, followHint(this.d.keys())), false;
    const at = you && this.tagAbove(you.pose);
    hud.tag(at, text, '');
    return !!at;
  }

  /** Where the tag over animal `p` goes on the screen (px), or null while that point is not in front of the camera. */
  private tagAbove(p: ViewAnimal['pose']): { x: number; y: number } | null {
    tagAt.set(p.pos.x, p.pos.y + p.backHeight + TAG_UP + TAG_SIZE * p.size, p.pos.z).project(this.d.camera);
    const { w, h } = this.d.screen();
    return tagAt.z > -1 && tagAt.z < 1 ? { x: ((tagAt.x + 1) / 2) * w, y: ((1 - tagAt.y) / 2) * h } : null;
  }

  /** This frame's highlight (and the animal, if it is still here). */
  private pick(dt: number): ViewAnimal | null {
    const { camera, world, animals } = this.d;
    camera.updateMatrixWorld();
    const eye = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    camera.getWorldDirection(ahead);
    const forward = { x: ahead.x, y: ahead.y, z: ahead.z };
    const cands = animals.candidates();
    const blocked = (from: Vec3, to: Vec3) => lineBlocked(world, from, to);
    // the held animal lets go once it is out of the cone, or hidden behind a hill, for a moment (Ruling R6)
    const angleOf = (id: string) => {
      const c = cands.find((x) => x.id === id), angle = c ? aimAngle(c, eye, forward) : null;
      return angle !== null && !blocked(eye, c!.pos) ? angle : null;
    };
    this.highlighted = this.hold.update(pickAim(cands, eye, forward, blocked), angleOf, dt);
    const a = this.highlighted !== null ? animals.viewAnimal(this.highlighted) : null;
    return a && !a.gone ? a : null;
  }

  /** The next of the locked animal's senses, or off after the last; the first time a sense comes on, its line shows. */
  private nextSense(): void {
    const { views } = this.d, st = views.state;
    if (st.id === null) return;
    const s = this.d.sensing?.(st.id), a = this.d.animals.viewAnimal(st.id);
    // from off (or on a new animal): the order as it is now, Fear first if it is afraid now; then that order until off
    if (st.sense === null || this.cycle?.id !== st.id) this.cycle = { id: st.id, list: s?.senses ?? [] };
    views.nextSense(this.cycle.list);
    const on = views.state.sense;
    if (on === null) this.cycle = null;
    this.lineUntil = -Infinity;
    if (!on || !a || this.told.has(on)) return;
    this.told.add(on);
    this.line = firstLine(on, a.native ? `the ${a.name.toLowerCase()}` : a.name, s?.prey);
    this.lineUntil = this.d.now() + FIRST_LINE_S * 1000;
  }

  /**
   * Fear (`s`: what the animal senses now, while Fear is on; null otherwise), `dt` real seconds on: the edges' pulse eased
   * in or out and beating at its eased fear, the heartbeat with it, and the danger's red ring (or the arc at the screen's
   * edge on its side, while it is out of view): the side for that arc (null: none; undefined: off and put out, nothing done).
   */
  private feel(dt: number, s: Sensing | null): 'left' | 'right' | null | undefined {
    const { d } = this, starting = !!s && !this.fearOn;
    this.fearOn = !!s;
    if (!s && this.fearIn === 0) return undefined; // off, and already put out: nothing to do
    // switching on from right out, the pulse starts at the animal's fear now, on a fresh beat; after that it follows the
    // fear, eased (switched back on while it eases out, it carries on from where it is: the edges never jump)
    if (starting && this.fearIn === 0) this.beat.reset(), (this.fearLevel = s!.fear);
    else if (s) this.fearLevel = s.fear + (this.fearLevel - s.fear) * Math.exp(-dt / FEAR_TAU);
    this.fearIn = Math.min(1, Math.max(0, this.fearIn + (s ? dt : -dt) / FEAR_S));
    const k = smooth(this.fearIn);
    if (d.lens) d.lens.edge.value = k > 0 ? k * this.beat.step(dt, this.fearLevel) : 0;
    // the sound (re)starts in step with the edges' beat, wherever that is
    d.heartbeat?.set(bpm(this.fearLevel), !!s, this.beat.at);
    const t = s?.threat ? d.animals.viewAnimal(s.threat) : null, threat = t && !t.gone ? t : null;
    const side = threat ? this.sideOf(threat.pose) : null;
    d.threatRing?.show(threat && side === null ? threat.pose : null, d.now() / 1000);
    return side;
  }

  /**
   * Hearing (`id`: the animal listening, while Hearing is on; null otherwise), `dt` real seconds on: the ripples of the
   * ones it hears, eased in or out; the side of the screen the loudest one out of view is on, for the edge arc (null:
   * none; undefined: off and put out, nothing done).
   */
  private hear(dt: number, id: string | null): 'left' | 'right' | null | undefined {
    const h = this.d.hearing;
    if (!h || (id === null && this.hearIn === 0)) return undefined;
    const sounds = id !== null ? h.heard(id) : null;
    this.hearIn = fade(this.hearIn, id !== null, dt, HEAR_S);
    h.mesh.frame(sounds, dt, this.d.now() / 1000, smooth(this.hearIn));
    let side: 'left' | 'right' | null = null, loudest = 0;
    for (const s of sounds ?? []) {
      if (s.loud <= loudest) continue;
      const off = this.sideOf(s.pose);
      if (off) (side = off), (loudest = s.loud);
    }
    return side;
  }

  /**
   * Sharp eyes (`id`: the animal looking, while they are on; null otherwise), `dt` real seconds on, the camera at `pose`,
   * `eyes` while the Eyes view is shown: the shimmer rings under the moving animals it spots where it looks (in the
   * zoom's cone in Eyes, across the picture in Follow and Close), eased in or out (the last ones fading where they were);
   * how far the zoom is in (0..1: only in Eyes, Ruling R12).
   */
  private spot(dt: number, id: string | null, eyes: boolean, pose: Pose): number {
    const s = this.d.sharp, { camera } = this.d;
    this.sharpIn = fade(this.sharpIn, id !== null, dt, SHARP_S);
    this.zoomIn = fade(this.zoomIn, id !== null && eyes, dt, SHARP_S);
    const k = smooth(this.sharpIn), zoom = smooth(this.zoomIn);
    if (!s || (k === 0 && this.shimmering === 0)) return zoom;
    const sight = id !== null ? s.sightings(id, this.d.daylight?.() ?? 1) : null;
    if (sight) {
      const half = Math.atan(Math.tan((camera.fov * DEG) / 2) * camera.aspect) / DEG; // the picture's half width (degrees)
      const ids = sharpPick(sight.seen, pose.pos, forwardOf(pose), sight.range, eyes ? SHARP_CONE : half).slice(0, s.rings.length);
      this.picks = ids.map((pid) => sight.seen.find((x) => x.id === pid)!);
    }
    if (k === 0) this.picks = [];
    const t = (this.d.now() / 1000) * SHIMMER_RATE, n = this.picks.length;
    for (let i = 0; i < Math.max(n, this.shimmering); i++) {
      const c = i < n ? this.picks[i] : null;
      s.rings[i].show(c && c.pose, t, c ? SHIMMER * k * (c.prey ? 1 : 0.5) : 0);
    }
    this.shimmering = n;
    return zoom;
  }

  /**
   * Smell (`id`: the animal smelling, while Smell is on; null otherwise), `dt` real seconds on: the trails round it laid
   * afresh every SNIFF_S s (at once for another animal), and eased in or out; off and eased right out, nothing is done.
   */
  private sniff(dt: number, id: string | null): void {
    const s = this.d.smell;
    if (!s || (id === null && this.smellIn === 0)) return;
    const now = this.d.now();
    if (id !== null && (id !== this.smellId || now >= this.sniffAt)) {
      const scents = s.scents(id);
      if (scents) s.mesh.lay(scents, s.time());
      this.smellId = id;
      this.sniffAt = now + SNIFF_S * 1000;
    }
    this.smellIn = Math.min(1, Math.max(0, this.smellIn + (id !== null ? dt : -dt) / SMELL_S));
    s.mesh.frame(s.time(), smooth(this.smellIn));
  }

  /** Where animal `p` is from the camera: null while it is in view, else the side of the screen it is off ('left' or 'right'). */
  private sideOf(p: ViewAnimal['pose']): 'left' | 'right' | null {
    const { camera } = this.d;
    camera.updateMatrixWorld();
    threatAt.set(p.pos.x, p.pos.y + p.backHeight * 0.5, p.pos.z).applyMatrix4(camera.matrixWorldInverse); // in the camera's space
    const behind = threatAt.z >= 0, side = threatAt.x < 0 ? 'left' : 'right';
    if (behind) return side;
    threatAt.applyMatrix4(camera.projectionMatrix);
    return Math.abs(threatAt.x) <= IN_VIEW && Math.abs(threatAt.y) <= IN_VIEW ? null : side;
  }

  /** Hide animal `id`'s body from the camera (null: none), giving back the one hidden before. */
  private hideSelf(id: string | null): void {
    if (id === this.self) return;
    if (this.self !== null) this.d.animals.hideFromCamera(this.self, false);
    if (id !== null) this.d.animals.hideFromCamera(id, true);
    this.self = id;
  }

  /**
   * The lens of animal `id` (null: no animal is seen through), eased in or out by `dt` real seconds, into the pipeline's
   * uniforms; the ease (0..1) it now has. Another animal's lens is taken up only once the last one has eased right out.
   */
  private see(dt: number, id: string | null, at: Vec3 | undefined): number {
    const { d } = this, senses = id !== null ? d.animals.sensesOf(id) : null;
    if (senses && (this.lensIn === 0 || id === this.lensId)) {
      const level = at ? d.world.waterLevelAt(at.x, at.z) : NaN; // NaN on dry land: never under
      this.lens = lensFor(senses, d.daylight?.() ?? 1, !!at && at.y < level);
      this.lensId = id;
      if (d.lens && level === level) d.lens.surface.value = level; // the surface over the eye, for the look from under it
    }
    const on = !!senses && id === this.lensId;
    this.lensIn = Math.min(1, Math.max(0, this.lensIn + (on ? dt : -dt) / LENS_S));
    const k = smooth(this.lensIn);
    if (k === 0 && this.lensK === 0) return 0; // out, and already put in as out: nothing to do
    if (d.lens) {
      setLens(d.lens, this.lens, k);
      d.lens.seed.value = Math.floor((d.now() / 1000) * GRAIN_HZ) % 100000;
    }
    this.lensK = k;
    return k;
  }

  /**
   * The camera's near plane at `near` m with the far one brought in (Close and Eyes), or back to its own (null); its
   * width `k` of the way from its own to the lens's, then `zoom` of the way from that to Sharp eyes' 20° (the widths are
   * across, so they are turned into the camera's vertical field of view for the screen's shape now: a resize keeps it right).
   */
  private project(near: number | null, k: number, zoom: number): void {
    const { camera } = this.d, n = near ?? this.planes.near, f = near === null ? this.planes.far : CLOSE_FAR;
    let fov = this.planes.fov;
    if (k > 0 || zoom > 0) {
      const own = 2 * Math.atan(Math.tan((fov * DEG) / 2) * camera.aspect), lens = own + (this.lens.hfov * DEG - own) * k;
      const across = lens + (SHARP_FOV * DEG - lens) * zoom;
      fov = (2 * Math.atan(Math.tan(across / 2) / camera.aspect)) / DEG;
    }
    if (camera.near === n && camera.far === f && camera.fov === fov) return;
    camera.near = n;
    camera.far = f;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}
