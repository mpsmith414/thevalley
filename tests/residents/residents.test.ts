import { PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody, type BodyData } from '../../src/builder/build';
import { viewpointPose } from '../../src/camera/viewpoints';
import { FreeFly } from '../../src/camera/freefly';
import { CAST } from '../../src/cast';
import type { Recipe } from '../../src/recipe/schema';
import { Residents, wantedAction } from '../../src/residents/residents';
import { mulberry32 } from '../../src/util/rng';
import { VALLEY } from '../../src/valley/layout';
import { TILE_SIZE, type TileData } from '../../src/valley/types';
import { createValley, type Valley } from '../../src/valley/valley';
import { bird, quadruped, snake } from '../fixtures/recipes';
import { smallValleyData } from '../fixtures/valley';

const recipe = (id: string) => CAST.find((c) => c.recipe.id === id)!.recipe;

describe('wantedAction', () => {
  const draws = (r: Recipe, hour: number, seed: number, n = 400) => {
    const rng = mulberry32(seed);
    return Array.from({ length: n }, () => wantedAction(r, hour, rng));
  };

  it('is deterministic', () => {
    for (const c of CAST) for (const h of [3, 5, 12, 19.5, 23]) expect(draws(c.recipe, h, 7, 50)).toEqual(draws(c.recipe, h, 7, 50));
  });

  it('puts day animals to bed at night, and wakes them by day', () => {
    for (const id of ['hawk', 'duck']) {
      expect(new Set(draws(recipe(id), 23, 1))).toEqual(new Set(['sleep']));
      expect(draws(recipe(id), 12, 2)).not.toContain('sleep');
    }
  });

  it('never calls at night', () => {
    for (const c of CAST) for (const h of [23, 0.5, 1.5]) expect(draws(c.recipe, h, 3)).not.toContain('call');
  });

  it('keeps twilight animals busy at dawn and dusk, and half asleep at midday and deep night', () => {
    const deer = recipe('deer');
    for (const h of [4.3, 20.6]) expect(draws(deer, h, 4)).not.toContain('sleep');
    for (const h of [13, 0.5]) {
      const sleeping = draws(deer, h, 5, 1000).filter((a) => a === 'sleep').length / 1000;
      expect(sleeping).toBeGreaterThan(0.4);
      expect(sleeping).toBeLessThan(0.6);
    }
  });

  it('mostly wanders, sometimes eats or calls', () => {
    const all = draws(recipe('fox'), 7.5, 6, 2000);
    const share = (a: string) => all.filter((x) => x === a).length / all.length;
    expect(share('wander')).toBeGreaterThan(0.8);
    expect(share('eat')).toBeGreaterThan(0.06);
    expect(share('call')).toBeGreaterThan(0.02);
  });
});

// ---------- the residents in a small valley, with a fake builder ----------

/** Fixture bodies (lowest level of detail, so the builds are quick): legs, wings, or a long swimming body. */
const bodies = { legs: buildBody(quadruped, [2]), wings: buildBody(bird, [2]), fish: buildBody(snake, [2]) };
const fakeBuilder = {
  builds: 0,
  async build(r: Recipe): Promise<BodyData> {
    fakeBuilder.builds++;
    return r.id === 'trout' ? bodies.fish : r.id === 'hawk' || r.id === 'duck' ? bodies.wings : bodies.legs;
  },
};

/** The small valley with a scattered wood of trunks over the deer, rabbit and fox homes (no trunks in the water). */
function woodedValley(): Valley {
  const data = smallValleyData(513);
  const bare = createValley(data);
  const rng = mulberry32(99);
  const tiles: TileData[] = [];
  const empty = { kind: new Uint8Array(0), variant: new Uint8Array(0), data: new Float32Array(0) };
  for (let tx = 4; tx <= 11; tx++) for (let tz = 12; tz <= 18; tz++) {
    const trunks: number[] = [];
    for (let k = 0; k < 40; k++) {
      const x = -800 + (tx + rng()) * TILE_SIZE, z = -800 + (tz + rng()) * TILE_SIZE;
      if (!bare.isWater(x, z)) trunks.push(x, z, 0.2 + rng() * 0.3);
    }
    tiles.push({ tx, tz, plants: empty, trunks: new Float32Array(trunks) });
  }
  return createValley({ ...data, tiles });
}

const valley = woodedValley();

function meadowCamera(n = 2) {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 8000);
  const pose = viewpointPose(VALLEY.viewpoints[n - 1], valley);
  new FreeFly(pose.pos, pose.yaw, pose.pitch).apply(camera);
  camera.updateMatrixWorld();
  return camera;
}

const wetNear = (x: number, z: number) =>
  Array.from({ length: 8 }, (_, k) => valley.isWater(x + Math.cos((k * Math.PI) / 4) * 6, z + Math.sin((k * Math.PI) / 4) * 6)).some(Boolean);
const inTrunk = (x: number, z: number) => valley.trunksNear(x, z, 0).length > 0;

describe('Residents', () => {
  it('spawns every home animal where it belongs, building each body once', async () => {
    fakeBuilder.builds = 0;
    const scene = new Scene();
    const res = new Residents(valley, VALLEY, fakeBuilder, 'low', scene);
    await res.spawn();
    expect(res.animals).toHaveLength(18);
    expect(fakeBuilder.builds).toBe(8);
    for (const a of res.animals) {
      const { x, z } = a.rig.position, h = a.home;
      expect(Math.hypot(x - h.center.x, z - h.center.z), a.species).toBeLessThanOrEqual(h.radius);
      if (h.medium === 'water') expect(valley.waterDepthAt(x, z), a.species).toBeGreaterThanOrEqual(0.6);
      else expect(valley.isWater(x, z), a.species).toBe(false);
      if (h.medium === 'shore') expect(wetNear(x, z), a.species).toBe(true);
      if (h.medium === 'land' || h.medium === 'shore') expect(inTrunk(x, z), a.species).toBe(false);
    }
    expect(res.animals.find((a) => a.species === 'hawk')!.rig.flying).toBe(true);
    expect(res.info().map((i) => i.species).sort()).toEqual(VALLEY.homes.flatMap((h) => Array(h.count).fill(h.species)).sort());
    expect(scene.children).toContain(res.object);
  });

  it('keeps land animals on land, fish in water and everyone out of the trunks for 600 s', async () => {
    const res = new Residents(valley, VALLEY, fakeBuilder, 'low', new Scene());
    await res.spawn();
    const camera = meadowCamera(2);
    const dt = 1 / 15;
    const moved = new Set<number>();
    const start = res.animals.map((a) => a.rig.position.clone());
    for (let f = 0; f < 600 / dt; f++) {
      res.update(dt, camera, 9 + (f * dt) / 3600);
      if (f % 5) continue;
      res.animals.forEach((a, i) => {
        const { x, z } = a.rig.position;
        if (a.home.medium === 'land') expect(valley.isWater(x, z), `${a.species} ${i} at ${f}`).toBe(false);
        if (a.species === 'trout') expect(valley.isWater(x, z), `${a.species} ${i} at ${f}`).toBe(true);
        if (!a.rig.flying) expect(inTrunk(x, z), `${a.species} ${i} at ${f}`).toBe(false);
        if (a.rig.position.distanceTo(start[i]) > 2) moved.add(i);
      });
    }
    // the animals in view were alive
    const seen = res.info().filter((i) => i.band !== 'paused');
    expect(seen.length).toBeGreaterThan(3);
    for (const [i, a] of res.animals.entries()) if (res.info()[i].band === 'full') expect(moved.has(i), a.species).toBe(true);
  }, 120_000);

  it('hides animals out of view, and lets them drift within their homes after a minute', async () => {
    const res = new Residents(valley, VALLEY, fakeBuilder, 'low', new Scene());
    await res.spawn();
    const camera = meadowCamera(2);
    camera.rotation.y += Math.PI; // look away from the meadow
    camera.updateMatrixWorld();
    const start = res.animals.map((a) => a.rig.position.clone());
    res.update(0.1, camera, 9);
    const hidden = res.animals.filter((_, i) => res.info()[i].band === 'paused');
    expect(hidden.length).toBeGreaterThan(5);
    for (const a of hidden) expect(a.obj.root.visible).toBe(false);
    for (let t = 0; t < 50; t += 0.5) res.update(0.5, camera, 9);
    expect(hidden.every((a) => a.rig.position.equals(start[res.animals.indexOf(a)]))).toBe(true); // frozen for the first minute
    for (let t = 0; t < 300; t += 0.5) res.update(0.5, camera, 9);
    const drifted = hidden.filter((a) => !a.rig.position.equals(start[res.animals.indexOf(a)]));
    expect(drifted.length).toBeGreaterThan(hidden.length / 2);
    for (const a of drifted) {
      const { x, z } = a.rig.position;
      expect(Math.hypot(x - a.home.center.x, z - a.home.center.z)).toBeLessThanOrEqual(a.home.radius);
      if (a.home.medium === 'land') expect(valley.isWater(x, z)).toBe(false);
      if (a.species === 'trout') expect(valley.isWater(x, z)).toBe(true);
      expect(a.obj.root.position.x, `${a.species}'s body moved with it`).toBeCloseTo(x, 5); // its body went with it
      expect(a.obj.root.position.z).toBeCloseTo(z, 5);
    }
  });

  it('is deterministic', async () => {
    const run = async () => {
      const res = new Residents(valley, VALLEY, fakeBuilder, 'low', new Scene());
      await res.spawn();
      const camera = meadowCamera(1);
      for (let f = 0; f < 300; f++) res.update(1 / 30, camera, 12);
      return res.info().map((i) => [i.species, i.action, i.position.x.toFixed(4), i.position.z.toFixed(4)]);
    };
    expect(await run()).toEqual(await run());
  });
});
