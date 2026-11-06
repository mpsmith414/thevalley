/**
 * The animal's senses in the running valley, per frame (see `wire.ts`, which owns the views and calls these): Fear's
 * pulse at the edges, its heartbeat and the danger's ring, Smell's scent trails, Hearing's ripples and Sharp eyes'
 * shimmer and zoom. Each eases in and out in real time and costs nothing once it is out.
 */
import { Vector3 } from 'three/webgpu';
import type { Vec3 } from '../util/vec';
import { FearBeat, bpm } from './fear';
import type { Sensing } from './senses';
import { SHARP_CONE, sharpPick, type Sighting } from './sharp';
import type { Pose } from './types';
import type { ViewAnimal } from './views';
import type { ViewsWireDeps } from './wire';

/** What the senses' wiring needs from the views' (see `ViewsWireDeps`). */
export type SensesDeps = Pick<ViewsWireDeps, 'camera' | 'now' | 'lens' | 'heartbeat' | 'threatRing' | 'smell' | 'hearing' | 'sharp' | 'daylight'> & { animals: Pick<ViewsWireDeps['animals'], 'viewAnimal'> };

/** Fear's pulse eases in and out over this long (real seconds), and follows the animal's fear with this time constant (s): never a jump. */
const FEAR_S = 0.5, FEAR_TAU = 0.6;
/** Smell's trails ease in and out over this long (real seconds), and are laid afresh round the animal this often (real seconds). */
const SMELL_S = 0.5, SNIFF_S = 0.25;
/** Hearing's ripples ease in and out over this long (real seconds). */
const HEAR_S = 0.5;
/**
 * Sharp eyes' zoom eases in and out over this long (real seconds); its shimmer rings glow this much (prey; the others
 * half that), breathing this many times as fast as the highlight's.
 */
const SHARP_S = 0.8, SHIMMER = 0.7, SHIMMER_RATE = 3;
/** The danger counts as in view while it projects within this share of the screen's half width and height; else the edge arc shows. */
const IN_VIEW = 0.95;
/** Degrees to radians. */
export const DEG = Math.PI / 180;
/** An ease: 0..1 in, 0..1 out, flat at both ends. */
export const smooth = (t: number) => t * t * (3 - 2 * t);

const threatAt = new Vector3();
/** `k` (0..1) moved `dt` s on toward 1 (`on`) or 0, all the way in `s` s. */
const fade = (k: number, on: boolean, dt: number, s: number) => Math.min(1, Math.max(0, k + (on ? dt : -dt) / s));
/** The way a pose faces (unit). */
const forwardOf = (p: Pose): Vec3 => ({ x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) });

/** The senses' per-frame wiring (see the file's note). */
export class SensesWire {
  /** Fear's pulse: whether it was on last frame, how far it is in (0..1, linear in time), the fear it shows (eased after the animal's), and its beat. */
  private fearOn = false;
  private fearIn = 0;
  private fearLevel = 0;
  private beat = new FearBeat();
  /** Smell's trails: how far in they are (0..1, linear in time), whose they were last laid for, and when they are laid next (real ms). */
  private smellIn = 0;
  private smellId: string | null = null;
  private sniffAt = -Infinity;
  /**
   * Hearing's ripples, Sharp eyes' shimmer and its zoom (Eyes only): how far in each is (0..1, linear in time); the
   * animals shimmering (kept while the shimmer eases out), and how many rings showed last frame.
   */
  private hearIn = 0;
  private sharpIn = 0;
  private zoomIn = 0;
  private picks: Sighting[] = [];
  private shimmering = 0;

  constructor(private readonly d: SensesDeps) {}

  /**
   * Fear (`s`: what the animal senses now, while Fear is on; null otherwise), `dt` real seconds on: the edges' pulse eased
   * in or out and beating at its eased fear, the heartbeat with it, and the danger's red ring (or the arc at the screen's
   * edge on its side, while it is out of view): the side for that arc (null: none; undefined: off and put out, nothing done).
   */
  feel(dt: number, s: Sensing | null): 'left' | 'right' | null | undefined {
    const { d } = this, starting = !!s && !this.fearOn;
    this.fearOn = !!s;
    if (!s && this.fearIn === 0) return undefined; // off, and already put out: nothing to do
    // switching on from right out, the pulse starts at the animal's fear now, on a fresh beat; after that it follows the
    // fear, eased (switched back on while it eases out, it carries on from where it is: the edges never jump)
    if (starting && this.fearIn === 0) this.beat.reset(), (this.fearLevel = s!.fear);
    else if (s) this.fearLevel = s.fear + (this.fearLevel - s.fear) * Math.exp(-dt / FEAR_TAU);
    this.fearIn = Math.min(1, Math.max(0, this.fearIn + (s ? dt : -dt) / FEAR_S));
    const k = smooth(this.fearIn);
    if (d.lens) d.lens.edge.value = k > 0 ? k * this.beat.step(dt, this.fearLevel) : 0;
    // the sound (re)starts in step with the edges' beat, wherever that is
    d.heartbeat?.set(bpm(this.fearLevel), !!s, this.beat.at);
    const t = s?.threat ? d.animals.viewAnimal(s.threat) : null, threat = t && !t.gone ? t : null;
    const side = threat ? this.sideOf(threat.pose) : null;
    d.threatRing?.show(threat && side === null ? threat.pose : null, d.now() / 1000);
    return side;
  }

  /**
   * Hearing (`id`: the animal listening, while Hearing is on; null otherwise), `dt` real seconds on: the ripples of the
   * ones it hears, eased in or out; the side of the screen the loudest one out of view is on, for the edge arc (null:
   * none; undefined: off and put out, nothing done).
   */
  hear(dt: number, id: string | null): 'left' | 'right' | null | undefined {
    const h = this.d.hearing;
    if (!h || (id === null && this.hearIn === 0)) return undefined;
    const sounds = id !== null ? h.heard(id) : null;
    this.hearIn = fade(this.hearIn, id !== null, dt, HEAR_S);
    h.mesh.frame(sounds, dt, this.d.now() / 1000, smooth(this.hearIn));
    let side: 'left' | 'right' | null = null, loudest = 0;
    for (const s of sounds ?? []) {
      if (s.loud <= loudest) continue;
      const off = this.sideOf(s.pose);
      if (off) (side = off), (loudest = s.loud);
    }
    return side;
  }

  /**
   * Sharp eyes (`id`: the animal looking, while they are on; null otherwise), `dt` real seconds on, the camera at `pose`,
   * `eyes` while the Eyes view is shown: the shimmer rings under the moving animals it spots where it looks (in the
   * zoom's cone in Eyes, across the picture in Follow and Close), eased in or out (the last ones fading where they were);
   * how far the zoom is in (0..1: only in Eyes, Ruling R12).
   */
  spot(dt: number, id: string | null, eyes: boolean, pose: Pose): number {
    const s = this.d.sharp, { camera } = this.d;
    this.sharpIn = fade(this.sharpIn, id !== null, dt, SHARP_S);
    this.zoomIn = fade(this.zoomIn, id !== null && eyes, dt, SHARP_S);
    const k = smooth(this.sharpIn), zoom = smooth(this.zoomIn);
    if (!s || (k === 0 && this.shimmering === 0)) return zoom;
    const sight = id !== null ? s.sightings(id, this.d.daylight?.() ?? 1) : null;
    if (sight) {
      const half = Math.atan(Math.tan((camera.fov * DEG) / 2) * camera.aspect) / DEG; // the picture's half width (degrees)
      const ids = sharpPick(sight.seen, pose.pos, forwardOf(pose), sight.range, eyes ? SHARP_CONE : half).slice(0, s.rings.length);
      this.picks = ids.map((pid) => sight.seen.find((x) => x.id === pid)!);
    }
    if (k === 0) this.picks = [];
    const t = (this.d.now() / 1000) * SHIMMER_RATE, n = this.picks.length;
    for (let i = 0; i < Math.max(n, this.shimmering); i++) {
      const c = i < n ? this.picks[i] : null;
      s.rings[i].show(c && c.pose, t, c ? SHIMMER * k * (c.prey ? 1 : 0.5) : 0);
    }
    this.shimmering = n;
    return zoom;
  }

  /**
   * Smell (`id`: the animal smelling, while Smell is on; null otherwise), `dt` real seconds on: the trails round it laid
   * afresh every SNIFF_S s (at once for another animal), and eased in or out; off and eased right out, nothing is done.
   */
  sniff(dt: number, id: string | null): void {
    const s = this.d.smell;
    if (!s || (id === null && this.smellIn === 0)) return;
    const now = this.d.now();
    if (id !== null && (id !== this.smellId || now >= this.sniffAt)) {
      const scents = s.scents(id);
      if (scents) s.mesh.lay(scents, s.time());
      this.smellId = id;
      this.sniffAt = now + SNIFF_S * 1000;
    }
    this.smellIn = Math.min(1, Math.max(0, this.smellIn + (id !== null ? dt : -dt) / SMELL_S));
    s.mesh.frame(s.time(), smooth(this.smellIn));
  }

  /** Where animal `p` is from the camera: null while it is in view, else the side of the screen it is off ('left' or 'right'). */
  private sideOf(p: ViewAnimal['pose']): 'left' | 'right' | null {
    const { camera } = this.d;
    camera.updateMatrixWorld();
    threatAt.set(p.pos.x, p.pos.y + p.backHeight * 0.5, p.pos.z).applyMatrix4(camera.matrixWorldInverse); // in the camera's space
    const behind = threatAt.z >= 0, side = threatAt.x < 0 ? 'left' : 'right';
    if (behind) return side;
    threatAt.applyMatrix4(camera.projectionMatrix);
    return Math.abs(threatAt.x) <= IN_VIEW && Math.abs(threatAt.y) <= IN_VIEW ? null : side;
  }
}
