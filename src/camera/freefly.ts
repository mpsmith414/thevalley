import type { PerspectiveCamera } from 'three/webgpu';
import type { PadState } from '../shared/input';
import type { Vec3 } from '../util/vec';

/**
 * What the player wants this frame. `move` is camera-relative (x right, y up, z forward), each -1..1.
 * `look` is a turn to apply: positive yaw turns left, positive pitch looks up.
 * (`intentFrom` fills it in radians for the frame; at its default dt of 1 the stick part reads as rad/s.)
 */
export type FlyIntent = { move: { x: number; y: number; z: number }; look: { yaw: number; pitch: number }; fast: boolean; toggleWalk: boolean };

/** The part of the Valley the camera needs (the real `Valley` fits). */
export type FlyWorld = {
  heightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  /** NaN on dry land. */
  waterLevelAt(x: number, z: number): number;
  trunksNear(x: number, z: number, r: number): { x: number; z: number; r: number }[];
  inside(x: number, z: number, margin?: number): boolean;
};

export const SPEED = 12, FAST = 5, WALK = 0.35, EASE = 0.25, MAX_PITCH = 1.35, MAX_Y = 600;
const EYE_FLY = 1.2, EYE_WALK = 1.6, TRUNK_GAP = 0.6, BORDER = 10;
const STICK_YAW = 1.8, STICK_PITCH = 1.2, MOUSE = 0.0022;

/** The ground, or the water surface where there is water (a NaN level means dry land). */
export function surfaceAt(w: FlyWorld, x: number, z: number): number {
  const h = w.heightAt(x, z), l = w.waterLevelAt(x, z);
  return l === l ? Math.max(h, l) : h;
}

/** Is the walk toggle (Y button or G key) down right now? Feed last frame's answer back to `intentFrom` as `wasDown`. */
export const toggleDown = (pad: PadState, held: (k: string) => boolean) => pad.y || held('g');

/**
 * Turn a pad, the held keys and the mouse movement into a `FlyIntent`.
 * Left stick or WASD moves, RT/E rises, LT/Q sinks, RB or Shift is fast, the right stick and mouse look.
 * `dt` scales the stick look (the mouse is already in radians); `wasDown` makes `toggleWalk` an edge.
 */
export function intentFrom(pad: PadState, held: (k: string) => boolean, mouse: { dx: number; dy: number }, dt = 1, wasDown = false): FlyIntent {
  const k = (key: string) => (held(key) ? 1 : 0);
  let x = pad.lx + k('d') - k('a'), z = -pad.ly + k('w') - k('s');
  const n = Math.hypot(x, z);
  if (n > 1) [x, z] = [x / n, z / n];
  const y = (pad.rt ? 1 : 0) - (pad.lt ? 1 : 0) + k('e') - k('q');
  return {
    move: { x, y: Math.max(-1, Math.min(1, y)), z },
    look: { yaw: -pad.rx * STICK_YAW * dt - mouse.dx * MOUSE, pitch: -pad.ry * STICK_PITCH * dt - mouse.dy * MOUSE },
    fast: pad.rb || held('shift'),
    toggleWalk: toggleDown(pad, held) && !wasDown,
  };
}

/** A flying camera that eases to a stop and stays out of the ground, the water, the trees and the world edge. */
export class FreeFly {
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  walk = false;
  pos: Vec3;
  yaw: number;
  pitch: number;

  constructor(pos: Vec3, yaw: number, pitch: number) {
    this.pos = { ...pos };
    this.yaw = yaw;
    this.pitch = pitch;
  }

  update(dt: number, intent: FlyIntent, world: FlyWorld): void {
    if (intent.toggleWalk) this.walk = !this.walk;
    this.yaw += intent.look.yaw;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + intent.look.pitch));

    // yaw 0 looks towards -z; positive yaw turns left
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const cp = this.walk ? 1 : Math.cos(this.pitch), sp = this.walk ? 0 : Math.sin(this.pitch);
    const { x: mx, y: my, z: mz } = intent.move;
    const speed = SPEED * (intent.fast ? FAST : 1) * (this.walk ? WALK : 1);
    const tx = (-sy * cp * mz + cy * mx) * speed;
    const ty = (sp * mz + (this.walk ? 0 : my)) * speed;
    const tz = (-cy * cp * mz - sy * mx) * speed;
    const a = 1 - Math.exp(-dt / EASE);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.y += (ty - this.vel.y) * a;
    this.vel.z += (tz - this.vel.z) * a;

    const ox = this.pos.x, oz = this.pos.z;
    let x = ox + this.vel.x * dt, z = oz + this.vel.z * dt;
    // the world edge: slide along it
    if (!world.inside(x, oz, BORDER)) { x = ox; this.vel.x = 0; }
    if (!world.inside(x, z, BORDER)) { z = oz; this.vel.z = 0; }
    // trunks
    for (let pass = 0; pass < 2; pass++) {
      for (const t of world.trunksNear(x, z, TRUNK_GAP)) {
        const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), min = t.r + TRUNK_GAP;
        if (d >= min) continue;
        const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
        x = t.x + ux * min;
        z = t.z + uz * min;
      }
    }
    if (!world.inside(x, z, BORDER)) { x = ox; z = oz; }
    this.pos.x = x;
    this.pos.z = z;

    const ground = surfaceAt(world, x, z);
    let y = this.pos.y + this.vel.y * dt;
    if (this.walk) y += (ground + EYE_WALK - y) * (1 - Math.exp(-dt / EASE));
    if (y < ground + EYE_FLY) { y = ground + EYE_FLY; if (this.vel.y < 0) this.vel.y = 0; }
    if (y > MAX_Y) { y = MAX_Y; if (this.vel.y > 0) this.vel.y = 0; }
    this.pos.y = y;
  }

  apply(camera: PerspectiveCamera): void {
    camera.position.set(this.pos.x, this.pos.y, this.pos.z);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
