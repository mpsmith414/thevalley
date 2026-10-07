import { describe, expect, it } from 'vitest';
import { buildSkeleton, expandParts } from '../../src/builder/skeleton';
import { biped, blob, hexapod, quadruped, snake } from '../fixtures/recipes';

const low = (b: { start: { y: number }; end: { y: number }; r0: number; r1: number }) => Math.min(b.start.y - b.r0, b.end.y - b.r1);

describe('skeleton', () => {
  it('mirrors limbs to both sides, children on their own side', () => {
    const bones = expandParts(quadruped);
    expect(bones).toHaveLength(20);
    const legF = bones.filter((b) => b.partId === 'leg_f');
    expect(legF).toHaveLength(2);
    expect(Math.sign(legF[0].start.x)).toBe(-Math.sign(legF[1].start.x));
    const shinCopy = bones.find((b) => b.name === 'shin_f~m')!;
    expect(bones[shinCopy.parent].name).toBe('leg_f~m');
    bones.forEach((b, i) => expect(b.parent).toBeLessThan(i));
  });

  it('stands a quadruped on four feet with its support centre at the origin', () => {
    const sk = buildSkeleton(quadruped);
    expect(sk.contacts).toHaveLength(4);
    expect(sk.contacts.every((i) => sk.bones[i].role === 'foot')).toBe(true);
    expect(Math.min(...sk.contacts.map((i) => low(sk.bones[i])))).toBeCloseTo(0, 6);
    const cx = sk.contacts.reduce((s, i) => s + sk.bones[i].end.x, 0) / 4;
    const cz = sk.contacts.reduce((s, i) => s + sk.bones[i].end.z, 0) / 4;
    expect(Math.abs(cx)).toBeLessThan(1e-6);
    expect(Math.abs(cz)).toBeLessThan(1e-6);
    expect(sk.bones[0].start.y).toBeGreaterThan(0.3); // the body is up on its legs
  });

  it('rests legless bodies on their belly', () => {
    const sk = buildSkeleton(snake);
    expect(sk.contacts.every((i) => sk.bones[i].role === 'torso')).toBe(true);
    expect(Math.min(...sk.bones.map(low))).toBeCloseTo(0, 6);
    expect(buildSkeleton(blob).contacts).toEqual([0]);
  });

  it('finds six feet on a hexapod and two on a biped', () => {
    expect(buildSkeleton(hexapod).contacts).toHaveLength(6);
    expect(buildSkeleton(biped).contacts).toHaveLength(2);
  });

  it('is deterministic', () => {
    expect(buildSkeleton(quadruped)).toEqual(buildSkeleton(quadruped));
  });
});
