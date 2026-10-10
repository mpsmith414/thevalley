import { describe, expect, it } from 'vitest';
import { facePose, JAW_MAX, type FaceState } from '../../src/motion/secondary';
import { mulberry32 } from '../../src/util/rng';

const state = (): FaceState => ({ t: 0, blinkAt: 100, yawn: 0, wasAsleep: false, rng: mulberry32(1) });
const awake = { callNow: 0, sleepNow: 0, headDownNow: 0, mouth: 'shut' as const, ears: 'rest' as const };

describe('facePose', () => {
  it('opens the jaw with a call, a gentle amount', () => {
    const p = facePose(state(), 1 / 60, { ...awake, callNow: 1 });
    expect(p.jaw).toBeCloseTo(0.28, 5);
    expect(p.jaw).toBeLessThanOrEqual(JAW_MAX);
  });

  it('keeps the jaw shut when nothing is happening', () => {
    const s = state();
    for (let i = 0; i < 600; i++) expect(facePose(s, 1 / 60, awake).jaw).toBe(0);
  });

  it('chews with the head down: the jaw works between nearly shut and a small opening', () => {
    const s = state();
    let lo = 1, hi = 0;
    for (let i = 0; i < 240; i++) {
      const j = facePose(s, 1 / 60, { ...awake, headDownNow: 1, mouth: 'chew' }).jaw;
      lo = Math.min(lo, j);
      hi = Math.max(hi, j);
    }
    expect(lo).toBeLessThan(0.02);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThan(0.08);
    expect(hi).toBeLessThan(0.1);
  });

  it('laps faster and smaller than it chews, and only with the head down', () => {
    const s = state();
    expect(facePose(s, 1 / 60, { ...awake, headDownNow: 0.3, mouth: 'lap' }).jaw).toBe(0);
    let hi = 0;
    for (let i = 0; i < 120; i++) hi = Math.max(hi, facePose(s, 1 / 60, { ...awake, headDownNow: 1, mouth: 'lap' }).jaw);
    expect(hi).toBeGreaterThan(0.05);
    expect(hi).toBeLessThanOrEqual(0.06);
  });

  it('yawns once as sleep rises, peaks at the widest opening, and not again while asleep', () => {
    const s = state();
    let peak = 0, yawnFrames = 0, afterwards = 0;
    for (let i = 0; i < 60 * 10; i++) {
      const p = facePose(s, 1 / 60, { ...awake, sleepNow: Math.min(1, i / 60) });
      peak = Math.max(peak, p.jaw);
      if (p.jaw > 0) yawnFrames++;
      if (i > 60 * 4) afterwards = Math.max(afterwards, p.jaw);
    }
    expect(peak).toBeCloseTo(JAW_MAX, 2);
    expect(yawnFrames / 60).toBeCloseTo(2.5, 0);
    expect(afterwards).toBe(0);
    // and wakes, then falls asleep again: another yawn
    for (let i = 0; i < 120; i++) facePose(s, 1 / 60, awake);
    let again = 0;
    for (let i = 0; i < 120; i++) again = Math.max(again, facePose(s, 1 / 60, { ...awake, sleepNow: 1 }).jaw);
    expect(again).toBeGreaterThan(0.2);
  });

  it('yawns on command', () => {
    const s = state();
    s.yawn = 2.5;
    let peak = 0;
    for (let i = 0; i < 180; i++) peak = Math.max(peak, facePose(s, 1 / 60, awake).jaw);
    expect(peak).toBeCloseTo(JAW_MAX, 2);
  });

  it('keeps the lids half down while chewing, and shut in sleep', () => {
    const s = state();
    for (let i = 0; i < 120; i++) expect(facePose(s, 1 / 60, { ...awake, headDownNow: 1, mouth: 'chew' }).lids).toBeGreaterThanOrEqual(0.45);
    expect(facePose(s, 1 / 60, { ...awake, sleepNow: 1 }).lids).toBe(1);
    expect(facePose(s, 1 / 60, awake).lids).toBe(0);
  });

  it('blinks now and then, quickly', () => {
    const s = state();
    s.blinkAt = 0.5;
    const lids: number[] = [];
    for (let i = 0; i < 120; i++) lids.push(facePose(s, 1 / 60, awake).lids);
    const shut = lids.filter((l) => l > 0.05).length;
    expect(Math.max(...lids)).toBeGreaterThan(0.9);
    expect(shut / 60).toBeLessThan(0.2);
  });

  it('lays the ears back, pricks them up, and droops them in sleep', () => {
    const rest = facePose(state(), 1 / 60, awake);
    const back = facePose(state(), 1 / 60, { ...awake, ears: 'back' });
    const alert = facePose(state(), 1 / 60, { ...awake, ears: 'alert' });
    const asleep = facePose(state(), 1 / 60, { ...awake, sleepNow: 1 });
    expect(rest.earPitch).toBe(0);
    expect(back.earPitch).toBeGreaterThan(0.7);
    expect(back.earRoll).toBeGreaterThan(0.2);
    expect(alert.earPitch).toBeLessThan(0);
    expect(asleep.earPitch).toBeCloseTo(0.4, 5);
  });
});
