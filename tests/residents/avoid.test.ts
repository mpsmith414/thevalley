import { describe, expect, it } from 'vitest';
import { avoid } from '../../src/residents/avoid';

const pos = { x: 0, z: 0 }, target = { x: 10, z: 0 };

describe('avoid', () => {
  it('leaves a clear path alone', () => {
    expect(avoid(pos, target, [], 0.3)).toBeNull();
    expect(avoid(pos, target, [{ x: 4, z: 3, r: 0.4 }], 0.3)).toBeNull(); // beside the line
    expect(avoid(pos, target, [{ x: -3, z: 0, r: 0.4 }], 0.3)).toBeNull(); // behind
    expect(avoid(pos, target, [{ x: 8, z: 0, r: 0.4 }], 0.3)).toBeNull(); // more than 6 m ahead
    expect(avoid(pos, { x: 2, z: 0 }, [{ x: 4, z: 0, r: 0.4 }], 0.3)).toBeNull(); // beyond the target
  });

  it('steps round a trunk in the way, on the side with the smaller turn', () => {
    const trunk = { x: 3, z: 0.2, r: 0.4 };
    const w = avoid(pos, target, [trunk], 0.3)!;
    expect(w).not.toBeNull();
    const R = trunk.r + 0.3 + 0.3;
    expect(Math.hypot(w.x - trunk.x, w.z - trunk.z)).toBeGreaterThan(trunk.r);
    expect(Math.hypot(w.x - trunk.x, w.z - trunk.z)).toBeCloseTo(1.5 * R, 5);
    expect(w.z).toBeLessThan(0); // the trunk leans to +z, so pass it on the -z side
    expect(avoid(pos, target, [{ ...trunk, z: -0.2 }], 0.3)!.z).toBeGreaterThan(0);
  });

  it('counts the body and a margin as part of the trunk', () => {
    // the line clears the bark by 0.5 m, but not a 0.3 m body plus the 0.3 m margin
    expect(avoid(pos, target, [{ x: 3, z: 0.9, r: 0.4 }], 0.3)).not.toBeNull();
    expect(avoid(pos, target, [{ x: 3, z: 0.9, r: 0.4 }], 0.05)).toBeNull();
  });

  it('dodges the nearest of several trunks first', () => {
    const w = avoid(pos, target, [{ x: 5, z: 0, r: 0.3 }, { x: 2, z: 0.1, r: 0.3 }], 0.2)!;
    expect(w.x).toBeCloseTo(2, 5);
  });
});
