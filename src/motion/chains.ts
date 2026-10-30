/** Small, pure motion helpers: springs and travelling waves. */

export type Spring = { pos: number; vel: number };

/** A spring steps at most this long (s) at once: semi-implicit Euler is steady for the stiffest springs here up to about 0.1 s. */
const SPRING_DT = 1 / 30;

/** One step of a damped spring towards target (semi-implicit Euler, in short steps so it stays steady at any dt). */
export function springStep(s: Spring, target: number, stiffness: number, damping: number, dt: number): Spring {
  return springInto({ pos: s.pos, vel: s.vel }, target, stiffness, damping, dt);
}

/** springStep in place: moves `s` itself (no allocation, for springs stepped every frame) and returns it. */
export function springInto(s: Spring, target: number, stiffness: number, damping: number, dt: number): Spring {
  // a long step (a time-lapse frame) in short ones: the stiff springs would blow up otherwise
  const n = dt > SPRING_DT ? Math.ceil(dt / SPRING_DT) : 1, h = dt / n;
  for (let i = 0; i < n; i++) {
    s.vel += (stiffness * (target - s.pos) - damping * s.vel) * h;
    s.pos += s.vel * h;
  }
  return s;
}

/**
 * Side-to-side angle for segment i of n of a swimming or slithering body: amplitude grows towards the tail
 * (0.15 + 0.85·((i+1)/n)²), a wave travelling head → tail one body length long.
 * Segment 0 is the one nearest the head; `travel` is how far along the wave we are (in wavelengths).
 */
export function swimWave(i: number, n: number, travel: number, amp: number): number {
  return amp * swimEnvelope(i, n) * Math.sin(2 * Math.PI * (travel - i / n));
}

/** How far segment i of n swings, as a share of the tail's: 0.15 + 0.85·((i+1)/n)². */
export function swimEnvelope(i: number, n: number): number {
  const f = (i + 1) / n;
  return 0.15 + 0.85 * f * f;
}

/** Tail-beat frequency (Hz) for a swimmer: 1.2 + 2.5 × speed / bodyLength. */
export function beatHz(speed: number, bodyLength: number): number {
  return 1.2 + (2.5 * speed) / bodyLength;
}
