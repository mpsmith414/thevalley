/**
 * Hearing, the sound ripples (spec section 5): who is making noise (`noisy`: running, calling, splashing, a flier taking
 * off; an animal standing still makes none), and the ripples drawn, slow rings spreading out from each one on the ground
 * (round a flier in the air), bigger for louder. One instanced mesh of flat soft rings (MAX_RIPPLES at most), additive,
 * seen through hills and trees (it is heard, not seen), on the trails' layer (the camera's only), compiled at start.
 */
import { AdditiveBlending, Color, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { cameraProjectionMatrix, cameraViewMatrix, float, instancedBufferAttribute, length, positionGeometry, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { surfaceAt, type FlyWorld } from '../camera/freefly';
import type { Doing } from '../sim/types';
import { TRAIL_LAYER } from './trail-mesh';
import type { AnimalPose } from './types';

/** An animal runs above this share of its top speed (as the simulation's `running`): from there it is heard, from RUN_QUIET to RUN_LOUD flat out. */
const RUNNING = 0.5, RUN_QUIET = 0.4, RUN_LOUD = 0.8;
/** A call is this loud (at the height of each call). */
const CALL = 0.6;
/** Running through water splashes: this many times as loud, at most SPLASH_MAX. */
const SPLASH = 1.5, SPLASH_MAX = 0.9;
/** A flier climbing faster than this (m/s) is taking off (or beating its way up): the loudest of all. */
const TAKE_OFF = 0.5;

/** What `noisy` reads of an animal: what it is doing, how fast it goes and can run (m/s), its call (0..1), and whether it flies, how fast it climbs (m/s) and whether it is in the water. */
export type Noise = { doing: Doing; speed: number; topSpeed: number; calling: number; flying: boolean; climb: number; inWater: boolean };

/**
 * How much noise an animal makes now, 0 (none) to 1: running (louder the faster), calling, splashing (running through the
 * water), and loudest, a flier taking off. Standing, strolling or gliding along aloft, none. A flier aloft is heard only
 * diving at its prey (the rush of the stoop) or climbing.
 */
export function noisy(a: Noise): number {
  if (a.flying && a.climb > TAKE_OFF) return 1;
  const frac = a.speed / Math.max(1e-6, a.topSpeed), heardRun = !a.flying || a.doing === 'dive';
  let run = heardRun && frac > RUNNING ? RUN_QUIET + (RUN_LOUD - RUN_QUIET) * Math.min(1, (frac - RUNNING) / (1 - RUNNING)) : 0;
  if (run && a.inWater) run = Math.min(SPLASH_MAX, run * SPLASH);
  return Math.max(run, CALL * Math.max(0, Math.min(1, a.calling)));
}

/** Someone heard: its pose (where the ripples spread from) and how loud it is (0..1). */
export type Sound = { id: string; pose: AnimalPose; loud: number };

/** The most rings drawn at once. */
export const MAX_RIPPLES = 192;
/** Each one heard sends out a ring every EVERY real seconds, which spreads for LIFE s (so up to PER rings at once each). */
const EVERY = 1.2, LIFE = 3, PER = Math.ceil(LIFE / EVERY);
/** A ring spreads from half the animal's size to RADIUS_MIN m plus RADIUS_LOUD m for the loudest (plus its size). */
const RADIUS_MIN = 2, RADIUS_LOUD = 8;
/** One heard eases in and out (going quiet, or out of hearing) with this time constant (s): its rings fade, never vanish. */
const TAU = 0.4;
/** The rings lie this far (m) over the ground or water; a flier this high (m) over it is aloft, and its rings spread round it in the air. */
const LIFT = 0.1, ALOFT = 1;
/** How bright a ring glows at most, in a soft pale blue (the sound's colour; the danger's is red). */
const GLOW = 0.55, SOUND = 0xb8d8f0;

/** A hash of an id, 0..1: each one heard rings out of step with the others. */
const phaseOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
};

/** The ripples: `object` goes in the scene; `frame` spreads them (`sounds`: who is heard now; null, leave them as they are). */
export type RippleMesh = {
  object: InstancedMesh;
  /** `dt` real seconds on, `t` real seconds in, the rings of `sounds` (null: those already heard), `k` of the way in (0: none drawn). */
  frame(sounds: Sound[] | null, dt: number, t: number, k: number): void;
};

/** Make the ripples, lying on `world`'s ground and water. */
export function createRippleMesh(world: FlyWorld): RippleMesh {
  const rings = new Float32Array(MAX_RIPPLES * 4), alphas = new Float32Array(MAX_RIPPLES);
  const ringA = new InstancedBufferAttribute(rings, 4), alphaA = new InstancedBufferAttribute(alphas, 1);
  const ring = instancedBufferAttribute(ringA, 'vec4') as Node<'vec4'>; // its middle (x, y, z) and radius (m)
  const alpha = instancedBufferAttribute(alphaA, 'float') as Node<'float'>;
  const glow = uniform(0);

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  material.name = 'sound-ripple';
  material.blending = AdditiveBlending;
  material.fog = false;
  const where = vec3(ring.x.add(positionGeometry.x.mul(ring.w)), ring.y, ring.z.add(positionGeometry.z.mul(ring.w)));
  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(where, 1)));
  const r = length(uv().sub(vec2(0.5)).mul(2)); // 1 at the disc's edge
  material.colorNode = uniform(new Color(SOUND));
  material.opacityNode = smoothstep(0.8, 0.95, r).mul(float(1).sub(smoothstep(0.95, 1, r))).mul(alpha).mul(glow);

  const mesh = new InstancedMesh(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material, MAX_RIPPLES); // −1..1 in x and z
  mesh.name = 'sound-ripples';
  mesh.layers.set(TRAIL_LAYER);
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.frustumCulled = false; // spread round the animal listening; the bounds are not worked out
  mesh.count = 0;
  mesh.visible = false;
  /** Everyone heard lately: where, how loud, and how far in it is now (eased after its loudness). */
  const heard = new Map<string, { pose: AnimalPose; loud: number; level: number; on: boolean }>();

  return {
    object: mesh,
    frame(sounds, dt, t, k) {
      glow.value = GLOW * k;
      if (k === 0) {
        // put right out: forget who was heard, so switching back on starts afresh (no rings from where they were then)
        heard.clear();
        mesh.count = 0;
        mesh.visible = false;
        return;
      }
      if (sounds) {
        for (const h of heard.values()) h.on = false;
        for (const s of sounds) {
          const h = heard.get(s.id);
          if (h) (h.pose = s.pose), (h.loud = s.loud), (h.on = true);
          else heard.set(s.id, { pose: s.pose, loud: s.loud, level: 0, on: true });
        }
      }
      const ease = 1 - Math.exp(-dt / TAU);
      let n = 0;
      for (const [id, h] of heard) {
        h.level += ((h.on ? h.loud : 0) - h.level) * ease;
        if (!h.on && h.level < 0.01) {
          heard.delete(id);
          continue;
        }
        const p = h.pose.pos, ground = surfaceAt(world, p.x, p.z), aloft = h.pose.flying && p.y - ground > ALOFT;
        const y = aloft ? p.y : ground + LIFT, r0 = 0.5 * h.pose.size, r1 = RADIUS_MIN + RADIUS_LOUD * h.loud + h.pose.size;
        const first = ((t / EVERY + phaseOf(id)) % 1) * EVERY;
        for (let j = 0; j < PER && n < MAX_RIPPLES; j++) {
          const age = first + j * EVERY;
          if (age >= LIFE) continue;
          const f = age / LIFE, i = n * 4;
          rings[i] = p.x;
          rings[i + 1] = y;
          rings[i + 2] = p.z;
          rings[i + 3] = r0 + (r1 - r0) * (1 - (1 - f) * (1 - f)); // spreading, slowing as it goes
          alphas[n++] = h.level * (1 - f) * Math.min(1, f * 8);
        }
      }
      mesh.count = n;
      mesh.visible = k > 0 && n > 0;
      if (!n) return;
      for (const [a, size] of [[ringA, 4], [alphaA, 1]] as const) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * size);
        a.needsUpdate = true;
      }
    },
  };
}
