/** The lab stage's ground, as pure functions (shared by rendering, feet and tests). */

export const STAGE_RADIUS = 6;
export const WATER_LEVEL = 0;
export const POND = { x: -2.6, z: 2.2, r: 1.4, depth: 0.5 } as const;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ground height (m) at a point: gentle bumps, a slope rising towards +x, and the pond's bowl. */
export function heightAt(x: number, z: number): number {
  const bumps = 0.06 + 0.08 * Math.sin(1.3 * x) * Math.cos(1.1 * z) + 0.03 * Math.sin(3.1 * x + 1.7) * Math.sin(2.7 * z + 0.4);
  const slope = 0.35 * smoothstep(2, 6, x);
  const ground = bumps + slope;
  const d = Math.hypot(x - POND.x, z - POND.z);
  if (d < POND.r) return WATER_LEVEL - POND.depth * (1 - (d / POND.r) ** 2);
  const t = smoothstep(POND.r, POND.r + 1, d);
  return ground * t + WATER_LEVEL * (1 - t);
}

export const isWater = (x: number, z: number) => Math.hypot(x - POND.x, z - POND.z) < POND.r;

/** Surface normal by central differences. */
export function normalAt(x: number, z: number, h = 0.05): { x: number; y: number; z: number } {
  const dx = heightAt(x + h, z) - heightAt(x - h, z);
  const dz = heightAt(x, z + h) - heightAt(x, z - h);
  const l = Math.hypot(dx, 2 * h, dz);
  return { x: -dx / l, y: (2 * h) / l, z: -dz / l };
}
