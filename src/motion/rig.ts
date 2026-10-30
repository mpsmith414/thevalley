import { Quaternion, Vector3, type Bone } from 'three/webgpu';
import type { BodyData } from '../builder/build';
import type { Recipe } from '../recipe/schema';
import type { CreatureObject } from '../render/creature';
import { newMotion, steer } from '../sim/mover';
import { traitsFor, type Traits } from '../sim/traits';
import { mulberry32 } from '../util/rng';
import { dot, len, lerp, norm, sub, v3, type Vec3 } from '../util/vec';
import { bankAngle, BodyMotion, restTilt } from './body';
import { springInto, type Spring } from './chains';
import { chooseGait, phasesFor, STRIDE, type GaitName } from './gait';
import { fabrikInto } from './ik';
import { findLimbs, type Limb } from './limbs';
import { mediumOf } from './medium';
import { SecondaryMotion } from './secondary';

export type Ground = {
  heightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  waterLevelAt(x: number, z: number): number;
};

type Leg = {
  limb: Limb;
  ik: number[]; // bones moved by IK (the chain without its final foot)
  foot: number | null;
  rest: Vec3[]; // rest joints of the IK chain, creature space
  lengths: number[];
  reach: number; // the lengths' sum
  joints: Vec3[]; // the IK chain's joints, solved every frame in place (creature space)
  home: Vec3; // rest position of the IK tip (ankle), creature space
  bend: Vec3; // which way the middle joints bend, creature space (unit)
  left: boolean;
  front: boolean;
  lift: number; // current swing height above ground (m)
  planted: Vec3 | null; // where the foot is locked on the ground during stance (world)
  plant: Vec3; // the rig's own storage for `planted` (it writes here and points `planted` at it; others may point it elsewhere)
  liftoff: Vec3; // where the current swing started (world)
  swinging: boolean;
  world: Vec3; // last foot target, world space
  /** A re-plant step while standing (squaring up, an idle shuffle): how far through it (0..1; −1: none), and from where to where (world). */
  step: number;
  from: Vec3;
  to: Vec3;
};

const tmpV = new Vector3();
const tmpQ = new Quaternion();
/** Scratch for the per-frame path (allocation-free, Ruling R19): the heading's rotation, the root's world rotation, and points and rotations in between. */
const yawQ = new Quaternion();
const rootQ = new Quaternion();
const qd = new Quaternion();
const qw = new Quaternion();
const scratchW = new Vector3();
const scratchDir = new Vector3();
const scratchP = new Vector3();
const scratchS = new Vector3();
const scratchLand = v3();
const scratchTarget = v3();
const scratchPole = v3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
/** Which legs' ground `groundUnder` averages. */
const FRONT = 0, HIND = 1, LEFT = 2, RIGHT = 3;
export const toV = (v: Vec3) => new Vector3(v.x, v.y, v.z);
export const fromV = (v: Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const smooth = (t: number) => t * t * (3 - 2 * t);
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const scratchHome = v3();
/** Standing still this long (s) before the feet square up; a re-plant step's length (s) and lift (× leg length). */
const SQUARE_AFTER = 0.3;
const REPLANT_TIME = 0.3;
const REPLANT_LIFT = 0.08;
/**
 * Take-off: the crouch's length (s), how soon it is at its deepest (s) and its depth (× leg length); the jump off the
 * ground (× leg length, over JUMP_TIME s) and how long the strong first downstrokes last (s). Landing: the flare starts
 * a body length up; a driven flier (with no wish to read) is landing while it sinks faster than FLARE_SINK m/s, and has
 * given up landing if it climbs faster than FLARE_ABORT m/s.
 */
const CROUCH_TIME = 0.2;
const CROUCH_DOWN = 0.12;
const CROUCH_DIP = 0.15;
const JUMP = 0.3;
const JUMP_TIME = 0.1;
const STRONG_STROKES = 0.5;
const FLARE_SINK = 0.05;
const FLARE_ABORT = 0.3;
/** The tucked legs' first-segment angle (radians, + = back): folded back in flight, reaching forward-down to land, folded on water. */
const TUCK_FLY = 0.9;
const TUCK_REACH = -0.5;
const TUCK_SWIM = 0.5;
/**
 * The talons (the foot bone, radians, + = toes down): in flight folded on along the tucked leg, so the toes trail back;
 * flaring to land, held near level in the world with the toes a little up, open to grip, so the foot meets the ground
 * almost as flat as it stands.
 */
const TALON_FLY = 0.9;
const TALON_REACH = -0.15;
/** The flight pitch's spring (stiffness, damping): critically damped at 8 rad/s, about as quick as the old ease at rate 6. */
const PITCH_K = 64;
const PITCH_C = 16;
/** A floater on water bobs (m: two waves, at Hz) and yaws a little (radians, at Hz, from its own seeded phase). */
const BOB_A = 0.004;
const BOB_HZ = 0.6;
const BOB_B = 0.002;
const BOB_B_HZ = 1.7;
const WOBBLE = 0.03;
const WOBBLE_HZ = 0.35;

/** Where the simulation has put an animal and how it is moving, for a driven rig to show. */
export type DrivenPose = { x: number; z: number; yaw: number; speed: number; turnRate: number; altitude: number; flying: boolean };

/**
 * Drives a creature's bones every frame: moves and turns its body (on land, in the air or in water),
 * cycles its legs through a gait, plants feet on the real ground and bends each leg to reach them.
 * Actions steer it through the intent fields (look, headDown, sleep, calling, wantFly, mouth, ears). In the valley the
 * simulation moves it instead (`drive`), and the rig only shows the gait, legs and the rest.
 */
export class CreatureRig {
  readonly legs: Leg[];
  readonly legLength: number;
  readonly bodyLength: number;
  readonly secondary: SecondaryMotion;
  /** Body mechanics of a legged body: spine, girdles, weight and bob (`rig.body` is the built body data). */
  readonly mech: BodyMotion;
  readonly canFly: boolean;
  /** Lives in water (fish and other legless water creatures). */
  readonly swimmer: boolean;
  /** Walks on land but floats and paddles on water (ducks). */
  readonly floater: boolean;
  /** Speeds, size and what it can do, as the simulation sees it (built once, with this rig's speed cap). */
  readonly traits: Traits;
  /** World position of the creature's ground origin, and its heading (radians; 0 faces +z). */
  readonly position = new Vector3();
  yaw = 0;
  speed = 0; // m/s now
  speedFrac = 0; // wanted fraction of the lab's top speed
  turnRate = 0;
  phase = 0;
  gait: GaitName = 'walk';
  duty = 0.7; // the gait's share of each leg's cycle on the ground
  stepping = 0; // how much the legs are stepping (0 standing … 1 moving)
  /** Back in view (a fresh drive): the next update sets `stepping` to what the legs do now instead of easing to it. */
  private restep = false;
  distance = 0; // metres travelled (drives slithering)
  time = 0;
  target: Vector3 | null = null;
  /** The turn still to make toward the target (radians, + = left); 0 with no target, and when driven (it has none). */
  headingError = 0;
  /** Forward acceleration (m/s²), from the change in speed between updates; sideways (m/s², + = to the left): speed × turnRate. */
  accel = 0;
  sideAccel = 0;

  // intents, set by actions (0..1 unless noted)
  look: Vec3 | null = null; // a world point to look at
  headDown = 0;
  sleep = 0;
  calling = 0;
  wantFly = false;
  mouth: 'shut' | 'chew' | 'lap' = 'shut';
  ears: 'rest' | 'alert' | 'back' = 'rest';

  // smoothed state
  headDownNow = 0;
  sleepNow = 0;
  callNow = 0;
  flying = false;
  altitude = 0;
  /** Flying height above the ground (m); null for the lab's low hop, a couple of body lengths up. */
  cruise: number | null = null;
  inWater = false;
  /** Moved by the simulation through `drive` rather than steering itself toward `target`. */
  driven = false;
  /** Climbing (m/s, + = up). */
  climb = 0;
  /** Where a flier is in its flight: on the ground, crouched to take off, in the air, or flaring to land. */
  phaseOfFlight: 'ground' | 'crouch' | 'air' | 'flare' = 'ground';
  /** Seconds left of the take-off's strong downstrokes. */
  strokes = 0;
  /** The rig's own fields as the simulation's motion, for `steer`. */
  private readonly motion = newMotion(0, 0, 0);
  /** Altitude at the last driven update, for the climb that pitches a driven flier. */
  private drivenAltitude = 0;
  /** The same motion, for asking `steer` what speed it wants (see `wantedSpeed`). */
  private readonly probe = newMotion(0, 0, 0);
  /** For the acceleration: the speed when it last changed, the time since, and the time between the last two changes. */
  private accelFrom = 0;
  private accelClock = 0;
  private accelGap = 0;
  /** How long it has stood still on its feet (s), the time to the next idle re-plant (s), and its randomness. */
  private stillFor = 0;
  private idleIn: number;
  private readonly idleRng: () => number;
  /** The body's rest elevation (radians, + = nose up), which level flight takes out. */
  private readonly tilt: number;
  /** Seconds into the take-off crouch (−1: not crouching), the jump still to rise (m), and whether it flew at the last update. */
  private crouchFor = -1;
  private jumpLeft = 0;
  private flewLast = false;
  /** Flaring to land; the tucked legs' and talons' angles (eased). */
  private flaring = false;
  private legTuck = 0;
  private footTuck = 0;
  /** The root's pitch in flight (+ = nose down: level flight takes out the rest tilt), and as it eases back after landing (on a spring). The head takes it back. */
  flightPitch = 0;
  private readonly pitchSpring: Spring = { pos: 0, vel: 0 };
  /** The underside of the body and tail behind the ground origin (creature space, rest; y and z of each point), which a nose-up flier must keep off the ground. */
  private readonly rearY: number[] = [];
  private readonly rearZ: number[] = [];
  /** A floater's yaw wobble phase (radians): its own, so a raft of ducks never wobbles in step. */
  private readonly wobblePhase: number;
  /** Per-frame state kept between updates so `update` allocates nothing: the legs' limbs, each leg's swing/stance this frame, each gait's phase offsets, and the ground under each leg's home. */
  private readonly limbs: Limb[];
  private readonly phases: { swing: boolean; s: number }[];
  private readonly gaitPhases: Partial<Record<GaitName, { phase: number[]; duty: number }>> = {};
  private readonly homeGround: Float64Array;
  /** The front feet's lead over the hind ones and twice the widest left foot's reach (m, rest): the spans the body's slope is measured over (0: none). */
  private readonly pitchSpan: number;
  private readonly rollSpan: number;
  /** Each bone's rest direction (creature space, unit), for pointing a chain along solved joints. */
  readonly restDirs: Vector3[];
  /**
   * The bones whose world matrices `poseSkeleton` works out, parents first: all but the legs below their first bone, which
   * the legs work out themselves as they bend (the first stays: its place is where a leg hangs from).
   */
  private readonly skeletonPass: Bone[] = [];

  constructor(
    readonly obj: CreatureObject,
    readonly body: BodyData,
    readonly recipe: Recipe,
    readonly ground: Ground,
    readonly speedCap = 3,
    /** Mixed into the seed of this animal's own randomness (idle re-plants, a floater's wobble), so a herd of one recipe never shuffles or wobbles in step. */
    salt = 0,
  ) {
    const bones = body.skeleton.bones;
    const min = body.skeleton.min, max = body.skeleton.max;
    this.bodyLength = Math.max(0.05, max.z - min.z);
    const limbs = findLimbs(body.skeleton);
    const legLimbs = limbs.filter((l) => l.kind === 'leg');
    const perSide = Math.max(1, ...[-1, 0, 1].map((s) => legLimbs.filter((l) => l.side === s).length));
    this.legs = legLimbs.map((limb) => {
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
        limb, ik, foot: hasFoot ? last : null, rest, lengths, reach: lengths.reduce((s, x) => s + x, 0), joints: rest.map((p) => ({ ...p })),
        home: { ...b }, bend, left: limb.side >= 0, front: limb.rank === 0 && perSide > 1, lift: 0, planted: null, plant: v3(), liftoff: v3(),
        swinging: false, world: v3(), step: -1, from: v3(), to: v3(),
      };
    });
    this.legLength = this.legs.length ? Math.max(...this.legs.map((l) => l.reach)) : this.bodyLength * 0.3;
    this.limbs = this.legs.map((l) => l.limb);
    this.phases = this.legs.map(() => ({ swing: false, s: 0 }));
    this.homeGround = new Float64Array(this.legs.length);
    const frontZ = this.legs.filter((l) => l.front).map((l) => l.home.z);
    const hindZ = this.legs.filter((l) => !l.front).map((l) => l.home.z);
    this.pitchSpan = frontZ.length && hindZ.length ? Math.max(...frontZ) - Math.min(...hindZ) : 0;
    const lefts = this.legs.filter((l) => l.limb.side > 0).map((l) => l.home.x);
    this.rollSpan = lefts.length ? 2 * Math.max(...lefts) : 0;
    this.restDirs = bones.map((b) => toV(norm(sub(b.end, b.start))));
    const legBone = new Set(this.legs.flatMap((l) => l.limb.chain.slice(1)));
    for (const queue = [obj.bones[0]]; queue.length; ) {
      const b = queue.shift()!;
      this.skeletonPass.push(b);
      for (const c of b.children) if ((c as Bone).isBone && !legBone.has(obj.bones.indexOf(c as Bone))) queue.push(c as Bone);
    }
    this.traits = traitsFor(recipe, mediumOf(recipe), speedCap);
    this.canFly = this.traits.canFly;
    this.swimmer = this.traits.swimmer;
    this.floater = this.traits.floater;
    this.mech = new BodyMotion(this);
    this.secondary = new SecondaryMotion(this, limbs);
    this.idleRng = mulberry32((recipe.seed + 12) ^ Math.imul(salt, 0x9e3779b1));
    this.idleIn = 8 + 12 * this.idleRng();
    this.wobblePhase = 2 * Math.PI * mulberry32((recipe.seed + 31) ^ Math.imul(salt, 0x9e3779b1))();
    this.tilt = restTilt(body.skeleton);
    for (const b of bones) {
      if (b.role !== 'torso' && b.role !== 'tail') continue;
      if (b.start.z < 0) this.rearY.push(b.start.y - b.r0), this.rearZ.push(b.start.z);
      if (b.end.z < 0) this.rearY.push(b.end.y - b.r1), this.rearZ.push(b.end.z);
    }
  }

  /** The settle after stopping (a spring on the body's pitch and height). */
  get settle() {
    return this.mech.settle;
  }

  moveTo(target: Vec3 | null) {
    this.target = target ? toV(target) : null;
  }
  setSpeed(frac: number) {
    this.speedFrac = Math.max(0, Math.min(1, frac));
  }
  get topSpeed() {
    return this.flying ? this.traits.flySpeed : this.traits.topSpeed;
  }
  /** Close enough to the current target (or no target). */
  arrived(within = 0.3) {
    return !this.target || this.target.clone().sub(this.position).setY(0).length() < within;
  }
  /** Height of the body's resting point above the ground (creature space). */
  get restHeight() {
    return Math.max(0.01, this.body.skeleton.bones[0].start.y);
  }

  update(dt: number) {
    const root = this.obj.root;
    this.time += dt;
    this.headDownNow = approach(this.headDownNow, this.headDown, 3, dt);
    this.sleepNow = approach(this.sleepNow, this.sleep, 1.5, dt);
    this.callNow = approach(this.callNow, this.calling, 6, dt);
    if (this.driven) {
      if (dt > 0) {
        // no time, no climb to read (a paused frame keeps the pitch it had)
        this.climb = (this.altitude - this.drivenAltitude) / Math.max(dt, 1e-6);
        this.drivenAltitude = this.altitude;
      }
      this.headingError = 0;
    } else this.locomotion(dt);
    if (dt > 0) {
      this.measureAccel(dt);
      this.flightEvents(dt);
    }
    this.flightPhase();
    this.secondary.beat(dt);
    this.sideAccel = this.speed * this.turnRate;
    this.distance += this.speed * dt;
    this.inWater = this.ground.isWater(this.position.x, this.position.z);
    const legLen = this.legLength;
    const speedFrac = this.speed / Math.max(1e-6, this.topSpeed);
    this.gait = chooseGait(this.limbs, this.recipe, speedFrac);
    const { phase: offsets, duty } = (this.gaitPhases[this.gait] ??= phasesFor(this.limbs, this.gait));
    const stride = STRIDE[this.gait] * legLen;
    // turning on the spot still needs steps
    const effective = this.speed + Math.abs(this.turnRate) * this.bodyLength * 0.5;
    const onFeet = !this.flying && !(this.inWater && (this.swimmer || this.floater));
    const steps = onFeet && effective > 0.03 && this.sleepNow < 0.5 ? 1 : 0;
    this.stepping = this.restep ? steps : approach(this.stepping, steps, 4, dt);
    this.restep = false;
    const freq = Math.max(effective, 0.15 * this.stepping) / stride;
    this.phase = (this.phase + freq * dt * (this.stepping > 0.01 ? 1 : 0)) % 1;
    this.duty = duty;
    const phases = this.legPhase(offsets, duty);
    this.mech.startStop(dt);
    const mech = this.mech.gait(dt, phases);

    // body: sit at the average ground height under the feet, tilt with the slope, bob, roll and sway with the steps
    yawQ.setFromAxisAngle(Y, this.yaw);
    const legs = this.legs, n = legs.length, ground = this.ground, px = this.position.x, pz = this.position.z;
    let groundY: number;
    if (n) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const h = legs[i].home, w = scratchW.set(h.x, h.y, h.z).applyQuaternion(yawQ).add(this.position);
        sum += this.homeGround[i] = ground.heightAt(w.x, w.z);
      }
      groundY = sum / n;
    } else groundY = ground.heightAt(px, pz);
    // in flight the body flies level (its rest tilt taken out as the wings open) and pitches with the climb; flaring, it
    // rears up nose high; landed, that eases back out
    const flare = -Math.min(0.7, 0.7 * Math.max(0, 1 - this.altitude / this.bodyLength));
    const flightTarget = !this.flying ? 0 : Math.max(this.flaring ? flare : this.tilt * this.secondary.wingOpen - this.climb * 0.25, -this.rearRoom());
    // through a critically damped spring: a new target (the flare, levelling off, landing) starts the turn smoothly
    this.flightPitch = springInto(this.pitchSpring, flightTarget, PITCH_K, PITCH_C, dt).pos;
    const dip = this.takeoffDip();
    let pitch = this.flightPitch, roll = 0, wobble = 0, y: number;
    if (this.flying) {
      // the body lifts with each downstroke
      const sec = this.secondary;
      y = ground.heightAt(px, pz) + this.altitude + dip - Math.cos(2 * Math.PI * sec.flapPhase) * 0.02 * Math.min(1.5, sec.flapAmp / 0.85);
      roll = bankAngle(this.speed, this.turnRate);
    } else if (this.inWater && this.swimmer) {
      // cruise mid-water, never through the bed
      const bed = ground.heightAt(px, pz) + this.restHeight;
      y = Math.max(bed, ground.waterLevelAt(px, pz) - 0.22) - this.restHeight;
      roll = -this.turnRate * 0.15;
    } else if (this.inWater && this.floater) {
      // it rides the water: a small bob and a slow yaw wobble, pose only
      const t = this.time, tau = 2 * Math.PI;
      y = ground.waterLevelAt(px, pz) - this.restHeight * 0.85 + BOB_A * Math.sin(tau * BOB_HZ * t) + BOB_B * Math.sin(tau * BOB_B_HZ * t + 1);
      wobble = WOBBLE * Math.sin(tau * WOBBLE_HZ * t + this.wobblePhase);
    } else {
      const dz = this.pitchSpan, dx = this.rollSpan;
      pitch += dz > 0.05 ? -Math.atan2(this.groundUnder(FRONT, groundY) - this.groundUnder(HIND, groundY), dz) : 0;
      roll = dx > 0.05 ? Math.atan2(this.groundUnder(LEFT, groundY) - this.groundUnder(RIGHT, groundY), dx) * 0.6 : 0;
      let bob = 0;
      if (this.mech.legged) {
        // legged: the body mechanics' bob, gallop rock and (one torso bone) girdle roll, and the starts and stops
        const pace = this.mech.pace;
        bob = mech.bob + pace.height;
        pitch += mech.pitch + pace.pitch;
        roll += mech.roll + pace.roll;
      } else if (this.gait === 'hop') {
        let hs = -1;
        for (let i = 0; i < n; i++) if (!legs[i].front && phases[i].swing) { hs = phases[i].s; break; }
        bob = hs >= 0 ? Math.sin(Math.PI * hs) * 0.25 * legLen * this.stepping : 0;
      } else {
        const amp = 0.02 * legLen * (0.5 + this.recipe.motion.bounce) * this.stepping * (this.gait === 'gallop' ? 2.5 : 1);
        bob = -Math.cos(4 * Math.PI * this.phase) * amp;
      }
      const lie = n ? -this.sleepNow * this.restHeight * 0.55 : 0;
      y = groundY + bob + lie + dip;
    }
    root.position.set(this.position.x, y, this.position.z);
    root.rotation.set(pitch, this.yaw + wobble, roll, 'YXZ');
    // the root alone: the skeleton's matrices are worked out once it is posed (the renderer does the meshes)
    root.updateWorldMatrix(false, false);
    this.mech.poseTorso();

    // tails, necks, wings, breathing… before the legs, which read the body's pose
    this.secondary.update(dt);

    // legs
    if (dt > 0) this.stillFor = onFeet && this.stepping < 0.05 ? this.stillFor + dt : 0;
    if (!onFeet || this.altitude > 0.05) {
      this.tuckLegs(dt);
      return;
    }
    this.legTuck = this.footTuck = 0; // on its feet: a tuck starts from the standing leg (a take-off's push)
    const lift = (this.gait === 'gallop' || this.gait === 'hop' ? 0.22 : 0.14) * legLen;
    const D = stride * duty;
    if (this.stepping >= 0.05) this.endSteps(); // walking again: the gait takes the feet from where they are
    else if (dt > 0 && this.stillFor >= SQUARE_AFTER) this.replantFeet(dt, stride);
    // standing still, every foot is held where it stands, even one the stopped gait left part way through a swing
    const held = this.stepping < 0.05;
    root.getWorldQuaternion(rootQ);
    for (let i = 0; i < n; i++) {
      // each foot's target is the leg's own `world`, moved in place
      const leg = legs[i], { swing, s } = phases[i], world = leg.world;
      if (leg.step >= 0) {
        // a re-plant step: an arc from where the foot stood to where it goes
        const u = smooth(leg.step);
        world.x = leg.from.x + (leg.to.x - leg.from.x) * u;
        world.z = leg.from.z + (leg.to.z - leg.from.z) * u;
        leg.lift = Math.sin(Math.PI * leg.step) * REPLANT_LIFT * legLen;
        world.y = ground.heightAt(world.x, world.z) + leg.home.y + leg.lift;
      } else if (!swing || held) {
        // stance: the foot is locked where it landed, so it never slides (standing, it squares up with real steps);
        // a foot caught mid-swing as the body stopped puts down where it is
        if (leg.swinging || !leg.planted) {
          if (swing && leg.swinging) this.plantAt(leg, world.x, ground.heightAt(world.x, world.z) + leg.home.y, world.z);
          else leg.planted = this.onGround(leg, (D / 2 - s * D) * this.stepping, leg.plant);
        }
        leg.lift = 0;
        const p = leg.planted!;
        (world.x = p.x), (world.y = p.y), (world.z = p.z);
      } else {
        // swing: travel from where the foot lifted to where it will land, in an arc
        const from = leg.liftoff;
        if (!leg.swinging) {
          const p = leg.planted;
          if (p) (from.x = p.x), (from.y = p.y), (from.z = p.z);
          else this.onGround(leg, 0, from);
        }
        const land = this.onGround(leg, (D / 2) * this.stepping, scratchLand), u = smooth(s);
        world.x = from.x + (land.x - from.x) * u;
        world.z = from.z + (land.z - from.z) * u;
        leg.lift = Math.sin(Math.PI * s) * lift * this.stepping;
        world.y = ground.heightAt(world.x, world.z) + leg.home.y + leg.lift;
        leg.planted = null;
      }
      // a held foot, or one mid re-plant step, is not swinging: the gait lifts it from where it stands
      leg.swinging = swing && !held && leg.step < 0;
      this.solveLeg(leg, root.worldToLocal(scratchP.set(world.x, world.y, world.z)));
    }
  }

  /** Each leg's swing/stance (and how far through it, 0..1) at this point in the cycle: one object per leg, reused. */
  private legPhase(offsets: number[], duty: number) {
    for (let i = 0; i < offsets.length; i++) {
      const p = (this.phase + offsets[i]) % 1, out = this.phases[i];
      if (p < duty) (out.swing = false), (out.s = p / duty);
      else (out.swing = true), (out.s = (p - duty) / (1 - duty));
    }
    return this.phases;
  }

  /** The mean ground height under the homes of these legs (front, hind, left or right); `fallback` with none. */
  private groundUnder(which: number, fallback: number): number {
    let sum = 0, k = 0;
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i], side = l.limb.side;
      if (which === FRONT ? l.front : which === HIND ? !l.front : which === LEFT ? side > 0 : side < 0) (sum += this.homeGround[i]), k++;
    }
    return k ? sum / k : fallback;
  }

  /** Where a foot would be at this offset (m, forward) from its home, on the ground (world), into `out`. */
  private onGround(leg: Leg, off: number, out: Vec3): Vec3 {
    const h = leg.home, w = this.obj.root.localToWorld(scratchW.set(h.x, h.y, h.z + off));
    out.x = w.x;
    out.y = this.ground.heightAt(w.x, w.z) + h.y;
    out.z = w.z;
    return out;
  }

  /** Lock a foot down here (world), in the leg's own storage. */
  private plantAt(leg: Leg, x: number, y: number, z: number) {
    const p = leg.plant;
    (p.x = x), (p.y = y), (p.z = z);
    leg.planted = p;
  }

  /**
   * Standing still, the feet tidy themselves with real steps, one foot at a time: a foot left more than a quarter stride
   * from home (stopped mid-stride, nudged) steps back under the body, the farthest first; and now and then, at seeded
   * times, an idle foot shuffles a little while the weight eases off it.
   */
  private replantFeet(dt: number, stride: number) {
    for (const leg of this.legs) {
      if (leg.step < 0) continue;
      if ((leg.step += dt / REPLANT_TIME) >= 1) {
        leg.step = -1;
        this.plantAt(leg, leg.to.x, leg.to.y, leg.to.z);
      }
      return;
    }
    if (this.sleepNow > 0.5) return; // lying down
    let far: Leg | null = null, most = 0.25 * stride;
    for (const leg of this.legs) {
      if (!leg.planted) continue;
      const home = this.homeOf(leg, scratchHome), d = Math.hypot(leg.planted.x - home.x, leg.planted.z - home.z);
      if (d > most) (far = leg), (most = d);
    }
    if (far) return this.stepTo(far, 0, 0);
    if (!this.mech.legged || this.sleepNow > 0.1 || (this.idleIn -= dt) > 0) return;
    const rng = this.idleRng, n = this.legs.length;
    this.idleIn = 8 + 12 * rng();
    const first = Math.floor(rng() * n), a = 2 * Math.PI * rng(), r = 0.08 * stride * rng();
    for (let k = 0; k < n; k++) {
      const leg = this.legs[(first + k) % n];
      if (!leg.planted) continue;
      this.stepTo(leg, r * Math.cos(a), r * Math.sin(a));
      this.mech.shiftOff(leg.limb.side);
      return;
    }
  }

  /** Lift a planted foot to step to its home (and this far beyond it, world x and z). */
  private stepTo(leg: Leg, dx: number, dz: number) {
    const to = this.homeOf(leg, leg.to);
    to.x += dx;
    to.z += dz;
    to.y = this.ground.heightAt(to.x, to.z) + leg.home.y;
    leg.from.x = leg.planted!.x;
    leg.from.y = leg.planted!.y;
    leg.from.z = leg.planted!.z;
    leg.planted = null;
    leg.step = 0;
  }

  /** A foot's home on the ground under the body (world), into `out`. */
  private homeOf(leg: Leg, out: Vec3): Vec3 {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), h = leg.home;
    out.x = this.position.x + c * h.x + s * h.z;
    out.z = this.position.z - s * h.x + c * h.z;
    out.y = this.ground.heightAt(out.x, out.z) + h.y;
    return out;
  }

  /** Stop any re-plant step, the foot down where it is. */
  private endSteps() {
    for (const leg of this.legs) {
      if (leg.step < 0) continue;
      leg.step = -1;
      this.plantAt(leg, leg.world.x, this.ground.heightAt(leg.world.x, leg.world.z) + leg.home.y, leg.world.z);
    }
  }

  /** Forward acceleration from the change in speed, timed from the last change (a driven rig's substeps share one change). */
  private measureAccel(dt: number) {
    this.accelClock += dt;
    if (this.speed !== this.accelFrom) {
      this.accel = (this.speed - this.accelFrom) / this.accelClock;
      this.accelFrom = this.speed;
      this.accelGap = this.accelClock;
      this.accelClock = 0;
    } else if (this.accelClock > 1.5 * this.accelGap) this.accel = 0;
  }

  /** The speed `steer` wants now, as it would reach given time: steered on a copy, one step long enough to get there. */
  private wantedSpeed(lying: boolean) {
    Object.assign(this.probe, this.motion);
    steer(this.probe, this.traits, 10, lying);
    return this.probe.speed;
  }

  /**
   * Steers itself toward `target`: the simulation's own step, on a motion view of the rig's fields. Setting off from
   * still, it first gathers itself (the anticipation) with its speed held at 0.
   */
  private locomotion(dt: number) {
    const m = this.motion, wasFlying = this.flying;
    m.x = this.position.x;
    m.z = this.position.z;
    m.yaw = this.yaw;
    m.speed = this.speed;
    m.turnRate = this.turnRate;
    m.altitude = this.altitude;
    m.flying = this.flying;
    m.cruise = this.cruise;
    m.target = this.target;
    m.speedFrac = this.speedFrac;
    m.wantFly = this.wantFly;
    m.climb = this.climb;
    const lying = this.sleepNow > 0.1, mech = this.mech;
    // taking off from the ground (not from water), first a crouch, with flight and speed held
    if (dt > 0 && this.crouchFor < 0 && this.canFly && this.wantFly && !this.flying && !lying && !(this.inWater && (this.swimmer || this.floater))) this.crouchFor = 0;
    if (this.crouchFor >= 0) {
      if (this.wantFly && (this.crouchFor += dt) < CROUCH_TIME) {
        m.wantFly = false;
        m.speedFrac = 0;
      } else this.crouchFor = -1;
    }
    if (dt > 0 && this.target && !mech.anticipating && this.speed < 0.05 && !this.wantFly && mech.grounded && this.wantedSpeed(lying) > 0.15 * this.topSpeed) mech.anticipate();
    if (mech.anticipating) m.speedFrac = 0;
    // a paused frame steers nothing: steer() works out the turn rate afresh from the heading even at dt = 0
    if (dt > 0) steer(m, this.traits, dt, lying);
    this.position.x = m.x;
    this.position.z = m.z;
    this.yaw = m.yaw;
    this.speed = m.speed;
    this.turnRate = m.turnRate;
    this.altitude = m.altitude;
    this.flying = m.flying;
    this.climb = m.climb;
    if (wasFlying && !this.flying) this.landed();
    const t = this.target, dx = t ? t.x - m.x : 0, dz = t ? t.z - m.z : 0;
    this.headingError = t && !lying && dx * dx + dz * dz > 0.05 * 0.05 ? wrapAngle(Math.atan2(dx, dz) - m.yaw) : 0;
  }

  /**
   * Follow the simulation: stand where it says, facing and moving as it says (smoothed between its ticks by the caller).
   * From now on `update` leaves the steering alone and does the gait, legs, feet and secondary motion. `snap`: it has moved
   * unseen since its last update (back in view), so its height now is no climb (a flier is not pitched by the jump).
   */
  drive(p: DrivenPose, snap = false) {
    const fresh = !this.driven || snap;
    if (fresh) {
      this.drivenAltitude = p.altitude;
      this.climb = 0;
      // the simulation times take-offs and landings: none seen from here, no crouch or jump of its own
      this.flewLast = p.flying;
      this.crouchFor = -1;
      this.jumpLeft = 0;
    }
    if (this.flying && !p.flying) this.landed();
    this.position.x = p.x;
    this.position.z = p.z;
    this.yaw = p.yaw;
    this.speed = p.speed;
    this.turnRate = p.turnRate;
    this.altitude = p.altitude;
    this.flying = p.flying;
    this.driven = true;
    if (fresh) {
      // measure starts, stops and acceleration afresh from here, and drop any step begun where it was last seen
      this.accelFrom = p.speed;
      this.accel = this.accelClock = 0;
      this.mech.resync();
      this.secondary.resync();
      this.restep = true;
      for (const l of this.legs) l.step = -1;
    }
  }

  /**
   * Take-off and touchdown, as the flying flag changes (between updates with time: a pause sees neither). Taking off it
   * beats hard for its first strokes, starting with a downstroke, and a self-steering rig jumps off its crouch (a driven
   * one is where the simulation says); touching down, the settle kicks with the landing speed.
   */
  private flightEvents(dt: number) {
    if (this.flying && !this.flewLast) {
      this.strokes = STRONG_STROKES;
      this.secondary.downstroke();
      if (!this.driven) this.jumpLeft = JUMP * this.legLength;
    } else if (!this.flying && this.flewLast) this.mech.settle.kick(this.speed, this.legLength);
    this.flewLast = this.flying;
    this.strokes = Math.max(0, this.strokes - dt);
    if (this.jumpLeft > 0 && !this.driven) {
      const up = Math.min(this.jumpLeft, (JUMP * this.legLength * dt) / JUMP_TIME);
      this.altitude += up;
      this.jumpLeft -= up;
    }
  }

  /**
   * Where it is in its flight. It flares to land once below a body length while landing: a self-steering rig when it no
   * longer wants to fly; a driven one (which may not say) while it sinks, until it lands or climbs away again.
   */
  private flightPhase() {
    const landing = this.driven ? this.climb < (this.flaring ? FLARE_ABORT : -FLARE_SINK) : !this.wantFly;
    this.flaring = this.flying && landing && this.altitude < this.bodyLength * (this.flaring ? 1.2 : 1);
    this.phaseOfFlight = this.crouchFor >= 0 ? 'crouch' : !this.flying ? 'ground' : this.flaring ? 'flare' : 'air';
  }

  /**
   * How far (radians) the body can pitch nose up at this altitude before its rear (the tail of a hawk) touches the ground,
   * pitching about its ground origin: for each rear point, a + y·cos u + z·sin u ≥ 0. The points are the rest pose's: a
   * tail lifted or swung in flight is not followed.
   */
  private rearRoom() {
    let room = Math.PI / 2;
    for (let i = 0; i < this.rearY.length; i++) {
      const y = this.rearY[i], z = this.rearZ[i], r = Math.hypot(y, z);
      room = Math.min(room, Math.atan2(z, y) + Math.acos(Math.max(-1, Math.min(1, -this.altitude / r))));
    }
    return Math.max(0, room);
  }

  /** The take-off's dip (m, − = down): into the crouch, then let go as it jumps. Pose only. */
  private takeoffDip() {
    const depth = CROUCH_DIP * this.legLength;
    if (this.crouchFor >= 0) return -depth * Math.sin((Math.PI / 2) * Math.min(1, this.crouchFor / CROUCH_DOWN));
    return this.jumpLeft > 0 ? (-depth * this.jumpLeft) / (JUMP * this.legLength) : 0;
  }

  /** Just touched down: the feet find new ground. */
  private landed() {
    for (const l of this.legs) (l.planted = null), (l.step = -1);
  }

  /**
   * In the air or in water the legs fold back out of the way (and paddle a little when floating); flaring to land they
   * reach forward-down for the ground. The fold eases from the standing leg, so a take-off pushes off, then tucks.
   */
  private tuckLegs(dt: number) {
    const bones = this.obj.bones;
    const paddle = this.inWater && this.floater ? Math.sin(this.time * 6) * 0.4 : 0;
    // the reach is forward-down in the world: the body's own nose-up flare is taken out of it
    this.legTuck = approach(this.legTuck, this.flying ? (this.flaring ? TUCK_REACH - this.flightPitch : TUCK_FLY) : TUCK_SWIM, 5, dt);
    // the talons' reach is near level in the world: the body's pitch and the leg's reach are taken out of it
    this.footTuck = approach(this.footTuck, !this.flying ? 0 : this.flaring ? TALON_REACH - this.flightPitch - this.legTuck : TALON_FLY, 5, dt);
    for (const leg of this.legs) {
      leg.planted = null;
      leg.step = -1;
      const chain = leg.limb.chain;
      for (let j = 0; j < chain.length; j++) {
        const k = chain[j];
        if (j === 0) bones[k].quaternion.setFromAxisAngle(X, this.legTuck + paddle * (leg.left ? 1 : -1));
        else if (k === leg.foot) bones[k].quaternion.setFromAxisAngle(X, this.footTuck); // the talons trail, or reach
        else bones[k].quaternion.identity();
      }
      bones[chain[0]].updateMatrixWorld(true); // the rest of the skeleton is worked out (poseSkeleton)
    }
  }

  /** Work out the skeleton's world matrices, but for the legs below their first bone (see `skeletonPass`): the root's must be current. */
  poseSkeleton() {
    const pass = this.skeletonPass;
    for (let i = 0; i < pass.length; i++) pass[i].updateWorldMatrix(false, false);
  }

  /** Bend a leg to reach its foot's target (creature space): FABRIK on the leg's own joints, from where the hip is now. */
  private solveLeg(leg: Leg, targetLocal: Vector3) {
    const bones = this.obj.bones, t = scratchTarget;
    (t.x = targetLocal.x), (t.y = targetLocal.y), (t.z = targetLocal.z);
    // the hip's world matrix is current: the secondary motion has just worked out the skeleton's, and the legs before
    // this one only moved their own bones
    const start = this.obj.root.worldToLocal(tmpV.setFromMatrixPosition(bones[leg.ik[0]].matrixWorld));
    const r0 = leg.rest[0], sx = start.x - r0.x, sy = start.y - r0.y, sz = start.z - r0.z, p = leg.joints;
    for (let i = 0; i < p.length; i++) {
      const r = leg.rest[i];
      (p[i].x = r.x + sx), (p[i].y = r.y + sy), (p[i].z = r.z + sz);
    }
    const mid = p[Math.floor(p.length / 2)], pole = scratchPole;
    (pole.x = mid.x + leg.bend.x * leg.reach), (pole.y = mid.y + leg.bend.y * leg.reach), (pole.z = mid.z + leg.bend.z * leg.reach);
    fabrikInto(p, leg.lengths, t, p.length > 2 ? pole : null);
    this.poseChain(leg.ik, p, rootQ);
    // feet stay flat on the ground, facing the way the body faces
    if (leg.foot !== null) this.setWorldRotation(bones[leg.foot], yawQ);
  }

  /**
   * Point each bone of a chain along solved joint positions (creature space); `rootWorld`, the root's world rotation, if
   * the caller has it. Precondition: the first bone's parent's world matrix (and the root's) must be current. It is read,
   * not worked out again, so the hot path never walks up the skeleton. Inside `update` (the legs, the graze) it always is;
   * a caller outside `update` first calls `bones[chain[0]].parent.updateWorldMatrix(true, false)`.
   */
  poseChain(chain: number[], joints: Vec3[], rootWorld = this.obj.root.getWorldQuaternion(rootQ)) {
    const bones = this.obj.bones;
    for (let j = 0; j < chain.length; j++) {
      const k = chain[j], a = joints[j], b = joints[j + 1];
      // norm(b − a), as the vector helpers do it
      let x = b.x - a.x, y = b.y - a.y, z = b.z - a.z;
      const l = Math.sqrt(x * x + y * y + z * z);
      if (l < 1e-9) (x = 0), (y = 0), (z = 1);
      else {
        const s = 1 / l;
        (x *= s), (y *= s), (z *= s);
      }
      qd.setFromUnitVectors(this.restDirs[k], scratchDir.set(x, y, z));
      // a bone whose one child is the next in the chain works out its own matrix only (that child is next); the last, or
      // one with other children, its whole subtree
      const bone = bones[k], next = j + 1 < chain.length ? bones[chain[j + 1]] : null;
      this.setWorldRotation(bone, qw.copy(rootWorld).multiply(qd), !(next && bone.children.length === 1 && bone.children[0] === next));
    }
  }

  /**
   * Give a bone this world rotation by setting its local rotation relative to its parent, and work out its (and, with
   * `subtree`, its children's) world matrices. Precondition: the parent's world matrix must be current. It is read, not
   * worked out again (no walk up the skeleton per bone). Inside `update` it always is; a caller outside `update` first calls
   * `bone.parent.updateWorldMatrix(true, false)`.
   */
  setWorldRotation(bone: Bone, world: Quaternion, subtree = true) {
    bone.parent!.matrixWorld.decompose(scratchP, tmpQ, scratchS);
    bone.quaternion.copy(tmpQ.invert().multiply(world));
    if (subtree) bone.updateMatrixWorld(true);
    else bone.updateWorldMatrix(false, false);
  }
}
