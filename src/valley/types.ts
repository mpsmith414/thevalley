/** World types for the Valley: the hand-authored layout and what generators share. */
import type { RiverSample, WaterMaps } from './generate/carve';
import type { PlantModelSet } from '../plants/generator';

export type { PlantModelSet };

/** Bump whenever any generator output changes; part of the cache key. */
export const GENERATOR_VERSION = 1;
export const WORLD_SIZE = 1600, DEFAULT_GRID = 2049, TILE_SIZE = 64, TILES = 25, LAKE_LEVEL = 0;
/** Floats per plant instance: x, y, z, yaw, scale, leanX, leanZ, tint, age, health. */
export const INSTANCE_STRIDE = 10;

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

/** Plant instances of one tile: a kind and variant byte per plant, and `INSTANCE_STRIDE` floats each in `data`. */
export type PlantInstances = { kind: Uint8Array; variant: Uint8Array; data: Float32Array };
/** One 64 m tile: its plants, and tree trunks as x, z, r triples (for collision and path-finding). */
export type TileData = { tx: number; tz: number; plants: PlantInstances; trunks: Float32Array };
/** Everything generated for the Valley: the terrain, water, biome maps, river course and plants. */
export type ValleyData = {
  version: number; key: string; size: number; grid: number; height: Float32Array; normals: Uint8Array;
  water: WaterMaps; biomes: Uint8Array; river: RiverSample[]; tiles: TileData[]; plantModels: PlantModelSet;
};
