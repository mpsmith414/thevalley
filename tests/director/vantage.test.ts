import { describe, expect, it } from 'vitest';
import { findVantage, type VantageWorld } from '../../src/director/vantage';
import { surfaceAt } from '../../src/camera/freefly';
import { lineBlocked } from '../../src/views/sight';
import { mulberry32 } from '../../src/util/rng';

/** A synthetic valley: flat ground at 0, a tall hill at (60, 0), a lake disc at (-60, 40), a row of trunks along x = 20. */
function world(over: Partial<{ hill: boolean; trunks: { x: number; z: number; r: number }[] }> = {}): VantageWorld {
  const hill = over.hill ?? true;
  const trunks = over.trunks ?? Array.from({ length: 9 }, (_, i) => ({ x: 20, z: -40 + i * 10, r: 1 }));
  return {
    heightAt: (x, z) => (hill ? 40 * Math.exp(-((x - 60) ** 2 + z ** 2) / 300) : 0),
    isWater: (x, z) => Math.hypot(x + 60, z - 40) < 15,
    waterLevelAt: (x, z) => (Math.hypot(x + 60, z - 40) < 15 ? 1 : NaN),
    trunksNear: (x, z, r) => trunks.filter((t) => Math.hypot(t.x - x, t.z - z) <= r + t.r),
    inside: (x, z) => Math.abs(x) < 200 && Math.abs(z) < 200,
  };
}
const opts = (seed = 1) => ({ dist: [12, 30] as [number, number], up: [3, 8] as [number, number], rng: mulberry32(seed) });
const subjects = [{ x: -60, y: 1, z: 40 }, { x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 90, y: 2, z: 0 }];

describe('findVantage', () => {
  it('never under the ground or the water', () => {
    const w = world();
    for (const pos of subjects) for (let s = 1; s < 6; s++) {
      const p = findVantage({ pos, size: 1 }, w, opts(s)).pos;
      expect(p.y).toBeGreaterThanOrEqual(surfaceAt(w, p.x, p.z) + 1.5);
    }
  });

  it("never within 3 m of a trunk's bark", () => {
    const w = world();
    for (const pos of subjects) for (let s = 1; s < 6; s++) {
      const p = findVantage({ pos, size: 1 }, w, opts(s)).pos;
      expect(w.trunksNear(p.x, p.z, 3)).toHaveLength(0);
    }
  });

  it('keeps sight of the subject', () => {
    const w = world();
    // just behind the hill's crest as seen from the west: the pose must be on the open side
    const pos = { x: 80, y: w.heightAt(80, 0), z: 0 };
    for (let s = 1; s < 6; s++) {
      const v = findVantage({ pos, size: 1 }, w, { ...opts(s), dist: [20, 40] });
      expect(lineBlocked(w, v.pos, { x: pos.x, y: pos.y + 0.4, z: pos.z })).toBe(false);
    }
  });

  it('prefers the sun behind the camera', () => {
    const w = world({ hill: false, trunks: [] });
    const at = { pos: { x: 0, y: 0, z: 0 }, size: 1 };
    expect(findVantage(at, w, { ...opts(), sun: { x: 1, y: 0, z: 0 } }).pos.x).toBeGreaterThan(10);
    expect(findVantage(at, w, { ...opts(), sun: { x: -1, y: 0, z: 0 } }).pos.x).toBeLessThan(-10);
  });

  it('goes higher when nothing at the asked heights passes', () => {
    // a subject in a bowl: the ground rises above the asked heights all round, so only a lifted camera sees it
    const w = { ...world({ hill: false, trunks: [] }), heightAt: (x: number, z: number) => (Math.hypot(x, z) > 8 ? 25 : 0) };
    const v = findVantage({ pos: { x: 0, y: 0, z: 0 }, size: 1 }, w, opts());
    expect(v.pos.y).toBeGreaterThan(8);
    expect(v.pos.y).toBeGreaterThanOrEqual(surfaceAt(w, v.pos.x, v.pos.z) + 1.5);
    expect(Number.isFinite(v.yaw) && Number.isFinite(v.pitch)).toBe(true);
  });

  it('never throws, even when nothing can pass', () => {
    const w = { ...world(), heightAt: () => 1000 };
    expect(() => findVantage({ pos: { x: 0, y: 1000, z: 0 }, size: 1 }, w, opts())).not.toThrow();
  });

  it('looks at the subject', () => {
    const w = world({ hill: false });
    const v = findVantage({ pos: { x: 0, y: 0, z: 0 }, size: 2 }, w, opts());
    const f = { x: -Math.sin(v.yaw) * Math.cos(v.pitch), y: Math.sin(v.pitch), z: -Math.cos(v.yaw) * Math.cos(v.pitch) };
    const to = { x: -v.pos.x, y: 0.8 - v.pos.y, z: -v.pos.z }, l = Math.hypot(to.x, to.y, to.z);
    expect((f.x * to.x + f.y * to.y + f.z * to.z) / l).toBeGreaterThan(0.999);
  });

  it('rejects a spot whose line of sight passes a trunk', () => {
    // one trunk 10 m west of the subject: no pose may sit where the trunk is between it and the subject
    const w = world({ hill: false, trunks: [{ x: -10, z: 0, r: 1 }] });
    for (let s = 1; s < 6; s++) {
      const p = findVantage({ pos: { x: 0, y: 0, z: 0 }, size: 1 }, w, { ...opts(s), dist: [20, 30] }).pos;
      for (let i = 1; i < 20; i++) {
        const t = i / 20;
        expect(w.trunksNear(p.x * (1 - t), p.z * (1 - t), 0.5)).toHaveLength(0);
      }
    }
  });

  it('is deterministic for the same rng', () => {
    const w = world();
    const a = findVantage({ pos: subjects[2], size: 1 }, w, opts(7)), b = findVantage({ pos: subjects[2], size: 1 }, w, opts(7));
    expect(a).toEqual(b);
  });
});
