import { describe, expect, it } from 'vitest';
import { SHARP_FOV, sharpPick, type Sighting } from '../../src/views/sharp';
import type { AnimalPose } from '../../src/views/types';

/** An animal at (x, 0, z), moving at `speed`, the hawk's prey or not. */
const at = (id: string, x: number, z: number, speed: number, prey = false): Sighting => {
  const pose: AnimalPose = { pos: { x, y: 0, z }, yaw: 0, size: 0.4, bodyLength: 0.4, backHeight: 0.25, flying: false, turnRate: 0 };
  return { id, pose, speed, prey };
};
const eye = { x: 0, y: 30, z: 0 };
/** Looking along -z and a little down. */
const forward = (() => {
  const p = -Math.atan2(30, 80), c = Math.cos(p);
  return { x: 0, y: Math.sin(p), z: -c };
})();

describe('sharpPick', () => {
  it('narrows to about 20°', () => expect(SHARP_FOV).toBe(20));

  it('picks moving animals where it looks, within its sight, prey first', () => {
    const cands = [
      at('deer', 2, -80, 1.5), // moving, ahead
      at('still', -2, -80, 0), // standing still: no shimmer
      at('rabbit', 6, -85, 2, true), // prey, a little off centre
      at('far', 0, -400, 2, true), // beyond its sight
      at('behind', 0, 80, 2, true), // behind the camera
    ];
    expect(sharpPick(cands, eye, forward, 150)).toEqual(['rabbit', 'deer']);
  });

  it('picks within a cone given (the picture across, outside Eyes)', () => {
    const cands = [at('near', 0, -80, 2), at('wide', 50, -80, 2)]; // the second about 30° off to the side
    expect(sharpPick(cands, eye, forward, 150)).toEqual(['near']);
    expect(sharpPick(cands, eye, forward, 150, 40)).toEqual(['near', 'wide']);
  });

  it('sees nothing when nothing moves', () => {
    expect(sharpPick([at('a', 0, -80, 0.1), at('b', 1, -80, 0)], eye, forward, 150)).toEqual([]);
  });
});
