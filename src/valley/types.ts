/** World types for the Valley: the hand-authored layout and what generators share. */

/** Bump whenever any generator output changes; part of the cache key. */
export const GENERATOR_VERSION = 1;
export const WORLD_SIZE = 1600, DEFAULT_GRID = 2049, TILE_SIZE = 64, TILES = 25, LAKE_LEVEL = 0;

export type Pt = { x: number; z: number };
export type Ridge = { points: Pt[]; height: number; width: number; rocky: number /*0 smooth … 1 granite*/ };
export type Lake = { outline: Pt[]; depth: number; level: number };
export type River = { points: Pt[]; width0: number; width1: number; depth: number };
export type AreaKind = 'meadow' | 'rock' | 'beach'; // forest is the default everywhere else
export type Area = { kind: AreaKind; points: Pt[]; soft: number /*edge blend, m*/ };
export type Viewpoint = { name: string; pos: Pt & { h: number }; look: Pt & { h: number } }; // h = metres above ground (or water)
export type Medium = 'land' | 'water' | 'shore' | 'air';
export type HomeRange = { species: string /*cast recipe id*/; count: number; center: Pt; radius: number; medium: Medium; prefer: (keyof Biomes)[] };
export type Layout = { seed: number; size: number; floor: number; rim: number; ridges: Ridge[]; lake: Lake; river: River; areas: Area[]; viewpoints: Viewpoint[]; homes: HomeRange[] };
export type Biomes = { forest: number; meadow: number; rock: number; shore: number; beach: number };
