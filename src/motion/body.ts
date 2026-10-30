import { Euler } from 'three/webgpu';
import type { Skeleton } from '../builder/skeleton';
import type { Recipe } from '../recipe/schema';
import { v3, type Vec3 } from '../util/vec';
import { springInto, type Spring } from './chains';
import { torsoChain } from './limbs';
import type { CreatureRig } from './rig';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);
const scratch = new Euler(0, 0, 0, 'YXZ');

/** Total sideways spine bend (radians, + = bend to the left) for a turn: ∝ turnRate × min(1, speed/0.3 + 0.3), capped at ±0.35. */
export function spineBend(turnRate: number, speed: number): number {
  return clamp(0.15 * turnRate * Math.min(1, speed / 0.3 + 0.3), -0.35, 0.35);
}

/** Girdle roll (radians) from one leg pair's swing: the swinging leg's side drops: −side·amp·sin(π·s) while swinging, 0 in stance. side +1 = left. */
export function girdleRoll(side: 1 | -1, swing: boolean, s: number, amp: number): number {
  return swing ? -side * amp * Math.sin(Math.PI * s) : 0;
}

/** Sideways weight shift (m, + = towards the left): towards the side with more stance feet, scaled by hipWidth·k·(1 − min(1, speedFrac/0.35)). */
export function weightShift(stance: { side: number; down: boolean }[], hipWidth: number, k: number, speedFrac: number): number {
  const slow = 1 - Math.min(1, speedFrac / 0.35);
  let sum = 0, down = 0;
  for (const f of stance) if (f.down) { sum += f.side; down++; }
  // the mean side of the feet that are down: ±1 on one foot, 0 when they balance
  return down && slow > 0 && sum ? (sum / down) * hipWidth * k * slow : 0;
}

/**
 * Vertical bob (m): lowest at mid-stance of the leading stance pair, highest at push-off; amplitude amp. `phases` are each
 * leg's swing/stance state (the rig passes the leading pair's). Each stance foot pulls the body down most at its
 * mid-stance (cos 2πs), weighted by how far it is into its stance (sin πs), so feet landing and lifting never make it
 * jump; with no foot carrying it, it is at the top.
 */
export function gaitBob(phases: { swing: boolean; s: number }[], amp: number): number {
  let sum = 0, weight = 1e-3;
  for (const p of phases) {
    if (p.swing) continue;
    const w = Math.sin(Math.PI * p.s);
    sum += w * Math.cos(2 * Math.PI * p.s);
    weight += w;
  }
  return amp * (sum + 1e-3) / weight;
}

/** Spine flexion (radians, + = arch up / nose down at the front) for bounding gaits from the hind legs' phase: most flexed as the hind feet reach forward (late swing), most stretched at push-off. */
export function boundFlex(hindPhase: number, amp: number): number {
  return amp * Math.cos(2 * Math.PI * (hindPhase + 0.05));
}

/** Fraction of the body's gait motion the neck cancels: 0.7 at walk rising to 0.85 at gallop (by speedFrac). */
export function stabiliseShare(speedFrac: number): number {
  return 0.7 + 0.15 * clamp(speedFrac, 0, 1);
}

/** The share of a front foot's stance the nod lasts (it peaks halfway through, just after touchdown). */
const NOD_STANCE = 0.3;

/** Head nod (radians, + = nose down) as a front foot plants: peaks just after touchdown of either front leg; amp × (1 − speedFrac/0.75), ≥ 0. */
export function headNod(frontPhases: { swing: boolean; s: number }[], amp: number, speedFrac: number): number {
  const k = amp * Math.max(0, 1 - speedFrac / 0.75);
  let nod = 0;
  // sin² eases in from the touchdown and out again, so the head never jerks
  for (const p of frontPhases) if (!p.swing && p.s < NOD_STANCE) nod = Math.max(nod, Math.sin((Math.PI * p.s) / NOD_STANCE) ** 2);
  return k > 0 ? k * nod : 0;
}

/** Bird head bob: the head's forward offset (m) relative to the body over one step: holds still in the world for 80 % of each step (offset falls linearly from +a to −a) then thrusts forward (rises back to +a). */
export function birdHeadBob(stepPhase: number, a: number): number {
  const u = stepPhase - Math.floor(stepPhase);
  return u < 0.8 ? a - (2 * a * u) / 0.8 : -a + (2 * a * (u - 0.8)) / 0.2;
}

/** A creature that walks on two legs and has feathers (and wings). */
export function isBirdWalker(legCount: number, recipe: Recipe): boolean {
  return legCount === 2 && recipe.skin.regions.some((r) => r.covering === 'feathers') && recipe.parts.some((p) => p.role === 'wing');
}

/** Anticipation time (s) before setting off: 0.12 + 0.05 × sizeM, clamped to [0.12, 0.25]. */
export function anticipationTime(sizeM: number): number {
  return clamp(0.12 + 0.05 * sizeM, 0.12, 0.25);
}

/**
 * The folded wing's direction (creature space, unit) for a wing on `side` (+1 left): along the back towards the tail, on
 * the back's surface: normalize(−torsoDir + side·0.15·x̂ + 0.12·up⊥), up⊥ the part of +y across `torsoDir` (unit).
 * Written into `out` (pass a scratch vector in a frame loop).
 */
export function foldDirection(torsoDir: Vec3, side: 1 | -1, out: Vec3 = v3()): Vec3 {
  const d = torsoDir, ux = -d.y * d.x, uy = 1 - d.y * d.y, uz = -d.y * d.z;
  const x = -d.x + side * 0.15 + 0.12 * ux, y = -d.y + 0.12 * uy, z = -d.z + 0.12 * uz, n = Math.hypot(x, y, z);
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  return out;
}

/** The root bone's rest elevation (radians, + = nose up): atan2(d.y, hypot(d.x, d.z)) of bone 0's direction. */
export function restTilt(sk: Skeleton): number {
  const b = sk.bones[0], dx = b.end.x - b.start.x, dy = b.end.y - b.start.y, dz = b.end.z - b.start.z;
  return Math.atan2(dy, Math.hypot(dx, dz));
}

/** Coordinated-turn bank (radians, negative = left side down): clamp(−0.12·speed·turnRate, −0.7, 0.7). */
export function bankAngle(speed: number, turnRate: number): number {
  return clamp(-0.12 * speed * turnRate, -0.7, 0.7);
}

/** The settle's spring: stiff enough to be over in well under a second, damped to overshoot once. */
const SETTLE_K = 60;
const SETTLE_C = 10;
/**
 * A change of gait (or leaving or regaining the feet) restarts the gait's body motion from new phases: the bob, rock,
 * rolls, flex and hip swing would jump. Instead each carries on from where it was and eases into the new gait at this
 * rate (1/s): the difference is kept as an offset that fades.
 */
const BLEND_RATE = 10;
const BLENDED = ['pitch', 'roll', 'bob', 'hipsRoll', 'shouldersRoll', 'bend', 'flex', 'hipsYaw'] as const;
/** How long (s) the anticipation's dip takes to let go as the body sets off. */
const RELEASE = 0.15;
/** The settle's kick per m/s of the speed it stopped from (pitch, rad/s, up to 4 m/s) and its sink (× leg length per s). */
const SETTLE_PITCH = 1.4;
const SETTLE_SINK = 0.25;

/** A damped spring for the settle after stopping (pitch and height); `kick` adds a velocity impulse. */
export class Settle {
  private readonly p: Spring = { pos: 0, vel: 0 };
  private readonly h: Spring = { pos: 0, vel: 0 };
  /** Radians, + = nose down. */
  get pitch(): number {
    return this.p.pos;
  }
  /** Metres, − = down. */
  get height(): number {
    return this.h.pos;
  }
  /** Just stopped from `speed` (m/s): the body carries on forward, pitching nose down and sinking onto its legs. */
  kick(speed: number, legLen: number): void {
    this.p.vel += (SETTLE_PITCH * Math.min(speed, 4)) / 4;
    this.h.vel -= SETTLE_SINK * legLen;
  }
  step(dt: number): void {
    if (dt <= 0) return;
    springInto(this.p, 0, SETTLE_K, SETTLE_C, dt);
    springInto(this.h, 0, SETTLE_K, SETTLE_C, dt);
  }
}

export type BodyPose = { pitch: number; roll: number; offsetX: number; bob: number; hipsRoll: number; shouldersRoll: number; bend: number; flex: number; hipsYaw: number };

/** Owns the torso chain of a legged body: computes the gait's contributions to the root and poses the torso bones. */
export class BodyMotion {
  readonly legged: boolean; // ≥ 2 legs
  readonly torso: number[]; // torsoChain
  readonly hipWidth: number; // 2 × mean |home.x| of the hind legs (0 when none)
  readonly pose: BodyPose = { pitch: 0, roll: 0, offsetX: 0, bob: 0, hipsRoll: 0, shouldersRoll: 0, bend: 0, flex: 0, hipsYaw: 0 };
  /** On its feet this frame (not flying, up high, swimming or floating): the gait poses the body. */
  onFeet = false;
  /** The front legs' swing/stance this frame (empty when no leg is in front), for the head's nod. */
  readonly front: { swing: boolean; s: number }[];
  /** Weight shift strength: bipeds lean well over the stance foot, quadrupeds lightly. */
  private readonly k: number;
  /** The leg whose phase swings the hips (left hind, or the left leg of a biped). */
  private readonly hipLeg: number;
  private readonly stance: { side: number; down: boolean }[];
  /** The legs whose stance sets the bob: the front pair (every leg when none is in front), and their phases this frame. */
  private readonly lead: number[];
  private readonly leadPhases: { swing: boolean; s: number }[];
  private readonly frontLegs: number[];
  private readonly tilt = { pitch: 0, roll: 0 };
  /** Starts and stops, pose only: the root's extra pitch (+ = nose down), height (m) and roll this frame. */
  readonly pace = { pitch: 0, height: 0, roll: 0 };
  readonly settle = new Settle();
  /** Seconds into the anticipation before setting off (−1: not gathering), how long it lasts, and how much of its dip is still to let go (→ 0). */
  private antic = -1;
  private anticFor = 0;
  private release = 0;
  /** The lean with acceleration (pitch, roll), eased. */
  private lean = 0;
  private leanRoll = 0;
  /** The speed at the last update, seconds since the body last went faster than a quarter of its top speed, and the fastest since. */
  private lastSpeed = 0;
  private sinceFast = Infinity;
  private fastest = 0;
  /** An idle re-plant's weight shift: the side of the foot that steps (+1 left), and how much longer the weight stays off it (s). */
  private shiftSide = 0;
  private shiftLeft = 0;
  /** The gait the body moved in at the last update (null: not on its feet; undefined: none yet), and the offsets easing a change of gait out (see BLEND_RATE). */
  private mode: string | null | undefined = undefined;
  private readonly blend = new Float64Array(BLENDED.length);
  private readonly lastOut = new Float64Array(BLENDED.length);

  constructor(private rig: CreatureRig) {
    const legs = rig.legs;
    this.legged = legs.length >= 2;
    this.torso = torsoChain(rig.body.skeleton);
    const hind = legs.filter((l) => !l.front);
    this.hipWidth = hind.length ? (2 * hind.reduce((s, l) => s + Math.abs(l.home.x), 0)) / hind.length : 0;
    this.k = legs.length === 2 ? 0.45 : legs.length === 4 ? 0.12 : 0.08;
    this.hipLeg = Math.max(0, legs.findIndex((l) => l.left && !l.front));
    this.stance = legs.map((l) => ({ side: l.limb.side, down: true }));
    this.frontLegs = legs.flatMap((l, i) => (l.front ? [i] : []));
    this.lead = this.frontLegs.length ? this.frontLegs : legs.map((_, i) => i);
    this.leadPhases = this.lead.map(() => ({ swing: false, s: 0 }));
    this.front = this.frontLegs.map(() => ({ swing: false, s: 0 }));
  }

  /** A legged body standing or walking on the ground now (not flying, up high, swimming or floating). */
  get grounded(): boolean {
    const r = this.rig;
    return this.legged && !r.flying && r.altitude <= 0.05 && !(r.inWater && (r.swimmer || r.floater));
  }

  /** Gathering itself to set off (a self-steering rig holds its speed at 0 meanwhile). */
  get anticipating(): boolean {
    return this.antic >= 0;
  }

  /** Start the anticipation (unless already gathering or letting go): a dip and a nose-down pitch over anticipationTime, then let go. */
  anticipate(): void {
    if (this.antic >= 0 || this.release > 0) return;
    this.antic = 0;
    this.anticFor = anticipationTime(this.rig.recipe.life.sizeM);
  }

  /** A foot on this side (+1 left) is about to step while standing: ease the weight off it for 2 s. */
  shiftOff(side: number): void {
    this.shiftSide = side;
    this.shiftLeft = 2;
  }

  /**
   * Measure afresh from the speed now (the body has jumped: back in view): no start, stop or lean from the jump, and no
   * change of gait from the one it had when last seen (that pose is not on screen to ease out of; paused, it would hold).
   */
  resync(): void {
    this.lastSpeed = this.rig.speed;
    this.fastest = 0;
    this.mode = undefined;
    this.blend.fill(0);
  }

  /**
   * Starts and stops, as pose only (`pace`), after the rig has moved for this update: the anticipation's dip (a driven rig,
   * which cannot hold still to gather itself, dips as the simulation sets it off), the lean with acceleration (nose down
   * speeding up, up braking, into a turn) and the settle on stopping after going at a fair pace. Nothing moves at dt = 0.
   */
  startStop(dt: number): void {
    const r = this.rig, p = this.pace, onFeet = this.grounded;
    if (dt > 0) {
      const speed = r.speed, top = r.traits.topSpeed;
      if (r.driven && onFeet && this.lastSpeed < 0.05 && speed >= 0.05) this.anticipate();
      if (speed > 0.25 * top) {
        this.sinceFast = 0;
        this.fastest = Math.max(this.fastest, speed);
      } else if ((this.sinceFast += dt) > 1) this.fastest = 0;
      if (onFeet && this.fastest > 0 && this.lastSpeed >= 0.05 && speed < 0.05) {
        this.settle.kick(this.fastest, r.legLength);
        this.fastest = 0;
      }
      this.lastSpeed = speed;
      if (this.antic >= 0) {
        // over at its time; a driven body that slows to a stop again was only creeping: let go of what it dipped
        this.antic += dt;
        if (this.antic >= this.anticFor || (r.driven && speed < 0.05)) {
          this.release = this.dip(speed);
          this.antic = -1;
        }
      } else this.release = Math.max(0, this.release - dt / RELEASE);
    }
    const lean = onFeet ? clamp((0.04 * r.accel) / Math.max(1, r.topSpeed * 0.5), -0.08, 0.08) : 0;
    const k = r.legs.length === 2 ? 2 : 1; // a biped leans into a turn twice as far
    const roll = onFeet ? clamp(-0.02 * k * r.sideAccel, -0.06 * k, 0.06 * k) : 0;
    this.lean = approach(this.lean, lean, 6, dt);
    this.leanRoll = approach(this.leanRoll, roll, 6, dt);
    this.settle.step(dt);
    // eased in and out (smoothstep), so the dip starts and ends without a jolt
    const d = this.antic >= 0 ? this.dip(r.speed) : this.release, dip = d * d * (3 - 2 * d);
    // the brake's lean (nose up) fades out with the last quarter of the speed, so a stop begins level and the settle
    // swings the body on past it, then back
    const brake = this.lean < 0 ? Math.min(1, r.speed / (0.25 * r.traits.topSpeed)) : 1;
    p.pitch = this.lean * brake + this.settle.pitch + 0.09 * dip;
    p.height = this.settle.height - 0.03 * r.legLength * dip;
    p.roll = this.leanRoll;
  }

  /**
   * How deep the anticipation's dip is (0..1): its progress; a driven body's no deeper than its speed has got towards
   * setting off properly (0.15 of its top speed), so a grazer creeping on between bites hardly dips.
   */
  private dip(speed: number): number {
    const u = Math.min(1, this.antic / this.anticFor);
    return this.rig.driven ? Math.min(u, speed / (0.15 * this.rig.traits.topSpeed)) : u;
  }

  /**
   * Before the root is placed: returns the root's extra pitch, roll, sideways offset and bob for this frame (and the torso's
   * pose). A change of gait carries each on from where it was and eases into the new one.
   */
  gait(dt: number, phases: { swing: boolean; s: number }[]): BodyPose {
    const p = this.pose, off = this.blend, prev = this.lastOut, was = this.mode;
    for (let k = 0; k < BLENDED.length; k++) prev[k] = p[BLENDED[k]];
    this.gaitPose(dt, phases);
    const mode = this.onFeet ? this.rig.gait : null, changed = was !== undefined && mode !== was;
    this.mode = mode;
    for (let k = 0; k < BLENDED.length; k++) {
      // a change: the offset keeps the pose where it was; then it fades
      const key = BLENDED[k], raw = p[key];
      off[k] = changed ? prev[k] - raw : approach(off[k], 0, BLEND_RATE, dt);
      p[key] = raw + off[k];
    }
    return p;
  }

  /** The gait's body motion for this frame, from the legs' phases, into `pose` (`gait` eases a change of gait). */
  private gaitPose(dt: number, phases: { swing: boolean; s: number }[]): BodyPose {
    const r = this.rig, p = this.pose, legs = r.legs;
    for (let j = 0; j < this.frontLegs.length; j++) this.front[j] = phases[this.frontLegs[j]];
    const onFeet = (this.onFeet = this.grounded);
    if (!onFeet) {
      p.pitch = p.roll = p.bob = p.hipsRoll = p.shouldersRoll = p.bend = p.flex = p.hipsYaw = 0;
      p.offsetX = approach(p.offsetX, 0, 8, dt);
      this.shiftLeft = Math.max(0, this.shiftLeft - dt);
      return p;
    }
    const { bounce, sway } = r.recipe.motion;
    const step = r.stepping, gallop = r.gait === 'gallop', hop = r.gait === 'hop';
    const legLen = r.legLength;
    const speedFrac = r.speed / Math.max(1e-6, r.topSpeed);

    // girdles: the side whose leg swings drops, the hips from the hind legs and the shoulders from the front ones
    const amp = 0.05 * (0.5 + sway) * (gallop ? 0.4 : 1) * step;
    let hips = 0, shoulders = 0;
    for (let i = 0; i < legs.length; i++) {
      const side = legs[i].limb.side;
      this.stance[i].down = !phases[i].swing;
      if (!side) continue;
      const roll = girdleRoll(side, phases[i].swing, phases[i].s, amp);
      if (legs[i].front) shoulders += roll;
      else hips += roll;
    }
    p.hipsRoll = clamp(hips, -amp, amp);
    p.shouldersRoll = clamp(shoulders, -amp, amp);
    p.roll = this.torso.length > 1 ? 0 : p.hipsRoll + 0.5 * p.shouldersRoll;

    // the hip reaches forward with its leg (left hip forward is a turn to the right); hopping legs move together
    const duty = r.duty, hp = phases[this.hipLeg];
    const hipPhase = hp.swing ? duty + hp.s * (1 - duty) : hp.s * duty;
    p.hipsYaw = hop ? 0 : 0.04 * Math.sin(2 * Math.PI * (hipPhase - 0.25)) * step;

    // an idle re-plant eases the weight off the stepping foot, to the other side
    const idle = this.shiftLeft > 0 ? -this.shiftSide * this.hipWidth * this.k : 0;
    this.shiftLeft = Math.max(0, this.shiftLeft - dt);
    p.offsetX = approach(p.offsetX, weightShift(this.stance, this.hipWidth, this.k, speedFrac) * step + idle, 8, dt);

    if (hop) {
      // the hind legs push the whole body up
      let hs = -1;
      for (let i = 0; i < legs.length; i++) if (!legs[i].front && phases[i].swing) { hs = phases[i].s; break; }
      p.bob = hs >= 0 ? Math.sin(Math.PI * hs) * 0.25 * legLen * step : 0;
    } else {
      // walking legs overlap so much that the front and hind pairs' bobs cancel: the front pair leads; a gallop lands
      // its pairs one after the other, each loading the body, with a moment of flight between
      const lead = gallop ? phases : this.leadPhases;
      if (!gallop) for (let j = 0; j < this.lead.length; j++) lead[j] = phases[this.lead[j]];
      p.bob = gaitBob(lead, 0.02 * legLen * (0.5 + bounce) * step * (gallop ? 2.5 : 1));
    }
    // a gallop rocks the body: nose down as the front feet land, up at take-off
    p.pitch = gallop ? 0.06 * (0.5 + bounce) * Math.sin(2 * Math.PI * (r.phase + 0.25)) * step : 0;

    p.bend = spineBend(r.turnRate, r.speed);
    const flexAmp = 0.12 * (0.5 + bounce) * (gallop || hop ? 1 : r.gait === 'trot' ? 0.3 : 0) * step;
    p.flex = flexAmp ? boundFlex(hipPhase, flexAmp) : 0;
    return p;
  }

  /**
   * The gait's pitch and roll of the body as seen at one of its bones (radians): the root's rock and roll, plus, at a torso
   * bone, the flex and girdle roll the torso bones have added up to it (the chest dips by flex/2 and rolls with the
   * shoulders). Off the torso it is the root's alone. One object, reused.
   */
  gaitTilt(bone: number): { pitch: number; roll: number } {
    const p = this.pose, n = this.torso.length, i = this.torso.indexOf(bone), t = this.tilt;
    t.pitch = p.pitch;
    t.roll = p.roll;
    if (n > 1 && i >= 0) {
      t.pitch += -p.flex / 2 + (i * p.flex) / (n - 1);
      t.roll += p.hipsRoll + (i * (p.shouldersRoll - p.hipsRoll)) / (n - 1);
    }
    return t;
  }

  /**
   * After the root is placed: bend, flex and roll the torso bones (front half follows the shoulders). The weight shift
   * slides the skeleton's root bone along the root's x, so the root itself stays exactly where the rig (or the
   * simulation) put it, and the feet keep landing where they would without the shift.
   */
  poseTorso(): void {
    if (!this.legged) return;
    const p = this.pose, bones = this.rig.obj.bones, n = this.torso.length, m = n - 1;
    const rest = this.rig.body.skeleton.bones[this.torso[0]].start;
    bones[this.torso[0]].position.set(rest.x + p.offsetX, rest.y, rest.z);
    if (n < 2) return; // one torso bone: the root carries the roll, the neck and tail the bend
    // the hips rise and the chest dips for an arch (the turn is spread evenly along the chain); along the chain the
    // roll and the hips' yaw blend from the hips' to the shoulders', so the chest holds still while the hips swing
    bones[this.torso[0]].quaternion.setFromEuler(scratch.set(-p.flex / 2, p.hipsYaw, p.hipsRoll, 'YXZ'));
    scratch.set(p.flex / m, (p.bend - p.hipsYaw) / m, (p.shouldersRoll - p.hipsRoll) / m, 'YXZ');
    for (let i = 1; i < n; i++) bones[this.torso[i]].quaternion.setFromEuler(scratch);
  }
}
