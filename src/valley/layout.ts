import { mulberry32, between } from '../util/rng';
import type { Layout, Pt } from './types';

const P = (x: number, z: number): Pt => ({ x, z });
const SEED = 20261007;

/**
 * The lake shore: a 16-point ellipse with seeded radial wobble (±8 m), smoothed by a closed Catmull-Rom into 96 points,
 * plus a low-frequency radial wobble (a few seeded harmonics, ±12 m at most), so it reads as a natural shoreline.
 */
function lakeOutline(cx: number, cz: number, rx: number, rz: number): Pt[] {
  const rng = mulberry32(SEED ^ 0x1a4e);
  const ctrl = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return P(cx + (rx * Math.cos(a)) + between(rng, -8, 8), cz + (rz * Math.sin(a)) + between(rng, -8, 8));
  });
  const waves = [2, 3, 5].map((k) => ({ k, amp: between(rng, 2, 4.5), phase: between(rng, 0, Math.PI * 2) })); // amplitudes sum to at most 13.5
  const scale = 12 / Math.max(12, waves.reduce((s, w) => s + w.amp, 0));
  const N = 96, per = N / 16;
  return Array.from({ length: N }, (_, j) => {
    const i = Math.floor(j / per), t = j / per - i;
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((o) => ctrl[(i + o + 16) % 16]);
    const f = (a: number, b: number, c: number, d: number) =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    const x = f(p0.x, p1.x, p2.x, p3.x), z = f(p0.z, p1.z, p2.z, p3.z), a = Math.atan2((z - cz) / rz, (x - cx) / rx);
    const w = scale * waves.reduce((s, v) => s + v.amp * Math.sin(v.k * a + v.phase), 0), r = Math.hypot(x - cx, z - cz) || 1;
    return P(x + ((x - cx) / r) * w, z + ((z - cz) / r) * w);
  });
}

/** The hand-authored Valley: where the ridges, lake, river, areas, viewpoints and animal homes go. */
export const VALLEY: Layout = {
  seed: SEED,
  size: 1600,
  floor: 3,
  rim: 60,
  ridges: [
    { points: [P(-800, -720), P(-420, -650), P(-120, -690), P(180, -600), P(500, -690), P(800, -640)], height: 136, width: 320, rocky: 0.4 },
    { points: [P(-760, -600), P(-740, -250), P(-770, 100), P(-690, 430), P(-720, 700)], height: 112, width: 280, rocky: 0.3 },
    { points: [P(560, -560), P(640, -330), P(600, -100), P(560, 120), P(660, 430)], height: 120, width: 250, rocky: 0.9 },
    { points: [P(-267, 310), P(-233, 390)], height: 36, width: 90, rocky: 0.8 },
    { points: [P(-700, 760), P(-250, 720), P(200, 780), P(700, 740)], height: 56, width: 240, rocky: 0.2 },
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
    { kind: 'beach', points: [P(170, 300), P(340, 285), P(385, 365), P(195, 405)], soft: 15 },
  ],
  viewpoints: [
    { name: 'Lake Shore', pos: { x: -70, z: 240, h: 1.7 }, look: { x: 150, z: 200, h: 0 } },
    { name: 'Meadow', pos: { x: -250, z: 200, h: 2 }, look: { x: -80, z: 120, h: 0.5 } },
    { name: 'Ridge Top', pos: { x: 600, z: -100, h: 4 }, look: { x: 0, z: 100, h: 0 } },
    { name: 'River Bend', pos: { x: -345, z: -205, h: 2 }, look: { x: -180, z: -90, h: 0 } }, // on the stream, looking downstream
    { name: 'Forest Floor', pos: { x: -450, z: 520, h: 1.6 }, look: { x: -420, z: 470, h: 1.2 } },
    { name: 'Beach', pos: { x: 260, z: 345, h: 1.7 }, look: { x: 120, z: 180, h: 0 } },
    { name: 'Rocky Knoll', pos: { x: -250, z: 350, h: 3 }, look: { x: 100, z: 200, h: 0 } },
    { name: 'Valley Overview', pos: { x: 0, z: 700, h: 140 }, look: { x: 0, z: 0, h: 0 } },
  ],
  homes: [
    { species: 'deer', count: 3, center: P(-185, 175), radius: 65, medium: 'land', prefer: ['meadow', 'forest'] },
    { species: 'rabbit', count: 3, center: P(-210, 190), radius: 30, medium: 'land', prefer: ['meadow'] },
    { species: 'fox', count: 2, center: P(-380, 300), radius: 120, medium: 'land', prefer: ['forest', 'meadow'] },
    { species: 'wolf', count: 2, center: P(-500, -250), radius: 160, medium: 'land', prefer: ['forest'] },
    { species: 'hawk', count: 1, center: P(-150, 150), radius: 200, medium: 'air', prefer: ['meadow'] },
    { species: 'duck', count: 2, center: P(150, 200), radius: 140, medium: 'water', prefer: ['shore'] },
    { species: 'trout', count: 2, center: P(150, 200), radius: 150, medium: 'water', prefer: [] },
    { species: 'trout', count: 1, center: P(-180, -90), radius: 60, medium: 'water', prefer: [] },
    { species: 'frog', count: 2, center: P(-45, 200), radius: 30, medium: 'shore', prefer: ['shore', 'meadow'] },
  ],
};
