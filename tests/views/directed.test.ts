import { describe, expect, it } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import { movePose, type Move } from '../../src/views/directed';
import { SWITCH_S, Views, type ViewInput } from '../../src/views/views';
import type { Pose } from '../../src/views/types';

const world: FlyWorld = { heightAt: (x) => (x > 100 ? 50 : 0), isWater: () => false, waterLevelAt: () => NaN, inside: () => true, trunksNear: () => [] };
const A: Pose = { pos: { x: 0, y: 10, z: 0 }, yaw: 0, pitch: -0.2 };
const B: Pose = { pos: { x: 20, y: 30, z: -40 }, yaw: 1, pitch: 0.1 };

describe('movePose', () => {
  it('a hold returns its pose', () => {
    expect(movePose({ kind: 'hold', pose: A, s: 5 }, 3, world)).toEqual(A);
  });

  it('a drift is `from` at 0, `to` at s, and eased between', () => {
    const m: Move = { kind: 'drift', from: A, to: B, s: 10 };
    expect(movePose(m, 0, world)).toEqual(A);
    const end = movePose(m, 10, world);
    expect(end.pos).toEqual(B.pos);
    expect(end.yaw).toBeCloseTo(B.yaw);
    expect(end.pitch).toBeCloseTo(B.pitch);
    expect(movePose(m, 5, world).pos.x).toBeCloseTo(10); // halfway at the middle
    expect(movePose(m, 1, world).pos.x).toBeLessThan(2); // slow at the start (a straight lerp would be 2)
    expect(movePose(m, 99, world).pos).toEqual(B.pos); // past the end stays there
  });

  it('a drift turns the short way round', () => {
    const m: Move = { kind: 'drift', from: { ...A, yaw: 3 }, to: { ...A, yaw: -3 }, s: 2 };
    const mid = movePose(m, 1, world).yaw;
    expect(Math.abs(Math.cos(mid) + 1)).toBeLessThan(0.01); // round through pi, not through 0
  });

  it('an orbit keeps its radius, looks at the centre and turns by `turn`', () => {
    const centre = { x: 5, y: 2, z: -3 };
    const m: Move = { kind: 'orbit', centre, radius: 30, height: 12, yaw0: 0.5, turn: 2, s: 8 };
    for (const t of [0, 2, 4, 8]) {
      const p = movePose(m, t, world);
      expect(Math.hypot(p.pos.x - centre.x, p.pos.z - centre.z)).toBeCloseTo(30);
      expect(p.pos.y).toBeCloseTo(14);
      const d = { x: centre.x - p.pos.x, y: centre.y - p.pos.y, z: centre.z - p.pos.z }, len = Math.hypot(d.x, d.y, d.z);
      const f = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
      expect(f.x * d.x / len + f.y * d.y / len + f.z * d.z / len).toBeCloseTo(1);
    }
    expect(movePose(m, 0, world).yaw).toBeCloseTo(0.5);
    expect(movePose(m, 8, world).yaw).toBeCloseTo(2.5);
  });

  it('no pose goes below the surface + 1.5 m', () => {
    const low: Pose = { pos: { x: 150, y: 0, z: 0 }, yaw: 0, pitch: 0 };
    expect(movePose({ kind: 'hold', pose: low, s: 1 }, 0, world).pos.y).toBeCloseTo(51.5);
    expect(movePose({ kind: 'drift', from: A, to: low, s: 4 }, 4, world).pos.y).toBeCloseTo(51.5);
    expect(movePose({ kind: 'orbit', centre: { x: 150, y: 50, z: 0 }, radius: 10, height: -5, yaw0: 0, turn: 1, s: 1 }, 0.5, world).pos.y).toBeGreaterThanOrEqual(51.5);
  });
});

describe('Views.direct: eased joins', () => {
  const idle: ViewInput = { look: { yaw: 0, pitch: 0 }, zoom: 0, moved: false, any: false };
  const flat: FlyWorld = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, inside: () => true, trunksNear: () => [] };
  const views = () => new Views({ world: flat, animal: () => null, say: () => {}, now: () => 0 });
  const was: Pose = { pos: { x: -30, y: 20, z: 40 }, yaw: -0.5, pitch: -0.3 };
  const m: Move = { kind: 'drift', from: A, to: B, s: 60 };

  it(`with ease, the camera blends from its pose now into the move over that time (${SWITCH_S} s), then plays the move`, () => {
    const v = views();
    v.direct(m, undefined, { ease: SWITCH_S });
    expect(v.update(0, idle, was, 1)).toEqual(was); // the first frame: where the camera was
    const half = v.update(SWITCH_S / 2, idle, was, 1)!, own = movePose(m, SWITCH_S / 2, flat);
    for (const k of ['x', 'y', 'z'] as const) {
      const lo = Math.min(was.pos[k], own.pos[k]), hi = Math.max(was.pos[k], own.pos[k]);
      expect(half.pos[k]).toBeGreaterThan(lo + 0.2 * (hi - lo));
      expect(half.pos[k]).toBeLessThan(hi - 0.2 * (hi - lo));
    }
    expect(half.yaw).toBeGreaterThan(Math.min(was.yaw, own.yaw));
    expect(half.yaw).toBeLessThan(Math.max(was.yaw, own.yaw));
    const after = v.update(SWITCH_S, idle, half, 1)!;
    expect(after).toEqual(movePose(m, SWITCH_S * 1.5, flat)); // the move's own pose
  });

  it('without ease (a cut or a dip) the move starts at once', () => {
    const v = views();
    v.direct(m);
    expect(v.update(0, idle, was, 1)).toEqual(movePose(m, 0, flat));
  });
});
