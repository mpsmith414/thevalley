/**
 * The scent trails (the Smell sense): where each animal has walked lately, kept by the residents as the simulation steps
 * (only for the eye: the animals themselves smell by `nearRange`), and what another animal's trail means to the one
 * smelling it, by colour. Pure: the trail mesh draws what `near` gives.
 */
import type { RGB } from '../render/grade';
import type { Pt } from '../sim/types';

/** One point of a trail near the animal smelling: whose it is, of what species, where, and how long ago (animal s) it was left. */
export type TrailPoint = { id: string; species: string; x: number; z: number; age: number };

/** What another animal is to the one smelling its trail: what it hunts, what hunts it, its own kind, or anyone else. */
export type Meaning = 'prey' | 'danger' | 'kin' | 'other';

/** A trail point with what it means to the animal smelling it. */
export type Scent = TrailPoint & { meaning: Meaning };

/** What an animal smells now: where it is, how far it smells (`nearRange` with `loud`), and the scent there (not its own). */
export type Scents = { at: Pt; range: number; points: Scent[] };

/** A small allowance (animal s) for the simulation's ticks adding up a hair short of a point's time. */
const EPS = 1e-6;

/** One animal's trail: a ring of points (x, z and the time each was left), and when the last was left. */
type Trail = { species: string; xs: Float32Array; zs: Float32Array; ts: Float64Array; head: number; n: number; last: number };

/**
 * Every animal's recent trail: a point every `every` animal seconds, the last `keep` animal seconds' worth (2 valley
 * hours at ANIMAL_S_PER_HOUR 60), in a ring buffer of fixed size per animal, so it never grows.
 */
export class TrailStore {
  private trails = new Map<string, Trail>();
  private readonly size: number;

  constructor(
    private readonly every = 2,
    private readonly keep = 120,
  ) {
    this.size = Math.ceil(keep / every);
  }

  /** Animal `id` (of `species`) is at (x, z) at animal time `t`: a new point if it has been `every` s since its last. */
  record(id: string, species: string, x: number, z: number, t: number): void {
    let tr = this.trails.get(id);
    if (!tr) {
      const n = this.size;
      tr = { species, xs: new Float32Array(n), zs: new Float32Array(n), ts: new Float64Array(n), head: 0, n: 0, last: -Infinity };
      this.trails.set(id, tr);
    }
    if (t < tr.last + this.every - EPS) return;
    tr.xs[tr.head] = x;
    tr.zs[tr.head] = z;
    tr.ts[tr.head] = t;
    tr.head = (tr.head + 1) % this.size;
    tr.n = Math.min(this.size, tr.n + 1);
    tr.last = t;
  }

  /** The points within `r` m of (x, z) left within `keep` s of animal time `t`, each animal's oldest first. */
  near(x: number, z: number, r: number, t: number): TrailPoint[] {
    const out: TrailPoint[] = [], r2 = r * r;
    for (const [id, tr] of this.trails) {
      if (t - tr.last > this.keep) continue; // all of it too old
      for (let k = 0; k < tr.n; k++) {
        const i = (tr.head - tr.n + k + this.size) % this.size, age = t - tr.ts[i];
        if (age > this.keep) continue;
        const dx = tr.xs[i] - x, dz = tr.zs[i] - z;
        if (dx * dx + dz * dz <= r2) out.push({ id, species: tr.species, x: tr.xs[i], z: tr.zs[i], age });
      }
    }
    return out;
  }

  /** Animal `id` has left the valley: its trail goes with it. */
  forget(id: string): void {
    this.trails.delete(id);
  }
}

/** Who hunts whom in the valley now (the simulation's food web), by species. */
export type FoodWeb = { hunts(hunter: string, prey: string): boolean };

/** What an animal of species `other` is to one of species `viewer` smelling its trail. */
export function meaningOf(viewer: string, other: string, web: FoodWeb): Meaning {
  if (other === viewer) return 'kin';
  if (web.hunts(viewer, other)) return 'prey';
  if (web.hunts(other, viewer)) return 'danger';
  return 'other';
}

/**
 * The scent's colours (linear, glowing additively, so a dimmer one is fainter): its prey warm gold, its dangers red (the
 * Fear ring's soft red), its own kind pale, others faint white.
 */
const COLOURS: Record<Meaning, RGB> = { prey: [1, 0.72, 0.28], danger: [0.88, 0.31, 0.24], kin: [0.62, 0.7, 0.78], other: [0.3, 0.3, 0.3] };

/** The colour of a trail that means `meaning` to the animal smelling it. */
export const trailColour = (meaning: Meaning): RGB => COLOURS[meaning];
