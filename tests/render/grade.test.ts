import { describe, expect, it } from 'vitest';
import { NEUTRAL_GRADE, STUDIO_GRADE, easeGrade, gradeCPU, mixGrade, mixGradeInto, type Grade, type RGB } from '../../src/render/grade';

const COLOURS: RGB[] = [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.9, 0.2, 0.1], [0.05, 0.6, 0.95], [0.33, 0.71, 0.12]];

describe('gradeCPU', () => {
  it('leaves colours as they are under the neutral grade', () => {
    for (const c of COLOURS) {
      const out = gradeCPU(c, NEUTRAL_GRADE);
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - c[i])).toBeLessThan(1e-6);
    }
  });

  it('turns colours grey (each channel the luma) at saturation 0', () => {
    for (const c of COLOURS) {
      const out = gradeCPU(c, { ...NEUTRAL_GRADE, saturation: 0 });
      const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(y, 6);
    }
  });

  it('warms grey towards red and away from blue when warmth is positive', () => {
    const out = gradeCPU([0.5, 0.5, 0.5], { ...NEUTRAL_GRADE, warmth: 1 });
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[2]).toBeLessThan(0.5);
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it('darkens the corners with the vignette, not the centre', () => {
    const g = { ...NEUTRAL_GRADE, vignette: 0.5 };
    const grey: RGB = [0.6, 0.6, 0.6];
    expect(gradeCPU(grey, g, [0.5, 0.5])[0]).toBeCloseTo(0.6, 6);
    expect(gradeCPU(grey, g)[0]).toBeCloseTo(0.6, 6); // the default position is the centre
    expect(gradeCPU(grey, g, [0, 0])[0]).toBeLessThan(0.5);
  });

  it('stays within 0..1 for extreme settings', () => {
    const wild: Grade[] = [
      { warmth: 5, tint: -5, lift: [0.5, -0.5, 1], gamma: [0.2, 3, 5], gain: [3, 0.1, 2], contrast: 3, saturation: 3, vibrance: 2, vignette: 2 },
      { warmth: -5, tint: 5, lift: [-1, -1, -1], gamma: [5, 5, 5], gain: [0, 4, 1], contrast: -2, saturation: -1, vibrance: -2, vignette: -1 },
    ];
    for (const g of wild) for (const c of COLOURS) for (const uv of [[0, 0], [0.5, 0.5], [1, 0.3]] as [number, number][]) {
      for (const v of gradeCPU(c, g, uv)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the studio grade', () => {
  it('is the neutral grade with a little contrast and a soft vignette', () => {
    expect(STUDIO_GRADE).toEqual({ ...NEUTRAL_GRADE, contrast: 1.03, vignette: 0.1 });
  });
});

describe('mixGrade', () => {
  const b: Grade = { warmth: 0.5, tint: -0.2, lift: [0.02, 0.01, 0], gamma: [1.1, 1, 0.9], gain: [1.05, 1, 0.95], contrast: 1.1, saturation: 0.9, vibrance: 0.2, vignette: 0.3 };
  it('gives a at 0 and b at 1', () => {
    expect(mixGrade(NEUTRAL_GRADE, b, 0)).toEqual(NEUTRAL_GRADE);
    expect(mixGrade(NEUTRAL_GRADE, b, 1)).toEqual(b);
  });
  it('goes halfway at 0.5', () => {
    const m = mixGrade(NEUTRAL_GRADE, b, 0.5);
    expect(m.warmth).toBeCloseTo(0.25);
    expect(m.gamma[2]).toBeCloseTo(0.95);
    expect(m.contrast).toBeCloseTo(1.05);
  });
  it('mixes into a grade it is given, reusing its arrays, the same as mixGrade', () => {
    const out: Grade = { ...STUDIO_GRADE, lift: [9, 9, 9], gamma: [9, 9, 9], gain: [9, 9, 9] };
    const arrays = [out.lift, out.gamma, out.gain];
    for (const t of [0, 0.3, 0.5, 1]) {
      expect(mixGradeInto(out, NEUTRAL_GRADE, b, t)).toBe(out);
      expect(out).toStrictEqual(mixGrade(NEUTRAL_GRADE, b, t));
      [out.lift, out.gamma, out.gain].forEach((a, i) => expect(a).toBe(arrays[i]));
    }
  });
});

describe('easeGrade', () => {
  const to: Grade = { warmth: 0.5, tint: -0.2, lift: [0.02, 0.01, 0], gamma: [1.1, 1, 0.9], gain: [1.05, 1, 0.95], contrast: 1.1, saturation: 0.9, vibrance: 0.2, vignette: 0.3 };
  const copy = (g: Grade): Grade => ({ ...g, lift: [...g.lift], gamma: [...g.gamma], gain: [...g.gain] });
  /** Every field as one flat list. */
  const flat = (g: Grade) => [g.warmth, g.tint, ...g.lift, ...g.gamma, ...g.gain, g.contrast, g.saturation, g.vibrance, g.vignette];

  it('leaves the grade bit-identical at dt = 0, however often (a paused valley)', () => {
    const g = copy(STUDIO_GRADE), before = flat(g);
    for (let i = 0; i < 100; i++) easeGrade(g, to, 0, 1.5);
    expect(flat(g)).toEqual(before);
  });
  it('reaches the target at dt = Infinity (a snap)', () => {
    const g = copy(NEUTRAL_GRADE);
    easeGrade(g, to, Infinity, 1.5);
    flat(g).forEach((v, i) => expect(v).toBeCloseTo(flat(to)[i], 12));
  });
  it('goes 1 − 1/e of the way in one time constant, in place, without touching the target', () => {
    const g = copy(NEUTRAL_GRADE), lift = g.lift, target = flat(to);
    easeGrade(g, to, 1.5, 1.5);
    expect(g.lift).toBe(lift);
    expect(g.warmth).toBeCloseTo(0.5 * (1 - Math.exp(-1)), 12);
    expect(flat(to)).toEqual(target);
  });
});
