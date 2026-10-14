import { describe, expect, it } from 'vitest';
import { strandShadeCPU } from '../../src/skin/fur-light';
import { norm, v3 } from '../../src/util/vec';

const T = v3(1, 0, 0), N = v3(0, 1, 0), V = v3(0, 1, 0);
const deg = Math.PI / 180;
const at = (theta: number, sheen = 1) => strandShadeCPU({ T, N, V, L: v3(Math.sin(theta * deg), Math.cos(theta * deg), 0), t: 0.5, sheen });
/** θ from −80° to 80° in 1° steps, with the shading at each. */
const sweep = (sheen = 1) => Array.from({ length: 161 }, (_, k) => ({ theta: k - 80, ...at(k - 80, sheen) }));
const peak = (rows: ReturnType<typeof sweep>, key: 'spec1' | 'spec2') => rows.reduce((b, r) => (r[key] > b[key] ? r : b));

describe('strandShadeCPU', () => {
  it('has two specular lobes shifted apart, both strong', () => {
    const rows = sweep(), p1 = peak(rows, 'spec1'), p2 = peak(rows, 'spec2');
    expect(Math.abs(p1.theta - p2.theta)).toBeGreaterThanOrEqual(5);
    expect(p1.spec1).toBeGreaterThan(0.5);
    expect(p2.spec2).toBeGreaterThan(0.5);
  });

  it('has a broader secondary lobe', () => {
    const rows = sweep();
    const wide = (key: 'spec1' | 'spec2') => {
      const top = peak(rows, key)[key];
      return rows.filter((r) => r[key] > 0.5 * top).length;
    };
    expect(wide('spec2')).toBeGreaterThan(wide('spec1'));
  });

  it('wraps the diffuse past the terminator, then goes dark', () => {
    expect(at(101.5).diffuse).toBeGreaterThan(0); // N·L ≈ −0.2
    expect(at(120).diffuse).toBe(0); // N·L = −0.5
  });

  it('glows when the light is behind the strand, not when it is behind the viewer', () => {
    const L = norm(v3(0.3, -0.95, 0));
    expect(strandShadeCPU({ T, N, L: V, V, t: 0.5, sheen: 1 }).back).toBe(0);
    expect(strandShadeCPU({ T, N, L, V: norm(v3(-0.3, 0.95, 0)), t: 0.5, sheen: 1 }).back).toBeGreaterThan(0);
  });

  it('has no specular or backlight without sheen, and the same diffuse', () => {
    const L = norm(v3(0.3, -0.95, 0)), Vb = norm(v3(-0.3, 0.95, 0));
    for (const [l, v] of [[v3(Math.sin(10 * deg), Math.cos(10 * deg), 0), V], [L, Vb]]) {
      const lit = strandShadeCPU({ T, N, L: l, V: v, t: 0.5, sheen: 1 }), dull = strandShadeCPU({ T, N, L: l, V: v, t: 0.5, sheen: 0 });
      expect(dull.spec1).toBe(0);
      expect(dull.spec2).toBe(0);
      expect(dull.back).toBe(0);
      expect(dull.diffuse).toBe(lit.diffuse);
    }
  });
});
