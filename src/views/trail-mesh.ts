/**
 * The scent trails drawn (the Smell sense): soft glowing wisps a little above the ground (0.3–0.6 m) along the trails an
 * animal smells, each coloured by what it means to it (see `trailColour`), drifting downwind as they age and fading out
 * by 2 valley hours. A few more wisps fill the gap between two points of a trail, so it reads as a line, not dots. One
 * instanced mesh of camera-facing soft discs (MAX_WISPS at most), additive: no shadows, and on a layer of its own that the
 * lake's mirror and the shadow cascades never draw, compiled at start with the rings.
 */
import { AdditiveBlending, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry, Vector2 } from 'three/webgpu';
import {
  cameraProjectionMatrix, cameraViewMatrix, cos, exp, float, instancedBufferAttribute, length, positionGeometry, sin,
  smoothstep, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { surfaceAt, type FlyWorld } from '../camera/freefly';
import type { WindUniforms } from '../plants/wind';
import { trailColour, type Scent, type Scents } from './trails';

/** The render layer the trails draw on: the camera's only (the mirror's and the cascades' masks leave it out). */
export const TRAIL_LAYER = 8;
/** The most wisps drawn at once. */
export const MAX_WISPS = 4000;
/** A wisp floats this high (m) over the ground or water, somewhere between the two. */
const LOW = 0.3, HIGH = 0.6;
/** Between two points of a trail, a wisp about every SPACING m (at most MAX_FILL to a gap). */
const SPACING = 0.9, MAX_FILL = 10;
/** Two points are next to each other on a trail if they were left within this long of each other (animal s; a point every 2). */
const JOIN_S = 5;
/** How long a scent lasts (animal s): 2 valley hours, as the store keeps it. */
const KEEP = 120;
/** A fresh wisp's radius (m); by the end of its life it has spread by this share more. */
const R0 = 0.28, SPREAD = 0.8;
/** It drifts downwind this far per animal second of its age at full strength (plus CALM's worth in still air): about 4 m by the end. */
const DRIFT = 0.03, CALM = 0.3;
/** Each wisp sways this far (m) across and bobs this far up and down, slowly, out of step with the others. */
const SWAY = 0.15, BOB = 0.05;
/** How bright the wisps glow at most. */
const GLOW = 0.8;
/** They fade out from this share of the smell's range to its edge, and from NEAR_IN to NEAR_OUT m in front of the camera (none in your face). */
const EDGE = 0.8, NEAR_IN = 1, NEAR_OUT = 4;

/** A hash of a wisp's place on its trail, 0..1: the same wisp gets the same height and sway each time the trails are laid. */
const seedOf = (x: number, z: number, j: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + j * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Where the wisps go along `pts` (each trail oldest first), at most `max`: every point of every trail first, then the
 * wisps that fill the gaps between them, so at the cap it is the fill that thins and no trail is cut. Each is handed to
 * `put` with its number, where it is, its place in its gap (`j`, 0 for a point itself), its age and the point it belongs
 * to. Returns how many.
 */
export function layWisps(pts: readonly Scent[], max: number, put: (n: number, x: number, z: number, j: number, age: number, p: Scent) => void): number {
  let n = 0;
  for (let k = 0; k < pts.length && n < max; k++) put(n++, pts[k].x, pts[k].z, 0, pts[k].age, pts[k]);
  for (let k = 1; k < pts.length && n < max; k++) {
    const p = pts[k], q = pts[k - 1];
    // the gap back to the point before on the same trail (each trail comes oldest first)
    if (q.id !== p.id || q.age - p.age > JOIN_S) continue;
    const gaps = Math.min(MAX_FILL, Math.max(1, Math.round(Math.hypot(p.x - q.x, p.z - q.z) / SPACING)));
    for (let j = 1; j < gaps && n < max; j++) {
      const f = j / gaps;
      put(n++, q.x + (p.x - q.x) * f, q.z + (p.z - q.z) * f, j, q.age + (p.age - q.age) * f, p);
    }
  }
  return n;
}

/** The trails: `object` goes in the scene; `lay` puts the wisps where an animal's scent is, `frame` ages and shows them. */
export type TrailMesh = {
  object: InstancedMesh;
  /** Lay the wisps for what an animal smells (`s`), at animal time `now` (s). */
  lay(s: Scents, now: number): void;
  /** At animal time `now` (s), the wisps `k` of the way in (0: none drawn). */
  frame(now: number, k: number): void;
};

/** Make the trails, over `world`'s ground and water, swaying in the valley's wind (`wind`, its shared uniforms). */
export function createTrailMesh(world: FlyWorld, wind: WindUniforms): TrailMesh {
  const wisps = new Float32Array(MAX_WISPS * 4), tints = new Float32Array(MAX_WISPS * 4);
  const wispA = new InstancedBufferAttribute(wisps, 4), tintA = new InstancedBufferAttribute(tints, 4);
  const wisp = instancedBufferAttribute(wispA, 'vec4') as Node<'vec4'>; // where (x, y, z), and its age when laid (animal s)
  const tint = instancedBufferAttribute(tintA, 'vec4') as Node<'vec4'>; // its colour, and its seed
  const since = uniform(0), glow = uniform(0), at = uniform(new Vector2()), range = uniform(1);

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.name = 'scent-trail';
  material.blending = AdditiveBlending;
  material.fog = false;
  const age = wisp.w.add(since), life = age.div(KEEP).clamp(0, 1), phase = tint.w.mul(2 * Math.PI);
  const downwind = vec3(wind.dir.x, 0, wind.dir.y).mul(age.mul(DRIFT).mul(wind.strength.add(CALM)));
  const sway = vec3(sin(wind.time.mul(0.6).add(phase)).mul(SWAY), sin(wind.time.mul(0.9).add(phase.mul(2))).mul(BOB), cos(wind.time.mul(0.5).add(phase)).mul(SWAY));
  const where = wisp.xyz.add(downwind).add(sway);
  const centre = cameraViewMatrix.mul(vec4(where, 1)).xyz;
  material.vertexNode = cameraProjectionMatrix.mul(vec4(centre.add(vec3(positionGeometry.xy.mul(life.mul(SPREAD).add(1).mul(R0)), 0)), 1));
  const fresh = float(1).sub(life), edge = float(1).sub(smoothstep(range.mul(EDGE), range, length(where.xz.sub(at))));
  const fade = varying(fresh.mul(fresh).mul(edge).mul(smoothstep(NEAR_IN, NEAR_OUT, centre.z.negate())), 'vScent');
  const r = length(uv().sub(vec2(0.5)).mul(2)); // 1 at the disc's edge
  material.colorNode = tint.rgb;
  material.opacityNode = exp(r.mul(r).mul(-3)).mul(float(1).sub(smoothstep(0.7, 1, r))).mul(fade).mul(glow);

  const mesh = new InstancedMesh(new PlaneGeometry(2, 2), material, MAX_WISPS); // −1..1, turned to the camera by the shader
  mesh.name = 'scent-trails';
  mesh.layers.set(TRAIL_LAYER);
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.frustumCulled = false; // laid round the animal; the bounds are not worked out
  mesh.count = 0;
  mesh.visible = false;
  let laidAt = 0;

  /** Wisp `n` at (x, z) on its trail (`j`: its place in a gap, 0 for the point itself), `age` animal s old, in the colour of what point `p` means. */
  const put = (n: number, x: number, z: number, j: number, age: number, p: Scent) => {
    const seed = seedOf(x, z, j), i = n * 4, c = trailColour(p.meaning);
    wisps[i] = x;
    wisps[i + 1] = surfaceAt(world, x, z) + LOW + (HIGH - LOW) * seedOf(z, x, j + 1);
    wisps[i + 2] = z;
    wisps[i + 3] = age;
    tints[i] = c[0];
    tints[i + 1] = c[1];
    tints[i + 2] = c[2];
    tints[i + 3] = seed;
  };

  return {
    object: mesh,
    lay(s, now) {
      const n = layWisps(s.points, MAX_WISPS, put);
      mesh.count = n;
      if (n) for (const a of [wispA, tintA]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
      at.value.set(s.at.x, s.at.z);
      range.value = s.range;
      laidAt = now;
    },
    frame(now, k) {
      mesh.visible = k > 0 && mesh.count > 0;
      since.value = now - laidAt;
      glow.value = GLOW * k;
    },
  };
}
