import { describe, expect, it } from 'vitest';
import { CLIPS, clipGround, driveClip, type ClipRig } from '../../src/lab/clips';

const fake = (): ClipRig & { speed: number; target: unknown } => ({
  position: { x: 0, z: 0 }, yaw: 0, wantFly: false, cruise: null, speed: -1, target: undefined,
  setSpeed(f) { this.speed = f; }, moveTo(t) { this.target = t; },
});

describe('motion clips', () => {
  it('water clips stand in water, land clips on flat ground', () => {
    expect(clipGround('swim').isWater(3, -2)).toBe(true);
    expect(clipGround('swim').waterLevelAt(0, 0)).toBeCloseTo(0.6);
    expect(clipGround('walk').isWater(0, 0)).toBe(false);
    expect(clipGround('walk').heightAt(5, 5)).toBe(0);
  });
  it('start-stop stands, goes, then stops', () => {
    const r = fake();
    driveClip('start-stop', r, -10, 64);
    expect(r.target).toBeNull();
    driveClip('start-stop', r, 0, 64);
    expect(r.speed).toBe(0.5);
    expect(r.target).not.toBeNull();
    driveClip('start-stop', r, 40, 64);
    expect(r.target).toBeNull();
  });
  it('turn heads 90 degrees left of where it was going', () => {
    const r = fake();
    driveClip('turn', r, -1, 64);
    driveClip('turn', r, 0, 64);
    const t = r.target as { x: number; z: number };
    expect(t.x).toBeGreaterThan(40); // left = +x when facing +z
    expect(Math.abs(t.z)).toBeLessThan(1);
  });
  it('land wants to fly during warm-up only', () => {
    const r = fake();
    driveClip('land', r, -5, 64);
    expect(r.wantFly).toBe(true);
    driveClip('land', r, 0, 64);
    expect(r.wantFly).toBe(false);
  });
  it('every clip drives without throwing', () => {
    for (const c of CLIPS) for (const f of [-3, 0, 30]) driveClip(c, fake(), f, 64);
  });
});
