/**
 * The camera, one frame at a time: free flight (and the glides to a viewpoint, a release framing or a caption's animal),
 * the arrival's camera for a released family (glide, push-in, then a chase behind the lead), and the views' turn once the
 * animals have moved (`ride`: Follow, Close, Eyes, the map). `main.ts` builds it and calls `drive` and `ride` each frame.
 */
import type { PerspectiveCamera } from 'three/webgpu';
import { FreeFly, intentFrom, surfaceAt, toggleDown, type FlyIntent } from '../camera/freefly';
import { Glide, viewpointPose } from '../camera/viewpoints';
import { ArrivalHold, PUSH } from '../bring/arrival-hold';
import { pushView, type ArrivalShot } from '../bring/arrival';
import { showTitle } from '../bring/welcome';
import type { Input } from '../shared/input';
import type { Residents } from '../residents/residents';
import type { Valley } from '../valley/valley';
import type { Viewpoint } from '../valley/types';
import { FollowCam } from '../views/follow';
import type { MapView } from '../views/map-view';
import type { Pose } from '../views/types';
import type { Views } from '../views/views';
import type { ViewsWire, WireHands } from '../views/wire';
import { GROUND_COVER_LAYER } from '../plants/grass';
import { NEAR_LAYER } from '../world/tiles';
import { showLabel } from './menu';
import type { ReleaseTimeHold } from './time';

/** The overview map's own light and trims follow how far up it is, by at most a whole step in this long (s): a map let go of up there fades out, never snaps. */
const MAP_LIFT_S = 0.5;
/** While the map is this far up, what it cannot see from there is not drawn (the ground cover, the near plants, the contact shadows). */
const MAP_TRIM_AT = 0.5;
/** No input: the camera eases to a stop while the menu has the controls. */
const STILL: FlyIntent = { move: { x: 0, y: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, fast: false, toggleWalk: false };

/** What the camera needs from the valley's wiring: the ground, the camera, the animals, the views, and the state of the screen. */
export type CameraDriveDeps = {
  valley: Valley;
  camera: PerspectiveCamera;
  residents: Residents;
  viewer: Views;
  wire: ViewsWire;
  mapView: MapView;
  input: Input;
  timeHold: ReleaseTimeHold;
  ui: HTMLElement;
  /** Where the camera starts. */
  start: Pose;
  /** The valley's viewpoints (1-8). */
  viewpoints: Viewpoint[];
  /** The start screen is still up: the controls wait for it. */
  waiting(): boolean;
  /** The menu or the workshop has the screen: the camera holds still behind it. */
  open(): boolean;
  /** How fast the animals live now (none when the clock is paused). */
  rate(): number;
  /** The chime for the first of an arriving family coming into the picture. */
  chime(): void;
  /**
   * The documentary's hold on the player's hands (see `Handover`): told whether the sticks or the mouse moved this frame,
   * true when they go nowhere else (it is running, or has just been taken over).
   */
  hands?(any: boolean): boolean;
  /** A glide the player asked for begins (a viewpoint, Fly there, Visit): the documentary ends first, so it has the camera. */
  playerGlide?(): void;
};

/** The camera (see the file's note). */
export function createCameraDrive(d: CameraDriveDeps) {
  const { valley, camera, residents, viewer, wire, mapView, input, timeHold, ui, viewpoints: views } = d;
  const fly = new FreeFly(d.start.pos, d.start.yaw, d.start.pitch);
  let current = views.length - 1; // the viewpoint we are at or flying to
  /** A glide under way: to a viewpoint (its name shows on arrival) or to a release framing (`done` once there or taken over). */
  let glide: { g: Glide; t: number; label: string | null; done?: (arrived: boolean) => void } | null = null;
  /** The glide is over (`arrived`, or taken over or replaced): tell whoever waits for it. */
  const endGlide = (arrived = false) => {
    const done = glide?.done;
    glide = null;
    done?.(arrived);
  };
  let wasToggle = false;
  /** The arrival's welcome title, shown with the chime once the first of the family is in the picture (arrival v2). */
  let title: string | null = null;
  /** The camera's hold on an arrival (Ruling R6; glide, push-in, follow); the next phone's turn waits for it (Ruling R17). */
  const arrival = new ArrivalHold({ onSeen: (since) => {
    console.info(`arrival: the first of the family is in the picture ${since.toFixed(1)} s after the glide`);
    d.chime();
    if (title) showTitle(ui, title);
    title = null;
  } });
  const setPose = (p: { pos: { x: number; y: number; z: number }; yaw: number; pitch: number }) => {
    fly.pos = { ...p.pos };
    fly.yaw = p.yaw;
    fly.pitch = p.pitch;
    fly.vel = { x: 0, y: 0, z: 0 };
  };
  /** The player's hands for the views this frame (set by `drive`, used by `ride` once the animals have moved). */
  let hands: WireHands = { look: { yaw: 0, pitch: 0 }, zoom: 0, moved: false, any: false };
  /** Viewpoint number `n` (1-8, wrapping) as an index. */
  const index = (n: number) => (((Math.round(n) - 1) % views.length) + views.length) % views.length;
  /** Glide to viewpoint `n` (1-8). */
  const goTo = (n: number) => {
    d.playerGlide?.();
    current = index(n);
    fly.walk = false; // a viewpoint is up in the air, so don't drop back to walking height on arrival
    viewer.letGo();
    endGlide();
    arrival.end();
    glide = { g: new Glide(fly, views[current], valley), t: 0, label: views[current].name };
    return views[current].name;
  };
  /** Jump straight to viewpoint `n` (1-8): eye and target are metres above the ground (or the water). */
  const view = (n: number) => {
    d.playerGlide?.();
    current = index(n);
    fly.walk = false;
    viewer.letGo();
    endGlide();
    arrival.end();
    setPose(viewpointPose(views[current], valley));
    fly.apply(camera);
    return views[current].name;
  };
  fly.apply(camera);

  // ---------- the release camera (spec §3.4, arrival v2): a glide to a wide, clear framing, a push-in while the family
  // walks in, then a chase camera behind the lead as the family walks on into the valley ----------
  /** Seconds of camera time (the drive's own clock, so `step` moves it too), and when the last release glide ended. */
  let camTime = 0, arrivedAt = 0;
  /** The arrival's framings, and its chase camera once the follow starts. */
  let shot: ArrivalShot | null = null, follow: FollowCam | null = null;
  /** Glide to a framing (no label on arrival; a lock lets go); resolves once there, or when the player takes the camera (or another glide starts). */
  const glideTo = (v: Viewpoint) => new Promise<void>((done) => {
    viewer.letGo();
    endGlide();
    arrival.end();
    fly.walk = false;
    glide = { g: new Glide(fly, v, valley), t: 0, label: null, done: () => ((arrivedAt = camTime), done()) };
  });
  /** Glide to a framing and call `done` on arriving (not if the player takes the camera). */
  const flyTo = (v: Viewpoint, done: (arrived: boolean) => void) => {
    d.playerGlide?.();
    endGlide();
    arrival.end();
    fly.walk = false;
    glide = { g: new Glide(fly, v, valley), t: 0, label: null, done };
  };
  /** An arrival begins: the glide to its wide framing (its first phase). */
  const arriveAt = (id: string, s: ArrivalShot) => {
    viewer.letGo(); // the arrival is the family's moment: a lock ends (the reins handed back first)
    timeHold.hold(); // an arrival plays at Normal speed
    const there = glideTo(s.wide);
    arrival.begin(id);
    shot = s;
    follow = null;
    title = null;
    return there;
  };
  /** The family is in: push in and follow (not if the player took the camera, or another glide replaced this one). */
  const holdFor = (id: string, text: string) => {
    if (glide || !arrival.start(id, camTime - arrivedAt)) return;
    title = text;
  };
  /** A family that could not come: its arrival ends (the camera and the next turn go free). */
  const cancelArrival = (id: string) => {
    if (arrival.id === id) arrival.end();
  };
  /** The lead of family `id` (the first of it, the one the others walk on behind). */
  const lead = (id: string) => residents.familyOf(id)[0];
  const look = {
    /** Is one of family `id` in the picture (by the residents' update bands)? */
    inView: (id: string) => residents.familyOf(id).some((a) => a.band !== 'paused'),
    /** Has its lead reached its spot (walking on, or living its life)? */
    onward: (id: string) => {
      const a = lead(id);
      return !!a && residents.arriving(a) !== 'in';
    },
  };

  /** One frame of camera control: gamepad and keys in, a glide or a free-fly step out (camera input waits while the menu is open). */
  const drive = (dt: number) => {
    const open = d.open(); // the camera holds still behind the menu and the workshop
    input.poll(dt, open);
    if (d.waiting()) return;
    const pad = input.pad(), held = (k: string) => input.held(k);
    let mouse = input.mouse(), intent = open ? STILL : intentFrom(pad, held, mouse, dt, wasToggle);
    wasToggle = toggleDown(pad, held);
    camTime += dt;
    let sticks = pad.lx !== 0 || pad.ly !== 0 || pad.rx !== 0 || pad.ry !== 0 || ['w', 'a', 's', 'd'].some(held);
    // while the documentary runs the hands are its: any move takes over, and is used up doing it (not flown, not steered)
    const touched = sticks || mouse.dx !== 0 || mouse.dy !== 0 || intent.move.y !== 0 || intent.look.yaw !== 0 || intent.look.pitch !== 0;
    if (d.hands?.(!open && touched)) {
      intent = STILL;
      sticks = false;
      mouse = { dx: 0, dy: 0 };
    }
    // the views' hands: the look orbits or looks round, RT / LT (E / Q) nearer and farther, the left stick (WASD) lets go;
    // with the reins, the left stick steers, RB (Shift) runs and RT / LT fly up and down
    const moved = intent.move.x !== 0 || intent.move.z !== 0, zoom = intent.move.y;
    hands = {
      look: intent.look, zoom, moved, any: moved || zoom !== 0 || intent.look.yaw !== 0 || intent.look.pitch !== 0,
      stick: { x: intent.move.x, y: intent.move.z }, run: intent.fast,
    };
    // the arrival's clock and phases run from its glide's start; the stick or the mouse ends it at once, from any phase
    const taken = !open && (sticks || mouse.dx !== 0 || mouse.dy !== 0);
    const phase = arrival.active ? arrival.frame(dt, look, taken) : null;
    if (!phase) follow = null;
    if (glide) {
      if (open || !sticks) {
        glide.t += dt;
        const s = glide.g.sample(glide.t);
        setPose(s);
        if (s.done) {
          const { label } = glide;
          endGlide(true);
          if (label && !open) showLabel(ui, label); // arrived (no label over the menu)
        }
        fly.apply(camera);
        return;
      }
      endGlide(); // the camera stays where the glide left it
    }
    // the arrival after its glide: still while the family compiles, then the push-in, then the chase behind the lead
    if (phase) {
      const id = arrival.id!, a = lead(id);
      if (phase === 'push' && shot) setPose(viewpointPose(pushView(shot, arrival.time / PUSH), valley));
      else if (phase === 'follow' && a) {
        const p = a.obj.root.position, target = { x: p.x, y: p.y, z: p.z };
        if (!follow) {
          const c = shot?.close.look ?? { x: p.x, z: p.z };
          follow = new FollowCam(fly.pos, { x: c.x, y: surfaceAt(valley, c.x, c.z) + 1, z: c.z }, target, a.recipe.life.sizeM);
        }
        setPose(follow.update(dt, target, valley));
      } else if (phase === 'follow') arrival.end(); // the family has gone (sent exploring): nothing to follow
      fly.vel = { x: 0, y: 0, z: 0 };
      fly.apply(camera);
      return;
    }
    if (viewer.state.mode !== 'free') return; // the views have the camera (see `ride`, once the animals have moved)
    fly.update(dt, intent, valley);
    fly.apply(camera);
  };
  /** How far the overview map's own light is in (0..1; see MAP_LIFT_S). */
  let mapLift = 0;
  /**
   * The views' turn, after the animals have moved this frame (so Close and Eyes ride where the animal is now, not where
   * it was): their pose for the camera, or free flight keeps it; the highlight only in free flight with nothing else
   * holding the camera (a glide, an arrival, the menu, the workshop).
   */
  const ride = (dt: number) => {
    if (d.waiting()) return;
    const aiming = !glide && !arrival.active && !d.open();
    const pose: Pose | null = wire.frame(dt, hands, fly, d.rate(), aiming);
    if (pose) {
      setPose(pose);
      fly.apply(camera);
      camera.rotation.z = pose.roll ?? 0; // a flier's bank (Close)
    }
    mapView.draw(); // the map's marks, where the camera now is
    mapLift += Math.max(-dt / MAP_LIFT_S, Math.min(dt / MAP_LIFT_S, viewer.mapIn - mapLift));
    trim(mapLift > MAP_TRIM_AT);
  };
  /** While the map is up, what it cannot see from up there is not drawn: the ground cover, the near plants, the animals' contact shadows. */
  let trimmed = false;
  const trim = (on: boolean) => {
    if (on === trimmed) return;
    trimmed = on;
    for (const l of [GROUND_COVER_LAYER, NEAR_LAYER]) {
      if (on) camera.layers.disable(l);
      else camera.layers.enable(l);
    }
    residents.shadows.visible = !on;
  };

  return {
    fly, arrival, goTo, view, drive, ride, flyTo, arriveAt, holdFor, cancelArrival, endGlide,
    /** Glide to a framing the player asked for (the menu's Visit), resolving once there or taken over (see `flyTo`). */
    glideTo: (v: Viewpoint) => (d.playerGlide?.(), glideTo(v)),
    /** Glide to the viewpoint before (`-1`) or after (`1`) the one we are at. */
    neighbour: (dir: 1 | -1) => goTo(current + 1 + dir),
    /** How far up the overview map is (0..1), for its own light. */
    mapLift: () => mapLift,
  };
}
/** The camera's drive (see `createCameraDrive`). */
export type CameraDrive = ReturnType<typeof createCameraDrive>;
