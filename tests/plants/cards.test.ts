import { describe, it, expect } from 'vitest';
import { CARD_KINDS, bleed, cardStrokes, leafOutline, strokeBounds, type CardKind } from '../../src/plants/cards';

const count = (k: CardKind) => cardStrokes(k, 1).length;

describe('cardStrokes', () => {
  it('covers every leaf card kind and birch bark', () => {
    for (const k of ['pine', 'spruce', 'birch', 'alder', 'willow', 'juniper', 'blueberry', 'fern', 'birchBark'] as const) expect(CARD_KINDS).toContain(k);
  });

  it('gives the same strokes for the same kind and seed, and different ones for another seed', () => {
    for (const k of CARD_KINDS) {
      expect(cardStrokes(k, 7)).toEqual(cardStrokes(k, 7));
      expect(cardStrokes(k, 7)).not.toEqual(cardStrokes(k, 8));
    }
  });

  it('keeps every stroke inside the card', () => {
    for (const k of CARD_KINDS) for (const seed of [1, 2, 3, 99]) {
      const strokes = cardStrokes(k, seed);
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) {
        const b = strokeBounds(s);
        expect(b.x0, `${k} ${s.t}`).toBeGreaterThanOrEqual(0);
        expect(b.y0, `${k} ${s.t}`).toBeGreaterThanOrEqual(0);
        expect(b.x1, `${k} ${s.t}`).toBeLessThanOrEqual(1);
        expect(b.y1, `${k} ${s.t}`).toBeLessThanOrEqual(1);
        for (const v of s.rgb) expect(v >= 0 && v <= 255).toBe(true);
        expect(s.h >= 0 && s.h <= 1).toBe(true);
      }
    }
  });

  it('paints pine with many more strokes than birch, and spruce densest of all', () => {
    expect(count('pine')).toBeGreaterThan(4 * count('birch'));
    expect(count('spruce')).toBeGreaterThan(count('pine'));
  });

  it('draws leaves as leaves: birch, alder, willow, blueberry and fern have leaf strokes; pine and spruce only lines', () => {
    for (const k of ['birch', 'alder', 'willow', 'blueberry', 'fern'] as const) expect(cardStrokes(k, 1).some((s) => s.t === 'leaf'), k).toBe(true);
    for (const k of ['pine', 'spruce'] as const) expect(cardStrokes(k, 1).every((s) => s.t === 'line'), k).toBe(true);
    expect(cardStrokes('blueberry', 1).some((s) => s.t === 'dot')).toBe(true); // berries
  });

  it('makes willow leaves long and narrow and alder leaves round', () => {
    const ratio = (k: CardKind) => {
      const l = cardStrokes(k, 1).filter((s) => s.t === 'leaf');
      return l.reduce((a, s) => a + (s.t === 'leaf' ? s.wid / s.len : 0), 0) / l.length;
    };
    expect(ratio('willow')).toBeLessThan(0.25);
    expect(ratio('alder')).toBeGreaterThan(0.7);
  });
});

describe('leafOutline', () => {
  it('starts at the base, reaches the tip, and toothed leaves have a ragged edge', () => {
    const leaf = { t: 'leaf' as const, x: 0.5, y: 0.9, angle: -Math.PI / 2, len: 0.4, wid: 0.2, shape: 'ovate' as const, teeth: 0, rgb: [0, 0, 0] as [number, number, number], vein: [0, 0, 0] as [number, number, number], h: 0.5 };
    const p = leafOutline(leaf);
    const ys = p.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0.9, 5);
    expect(Math.min(...ys)).toBeCloseTo(0.5, 5);
    const xs = p.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.2, 1);
    // teeth: the outline's x wiggles back and forth along the edge
    const turns = (pts: number[]) => {
      let n = 0;
      for (let i = 2; i < pts.length / 2 / 2 - 1; i++) {
        const a = pts[2 * i] - pts[2 * i - 2], b = pts[2 * i + 2] - pts[2 * i];
        if (a * b < 0) n++;
      }
      return n;
    };
    expect(turns(leafOutline({ ...leaf, teeth: 14 }))).toBeGreaterThan(turns(p) + 6);
  });
});

describe('bleed', () => {
  it('gives fully transparent pixels the average colour of the opaque ones, so mipmaps do not darken the edges', () => {
    const d = new Uint8ClampedArray([100, 200, 50, 255, 0, 0, 0, 0, 120, 180, 70, 255, 0, 0, 0, 0]);
    bleed(d);
    expect([...d.slice(4, 8)]).toEqual([110, 190, 60, 0]);
    expect([...d.slice(0, 4)]).toEqual([100, 200, 50, 255]);
  });
});
