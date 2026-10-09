import {
  Bone, BufferAttribute, BufferGeometry, Color, Group, ReferenceNode, Skeleton, SkinnedMesh, Vector3, type Material,
} from 'three/webgpu';
import type { BodyData, LodMesh, Variation } from '../builder/build';
import type { Recipe } from '../recipe/schema';
import type { Vec3 } from '../util/vec';
import { createEyes, type Eye } from '../skin/eyes';
import { createFurShells, furMaterial } from '../skin/fur';
import { createSkinMaterial } from '../skin/material';
import { packRegions } from '../skin/patterns';
import { QUALITY, type Tier } from './quality';

/** The materials one species can share (its skin, and one for all its fur shells): more of a kind cost no new shaders. */
export type CreatureLook = { skin: Material; fur: Material | null };

export type CreatureObject = {
  root: Group;
  /** Its materials, to hand to the next animal of its kind. */
  look: CreatureLook;
  /** One skinned mesh per level of detail, all sharing one skeleton. */
  meshes: SkinnedMesh<BufferGeometry, Material>[];
  bones: Bone[];
  skeleton: Skeleton;
  /** Rest-pose start of each bone, creature space. */
  restStart: Vec3[];
  eyes: Eye[];
  lod: 0 | 1 | 2;
  setLod(i: 0 | 1 | 2): void;
  furOn: boolean;
  setFur(on: boolean): void;
  setMaterial(m: Material): void;
  dispose(): void;
};

const BELLY_ROLES = new Set(['torso', 'neck', 'head', 'tail']);

/**
 * three (r186) names a skinned mesh's bone-matrix buffer after the node's id, so every skinned material gets shader code of
 * its own: no two creatures (not even two of one species, or two fur shells) ever share a GPU pipeline, and each new one
 * stalls the GPU for its compile (about 10 s for a furry body on D3D12). A fixed name lets equal materials share.
 */
type Ref = { name: string | null; property: string; setNodeType(type: string): void };
const refProto = ReferenceNode.prototype as unknown as Ref, setNodeType = refProto.setNodeType;
refProto.setNodeType = function (this: Ref, type: string) {
  if (this.name === null && this.property === 'skeleton.boneMatrices') this.name = 'skinBones';
  setNodeType.call(this, type);
};

export function lodGeometry(l: LodMesh, body: BodyData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(l.positions, 3));
  g.setAttribute('normal', new BufferAttribute(l.normals, 3));
  g.setAttribute('skinIndex', new BufferAttribute(l.skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(l.skinWeight, 4));
  // region, partT, partS and "may show a belly" share one attribute (WebGPU allows only 8 vertex buffers)
  const info = new Float32Array(l.region.length * 4);
  const bellyOk = body.skeleton.bones.map((b) => (BELLY_ROLES.has(b.role) ? 1 : 0));
  for (let v = 0; v < l.region.length; v++) {
    info[v * 4] = l.region[v];
    info[v * 4 + 1] = l.partT[v];
    info[v * 4 + 2] = l.partS[v];
    info[v * 4 + 3] = bellyOk[l.boneOf[v]];
  }
  g.setAttribute('partInfo', new BufferAttribute(info, 4));
  g.setAttribute('bodyPos', new BufferAttribute(l.positions.slice(), 3));
  g.setAttribute('restNormal', new BufferAttribute(l.normals.slice(), 3));
  g.setIndex(new BufferAttribute(l.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * A body ready for the scene: bones at their rest positions, skin bound, shadows on. Pass `look` (from another animal of
 * the same recipe) to share its materials; the individual's tint is then set per object.
 */
export function createCreatureObject(body: BodyData, recipe: Recipe, tier: Tier, variation?: Variation, look?: CreatureLook): CreatureObject {
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
  const pack = look ? null : packRegions(recipe, body.regions);
  const own: CreatureLook = look ?? { skin: createSkinMaterial(pack!).material, fur: furMaterial(pack!) };
  const c = variation ? new Color(1, 1, 1).offsetHSL(variation.tint.h, variation.tint.s, variation.tint.l) : null;
  const tint = c ? new Vector3(c.r, c.g, c.b) : undefined;
  const meshes = body.lods.map((l) => {
    const m = new SkinnedMesh<BufferGeometry, Material>(lodGeometry(l, body), own.skin);
    m.userData.tint = tint;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // skinned bounds move with the pose
    root.add(m);
    m.bind(skeleton);
    return m;
  });
  // fur on the two closer levels of detail (fewer shells on the middle one); none far away
  const shells = meshes.map((m, k) => {
    const count = k === 0 ? QUALITY[tier].furShells : k === 1 ? Math.floor(QUALITY[tier].furShells / 2) : 0;
    const s = createFurShells(m, own.fur, count);
    s.forEach((x) => {
      x.userData.tint = tint;
      root.add(x);
    });
    return s;
  });
  if (variation) root.scale.setScalar(variation.boneScale[0] ?? 1);
  const eyes = createEyes(body, recipe, bones);

  const obj: CreatureObject = {
    root, look: own, meshes, bones, skeleton,
    restStart: defs.map((d) => ({ ...d.start })),
    eyes,
    lod: QUALITY[tier].lod,
    furOn: true,
    setFur(on) {
      obj.furOn = on;
      obj.setLod(obj.lod);
    },
    setLod(i) {
      obj.lod = i;
      const shown = Math.min(i, meshes.length - 1);
      meshes.forEach((m, k) => (m.visible = k === shown));
      shells.forEach((s, k) => s.forEach((x) => (x.visible = k === shown && obj.furOn)));
    },
    setMaterial(mat) {
      meshes.forEach((m) => (m.material = mat));
    },
    dispose() {
      meshes.forEach((m) => m.geometry.dispose());
      if (!look) [own.skin, own.fur].forEach((m) => m?.dispose()); // shared materials belong to whoever made them
      root.removeFromParent();
    },
  };
  obj.setLod(obj.lod);
  return obj;
}
