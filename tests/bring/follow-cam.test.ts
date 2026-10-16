import { describe, expect, it } from 'vitest';
import { FOLLOW_CLEAR, FOLLOW_MAX_SPEED, FollowCam, followFraming } from '../../src/bring/follow-cam';

const { back: FOLLOW_BACK, up: FOLLOW_UP } = followFraming(); // no size: the largest framing
import type { FlyWorld } from '../../src/camera/freefly';

type Trunk = { x: number; z: number; r: number };
/** A flat (or hilly) dry world with these trunks. */
const world = (trunks: Trunk[] = [], heightAt: (x: number, z: number) => number = () => 0): FlyWorld => ({
  heightAt, isWater: () => false, waterLevelAt: () => NaN, inside: () => true,
  trunksNear: (x, z, r) => trunks.filter((t) => Math.hypot(t.x - x, t.z - z) <= r + t.r),
});
const dt = 1 / 60;
/** Distance from point p to the segment a-b, in the ground plane. */
const toSegment = (p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
};

describe('FollowCam', () => {
  it('settles behind the lead at the set distance and height once it stops', () => {
    const w = world();
    const target = { x: 0, y: 0.5, z: 0 };
    const cam = new FollowCam({ x: -12, y: 4, z: 3 }, { x: 0, y: 1, z: 0 }, target);
    for (let t = 0; t < 6; t += dt) {
      target.x += 2.5 * dt; // walking along +x
      cam.update(dt, target, w);
    }
    for (let t = 0; t < 6; t += dt) cam.update(dt, target, w); // stopped
    expect(Math.hypot(cam.pos.x - target.x, cam.pos.z - target.z)).toBeCloseTo(FOLLOW_BACK, 0);
    expect(cam.pos.x).toBeLessThan(target.x - FOLLOW_BACK + 0.5); // behind (it walked along +x)
    expect(Math.abs(cam.pos.z - target.z)).toBeLessThan(1);
    expect(cam.pos.y).toBeCloseTo(target.y + FOLLOW_UP, 0);
  });

  it('never goes below the ground plus its clearance, over a hill', () => {
    const hill = (x: number, z: number) => 9 * Math.exp(-((x - 25) ** 2 + z ** 2) / 120);
    const w = world([], hill);
    const target = { x: 0, y: 0.5, z: 0 };
    const cam = new FollowCam({ x: -10, y: 4, z: 0 }, { x: 0, y: 1, z: 0 }, target);
    let lowest = Infinity;
    for (let t = 0; t < 20; t += dt) {
      target.x += 3 * dt;
      target.y = hill(target.x, target.z) + 0.5;
      const pose = cam.update(dt, target, w);
      lowest = Math.min(lowest, pose.pos.y - hill(pose.pos.x, pose.pos.z));
    }
    expect(lowest).toBeGreaterThanOrEqual(FOLLOW_CLEAR - 1e-9);
  });

  it('moves smoothly: a bounded change each frame, even when the lead turns sharply', () => {
    const w = world();
    const target = { x: 0, y: 0.5, z: 0 };
    const cam = new FollowCam({ x: -9, y: 4, z: 0 }, { x: 0, y: 1, z: 0 }, target);
    let prev = cam.update(dt, target, w), maxStep = 0, maxTurn = 0;
    for (let t = 0; t < 12; t += dt) {
      if (t < 4) target.x += 2.5 * dt;
      else target.z += 2.5 * dt; // a right-angle turn
      const pose = cam.update(dt, target, w);
      maxStep = Math.max(maxStep, Math.hypot(pose.pos.x - prev.pos.x, pose.pos.y - prev.pos.y, pose.pos.z - prev.pos.z));
      const dy = Math.atan2(Math.sin(pose.yaw - prev.yaw), Math.cos(pose.yaw - prev.yaw));
      maxTurn = Math.max(maxTurn, Math.abs(dy), Math.abs(pose.pitch - prev.pitch));
      prev = pose;
    }
    expect(maxStep).toBeLessThanOrEqual(FOLLOW_MAX_SPEED * dt + 1e-9);
    expect(maxTurn).toBeLessThan(0.05); // under 3 degrees a frame
  });

  it('keeps a trunk out of the way: it moves off the line to the lead, and is never inside it', () => {
    const target = { x: 0, y: 0.5, z: 0 };
    const cam = new FollowCam({ x: -9, y: 4, z: 0 }, { x: 0, y: 1, z: 0 }, target);
    const free = world();
    for (let t = 0; t < 3; t += dt) cam.update(dt, target, free);
    const trunk = { x: cam.pos.x / 2, z: cam.pos.z / 2, r: 0.4 }; // right on the line, half way
    const w = world([trunk]);
    expect(toSegment(trunk, cam.pos, target)).toBeLessThan(0.1);
    for (let t = 0; t < 4; t += dt) {
      cam.update(dt, target, w);
      expect(Math.hypot(cam.pos.x - trunk.x, cam.pos.z - trunk.z)).toBeGreaterThan(trunk.r);
    }
    expect(toSegment(trunk, cam.pos, target)).toBeGreaterThan(trunk.r + 1);
    expect(Math.hypot(cam.pos.x - target.x, cam.pos.z - target.z)).toBeGreaterThan(FOLLOW_BACK - 1.5);
  });

  it('scales its distance and height to the creature, clamped (the lead fills a good part of the picture)', () => {
    expect(followFraming(1)).toMatchObject({ back: 6.5, up: 2.6 });
    expect(followFraming(0.18).back).toBe(3.5); // a frog: no nearer than 3.5 m
    expect(followFraming(0.18).up).toBe(1.6);
    expect(followFraming(3)).toMatchObject({ back: 9, up: 3.5, lookUp: 0.8 });
    expect(followFraming(0.6).back).toBeCloseTo(3.9, 6);
    // a 0.6 m fox, settled: 3.9 m behind and 1.6 m above
    const w = world(), target = { x: 0, y: 0.3, z: 0 };
    const cam = new FollowCam({ x: -8, y: 3, z: 0 }, { x: 0, y: 0.5, z: 0 }, target, 0.6);
    for (let t = 0; t < 8; t += dt) cam.update(dt, target, w);
    expect(Math.hypot(cam.pos.x - target.x, cam.pos.z - target.z)).toBeCloseTo(3.9, 1);
    expect(cam.pos.y).toBeCloseTo(target.y + 1.6, 1);
  });

  it('keeps a trunk out of the way at a small creature\'s short distance too', () => {
    const target = { x: 0, y: 0.3, z: 0 };
    const cam = new FollowCam({ x: -3.9, y: 1.9, z: 0 }, { x: 0, y: 0.6, z: 0 }, target, 0.6);
    for (let t = 0; t < 3; t += dt) cam.update(dt, target, world());
    const trunk = { x: cam.pos.x * 0.6, z: cam.pos.z * 0.6, r: 0.3 }; // on the line, 2.3 m from the lead
    const w = world([trunk]);
    expect(toSegment(trunk, cam.pos, target)).toBeLessThan(0.1);
    for (let t = 0; t < 4; t += dt) {
      cam.update(dt, target, w);
      expect(Math.hypot(cam.pos.x - trunk.x, cam.pos.z - trunk.z)).toBeGreaterThan(trunk.r);
    }
    expect(toSegment(trunk, cam.pos, target)).toBeGreaterThan(trunk.r + 1);
  });

  it('goes back to straight behind once the trunk that swung it is passed, without flicking', () => {
    const target = { x: 0, y: 0.5, z: 0 };
    const cam = new FollowCam({ x: -9, y: 4, z: 0 }, { x: 0, y: 1, z: 0 }, target);
    for (let t = 0; t < 3; t += dt) cam.update(dt, target, world());
    const w = world([{ x: -4.5, z: 0, r: 0.4 }]);
    const sides: number[] = [];
    for (let t = 0; t < 4; t += dt) sides.push(Math.sign(cam.update(dt, target, w).pos.z));
    expect(Math.abs(cam.pos.z), 'swung round the trunk').toBeGreaterThan(3);
    expect(new Set(sides.filter((s) => s !== 0)).size, 'one side, no flicking').toBe(1);
    for (let t = 0; t < 5; t += dt) cam.update(dt, target, world()); // the trunk is behind it now
    expect(Math.abs(cam.pos.z), 'back behind').toBeLessThan(0.5);
    expect(cam.pos.x).toBeCloseTo(-FOLLOW_BACK, 0);
  });
});
