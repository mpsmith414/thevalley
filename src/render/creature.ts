import {
  Bone, BufferAttribute, BufferGeometry, Group, MeshStandardNodeMaterial, Skeleton, SkinnedMesh, type Material,
} from 'three/webgpu';
import type { BodyData, LodMesh, Variation } from '../builder/build';
import type { Recipe } from '../recipe/schema';
import type { Vec3 } from '../util/vec';
import { QUALITY, type Tier } from './quality';

export type CreatureObject = {
  root: Group;
  /** One skinned mesh per level of detail, all sharing one skeleton. */
  meshes: SkinnedMesh<BufferGeometry, Material>[];
  bones: Bone[];
  skeleton: Skeleton;
  /** Rest-pose start of each bone, creature space. */
  restStart: Vec3[];
  lod: 0 | 1 | 2;
  setLod(i: 0 | 1 | 2): void;
  setMaterial(m: Material): void;
  dispose(): void;
};

export function lodGeometry(l: LodMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(l.positions, 3));
  g.setAttribute('normal', new BufferAttribute(l.normals, 3));
  g.setAttribute('skinIndex', new BufferAttribute(l.skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(l.skinWeight, 4));
  g.setAttribute('region', new BufferAttribute(l.region, 1));
  g.setAttribute('partT', new BufferAttribute(l.partT, 1));
  g.setAttribute('bodyPos', new BufferAttribute(l.positions.slice(), 3));
  g.setAttribute('restNormal', new BufferAttribute(l.normals.slice(), 3));
  g.setIndex(new BufferAttribute(l.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** A body ready for the scene: bones at their rest positions, skin bound, shadows on. */
export function createCreatureObject(body: BodyData, _recipe: Recipe, tier: Tier, variation?: Variation): CreatureObject {
  const defs = body.skeleton.bones;
  const bones = defs.map((d) => {
    const b = new Bone();
    b.name = d.name;
    return b;
  });
  defs.forEach((d, i) => {
    if (d.parent < 0) bones[i].position.set(d.start.x, d.start.y, d.start.z);
    else {
      const p = defs[d.parent].start;
      bones[i].position.set(d.start.x - p.x, d.start.y - p.y, d.start.z - p.z);
      bones[d.parent].add(bones[i]);
    }
  });
  const root = new Group();
  root.name = 'creature';
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  const placeholder = new MeshStandardNodeMaterial({ color: '#b8b0a0', roughness: 0.8 });
  const meshes = body.lods.map((l) => {
    const m = new SkinnedMesh<BufferGeometry, Material>(lodGeometry(l), placeholder);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // skinned bounds move with the pose
    root.add(m);
    m.bind(skeleton);
    return m;
  });
  if (variation) root.scale.setScalar(variation.boneScale[0] ?? 1);

  const obj: CreatureObject = {
    root, meshes, bones, skeleton,
    restStart: defs.map((d) => ({ ...d.start })),
    lod: QUALITY[tier].lod,
    setLod(i) {
      obj.lod = i;
      meshes.forEach((m, k) => (m.visible = k === Math.min(i, meshes.length - 1)));
    },
    setMaterial(mat) {
      meshes.forEach((m) => (m.material = mat));
    },
    dispose() {
      meshes.forEach((m) => m.geometry.dispose());
      root.removeFromParent();
    },
  };
  obj.setLod(obj.lod);
  return obj;
}
