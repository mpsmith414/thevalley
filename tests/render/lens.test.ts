import { describe, expect, it } from 'vitest';
import type { RGB } from '../../src/render/grade';
import { FOG_END, lensColourCPU, lensUniforms, setLens, underwaterCPU, underwaterFog, waterLight, type LensUniforms } from '../../src/render/lens';
import type { LightState } from '../../src/world/lighting';
import { NO_LENS, type Lens } from '../../src/views/lens';

const COLOURS: RGB[] = [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.9, 0.2, 0.1], [0.05, 0.6, 0.95], [0.33, 0.71, 0.12]];

/** The colour's hue (degrees, 0..360), as HSV has it. */
function hue([r, g, b]: RGB): number {
  const hi = Math.max(r, g, b), d = hi - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
/** HSV saturation. */
const saturation = (c: RGB) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);

describe('lensColourCPU', () => {
  it('leaves every colour as it is with no lens', () => {
    for (const c of COLOURS) expect(lensColourCPU(c, NO_LENS)).toEqual(c);
  });

  it('leaves every colour as it is with normal colour sight by day, whatever the width', () => {
    const wide: Lens = { ...NO_LENS, hfov: 112, barrel: 0.05, sideBlur: 0.9 };
    for (const c of COLOURS) lensColourCPU(c, wide).forEach((v, i) => expect(v).toBeCloseTo(c[i], 6));
  });

  it('muted: folds red and green toward the same yellows, and keeps blue apart', () => {
    const muted: Lens = { ...NO_LENS, colour: 'muted' };
    const red = lensColourCPU([1, 0, 0], muted), green = lensColourCPU([0, 1, 0], muted), blue = lensColourCPU([0, 0, 1], muted);
    expect(hueGap(hue([1, 0, 0]), hue([0, 1, 0]))).toBeCloseTo(120, 6); // as we see them
    expect(hueGap(hue(red), hue(green))).toBeLessThan(30);
    expect(hueGap(hue(blue), hue(red))).toBeGreaterThan(90);
    expect(hueGap(hue(blue), hue(green))).toBeGreaterThan(90);
  });

  it('vivid: makes a dull orange richer', () => {
    const c: RGB = [0.6, 0.4, 0.3], out = lensColourCPU(c, { ...NO_LENS, colour: 'vivid' });
    expect(saturation(out)).toBeGreaterThan(saturation(c));
  });

  it('vivid: lifts the shadows faintly toward violet', () => {
    const out = lensColourCPU([0.05, 0.05, 0.05], { ...NO_LENS, colour: 'vivid' });
    expect(out[2]).toBeGreaterThan(out[1]);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[2] - 0.05).toBeLessThan(0.05);
  });

  it('night: a cooler, greyer picture', () => {
    const c: RGB = [0.6, 0.4, 0.3], out = lensColourCPU(c, { ...NO_LENS, night: 1 });
    expect(saturation(out)).toBeLessThan(saturation(c));
    expect(out[2] / out[0]).toBeGreaterThan(c[2] / c[0]);
  });

  it('stays within 0..1', () => {
    const lenses: Lens[] = [{ ...NO_LENS, colour: 'muted', night: 1 }, { ...NO_LENS, colour: 'vivid', night: 1 }];
    for (const l of lenses) for (const c of COLOURS) for (const v of lensColourCPU(c, l)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('setLens', () => {
  const lens: Lens = { hfov: 104, barrel: 0.03, sideBlur: 0.5, soften: 0.2, sharpen: 0.4, colour: 'muted', night: 1, exposure: 1.2, grain: 0.025, underwater: 1 };
  // the strengths only: not the grain's seed, nor where the water's surface is and the light on it (set by the valley, not
  // the lens), nor the fear pulse's edge (the Fear sense's)
  const values = (u: LensUniforms) =>
    Object.fromEntries(Object.entries(u).filter(([k]) => !['seed', 'surface', 'waterLight', 'edge'].includes(k)).map(([k, v]) => [k, v.value]));

  it('puts no lens in as all strengths 0', () => {
    const u = lensUniforms();
    setLens(u, NO_LENS, 1);
    expect(Object.values(values(u)).every((v) => v === 0)).toBe(true);
  });

  it('puts any lens in as all strengths 0 at the start of its ease, and in full at the end', () => {
    const u = lensUniforms();
    setLens(u, lens, 0);
    expect(Object.values(values(u)).every((v) => v === 0)).toBe(true);
    setLens(u, lens, 1);
    expect(values(u)).toEqual({ barrel: 0.03, sideBlur: 0.5, soften: 0.2, sharpen: 0.4, muted: 0.85, vivid: 0, night: 1, exposure: 1.2, grain: 0.025, underwater: 1 });
    setLens(u, lens, 0.5);
    expect(u.exposure.value).toBeCloseTo(0.6, 12);
    expect(u.muted.value).toBeCloseTo(0.425, 12);
  });

  it('leaves the fear pulse’s edge alone (off at the start)', () => {
    const u = lensUniforms();
    expect(u.edge.value).toBe(0);
    u.edge.value = 0.3;
    setLens(u, lens, 1);
    setLens(u, NO_LENS, 0);
    expect(u.edge.value).toBe(0.3);
  });
});

describe('underwaterCPU', () => {
  const light: RGB = [1, 1, 1], fog = underwaterFog(light);
  const near = (a: RGB, b: RGB, digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

  it('the fog is green-blue, and lit by the light on the water', () => {
    expect(fog[1]).toBeGreaterThan(fog[0]);
    expect(fog[2]).toBeGreaterThan(fog[0]);
    near(underwaterFog([0.5, 0.5, 0.5]), fog.map((v) => v / 2) as RGB, 12);
  });

  it('a far pixel (12 m and more) is the fog colour', () => {
    expect(FOG_END).toBe(12);
    for (const d of [12, 20, 7000]) for (const c of COLOURS) near(underwaterCPU(c, d, 1, light), fog);
  });

  it('a near one keeps most of its own colour', () => {
    for (const c of [[0.6, 0.5, 0.4], [0.9, 0.2, 0.1], [0.05, 0.6, 0.95], [1, 1, 1]] as RGB[]) {
      underwaterCPU(c, 0.5, 1, light).forEach((v, i) => {
        expect(v).toBeGreaterThan(0.6 * c[i]);
        expect(v).toBeLessThan(c[i] + 0.05);
      });
    }
  });

  it('thickens with distance', () => {
    const c: RGB = [0.9, 0.2, 0.1], gap = (d: number) => Math.abs(underwaterCPU(c, d, 1, light)[0] - fog[0]);
    for (let d = 0; d < 12; d += 0.5) expect(gap(d + 0.5)).toBeLessThan(gap(d));
  });

  it('passes every colour through out of the water', () => {
    for (const d of [0.5, 5, 7000]) for (const c of COLOURS) expect(underwaterCPU(c, d, 0, light)).toEqual(c);
  });
});

describe('waterLight', () => {
  const state = (keyDirY: number) => ({ keyColor: '#ffffff', keyIntensity: 3, keyDir: { x: 0, y: keyDirY, z: 0 }, skyColor: '#ffffff', hemiIntensity: 0.5 }) as LightState;

  it('is the key light from above and the sky light, as the water has it', () => {
    expect(waterLight(state(1)).x).toBeCloseTo((3 + 0.5) / Math.PI, 6);
    expect(waterLight(state(0.5)).y).toBeCloseTo((1.5 + 0.5) / Math.PI, 6);
  });

  it('is the sky light alone with the key below the horizon', () => {
    expect(waterLight(state(-0.3)).z).toBeCloseTo(0.5 / Math.PI, 6);
  });
});
