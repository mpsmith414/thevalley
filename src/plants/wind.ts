/**
 * The Valley's wind: one slowly wandering breeze (strength and direction) and a field of gusts rolling across the valley
 * along it. `gustAt` (CPU) and `windNodes(…).gust` (TSL) are twins: the same lattice, the same integer hash, the same blend.
 */
import { Vector2, type Node } from 'three/webgpu';
import { Fn, bitAnd, bitOr, bitXor, float, floor, fract, int, mix, shiftLeft, shiftRight, sin, smoothstep, uint, uniform, vec2, vec3 } from 'three/tsl';

/**
 * The wind now: unit direction (x, z), strength 0..1, seconds it has blown, and how far (m) the gust field has travelled
 * along it (wrapped to the field's period, so it never grows without bound).
 */
export type WindState = { dirX: number; dirZ: number; strength: number; time: number; offX: number; offZ: number };

/** Metres per lattice cell of the gust field, and the speed (m/s) gusts roll downwind. */
export const GUST_SCALE = 70, GUST_SPEED = 6;
/**
 * The lattice repeats every `PERIOD` cells (the hash takes 8 bits per axis), so the travelled offset wraps at PERIOD·GUST_SCALE
 * m. Both octaves repeat over that wrap: the second runs at `OCTAVE2` times the first's frequency, a whole number, so it fits
 * `OCTAVE2·PERIOD` cells in the same length (a fractional lacunarity such as 2.07 would jump at the wrap).
 */
const PERIOD = 256, OCTAVE2 = 2;
export const WRAP = PERIOD * GUST_SCALE;
/** Strength wanders in 0.25–0.7; the direction within ±25° of west→east (+x). Seconds per step of each wander's noise. */
const S_MIN = 0.25, S_MAX = 0.7, SPREAD = (25 * Math.PI) / 180, S_PERIOD = 45, A_PERIOD = 70;

/** A calm start: a moderate breeze blowing west → east. */
export const createWind = (): WindState => ({ dirX: 1, dirZ: 0, strength: (S_MIN + S_MAX) / 2, time: 0, offX: 0, offZ: 0 });

/** 32-bit integer hash (lowbias32, after Chris Wellons). */
function h32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
/** Lattice value in [0, 1) at cell (i, j), from 24 bits of the hash (exact in float32, so the GPU agrees). */
const lattice = (i: number, j: number) => (h32((i & 255) | ((j & 255) << 8)) >>> 8) / 16777216;
const sstep = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1) on the lattice. */
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), u = sstep(x - ix), v = sstep(y - iy);
  const a = lattice(ix, iy), b = lattice(ix + 1, iy), c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Smooth 1D noise in [0, 1) over seconds, for the slow wander. */
function wander(seed: number, t: number): number {
  const i = Math.floor(t), f = sstep(t - i), k = Math.imul(seed, 0x9e3779b1);
  const a = (h32(k ^ i) >>> 8) / 16777216, b = (h32(k ^ (i + 1)) >>> 8) / 16777216;
  return a + (b - a) * f;
}

/** Two octaves of value noise, sharpened into calm patches and gusts (0..1). Shared formula: see `gustNode`. */
function gustField(px: number, py: number): number {
  const n = 0.65 * valueNoise(px, py) + 0.35 * valueNoise(px * OCTAVE2 + 17.3, py * OCTAVE2 + 5.9);
  const t = Math.min(1, Math.max(0, (n - 0.2) / 0.6));
  return t * t * (3 - 2 * t);
}

/**
 * Advance the wind by `dt` seconds: strength and direction wander slowly (seeded, so the same seed gives the same weather),
 * and the gust field travels on downwind at `GUST_SPEED`.
 */
export function updateWind(w: WindState, dt: number, seed: number): void {
  w.time += dt;
  w.strength = S_MIN + (S_MAX - S_MIN) * wander(seed, w.time / S_PERIOD);
  const a = SPREAD * (2 * wander(seed + 0x51ed, w.time / A_PERIOD) - 1);
  w.dirX = Math.cos(a);
  w.dirZ = Math.sin(a);
  w.offX = (((w.offX + w.dirX * GUST_SPEED * dt) % WRAP) + WRAP) % WRAP;
  w.offZ = (((w.offZ + w.dirZ * GUST_SPEED * dt) % WRAP) + WRAP) % WRAP;
}

/** How gusty it is at (x, z), 0..1: the noise n((x, z) − travelled)/70, rolling downwind at 6 m/s. */
export const gustAt = (w: WindState, x: number, z: number): number => gustField((x - w.offX) / GUST_SCALE, (z - w.offZ) / GUST_SCALE);

// ---------- the GPU twin ----------

/** What the shaders read: the wind's direction, strength, time and the gust field's travelled offset. */
export type WindUniforms = {
  dir: Node<'vec2'> & { value: Vector2 };
  strength: Node<'float'> & { value: number };
  time: Node<'float'> & { value: number };
  off: Node<'vec2'> & { value: Vector2 };
};

export const windUniforms = (): WindUniforms => ({
  dir: uniform(new Vector2(1, 0)) as WindUniforms['dir'],
  strength: uniform(0.5) as WindUniforms['strength'],
  time: uniform(0) as WindUniforms['time'],
  off: uniform(new Vector2()) as WindUniforms['off'],
});

/** Copy the wind into its uniforms (once a frame). */
export function setWind(u: WindUniforms, w: WindState): void {
  u.dir.value.set(w.dirX, w.dirZ);
  u.strength.value = w.strength;
  u.time.value = w.time;
  u.off.value.set(w.offX, w.offZ);
}

const U = (n: number) => uint(n);
/** TSL twin of `h32` (lowbias32); also the ground cover's rendering-only lattice hash. */
export const h32Node = (x0: Node<'uint'>) => {
  let x = bitXor(x0, shiftRight(x0, U(16))).mul(U(0x7feb352d));
  x = bitXor(x, shiftRight(x, U(15))).mul(U(0x846ca68b));
  return bitXor(x, shiftRight(x, U(16))) as Node<'uint'>;
};
/** TSL twin of `lattice` (`i`, `j` are whole-number floats). */
const latticeNode = (i: Node<'float'>, j: Node<'float'>) => {
  const key = bitOr(uint(bitAnd(int(i), int(255))), shiftLeft(uint(bitAnd(int(j), int(255))), U(8)));
  return float(shiftRight(h32Node(key as Node<'uint'>), U(8))).div(16777216);
};
const valueNoiseNode = (p: Node<'vec2'>) => {
  const i = floor(p), f = fract(p), s = f.mul(f).mul(vec2(3).sub(f.mul(2)));
  const a = latticeNode(i.x, i.y), b = latticeNode(i.x.add(1), i.y), c = latticeNode(i.x, i.y.add(1)), d = latticeNode(i.x.add(1), i.y.add(1));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
};

/**
 * The wind in TSL. `gust(xz)`: the twin of `gustAt`. `sway(info, base, flutter, height, trunk)`: the world-space offset of a
 * plant vertex, from its `info` (x = wind weight 0 base … 1 tips), the plant's base (world), its leaves' `flutter`, its
 * model `height` and the vertex's height `y` in the model (local), scaled by the instance's `scale`, and `trunk` (how much
 * the whole plant bends): `strength·(0.3 + gust)·trunk·(y/height)²·0.03·height` along the wind, plus branches and leaves
 * fluttering by `info.x·flutter·sin(time·(6 + 4·hash) + phase)·0.04·(0.4 + gust)`.
 */
export const windNodes = (w: WindUniforms) => {
  const gust = (xz: Node<'vec2'>): Node<'float'> => {
    const p = xz.sub(w.off).div(GUST_SCALE);
    const n = valueNoiseNode(p).mul(0.65).add(valueNoiseNode(p.mul(OCTAVE2).add(vec2(17.3, 5.9))).mul(0.35));
    return smoothstep(0.2, 0.8, n);
  };
  const sway = Fn(([info, base, flutter, height, y, scale, phase, trunk]: [Node<'vec4'>, Node<'vec3'>, Node<'float'>, Node<'float'>,
    Node<'float'>, Node<'float'>, Node<'float'>, Node<'float'>]) => {
    const g = gust(base.xz).toVar();
    const along = vec3(w.dir.x, 0, w.dir.y);
    const r = y.div(height).max(0);
    const bend = w.strength.mul(g.add(0.3)).mul(trunk).mul(r.mul(r)).mul(0.03).mul(height).mul(scale);
    // a per-vertex rate, so neighbouring leaves do not flap in step (a rendering-only hash)
    const h = fract(sin(base.x.mul(0.37).add(y.mul(12.9898)).add(info.y.mul(78.233)).add(info.w.mul(37.719))).mul(43758.5453));
    const flap = info.x.mul(flutter).mul(sin(w.time.mul(h.mul(4).add(6)).add(phase))).mul(0.04).mul(g.add(0.4)).mul(scale);
    return along.mul(bend.add(flap)).add(vec3(0, flap.mul(0.5), 0));
  });
  return { gust, sway };
};
