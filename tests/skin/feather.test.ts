import { describe, expect, it } from 'vitest';
import { FEATHER, featherAtCPU, featherCell } from '../../src/skin/coat';
import { add, cross, dot, norm, scale, v3, type Vec3 } from '../../src/util/vec';

describe('featherCell', () => {
  it('is half the fur length, clamped to 6 mm … 25 mm', () => {
    expect(featherCell(0.01)).toBeCloseTo(0.006, 10);
    expect(featherCell(0.03)).toBeCloseTo(0.015, 10);
    expect(featherCell(1)).toBeCloseTo(0.025, 10);
    expect(featherCell(0)).toBeCloseTo(0.006, 10);
  });
});

/** Samples a 40 × 40 grid over 5 cells of the plane through `o` with normal `n`, the groom `g` lying in it. */
function sampleGrid(n: Vec3, g: Vec3, o: Vec3, cell: number) {
  const b = cross(n, g);
  const out: { p: Vec3; f: ReturnType<typeof featherAtCPU> }[] = [];
  for (let i = 0; i < 40; i++)
    for (let j = 0; j < 40; j++) {
      const p = add(o, add(scale(g, ((i + 0.5) / 40) * 5 * cell), scale(b, ((j + 0.5) / 40) * 5 * cell)));
      out.push({ p, f: featherAtCPU(p, g, n, cell) });
    }
  return out;
}

describe('featherAtCPU', () => {
  const cell = featherCell(0.03);
  const n = v3(0, 1, 0), g = v3(0, 0, -1);
  const flat = sampleGrid(n, g, v3(0.013, 0.004, 0.021), cell);
  /** How far downstream (along the groom) a feather's root lies: from u, the point and the span. */
  const rootAlong = (p: Vec3, u: number) => dot(p, g) - u * FEATHER.span * cell;

  it('covers a flat plane with no holes, u and v in range', () => {
    for (const { f } of flat) {
      expect(f).not.toBeNull();
      expect(f!.u).toBeGreaterThanOrEqual(0);
      expect(f!.u).toBeLessThanOrEqual(1);
      expect(f!.v).toBeGreaterThanOrEqual(0);
      expect(f!.v).toBeLessThan(1);
    }
  });

  it('changes feather in ordered rows along the groom (a point 0.3 cell downstream shows the same feather or a later one)', () => {
    let ordered = 0, changed = 0;
    for (const { p, f } of flat) {
      const q = add(p, scale(g, 0.3 * cell));
      const h = featherAtCPU(q, g, n, cell)!;
      if (h.id !== f!.id) changed++;
      if (h.id === f!.id || rootAlong(q, h.u) >= rootAlong(p, f!.u) - 1e-9) ordered++;
    }
    expect(changed).toBeGreaterThan(flat.length * 0.08); // the rows really do change along the groom
    // a few samples per thousand step back a row where a feather narrows to its tip beside a wider one's root
    expect(ordered / flat.length).toBeGreaterThanOrEqual(0.99);
  });

  it('shows mostly feather tips, each lying over the root of the next row (the frontmost is rooted furthest upstream)', () => {
    const meanU = flat.reduce((s, x) => s + x.f!.u, 0) / flat.length;
    expect(meanU).toBeGreaterThan(0.5);
  });

  it('covers a slanted surface too', () => {
    const n2 = norm(v3(0.4, 1, 0.3)), g0 = v3(0.3, -0.2, -1);
    const g2 = norm(add(g0, scale(n2, -dot(g0, n2))));
    const s = sampleGrid(n2, g2, v3(0.05, -0.02, 0.11), cell);
    expect(s.filter((x) => x.f === null).length).toBeLessThanOrEqual(s.length * 0.002);
  });

  it('is null where the groom has no direction along the surface', () => {
    expect(featherAtCPU(v3(0.01, 0, 0.02), v3(0, 1, 0), v3(0, 1, 0), cell)).toBeNull();
    expect(featherAtCPU(v3(0.01, 0, 0.02), v3(0, 0, 0), v3(0, 1, 0), cell)).toBeNull();
  });

  it('is deterministic', () => {
    const p = v3(0.0123, 0.0456, -0.0789);
    expect(featherAtCPU(p, g, n, cell)).toEqual(featherAtCPU(p, g, n, cell));
  });
});
