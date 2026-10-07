import { describe, expect, it } from 'vitest';
import { buildSkeleton } from '../../src/builder/skeleton';
import { chooseGait, phasesFor } from '../../src/motion/gait';
import { fabrik } from '../../src/motion/ik';
import { findChains, findLimbs, type Limb } from '../../src/motion/limbs';
import { dist, v3 } from '../../src/util/vec';
import { bird, hexapod, quadruped, snake } from '../fixtures/recipes';

const legsOf = (r: typeof quadruped) => findLimbs(buildSkeleton(r)).filter((l) => l.kind === 'leg');
const byName = (legs: Limb[], side: number, rank: number) => legs.findIndex((l) => l.side === side && l.rank === rank);

describe('findLimbs', () => {
  it('finds 4 legs on a quadruped, 2 per side, front first', () => {
    const sk = buildSkeleton(quadruped);
    const legs = findLimbs(sk).filter((l) => l.kind === 'leg');
    expect(legs).toHaveLength(4);
    expect(legs.filter((l) => l.side === 1)).toHaveLength(2);
    const front = legs.find((l) => l.side === 1 && l.rank === 0)!;
    expect(sk.bones[front.chain[0]].partId).toBe('leg_f');
    expect(front.chain.map((i) => sk.bones[i].role)).toEqual(['leg', 'leg', 'foot']);
  });

  it('finds 6 legs on a hexapod, none on a snake, wings on a bird', () => {
    expect(legsOf(hexapod)).toHaveLength(6);
    expect(legsOf(snake)).toHaveLength(0);
    expect(findLimbs(buildSkeleton(bird)).filter((l) => l.kind === 'wing')).toHaveLength(2);
  });

  it('finds tails, necks and long spines', () => {
    expect(findChains(buildSkeleton(quadruped)).map((c) => c.kind)).toEqual(expect.arrayContaining(['tail', 'neck', 'ear']));
    expect(findChains(buildSkeleton(snake)).some((c) => c.kind === 'spine')).toBe(true);
  });
});

describe('gaits', () => {
  const legs = legsOf(quadruped);
  const LF = byName(legs, 1, 0), LH = byName(legs, 1, 1), RF = byName(legs, -1, 0), RH = byName(legs, -1, 1);

  it('walks in lateral sequence', () => {
    const { phase, duty } = phasesFor(legs, 'walk');
    expect([phase[LH], phase[LF], phase[RH], phase[RF]]).toEqual([0, 0.25, 0.5, 0.75]);
    expect(duty).toBe(0.7);
    expect(phase[LF]).not.toBe(phase[LH]);
    expect(phase[RF]).not.toBe(phase[RH]);
  });

  it('trots in diagonal pairs and gallops front then hind', () => {
    const t = phasesFor(legs, 'trot').phase;
    expect(t[LF]).toBe(t[RH]);
    expect(t[RF]).toBe(t[LH]);
    expect(t[LF]).not.toBe(t[RF]);
    const g = phasesFor(legs, 'gallop').phase;
    expect([g[LF], g[RF], g[LH], g[RH]]).toEqual([0, 0.1, 0.5, 0.6]);
  });

  it('moves insects in alternating tripods', () => {
    const h = legsOf(hexapod);
    const p = phasesFor(h, 'tripod').phase;
    const tri = (side: number, rank: number) => p[byName(h, side, rank)];
    expect(tri(1, 0)).toBe(tri(1, 2));
    expect(tri(1, 0)).toBe(tri(-1, 1));
    expect(tri(1, 0)).not.toBe(tri(1, 1));
  });

  it('chooses gaits by leg count and speed', () => {
    expect(chooseGait(legs, quadruped, 0.2)).toBe('walk');
    expect(chooseGait(legs, quadruped, 0.5)).toBe('trot');
    expect(chooseGait(legs, quadruped, 0.9)).toBe('gallop');
    expect(chooseGait(legsOf(hexapod), hexapod, 0.5)).toBe('tripod');
    expect(chooseGait(legs, { ...quadruped, motion: { ...quadruped.motion, gait: 'hop' } }, 0.5)).toBe('hop');
    expect(chooseGait(legs.slice(0, 2), quadruped, 0.5)).toBe('biped');
    expect(chooseGait(legs.slice(0, 3), quadruped, 0.5)).toBe('wave');
  });
});

describe('fabrik', () => {
  const joints = [v3(0, 1, 0), v3(0, 0.5, 0), v3(0, 0, 0)];
  const lengths = [0.5, 0.5];

  it('reaches a reachable target and keeps bone lengths', () => {
    const out = fabrik(joints, lengths, v3(0.2, 0.2, 0.1), v3(0, 0.5, 1));
    expect(dist(out[2], v3(0.2, 0.2, 0.1))).toBeLessThan(1e-3);
    expect(dist(out[0], joints[0])).toBeLessThan(1e-9);
    expect(dist(out[0], out[1])).toBeCloseTo(0.5, 4);
    expect(dist(out[1], out[2])).toBeCloseTo(0.5, 4);
  });

  it('points straight at an unreachable target', () => {
    const out = fabrik(joints, lengths, v3(0, -5, 0), null);
    expect(out[2].y).toBeCloseTo(0, 6);
    expect(out[1].y).toBeCloseTo(0.5, 6);
  });

  it('bends the knee towards the pole', () => {
    const front = fabrik(joints, lengths, v3(0, 0.3, 0), v3(0, 0.6, 1));
    const back = fabrik(joints, lengths, v3(0, 0.3, 0), v3(0, 0.6, -1));
    expect(front[1].z).toBeGreaterThan(0.1);
    expect(back[1].z).toBeLessThan(-0.1);
  });
});
