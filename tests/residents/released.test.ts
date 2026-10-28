import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { arrivalHome, arrivalShot, arrivalView, entryPoints, onwardPoints, pushView } from '../../src/bring/arrival';
import { PUSH } from '../../src/bring/arrival-hold';
import { visit } from '../../src/bring/release';
import { buildBody, type BodyData } from '../../src/builder/build';
import { FreeFly } from '../../src/camera/freefly';
import { viewpointPose } from '../../src/camera/viewpoints';
import type { KidCards } from '../../src/designer/types';
import type { GalleryItem, ValleyRecord } from '../../src/lab/gallery';
import type { Recipe } from '../../src/recipe/schema';
import { Residents } from '../../src/residents/residents';
import { HOMES } from '../../src/sim/homes';
import { VALLEY } from '../../src/valley/layout';
import type { HomeRange, Viewpoint } from '../../src/valley/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { bird, quadruped, snake } from '../fixtures/recipes';
import { smallValleyData } from '../fixtures/valley';

const valley = createValley(smallValleyData(513));

/** Fixture bodies (lowest level of detail, so the builds are quick); a recipe called `broken` fails to build. */
const bodies = { legs: buildBody(quadruped, [2]), wings: buildBody(bird, [2]), fish: buildBody(snake, [2]) };
const builder = {
  async build(r: Recipe): Promise<BodyData> {
    if (r.id === 'broken') throw new Error('no body for you');
    return r.id === 'trout' ? bodies.fish : r.id === 'hawk' || r.id === 'duck' || r.id === 'bird' ? bodies.wings : bodies.legs;
  },
};

const cameraAt = (v: Viewpoint) => {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 8000);
  const pose = viewpointPose(v, valley);
  new FreeFly(pose.pos, pose.yaw, pose.pitch).apply(camera);
  camera.updateMatrixWorld();
  return camera;
};
/** A camera 300 m from `home`, looking on away from it (none of the family is in view, wherever it stands). */
const away = (home: HomeRange) => {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 8000), c = home.center, x = c.x + 300, z = c.z;
  camera.position.set(x, valley.heightAt(x, z) + 20, z);
  camera.lookAt(x + 100, valley.heightAt(x, z) + 20, z);
  camera.updateMatrixWorld();
  return camera;
};
const meadow = cameraAt(VALLEY.viewpoints[1]);
const eye = meadow.getWorldPosition(new Vector3()), ahead = meadow.getWorldDirection(new Vector3());

type Placed = GalleryItem & { valley: ValleyRecord & { home: HomeRange } };
/** A released creature with its arrival home in front of the meadow camera. */
function released(id: string, recipe: Recipe, seeds: [number, number, number] = [11, 22, 33]): Placed {
  const home = arrivalHome(valley, recipe, id, eye, { x: ahead.x, z: ahead.z });
  return {
    id, recipe, cards: { name: 'Spotty Longlegs' } as KidCards, drawing: null, words: '', thumb: null, history: [], createdAt: 1, native: false,
    valley: { status: 'released', home, seeds, releasedAt: 1 },
  };
}

const NATIVES = HOMES.reduce((n, h) => n + h.count, 0);
const at = (res: Residents) => res.animals.map((a) => [a.id, a.rig.position.x, a.rig.position.z]);
const make = (homes = HOMES) => new Residents(valley, VALLEY, homes, builder, 'low', new Scene());

describe('Residents with released creatures', () => {
  it('spawns natives as before plus a family of three per released creature, the same after a reload', async () => {
    const natives = make();
    await natives.spawn();
    const q = released('c-q', quadruped), b = released('c-b', bird, [5, 6, 7]);
    const res = make();
    await res.spawn([q, b]);
    expect(res.animals).toHaveLength(NATIVES + 6);
    expect(res.sim.agents).toHaveLength(NATIVES + 6);
    expect(at(res).slice(0, NATIVES)).toEqual(at(natives)); // natives unchanged
    for (const item of [q, b]) {
      const family = res.familyOf(item.id);
      expect(family.map((a) => a.obj.root.name)).toEqual([0, 1, 2].map((n) => `${item.id}-${n}`)); // looks 0, 1, 2
      for (const a of family) {
        expect(a.home).toBe(item.valley.home);
        expect(a.recipe).toBe(item.recipe);
        expect(a.obj.root.parent).toBe(res.object);
      }
      expect(family.map((a) => res.sim.get(a.id)!.seed)).toEqual(item.valley.seeds); // each from its own saved seed
      expect(new Set(family.map((a) => a.obj.look)).size).toBe(1); // one set of materials per species, owned by the first
    }
    expect(res.familyOf('c-b')[0].rig.flying).toBe(true); // a flier's home is the air: it soars
    // a reload: the same creatures come back the same
    const again = make();
    await again.spawn([q, b]);
    expect(at(again)).toEqual(at(res));
  });

  it('names a released species by its kid card (the moments read it)', async () => {
    const res = make([]);
    const item = released('c-q', quadruped);
    await res.spawn([item]);
    const unnamed = { ...released('c-u', quadruped), cards: undefined as unknown as KidCards };
    await res.addSpecies(unnamed, { compile: async () => {}, entry: entryPoints(valley, unnamed.valley.home, arrivalView(unnamed.valley.home, eye), 3) });
    const said = res.sim.moments.recent().map((m) => m.text).join(' | ');
    expect(said).toContain('A new friend');
    res.sim.ctx.moment('newcomer', res.sim.get('c-q#0')!, [res.sim.get('c-q#0')!], 1, 'meadow');
    expect(res.sim.moments.recent().at(-1)!.text).toContain('Spotty Longlegs');
  });

  it('leaves out a released creature whose body fails to build (the rest still come), and ones not released', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = make();
    const exploring = released('c-x', quadruped);
    exploring.valley.status = 'exploring';
    await res.spawn([released('c-broken', { ...quadruped, id: 'broken' }), released('c-q', quadruped), exploring]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    expect(res.animals).toHaveLength(NATIVES + 3);
    expect(res.sim.agents).toHaveLength(NATIVES + 3);
    expect(res.familyOf('c-broken')).toEqual([]);
    expect(res.familyOf('c-x')).toEqual([]);
    expect(res.familyOf('c-q')).toHaveLength(3);
  });

  it('compiles a new family before it is shown, then starts it at its entry points', async () => {
    const res = make();
    await res.spawn();
    const item = released('c-q', quadruped);
    const home = item.valley.home, view = arrivalView(home, eye);
    const entry = entryPoints(valley, home, view, 3);
    let compiled: { children: number; inScene: boolean; animals: number; agents: number } | null = null;
    await res.addSpecies(item, {
      entry,
      compile: async (root) => {
        let meshes = 0, hidden = 0;
        root.traverse((o) => ((o as { isMesh?: boolean }).isMesh ? (meshes++, o.visible || hidden++) : 0));
        expect(meshes).toBeGreaterThan(0);
        expect(hidden, 'every level of detail drawable while compiling').toBe(0);
        compiled = { children: root.children.length, inScene: root.parent === res.object, animals: res.animals.length, agents: res.sim.agents.length };
      },
    });
    expect(compiled).toEqual({ children: 3, inScene: false, animals: NATIVES, agents: NATIVES }); // compiled before it joined the valley
    const family = res.familyOf('c-q');
    expect(family).toHaveLength(3);
    family.forEach((a, k) => {
      expect(a.rig.position.x).toBeCloseTo(entry[k].x, 6);
      expect(a.rig.position.z).toBeCloseTo(entry[k].z, 6);
      expect(a.obj.root.parent).toBe(res.object);
      expect(a.obj.root.name).toBe(`c-q-${k}`);
      expect(res.arriving(a)).toBe('in');
    });
    res.update(0.2, 0.2, cameraAt(view), 10); // its 'added' events: no second body
    expect(res.animals).toHaveLength(NATIVES + 3);
    // (bodies out of view are out of the scene: each one in it is an animal's, and no animal's twice)
    expect(res.object.children.every((c) => res.animals.some((a) => a.obj.root === c))).toBe(true);
    expect(new Set(res.object.children).size).toBe(res.object.children.length);
  });

  it('says which leg of its walk in each animal is on, and when it is leaving', async () => {
    const res = make([]);
    await res.spawn();
    const item = released('c-q', quadruped);
    const home = item.valley.home, shot = arrivalShot(valley, home, eye, quadruped.life.sizeM);
    const entry = entryPoints(valley, home, shot.wide, 3), onward = onwardPoints(valley, home, shot.close, 3)!;
    await res.addSpecies(item, { entry, onward, compile: async () => {} });
    const family = res.familyOf('c-q'), camera = cameraAt(shot.close);
    const legs = family.map(() => new Set<string>());
    for (let f = 0; f < 40 * 15; f++) {
      res.update(1 / 15, 1 / 15, camera, 10);
      family.forEach((a, k) => {
        const g = res.sim.get(a.id)!, leg = res.arriving(a);
        legs[k].add(String(leg));
        if (leg === 'in') expect(g.doing === 'arrive' && g.route.length === 1).toBe(true);
        if (leg === 'onward') expect(g.doing === 'arrive' && g.route.length === 0).toBe(true);
        if (leg === null) expect(g.doing).not.toBe('arrive');
      });
    }
    for (const l of legs) expect([...l]).toEqual(['in', 'onward', 'null']);
    expect(family.some((a) => res.leaving(a))).toBe(false);
    void res.removeSpecies('c-q');
    for (const a of family) expect(res.leaving(a)).toBe(true);
  }, 60_000);

  it('walks the first of a new family into the release picture within about 3 s (Ruling R6), a flier too', async () => {
    for (const recipe of [quadruped, bird]) { // 3 m/s at most: the slowest walk-in
      for (const v of VALLEY.viewpoints.slice(1, 6)) {
        const from = cameraAt(v), dir = from.getWorldDirection(new Vector3());
        const home = arrivalHome(valley, recipe, 'c-w', from.getWorldPosition(new Vector3()), { x: dir.x, z: dir.z });
        const shot = arrivalShot(valley, home, from.position, recipe.life.sizeM);
        const res = make([]);
        await res.spawn();
        const item: Placed = { ...released('c-w', recipe), valley: { status: 'released', home, seeds: [1, 2, 3], releasedAt: 1 } };
        const onward = onwardPoints(valley, home, shot.close, 3) ?? undefined; // as the release does
        await res.addSpecies(item, { compile: async () => {}, entry: entryPoints(valley, home, shot.wide, 3, recipe.life.sizeM), onward });
        // the camera pushes in from the wide framing over PUSH s, as the valley drives it
        const seen = () => res.familyOf('c-w').some((a) => a.band !== 'paused');
        const s = (t: number) => Math.min(1, t / PUSH);
        res.update(1 / 60, 1 / 60, cameraAt(pushView(shot, 0)), 10);
        expect(seen(), `${recipe.id} at ${v.name}: out of the picture at first`).toBe(false);
        let t = 1 / 60;
        for (; t < 10 && !seen(); t += 1 / 60) res.update(1 / 60, 1 / 60, cameraAt(pushView(shot, s(t))), 10);
        // arrival v2 (creature-sized framings that push in, the family walking in to the middle): 1.2–2.9 s
        expect(t, `${recipe.id} at ${v.name}`).toBeLessThan(5);
      }
    }
  }, 60_000);

  it('without entry points (a reload) the family starts at spots in its home', async () => {
    const res = make();
    await res.spawn();
    const item = released('c-q', quadruped);
    await res.addSpecies(item, { compile: async () => {} });
    const fresh = make();
    await fresh.spawn([item]);
    expect(at(res)).toEqual(at(fresh));
    for (const a of res.familyOf('c-q')) expect(res.arriving(a)).toBeNull();
  });

  it('walks a family away from the camera, then removes and disposes it (the materials last)', async () => {
    const res = make();
    const item = released('c-q', quadruped);
    await res.spawn([item]);
    const family = res.familyOf('c-q');
    const c = item.valley.home.center, near = arrivalView(item.valley.home, eye);
    // far enough back (72 m) to see the whole home, so the family is in view when it sets off
    const camera = cameraAt({ ...near, pos: { x: c.x + (near.pos.x - c.x) * 6, z: c.z + (near.pos.z - c.z) * 6, h: 20 } });
    for (let f = 0; f < 15; f++) res.update(1 / 15, 1 / 15, camera, 10);
    expect(family.map((a) => a.band)).not.toContain('paused');
    const order: number[] = [];
    family.forEach((a, k) => {
      const dispose = a.obj.dispose.bind(a.obj);
      a.obj.dispose = () => (order.push(k), dispose());
    });
    const from = camera.getWorldPosition(new Vector3());
    const start = family.map((a) => Math.hypot(a.rig.position.x - from.x, a.rig.position.z - from.z));
    let done = false;
    const leaving = res.removeSpecies('c-q').then(() => (done = true));
    expect(res.removeSpecies('c-q'), 'asked again: the same walk out').toBeInstanceOf(Promise);
    let t = 0;
    for (; t < 25 && !done; t += 1 / 15) {
      res.update(1 / 15, 1 / 15, camera, 10);
      await Promise.resolve();
    }
    await leaving;
    expect(t).toBeLessThanOrEqual(20 + 0.2); // out of view, or 20 s at most
    expect(res.familyOf('c-q')).toEqual([]);
    expect(res.animals).toHaveLength(NATIVES);
    expect(order).toHaveLength(3);
    expect(order.at(-1), 'the first of the species (the materials owner) last').toBe(0);
    for (const [k, a] of family.entries()) {
      expect(a.obj.root.parent).toBeNull();
      expect(Math.hypot(a.rig.position.x - from.x, a.rig.position.z - from.z), `${k} walked away`).toBeGreaterThan(start[k] + 5);
    }
    // no newcomers come for a family that has gone exploring
    for (let f = 0; f < 300; f++) res.update(2, 2, camera, 10 + f / 30);
    expect(res.familyOf('c-q')).toEqual([]);
    // it can come back: a fresh family with its own materials
    await res.addSpecies(item, { compile: async () => {} });
    expect(res.familyOf('c-q')).toHaveLength(3);
    expect(res.familyOf('c-q')[0].obj.look).not.toBe(family[0].obj.look);
  }, 60_000);

  it('removes a family at once when it is already out of view, and leaves the natives be', async () => {
    const res = make();
    const item = released('c-q', quadruped);
    await res.spawn([item]);
    const camera = away(item.valley.home);
    res.update(1 / 15, 1 / 15, camera, 10);
    const natives = res.animals.filter((a) => a.species !== 'c-q');
    const leaving = res.removeSpecies('c-q');
    res.update(1 / 15, 1 / 15, camera, 10);
    res.update(1 / 15, 1 / 15, camera, 10); // the next tick
    await leaving;
    expect(res.animals).toEqual(natives);
    await res.removeSpecies('nobody'); // nothing to remove
    await res.removeSpecies('deer'); // natives stay
    expect(res.familyOf('deer')).toHaveLength(7);
  });

  it('adds a family once when asked twice at the same time (a double release), and fails both if its compile fails', async () => {
    const res = make();
    await res.spawn();
    const item = released('c-q', quadruped);
    let compiles = 0;
    const compile = async () => void compiles++;
    await Promise.all([res.addSpecies(item, { compile }), res.addSpecies(item, { compile })]);
    expect(res.familyOf('c-q')).toHaveLength(3);
    expect(compiles).toBe(1);
    expect(res.animals).toHaveLength(NATIVES + 3);
    await res.addSpecies(item, { compile }); // already in the valley
    expect(compiles).toBe(1);
    expect(res.animals).toHaveLength(NATIVES + 3);
    const other = released('c-z', quadruped);
    const failing = async () => Promise.reject(new Error('no pipelines'));
    const both = await Promise.allSettled([res.addSpecies(other, { compile: failing }), res.addSpecies(other, { compile: failing })]);
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(res.familyOf('c-z')).toEqual([]);
    expect(res.sim.agents.filter((g) => g.species === 'c-z')).toEqual([]);
  });

  it('a family sent exploring while it is still being added never stays', async () => {
    const res = make();
    await res.spawn();
    const item = released('c-q', quadruped);
    const camera = away(item.valley.home); // look away, so it goes at the next tick
    let compiled!: () => void;
    const adding = res.addSpecies(item, { compile: () => new Promise<void>((r) => (compiled = r)) });
    let gone = false;
    const leaving = res.removeSpecies('c-q').then(() => (gone = true));
    while (!compiled) await Promise.resolve(); // the build is done and the compile has started
    compiled();
    await adding;
    for (let f = 0; f < 30 && !gone; f++) {
      res.update(1 / 15, 1 / 15, camera, 10);
      await new Promise((r) => setTimeout(r, 0));
    }
    await leaving;
    expect(res.familyOf('c-q')).toEqual([]);
    expect(res.animals).toHaveLength(NATIVES);
  });

  it('visit finds no family once all of it has been caught, and finds it again once a newcomer is in', async () => {
    const res = make([]);
    const item = released('c-q', quadruped);
    await res.spawn([item]);
    const glides: Viewpoint[] = [];
    const deps = { residents: res, camera: () => ({ eye, forward: { x: ahead.x, z: ahead.z } }), glideTo: async (v: Viewpoint) => void glides.push(v) };
    expect(visit('c-q', deps)).toBe(true);
    const camera = away(item.valley.home);
    for (const a of res.familyOf('c-q')) res.sim.ctx.become(res.sim.get(a.id)!, 'returning');
    let hours = START_HOUR;
    for (let f = 0; f < 120 && res.familyOf('c-q').length; f++) res.update(0.1, 0.1, camera, (hours += 0.1 / 60));
    expect(res.familyOf('c-q')).toEqual([]);
    expect(visit('c-q', deps)).toBe(false);
    // newcomers come for it (2 to 4 valley hours on), walking in from the edge
    for (let f = 0; f < 400 && !res.familyOf('c-q').length; f++) res.update(1, 1, camera, (hours += 1 / 60));
    expect(res.familyOf('c-q').length).toBeGreaterThan(0);
    expect(res.arriving(res.familyOf('c-q')[0])).toBe('in');
    glides.length = 0;
    expect(visit('c-q', deps)).toBe(true);
    expect(glides).toHaveLength(1);
  }, 60_000);
});
