import { mulberry32, between } from '../util/rng';
import type { Layout, Pt } from './types';

const P = (x: number, z: number): Pt => ({ x, z });
const SEED = 20261007;

/** 16-point ellipse with seeded radial wobble (±8 m), so the shoreline is not a perfect oval. */
function lakeOutline(cx: number, cz: number, rx: number, rz: number): Pt[] {
  const rng = mulberry32(SEED ^ 0x1a4e);
  return Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return P(cx + (rx * Math.cos(a)) + between(rng, -8, 8), cz + (rz * Math.sin(a)) + between(rng, -8, 8));
  });
}

/** The hand-authored Valley: where the ridges, lake, river, areas, viewpoints and animal homes go. */
export const VALLEY: Layout = {
  seed: SEED,
  size: 1600,
  floor: 3,
  rim: 60,
  ridges: [
    { points: [P(-800, -700), P(0, -640), P(800, -680)], height: 170, width: 260, rocky: 0.4 },
    { points: [P(-760, -600), P(-720, 0), P(-700, 700)], height: 140, width: 220, rocky: 0.3 },
    { points: [P(560, -520), P(620, -100), P(650, 450)], height: 150, width: 200, rocky: 0.9 },
    { points: [P(-250, 350)], height: 45, width: 90, rocky: 0.8 },
    { points: [P(-700, 760), P(700, 750)], height: 70, width: 200, rocky: 0.2 },
  ],
  lake: { outline: lakeOutline(150, 200, 190, 130), depth: 9, level: 0 },
  river: {
    points: [P(-560, -520), P(-470, -400), P(-400, -260), P(-300, -170), P(-180, -90), P(-60, 0), P(40, 90), P(80, 120)],
    width0: 3,
    width1: 14,
    depth: 1.2,
  },
  areas: [
    { kind: 'meadow', points: [P(-460, 60), P(-260, -20), P(-60, 40), P(-60, 300), P(-120, 420), P(-380, 440), P(-500, 260)], soft: 30 },
    { kind: 'meadow', points: [P(-400, -380), P(-300, -400), P(-280, -320), P(-380, -300)], soft: 20 },
    { kind: 'rock', points: [P(500, -560), P(700, -560), P(720, 480), P(560, 480)], soft: 60 },
    { kind: 'beach', points: [P(180, 300), P(330, 290), P(360, 350), P(200, 380)], soft: 15 },
  ],
  viewpoints: [
    { name: 'Lake Shore', pos: { x: -70, z: 240, h: 1.7 }, look: { x: 150, z: 200, h: 0 } },
    { name: 'Meadow', pos: { x: -250, z: 200, h: 2 }, look: { x: -80, z: 120, h: 0.5 } },
    { name: 'Ridge Top', pos: { x: 600, z: -100, h: 4 }, look: { x: 0, z: 100, h: 0 } },
    { name: 'River Bend', pos: { x: -330, z: -150, h: 1.8 }, look: { x: -230, z: -110, h: 0 } },
    { name: 'Forest Floor', pos: { x: -450, z: 520, h: 1.6 }, look: { x: -420, z: 470, h: 1.2 } },
    { name: 'Beach', pos: { x: 260, z: 345, h: 1.7 }, look: { x: 120, z: 180, h: 0 } },
    { name: 'Rocky Knoll', pos: { x: -250, z: 350, h: 3 }, look: { x: 100, z: 200, h: 0 } },
    { name: 'Valley Overview', pos: { x: 0, z: 700, h: 140 }, look: { x: 0, z: 0, h: 0 } },
  ],
  homes: [
    { species: 'deer', count: 3, center: P(-200, 180), radius: 120, medium: 'land', prefer: ['meadow', 'forest'] },
    { species: 'rabbit', count: 3, center: P(-120, 260), radius: 60, medium: 'land', prefer: ['meadow'] },
    { species: 'fox', count: 2, center: P(-380, 300), radius: 120, medium: 'land', prefer: ['forest', 'meadow'] },
    { species: 'wolf', count: 2, center: P(-500, -250), radius: 160, medium: 'land', prefer: ['forest'] },
    { species: 'hawk', count: 1, center: P(-150, 150), radius: 200, medium: 'air', prefer: ['meadow'] },
    { species: 'duck', count: 2, center: P(150, 200), radius: 140, medium: 'water', prefer: ['shore'] },
    { species: 'trout', count: 2, center: P(150, 200), radius: 150, medium: 'water', prefer: [] },
    { species: 'trout', count: 1, center: P(-180, -90), radius: 60, medium: 'water', prefer: [] },
    { species: 'frog', count: 2, center: P(-45, 200), radius: 30, medium: 'shore', prefer: ['shore', 'meadow'] },
  ],
};
