/**
 * The highlight's ring: a soft glowing ring on the ground under the animal you are looking at in free flight (on the
 * water for a duck, a fainter ring in the air round a flier aloft), in the UI's creature green, breathing slowly. One flat
 * additive disc: no outline on the body (fur shells and WebGPU make outlines costly; a ring reads well from the sofa).
 * The Fear sense puts a second one, soft red, under the danger the animal is afraid of; Sharp eyes, faint pale gold ones
 * under the moving animals it spots.
 */
import { AdditiveBlending, Color, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { cameraProjectionMatrix, float, length, modelViewMatrix, positionLocal, smoothstep, uniform, uv, vec2, vec4 } from 'three/tsl';
import { surfaceAt, type FlyWorld } from '../camera/freefly';
import { groundNormal } from '../render/contact';
import type { AnimalPose } from './types';

/** The UI's creature green (the captions' hint, the start button), lifted a little to glow. */
export const GREEN = 0x8cc95a;
/** The Fear sense's soft red, for the danger. */
export const DANGER_RED = 0xe0503c;
/** Sharp eyes' pale gold shimmer, for the moving animals it spots. */
export const SHIMMER_GOLD = 0xf2dc96;
/** The ring's radius: this many times the animal's size, at least MIN_R m. */
const PER_SIZE = 0.6, MIN_R = 0.35;
/** How strongly it glows at its brightest, and how far it fades between breaths (one breath every BREATH_S s). */
const GLOW = 0.6, BREATHE = 0.35, BREATH_S = 2;
/** A flier this many body sizes above the ground or water is aloft: its ring is round it in the air, at this share of the glow. */
const ALOFT = 1, IN_AIR = 0.5;
/** It floats this far (m) over the ground or water, on top of its polygon offset, so bumps do not cut it. */
const LIFT = 0.04;
/**
 * Its depth is drawn this much nearer the camera (m, along the line of sight, so it stays where it is on the screen): a
 * meadow's grass would otherwise bury it, while the hills and anything well in front still hide it.
 */
const THROUGH = 0.8;

const UP = new Vector3(0, 1, 0), normal = new Vector3(), tilt = new Quaternion();

/**
 * The ring: `object` goes in the scene (on `layer`); `show` puts it under an animal (or takes it away), `t` real seconds in
 * for the breath, at `k` of its glow (1 if not given).
 */
export type Ring = { object: Mesh; show(a: AnimalPose | null, t: number, k?: number): void };

/**
 * Make a ring, lying in `world` (its ground, water and slopes), drawn on render layer `layer`, in `colour` (a uniform, so
 * every ring shares one pipeline).
 */
export function createRing(world: FlyWorld, layer: number, colour = GREEN): Ring {
  const geometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2); // −1..1 in x and z, facing up
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.name = 'view-ring';
  material.blending = AdditiveBlending;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -4;
  const glow = uniform(0);
  const r = length(uv().sub(vec2(0.5)).mul(2)); // 1 at the disc's edge
  // a soft band near the edge, with a faint wash inside it
  const band = smoothstep(0.55, 0.8, r).mul(float(1).sub(smoothstep(0.84, 1, r)));
  const wash = float(0.12).mul(float(1).sub(smoothstep(0.3, 0.8, r)));
  material.colorNode = uniform(new Color(colour));
  material.opacityNode = band.add(wash).mul(glow);
  const view = modelViewMatrix.mul(vec4(positionLocal, 1)).xyz;
  const nearer = float(1).sub(float(THROUGH).div(length(view))).max(0.05); // never past the camera
  material.vertexNode = cameraProjectionMatrix.mul(vec4(view.mul(nearer), 1));
  const mesh = new Mesh(geometry, material);
  mesh.name = 'view-ring';
  mesh.layers.set(layer);
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.visible = false;
  return {
    object: mesh,
    show(a, t, k = 1) {
      mesh.visible = !!a;
      if (!a) return;
      const { x, z } = a.pos, rad = Math.max(MIN_R, PER_SIZE * a.size), ground = surfaceAt(world, x, z);
      const aloft = a.flying && a.pos.y - ground > ALOFT * a.size;
      const wet = world.isWater(x, z);
      if (aloft || wet) normal.copy(UP);
      else groundNormal((px, pz) => world.heightAt(px, pz), x, z, rad, normal);
      mesh.quaternion.copy(tilt.setFromUnitVectors(UP, normal));
      mesh.position.set(x, aloft ? a.pos.y + a.backHeight * 0.5 : ground + LIFT, z);
      mesh.scale.setScalar(rad);
      const breath = 1 - BREATHE * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / BREATH_S));
      glow.value = GLOW * breath * (aloft ? IN_AIR : 1) * k;
    },
  };
}
