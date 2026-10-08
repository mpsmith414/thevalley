import { Euler, Quaternion, Vector3, type Bone } from 'three/webgpu';
import { mulberry32 } from '../util/rng';
import { len, norm, sub, v3, type Vec3 } from '../util/vec';
import { springStep, undulation, type Spring } from './chains';
import { fabrik } from './ik';
import { findChains, type ChainKind, type Limb } from './limbs';
import { fromV, toV, type CreatureRig } from './rig';

const Z = new Vector3(0, 0, 1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const euler = (pitch: number, yaw: number, roll = 0) => new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));

/**
 * Everything that isn't legs: the head looking about and grazing, tails swaying, ears twitching,
 * long bodies slithering and swimming, wings folding and flapping, fins paddling, breathing, blinking.
 */
export class SecondaryMotion {
  readonly flapHz: number;
  private chains: { kind: ChainKind; chain: number[] }[];
  private wings: Limb[];
  private fins: Limb[];
  private mouths: number[];
  private lookYaw: Spring = { pos: 0, vel: 0 };
  private lookPitch: Spring = { pos: 0, vel: 0 };
  private tailTurn: Spring = { pos: 0, vel: 0 };
  private ears: { chain: number[]; spring: Spring; target: number; next: number; hold: number }[];
  private wingOpen = 0;
  private blinkAt = 2;
  private rng: () => number;

  constructor(private rig: CreatureRig, limbs: Limb[]) {
    const sk = rig.body.skeleton;
    this.chains = findChains(sk);
    this.wings = limbs.filter((l) => l.kind === 'wing');
    this.fins = limbs.filter((l) => l.kind === 'fin');
    this.mouths = sk.bones.flatMap((b, i) => (b.role === 'mouth' ? [i] : []));
    this.rng = mulberry32(rig.recipe.seed + 99);
    this.ears = this.chains.filter((c) => c.kind === 'ear').map((c) => ({ chain: c.chain, spring: { pos: 0, vel: 0 }, target: 0, next: 1 + this.rng() * 4, hold: 0 }));
    const size = rig.recipe.life.sizeM;
    this.flapHz = clamp(3 / Math.sqrt(size), 1.5, 12) * (rig.recipe.motion.gait === 'hover' ? 1.8 : 1);
  }

  private get bones(): Bone[] {
    return this.rig.obj.bones;
  }

  update(dt: number) {
    const r = this.rig;
    const t = r.time;
    const sway = r.recipe.motion.sway;
    this.breathe(t);
    this.blink(dt);
    for (const c of this.chains) {
      const n = c.chain.length;
      if (c.kind === 'neck') this.neck(c.chain, dt);
      else if (c.kind === 'tail') {
        this.tailTurn = springStep(this.tailTurn, -r.turnRate * 0.25, 30, 8, dt);
        const swim = r.swimmer && r.inWater;
        c.chain.forEach((k, i) => {
          const yaw = swim
            ? undulation(i, n, t * (0.8 + r.speed * 1.5), 0.35, 0.15)
            : sway * 0.18 * Math.sin(2 * Math.PI * 0.5 * t - i * 0.7) + this.tailTurn.pos / n + r.sleepNow * 0.35;
          this.bones[k].quaternion.copy(euler(r.sleepNow * 0.12, yaw));
        });
      } else if (c.kind === 'spine') {
        const moving = Math.min(1, r.speed / 0.2);
        const swim = r.swimmer && r.inWater;
        const travel = swim ? t * (0.8 + r.speed * 1.5) : r.distance / Math.max(0.1, r.bodyLength * 0.6) + t * 0.05;
        const amp = (0.12 + 0.3 * sway) * (0.3 + 0.7 * moving);
        // the root bone stays put (it carries the body); the rest bend in a wave
        c.chain.forEach((k, i) => {
          if (i === 0) return;
          this.bones[k].quaternion.copy(euler(0, undulation(i, n, travel, amp, 0.12)));
        });
      } else if (c.kind === 'antenna') {
        c.chain.forEach((k, i) => this.bones[k].quaternion.copy(euler(0.15 * Math.sin(t * 2.3 + i), 0.15 * Math.sin(t * 1.7 + i))));
      }
    }
    this.earTwitch(dt);
    this.flapWings(dt, t);
    this.paddleFins(t);
    for (const k of this.mouths) this.bones[k].quaternion.copy(euler(0.35 * r.callNow, 0));
    r.obj.root.updateMatrixWorld(true);
  }

  /** Torso swells a little with each breath (its children are scaled back so only the chest moves). */
  private breathe(t: number) {
    const r = this.rig;
    const torso = this.bones[0];
    const hz = (0.25 + 0.5 * r.recipe.mind.jumpiness) * (1 - 0.6 * r.sleepNow);
    const s = 1 + 0.015 * Math.sin(2 * Math.PI * hz * t);
    torso.scale.set(s, s, 1);
    for (const c of torso.children) if ((c as Bone).isBone) c.scale.set(1 / s, 1 / s, 1);
  }

  private blink(dt: number) {
    const r = this.rig;
    this.blinkAt -= dt;
    let shut = 0;
    if (this.blinkAt < 0) {
      shut = Math.sin(Math.PI * clamp(-this.blinkAt / 0.15, 0, 1));
      if (this.blinkAt < -0.15) this.blinkAt = 2 + this.rng() * 4;
    }
    for (const e of r.obj.eyes) e.blink(Math.max(shut, r.sleepNow));
  }

  /** Look at things (and up when calling); lower the head to the ground to graze or drink. */
  private neck(chain: number[], dt: number) {
    const r = this.rig;
    const root = r.obj.root;
    const n = chain.length;
    let yawT = 0, pitchT = 0;
    if (r.look) {
      const s = root.worldToLocal(this.bones[chain[0]].getWorldPosition(new Vector3()));
      const d = root.worldToLocal(toV(r.look)).sub(s);
      yawT = clamp(Math.atan2(d.x, d.z), -1.0, 1.0);
      pitchT = clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.6);
    }
    pitchT += -0.55 * r.callNow + 0.25 * r.sleepNow;
    this.lookYaw = springStep(this.lookYaw, yawT, 40, 11, dt);
    this.lookPitch = springStep(this.lookPitch, pitchT, 40, 11, dt);
    chain.forEach((k) => this.bones[k].quaternion.copy(euler(this.lookPitch.pos / n, this.lookYaw.pos / n)));
    root.updateMatrixWorld(true);

    const hd = r.headDownNow * (r.headDownNow > 0.9 ? 0.92 + 0.08 * Math.sin(r.time * 9) : 1); // nibbling
    if (hd < 0.01) return;
    // reach the mouth to the ground (or the water) a little in front of the chest
    const rest = r.body.skeleton.bones;
    const joints0: Vec3[] = [rest[chain[0]].start, ...chain.map((k) => rest[k].end)];
    const lengths = chain.map((k) => len(sub(rest[k].end, rest[k].start)));
    const total = lengths.reduce((a, b) => a + b, 0);
    const start = fromV(root.worldToLocal(this.bones[chain[0]].getWorldPosition(new Vector3())));
    const shift = sub(start, joints0[0]);
    const init = joints0.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y, z: p.z + shift.z }));
    const ahead = root.localToWorld(new Vector3(start.x, start.y, start.z + total * 0.55));
    const groundY = r.ground.isWater(ahead.x, ahead.z) ? r.ground.waterLevelAt(ahead.x, ahead.z) : r.ground.heightAt(ahead.x, ahead.z);
    ahead.y = groundY + rest[chain[n - 1]].r1;
    const target = fromV(root.worldToLocal(ahead));
    const pole = v3(start.x, start.y + total, start.z + total * 0.5);
    const joints = fabrik(init, lengths, target, n > 1 ? pole : null);
    const looked = chain.map((k) => this.bones[k].getWorldQuaternion(new Quaternion()));
    const rootQ = root.getWorldQuaternion(new Quaternion());
    chain.forEach((k, j) => {
      const restDir = norm(sub(rest[k].end, rest[k].start));
      const newDir = norm(sub(joints[j + 1], joints[j]));
      const down = rootQ.clone().multiply(new Quaternion().setFromUnitVectors(toV(restDir), toV(newDir)));
      r.setWorldRotation(this.bones[k], looked[j].slerp(down, hd));
    });
  }

  private earTwitch(dt: number) {
    for (const e of this.ears) {
      e.next -= dt;
      e.hold -= dt;
      if (e.hold < 0) e.target = 0; // a twitch, then back
      if (e.next < 0) {
        e.target = (this.rng() * 2 - 1) * 0.35;
        e.next = 1.5 + this.rng() * 4;
        e.hold = this.rng() < 0.5 ? 0.3 : 2;
      }
      e.spring = springStep(e.spring, e.target - this.rig.sleepNow * 0.4, 120, 14, dt);
      e.chain.forEach((k, i) => this.bones[k].quaternion.copy(euler(i === 0 ? e.spring.pos : 0, 0, i === 0 ? e.spring.pos * 0.5 : 0)));
    }
  }

  /** Wings fold along the back on the ground and flap (or glide) in the air. */
  private flapWings(dt: number, t: number) {
    const r = this.rig;
    this.wingOpen += ((r.flying ? 1 : 0) - this.wingOpen) * Math.min(1, dt * 4);
    const rest = r.body.skeleton.bones;
    const hovering = r.recipe.motion.gait === 'hover';
    const flapping = hovering || r.altitude < 1 || r.speed < 1.5 || t % 6 < 3.5;
    const theta = flapping ? 0.2 + 0.85 * Math.sin(2 * Math.PI * this.flapHz * t) : 0.12;
    for (const w of this.wings) {
      const side = w.side >= 0 ? 1 : -1;
      const k = w.chain[0];
      const restDir = toV(norm(sub(rest[k].end, rest[k].start)));
      const fold = new Quaternion().setFromUnitVectors(restDir, new Vector3(side * 0.22, 0.05, -1).normalize());
      const flap = new Quaternion().setFromAxisAngle(Z, side * theta);
      this.bones[k].quaternion.copy(fold.slerp(flap, this.wingOpen));
      // the outer wing tucks in when folded (a two-part wing can't Z-fold, so it shortens instead)
      const tuck = 0.5 + 0.5 * this.wingOpen;
      w.chain.slice(1).forEach((b) => {
        this.bones[b].quaternion.setFromAxisAngle(Z, side * theta * 0.4 * this.wingOpen);
        this.bones[b].scale.setScalar(tuck);
      });
    }
  }

  private paddleFins(t: number) {
    const speed = 1 + this.rig.speed;
    for (const f of this.fins) {
      const q = f.side === 0
        ? euler(0, 0.3 * Math.sin(2 * Math.PI * 1.6 * speed * t))
        : euler(0.4 * Math.sin(2 * Math.PI * 1.2 * t + f.side), 0, 0);
      f.chain.forEach((k) => this.bones[k].quaternion.copy(q));
    }
  }
}
