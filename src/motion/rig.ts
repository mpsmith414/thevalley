import { Euler, Quaternion, Vector3, type Bone } from 'three/webgpu';
import type { BodyData } from '../builder/build';
import type { Recipe } from '../recipe/schema';
import type { CreatureObject } from '../render/creature';
import { add, dot, len, lerp, norm, scale, sub, v3, type Vec3 } from '../util/vec';
import { chooseGait, phasesFor, STRIDE, type GaitName } from './gait';
import { fabrik } from './ik';
import { findLimbs, type Limb } from './limbs';

export type Ground = { heightAt(x: number, z: number): number; isWater(x: number, z: number): boolean };

type Leg = {
  limb: Limb;
  ik: number[]; // bones moved by IK (the chain without its final foot)
  foot: number | null;
  rest: Vec3[]; // rest joints of the IK chain, creature space
  lengths: number[];
  home: Vec3; // rest position of the IK tip (ankle), creature space
  bend: Vec3; // which way the middle joints bend, creature space (unit)
  left: boolean;
  front: boolean;
  lift: number; // current swing height above ground (m)
  planted: Vec3 | null; // where the foot is locked on the ground during stance (world)
  liftoff: Vec3; // where the current swing started (world)
  swinging: boolean;
  world: Vec3; // last foot target, world space
};

const tmpV = new Vector3();
const tmpQ = new Quaternion();
const toV = (v: Vec3) => new Vector3(v.x, v.y, v.z);
const fromV = (v: Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const smooth = (t: number) => t * t * (3 - 2 * t);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Drives a creature's bones every frame: moves and turns its body, cycles its legs through a gait,
 * plants feet on the real ground and bends each leg to reach them.
 */
export class CreatureRig {
  readonly legs: Leg[];
  readonly legLength: number;
  readonly bodyLength: number;
  /** World position of the creature's ground origin, and its heading (radians; 0 faces +z). */
  readonly position = new Vector3();
  yaw = 0;
  speed = 0; // m/s now
  speedFrac = 0; // wanted fraction of the lab's top speed
  turnRate = 0;
  phase = 0;
  gait: GaitName = 'walk';
  /** How much the legs are stepping (0 standing still … 1 moving). */
  stepping = 0;
  bodyOffset = 0; // extra height for actions (lying down, rearing)
  bodyPitch = 0; // extra pitch for actions
  target: Vector3 | null = null;

  constructor(
    readonly obj: CreatureObject,
    readonly body: BodyData,
    readonly recipe: Recipe,
    readonly ground: Ground,
    readonly speedCap = 3,
  ) {
    const bones = body.skeleton.bones;
    const min = body.skeleton.min, max = body.skeleton.max;
    this.bodyLength = Math.max(0.05, max.z - min.z);
    const limbs = findLimbs(body.skeleton).filter((l) => l.kind === 'leg');
    const perSide = Math.max(1, ...[-1, 0, 1].map((s) => limbs.filter((l) => l.side === s).length));
    this.legs = limbs.map((limb) => {
      const last = limb.chain[limb.chain.length - 1];
      const hasFoot = bones[last].role === 'foot' && limb.chain.length > 1;
      const ik = hasFoot ? limb.chain.slice(0, -1) : limb.chain;
      const rest = [bones[ik[0]].start, ...ik.map((k) => bones[k].end)].map((p) => ({ ...p }));
      const lengths = ik.map((k) => len(sub(bones[k].end, bones[k].start)));
      // the rest pose shows which way knees bend; straight legs bend their knees forward
      const a = rest[0], b = rest[rest.length - 1];
      let bend = v3(0, 0, 1);
      if (rest.length > 2) {
        const mid = rest[1];
        const ab = sub(b, a);
        const t = Math.max(0, Math.min(1, dot(sub(mid, a), ab) / Math.max(1e-9, dot(ab, ab))));
        const off = sub(mid, lerp(a, b, t));
        if (len(off) > 1e-4) bend = norm(off);
      }
      return {
        limb, ik, foot: hasFoot ? last : null, rest, lengths, home: { ...b }, bend,
        left: limb.side >= 0, front: limb.rank === 0 && perSide > 1, lift: 0, planted: null, liftoff: v3(), swinging: false, world: v3(),
      };
    });
    this.legLength = this.legs.length ? Math.max(...this.legs.map((l) => l.lengths.reduce((s, x) => s + x, 0))) : this.bodyLength * 0.3;
  }

  moveTo(target: Vec3 | null) {
    this.target = target ? toV(target) : null;
  }
  setSpeed(frac: number) {
    this.speedFrac = Math.max(0, Math.min(1, frac));
  }
  get topSpeed() {
    return Math.min(this.recipe.life.topSpeed, this.speedCap);
  }

  update(dt: number) {
    const root = this.obj.root;
    this.locomotion(dt);
    const legLen = this.legLength;
    const speedFrac = this.speed / Math.max(1e-6, this.topSpeed);
    this.gait = chooseGait(this.legs.map((l) => l.limb), this.recipe, speedFrac);
    const { phase: offsets, duty } = phasesFor(this.legs.map((l) => l.limb), this.gait);
    const stride = STRIDE[this.gait] * legLen;
    // turning on the spot still needs steps
    const effective = this.speed + Math.abs(this.turnRate) * this.bodyLength * 0.5;
    this.stepping += ((effective > 0.03 ? 1 : 0) - this.stepping) * Math.min(1, dt * 4);
    const freq = Math.max(effective, 0.15 * this.stepping) / stride;
    this.phase = (this.phase + freq * dt * (this.stepping > 0.01 ? 1 : 0)) % 1;

    // body: sit at the average ground height under the feet, tilt with the slope, bob with the steps
    const yawQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw);
    const homesWorld = this.legs.map((l) => toV(l.home).applyQuaternion(yawQ).add(this.position));
    const gAt = (v: Vector3) => this.ground.heightAt(v.x, v.z);
    const groundY = this.legs.length ? homesWorld.reduce((s, v) => s + gAt(v), 0) / this.legs.length : gAt(this.position);
    const avg = (pick: (l: Leg) => boolean) => {
      const sel = this.legs.map((l, i) => (pick(l) ? gAt(homesWorld[i]) : NaN)).filter((h) => !Number.isNaN(h));
      return sel.length ? sel.reduce((s, h) => s + h, 0) / sel.length : groundY;
    };
    const frontZ = this.legs.filter((l) => l.front).map((l) => l.home.z);
    const hindZ = this.legs.filter((l) => !l.front).map((l) => l.home.z);
    const dz = frontZ.length && hindZ.length ? Math.max(...frontZ) - Math.min(...hindZ) : 0;
    const pitch = dz > 0.05 ? -Math.atan2(avg((l) => l.front) - avg((l) => !l.front), dz) : 0;
    const lefts = this.legs.filter((l) => l.limb.side > 0).map((l) => l.home.x);
    const dx = lefts.length ? 2 * Math.max(...lefts) : 0;
    const roll = dx > 0.05 ? Math.atan2(avg((l) => l.limb.side > 0) - avg((l) => l.limb.side < 0), dx) * 0.6 : 0;
    let bob = 0;
    if (this.gait === 'hop') {
      const hindSwing = this.legPhase(offsets, duty).find((p, i) => !this.legs[i].front && p.swing);
      bob = hindSwing ? Math.sin(Math.PI * hindSwing.s) * 0.25 * legLen * this.stepping : 0;
    } else {
      const amp = 0.02 * legLen * (0.5 + this.recipe.motion.bounce) * this.stepping * (this.gait === 'gallop' ? 2.5 : 1);
      bob = -Math.cos(4 * Math.PI * this.phase) * amp;
    }
    const legless = this.legs.length === 0;
    root.position.set(this.position.x, (legless ? gAt(this.position) : groundY) + bob + this.bodyOffset, this.position.z);
    root.rotation.copy(new Euler(pitch + this.bodyPitch, this.yaw, roll, 'YXZ'));
    root.updateMatrixWorld(true);

    // legs
    const phases = this.legPhase(offsets, duty);
    const lift = (this.gait === 'gallop' || this.gait === 'hop' ? 0.22 : 0.14) * legLen;
    const D = stride * duty;
    // where a foot would be at this offset from its home, on the ground (world)
    const onGround = (leg: Leg, off: number) => {
      const w = root.localToWorld(new Vector3(leg.home.x, leg.home.y, leg.home.z + off));
      w.y = gAt(w) + leg.home.y;
      return fromV(w);
    };
    this.legs.forEach((leg, i) => {
      const { swing, s } = phases[i];
      let world: Vec3;
      if (!swing) {
        // stance: the foot is locked where it landed, so it never slides
        if (leg.swinging || !leg.planted) leg.planted = onGround(leg, (D / 2 - s * D) * this.stepping);
        if (this.stepping < 0.05) {
          // standing still: settle the feet under the body, too slowly to notice
          const home = onGround(leg, 0);
          leg.planted = lerp(leg.planted, home, Math.min(1, dt * 1.5));
        }
        leg.lift = 0;
        world = { ...leg.planted };
      } else {
        // swing: travel from where the foot lifted to where it will land, in an arc
        if (!leg.swinging) leg.liftoff = leg.planted ?? onGround(leg, 0);
        const land = onGround(leg, (D / 2) * this.stepping);
        world = lerp(leg.liftoff, land, smooth(s));
        leg.lift = Math.sin(Math.PI * s) * lift * this.stepping;
        world.y = gAt(toV(world)) + leg.home.y + leg.lift;
        leg.planted = null;
      }
      leg.swinging = swing;
      leg.world = world;
      this.solveLeg(leg, root.worldToLocal(toV(world)), yawQ);
    });
  }

  private legPhase(offsets: number[], duty: number) {
    return offsets.map((o) => {
      const p = (this.phase + o) % 1;
      return p < duty ? { swing: false, s: p / duty } : { swing: true, s: (p - duty) / (1 - duty) };
    });
  }

  private locomotion(dt: number) {
    let want = 0;
    if (this.target) {
      const to = this.target.clone().sub(this.position).setY(0);
      const d = to.length();
      if (d > 0.05) {
        const heading = Math.atan2(to.x, to.z);
        const diff = wrapAngle(heading - this.yaw);
        const maxTurn = Math.min(4, Math.max(0.8, 2.5 / this.bodyLength));
        this.turnRate = Math.max(-maxTurn, Math.min(maxTurn, diff * 3));
        this.yaw = wrapAngle(this.yaw + this.turnRate * dt);
        // slow for sharp turns and when arriving
        want = this.speedFrac * this.topSpeed * Math.max(0.15, Math.cos(Math.min(Math.PI / 2, Math.abs(diff)))) * Math.min(1, d / 0.6);
      } else this.turnRate = 0;
    } else this.turnRate *= Math.max(0, 1 - dt * 6);
    const accel = this.topSpeed * 1.5;
    this.speed += Math.max(-accel * dt, Math.min(accel * dt, want - this.speed));
    this.position.x += Math.sin(this.yaw) * this.speed * dt;
    this.position.z += Math.cos(this.yaw) * this.speed * dt;
  }

  private solveLeg(leg: Leg, targetLocal: Vector3, yawQ: Quaternion) {
    const bones = this.obj.bones;
    const root = this.obj.root;
    const startW = bones[leg.ik[0]].getWorldPosition(tmpV);
    const start = fromV(root.worldToLocal(startW.clone()));
    const shift = sub(start, leg.rest[0]);
    const init = leg.rest.map((p) => add(p, shift));
    const mid = init[Math.floor(init.length / 2)];
    const pole = add(mid, scale(leg.bend, leg.lengths.reduce((s, x) => s + x, 0)));
    const joints = fabrik(init, leg.lengths, fromV(targetLocal), init.length > 2 ? pole : null);
    const restBones = this.body.skeleton.bones;
    const rootQ = root.getWorldQuaternion(new Quaternion());
    leg.ik.forEach((k, j) => {
      const restDir = norm(sub(restBones[k].end, restBones[k].start));
      const newDir = norm(sub(joints[j + 1], joints[j]));
      const qd = new Quaternion().setFromUnitVectors(toV(restDir), toV(newDir));
      this.setWorldRotation(bones[k], rootQ.clone().multiply(qd));
    });
    // feet stay flat on the ground, facing the way the body faces
    if (leg.foot !== null) this.setWorldRotation(bones[leg.foot], yawQ.clone());
  }

  /** Give a bone this world rotation by setting its local rotation relative to its parent. */
  setWorldRotation(bone: Bone, world: Quaternion) {
    bone.parent!.getWorldQuaternion(tmpQ);
    bone.quaternion.copy(tmpQ.invert().multiply(world));
    bone.updateMatrixWorld(true);
  }
}
