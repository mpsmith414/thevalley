import type { Material, Object3D, SkinnedMesh, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildBody, individualVariation } from '../../src/builder/build';
import { createCreatureObject, type CreatureObject } from '../../src/render/creature';
import { quadruped } from '../fixtures/recipes';

// two coarse levels of detail are enough: the first gets 12 fur shells on High, the second 6
const body = buildBody(quadruped, [2, 2]);
const bones = body.skeleton.bones;
const variation = (seed: number) => individualVariation(quadruped, seed, bones.length, bones.map((b) => b.partId));
const shells = (o: CreatureObject) => o.root.children.filter((c): c is SkinnedMesh => c.name.startsWith('fur'));
const disposed = (m: Material) => {
  let gone = false;
  m.addEventListener('dispose', () => (gone = true));
  return () => gone;
};

describe('the creature geometry', () => {
  it('has exactly 8 vertex attributes (the WebGPU limit), the last the feature marks', () => {
    const g = createCreatureObject(body, quadruped, 'high').meshes[0].geometry;
    expect(Object.keys(g.attributes).sort()).toEqual(['bodyPos', 'feature', 'normal', 'partInfo', 'position', 'restNormal', 'skinIndex', 'skinWeight']);
    expect(g.attributes.feature.itemSize).toBe(4);
    expect(g.attributes.feature.array).toBe(body.lods[0].feature);
  });
});

describe('createCreatureObject with a shared look', () => {
  it('shares the species materials, with each animal its own tint', () => {
    const a = createCreatureObject(body, quadruped, 'high', variation(1));
    const b = createCreatureObject(body, quadruped, 'high', variation(2), a.look);
    expect(b.look).toBe(a.look);
    expect(b.meshes[0].material).toBe(a.meshes[0].material);
    expect(shells(b)[0].material).toBe(shells(a)[0].material);
    const tint = (o: Object3D) => o.userData.tint as Vector3;
    expect(tint(a.meshes[0])).toBeDefined();
    expect(tint(b.meshes[0]).equals(tint(a.meshes[0]))).toBe(false);
    for (const s of shells(b)) expect(tint(s)).toBe(tint(b.meshes[0])); // fur takes the animal's tint too
  });

  it('draws every fur shell with one material, each at its own height', () => {
    const a = createCreatureObject(body, quadruped, 'high', variation(1));
    const s = shells(a);
    expect(s).toHaveLength(12 + 6);
    expect(new Set(s.map((x) => x.material)).size).toBe(1);
    expect(s[0].material).toBe(a.look.fur);
    const near = s.slice(0, 12).map((x) => x.userData.shellT as number);
    expect(new Set(near).size).toBe(12);
    near.forEach((t, i) => i && expect(t).toBeGreaterThan(near[i - 1]));
    expect(near[11]).toBeCloseTo(1, 10);
  });

  it('leaves shared materials alive when a borrower goes, and frees them with their owner', () => {
    const a = createCreatureObject(body, quadruped, 'high', variation(1));
    const b = createCreatureObject(body, quadruped, 'high', variation(2), a.look);
    const skinGone = disposed(a.look.skin), furGone = disposed(a.look.fur!);
    b.dispose();
    expect(skinGone()).toBe(false);
    expect(furGone()).toBe(false);
    a.dispose();
    expect(skinGone()).toBe(true);
    expect(furGone()).toBe(true);
  });
});
