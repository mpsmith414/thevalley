import { describe, it, expect } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import { Glide, viewpointPose } from '../../src/camera/viewpoints';
import { VALLEY } from '../../src/valley/layout';
import type { Viewpoint } from '../../src/valley/types';

const hills: FlyWorld = {
  heightAt: (x, z) => 30 * Math.sin(x / 40) * Math.cos(z / 40),
  isWater: () => false,
  waterLevelAt: () => NaN,
  trunksNear: () => [],
  inside: () => true,
};
const flat0: FlyWorld = { ...hills, heightAt: () => 0 };
const vp = (x: number, z: number, h: number, lx: number, lz: number, lh = 0): Viewpoint => ({ name: 't', pos: { x, z, h }, look: { x: lx, z: lz, h: lh } });
const target = vp(300, -200, 6, 0, 0);
const start = { pos: { x: -200, y: 25, z: 100 }, yaw: 0.3, pitch: -0.1 };

describe('viewpointPose', () => {
  it('stands h above the ground and looks at the target', () => {
    const p = viewpointPose(vp(10, 20, 3, 10, -80, 0), hills);
    expect(p.pos.y).toBeCloseTo(hills.heightAt(10, 20) + 3);
    expect(p.yaw).toBeCloseTo(0); // towards -z
    expect(viewpointPose(vp(0, 0, 3, -50, 0), flat0).yaw).toBeCloseTo(Math.PI / 2); // towards -x is a left turn
    expect(viewpointPose(vp(0, 0, 3, 50, 0), flat0).yaw).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(viewpointPose(vp(0, 0, 3, 0, 50), flat0).yaw)).toBeCloseTo(Math.PI); // towards +z
  });
  it('pitches down at a lower target and up at a higher one', () => {
    expect(viewpointPose(vp(0, 0, 50, 0, -100), flat0).pitch).toBeCloseTo(-Math.atan2(50, 100));
    expect(viewpointPose(vp(0, 0, 2, 0, -100, 40), flat0).pitch).toBeGreaterThan(0);
  });
  it('uses the water surface where there is water', () => {
    const w: FlyWorld = { ...flat0, heightAt: () => -9, isWater: () => true, waterLevelAt: () => 0 };
    expect(viewpointPose(vp(0, 0, 1.7, 0, -100), w).pos.y).toBeCloseTo(1.7);
  });
  it('treats a NaN water level as dry', () => {
    const w: FlyWorld = { ...flat0, heightAt: () => 12 };
    expect(viewpointPose(vp(0, 0, 2, 0, -100), w).pos.y).toBeCloseTo(14);
  });
  it('clamps a straight-down look to the pitch limit', () => {
    expect(viewpointPose(vp(0, 0, 50, 0, 0), flat0).pitch).toBeCloseTo(-1.35);
  });
});

describe('Glide', () => {
  const g = new Glide(start, target, hills);
  const end = viewpointPose(target, hills);
  it('duration is clamp(1.5 + dist / 400, 1.5, 5)', () => {
    const d = Math.hypot(end.pos.x - start.pos.x, end.pos.y - start.pos.y, end.pos.z - start.pos.z);
    expect(g.duration).toBeCloseTo(Math.min(5, Math.max(1.5, 1.5 + d / 400)));
    expect(new Glide(start, vp(-199, 101, 25 - hills.heightAt(-199, 101), 0, 0), hills).duration).toBeCloseTo(1.5, 1);
    expect(new Glide({ ...start, pos: { x: -790, y: 25, z: 790 } }, vp(790, -790, 3, 0, 0), flat0).duration).toBeCloseTo(5);
  });
  it('sample(0) is the start pose and not done', () => {
    const s = g.sample(0);
    expect(s.pos.x).toBeCloseTo(start.pos.x, 6);
    expect(s.pos.y).toBeCloseTo(start.pos.y, 6);
    expect(s.pos.z).toBeCloseTo(start.pos.z, 6);
    expect(s.yaw).toBeCloseTo(start.yaw, 6);
    expect(s.pitch).toBeCloseTo(start.pitch, 6);
    expect(s.done).toBe(false);
  });
  it('sample(duration) is the target pose and done; later samples stay there', () => {
    for (const t of [g.duration, g.duration + 3]) {
      const s = g.sample(t);
      expect(s.pos.x).toBeCloseTo(end.pos.x, 6);
      expect(s.pos.y).toBeCloseTo(end.pos.y, 6);
      expect(s.pos.z).toBeCloseTo(end.pos.z, 6);
      expect(s.yaw).toBeCloseTo(end.yaw, 6);
      expect(s.pitch).toBeCloseTo(end.pitch, 6);
      expect(s.done).toBe(true);
    }
  });
  it('the midpoint is higher than both ends', () => {
    const m = g.sample(g.duration / 2).pos.y;
    expect(m).toBeGreaterThan(start.pos.y);
    expect(m).toBeGreaterThan(end.pos.y);
  });
  it('no sample is below ground + 2 (target h 6, start 25 up: both clear it)', () => {
    for (let i = 0; i <= 400; i++) {
      const s = g.sample((g.duration * i) / 400);
      expect(s.pos.y).toBeGreaterThanOrEqual(hills.heightAt(s.pos.x, s.pos.z) + 2 - 1e-9);
    }
  });
  it('lifts a path that would clip a hill, and leaves a low viewpoint exactly where it is', () => {
    const wall: FlyWorld = { ...hills, heightAt: (x) => (Math.abs(x) < 30 ? 80 : 0) };
    const lo = new Glide({ pos: { x: -200, y: 3, z: 0 }, yaw: 0, pitch: 0 }, vp(200, 0, 1.6, 0, -100), wall);
    for (let i = 0; i <= 200; i++) {
      const s = lo.sample((lo.duration * i) / 200);
      expect(s.pos.y).toBeGreaterThanOrEqual(wall.heightAt(s.pos.x, s.pos.z) + 1.6 - 1e-9);
    }
    expect(lo.sample(lo.duration).pos.y).toBeCloseTo(1.6, 6);
  });
  it('yaw goes the short way round from 3.0 to -3.0', () => {
    // forward = (-sin yaw, -cos yaw), so a look at (+1411, +9900) is yaw -3.0
    const t = vp(0, 0, 30, 1411, 9900, 30);
    expect(viewpointPose(t, flat0).yaw).toBeCloseTo(-3.0, 3);
    const c = new Glide({ pos: { x: 0, y: 30, z: 0 }, yaw: 3.0, pitch: 0 }, t, flat0);
    let prev = 3.0;
    for (let i = 1; i < 50; i++) {
      const y = c.sample((c.duration * i) / 50).yaw;
      expect(Math.abs(y - prev)).toBeLessThan(0.1); // never swings back through zero
      prev = y;
    }
    expect(c.sample(c.duration / 2).yaw).toBeGreaterThan(3.1); // passes through pi
    expect(c.sample(c.duration).yaw).toBeCloseTo(-3.0, 3);
  });
  it('runs every real viewpoint without NaN', () => {
    for (const v of VALLEY.viewpoints) {
      const gl = new Glide(start, v, hills);
      for (let i = 0; i <= 20; i++) {
        const s = gl.sample((gl.duration * i) / 20);
        expect([s.pos.x, s.pos.y, s.pos.z, s.yaw, s.pitch].every(Number.isFinite)).toBe(true);
      }
    }
  });
});
