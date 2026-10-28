import { PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { buildBody, type BodyData } from '../../src/builder/build';
import { FreeFly } from '../../src/camera/freefly';
import { viewpointPose } from '../../src/camera/viewpoints';
import type { Recipe } from '../../src/recipe/schema';
import { Residents } from '../../src/residents/residents';
import { HOMES } from '../../src/sim/homes';
import { TICK } from '../../src/sim/types';
import { VALLEY } from '../../src/valley/layout';
import { createValley } from '../../src/valley/valley';
import { bird, quadruped, snake } from '../fixtures/recipes';
import { smallValleyData } from '../fixtures/valley';

/** Fixture bodies (lowest level of detail, so the builds are quick): legs, wings, or a long swimming body. */
const bodies = { legs: buildBody(quadruped, [2]), wings: buildBody(bird, [2]), fish: buildBody(snake, [2]) };
const fakeBuilder = {
  builds: 0,
  async build(r: Recipe): Promise<BodyData> {
    fakeBuilder.builds++;
    return r.id === 'trout' ? bodies.fish : r.id === 'hawk' || r.id === 'duck' ? bodies.wings : bodies.legs;
  },
};

const valley = createValley(smallValleyData(513));
const NATIVES = HOMES.reduce((n, h) => n + h.count, 0);

function meadowCamera(n = 2) {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 8000);
  const pose = viewpointPose(VALLEY.viewpoints[n - 1], valley);
  new FreeFly(pose.pos, pose.yaw, pose.pitch).apply(camera);
  camera.updateMatrixWorld();
  return camera;
}

/** A camera `back` m off (x, z), 3 m up, looking at it. */
function cameraOn(x: number, z: number, back = 8) {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 8000), y = valley.heightAt(x, z);
  camera.position.set(x + back, y + 3, z);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld();
  return camera;
}

async function spawned() {
  const res = new Residents(valley, VALLEY, HOMES, fakeBuilder, 'low', new Scene());
  await res.spawn();
  return res;
}

describe('Residents', () => {
  it('spawns a resident for every animal of the simulation, building each body once', async () => {
    fakeBuilder.builds = 0;
    const scene = new Scene();
    const res = new Residents(valley, VALLEY, HOMES, fakeBuilder, 'low', scene);
    await res.spawn();
    expect(fakeBuilder.builds).toBe(8);
    expect(res.animals).toHaveLength(res.sim.agents.length);
    expect(res.animals).toHaveLength(NATIVES);
    for (const a of res.animals) {
      const g = res.sim.get(a.id)!;
      expect(a.species).toBe(g.species);
      expect(a.obj.root.name).toBe(`${g.species}-${g.n}`);
      expect(a.home).toBe(HOMES.filter((h) => h.species === g.species)[g.home]);
      expect([a.rig.position.x, a.rig.position.z]).toEqual([g.motion.x, g.motion.z]); // where the simulation put it
      expect(a.obj.root.parent).toBe(res.object);
    }
    expect(res.animals.find((a) => a.species === 'hawk')!.rig.flying).toBe(true);
    expect(res.info().map((i) => i.species).sort()).toEqual(HOMES.flatMap((h) => Array(h.count).fill(h.species)).sort());
    expect(scene.children).toContain(res.object);
  });

  it('updates only the rigs of animals in the full or quarter band', async () => {
    const res = await spawned();
    const camera = meadowCamera(2);
    const spies = res.animals.map((a) => vi.spyOn(a.rig, 'update'));
    const quarterCalls = new Map<string, number>();
    let full = 0, paused = 0;
    for (let f = 0; f < 8; f++) {
      const before = spies.map((s) => s.mock.calls.length);
      res.update(1 / 15, 1 / 15, camera, 9);
      res.animals.forEach((a, i) => {
        const calls = spies[i].mock.calls.length - before[i];
        if (a.band === 'paused') {
          paused++;
          expect(calls, `${a.id} out of view`).toBe(0);
          expect(a.obj.root.visible).toBe(false);
        } else if (a.band === 'full') {
          full++;
          expect(calls, `${a.id} near`).toBeGreaterThan(0);
        } else quarterCalls.set(a.id, (quarterCalls.get(a.id) ?? 0) + calls);
      });
    }
    expect(full).toBeGreaterThan(0);
    expect(paused).toBeGreaterThan(0);
    for (const [id, calls] of quarterCalls) expect(calls, `${id} farther out, every 4th frame`).toBeGreaterThan(0);
  });

  it('takes an out-of-view body out of the scene, and puts it back, in place, when it is back in view', async () => {
    const res = await spawned();
    res.update(1 / 15, 1 / 15, meadowCamera(2), 9);
    const away = res.animals.find((a) => a.band === 'paused')!, near = res.animals.find((a) => a.band === 'full')!;
    expect(away.obj.root.parent).toBeNull();
    expect(near.obj.root.parent).toBe(res.object);
    const g = res.sim.get(away.id)!;
    res.update(1 / 15, 1 / 15, cameraOn(g.motion.x, g.motion.z), 9);
    expect(away.band).not.toBe('paused');
    expect(away.obj.root.parent).toBe(res.object);
    expect(away.obj.root.matrixWorld.elements[12]).toBeCloseTo(away.obj.root.position.x, 6); // where it is shown
    expect(away.obj.root.matrixWorld.elements[14]).toBeCloseTo(away.obj.root.position.z, 6);
  });

  it('clears every animal, so a spawn after a failed one leaves one body for each', async () => {
    const res = await spawned();
    const bodies = res.animals.map((a) => a.obj), freed = bodies.map((o) => vi.spyOn(o, 'dispose'));
    res.clear();
    expect(res.animals).toHaveLength(0);
    expect(res.object.children).toHaveLength(0);
    expect(res.animal('rabbit#0')).toBeUndefined();
    for (const f of freed) expect(f).toHaveBeenCalledOnce();
    await res.spawn();
    expect(res.animals).toHaveLength(NATIVES);
    expect(res.object.children).toHaveLength(NATIVES);
    expect(new Set(res.animals.map((a) => a.id)).size).toBe(NATIVES);
  });

  it('keeps an out-of-view body where its animal is, so whoever follows it (Fly there) finds it', async () => {
    const res = await spawned();
    const camera = meadowCamera(2);
    res.update(1 / 15, 1 / 15, camera, 9);
    const start = new Map(res.animals.map((a) => [a.id, a.obj.root.position.clone()]));
    for (let f = 0; f < 150; f++) res.update(0.037, 0.037, camera, 9);
    const away = res.animals.filter((a) => a.band === 'paused');
    expect(away.length).toBeGreaterThan(0);
    const alpha = res.sim.alpha;
    let moved = 0;
    for (const a of away) {
      const m = res.sim.get(a.id)!.motion, p = res.sim.prev(a.id)!, root = a.obj.root.position;
      expect(root.x, a.id).toBeCloseTo(p.x + (m.x - p.x) * alpha, 9);
      expect(root.z, a.id).toBeCloseTo(p.z + (m.z - p.z) * alpha, 9);
      if (start.get(a.id)!.distanceTo(root) > 0.5) moved++;
    }
    expect(moved, 'some animal moved while out of view').toBeGreaterThan(0);
  });

  it('steps a rig standing still once a frame at Fastest, and one on the move up to four times', async () => {
    const res = await spawned();
    const herd = res.sim.agents.filter((a) => a.species === 'deer'), x = herd[0].motion.x, z = herd[0].motion.z;
    const camera = cameraOn(x, z, 20);
    for (let f = 0; f < 30; f++) res.update(1 / 60, 1 / 60, camera, 9);
    // one near animal fast asleep where it lies, and one on its way somewhere at a walk
    const [sleeper, walker] = res.animals.filter((a) => a.band === 'full' && a.species === 'deer');
    const s = res.sim.get(sleeper.id)!, w = res.sim.get(walker.id)!;
    res.sim.ctx.become(s, 'sleep');
    Object.assign(s, { place: { x: s.motion.x, z: s.motion.z } });
    Object.assign(s.motion, { speed: 0, turnRate: 0 });
    Object.assign(s.pose, { sleep: 1 });
    res.sim.setNeeds(s.id, { tired: 1, fear: 0 });
    Object.assign(sleeper.rig, { speed: 0, turnRate: 0 });
    Object.assign(walker.rig, { speed: 2 });
    Object.assign(w.motion, { speed: 2 });
    const spies = res.animals.map((a) => vi.spyOn(a.rig, 'update'));
    res.update(16 / 60, 1 / 60, camera, 9);
    const calls = (a: typeof sleeper) => spies[res.animals.indexOf(a)].mock.calls.length;
    expect(calls(sleeper)).toBe(1);
    expect(calls(walker)).toBe(4);
    for (const a of res.animals) expect(calls(a), a.id).toBeLessThanOrEqual(4);
  });

  it('drives each rig to the motion smoothed between the last two ticks, the heading the short way round', async () => {
    const res = await spawned();
    const camera = meadowCamera(2);
    for (let f = 0; f < 10; f++) res.update(0.037, 0.037, camera, 9);
    expect(res.sim.alpha).toBeGreaterThan(0);
    const near = res.animals.filter((a) => a.band === 'full');
    expect(near.length).toBeGreaterThan(0);
    const alpha = res.sim.alpha;
    for (const a of res.animals) {
      const m = res.sim.get(a.id)!.motion, p = res.sim.prev(a.id)!;
      expect(a.rig.position.x, a.id).toBeCloseTo(p.x + (m.x - p.x) * alpha, 9);
      expect(a.rig.position.z, a.id).toBeCloseTo(p.z + (m.z - p.z) * alpha, 9);
      const d = Math.atan2(Math.sin(m.yaw - p.yaw), Math.cos(m.yaw - p.yaw));
      expect(a.rig.yaw, a.id).toBeCloseTo(p.yaw + d * alpha, 9);
    }
  });

  it('leaves every rig untouched while the animals are paused (dtAnimal 0)', async () => {
    const res = await spawned();
    const camera = meadowCamera(2);
    for (let f = 0; f < 5; f++) res.update(1 / 15, 1 / 15, camera, 9);
    const spies = res.animals.map((a) => vi.spyOn(a.rig, 'update'));
    const at = () => res.animals.map((a) => [a.rig.position.x, a.rig.position.z, a.obj.root.position.y]);
    const before = at(), t = res.sim.state().t;
    for (let f = 0; f < 5; f++) res.update(0, 1 / 15, camera, 9);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(at()).toEqual(before);
    expect(res.sim.state().t).toBe(t);
  });

  it('hands the simulation at most 2 animal seconds a frame', async () => {
    const res = await spawned();
    res.update(100, 1 / 60, meadowCamera(2), 9);
    expect(res.sim.state().t).toBeGreaterThan(2 - TICK);
    expect(res.sim.state().t).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('a removed animal is disposed; one that made its species materials keeps them while the others wear them', async () => {
    const res = await spawned();
    const owner = res.animals.find((a) => a.id === 'rabbit#0')!, other = res.animals.find((a) => a.id === 'rabbit#1')!;
    const g = res.sim.get(other.id)!;
    const camera = cameraOn(g.motion.x, g.motion.z);
    res.update(1 / 15, 1 / 15, camera, 9);
    expect(other.band).toBe('full');
    const disposed = { owner: vi.spyOn(owner.obj, 'dispose'), other: vi.spyOn(other.obj, 'dispose') };
    res.sim.ctx.become(g, 'returning');
    res.sim.ctx.become(res.sim.get(owner.id)!, 'returning');
    let sank = false;
    for (let t = 0; t < 8 && res.sim.get(other.id); t += 1 / 15) {
      res.update(1 / 15, 1 / 15, camera, 9);
      const agent = res.sim.get(other.id);
      if (agent && agent.sink > 0.3 && other.band === 'full') {
        // it sinks into the ground as it goes back to the earth (lying down, and below that)
        const { x, z } = other.rig.position, k = other.rig.restHeight + other.recipe.life.sizeM * 0.3;
        expect(other.obj.root.position.y).toBeLessThan(valley.heightAt(x, z) - agent.sink * k * 0.8);
        sank = true;
      }
    }
    expect(sank).toBe(true);
    for (const a of [owner, other]) {
      expect(res.animals).not.toContain(a);
      expect(res.familyOf('rabbit')).not.toContain(a);
      expect(a.obj.root.parent).toBeNull();
    }
    expect(disposed.other).toHaveBeenCalledOnce();
    expect(disposed.owner, 'the other rabbits still wear its materials').not.toHaveBeenCalled();
    expect(res.animals).toHaveLength(res.sim.agents.length);
  });

  it('a flier back in view after its height changed unseen keeps a sane pitch, paused or not', async () => {
    const res = await spawned();
    const hawk = res.animals.find((a) => a.species === 'hawk')!, g = res.sim.get(hawk.id)!;
    /** A camera 40 m off the hawk, level with it, looking at it (or, `away`, the other way). */
    const camera = (away = false) => {
      const c = new PerspectiveCamera(55, 16 / 9, 0.1, 8000), { x, z } = g.motion, y = valley.heightAt(x, z) + g.motion.altitude;
      c.position.set(x + 40, y, z);
      c.lookAt(away ? x + 80 : x, y, z);
      c.updateMatrixWorld();
      return c;
    };
    for (const dt of [0, 1 / 60]) {
      res.update(1 / 15, 1 / 15, camera(), 9);
      expect(hawk.band).toBe('full');
      expect(hawk.rig.flying).toBe(true);
      res.update(0.1, 0.1, camera(true), 9);
      expect(hawk.band).toBe('paused');
      g.motion.altitude += 5; // up 5 m while nobody saw
      res.sim.prev(hawk.id)!.altitude = g.motion.altitude;
      res.update(dt, 1 / 60, camera(), 9);
      expect(hawk.band).toBe('full');
      const pitch = hawk.obj.root.rotation.x;
      expect(Number.isFinite(pitch), `dt ${dt}`).toBe(true);
      expect(Math.abs(pitch), `dt ${dt}`).toBeLessThan(0.5);
      if (dt === 0) {
        res.update(0, 1 / 60, camera(), 9); // and it stays sane through the pause
        expect(Math.abs(hawk.obj.root.rotation.x)).toBeLessThan(0.5);
      }
    }
  });

  it('does not draw an animal hiding under the water', async () => {
    const res = await spawned();
    const frog = res.animals.find((a) => a.species === 'frog')!, g = res.sim.get(frog.id)!, c = frog.home.center;
    let wet: { x: number; z: number } | null = null;
    for (let r = 2; !wet && r < 80; r += 2) {
      for (let k = 0; k < 16 && !wet; k++) {
        const x = c.x + Math.cos((k * Math.PI) / 8) * r, z = c.z + Math.sin((k * Math.PI) / 8) * r;
        if (valley.isWater(x, z)) wet = { x, z };
      }
    }
    expect(wet).not.toBeNull();
    Object.assign(g.motion, { x: wet!.x, z: wet!.z, target: null });
    Object.assign(res.sim.prev(frog.id)!, g.motion);
    g.doing = 'hide';
    const camera = cameraOn(wet!.x, wet!.z);
    res.update(0.01, 0.01, camera, 9); // under a tick: the simulation does not move on
    expect(frog.band).not.toBe('paused');
    expect(frog.obj.root.visible).toBe(false);
    g.doing = 'watch';
    res.update(0.01, 0.01, camera, 9);
    expect(frog.obj.root.visible).toBe(true);
  });

  it('is deterministic', async () => {
    const run = async () => {
      const res = await spawned();
      const camera = meadowCamera(1);
      for (let f = 0; f < 300; f++) res.update(1 / 30, 1 / 30, camera, 12);
      return res.info().map((i) => [i.id, i.doing, i.position.x.toFixed(4), i.position.z.toFixed(4), i.position.y.toFixed(4)]);
    };
    expect(await run()).toEqual(await run());
  });
});
