/**
 * The mid/far cross-fade of the trees. Over the 10 m before `midTree`, each tree's impostor dithers in as its mid mesh
 * dithers out, pixel for pixel: a screen-space 4 × 4 Bayer threshold `b`, and the impostor's share `f` of the tree (by the
 * distance from the camera to the tree's base) give the pixel to the impostor where `b < f` and to the mid tree where
 * `b >= f`, so the two never both draw a pixel nor both leave one. CPU twins of the shader helpers are here for testing.
 */
import { Vector3, type Node } from 'three/webgpu';
import { abs, clamp, floor, mod, uniform } from 'three/tsl';
import type { WorldQuality } from '../world/quality';

/** Metres over which a tree cross-fades from its mid mesh to its impostor, ending at `midTree`. */
export const FADE = 10;

/**
 * The impostor's share (0..1) of a tree `distance` metres from the camera: 0 before `midTree − FADE`, 1 from `midTree`.
 * CPU twin of `farFadeNode` below (used by the mid leaves' mask, the mid bark's fold and the impostors): change them together.
 */
export const farFade = (distance: number, q: Pick<WorldQuality, 'midTree'>): number =>
  Math.min(1, Math.max(0, (distance - (q.midTree - FADE)) / FADE));

/** The 2 × 2 Bayer index of bits (a, b): 0, 2 / 3, 1. */
const m2 = (a: number, b: number) => 2 * Math.abs(a - b) + b;
/** The ordered-dither threshold (0..1) of the pixel at (x, y): one of 16 levels, repeating every 4 pixels. */
export function bayer4(x: number, y: number): number {
  const cx = Math.floor(x), cy = Math.floor(y);
  return (4 * m2(cx & 1, cy & 1) + m2((cx >> 1) & 1, (cy >> 1) & 1) + 0.5) / 16;
}

/** TSL twin of `bayer4`, for a pixel coordinate (e.g. `screenCoordinate`). */
export function bayer4Node(p: Node<'vec2'>): Node<'float'> {
  const c = floor(p), lo = mod(c, 2), hi = floor(mod(c, 4).mul(0.5));
  const n2 = (v: Node<'vec2'>) => abs(v.x.sub(v.y)).mul(2).add(v.y);
  return n2(lo).mul(4).add(n2(hi)).add(0.5).div(16) as Node<'float'>;
}

/**
 * What the cross-fade reads: the main camera's position (set each frame; the shadow cascades and the lake's mirror fade by
 * the main camera's distance too, so they agree with what is seen) and where the fade starts (`midTree − FADE`).
 */
export type TreeFade = { eye: Node<'vec3'> & { value: Vector3 }; start: Node<'float'> & { value: number } };

export const treeFade = (q: Pick<WorldQuality, 'midTree'>): TreeFade => ({
  eye: uniform(new Vector3()) as TreeFade['eye'],
  start: uniform(q.midTree - FADE) as TreeFade['start'],
});

/** TSL twin of `farFade`, for a tree whose base is at `base` (world). */
export const farFadeNode = (f: TreeFade, base: Node<'vec3'>): Node<'float'> =>
  clamp(base.sub(f.eye).length().sub(f.start).div(FADE), 0, 1) as Node<'float'>;
