import { mulberry32 } from '../../util/rng';

const S = Math.SQRT1_2;
const GRADS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [S, S], [-S, S], [S, -S], [-S, -S]];
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Seeded 2D gradient (Perlin) noise, output in about [-1, 1]. */
export function createNoise2D(seed: number): (x: number, z: number) => number {
  const rng = mulberry32(seed);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const grad = (h: number, dx: number, dz: number) => {
    const g = GRADS[perm[h] & 7];
    return g[0] * dx + g[1] * dz;
  };
  return (x, z) => {
    const xf = Math.floor(x), zf = Math.floor(z);
    const fx = x - xf, fz = z - zf, X = xf & 255, Z = zf & 255;
    const u = fade(fx), v = fade(fz);
    const a = perm[X] + Z, b = perm[X + 1] + Z;
    const g00 = grad(a, fx, fz), g10 = grad(b, fx - 1, fz), g01 = grad(a + 1, fx, fz - 1), g11 = grad(b + 1, fx - 1, fz - 1);
    const x0 = g00 + u * (g10 - g00), x1 = g01 + u * (g11 - g01);
    return (x0 + v * (x1 - x0)) * Math.SQRT2; // unit gradients peak near 0.707; scale to fill [-1, 1]
  };
}

/** Fractal sum of octaves, normalised by total amplitude so it stays in about [-1, 1]. */
export function fbm(n: (x: number, z: number) => number, x: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise: (1 - |n|) squared per octave, summed with gain and normalised to [0, 1]. */
export function ridged(n: (x: number, z: number) => number, x: number, z: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const r = 1 - Math.min(1, Math.abs(n(x * freq, z * freq)));
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
