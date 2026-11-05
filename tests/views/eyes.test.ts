import { describe, expect, it } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import { EyesCam } from '../../src/views/eyes';

type Trunk = { x: number; z: number; r: number };
/** A flat dry world with these trunks; `water` puts a surface at that height everywhere. */
const world = (trunks: Trunk[] = [], water = NaN): FlyWorld => ({
  heightAt: () => 0, isWater: () => water === water, waterLevelAt: () => water, inside: () => true,
  trunksNear: (x, z, r) => trunks.filter((t) => Math.hypot(t.x - x, t.z - z) <= r + t.r),
});
const dt = 1 / 60;
const deg = (d: number) => (d * Math.PI) / 180;
const still = { yaw: 0, pitch: 0 };
const eyeAt = (y = 1.5, yaw = 0, pitch = 0) => ({ pos: { x: 2, y, z: -3 }, yaw, pitch });
const settle = (cam: EyesCam, eye = eyeAt(), look = still, w = world(), swimmer = false, secs = 2) => {
  let pose = cam.update(dt, eye, look, w, swimmer);
  for (let t = 0; t < secs; t += dt) pose = cam.update(dt, eye, look, w, swimmer);
  return pose;
};

describe('EyesCam', () => {
  it('sits at the eye point, facing where the head faces', () => {
    const pose = settle(new EyesCam(), eyeAt(1.5, 0.7, 0.1));
    expect(pose.pos).toEqual({ x: 2, y: 1.5, z: -3 });
    expect(pose.yaw).toBeCloseTo(0.7, 6);
    expect(pose.pitch).toBeCloseTo(0.1, 6);
    expect(pose.roll).toBeUndefined();
  });

  it('starts on the eye with no glide', () => {
    expect(new EyesCam().update(dt, eyeAt(), still, world(), false).pos).toEqual({ x: 2, y: 1.5, z: -3 });
  });

  it('limits the head to 35 degrees of level', () => {
    expect(settle(new EyesCam(), eyeAt(1.5, 0, 1.2)).pitch).toBeCloseTo(deg(35), 6);
    expect(settle(new EyesCam(), eyeAt(1.5, 0, -1.2)).pitch).toBeCloseTo(-deg(35), 6);
  });

  it('the look turns within 60 and 40 degrees', () => {
    const far = settle(new EyesCam(), eyeAt(), { yaw: 3, pitch: 2 });
    expect(far.yaw).toBeCloseTo(deg(60), 9);
    expect(far.pitch).toBeCloseTo(deg(40), 9);
    const other = settle(new EyesCam(), eyeAt(), { yaw: -3, pitch: -2 });
    expect(other.yaw).toBeCloseTo(-deg(60), 9);
    expect(other.pitch).toBeCloseTo(-deg(40), 9);
  });

  it('smooths the head bob: 3 cm at 2 Hz in the eye moves the camera under 1.5 cm', () => {
    const cam = new EyesCam(), w = world();
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 4; t += dt) {
      const pose = cam.update(dt, eyeAt(1.5 + 0.03 * Math.sin(2 * Math.PI * 2 * t)), still, w, false);
      if (t > 1) (lo = Math.min(lo, pose.pos.y)), (hi = Math.max(hi, pose.pos.y));
    }
    expect((hi - lo) / 2).toBeLessThan(0.015);
  });

  it('keeps up with an animal at any speed: horizontally it is always on the eye, at 120 m/s too', () => {
    const cam = new EyesCam(), w = world(), eye = eyeAt();
    let pose = cam.update(dt, eye, still, w, false);
    for (let t = 0; t < 2; t += dt) {
      eye.pos.z -= 120 * dt;
      pose = cam.update(dt, eye, still, w, false);
    }
    expect(pose.pos.x).toBe(eye.pos.x);
    expect(pose.pos.z).toBe(eye.pos.z);
  });

  it('does not leave a climb behind: the eased height stays within 10 cm of the eye itself', () => {
    const cam = new EyesCam(), w = world(), eye = eyeAt(10);
    let pose = cam.update(dt, eye, still, w, false);
    for (let t = 0; t < 2; t += dt) {
      eye.pos.y += 60 * dt;
      pose = cam.update(dt, eye, still, w, false);
    }
    expect(eye.pos.y - pose.pos.y).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('turns the short way round across the seam, with a little ease', () => {
    const cam = new EyesCam(), w = world();
    const eye = eyeAt(1.5, 3, 0);
    settle(cam, eye);
    eye.yaw = -3;
    for (let t = 0; t < 0.2; t += dt) expect(Math.cos(cam.update(dt, eye, still, w, false).yaw)).toBeLessThan(-0.95);
  });

  it('keeps a land animal\'s eye above the water; a swimmer\'s may go under', () => {
    const w = world([], 1), low = eyeAt(0.4);
    expect(settle(new EyesCam(), low, still, w, false).pos.y).toBeGreaterThanOrEqual(1);
    expect(settle(new EyesCam(), low, still, w, true).pos.y).toBeCloseTo(0.4, 6);
  });

  it('keeps even a swimmer\'s eye above the ground, and any eye out of a trunk', () => {
    expect(settle(new EyesCam(), eyeAt(-1), still, world(), true).pos.y).toBeGreaterThanOrEqual(0);
    const trunk = { x: 2, z: -3, r: 0.3 };
    const pose = settle(new EyesCam(), eyeAt(), still, world([trunk]));
    expect(Math.hypot(pose.pos.x - trunk.x, pose.pos.z - trunk.z)).toBeGreaterThanOrEqual(trunk.r);
  });
});
