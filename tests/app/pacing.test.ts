import { describe, expect, it } from 'vitest';
import { pacing, type PacingOptions } from '../../src/app/pacing';
import type { Tier } from '../../src/render/quality';

/** A renderer stand-in that records the pixel ratios it was given. */
const renderer = (base = 1) => {
  const ratios: number[] = [];
  let ratio = base;
  return { ratios, getPixelRatio: () => ratio, setPixelRatio: (r: number) => (ratios.push(r), (ratio = r)) };
};
/** A GPU "done" stand-in that resolves when told to, and a clock the test moves by hand. */
const gpu = () => {
  const waiting: (() => void)[] = [];
  return { done: () => new Promise<void>((r) => waiting.push(r)), finish: () => waiting.splice(0).forEach((r) => r()) };
};
/** Let the GPU stand-in's promises settle (microtasks only). */
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

const make = (over: Partial<PacingOptions> = {}) => {
  const picks: Tier[] = [], labels: string[] = [];
  const r = renderer();
  const pace = pacing({ renderer: r, min: 0.7, tier: 'high', measure: false, done: null, remember: (p) => picks.push(p), label: (t) => labels.push(t), ...over });
  return { pace, r, picks, labels };
};

describe('pacing', () => {
  it('without a GPU signal (WebGL 2) reads each frame by its interval', () => {
    const { pace, r } = make();
    for (let i = 0; i < 300; i++) pace.frame(0.03, 0);
    expect(pace.scale).toBe(0.7);
    expect(r.ratios.at(-1)).toBeCloseTo(0.7, 9); // base 1 × scale
    for (let i = 0; i < 3000; i++) pace.frame(1 / 60, 0);
    expect(pace.scale).toBe(0.7); // 16.7 ms intervals never read as light: no recovery there
  });

  it('reads a frame by the shorter of its interval and its time to the GPU finishing', async () => {
    let now = 0;
    const g = gpu();
    // a screen capped at 40 fps whose frames take 8 ms of work: light, so the resolution stays full
    const capped = make({ done: g.done, now: () => now });
    for (let i = 0; i < 200; i++) {
      capped.pace.frame(0.025, now);
      now += 8;
      g.finish();
      await flush();
      now += 17;
    }
    expect(capped.pace.scale).toBe(1);
    expect(capped.pace.workMs).toBe(8);
    // frames overlapping on the GPU (21 ms to finish) at 85 fps (11.8 ms apart): the interval wins, still light
    const quick = make({ done: g.done, now: () => now });
    for (let i = 0; i < 200; i++) {
      quick.pace.frame(1 / 85, now);
      now += 21;
      g.finish();
      await flush();
    }
    expect(quick.pace.scale).toBe(1);
    // genuinely heavy frames (30 ms apart, 28 ms of work) lower it
    const heavy = make({ done: g.done, now: () => now });
    for (let i = 0; i < 200; i++) {
      heavy.pace.frame(0.03, now);
      now += 28;
      g.finish();
      await flush();
    }
    expect(heavy.pace.scale).toBeLessThan(1);
  });

  it('drops frames still on the GPU when it is reset (the dev step freezes the loop)', async () => {
    const g = gpu();
    const { pace } = make({ done: g.done, now: () => 1000 });
    for (let i = 0; i < 100; i++) pace.frame(0.05, 0); // 50 ms each, all still pending
    pace.reset();
    g.finish();
    await flush();
    expect(pace.scale).toBe(1);
    expect(Number.isNaN(pace.workMs)).toBe(true);
  });

  it('lets Auto measure first, keeps its pick and labels a change', () => {
    const { pace, picks, labels } = make({ measure: true });
    expect(pace.measuring).toBe(true);
    for (let i = 0; i < 30 * 4; i++) pace.frame(1 / 30, 0);
    expect(pace.measuring).toBe(false);
    expect(picks).toEqual(['low']);
    expect(labels).toEqual(['Next time: Low quality']);
    expect(pace.scale).toBe(1); // the scaler sat out the measurement
  });

  it('says nothing when Auto keeps the tier it started on', () => {
    const { pace, picks, labels } = make({ measure: true });
    for (let i = 0; i < 60 * 4 + 1; i++) pace.frame(1 / 60, 0);
    expect(picks).toEqual(['high']);
    expect(labels).toEqual([]);
  });
});
