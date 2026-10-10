import {
  Color, DoubleSide, Matrix4, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, Quaternion, SphereGeometry, Vector3, type Bone, type Material,
} from 'three/webgpu';
import { float, length, mix, positionLocal, smoothstep, uniform, uv, vec2, abs } from 'three/tsl';
import type { BodyData } from '../builder/build';
import type { Recipe } from '../recipe/schema';
import { lerp, norm, sub, type Vec3 } from '../util/vec';

/** An eyeball (looking along local +z) with its lids (none on a fish). `blink(amount)`: 0 open … 1 shut. */
export type Eye = Mesh & { blink(amount: number): void; lids: Mesh[] };

const PUPIL = { round: [1, 1], slit: [0.28, 1.25], bar: [1.35, 0.32], none: [0, 0] } as const;
const NO_TINT = new Vector3(1, 1, 1);
const deg = Math.PI / 180;
/** Lid rim elevations at rest and shut (radians): the upper rim well above the pupil, the lower below it; shut, they meet below it. */
const UPPER_OPEN = 50 * deg, LOWER_OPEN = -55 * deg, SHUT = -35 * deg;
/** The lids' radius in eye units: just off the eyeball, inside the socket the face carves (1.2 eye radii round a point 0.35 forward). */
const LID_R = 1.07;
/** The lower lid's size against the upper: open, the two overlap behind the eye, and on one surface they z-fought there. */
const LOWER_SCALE = 0.98;
/**
 * How much wider an upturned eye's lower lid opens at rest (radians), from no wider for an eye looking up by UPTURN_FROM
 * (the gaze's y) or less to UPTURN_OPEN at UPTURN_FULL and more. A frog's eye looks ~58° up (y 0.85), so from beside it
 * you meet it right at a −55° rim and it read half shut and sleepy; the other natives look up by 0.25 at most.
 */
const UPTURN_OPEN = 30 * deg, UPTURN_FROM = 0.4, UPTURN_FULL = 0.9;

/** Lid rim elevations (radians) for a closing amount: upper +50° → −35°, lower −55° → −35°. */
export function lidAngles(amount: number): { upper: number; lower: number } {
  const a = Math.min(1, Math.max(0, amount));
  return { upper: UPPER_OPEN + (SHUT - UPPER_OPEN) * a, lower: LOWER_OPEN + (SHUT - LOWER_OPEN) * a };
}

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

/** The head's skin colour (the region of the eyes' parent bone), for the lids. */
function headColor(body: BodyData, recipe: Recipe): string {
  const defs = body.skeleton.bones, eye = defs.find((d) => d.role === 'eye');
  const id = eye && eye.parent >= 0 ? defs[eye.parent].region : undefined;
  return (recipe.skin.regions.find((r) => r.id === id) ?? recipe.skin.regions[0]).color;
}

/**
 * One lid material for a whole species: the head's skin colour times each animal's tint (its lids' `userData.tint`),
 * darkening to a soft line along the lid's edge. Double sided, so the lid's inside shows (rather than a gap) at grazing angles.
 */
export function lidMaterial(body: BodyData, recipe: Recipe): MeshStandardNodeMaterial {
  const tint = uniform(new Vector3(1, 1, 1)).onObjectUpdate(({ object }) => (object?.userData.tint as Vector3 | undefined) ?? NO_TINT);
  const c = new Color(headColor(body, recipe)); // linear, as the skin's region colours
  const base = uniform(new Vector3(c.r, c.g, c.b)).mul(tint);
  // the cap's v runs 1 at its pole to 0 at its rim (the same on both lids: the lower is the same cap turned over)
  const edge = smoothstep(0.75, 1, float(1).sub(uv().y));
  const m = new MeshStandardNodeMaterial();
  m.colorNode = mix(base, base.mul(0.35), edge);
  m.roughnessNode = float(0.8);
  m.metalnessNode = float(0);
  m.side = DoubleSide;
  return m;
}

/**
 * An eye's turn: local +z along `dir` (unit, creature space), local +y as near the creature's up as it can be, so the
 * upper lid sits on top (a frog's upturned eye too: the shortest turn from +z put its upper lid behind and its lower lid
 * across the front).
 */
function gaze(dir: Vector3): Quaternion {
  const y = new Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
  if (y.lengthSq() < 1e-8) return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir); // straight up or down
  y.normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(y, dir), y, dir));
}

/** Where an eye bone's eyeball sits: its centre (creature space, rest pose), gaze (unit) and radius. */
export type EyePlace = { bone: number; centre: Vec3; dir: Vec3; r: number };

/** Every eye bone's eyeball: centred halfway along the bone, looking along it, radius max(r0, r1) × the recipe's eye size. */
export function eyePlaces(body: BodyData, eyeSize: number): EyePlace[] {
  return body.skeleton.bones.flatMap((d, bone) => {
    if (d.role !== 'eye') return [];
    const dir = sub(d.end, d.start);
    return [{ bone, centre: lerp(d.start, d.end, 0.5), dir: norm(dir), r: Math.max(d.r0, d.r1) * eyeSize }];
  });
}

/**
 * Bright, glossy eyes on every eye bone, looking outward along the bone, each with an upper and a lower lid when the
 * recipe has lids (`face.lids`). Pass the animal's `tint` (set on the lids, as on its body) and its species' `lids`
 * material (from `lidMaterial`; one is made if none is given).
 */
export function createEyes(body: BodyData, recipe: Recipe, bones: Bone[], tint?: Vector3, lids?: Material | null): Eye[] {
  const mat = eyeMaterial(recipe);
  const geo = new SphereGeometry(1, 24, 16);
  const lidMat = recipe.face.lids ? (lids ?? lidMaterial(body, recipe)) : null;
  // a hemispherical cap over y > 0: unrotated, its rim lies in the eye's y = 0 plane, its front edge at elevation 0
  const lidGeo = lidMat ? new SphereGeometry(LID_R, 24, 8, 0, 2 * Math.PI, 0, Math.PI / 2) : null;
  const defs = body.skeleton.bones;
  return eyePlaces(body, recipe.skin.eyes.size).map(({ bone: i, centre, dir: g, r }) => {
    const d = defs[i], dir = new Vector3(g.x, g.y, g.z);
    const eye = new Mesh(geo, mat) as unknown as Eye;
    eye.name = `eye:${d.name}`;
    eye.scale.setScalar(r);
    eye.quaternion.copy(gaze(dir));
    eye.position.set(centre.x - d.start.x, centre.y - d.start.y, centre.z - d.start.z); // relative to the eye bone (at its start)
    eye.castShadow = true;
    eye.lids = lidGeo && lidMat ? ['upper', 'lower'].map((k) => {
      const l = new Mesh(lidGeo, lidMat);
      l.name = `lid:${k}`;
      l.userData.tint = tint;
      l.castShadow = false;
      l.receiveShadow = true;
      if (k === 'lower') l.scale.setScalar(LOWER_SCALE);
      eye.add(l);
      return l;
    }) : [];
    const [upper, lower] = eye.lids;
    const wider = UPTURN_OPEN * Math.min(1, Math.max(0, (dir.y - UPTURN_FROM) / (UPTURN_FULL - UPTURN_FROM)));
    // a cap's front edge tips up by e when turned −e about x; the lower is the cap turned over (z by π) first
    eye.blink = upper ? (amount: number) => {
      const a = lidAngles(amount);
      upper.rotation.set(-a.upper, 0, 0);
      lower.rotation.set(-(a.lower - wider * (1 - Math.min(1, Math.max(0, amount)))), 0, Math.PI);
    } : () => {};
    eye.blink(0);
    bones[i].add(eye);
    return eye;
  });
}
