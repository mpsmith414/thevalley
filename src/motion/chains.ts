/** Small, pure motion helpers: springs and travelling waves. */

export type Spring = { pos: number; vel: number };

/** One step of a damped spring towards target (semi-implicit Euler, stable for small dt). */
export function springStep(s: Spring, target: number, stiffness: number, damping: number, dt: number): Spring {
  const vel = s.vel + (stiffness * (target - s.pos) - damping * s.vel) * dt;
  return { pos: s.pos + vel * dt, vel };
}

/**
 * Side-to-side angle for segment i of n in a wave travelling from head to tail.
 * `travel` is how far along the wave we are (in wavelengths); amplitude grows towards the tail.
 */
export function undulation(i: number, n: number, travel: number, amp: number, phaseLag: number): number {
  const grow = 0.4 + 0.6 * ((i + 1) / n);
  return amp * grow * Math.sin(2 * Math.PI * (travel - i * phaseLag));
}
