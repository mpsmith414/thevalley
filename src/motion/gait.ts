import type { Recipe } from '../recipe/schema';
import type { Limb } from './limbs';

export type GaitName = 'walk' | 'trot' | 'gallop' | 'tripod' | 'wave' | 'hop' | 'biped';

/** Which footfall pattern suits this many legs at this fraction of top speed. */
export function chooseGait(legs: Limb[], recipe: Recipe, speedFrac: number): GaitName {
  if (recipe.motion.gait === 'hop') return 'hop';
  if (legs.length === 2) return 'biped';
  if (legs.length === 4) return speedFrac < 0.35 ? 'walk' : speedFrac < 0.75 ? 'trot' : 'gallop';
  if (legs.length === 6) return 'tripod';
  return 'wave';
}

/** Stride length as a multiple of leg length. */
export const STRIDE: Record<GaitName, number> = { walk: 0.9, biped: 0.9, wave: 0.6, tripod: 0.7, trot: 1.3, gallop: 2.0, hop: 1.6 };

/**
 * When in its cycle (0..1) each leg lifts, and what fraction of the cycle a foot is on the ground (duty).
 * Front/hind and left/right come from each limb's rank and side.
 */
export function phasesFor(legs: Limb[], gait: GaitName): { phase: number[]; duty: number } {
  const left = (l: Limb) => l.side >= 0;
  const perSide = Math.max(1, ...[-1, 0, 1].map((s) => legs.filter((l) => l.side === s).length));
  const front = (l: Limb) => l.rank === 0 && perSide > 1;
  switch (gait) {
    case 'biped':
      return { phase: legs.map((l) => (left(l) ? 0 : 0.5)), duty: 0.6 };
    case 'walk': // lateral sequence: left-hind, left-front, right-hind, right-front
      return { phase: legs.map((l) => (left(l) ? (front(l) ? 0.25 : 0) : front(l) ? 0.75 : 0.5)), duty: 0.7 };
    case 'trot': // diagonal pairs
      return { phase: legs.map((l) => (left(l) === front(l) ? 0 : 0.5)), duty: 0.5 };
    case 'gallop':
      return { phase: legs.map((l) => (front(l) ? (left(l) ? 0 : 0.1) : left(l) ? 0.5 : 0.6)), duty: 0.4 };
    case 'tripod': // front and back on one side move with the middle of the other
      return { phase: legs.map((l) => ((l.rank % 2 === 0) === left(l) ? 0 : 0.5)), duty: 0.5 };
    case 'hop':
      return { phase: legs.map((l) => (front(l) ? 0.1 : 0)), duty: 0.3 };
    case 'wave':
      return { phase: legs.map((l) => ((l.rank / perSide) * 0.5 + (left(l) ? 0 : 0.5)) % 1), duty: 0.65 };
  }
}
