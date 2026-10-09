import { describe, expect, it } from 'vitest';
import { brownNoise, crickets, pinkNoise, seamless, whiteNoise } from '../../src/audio/synth';
import { mulberry32 } from '../../src/util/rng';

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('synth samples', () => {
  it('makes noise of a sensible loudness, never clipping', () => {
    for (const gen of [whiteNoise, pinkNoise, brownNoise]) {
      const x = gen(48000, mulberry32(1));
      expect(rms(x), gen.name).toBeGreaterThan(0.05);
      expect(peak(x), gen.name).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a seed', () => {
    expect(pinkNoise(1000, mulberry32(7))).toEqual(pinkNoise(1000, mulberry32(7)));
    expect(crickets(4800, 48000, mulberry32(7))).toEqual(crickets(4800, 48000, mulberry32(7)));
  });

  it('loops seamlessly: the end runs into the start without a jump', () => {
    const n = 48000, x = brownNoise(n + 2400, mulberry32(3)), loop = seamless(x, n);
    expect(loop.length).toBe(n);
    // the sample after the loop's last is the original x[n], which is where the crossfaded start begins
    expect(Math.abs(loop[0] - x[n])).toBeLessThan(0.01);
    expect(loop[n - 1]).toBe(x[n - 1]);
  });

  it('sings crickets in bursts at about 15 Hz, with quiet between groups', () => {
    const rate = 48000, x = crickets(rate * 6, rate, mulberry32(5));
    expect(peak(x)).toBeLessThan(1);
    expect(rms(x)).toBeGreaterThan(0.02);
    // 10 ms frames: some loud (a pulse), some silent (between pulses or groups)
    const frames = Array.from({ length: 600 }, (_, k) => rms(x.subarray(k * 480, (k + 1) * 480)));
    expect(frames.filter((f) => f < 1e-4).length).toBeGreaterThan(60);
    expect(frames.filter((f) => f > 0.05).length).toBeGreaterThan(60);
  });
});
