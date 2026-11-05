import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import { viewpointPose } from '../../src/camera/viewpoints';
import { deer } from '../../src/cast/deer';
import { VALLEY } from '../../src/valley/layout';
import { NEUTRAL_GRADE, type Grade } from '../../src/render/grade';
import { MAP_FOV, MAP_NIGHT_COOL, Dive, nightGrade, diveTo, mapPose, markers, places, snap, speciesColour, type MapAnimal, type Marker } from '../../src/views/map';
import type { Pose } from '../../src/views/types';

/** A gently sloping dry world with no trees, 1600 m across. */
const world: FlyWorld = { heightAt: (x) => 10 + x * 0.01, isWater: () => false, waterLevelAt: () => NaN, inside: (x, z, m = 0) => Math.abs(x) <= 800 - m && Math.abs(z) <= 800 - m, trunksNear: () => [] };
const animal = (id: string, x: number, z: number, over: Partial<MapAnimal> = {}): MapAnimal => ({ id, species: 'deer', name: 'Deer', released: false, x, z, ...over });
/** A camera standing at `p` (the valley camera's field of view), its matrices up to date. */
function cameraAt(p: Pose, aspect: number) {
  const c = new PerspectiveCamera(MAP_FOV, aspect, 0.1, 8000);
  c.position.set(p.pos.x, p.pos.y, p.pos.z);
  c.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}
const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
};

describe('the overview map', () => {
  it('merges five deer within 40 m into one "Deer 5"', () => {
    const m = markers([animal('d0', 0, 0), animal('d1', 20, 5), animal('d2', 35, 0), animal('d3', 50, 20), animal('d4', 70, 10)]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ label: 'Deer 5', species: 'deer', star: false });
    expect([...m[0].ids].sort()).toEqual(['d0', 'd1', 'd2', 'd3', 'd4']);
    expect(m[0].x).toBeCloseTo(35, 5); // the middle of the group
  });

  it('keeps two groups 100 m apart apart, and other species apart', () => {
    const m = markers([animal('a', 0, 0), animal('b', 10, 0), animal('c', 110, 0), animal('d', 120, 0), animal('r', 5, 0, { species: 'rabbit', name: 'Rabbit' })]);
    expect(m.map((k) => k.label).sort()).toEqual(['Deer 2', 'Deer 2', 'Rabbit']);
  });

  it('never merges a released creature: a star with its name', () => {
    const m = markers([animal('a', 0, 0), animal('b', 5, 0, { species: 'g1', name: 'Bramble', released: true }), animal('c', 6, 0, { species: 'g1', name: 'Bramble', released: true })]);
    const stars = m.filter((k) => k.star);
    expect(stars).toHaveLength(2);
    expect(stars.every((k) => k.label === 'Bramble' && k.ids.length === 1)).toBe(true);
    expect(m.find((k) => !k.star)!.label).toBe('Deer');
  });

  it('snaps the cursor to the nearest marker within 40 px, and to none beyond', () => {
    const mk = (x: number, label: string): Marker => ({ ids: [label], species: 'deer', label, star: false, x, z: 0 });
    const ms = [mk(100, 'near'), mk(130, 'far')];
    const screen = (p: { x: number; z: number }) => ({ x: p.x, z: 500 }); // world x is screen x
    expect(snap({ x: 110, z: 500 }, ms, screen)?.label).toBe('near');
    expect(snap({ x: 125, z: 510 }, ms, screen)?.label).toBe('far');
    expect(snap({ x: 200, z: 500 }, ms, screen)).toBeNull();
    expect(snap({ x: 100, z: 545 }, ms, screen)).toBeNull();
  });

  it('frames the whole valley at zoom 0, about 75° down with north up, high over its middle', () => {
    const p = mapPose(1600, 16 / 9, 0, { x: 0, z: 0 });
    expect(p.pitch).toBeCloseTo((-75 * Math.PI) / 180, 6);
    expect(p.yaw).toBe(0); // facing −z: north up
    expect(p.pos.y).toBeGreaterThan(1000); // the 55° camera needs about 1.5 km to see the 1.6 km valley whole at this slant
    expect(p.pos.y).toBeLessThan(1600);
    expect(Math.abs(p.pos.x)).toBeLessThan(1e-9);
    const c = cameraAt(p, 16 / 9);
    for (const [x, z] of [[-800, -800], [800, -800], [-800, 800], [800, 800]]) {
      const v = new Vector3(x, 0, z).project(c);
      expect(Math.abs(v.x), `${x}, ${z}`).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y), `${x}, ${z}`).toBeLessThanOrEqual(1);
      expect(v.z).toBeLessThan(1);
    }
    // zoomed right in it sees about a third of it, and can be panned
    const near = mapPose(1600, 16 / 9, 1, { x: 300, z: -200 });
    expect(near.pos.y).toBeCloseTo(p.pos.y / 3, 0);
    expect(near.pos.x).toBeCloseTo(300, 6);
  });

  it('dives down to a spot 30 m back and 15 m above a point, looking at it', () => {
    const at = { x: 100, z: -50 }, v = diveTo(at, world), pose = viewpointPose(v, world);
    expect(Math.hypot(v.pos.x - at.x, v.pos.z - at.z)).toBeCloseTo(30, 6);
    expect(pose.pos.y - world.heightAt(pose.pos.x, pose.pos.z)).toBeCloseTo(15, 6);
    const ahead = { x: -Math.sin(pose.yaw) * Math.cos(pose.pitch), y: Math.sin(pose.pitch), z: -Math.cos(pose.yaw) * Math.cos(pose.pitch) };
    const to = { x: at.x - pose.pos.x, y: world.heightAt(at.x, at.z) - pose.pos.y, z: at.z - pose.pos.z }, n = Math.hypot(to.x, to.y, to.z);
    expect(ahead.x * to.x + ahead.y * to.y + ahead.z * to.z).toBeCloseTo(n, 6); // straight at it
    // at the valley's southern edge the spot turns round to stay inside
    const edge = diveTo({ x: 0, z: 790 }, world);
    expect(world.inside(edge.pos.x, edge.pos.z)).toBe(true);
  });

  it('dives in 2–3 s, landing exactly on the spot and never under the ground', () => {
    const from = mapPose(1600, 16 / 9, 0, { x: 0, z: 0 }), to = viewpointPose(diveTo({ x: -300, z: 200 }, world), world);
    const d = new Dive(from, to, world);
    expect(d.duration).toBeGreaterThanOrEqual(2);
    expect(d.duration).toBeLessThanOrEqual(3);
    for (let t = 0; t < d.duration; t += 0.05) {
      const p = d.sample(t);
      expect(p.pos.y).toBeGreaterThan(world.heightAt(p.pos.x, p.pos.z));
      expect(p.done).toBe(false);
    }
    const end = d.sample(d.duration);
    expect(end.done).toBe(true);
    expect(end.pos).toEqual(to.pos);
  });

  it("lifts a dark coat's colour to at least 55% lightness", () => {
    const dark = structuredClone(deer);
    dark.skin.regions[0].color = '#2a1a10';
    const c = speciesColour(dark);
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightness(c)).toBeGreaterThanOrEqual(0.55 - 1 / 255);
    expect(lightness(speciesColour(deer))).toBeGreaterThanOrEqual(0.55 - 1 / 255);
  });

  it("cools the night's grade into the map's own, in place: its arrays are its own and none is made", () => {
    const g: Grade = { ...NEUTRAL_GRADE, warmth: 0.25, lift: [0.025, 0.027, 0.032], gamma: [1, 1, 1], gain: [1, 0.98, 1], saturation: 0.7 };
    const out = structuredClone(NEUTRAL_GRADE), arrays = [out.lift, out.gamma, out.gain];
    expect(nightGrade(g, 0.5, out)).toBe(out);
    expect(out).toEqual({ ...g, warmth: 0.25 - MAP_NIGHT_COOL * 0.5 });
    expect([out.lift, out.gamma, out.gain]).toEqual(arrays);
    expect(out.lift).toBe(arrays[0]); // the same arrays, filled
    expect(out.gain).not.toBe(g.gain);
  });

  it("names the valley's places: the viewpoints but the overview, and the lake, the river and the forest", () => {
    const names = places(VALLEY).map((p) => p.name);
    expect(names).toEqual(['Lake Shore', 'Meadow', 'Ridge Top', 'River Bend', 'Forest Floor', 'Beach', 'Rocky Knoll', 'Lake', 'River', 'Forest']);
  });
});
