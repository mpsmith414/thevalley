/** The soundscape's mix: how loud each ambient layer is for a listener, from place, time of day and wind (pure). */
import type { Vec3 } from '../util/vec';

export type Layer = 'wind' | 'birds' | 'night' | 'lake' | 'river' | 'forest';
export const LAYERS: readonly Layer[] = ['wind', 'birds', 'night', 'lake', 'river', 'forest'];

/**
 * Where the listener (the camera) is and what is around it: the hour and the sun's elevation (degrees), the wind's gust (0..1)
 * and strength (0..1) there, metres above the ground (or water), metres to the lake and the river, the river's slope there,
 * and the mean forest weight around (0..1).
 */
export type Listener = {
  pos: Vec3; hour: number; sunElevation: number; gust: number; strength: number;
  heightAboveGround: number; lakeDistance: number; riverDistance: number; riverSlope: number; forestAround: number;
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** GLSL's smoothstep; works with the edges reversed (`e0 > e1` falls from 1 to 0). */
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Each layer's gain, 0..1. */
export function mixAt(l: Listener): Record<Layer, number> {
  const { sunElevation: sun, strength, gust, heightAboveGround: h, forestAround: forest } = l;
  return {
    wind: clamp(0.15 + 0.5 * strength + 0.35 * gust) * (0.6 + 0.4 * smoothstep(5, 120, h)),
    birds: smoothstep(-4, 6, sun) * (0.4 + 0.6 * forest),
    night: smoothstep(-2, -10, sun),
    lake: smoothstep(80, 5, l.lakeDistance),
    river: smoothstep(90, 3, l.riverDistance) * (0.5 + 0.5 * smoothstep(0.02, 0.08, l.riverSlope)),
    forest: forest * (0.3 + 0.7 * strength) * smoothstep(40, 0, h),
  };
}
