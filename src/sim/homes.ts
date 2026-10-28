import type { HomeRange } from '../valley/types';

const P = (x: number, z: number) => ({ x, z });

/** The valley's native animals and where each family lives (the 4a homes; the valley's own `VALLEY.homes` only feeds its cache key). */
export const HOMES: HomeRange[] = [
  { species: 'deer', count: 7, center: P(-110, 140), radius: 65, medium: 'land', prefer: ['meadow', 'forest'] },
  { species: 'rabbit', count: 8, center: P(-115, 215), radius: 30, medium: 'land', prefer: ['meadow'] },
  { species: 'fox', count: 2, center: P(-20, 340), radius: 130, medium: 'land', prefer: ['forest', 'meadow'] },
  { species: 'fox', count: 2, center: P(-80, 300), radius: 120, medium: 'land', prefer: ['forest', 'meadow'] },
  { species: 'wolf', count: 4, center: P(-420, 120), radius: 250, medium: 'land', prefer: ['forest'] },
  { species: 'hawk', count: 2, center: P(-150, 150), radius: 200, medium: 'air', prefer: ['meadow'] },
  { species: 'duck', count: 6, center: P(150, 200), radius: 140, medium: 'water', prefer: ['shore'] },
  { species: 'trout', count: 3, center: P(150, 200), radius: 150, medium: 'water', prefer: [] },
  { species: 'trout', count: 2, center: P(-180, -90), radius: 60, medium: 'water', prefer: [] },
  { species: 'frog', count: 2, center: P(-45, 200), radius: 30, medium: 'shore', prefer: ['shore', 'meadow'] },
  { species: 'frog', count: 2, center: P(-60, 215), radius: 30, medium: 'shore', prefer: ['shore', 'meadow'] },
];
