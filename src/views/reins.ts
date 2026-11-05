/**
 * Taking the reins, the screen's side of it (spec section 7): the player's stick turned into the simulation's steering
 * (`steerFrom`), the Do press held until a tick of the simulation has seen it (`DoLatch`), and the clock held at Normal,
 * unpaused, while the player steers (`ReinsClock`). Pure: the wiring hands the answers to the simulation and the clock.
 */
import type { SteerInput } from '../sim/types';
import { DEFAULT_SPEED, type ValleyClock } from '../world/clock';

/** A stick pushed less than this (0..1) is at rest, as the simulation's own: the animal stands, and run alone does not move it. */
const AT_REST = 0.05;

/**
 * The steering for a stick pushed `stick` (x right, y up, each −1..1) with the camera turned `cameraYaw` (the free-fly
 * convention: yaw 0 faces −z, positive turns left): it goes the way pushed as the camera sees it (up is where the camera
 * looks, right is its right), as fast as pushed (at most 1: up to a walk; `run` held, flat out), flying up, down or
 * neither (`fly`), with Do down or not (`act`). The heading comes back in the simulation's convention (`atan2(dx, dz)`).
 * With the stick at rest it stands, facing `heading` (its own heading now; the camera's way if not given).
 */
export function steerFrom(stick: { x: number; y: number }, cameraYaw: number, run: boolean, fly: -1 | 0 | 1, act: boolean, heading?: number): SteerInput {
  const s = Math.sin(cameraYaw), c = Math.cos(cameraYaw), speed = Math.min(1, Math.hypot(stick.x, stick.y));
  if (speed < AT_REST) return { yaw: heading ?? Math.atan2(-s, -c), speed: 0, run: false, fly, act };
  // the camera's forward is (−sin, −cos) and its right (cos, −sin), on the ground
  const dx = -s * stick.y + c * stick.x, dz = -c * stick.y - s * stick.x;
  return { yaw: Math.atan2(dx, dz), speed, run, fly, act };
}

/**
 * The Do button, held down in the steering until the simulation has ticked with it: the steering is sent every frame and
 * the simulation ticks every 0.1 animal s, so a press seen for one frame could fall between ticks and be lost. `press` when
 * the button goes down; `at` each frame says whether it is down in the steering sent now, at animal time `time`: from the
 * first frame it is sent until the animal time has moved on past it (a tick has seen it).
 */
export class DoLatch {
  private down = false;
  /** The animal time the press was first sent at, or null before it is sent. */
  private sent: number | null = null;

  press(): void {
    this.down = true;
    this.sent = null;
  }

  at(time: number): boolean {
    if (this.down && this.sent !== null && time > this.sent) (this.down = false), (this.sent = null);
    else if (this.down && this.sent === null) this.sent = time;
    return this.down;
  }

  /** Forget a press (the reins taken or handed back). */
  clear(): void {
    this.down = false;
    this.sent = null;
  }
}

/**
 * The clock while the player steers: `take` remembers the player's speed (the first time only) and runs the valley at
 * Normal, unpaused, as an arrival does; `give` puts the player's speed back, unless a speed was picked meanwhile (the clock
 * is no longer at Normal, or `playerChanged` said so): then theirs stands. While it holds, the time keys only say why.
 */
export class ReinsClock {
  private was: { speed: number; paused: boolean } | null = null;

  take(clock: Pick<ValleyClock, 'speed' | 'paused'>): void {
    if (this.was) return;
    this.was = { speed: clock.speed, paused: clock.paused };
    clock.paused = false;
    clock.speed = DEFAULT_SPEED;
  }

  give(clock: Pick<ValleyClock, 'speed' | 'paused'>): void {
    const was = this.was;
    this.was = null;
    if (!was || clock.paused || clock.speed !== DEFAULT_SPEED) return; // nothing held, or a speed picked meanwhile
    clock.speed = was.speed;
    clock.paused = was.paused;
  }

  /** The player picked a speed: it stands, so `give` restores nothing. */
  playerChanged(): void {
    this.was = null;
  }

  get held(): boolean {
    return this.was !== null;
  }

  /** What `give` would put back (for the save: the player's speed, not the reins'); null when nothing is held. */
  get remembered(): { speed: number; paused: boolean } | null {
    return this.was && { ...this.was };
  }
}
