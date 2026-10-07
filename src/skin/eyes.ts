import { Color, Mesh, MeshPhysicalNodeMaterial, Quaternion, SphereGeometry, Vector3, type Bone } from 'three/webgpu';
import { float, length, mix, positionLocal, smoothstep, uniform, vec2, abs } from 'three/tsl';
import type { BodyData } from '../builder/build';
import type { Recipe } from '../recipe/schema';

export type Eye = Mesh & { blink(amount: number): void };

const PUPIL = { round: [1, 1], slit: [0.28, 1.25], bar: [1.35, 0.32], none: [0, 0] } as const;

function eyeMaterial(recipe: Recipe): MeshPhysicalNodeMaterial {
  const iris = uniform(new Color(recipe.skin.eyes.color));
  const [px, py] = PUPIL[recipe.skin.eyes.pupil];
  const p = positionLocal.normalize(); // the eye looks along local +z
  const front = p.z; // 1 at the centre of the eye
  // pupil: an ellipse around the front pole
  const q = vec2(p.x.div(Math.max(px, 0.01)), p.y.div(Math.max(py, 0.01)));
  const pupil = px === 0 ? float(0) : float(1).sub(smoothstep(0.32, 0.36, length(q)));
  // a dark rim where the iris meets the eyelid skin, and a little depth shading in the iris
  const rim = float(1).sub(smoothstep(0.15, 0.35, abs(front)));
  const irisShade = mix(iris.mul(0.55), iris, float(1).sub(smoothstep(0.7, 0.98, front)));
  const c = mix(mix(irisShade, new Color('#0b0806'), pupil), new Color('#1a120c'), rim.mul(0.85));
  const m = new MeshPhysicalNodeMaterial();
  m.colorNode = c;
  m.roughnessNode = float(0.25);
  m.clearcoatNode = float(1);
  m.clearcoatRoughnessNode = float(0.03);
  return m;
}

/** Bright, glossy eyes on every eye bone, looking outward along the bone. */
export function createEyes(body: BodyData, recipe: Recipe, bones: Bone[]): Eye[] {
  const mat = eyeMaterial(recipe);
  const geo = new SphereGeometry(1, 24, 16);
  const zAxis = new Vector3(0, 0, 1);
  return body.skeleton.bones.flatMap((d, i) => {
    if (d.role !== 'eye') return [];
    const dir = new Vector3(d.end.x - d.start.x, d.end.y - d.start.y, d.end.z - d.start.z);
    const len = dir.length();
    dir.normalize();
    const r = Math.max(d.r0, d.r1) * recipe.skin.eyes.size;
    const eye = new Mesh(geo, mat) as unknown as Eye;
    eye.name = `eye:${d.name}`;
    eye.scale.setScalar(r);
    eye.quaternion.copy(new Quaternion().setFromUnitVectors(zAxis, dir));
    eye.position.copy(dir.clone().multiplyScalar(len * 0.5)); // relative to the eye bone (at its start)
    eye.castShadow = true;
    const open = r;
    eye.blink = (amount: number) => {
      eye.scale.set(open, open * Math.max(0.08, 1 - amount), open);
    };
    bones[i].add(eye);
    return [eye];
  });
}
