import {
  Bone, BufferAttribute, BufferGeometry, Color, Group, Skeleton, SkinnedMesh, Vector3, type Material,
} from 'three/webgpu';
import type { BodyData, LodMesh, Variation } from '../builder/build';
import type { Recipe } from '../recipe/schema';
import type { Vec3 } from '../util/vec';
import { createEyes, eyePlaces, lidMaterial, type Eye, type EyePlace } from '../skin/eyes';
import { createFurShells, furMaterial } from '../skin/fur';
import { createSkinMaterial } from '../skin/material';
import { packRegions } from '../skin/patterns';
import { QUALITY, type Tier } from './quality';
import './skinning-patch'; // equal creature materials share one shader (see there)

/**
 * The materials one species can share (its skin, one for all its fur shells, one for all its eyelids): more of a kind cost
 * no new shaders.
 */
export type CreatureLook = { skin: Material; fur: Material | null; lids: Material | null };

export type CreatureObject = {
  root: Group;
  /** Its materials, to hand to the next animal of its kind. */
  look: CreatureLook;
  /** One skinned mesh per level of detail, all sharing one skeleton. */
  meshes: SkinnedMesh<BufferGeometry, Material>[];
  bones: Bone[];
  skeleton: Skeleton;
  /** Rest-pose start of each bone, creature space (the jaw's raised to shut the mouth). */
  restStart: Vec3[];
  eyes: Eye[];
  /**
   * The lower jaw (null without one). At rest its bone sits raised by the body's `jawLift` (`shut`, its local position),
   * which shuts the mouth. It opens by turning about `axis` (in its parent's, the head's, frame: the mouth's up × forward,
   * so a positive angle drops the chin): `open(θ)` sets `bone.quaternion` to θ radians about it (0 shuts it again).
   */
  jaw: { bone: Bone; axis: Vector3; shut: Vector3; open(theta: number): void } | null;
  lod: 0 | 1 | 2;
  setLod(i: 0 | 1 | 2): void;
  furOn: boolean;
  setFur(on: boolean): void;
  setMaterial(m: Material): void;
  dispose(): void;
};

const BELLY_ROLES = new Set(['torso', 'neck', 'head', 'tail']);
/** Round each eye (in eyeball radii) the belly fades out, from none inside the first to full past the second. */
const EYE_NO_BELLY = [1.3, 1.6] as const;

/**
 * How much a vertex may show the belly colour: 1 on the belly roles' bones, fading to 0 near the eyes (a socket's ceiling
 * faces down like a belly and showed a pale crescent over the eye).
 */
function bellyFlag(ok: number, x: number, y: number, z: number, eyes: EyePlace[]): number {
  if (!ok) return 0;
  let f = 1;
  for (const e of eyes) {
    const d = Math.hypot(x - e.centre.x, y - e.centre.y, z - e.centre.z) / e.r;
    const t = Math.min(1, Math.max(0, (d - EYE_NO_BELLY[0]) / (EYE_NO_BELLY[1] - EYE_NO_BELLY[0])));
    f = Math.min(f, t * t * (3 - 2 * t));
  }
  return f;
}


/** One level of detail's geometry. Pass the eyes (`eyePlaces`) to keep the belly colour out of their sockets. */
export function lodGeometry(l: LodMesh, body: BodyData, eyes: EyePlace[] = []): BufferGeometry {
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
    info[v * 4 + 3] = bellyFlag(bellyOk[l.boneOf[v]], l.positions[v * 3], l.positions[v * 3 + 1], l.positions[v * 3 + 2], eyes);
  }
  g.setAttribute('partInfo', new BufferAttribute(info, 4));
  // the rest position, and the region index squared: with the index itself (partInfo.x) the fragment shader can tell
  // which two regions a border triangle joins (see regionNodes)
  const bodyPos = new Float32Array(l.region.length * 4);
  for (let v = 0; v < l.region.length; v++) {
    bodyPos.set(l.positions.subarray(v * 3, v * 3 + 3), v * 4);
    bodyPos[v * 4 + 3] = l.region[v] * l.region[v];
  }
  g.setAttribute('bodyPos', new BufferAttribute(bodyPos, 4));
  g.setAttribute('restNormal', new BufferAttribute(l.normals.slice(), 3));
  g.setAttribute('feature', new BufferAttribute(l.feature, 4)); // the 8th and last vertex buffer WebGPU allows
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
  const own: CreatureLook = look ?? { skin: createSkinMaterial(pack!), fur: furMaterial(pack!), lids: recipe.face.lids ? lidMaterial(body, recipe) : null };
  const c = variation ? new Color(1, 1, 1).offsetHSL(variation.tint.h, variation.tint.s, variation.tint.l) : null;
  const tint = c ? new Vector3(c.r, c.g, c.b) : undefined;
  const places = eyePlaces(body, recipe.skin.eyes.size);
  const meshes = body.lods.map((l) => {
    const m = new SkinnedMesh<BufferGeometry, Material>(lodGeometry(l, body, places), own.skin);
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
  // the jaw rests shut (raised after binding, so the bind pose keeps the carved slit and the lift closes it)
  const m = body.mouth, jd = body.skeleton.jaw;
  let jaw: CreatureObject['jaw'] = null;
  if (m && jd >= 0) {
    const bone = bones[jd], up = new Vector3(m.up.x, m.up.y, m.up.z);
    bone.position.addScaledVector(up, body.jawLift);
    root.updateMatrixWorld(true);
    const axis = up.clone().cross(new Vector3(m.forward.x, m.forward.y, m.forward.z)).normalize();
    jaw = { bone, axis, shut: bone.position.clone(), open: (theta) => void bone.quaternion.setFromAxisAngle(axis, theta) };
  }
  if (variation) root.scale.setScalar(variation.boneScale[0] ?? 1);
  // a borrowed look without lids (from a lidless recipe) for a lidded one: lids of this animal's own, freed with it
  let ownLids: Material | null = null;
  if (recipe.face.lids && !own.lids) {
    console.warn('a borrowed creature look has no lid material for a recipe with lids: making one for this animal');
    ownLids = lidMaterial(body, recipe);
  }
  const eyes = createEyes(body, recipe, bones, tint, own.lids ?? ownLids);

  const obj: CreatureObject = {
    root, look: own, meshes, bones, skeleton,
    restStart: defs.map((d, i) => (i === jd && m ? { x: d.start.x + m.up.x * body.jawLift, y: d.start.y + m.up.y * body.jawLift, z: d.start.z + m.up.z * body.jawLift } : { ...d.start })),
    eyes,
    jaw,
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
      // far away the lids are too small to see blink (and cost two draw calls an eye): the eyes stay, the lids go
      for (const e of eyes) for (const l of e.lids) l.visible = i < 2;
    },
    setMaterial(mat) {
      meshes.forEach((m) => (m.material = mat));
    },
    dispose() {
      meshes.forEach((m) => m.geometry.dispose());
      // the eyes' sphere, their material and the lids' cap are this animal's own (the lid material is the species')
      const e = eyes[0];
      if (e) [e.geometry, e.material as Material, e.lids[0]?.geometry, ownLids].forEach((x) => x?.dispose());
      if (!look) [own.skin, own.fur, own.lids].forEach((m) => m?.dispose()); // shared materials belong to whoever made them
      root.removeFromParent();
    },
  };
  obj.setLod(obj.lod);
  return obj;
}
