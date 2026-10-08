import { describe, it, expect, beforeAll } from 'vitest';
import { VALLEY } from '../../src/valley/layout';
import { baseShape, sampleHeight, type HeightGrid } from '../../src/valley/generate/shape';
import { erode } from '../../src/valley/generate/erosion';
import { carveWater, onCourse, type RiverSample, type WaterMaps } from '../../src/valley/generate/carve';
import { buildPolylineIndex, nearestOnPolyline, pointInPolygon, sdPolygon } from '../../src/valley/geom';
import { hashNumbers } from '../../src/util/hash';
import { mulberry32 } from '../../src/util/rng';

const GRID = 513;
const level = VALLEY.lake.level;

describe('carveWater', () => {
  let eroded: HeightGrid, g: HeightGrid, river: RiverSample[], water: WaterMaps;
  beforeAll(() => {
    eroded = baseShape(VALLEY, GRID);
    erode(eroded, VALLEY.seed);
    g = { ...eroded, h: Float32Array.from(eroded.h) };
    ({ river, water } = carveWater(g, VALLEY));
  }, 60000);

  const xz = (ix: number, iz: number, grid: HeightGrid) => ({ x: -grid.size / 2 + ix * grid.cell, z: -grid.size / 2 + iz * grid.cell });

  it('samples the river every 2 m with widths growing downstream', () => {
    expect(river.length).toBeGreaterThan(300);
    expect(river[0].width).toBeCloseTo(VALLEY.river.width0, 5);
    expect(river[river.length - 1].width).toBeCloseTo(VALLEY.river.width1, 5);
    for (let k = 1; k < river.length - 1; k++) expect(river[k].s - river[k - 1].s).toBeCloseTo(2, 5);
    for (const r of river) expect(Math.hypot(r.tx, r.tz)).toBeCloseTo(1, 4);
  });

  it('runs downhill into the lake: surface never rises and ends at the lake level', () => {
    for (let k = 1; k < river.length; k++) expect(river[k].surface).toBeLessThanOrEqual(river[k - 1].surface);
    expect(river[river.length - 1].surface).toBe(level);
    for (const r of river) {
      expect(r.surface).toBeGreaterThanOrEqual(level);
      expect(r.slope).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the bed below the water surface all along the river', () => {
    // The narrow headwaters (3 m) are about one cell wide on this coarse test grid (at the full 2049 grid every sample passes), so the bilinear bed can miss the channel there.
    const wide = river.filter((r) => r.width >= 1.25 * g.cell);
    expect(wide.length).toBeGreaterThan(river.length * 0.9);
    for (const r of wide) expect(sampleHeight(g, r.x, r.z)).toBeLessThan(r.surface);
  });

  it('keeps the banks above the water all the way down, on side slopes and by the lake too', () => {
    const index = buildPolylineIndex(river.map((r) => ({ p: { x: r.x, z: r.z }, s: r.s, t: { x: r.tx, z: r.tz } })));
    let n = 0, worst = Infinity;
    for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) {
      const p = xz(ix, iz, g);
      if (p.x < -620 || p.x > 120 || p.z < -560 || p.z > 160) continue; // the river's box
      if (sdPolygon(p, VALLEY.lake.outline) < 0) continue; // lake water there
      const k = nearestOnPolyline(p, index).i, q = onCourse(p, river, k);
      if (q.d < q.width / 2 + 0.5 || q.d > q.width / 2 + 3) continue; // the first 3 m of bank
      n++;
      worst = Math.min(worst, g.h[iz * GRID + ix] - q.surface);
    }
    expect(n).toBeGreaterThan(200);
    expect(worst).toBeGreaterThan(0);
  });

  it('sinks every cell inside the lake outline below the water, 0.3 m and more once 3.5 m in', () => {
    let n = 0;
    for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) {
      const p = xz(ix, iz, g);
      if (!pointInPolygon(p, VALLEY.lake.outline)) continue;
      n++;
      expect(g.h[iz * GRID + ix]).toBeLessThan(level - 0.0199);
      if (sdPolygon(p, VALLEY.lake.outline) < -3.5) expect(g.h[iz * GRID + ix]).toBeLessThan(level - 0.299);
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('runs the ground through the shore line without a step (so the water meets it in a clean line)', () => {
    let n = 0;
    for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) {
      const p = xz(ix, iz, g), sd = sdPolygon(p, VALLEY.lake.outline);
      if (Math.abs(sd) > 0.6 || river.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < r.width / 2 + 3)) continue;
      n++;
      expect(Math.abs(g.h[iz * GRID + ix] - level)).toBeLessThan(0.1);
    }
    expect(n).toBeGreaterThan(50);
  });

  it('keeps every dry map cell above the waterline', () => {
    const m = water.mapGrid;
    expect(m).toBe((GRID - 1) / 2 + 1);
    let dry = 0, lake = 0, rivr = 0;
    for (let iz = 0; iz < m; iz++) for (let ix = 0; ix < m; ix++) {
      const c = iz * m + ix, k = water.kind[c];
      if (k === 0) {
        dry++;
        expect(Number.isNaN(water.level[c])).toBe(true);
        expect(g.h[2 * iz * GRID + 2 * ix]).toBeGreaterThanOrEqual(level + 0.0199);
      } else if (k === 1) {
        lake++;
        expect(water.level[c]).toBe(level);
        expect(water.flow[2 * c]).toBe(0);
        expect(water.flow[2 * c + 1]).toBe(0);
      } else {
        rivr++;
        expect(water.level[c]).toBeGreaterThanOrEqual(level);
        const sp = Math.hypot(water.flow[2 * c], water.flow[2 * c + 1]);
        expect(sp).toBeGreaterThanOrEqual(0.4 - 1e-4);
        expect(sp).toBeLessThanOrEqual(2.5 + 1e-4);
      }
    }
    expect(dry).toBeGreaterThan(m * m * 0.9);
    expect(lake).toBeGreaterThan(100);
    expect(rivr).toBeGreaterThan(100);
  });

  it('gives the lake gentle shores', () => {
    const rng = mulberry32(7), near: number[] = [];
    for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) {
      if (water.kind[(iz >> 1) * water.mapGrid + (ix >> 1)] !== 0) continue;
      const sd = sdPolygon(xz(ix, iz, g), VALLEY.lake.outline);
      if (sd > 0 && sd < 30) near.push(iz * GRID + ix);
    }
    expect(near.length).toBeGreaterThan(500);
    for (let i = 0; i < 500; i++) expect(g.h[near[Math.floor(rng() * near.length)]]).toBeLessThan(level + 0.02 + 30 * 0.12 + 0.01);
  });

  it('is deterministic', () => {
    const g2: HeightGrid = { ...eroded, h: Float32Array.from(eroded.h) };
    const r2 = carveWater(g2, VALLEY);
    expect(hashNumbers(g2.h)).toBe(hashNumbers(g.h));
    expect(hashNumbers(r2.water.level)).toBe(hashNumbers(water.level));
    expect(r2.river.length).toBe(river.length);
  });
});

describe('onCourse', () => {
  // a straight course along +x, falling 0.1 m per 2 m sample and widening by 0.2 m
  const course: RiverSample[] = Array.from({ length: 5 }, (_, k) => ({ x: 2 * k, z: 0, s: 2 * k, surface: 5 - 0.1 * k, width: 3 + 0.2 * k, slope: 0.05, tx: 1, tz: 0 }));
  it('measures the distance square to the course, not to the nearest sample', () => {
    const q = onCourse({ x: 3, z: 0.5 }, course, 1); // halfway between samples 1 and 2
    expect(q.d).toBeCloseTo(0.5, 9);
    expect(q.surface).toBeCloseTo(4.85, 9);
    expect(q.width).toBeCloseTo(3.3, 9);
  });
  it('works from either neighbouring sample and clamps at the ends', () => {
    expect(onCourse({ x: 3, z: -1 }, course, 2).surface).toBeCloseTo(4.85, 9);
    const end = onCourse({ x: 9, z: 0 }, course, 4);
    expect(end.d).toBeCloseTo(1, 9);
    expect(end.surface).toBeCloseTo(4.6, 9);
    expect(onCourse({ x: -2, z: 0 }, course, 0).surface).toBeCloseTo(5, 9);
  });
});
