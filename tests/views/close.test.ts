import { describe, expect, it } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import { CloseCam } from '../../src/views/close';
import type { AnimalPose } from '../../src/views/types';

type Trunk = { x: number; z: number; r: number };
/** A flat (or hilly) dry world with these trunks. */
const world = (trunks: Trunk[] = [], heightAt: (x: number, z: number) => number = () => 0): FlyWorld => ({
  heightAt, isWater: () => false, waterLevelAt: () => NaN, inside: () => true,
  trunksNear: (x, z, r) => trunks.filter((t) => Math.hypot(t.x - x, t.z - z) <= r + t.r),
});
const dt = 1 / 60;
const deg = (d: number) => (d * Math.PI) / 180;
/** A deer 1.6 m long standing at the origin heading along -z (camera yaw 0). */
const deer = (over: Partial<AnimalPose> = {}): AnimalPose => ({ pos: { x: 0, y: 0, z: 0 }, yaw: 0, size: 1.6, bodyLength: 1.4, backHeight: 1.1, flying: false, turnRate: 0, ...over });
const still = { yaw: 0, pitch: 0 };
const settle = (cam: CloseCam, a: AnimalPose, w: FlyWorld, look = still, secs = 3) => {
  let pose = cam.update(dt, a, look, w);
  for (let t = 0; t < secs; t += dt) pose = cam.update(dt, a, look, w);
  return pose;
};

describe('CloseCam', () => {
  it('settles 1.2 body lengths behind and a third of a body length above its back, looking ahead', () => {
    const pose = settle(new CloseCam(1.6), deer(), world());
    expect(pose.pos.x).toBeCloseTo(0, 5);
    expect(pose.pos.z).toBeCloseTo(1.2 * 1.4, 5); // behind a -z heading is +z
    expect(pose.pos.y).toBeCloseTo(1.1 + 1.4 / 3, 5);
    expect(pose.yaw).toBeCloseTo(0, 5);
    expect(pose.pitch).toBeLessThan(0); // down a little, at the back's height ahead
    expect(pose.pitch).toBeGreaterThan(deg(-10));
  });

  it('stands at least half a metre back, even for a tiny animal', () => {
    const pose = settle(new CloseCam(0.1), deer({ bodyLength: 0.1, backHeight: 0.06, size: 0.1 }), world());
    expect(pose.pos.z).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it('is behind a heading in any direction (yaw 90 degrees turns left, to face -x)', () => {
    const pose = settle(new CloseCam(1.6), deer({ yaw: Math.PI / 2 }), world());
    expect(pose.pos.x).toBeCloseTo(1.2 * 1.4, 5);
    expect(pose.pos.z).toBeCloseTo(0, 5);
  });

  it('turns with the animal: after a 90 degree turn the camera is within 10 degrees after 0.5 s, but not at once', () => {
    const a = deer(), w = world();
    const cam = new CloseCam(1.6);
    settle(cam, a, w, still, 1);
    a.yaw = Math.PI / 2;
    let pose = cam.update(dt, a, still, w);
    expect(pose.yaw).toBeLessThan(Math.PI / 4);
    for (let t = 0; t < 0.5; t += dt) pose = cam.update(dt, a, still, w);
    expect(Math.abs(pose.yaw - Math.PI / 2)).toBeLessThan(deg(10));
  });

  it('turns the short way round across the seam', () => {
    const a = deer({ yaw: 3 }), w = world();
    const cam = new CloseCam(1.6);
    settle(cam, a, w, still, 1);
    a.yaw = -3;
    for (let t = 0; t < 0.1; t += dt) expect(Math.cos(cam.update(dt, a, still, w).yaw)).toBeLessThan(-0.95);
  });

  it('the look turns at most 100 degrees and 35 degrees', () => {
    const base = settle(new CloseCam(1.6), deer(), world());
    const far = settle(new CloseCam(1.6), deer(), world(), { yaw: 3, pitch: 2 });
    expect(far.yaw - base.yaw).toBeCloseTo(deg(100), 9);
    expect(far.pitch - base.pitch).toBeCloseTo(deg(35), 9);
    const other = settle(new CloseCam(1.6), deer(), world(), { yaw: -3, pitch: -2 });
    expect(other.yaw - base.yaw).toBeCloseTo(-deg(100), 9);
    expect(other.pitch - base.pitch).toBeCloseTo(-deg(35), 9);
  });

  it('a flier banks with its turns, at most 10 degrees; a walker does not', () => {
    const hawk = deer({ flying: true, turnRate: 3, pos: { x: 0, y: 30, z: 0 } });
    expect(settle(new CloseCam(1), hawk, world(), still, 6).roll!).toBeCloseTo(deg(10), 3);
    expect(settle(new CloseCam(1), { ...hawk, turnRate: -3 }, world(), still, 6).roll!).toBeCloseTo(-deg(10), 3);
    expect(Math.abs(settle(new CloseCam(1), { ...hawk, turnRate: 0.1 }, world()).roll!)).toBeLessThan(deg(10));
    expect(settle(new CloseCam(1.6), deer({ turnRate: 3 }), world()).roll).toBeUndefined();
  });

  it('keeps 5 cm above the ground, over a hill the animal runs up', () => {
    const hill = (x: number, z: number) => 9 * Math.exp(-(x ** 2 + (z + 25) ** 2) / 120);
    const w = world([], hill);
    const cam = new CloseCam(0.3);
    const a = deer({ size: 0.3, bodyLength: 0.3, backHeight: 0.15 });
    let lowest = Infinity;
    for (let t = 0; t < 12; t += dt) {
      a.pos.z -= 4 * dt;
      a.pos.y = hill(a.pos.x, a.pos.z);
      const p = cam.update(dt, a, still, w);
      lowest = Math.min(lowest, p.pos.y - hill(p.pos.x, p.pos.z));
    }
    expect(lowest).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('keeps above the water surface too', () => {
    const w: FlyWorld = { ...world(), waterLevelAt: () => 2, isWater: () => true };
    const pose = settle(new CloseCam(1.6), deer({ pos: { x: 0, y: 1.5, z: 0 }, backHeight: 0.1 }), w);
    expect(pose.pos.y).toBeGreaterThanOrEqual(2.05 - 1e-9);
  });

  it('is never inside a trunk', () => {
    const trunk = { x: 0, z: 1.68, r: 0.4 }; // right where it would stand
    const pose = settle(new CloseCam(1.6), deer(), world([trunk]));
    expect(Math.hypot(pose.pos.x - trunk.x, pose.pos.z - trunk.z)).toBeGreaterThanOrEqual(trunk.r);
  });

  it('keeps up with an animal at any speed: 120 m/s leaves it no further behind than when standing', () => {
    const w = world(), cam = new CloseCam(1.6), a = deer();
    let pose = cam.update(dt, a, still, w);
    for (let t = 0; t < 2; t += dt) {
      a.pos.z -= 120 * dt;
      pose = cam.update(dt, a, still, w);
    }
    expect(Math.hypot(pose.pos.x - a.pos.x, pose.pos.z - a.pos.z)).toBeCloseTo(1.2 * 1.4, 6);
    expect(pose.pos.y).toBeCloseTo(1.1 + 1.4 / 3, 6);
  });

  it('is out of two trunks side by side', () => {
    const trunks = [{ x: 0, z: 1.68, r: 0.4 }, { x: 0.9, z: 1.68, r: 0.4 }];
    const pose = settle(new CloseCam(1.6), deer(), world(trunks));
    for (const t of trunks) expect(Math.hypot(pose.pos.x - t.x, pose.pos.z - t.z)).toBeGreaterThanOrEqual(t.r);
  });

  it('asks for a near plane that follows its size', () => {
    expect(new CloseCam(0.1).near).toBe(0.01);
    expect(new CloseCam(5).near).toBe(0.1);
  });
});
