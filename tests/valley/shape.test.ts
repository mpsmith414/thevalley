import { describe, it, expect } from 'vitest';
import { VALLEY } from '../../src/valley/layout';
import { baseShape, sampleHeight, type HeightGrid } from '../../src/valley/generate/shape';
import { erode } from '../../src/valley/generate/erosion';
import { hashNumbers } from '../../src/util/hash';

const GRID = 257;

/** East hills: the granite ridge runs x 560-650, so this box holds its steep, rocky flanks (the roughest terrain in the valley). */
const EAST = { x0: 480, x1: 720, z0: -300, z1: 300 };
type Box = typeof EAST;

/**
 * Mean slope (rise over run, to the next sample east or south) inside the box. Mean, not max: droplet erosion
 * cuts gullies, which can make the single steepest step steeper while the terrain as a whole gets gentler.
 */
function meanSlope(g: HeightGrid, box: Box): number {
  const half = g.size / 2;
  const i0 = Math.ceil((box.x0 + half) / g.cell), i1 = Math.floor((box.x1 + half) / g.cell);
  const j0 = Math.ceil((box.z0 + half) / g.cell), j1 = Math.floor((box.z1 + half) / g.cell);
  let sum = 0, n = 0;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const h = g.h[j * g.grid + i];
      sum += Math.max(Math.abs(g.h[j * g.grid + i + 1] - h), Math.abs(g.h[(j + 1) * g.grid + i] - h));
      n++;
    }
  return sum / n / g.cell;
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
  it('softens the east hills', () => {
    expect(meanSlope(e, EAST)).toBeLessThan(meanSlope(base, EAST));
  });
  it('wears a lone spike down', () => {
    const grid = 129, size = 800, cell = size / (grid - 1), h = new Float32Array(grid * grid);
    for (let j = 0; j < grid; j++)
      for (let i = 0; i < grid; i++) h[j * grid + i] = 40 * Math.exp(-((i - 64) ** 2 + (j - 64) ** 2) / 72);
    erode({ grid, size, cell, h }, 1, 4000);
    expect(h.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(40);
  });
});
