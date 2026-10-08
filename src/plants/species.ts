/** Plant recipes: what each species looks like (for the generator) and where it grows (for scatter). */
import type { Biomes } from '../valley/types';

export const PLANT_KINDS = ['pine', 'spruce', 'birch', 'alder', 'willow', 'juniper', 'blueberry', 'fern', 'boulder', 'log', 'stump'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];
/** Models per kind: 0–1 young (age < 0.45), 2–5 mature. */
export const VARIANTS = 6;
export const TREE_KINDS: PlantKind[] = ['pine', 'spruce', 'birch', 'alder', 'willow'];

export type LeafSpec = {
  type: 'needle' | 'broad'; card: 'pine' | 'spruce' | 'birch' | 'alder' | 'willow' | 'juniper' | 'blueberry' | 'fern';
  size: number; perTwig: number; flutter: number /*wind response of leaves, 0..1*/;
};
/**
 * A tree. `taper` is the exponent of the trunk's radius profile; `trunkWander` the trunk's sideways drift (m), which also
 * sets how irregular the crown is; `angle`/`angleTop` are degrees from vertical; `length` is the longest branch as a
 * fraction of tree height; `gravity` bends branches up (+) or down (−), more strongly on deeper levels.
 */
export type TreeSpec = {
  form: 'tree'; height: [number, number]; trunkRadius: number; taper: number; trunkWander: number;
  crownStart: number; levels: 2 | 3; branches: [number, number, number]; angle: number; angleTop: number;
  length: number; lengthProfile: 'conical' | 'oval' | 'high-round'; gravity: number; leaf: LeafSpec; bark: 'pine' | 'spruce' | 'birch' | 'generic';
};
/** A shrub: `stems` from the root, fanning out by `spread` (0 upright … 1 sprawling). */
export type ShrubSpec = { form: 'shrub'; height: [number, number]; stems: number; spread: number; leaf: LeafSpec };
/** A fern: up to `fronds` fronds of `length` m, arching over by `arch` (0 upright … 1 tips at the ground). */
export type FernSpec = { form: 'fern'; fronds: number; length: [number, number]; arch: number; leaf: LeafSpec };
/** A boulder: `size` is its diameter (m), `flatten` its vertical squash. */
export type RockSpec = { form: 'rock'; size: [number, number]; flatten: number; roughness: number };
export type LogSpec = { form: 'log'; length: [number, number]; radius: [number, number]; bark: 'pine' | 'birch' };
export type StumpSpec = { form: 'stump'; height: [number, number]; radius: [number, number]; bark: 'pine' | 'spruce' };
export type PlantSpec = TreeSpec | ShrubSpec | FernSpec | RockSpec | LogSpec | StumpSpec;
export type ScatterRule = { perHa: number; spacing: number; suit: (c: SiteInfo) => number; trunk: number /*trunk radius at scale 1, age 1; 0 = no obstacle*/ };
export type SiteInfo = { b: Biomes; slope: number; moisture: number; waterDepth: number; wet: boolean; edge: number; northness: number };

/** Wraps a suitability so nothing grows in water, on wet ground or on slopes of `maxSlope`° or more; clamps to 0–1. */
const dry = (f: (c: SiteInfo) => number, maxSlope = 45) => (c: SiteInfo) =>
  c.wet || c.waterDepth > 0 || c.slope >= maxSlope ? 0 : Math.min(1, Math.max(0, f(c)));
const below = (slope: number, max: number) => (slope < max ? 1 : 0);

export const SPECIES: Record<PlantKind, { spec: PlantSpec; scatter: ScatterRule }> = {
  pine: {
    spec: { form: 'tree', height: [14, 24], trunkRadius: 0.22, taper: 0.8, trunkWander: 0.6, crownStart: 0.55, levels: 2, branches: [26, 8, 0],
      angle: 76, angleTop: 50, length: 0.23, lengthProfile: 'high-round', gravity: 0.2,
      leaf: { type: 'needle', card: 'pine', size: 0.75, perTwig: 7, flutter: 0.3 }, bark: 'pine' },
    scatter: { perHa: 220, spacing: 3.2, trunk: 0.22, suit: dry((c) => c.b.forest * (1 - c.moisture * 0.6) * below(c.slope, 35)) },
  },
  spruce: {
    spec: { form: 'tree', height: [12, 26], trunkRadius: 0.26, taper: 1, trunkWander: 0.1, crownStart: 0.12, levels: 2, branches: [52, 7, 0],
      angle: 86, angleTop: 55, length: 0.22, lengthProfile: 'conical', gravity: -0.35,
      leaf: { type: 'needle', card: 'spruce', size: 0.8, perTwig: 6, flutter: 0.2 }, bark: 'spruce' },
    scatter: { perHa: 180, spacing: 2.8, trunk: 0.26, suit: dry((c) => c.b.forest * (0.5 + 0.5 * c.northness) * (0.4 + c.moisture)) },
  },
  birch: {
    spec: { form: 'tree', height: [10, 18], trunkRadius: 0.15, taper: 0.9, trunkWander: 0.35, crownStart: 0.4, levels: 3, branches: [18, 6, 4],
      angle: 50, angleTop: 28, length: 0.3, lengthProfile: 'oval', gravity: 0.1,
      leaf: { type: 'broad', card: 'birch', size: 0.5, perTwig: 6, flutter: 1 }, bark: 'birch' },
    scatter: { perHa: 60, spacing: 3.0, trunk: 0.15, suit: dry((c) => Math.max(c.edge, 0.25 * c.b.forest, 0.15 * c.b.meadow)) },
  },
  alder: {
    spec: { form: 'tree', height: [8, 14], trunkRadius: 0.16, taper: 1, trunkWander: 0.3, crownStart: 0.3, levels: 2, branches: [24, 7, 0],
      angle: 58, angleTop: 35, length: 0.28, lengthProfile: 'oval', gravity: 0.05,
      leaf: { type: 'broad', card: 'alder', size: 0.6, perTwig: 6, flutter: 0.6 }, bark: 'generic' },
    scatter: { perHa: 80, spacing: 2.5, trunk: 0.16, suit: dry((c) => (c.moisture > 0.55 && !c.wet ? c.moisture : 0)) },
  },
  willow: {
    spec: { form: 'tree', height: [6, 12], trunkRadius: 0.22, taper: 1.1, trunkWander: 0.6, crownStart: 0.25, levels: 3, branches: [22, 6, 3],
      angle: 48, angleTop: 25, length: 0.4, lengthProfile: 'oval', gravity: -0.5,
      leaf: { type: 'broad', card: 'willow', size: 0.5, perTwig: 5, flutter: 0.8 }, bark: 'generic' },
    scatter: { perHa: 40, spacing: 3.0, trunk: 0.22, suit: dry((c) => c.b.shore + Math.max(0, c.moisture - 0.3) * 0.5) },
  },
  juniper: {
    spec: { form: 'shrub', height: [0.6, 2.5], stems: 7, spread: 0.25, leaf: { type: 'needle', card: 'juniper', size: 0.35, perTwig: 5, flutter: 0.2 } },
    scatter: { perHa: 60, spacing: 1.2, trunk: 0, suit: dry((c) => 0.6 * c.b.meadow * c.edge + 0.4 * c.b.rock * below(c.slope, 30)) },
  },
  blueberry: {
    spec: { form: 'shrub', height: [0.2, 0.45], stems: 8, spread: 0.85, leaf: { type: 'broad', card: 'blueberry', size: 0.12, perTwig: 5, flutter: 0.7 } },
    scatter: { perHa: 900, spacing: 0.8, trunk: 0, suit: dry((c) => c.b.forest * (1 - c.moisture * 0.3)) },
  },
  fern: {
    spec: { form: 'fern', fronds: 14, length: [0.4, 1.1], arch: 0.7, leaf: { type: 'broad', card: 'fern', size: 1, perTwig: 1, flutter: 0.6 } },
    scatter: { perHa: 700, spacing: 0.9, trunk: 0, suit: dry((c) => c.b.forest * c.moisture) },
  },
  boulder: {
    spec: { form: 'rock', size: [0.4, 3.5], flatten: 0.6, roughness: 0.5 },
    // 15 per ha anywhere, plus 80 on rock: one rule at the combined density, scaled down off the rock.
    scatter: { perHa: 95, spacing: 2.0, trunk: 0.9, suit: dry((c) => (15 + 80 * c.b.rock) / 95, 55) },
  },
  log: {
    spec: { form: 'log', length: [4, 12], radius: [0.14, 0.32], bark: 'pine' },
    scatter: { perHa: 8, spacing: 6.0, trunk: 0, suit: dry((c) => c.b.forest) },
  },
  stump: {
    spec: { form: 'stump', height: [0.3, 0.8], radius: [0.18, 0.4], bark: 'pine' },
    scatter: { perHa: 6, spacing: 3.0, trunk: 0.3, suit: dry((c) => c.b.forest) },
  },
};
