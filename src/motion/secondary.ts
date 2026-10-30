import { Euler, Quaternion, Vector3, type Bone } from 'three/webgpu';
import type { BoneDef } from '../builder/skeleton';
import { mulberry32 } from '../util/rng';
import { len, norm, sub, v3, type Vec3 } from '../util/vec';
import { birdHeadBob, foldDirection, headNod, isBirdWalker, stabiliseShare } from './body';
import { beatHz, springInto, swimEnvelope, swimWave, type Spring } from './chains';
import { STRIDE } from './gait';
import { fabrikInto } from './ik';
import { findChains, type ChainKind, type Limb } from './limbs';
import { toV, type CreatureRig } from './rig';

const Z = new Vector3(0, 0, 1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);
const scratchE = new Euler(0, 0, 0, 'YXZ');
/** Set a bone's rotation from a pitch, yaw and roll (radians, 'YXZ'), through the shared scratch Euler. */
const setEuler = (q: Quaternion, pitch: number, yaw: number, roll = 0) => q.setFromEuler(scratchE.set(pitch, yaw, roll, 'YXZ'));
const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchRootQ = new Quaternion();
const scratchDown = new Quaternion();
const scratchTarget = v3();
const scratchPole = v3();
const scratchP = new Vector3();
const scratchV = new Vector3();
const scratchQ = new Quaternion();
const scratchFlap = new Quaternion();
const scratchDir = v3();
const scratchFold = v3();
/**
 * Follow-through: the tail's spring (stiffness, damping), how far it would lean (radians) per m/s² of steady acceleration
 * (the ears get half), and so the kick to its velocity per m/s of change in the body's velocity; and a speed (m/s) no
 * animal reaches, above which a move between updates is a jump, not motion.
 */
const FOLLOW_K = 40;
const FOLLOW_C = 7;
const FOLLOW_GAIN = 0.045;
const FOLLOW_KICK = FOLLOW_GAIN * FOLLOW_K;
const JUMP_SPEED = 30;
/**
 * How long (s, a time constant) a held sideways push takes to stop swinging the tail: a steady turn's pull to the inside
 * fades out of the follow-through, which keeps only its changes (a turn's start and end, a lurch, a footfall), so a chase's
 * held turn leaves the tail on the inside of the turn.
 */
const FOLLOW_HOLD = 0.5;
/** The wingbeat's swing and middle angle (radians, + = up) in plain flapping flight. */
const FLAP_AMP = 0.85;
const FLAP_MEAN = 0.2;
/**
 * A driven head's lead into a turn (radians per rad/s of turn rate): a deer turning at its full rate (1.6 rad/s) leads by
 * about 0.56 rad, near the 0.6 a self-steering one shows with a big turn still to make.
 */
const LEAD_RATE = 0.35;
/**
 * Swimming: the wave's swing (radians, × (0.5 + sway)), the C-bend into a turn (radians per rad/s, and its cap), and the
 * head's counter-yaw (× the first segment's angle). Side fins scull (FIN_SCULL radians at FIN_HZ) when slow and fold back
 * (FIN_FOLD radians, still sculling FIN_TREMBLE) when fast: + pitch sweeps a fin that points down and back further back.
 */
const SWIM_AMP = 0.3;
const SWIM_BEND = 0.25;
const SWIM_BEND_MAX = 0.5;
const HEAD_COUNTER = -0.3;
const FIN_SCULL = 0.4;
const FIN_HZ = 1.2;
const FIN_FOLD = 0.6;
const FIN_TREMBLE = 0.05;

/**
 * A body that bends in a wave, as one chain head → tail: its bones, whether each lies ahead of the root (the spine) or
 * behind it (the tail), each one's parent's place in the chain (−1: none in it), the head bone left out of it (−1: none),
 * and each segment's angle now (creature space, + = towards the left) and its own bend from its parent (scratch, filled
 * every update). A slither also waves the root bone (`root`: its place in the chain, −1 for a swimmer, whose root stays
 * put), sliding it sideways from its rest position (`home`) so the head keeps its line; for that it needs each segment's
 * rest run sideways and forward (`dx`, `dz`, m).
 */
type Wave = {
  bones: number[]; ahead: boolean[]; parent: number[]; head: number; angle: Float64Array; bend: Float64Array;
  root: number; home: Vector3; dx: Float64Array; dz: Float64Array;
};

function waveChain(rest: BoneDef[], front: number[], tail: number[], head: number): Wave {
  const bones = [...front, ...tail], seg = (f: (b: BoneDef) => number) => Float64Array.from(bones, (k) => f(rest[k]));
  return {
    bones, ahead: bones.map((_, i) => i < front.length), parent: bones.map((k) => bones.indexOf(rest[k].parent)), head,
    angle: new Float64Array(bones.length), bend: new Float64Array(bones.length),
    root: bones.indexOf(0), home: new Vector3(rest[0].start.x, rest[0].start.y, rest[0].start.z),
    dx: seg((b) => b.end.x - b.start.x), dz: seg((b) => b.end.z - b.start.z),
  };
}

/**
 * What the neck needs to steady the head, per neck chain: where the head bone is in the chain (−1: none), the bone the
 * chain hangs from, the neck base's levers to the middle of the head (how far forward and how far up it sits, m), the
 * neck's own length (neck bones only), and, for a head straight on the body (no neck bone), its rest position to slide
 * a bird's head from.
 */
type NeckInfo = {
  head: number; parent: number; reach: number; rise: number; neckLength: number; rest: Vector3 | null;
  /** For lowering the head to graze: the chain's rest joints, its bone lengths and their sum, and its joints and bones' world rotations (scratch, reused). */
  joints0: Vec3[]; lengths: number[]; total: number; joints: Vec3[]; looked: Quaternion[];
};

/** What a face command does: `blink` and `yawn` happen once; `chew`, `alert` and `back` hold for a few seconds. */
export type FaceCmd = 'blink' | 'yawn' | 'chew' | 'alert' | 'back';
/** The face's own clock: time, the blink countdown, seconds left of a yawn, whether it was asleep a moment ago, and its randomness. */
export type FaceState = { t: number; blinkAt: number; yawn: number; wasAsleep: boolean; rng: () => number };
type FaceRig = { callNow: number; sleepNow: number; headDownNow: number; mouth: 'shut' | 'chew' | 'lap'; ears: 'rest' | 'alert' | 'back' };
export type FacePose = { jaw: number; lids: number; earPitch: number; earRoll: number };

/** The widest the jaw opens (radians): the cheeks and mouth are tuned for openings up to this. */
export const JAW_MAX = 0.3;
const YAWN_SECONDS = 2.5;

/**
 * The face's pose for this moment: how far the jaw is open (radians; calls, chewing, lapping and yawns, the largest wins),
 * how shut the lids are (0..1: blinks, a floor while chewing, and sleep), and the ears' pitch and roll (alert, back, sleep droop).
 * Advances the state by dt; a yawn starts once as sleep passes 0.5 and not again until the animal has woken.
 */
export function facePose(s: FaceState, dt: number, rig: FaceRig, out: FacePose = { jaw: 0, lids: 0, earPitch: 0, earRoll: 0 }): FacePose {
  s.t += dt;
  s.yawn = Math.max(0, s.yawn - dt);
  if (rig.sleepNow > 0.5 && !s.wasAsleep) {
    s.wasAsleep = true;
    s.yawn = YAWN_SECONDS;
  } else if (rig.sleepNow < 0.3) s.wasAsleep = false;
  const down = rig.headDownNow > 0.8;
  const tau = 2 * Math.PI * s.t;
  let jaw = 0.28 * rig.callNow;
  if (down && rig.mouth === 'chew') jaw = Math.max(jaw, 0.05 + 0.04 * Math.sin(tau * 2.5));
  if (down && rig.mouth === 'lap') jaw = Math.max(jaw, 0.03 + 0.03 * Math.sin(tau * 5));
  if (s.yawn > 0) jaw = Math.max(jaw, JAW_MAX * Math.sin(Math.PI * (1 - s.yawn / YAWN_SECONDS)));
  out.jaw = clamp(jaw, 0, JAW_MAX);

  s.blinkAt -= dt;
  let shut = 0;
  if (s.blinkAt < 0) {
    shut = Math.sin(Math.PI * clamp(-s.blinkAt / 0.15, 0, 1));
    if (s.blinkAt < -0.15) s.blinkAt = 2 + s.rng() * 4;
  }
  const chewing = rig.mouth === 'chew' ? 0.45 * clamp((rig.headDownNow - 0.8) / 0.1, 0, 1) : 0; // eases in as the head goes down
  out.lids = Math.max(shut, chewing, rig.sleepNow);

  // a positive pitch (about +x) tips an upright ear forward: alert pricks them forward, back lays them back, sleep droops them back
  out.earPitch = (rig.ears === 'alert' ? 0.3 : rig.ears === 'back' ? -0.8 : 0) - 0.4 * rig.sleepNow;
  out.earRoll = rig.ears === 'back' ? 0.3 : 0;
  return out;
}

/**
 * Everything that isn't legs: the head looking about and grazing, tails swaying, ears twitching,
 * legless long bodies slithering and swimming, wings folding and flapping, fins paddling, breathing, blinking.
 */
export class SecondaryMotion {
  readonly flapHz: number;
  private chains: { kind: ChainKind; chain: number[] }[];
  private wings: Limb[];
  private fins: Limb[];
  /** Each fin's attachment segment in the swimming wave (−1: not on it). */
  private finAt: number[];
  /** The swimming body (the spine ahead of the root, then the tail), its tail chain, and the slither (the whole spine, root and all). */
  private swim: Wave;
  private swimTail: number[] | null;
  private slither: Wave;
  /** How far along the swimming wave is (wavelengths, 0..1). */
  private swimTravel = 0;
  private mouths: number[];
  private lookYaw: Spring = { pos: 0, vel: 0 };
  private lookPitch: Spring = { pos: 0, vel: 0 };
  private tailTurn: Spring = { pos: 0, vel: 0 };
  private necks = new Map<number[], NeckInfo>();
  /** Head nod strength (radians; 0 but for four-legged bodies with a neck), and a walking bird's head bob as a share of its stride (0 for others). */
  private nodAmp = 0;
  private bobShare = 0;
  /** Follow-through: tail pitch from the body's vertical acceleration (− = tip down), and yaw from its sideways one (+ = tip to the right). */
  private droop: Spring = { pos: 0, vel: 0 };
  private swing: Spring = { pos: 0, vel: 0 };
  /**
   * The body's last position and velocity (world), how many updates it has seen (it needs two for an acceleration), and
   * its held sideways acceleration (m/s², + = to the left: the push the sideways follow-through lets go of; see FOLLOW_HOLD).
   */
  private follow = { at: new Vector3(), vel: new Vector3(), seen: 0, side: 0 };
  private ears: { chain: number[]; spring: Spring; target: number; next: number; hold: number; side: number }[];
  private earPitch = 0;
  private earRoll = 0;
  /** How open the wings are (0 folded … 1 spread): half open crouched to take off; flight levels the body with it. */
  wingOpen = 0;
  /** The wingbeat: where it is in its cycle (0..1), and its swing and middle angle (radians, eased: a glide is a swing of 0). */
  flapPhase = 0;
  flapAmp = FLAP_AMP;
  private flapMean = FLAP_MEAN;
  /** The tail's lift in flight (radians, + = tip up), eased. */
  private tailLift = 0;
  /** Each wing's first bone's rest direction (creature space, unit). */
  private wingRest: Vector3[];
  private rng: () => number;
  private face: FaceState;
  private pose: FacePose = { jaw: 0, lids: 0, earPitch: 0, earRoll: 0 };
  private jawNow = 0;
  /** A face command held for a while (chew, alert, back): what it sets on the rig, and for how much longer. */
  private held: { cmd: FaceCmd; left: number } | null = null;

  constructor(private rig: CreatureRig, limbs: Limb[]) {
    const sk = rig.body.skeleton;
    this.chains = findChains(sk, rig.mech.legged);
    this.wings = limbs.filter((l) => l.kind === 'wing');
    this.wingRest = this.wings.map((w) => toV(norm(sub(sk.bones[w.chain[0]].end, sk.bones[w.chain[0]].start))));
    this.fins = limbs.filter((l) => l.kind === 'fin');
    // the spine runs from the root forward: its bones after the root, head first, without the head (which counter-yaws)
    const spine = this.chains.find((c) => c.kind === 'spine')?.chain ?? [];
    const front = spine.slice(1).filter((k) => sk.bones[k].role !== 'head').reverse();
    const head = spine.find((k) => sk.bones[k].role === 'head') ?? -1;
    this.swimTail = this.chains.find((c) => c.kind === 'tail')?.chain ?? null;
    this.swim = waveChain(sk.bones, front, this.swimTail ?? [], head);
    this.slither = waveChain(sk.bones, spine.length ? [...front, spine[0]] : [], [], head);
    this.finAt = this.fins.map((f) => this.swim.bones.indexOf(sk.bones[f.chain[0]].parent));
    // with a jaw the mouth opens by the jaw (it rests shut; actions open it), and the muzzle holds still; without one,
    // the mouth bones pitch to call
    this.mouths = sk.jaw >= 0 ? [] : sk.bones.flatMap((b, i) => (b.role === 'mouth' ? [i] : []));
    this.rng = mulberry32(rig.recipe.seed + 99);
    this.ears = this.chains.filter((c) => c.kind === 'ear').map((c) => ({ chain: c.chain, spring: { pos: 0, vel: 0 }, target: 0, next: 1 + this.rng() * 4, hold: 0, side: sk.bones[c.chain[0]].start.x >= 0 ? 1 : -1 }));
    this.face = { t: 0, blinkAt: 2, yawn: 0, wasAsleep: false, rng: this.rng };
    const legs = rig.legs.length, bird = isBirdWalker(legs, rig.recipe);
    for (const c of this.chains) if (c.kind === 'neck') this.necks.set(c.chain, neckInfo(sk.bones, c.chain));
    const neck = this.necks.values().next().value;
    if (neck && legs === 4 && !bird) this.nodAmp = 0.06 * (neck.neckLength / rig.bodyLength) * 3;
    // a bird's head bob: a quarter of each step's half-stride either way; a duck's is damped
    if (bird) this.bobShare = (0.25 / 2) * (rig.recipe.mind.habitat.includes('water') ? 0.4 : 1);
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
    this.holdCommand(dt);
    this.faceMotion(dt);
    this.followThrough(dt);
    const swim = r.swimmer && r.inWater;
    if (swim) {
      // a fish: the tail beats faster the faster it swims for its length; a turn bends the body into a C
      this.swimTravel = (this.swimTravel + beatHz(r.speed, r.bodyLength) * dt) % 1;
      // a swimmer's root carries the body: back to rest, should it have slithered out of the water
      const sl = this.slither;
      if (sl.root >= 0) this.bones[0].quaternion.identity(), this.bones[0].position.copy(sl.home);
      this.undulate(this.swim, this.swimTravel, SWIM_AMP * (0.5 + sway), clamp(SWIM_BEND * r.turnRate, -SWIM_BEND_MAX, SWIM_BEND_MAX), HEAD_COUNTER);
    } else if (this.slither.bones.length) {
      // the slither of a legless body on land (a legged torso is posed by its body mechanics, BodyMotion)
      const moving = Math.min(1, r.speed / 0.2);
      const travel = r.distance / Math.max(0.1, r.bodyLength * 0.6) + t * 0.05;
      this.undulate(this.slither, travel, (0.12 + 0.3 * sway) * (0.3 + 0.7 * moving), 0, 0);
    }
    const bones = this.bones;
    for (let ci = 0; ci < this.chains.length; ci++) {
      const c = this.chains[ci], chain = c.chain, n = chain.length;
      if (c.kind === 'neck') this.neck(chain, dt);
      else if (c.kind === 'tail' && !(swim && chain === this.swimTail)) {
        // (the swimming tail is the wave's: these springs pause while it swims)
        // in flight the tail steers: it yaws against the turn and dips to climb
        const turn = r.flying ? clamp(-0.3 * r.turnRate, -0.3, 0.3) : -r.turnRate * 0.25;
        springInto(this.tailTurn, turn, 30, 8, dt);
        this.tailLift = approach(this.tailLift, r.flying ? clamp((-0.4 * r.climb) / Math.max(1, r.speed), -0.3, 0.3) : 0, 6, dt);
        for (let i = 0; i < n; i++) {
          const yaw = sway * 0.18 * Math.sin(2 * Math.PI * 0.5 * t - i * 0.7) + this.tailTurn.pos / n + r.sleepNow * 0.35;
          // the follow-through spreads along the tail, so its tip lags the most
          setEuler(bones[chain[i]].quaternion, r.sleepNow * 0.12 + (this.droop.pos + this.tailLift) / n, yaw + this.swing.pos / n);
        }
      } else if (c.kind === 'antenna') {
        for (let i = 0; i < n; i++) setEuler(bones[chain[i]].quaternion, 0.15 * Math.sin(t * 2.3 + i), 0.15 * Math.sin(t * 1.7 + i));
      }
    }
    this.earTwitch(dt);
    this.flapWings();
    this.paddleFins(t, swim);
    for (let i = 0; i < this.mouths.length; i++) setEuler(bones[this.mouths[i]].quaternion, 0.35 * r.callNow, 0);
    // the skeleton's world matrices, for the legs (the rig has placed the root; the renderer does the meshes)
    r.poseSkeleton();
  }

  /**
   * Bend a body in a wave: each segment's angle is the travelling wave plus a C-bend into the turn (`bend`, spread with
   * the same envelope; the spine ahead of the root bends the other way to the tail, so the body curves round the turn),
   * and each bone turns by its angle less its parent's. The tail takes the follow-through on top, as on land. The head
   * counter-yaws by `counter` × the first segment's angle (when that segment is ahead of the root). A slither waves its
   * root bone too and slides it sideways by what the turned segments would carry the head off its line, so the head keeps
   * to its line and the swing grows towards the tail. Pure in its inputs: nothing moves at dt = 0.
   */
  private undulate(w: Wave, travel: number, amp: number, bend: number, counter: number) {
    const n = w.bones.length;
    let nt = 0;
    for (let i = 0; i < n; i++) {
      w.angle[i] = swimWave(i, n, travel, amp) + (w.ahead[i] ? bend : -bend) * swimEnvelope(i, n);
      if (!w.ahead[i]) nt++;
    }
    for (let i = 0; i < n; i++) {
      const p = w.parent[i], b = (w.bend[i] = w.angle[i] - (p >= 0 ? w.angle[p] : 0));
      const tail = w.ahead[i] ? 0 : 1 / nt;
      this.bones[w.bones[i]].quaternion.setFromEuler(scratchE.set(this.droop.pos * tail, b + this.swing.pos * tail, 0, 'YXZ'));
    }
    if (w.head >= 0) this.bones[w.head].quaternion.setFromEuler(scratchE.set(0, n && w.ahead[0] ? counter * w.angle[0] : 0, 0, 'YXZ'));
    if (w.root < 0) return;
    // a segment (dx, dz) turned by a yaw a moves sideways by dx·(cos a − 1) + dz·sin a
    let shift = 0;
    for (let i = 0; i < n; i++) shift -= w.dx[i] * (Math.cos(w.angle[i]) - 1) + w.dz[i] * Math.sin(w.angle[i]);
    this.bones[0].position.set(w.home.x + shift, w.home.y, w.home.z);
  }

  /** Torso swells a little with each breath (its children are scaled back so only the chest moves). */
  private breathe(t: number) {
    const r = this.rig;
    const torso = this.bones[0];
    const hz = (0.25 + 0.5 * r.recipe.mind.jumpiness) * (1 - 0.6 * r.sleepNow);
    const s = 1 + 0.015 * Math.sin(2 * Math.PI * hz * t);
    torso.scale.set(s, s, 1);
    const kids = torso.children;
    for (let i = 0; i < kids.length; i++) if ((kids[i] as Bone).isBone) kids[i].scale.set(1 / s, 1 / s, 1);
  }

  /** Make the face do something now: blink, yawn, or (for a few seconds) chew, prick the ears up or lay them back. */
  trigger(cmd: FaceCmd) {
    if (cmd === 'blink') this.face.blinkAt = 0;
    else if (cmd === 'yawn') this.face.yawn = YAWN_SECONDS;
    else {
      if (this.held) this.holdCommand(Infinity); // let go of the last one first
      this.held = { cmd, left: cmd === 'chew' ? 4 : 3 };
    }
  }

  /** While a held command lasts it keeps the rig's mouth, ears and head where it wants them; at the end it lets go. */
  private holdCommand(dt: number) {
    const h = this.held, r = this.rig;
    if (!h) return;
    h.left -= dt;
    const on = h.left > 0;
    if (h.cmd === 'chew') {
      r.mouth = on ? 'chew' : 'shut';
      r.headDown = on ? 1 : 0;
    } else r.ears = on ? (h.cmd === 'alert' ? 'alert' : 'back') : 'rest';
    if (!on) this.held = null;
  }

  /** Blink, open the jaw and move the lids: all from the face's pose this frame. */
  private faceMotion(dt: number) {
    const r = this.rig, p = facePose(this.face, dt, r, this.pose);
    for (const e of r.obj.eyes) e.blink(p.lids);
    this.jawNow = approach(this.jawNow, p.jaw, 30, dt); // eased, so a call or a yawn never snaps the mouth open
    r.obj.jaw?.open(clamp(this.jawNow, 0, JAW_MAX));
    this.earPitch = approach(this.earPitch, p.earPitch, 10, dt);
    this.earRoll = approach(this.earRoll, p.earRoll, 10, dt);
  }

  /** Look at things (and up when calling); lower the head to the ground to graze or drink. */
  private neck(chain: number[], dt: number) {
    const r = this.rig;
    const root = r.obj.root;
    const n = chain.length;
    let yawT = 0, pitchT = 0;
    if (r.look) {
      const s = root.worldToLocal(this.bones[chain[0]].getWorldPosition(scratchA));
      const d = root.worldToLocal(scratchB.set(r.look.x, r.look.y, r.look.z)).sub(s);
      yawT = clamp(Math.atan2(d.x, d.z), -1.0, 1.0);
      pitchT = clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.6);
    } else {
      // with nothing to look at, the head leads the turn: by the turn still to make, or (driven, with no target) the turn rate
      yawT = clamp(r.driven ? LEAD_RATE * r.turnRate : 0.6 * r.headingError, -0.6, 0.6);
    }
    pitchT += -0.55 * r.callNow + 0.25 * r.sleepNow;
    springInto(this.lookYaw, yawT, 40, 11, dt);
    springInto(this.lookPitch, pitchT, 40, 11, dt);
    this.steady(chain, n);

    const hd = r.headDownNow * (r.headDownNow > 0.9 ? 0.92 + 0.08 * Math.sin(r.time * 9) : 1); // nibbling
    if (hd < 0.01) return;
    // reach the mouth to the ground (or the water) a little in front of the chest; the neck's world matrices first, from
    // its last bone up to the root
    const rest = r.body.skeleton.bones, info = this.necks.get(chain)!, joints0 = info.joints0, total = info.total;
    this.bones[chain[n - 1]].updateWorldMatrix(true, false);
    const start = root.worldToLocal(scratchA.setFromMatrixPosition(this.bones[chain[0]].matrixWorld));
    const sx = start.x - joints0[0].x, sy = start.y - joints0[0].y, sz = start.z - joints0[0].z;
    const init = info.joints;
    for (let i = 0; i < init.length; i++) {
      const p = joints0[i];
      (init[i].x = p.x + sx), (init[i].y = p.y + sy), (init[i].z = p.z + sz);
    }
    const pole = scratchPole;
    (pole.x = start.x), (pole.y = start.y + total), (pole.z = start.z + total * 0.5);
    const ahead = root.localToWorld(scratchB.set(start.x, start.y, start.z + total * 0.55));
    const groundY = r.ground.isWater(ahead.x, ahead.z) ? r.ground.waterLevelAt(ahead.x, ahead.z) : r.ground.heightAt(ahead.x, ahead.z);
    ahead.y = groundY + rest[chain[n - 1]].r1;
    const target = root.worldToLocal(ahead), t = scratchTarget;
    (t.x = target.x), (t.y = target.y), (t.z = target.z);
    const joints = fabrikInto(init, info.lengths, t, n > 1 ? pole : null);
    const looked = info.looked;
    for (let j = 0; j < n; j++) this.bones[chain[j]].matrixWorld.decompose(scratchP, looked[j], scratchV);
    const rootQ = root.getWorldQuaternion(scratchRootQ);
    for (let j = 0; j < n; j++) {
      const k = chain[j], a = joints[j], b = joints[j + 1];
      // norm(b − a), as the vector helpers do it
      let x = b.x - a.x, y = b.y - a.y, z = b.z - a.z;
      const l = Math.sqrt(x * x + y * y + z * z);
      if (l < 1e-9) (x = 0), (y = 0), (z = 1);
      else {
        const s = 1 / l;
        (x *= s), (y *= s), (z *= s);
      }
      const down = scratchDown.copy(rootQ).multiply(scratchQ.setFromUnitVectors(r.restDirs[k], scratchV.set(x, y, z)));
      // (a bone whose one child is the next in the chain works out its own matrix only: that child is next)
      const bone = this.bones[k], next = j + 1 < n ? this.bones[chain[j + 1]] : null;
      r.setWorldRotation(bone, looked[j].slerp(down, hd), !(next && bone.children.length === 1 && bone.children[0] === next));
    }
  }

  /**
   * Pose the neck chain: the look, spread along it, and, on its feet, the head steadied against the gait. The neck base
   * counter-rotates most of the body's pitch and roll at the shoulders and pitches against the bob (the head bone takes
   * that pitch back, so the head stays level); a four-legged body nods as a front foot lands; a walking bird's head holds
   * still and then thrusts forward. The graze goes on top, so the mouth still reaches the ground.
   */
  private steady(chain: number[], n: number) {
    const r = this.rig, m = r.mech, info = this.necks.get(chain)!;
    let basePitch = 0, baseRoll = 0, lean = 0, nod = 0, slide = 0;
    if (m.onFeet) {
      const speedFrac = r.speed / Math.max(1e-6, r.topSpeed), share = stabiliseShare(speedFrac), tilt = m.gaitTilt(info.parent);
      basePitch = -share * tilt.pitch;
      baseRoll = -share * tilt.roll;
      // a nose-down pitch lowers a head that reaches forward: as the body rises, the neck dips
      if (info.head > 0) lean = (share * m.pose.bob) / info.reach;
      if (this.nodAmp) nod = headNod(m.front, this.nodAmp, speedFrac);
      if (this.bobShare) {
        // the head's offset (forward +) over each step; a nose-down pitch carries a raised head forward
        const offset = birdHeadBob((r.phase * 2) % 1, this.bobShare * STRIDE[r.gait] * r.legLength) * r.stepping;
        if (info.head > 0) lean += offset / info.rise;
        else slide = offset;
      }
    }
    // a flier's head takes back the body's flight pitch (level flight's nose-down, the flare's nose-up, easing out after
    // landing), so it keeps looking where it goes
    basePitch -= r.flightPitch;
    for (let j = 0; j < n; j++) {
      let pitch = this.lookPitch.pos / n, roll = 0;
      if (j === 0) {
        pitch += basePitch + lean;
        roll = baseRoll;
      }
      if (j === info.head) pitch += nod - lean;
      this.bones[chain[j]].quaternion.setFromEuler(scratchE.set(pitch, this.lookYaw.pos / n, roll, 'YXZ'));
    }
    // a head with no neck bone slides instead (only for a bird's bob: otherwise it sits at its rest position)
    if (info.rest) this.bones[chain[0]].position.set(info.rest.x, info.rest.y, info.rest.z + slide);
  }

  /**
   * The body's acceleration swings the tail and ears after it: up and down from the vertical acceleration, sideways from
   * the sideways one, each through a spring. Measured at the skeleton's root bone, so a waddle's weight shift sways them
   * too. The push is an impulse from the change in the body's velocity (the acceleration × dt a spring force would add),
   * so a footfall's kink kicks the same however finely the time is cut: the residents' substeps and any frame rate swing
   * the tail alike. The sideways push is high-passed: a held one (a steady turn) fades out over FOLLOW_HOLD, so the tail
   * swings out as a turn starts and back as it ends, but holds on the inside (`tailTurn`) through a long turn, however
   * fast. Nothing moves at dt = 0.
   */
  private followThrough(dt: number) {
    if (dt <= 0) return;
    const r = this.rig, f = this.follow;
    const at = scratchP.copy(this.bones[0].position).applyMatrix4(r.obj.root.matrixWorld);
    const vel = scratchV.copy(at).sub(f.at).divideScalar(dt);
    f.at.copy(at);
    // the first update, or a jump (back in view after moving unseen), is no motion: measure afresh from here
    if (f.seen === 0 || vel.lengthSq() > JUMP_SPEED * JUMP_SPEED) (f.seen = 1), (f.side = 0);
    else {
      if (f.seen === 2) {
        const dv = at.copy(vel).sub(f.vel);
        // the creature's left is (cos yaw, 0, −sin yaw); the tail and ears lag behind whichever way the body is pushed
        const left = dv.x * Math.cos(r.yaw) - dv.z * Math.sin(r.yaw);
        this.droop.vel -= FOLLOW_KICK * dv.y;
        // less the push held for a while (an impulse of its acceleration × dt), which then follows this one
        this.swing.vel += FOLLOW_KICK * (left - f.side * dt);
        f.side += (left / dt - f.side) * (1 - Math.exp(-dt / FOLLOW_HOLD));
      }
      f.vel.copy(vel); // a velocity now (an impulse from the next update on)
      f.seen = 2;
    }
    springInto(this.droop, 0, FOLLOW_K, FOLLOW_C, dt);
    springInto(this.swing, 0, FOLLOW_K, FOLLOW_C, dt);
  }

  /**
   * The body has jumped (back in view after moving unseen): the follow-through measures afresh from the next update, and
   * the tail and ears let go of any swing they had when last seen. Without it a creep shorter than a jump reads as one
   * update's velocity and kicks them.
   */
  resync(): void {
    this.follow.seen = 0;
    this.follow.side = 0;
    this.droop.pos = this.droop.vel = 0;
    this.swing.pos = this.swing.vel = 0;
  }

  private earTwitch(dt: number) {
    for (let ei = 0; ei < this.ears.length; ei++) {
      const e = this.ears[ei];
      e.next -= dt;
      e.hold -= dt;
      if (e.hold < 0) e.target = 0; // a twitch, then back
      if (e.next < 0) {
        e.target = (this.rng() * 2 - 1) * 0.35;
        e.next = 1.5 + this.rng() * 4;
        e.hold = this.rng() < 0.5 ? 0.3 : 2;
      }
      springInto(e.spring, e.target, 120, 14, dt);
      // the pose (alert, back, droop) adds to the twitch; flattened ears roll outwards, one way for each side
      // and the follow-through, at half the tail's: a sudden rise tips them back, a lurch to the left swings them right
      const pitch = e.spring.pos + this.earPitch + 0.5 * this.droop.pos;
      const roll = e.spring.pos * 0.5 - e.side * this.earRoll + 0.5 * this.swing.pos;
      for (let i = 0; i < e.chain.length; i++) setEuler(this.bones[e.chain[i]].quaternion, i === 0 ? pitch : 0, 0, i === 0 ? roll : 0);
    }
  }

  /** Start the wingbeat at the top, so a take-off begins with a downstroke. */
  downstroke() {
    this.flapPhase = 0.25;
  }

  /**
   * The wingbeat for this update: how open the wings are (half open crouched to take off), and the beat's speed, swing and
   * middle angle: harder and faster climbing and for the take-off's first strokes, quick shallow braking strokes held high
   * to land, still raised and ready crouched, and a glide (no swing) when level and fast for 2.5 s of every 6. The swing
   * and middle angle ease, so a glide and a change of stroke never snap. The rig calls it before placing the body, which
   * lifts with each downstroke.
   */
  beat(dt: number) {
    const r = this.rig, phase = r.phaseOfFlight;
    // they open briskly (the crouch is short) and fold at leisure
    const open = phase === 'crouch' ? 0.5 : r.flying ? 1 : 0;
    this.wingOpen += (open - this.wingOpen) * Math.min(1, dt * (open > this.wingOpen ? 8 : 4));
    let hz = this.flapHz, amp = FLAP_AMP, mean = FLAP_MEAN;
    if (phase === 'flare') (hz *= 1.3), (amp *= 0.7), (mean = 0.5);
    else if (phase === 'crouch') (amp = 0), (mean = 0.8);
    else {
      const climbing = r.climb > 0.3;
      if (climbing) (hz *= 1.25), (amp *= 1.3);
      if (r.strokes > 0) amp *= 1.3;
      const flapping = r.recipe.motion.gait === 'hover' || climbing || r.speed < 1.5 || r.time % 6 < 3.5;
      if (!flapping) (amp = 0), (mean = 0.12);
    }
    this.flapAmp = approach(this.flapAmp, amp, 10, dt);
    this.flapMean = approach(this.flapMean, mean, 10, dt);
    this.flapPhase = (this.flapPhase + hz * dt) % 1;
  }

  /** Wings fold along the back on the ground, following the body's slope, and open to beat (or glide) in the air. */
  private flapWings() {
    const r = this.rig;
    const theta = this.flapMean + this.flapAmp * Math.sin(2 * Math.PI * this.flapPhase);
    // the body's direction now (bone 0 hangs from the root, so its own rotation is its creature-space one)
    const q0 = this.bones[0].quaternion, rest = r.body.skeleton.bones;
    const body = scratchV.set(rest[0].end.x - rest[0].start.x, rest[0].end.y - rest[0].start.y, rest[0].end.z - rest[0].start.z).normalize().applyQuaternion(q0);
    scratchDir.x = body.x;
    scratchDir.y = body.y;
    scratchDir.z = body.z;
    for (let i = 0; i < this.wings.length; i++) {
      const w = this.wings[i], side = w.side >= 0 ? 1 : -1;
      const k = w.chain[0];
      // the fold in creature space, brought into the frame of the bone the wing hangs from
      const f = foldDirection(scratchDir, side, scratchFold);
      const parentQ = this.creatureQ(rest[k].parent, scratchQ).invert();
      const fold = this.bones[k].quaternion.setFromUnitVectors(this.wingRest[i], scratchP.set(f.x, f.y, f.z).applyQuaternion(parentQ));
      fold.slerp(scratchFlap.setFromAxisAngle(Z, side * theta), this.wingOpen);
      // the outer wing tucks in when folded (a two-part wing can't Z-fold, so it shortens instead)
      const tuck = 0.5 + 0.5 * this.wingOpen;
      for (let j = 1; j < w.chain.length; j++) {
        const b = w.chain[j];
        this.bones[b].quaternion.setFromAxisAngle(Z, side * theta * 0.4 * this.wingOpen);
        this.bones[b].scale.setScalar(tuck);
      }
    }
  }

  /** A bone's rotation in creature space (relative to the root): its own and its parents' local rotations, into `out`. */
  private creatureQ(k: number, out: Quaternion): Quaternion {
    out.identity();
    const rest = this.rig.body.skeleton.bones;
    for (let b = k; b >= 0; b = rest[b].parent) out.premultiply(this.bones[b].quaternion);
    return out;
  }

  /**
   * Side fins scull slowly when the body is slow and fold back as it speeds up (blended between 0.3 and 0.6 of its top
   * speed). Swimming, a centre fin (dorsal, tail) bends on with the wave at the segment it hangs from; on land it paddles.
   */
  private paddleFins(t: number, swim: boolean) {
    const r = this.rig, fold = clamp((r.speed / Math.max(1e-6, r.topSpeed) - 0.3) / 0.3, 0, 1);
    const scull = Math.sin(2 * Math.PI * FIN_HZ * t), side = (1 - fold) * FIN_SCULL * scull + fold * (FIN_FOLD + FIN_TREMBLE * scull);
    const paddle = 0.3 * Math.sin(2 * Math.PI * 1.6 * (1 + r.speed) * t);
    for (let i = 0; i < this.fins.length; i++) {
      const f = this.fins[i], at = this.finAt[i];
      if (f.side !== 0) scratchE.set(side, 0, 0, 'YXZ');
      else scratchE.set(0, !swim ? paddle : at >= 0 ? this.swim.bend[at] : 0, 0, 'YXZ');
      for (let j = 0; j < f.chain.length; j++) this.bones[f.chain[j]].quaternion.setFromEuler(scratchE);
    }
  }
}

/** The neck chain's levers for steadying the head (see NeckInfo), from the rest skeleton. */
function neckInfo(rest: BoneDef[], chain: number[]): NeckInfo {
  const head = chain.findIndex((k) => rest[k].role === 'head');
  const base = rest[chain[0]].start, h = rest[chain[Math.max(0, head)]];
  const length = (k: number) => len(sub(rest[k].end, rest[k].start));
  const whole = chain.reduce((s, k) => s + length(k), 0);
  const neckLength = chain.reduce((s, k) => s + (rest[k].role === 'neck' ? length(k) : 0), 0);
  // levers never shorter than 0.3 of the chain, so an upright neck (or a head held straight up) never pitches wildly
  const reach = Math.max((h.start.z + h.end.z) / 2 - base.z, 0.3 * whole);
  const rise = Math.max((h.start.y + h.end.y) / 2 - base.y, 0.3 * whole);
  const p = rest[chain[0]].parent, ps = p >= 0 ? rest[p].start : v3();
  const own = head === 0 ? new Vector3(base.x - ps.x, base.y - ps.y, base.z - ps.z) : null;
  const joints0 = [base, ...chain.map((k) => rest[k].end)], lengths = chain.map(length);
  return {
    head, parent: p, reach, rise, neckLength, rest: own,
    joints0, lengths, total: lengths.reduce((a, b) => a + b, 0), joints: joints0.map(() => v3()), looked: chain.map(() => new Quaternion()),
  };
}
