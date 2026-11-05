import { describe, expect, it } from 'vitest';
import { deer } from '../../src/cast/deer';
import { duck } from '../../src/cast/duck';
import { fox } from '../../src/cast/fox';
import { frog } from '../../src/cast/frog';
import { hawk } from '../../src/cast/hawk';
import { rabbit } from '../../src/cast/rabbit';
import { trout } from '../../src/cast/trout';
import { wolf } from '../../src/cast/wolf';
import type { Recipe } from '../../src/recipe/schema';
import { NO_LENS, lensFor } from '../../src/views/lens';

const day = (r: Recipe) => lensFor(r.mind.senses, 1, false);
const night = (r: Recipe) => lensFor(r.mind.senses, 0, false);

describe('lensFor: the field of view', () => {
  it('gives each of the cast its own width, as the spec lists them', () => {
    expect(day(fox).hfov).toBeCloseTo(84, 6);
    expect(day(wolf).hfov).toBeCloseTo(80, 6);
    expect(day(deer).hfov).toBeCloseTo(104, 6);
    expect(day(rabbit).hfov).toBeCloseTo(115, 6);
    for (const r of [duck, frog, trout]) expect(day(r).hfov).toBeCloseTo(112, 6);
  });

  it("narrows the hawk's below the 70° floor with its sharp sight, by at most 15°", () => {
    const h = day(hawk).hfov;
    expect(h).toBeLessThan(70);
    expect(h).toBeGreaterThanOrEqual(55);
  });

  it('bends the edges only past 90°, at most 6%', () => {
    for (const r of [fox, wolf, hawk]) expect(day(r).barrel).toBe(0);
    for (const r of [deer, rabbit, duck]) expect(day(r).barrel).toBeGreaterThan(0);
    expect(day(rabbit).barrel).toBeLessThanOrEqual(0.06);
    expect(lensFor({ ...fox.mind.senses, fov: 275 }, 1, false).barrel).toBe(0); // 90° exactly
  });

  it('softens only weak sight (the rabbit) and sharpens only keen sight (the hawk)', () => {
    expect(day(rabbit).soften).toBeGreaterThan(0);
    expect(day(hawk).soften).toBe(0);
    expect(day(hawk).sharpen).toBeGreaterThan(0);
    for (const r of [deer, fox, wolf, duck, frog, trout]) expect([day(r).soften, day(r).sharpen]).toEqual([0, 0]);
  });

  it('carries the colour range and the medium', () => {
    expect(day(deer).colour).toBe('muted');
    expect(day(hawk).colour).toBe('vivid');
    expect(day(trout).underwater).toBe(0);
    expect(lensFor(trout.mind.senses, 1, true).underwater).toBe(1);
  });
});

describe('lensFor: night vision', () => {
  it('changes nothing by day', () => {
    for (const r of [deer, fox, wolf, hawk, rabbit]) expect([day(r).night, day(r).exposure, day(r).grain]).toEqual([0, 0, 0]);
  });

  it('lifts good night sight by up to 1.5 stops times its night sight, with a fine grain', () => {
    expect(night(fox).exposure).toBeCloseTo(1.5 * 0.8, 6);
    expect(night(fox).night).toBe(1);
    expect(night(fox).grain).toBeGreaterThanOrEqual(0.02);
    expect(night(fox).grain).toBeLessThanOrEqual(0.03);
    expect(lensFor(fox.mind.senses, 0.5, false).exposure).toBeCloseTo(0.75 * 0.8, 6); // dusk: half of it
  });

  it('darkens poor night sight (the hawk), and leaves middling sight (the frog) as we see', () => {
    expect(night(hawk).exposure).toBeLessThan(0);
    expect(night(hawk).night).toBe(0);
    expect([night(frog).exposure, night(frog).night]).toEqual([0, 0]);
  });
});

describe('NO_LENS', () => {
  it('is our own sight: the free camera’s width and nothing else', () => {
    expect(NO_LENS).toEqual({ hfov: 88, barrel: 0, sideBlur: 0, soften: 0, sharpen: 0, colour: 'normal', night: 0, exposure: 0, grain: 0, underwater: 0 });
  });
});
