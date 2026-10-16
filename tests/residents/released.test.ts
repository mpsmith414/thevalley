import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { arrivalHome, arrivalShot, arrivalView, entryPoints, onwardPoints, pushView } from '../../src/bring/arrival';
import { PUSH } from '../../src/bring/arrival-hold';
import { buildBody, type BodyData } from '../../src/builder/build';
import { FreeFly } from '../../src/camera/freefly';
import { viewpointPose } from '../../src/camera/viewpoints';
import type { KidCards } from '../../src/designer/types';
import type { GalleryItem, ValleyRecord } from '../../src/lab/gallery';
import type { Recipe } from '../../src/recipe/schema';
import { Residents } from '../../src/residents/residents';
import { VALLEY } from '../../src/valley/layout';
import type { HomeRange, Viewpoint } from '../../src/valley/types';
import { createValley } from '../../src/valley/valley';
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
const meadow = cameraAt(VALLEY.viewpoints[1]);
const eye = meadow.getWorldPosition(new Vector3()), ahead = meadow.getWorldDirection(new Vector3());

type Placed = GalleryItem & { valley: ValleyRecord & { home: HomeRange } };
/** A released creature with its arrival home in front of the meadow camera. */
function released(id: string, recipe: Recipe, seeds: [number, number, number] = [11, 22, 33]): Placed {
  const home = arrivalHome(valley, recipe, id, eye, { x: ahead.x, z: ahead.z });
  return {
    id, recipe, cards: {} as KidCards, drawing: null, words: '', thumb: null, history: [], createdAt: 1, native: false,
    valley: { status: 'released', home, seeds, releasedAt: 1 },
  };
}

const NATIVES = VALLEY.homes.reduce((n, h) => n + h.count, 0);
const at = (res: Residents) => res.animals.map((a) => [a.species, a.rig.position.x, a.rig.position.z]);

describe('Residents with released creatures', () => {
  it('spawns natives as before plus a family of three per released creature, the same after a reload', async () => {
    const natives = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await natives.spawn();
    const q = released('c-q', quadruped), b = released('c-b', bird, [5, 6, 7]);
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await res.spawn([q, b]);
    expect(res.animals).toHaveLength(NATIVES + 6);
    expect(at(res).slice(0, NATIVES)).toEqual(at(natives)); // natives unchanged
    for (const item of [q, b]) {
      const family = res.familyOf(item.id);
      expect(family.map((a) => a.obj.root.name)).toEqual([0, 1, 2].map((n) => `${item.id}-${n}`)); // looks 0, 1, 2
      for (const a of family) {
        expect(a.home).toBe(item.valley.home);
        expect(a.recipe).toBe(item.recipe);
        const { x, z } = a.rig.position;
        expect(Math.hypot(x - a.home.center.x, z - a.home.center.z)).toBeLessThanOrEqual(a.home.radius);
        expect(valley.isWater(x, z)).toBe(false);
        expect(a.obj.root.parent).toBe(res.object);
      }
      // one set of materials per species, owned by the first
      expect(new Set(family.map((a) => a.obj.look)).size).toBe(1);
    }
    expect(res.familyOf('c-b')[0].rig.flying).toBe(true);
    // a reload, with the list in another order: the family's own seeds place it the same
    const again = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await again.spawn([b, q]);
    expect(at(again).filter(([s]) => s === 'c-q')).toEqual(at(res).filter(([s]) => s === 'c-q'));
    expect(at(again).filter(([s]) => s === 'c-b')).toEqual(at(res).filter(([s]) => s === 'c-b'));
  });

  it('leaves out a released creature whose body fails to build (the rest still come), and ones not released', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    const exploring = released('c-x', quadruped);
    exploring.valley.status = 'exploring';
    await res.spawn([released('c-broken', { ...quadruped, id: 'broken' }), released('c-q', quadruped), exploring]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    expect(res.animals).toHaveLength(NATIVES + 3);
    expect(res.familyOf('c-broken')).toEqual([]);
    expect(res.familyOf('c-x')).toEqual([]);
    expect(res.familyOf('c-q')).toHaveLength(3);
  });

  it('compiles a new family before it is shown, and walks it in from its entry points to its home', async () => {
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await res.spawn();
    const item = released('c-q', quadruped);
    const home = item.valley.home, view = arrivalView(home, eye);
    const entry = entryPoints(valley, home, view, 3);
    let compiled: { children: number; inScene: boolean; animals: number } | null = null;
    await res.addSpecies(item, {
      entry,
      compile: async (root) => {
        let meshes = 0, hidden = 0;
        root.traverse((o) => ((o as { isMesh?: boolean }).isMesh ? (meshes++, o.visible || hidden++) : 0));
        expect(meshes).toBeGreaterThan(0);
        expect(hidden, 'every level of detail drawable while compiling').toBe(0);
        compiled = { children: root.children.length, inScene: root.parent === res.object, animals: res.animals.length };
      },
    });
    expect(compiled).toEqual({ children: 3, inScene: false, animals: NATIVES }); // compiled before it joined the valley
    const family = res.familyOf('c-q');
    expect(family).toHaveLength(3);
    family.forEach((a, k) => {
      expect(a.rig.position.x).toBeCloseTo(entry[k].x, 6);
      expect(a.rig.position.z).toBeCloseTo(entry[k].z, 6);
      expect(a.obj.root.parent).toBe(res.object);
      expect(a.obj.root.name).toBe(`c-q-${k}`);
    });
    expect(Math.hypot(entry[0].x - home.center.x, entry[0].z - home.center.z)).toBeGreaterThan(11.9); // 12 m out for the 12 m framing
    const camera = cameraAt(view);
    for (let f = 0; f < 30 * 15; f++) res.update(1 / 15, camera, 10);
    for (const a of family) {
      const { x, z } = a.rig.position;
      expect(Math.hypot(x - home.center.x, z - home.center.z), a.obj.root.name).toBeLessThanOrEqual(home.radius);
      expect(a.errand, 'the actions took over').toBeNull();
    }
    expect(res.animals).toHaveLength(NATIVES + 3);
  }, 60_000);

  it('walks a new family on together to its onward points once it reaches its spot, then lets it live (arrival v2)', async () => {
    const res = new Residents(valley, { ...VALLEY, homes: [] }, builder, 'low', new Scene());
    const item = released('c-q', quadruped);
    const home = item.valley.home, shot = arrivalShot(valley, home, eye, quadruped.life.sizeM);
    const entry = entryPoints(valley, home, shot.wide, 3), onward = onwardPoints(valley, home, shot.close, 3)!;
    await res.addSpecies(item, { entry, onward, compile: async () => {} });
    const family = res.familyOf('c-q'), camera = cameraAt(shot.close);
    const reached = [false, false, false], walkedOn = [false, false, false];
    for (let f = 0; f < 40 * 15; f++) {
      res.update(1 / 15, camera, 10);
      family.forEach((a, k) => {
        if (a.errand?.onward) walkedOn[k] = true;
        if (Math.hypot(a.rig.position.x - onward[k].x, a.rig.position.z - onward[k].z) < 4.5) reached[k] = true;
      });
    }
    expect(walkedOn).toEqual([true, true, true]);
    expect(reached).toEqual([true, true, true]);
    for (const a of family) expect(a.errand, 'the actions took over').toBeNull();
  }, 60_000);

  it('walks the first of a new family into the release picture within about 3 s (Ruling R6), a flier too', async () => {
    for (const recipe of [quadruped, bird]) { // 3 m/s at most: the slowest walk-in
      for (const v of VALLEY.viewpoints.slice(1, 6)) {
        const from = cameraAt(v), dir = from.getWorldDirection(new Vector3());
        const home = arrivalHome(valley, recipe, 'c-w', from.getWorldPosition(new Vector3()), { x: dir.x, z: dir.z });
        const shot = arrivalShot(valley, home, from.position, recipe.life.sizeM);
        const res = new Residents(valley, { ...VALLEY, homes: [] }, builder, 'low', new Scene());
        const item: Placed = { ...released('c-w', recipe), valley: { status: 'released', home, seeds: [1, 2, 3], releasedAt: 1 } };
        const onward = onwardPoints(valley, home, shot.close, 3) ?? undefined; // as the release does
        await res.addSpecies(item, { compile: async () => {}, entry: entryPoints(valley, home, shot.wide, 3, recipe.life.sizeM), onward });
        // the camera pushes in from the wide framing over PUSH s, as the valley drives it
        const seen = () => res.familyOf('c-w').some((a) => a.band !== 'paused');
        const s = (t: number) => Math.min(1, t / PUSH);
        res.update(1 / 60, cameraAt(pushView(shot, 0)), 10);
        expect(seen(), `${recipe.id} at ${v.name}: out of the picture at first`).toBe(false);
        let t = 1 / 60;
        for (; t < 10 && !seen(); t += 1 / 60) res.update(1 / 60, cameraAt(pushView(shot, s(t))), 10);
        // arrival v2 (creature-sized framings that push in, the family walking in to the middle): 1.2–2.9 s
        expect(t, `${recipe.id} at ${v.name}`).toBeLessThan(5);
      }
    }
  }, 60_000);

  it('without entry points (a reload) the family starts at spots in its home', async () => {
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await res.spawn();
    const item = released('c-q', quadruped);
    await res.addSpecies(item, { compile: async () => {} });
    const fresh = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await fresh.spawn([item]);
    expect(at(res)).toEqual(at(fresh));
  });

  it('walks a family away from the camera, then removes and disposes it (the materials last)', async () => {
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    const item = released('c-q', quadruped);
    await res.spawn([item]);
    const family = res.familyOf('c-q');
    const c = item.valley.home.center, near = arrivalView(item.valley.home, eye);
    // far enough back (72 m) to see the whole home, so the family is in view when it sets off
    const camera = cameraAt({ ...near, pos: { x: c.x + (near.pos.x - c.x) * 6, z: c.z + (near.pos.z - c.z) * 6, h: 20 } });
    for (let f = 0; f < 15; f++) res.update(1 / 15, camera, 10);
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
    let t = 0;
    for (; t < 25 && !done; t += 1 / 15) {
      res.update(1 / 15, camera, 10);
      await Promise.resolve();
    }
    await leaving;
    expect(t).toBeLessThanOrEqual(20 + 0.2); // out of view, or 20 s at most
    expect(res.familyOf('c-q')).toEqual([]);
    expect(res.animals).toHaveLength(NATIVES);
    expect(order).toEqual([2, 1, 0]); // the first of the species (the materials' owner) last
    for (const [k, a] of family.entries()) {
      expect(a.obj.root.parent).toBeNull();
      expect(Math.hypot(a.rig.position.x - from.x, a.rig.position.z - from.z), `${k} walked away`).toBeGreaterThan(start[k] + 5);
    }
    // it can come back: a fresh family with its own materials
    await res.addSpecies(item, { compile: async () => {} });
    expect(res.familyOf('c-q')).toHaveLength(3);
    expect(res.familyOf('c-q')[0].obj.look).not.toBe(family[0].obj.look);
  }, 60_000);

  it('removes a family at once when it is already out of view, and leaves the natives be', async () => {
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    const item = released('c-q', quadruped);
    await res.spawn([item]);
    const camera = cameraAt(arrivalView(item.valley.home, eye));
    camera.rotation.y += Math.PI; // look away
    camera.updateMatrixWorld();
    res.update(1 / 15, camera, 10);
    const natives = res.animals.filter((a) => a.species !== 'c-q');
    const leaving = res.removeSpecies('c-q');
    res.update(1 / 15, camera, 10);
    await leaving;
    expect(res.animals).toEqual(natives);
    await res.removeSpecies('nobody'); // nothing to remove
  });

  it('adds a family once when asked twice at the same time (a double release), and fails both if its compile fails', async () => {
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await res.spawn();
    const item = released('c-q', quadruped);
    let compiles = 0;
    const compile = async () => void compiles++;
    await Promise.all([res.addSpecies(item, { compile }), res.addSpecies(item, { compile })]);
    expect(res.familyOf('c-q')).toHaveLength(3);
    expect(compiles).toBe(1);
    expect(res.animals).toHaveLength(NATIVES + 3);
    const other = released('c-z', quadruped);
    const failing = async () => Promise.reject(new Error('no pipelines'));
    const both = await Promise.allSettled([res.addSpecies(other, { compile: failing }), res.addSpecies(other, { compile: failing })]);
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(res.familyOf('c-z')).toEqual([]);
  });

  it('a family sent exploring while it is still being added never stays', async () => {
    const res = new Residents(valley, VALLEY, builder, 'low', new Scene());
    await res.spawn();
    const item = released('c-q', quadruped);
    const camera = cameraAt(arrivalView(item.valley.home, eye));
    camera.rotation.y += Math.PI; // look away, so it goes at the next update
    camera.updateMatrixWorld();
    let compiled!: () => void;
    const adding = res.addSpecies(item, { compile: () => new Promise<void>((r) => (compiled = r)) });
    let gone = false;
    const leaving = res.removeSpecies('c-q').then(() => (gone = true));
    while (!compiled) await Promise.resolve(); // the build is done and the compile has started
    compiled();
    await adding;
    for (let f = 0; f < 30 && !gone; f++) {
      res.update(1 / 15, camera, 10);
      await new Promise((r) => setTimeout(r, 0));
    }
    await leaving;
    expect(res.familyOf('c-q')).toEqual([]);
    expect(res.animals).toHaveLength(NATIVES);
  });
});
