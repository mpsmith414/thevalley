import { describe, it, expect } from 'vitest';
import { VALLEY } from '../../src/valley/layout';
import { baseShape, sampleHeight, type HeightGrid } from '../../src/valley/generate/shape';
import { erode } from '../../src/valley/generate/erosion';
import { hashNumbers } from '../../src/util/hash';

const GRID = 257;

/** East hills: the granite ridge runs x 560-650, so this box holds its steep, rocky flanks (the roughest terrain in the valley). */
const EAST = { x0: 480, x1: 720, z0: -300, z1: 300 };
/** Lower east flank, where the hills drop to the valley: its high ground is the flank's shoulder and spurs. */
const FLANK = { x0: 380, x1: 500, z0: -300, z1: 300 };
type Box = typeof EAST;

/** Mean height of the highest `frac` of samples inside the box. */
function topMean(g: HeightGrid, box: Box, frac: number): number {
  const half = g.size / 2, v: number[] = [];
  const i0 = Math.ceil((box.x0 + half) / g.cell), i1 = Math.floor((box.x1 + half) / g.cell);
  const j0 = Math.ceil((box.z0 + half) / g.cell), j1 = Math.floor((box.z1 + half) / g.cell);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) v.push(g.h[j * g.grid + i]);
  v.sort((x, y) => y - x);
  const n = Math.max(1, Math.floor(v.length * frac));
  return v.slice(0, n).reduce((t, x) => t + x, 0) / n;
}

describe('baseShape', () => {
  const a = baseShape(VALLEY, GRID);
  it('has the right dimensions and is deterministic', () => {
    expect(a.grid).toBe(GRID);
    expect(a.size).toBe(1600);
    expect(a.cell).toBeCloseTo(1600 / (GRID - 1), 9);
    expect(a.h.length).toBe(GRID * GRID);
    expect(hashNumbers(baseShape(VALLEY, GRID).h)).toBe(hashNumbers(a.h));
  });
  it('is finite everywhere', () => {
    expect(a.h.every((v) => Number.isFinite(v))).toBe(true);
  });
  it('puts the valley centre well below the north ridge crest', () => {
    expect(sampleHeight(a, 0, -640) - sampleHeight(a, 0, 100)).toBeGreaterThan(100);
  });
  it('keeps the floor near (-200, 150) gentle', () => {
    const h = sampleHeight(a, -200, 150);
    expect(h).toBeGreaterThan(1);
    expect(h).toBeLessThan(15);
  });
  it('sampleHeight clamps to the border and is bilinear', () => {
    expect(sampleHeight(a, -5000, -5000)).toBe(a.h[0]);
    expect(sampleHeight(a, 5000, 5000)).toBe(a.h[GRID * GRID - 1]);
    const x = -800 + 10.5 * a.cell, z = -800 + 20 * a.cell;
    expect(sampleHeight(a, x, z)).toBeCloseTo((a.h[20 * GRID + 10] + a.h[20 * GRID + 11]) / 2, 4);
  });
});

describe('erode', () => {
  const base = baseShape(VALLEY, GRID);
  const run = () => {
    const g: HeightGrid = { ...base, h: base.h.slice() };
    erode(g, VALLEY.seed);
    return g;
  };
  const e = run();
  it('is deterministic', () => {
    expect(hashNumbers(run().h)).toBe(hashNumbers(e.h));
  });
  it('has no NaN', () => {
    expect(e.h.every((v) => Number.isFinite(v))).toBe(true);
  });
  it('actually changes the terrain, without drifting far', () => {
    let sumAbs = 0, sum = 0;
    for (let i = 0; i < e.h.length; i++) { const d = e.h[i] - base.h[i]; sumAbs += Math.abs(d); sum += d; }
    const n = e.h.length;
    expect(sumAbs / n).toBeGreaterThan(0.001);
    // Beyer erosion roughly conserves material, so the mean change is near zero rather than strictly negative.
    expect(sum / n).toBeGreaterThan(-1);
    expect(sum / n).toBeLessThan(0.05);
  });
  it('wears down the high ground on the east flank', () => {
    // Measured at grid 257: the flank's top 2% drops from 96.25 m to 95.79 m (0.46 m). Assert about a third of that.
    // (Mean slope is not asserted: gullies have steep walls, so it rises, 0.59 to 0.69 here and 0.83 to 0.85 across the east hills.)
    expect(topMean(base, FLANK, 0.02) - topMean(e, FLANK, 0.02)).toBeGreaterThan(0.15);
  });
  it('carves visible gullies in the hills (grid 513)', () => {
    // Thresholds are calibrated to grid 513 (3.1 m cells), where this measured 39.9% (east hills) and 37.8% (north ridge)
    // of cells lowered by more than 1 m, and a whole-grid mean |dh| of 1.36 m; the asserted floors are about a quarter of that.
    // At grid 2049 the cells are 4x smaller, so the same carving spreads thinner (mean |dh| 0.44 m over land, 26% / 21% lowered by over 1 m).
    const b = baseShape(VALLEY, 513), g: HeightGrid = { ...b, h: b.h.slice() };
    erode(g, VALLEY.seed);
    const half = b.size / 2, lowered = (x0: number, x1: number, z0: number, z1: number) => {
      let c = 0, t = 0;
      for (let j = 0; j < 513; j++) {
        const z = -half + j * b.cell;
        if (z < z0 || z > z1) continue;
        for (let i = 0; i < 513; i++) {
          const x = -half + i * b.cell;
          if (x < x0 || x > x1) continue;
          t++;
          if (b.h[j * 513 + i] - g.h[j * 513 + i] > 1) c++;
        }
      }
      return c / t;
    };
    expect(lowered(EAST.x0, EAST.x1, EAST.z0, EAST.z1)).toBeGreaterThan(0.1);
    expect(lowered(-400, 400, -760, -520)).toBeGreaterThan(0.1);
    let sum = 0;
    for (let i = 0; i < g.h.length; i++) sum += Math.abs(g.h[i] - b.h[i]);
    expect(sum / g.h.length).toBeGreaterThan(0.34);
  });
  it('wears a lone spike down', () => {
    // Measured: the 40 m peak falls to 31.7 m (8.3 m). Assert about a third of that.
    const grid = 129, size = 800, cell = size / (grid - 1), h = new Float32Array(grid * grid);
    for (let j = 0; j < grid; j++)
      for (let i = 0; i < grid; i++) h[j * grid + i] = 40 * Math.exp(-((i - 64) ** 2 + (j - 64) ** 2) / 72);
    erode({ grid, size, cell, h }, 1, 4000);
    expect(h.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(37.2);
  });
  it('rejects an even grid', () => {
    const g: HeightGrid = { grid: 4, size: 800, cell: 800 / 3, h: new Float32Array(16) };
    expect(() => erode(g, 1)).toThrow(/odd/);
  });
});
