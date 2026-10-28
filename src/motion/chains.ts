/** Small, pure motion helpers: springs and travelling waves. */

export type Spring = { pos: number; vel: number };

/** A spring steps at most this long (s) at once: semi-implicit Euler is steady for the stiffest springs here up to about 0.1 s. */
const SPRING_DT = 1 / 30;

/** One step of a damped spring towards target (semi-implicit Euler, in short steps so it stays steady at any dt). */
export function springStep(s: Spring, target: number, stiffness: number, damping: number, dt: number): Spring {
  if (dt > SPRING_DT) {
    // a long step (a time-lapse frame) in short ones: the stiff springs would blow up otherwise
    const n = Math.ceil(dt / SPRING_DT);
    for (let i = 0; i < n; i++) s = springStep(s, target, stiffness, damping, dt / n);
    return s;
  }
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
