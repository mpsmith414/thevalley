import { describe, expect, it } from 'vitest';
import { CAMERA_FOV, cutaway, establishing, framingDistance, group, groupSpread, trackingFraming } from '../../src/director/shots';
import type { AgentView } from '../../src/director/types';
import type { VantageWorld } from '../../src/director/vantage';
import { mulberry32 } from '../../src/util/rng';
import type { Vec3 } from '../../src/util/vec';
import { movePose } from '../../src/views/directed';
import { FollowCam, followFraming } from '../../src/views/follow';
import type { Pose } from '../../src/views/types';

/** Flat open ground, no trees, no water. */
const flat: VantageWorld = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, trunksNear: () => [], inside: () => true };

const agent = (id: string, x: number, z: number, size: number): AgentView => ({ id, species: id.split('#')[0], name: id, native: true,
  released: false, doing: 'walk', group: null, focus: null, pos: { x, y: 0, z }, size, bodyLength: size * 0.8, flying: false, altitude: 0,
  swimmer: false, wet: false, hunter: false, grazer: false, plural: false });

/** How much of the picture's height something `size` m across fills, seen from `d` m away. */
const fill = (size: number, d: number) => size / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360) * d);
const away = (p: Pose, at: Vec3) => Math.hypot(p.pos.x - at.x, p.pos.y - at.y, p.pos.z - at.z);

describe('framingDistance', () => {
  it('a 1 m subject filling half a 60° picture is ≈ 1.73 m off; it doubles with size and halves with fill', () => {
    expect(framingDistance(1, 0.5, 60)).toBeCloseTo(Math.sqrt(3), 3);
    expect(framingDistance(2, 0.5, 60)).toBeCloseTo(2 * framingDistance(1, 0.5, 60));
    expect(framingDistance(1, 1, 60)).toBeCloseTo(framingDistance(1, 0.5, 60) / 2);
  });

  it('the camera is the valley\'s own (55° vertical)', () => {
    expect(CAMERA_FOV).toBe(55);
  });
});

describe('groupSpread', () => {
  it('the largest distance between members, at least the animal\'s size', () => {
    expect(groupSpread([{ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }, { x: 6, y: 0, z: 16 }], 1.6)).toBeCloseTo(Math.hypot(6, 16));
    expect(groupSpread([{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }], 0.55)).toBe(0.55);
    expect(groupSpread([], 1)).toBe(1);
  });
});

describe('framing by size', () => {
  it('establishing: a frog much nearer than a deer, each filling 0.12–0.2 of the picture all through the drift', () => {
    const near = (size: number, seed: number) => {
      const s = { pos: { x: 0, y: 0, z: 0 }, size };
      const m = establishing(s, flat, mulberry32(seed), { x: 500, y: 0, z: 500 }, 8);
      const aim = { x: 0, y: size * 0.4, z: 0 };
      const ds = [0, 0.5, 1].map((f) => away(movePose(m, m.s * f, flat), aim));
      for (const d of ds) {
        expect(fill(size, d)).toBeGreaterThanOrEqual(0.12 - 1e-3);
        expect(fill(size, d)).toBeLessThanOrEqual(0.2 + 1e-3);
      }
      for (const f of [0, 0.5, 1]) expect(movePose(m, m.s * f, flat).pos.y).toBeGreaterThanOrEqual(1.5);
      return ds[0];
    };
    for (let seed = 1; seed <= 6; seed++) {
      const frog = near(0.3, seed), deer = near(1.6, seed);
      expect(frog).toBeLessThan(deer / 2);
    }
  });

  it('a group shot of a herd spread over 20 m frames the whole spread at 0.35–0.5 of the picture', () => {
    const herd: Vec3[] = [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, { x: 3, y: 0, z: -3 }];
    for (let seed = 1; seed <= 6; seed++) {
      const m = group(herd, 1.6, flat, mulberry32(seed), { x: 300, y: 0, z: 300 }, 15);
      const centre = { x: herd.reduce((a, p) => a + p.x, 0) / 4, y: 0, z: herd.reduce((a, p) => a + p.z, 0) / 4 };
      for (const f of [0, 0.5, 1]) {
        const d = away(movePose(m, m.s * f, flat), centre);
        expect(fill(20, d)).toBeGreaterThanOrEqual(0.35 - 0.02);
        expect(fill(20, d)).toBeLessThanOrEqual(0.5 + 0.02);
      }
    }
  });

  it('a bystander cut-away fills 0.2–0.3 of the picture with the bystander', () => {
    const hunt = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
    let seen = 0;
    for (const size of [0.55, 1.6]) for (let seed = 1; seed <= 30; seed++) {
      const b = agent('duck#0', 0, 30, size), from: Pose = { pos: { x: 0, y: 3, z: 70 }, yaw: 0, pitch: 0 };
      const c = cutaway({ from, away: hunt, bystanders: [b], world: flat, rng: mulberry32(seed), s: 8 });
      if (c.subject === null) continue; // the sky and the treeline instead: unchanged
      seen++;
      const d = away(movePose(c.move, 0, flat), { x: 0, y: size * 0.4, z: 30 });
      expect(fill(size, d)).toBeGreaterThanOrEqual(0.2 - 1e-3);
      expect(fill(size, d)).toBeLessThanOrEqual(0.3 + 1e-3);
    }
    expect(seen).toBeGreaterThan(4);
  });

  it('the chase framing on a 0.9 m fox never stands beyond where the fox fills 0.1 of the picture', () => {
    const fox = agent('fox#0', 0, 0, 0.9), rng = mulberry32(3);
    const wide = trackingFraming(rng, fox, true);
    expect(wide.wide).toBe(true);
    const cap = framingDistance(0.9, 0.1, CAMERA_FOV);
    expect(wide.farthest).toBeCloseTo(cap);
    // the side-on and low framings carry the same cap, and up close the framing is unchanged (Follow's own spot is nearer)
    for (let i = 0; i < 10; i++) expect(trackingFraming(rng, fox).farthest).toBeCloseTo(cap);
    const { back, up } = followFraming(0.9);
    expect(Math.hypot(back, up)).toBeLessThan(cap);

    // riding along: a fox running in a straight line, the camera in the chase framing, never farther than the cap
    const target = { x: 0, y: 0, z: 0 }, cam = new FollowCam({ x: 0, y: 3, z: 10 }, { ...target }, target, 0.9);
    let most = 0;
    for (let f = 0; f < 600; f++) {
      target.z -= 10 / 60;
      const p = cam.update(1 / 60, { ...target }, flat, wide);
      if (f > 240) most = Math.max(most, away(p, { ...target, y: target.y + followFraming(0.9).lookUp }));
    }
    expect(most).toBeLessThanOrEqual(cap + 0.3);
    expect(most).toBeGreaterThan(cap * 0.8); // still the wide framing, only brought in
  });

  it('Follow without a cap (the player\'s own) is as it was: the chase framing stands 2.5 times back', () => {
    const target = { x: 0, y: 0, z: 0 }, cam = new FollowCam({ x: 0, y: 3, z: 10 }, { ...target }, target, 0.9);
    let p: Pose | null = null;
    for (let f = 0; f < 600; f++) (target.z -= 10 / 60), (p = cam.update(1 / 60, { ...target }, flat, { wide: true }));
    const { back } = followFraming(0.9);
    expect(Math.hypot(p!.pos.x - target.x, p!.pos.z - target.z)).toBeGreaterThan(back * 2.3);
  });
});
