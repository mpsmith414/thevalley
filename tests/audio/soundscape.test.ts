import { describe, expect, it } from 'vitest';
import { CHIME_NOTES, EASE, ease, silentSoundscape, toMuted, toVolume } from '../../src/audio/soundscape';

describe('ease', () => {
  it('moves towards the target with a 0.8 s time constant', () => {
    expect(ease(0, 1, 0)).toBe(0);
    expect(ease(0, 1, EASE)).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(ease(1, 0, 100)).toBeCloseTo(0, 10);
    // two half steps land where one whole step does
    expect(ease(ease(0.2, 0.9, 0.05), 0.9, 0.05)).toBeCloseTo(ease(0.2, 0.9, 0.1), 12);
  });
});

describe('the arrival chime', () => {
  it('is three rising notes (arrival v2: a short rising chime)', () => {
    expect(CHIME_NOTES).toHaveLength(3);
    expect(CHIME_NOTES[0]).toBeLessThan(CHIME_NOTES[1]);
    expect(CHIME_NOTES[1]).toBeLessThan(CHIME_NOTES[2]);
  });
});

describe('remembered volume and mute', () => {
  it('keeps a good volume, clamps it, and falls back to 0.8 for anything else', () => {
    expect(toVolume(0.3)).toBe(0.3);
    expect(toVolume(0)).toBe(0);
    expect(toVolume(7)).toBe(1);
    expect(toVolume(-2)).toBe(0);
    for (const bad of [NaN, Infinity, -Infinity, '0.5', null, undefined, {}, [0.5], true]) expect(toVolume(bad), String(bad)).toBe(0.8);
  });

  it('mutes only for a stored true', () => {
    expect(toMuted(true)).toBe(true);
    for (const v of [false, 'true', 1, null, undefined, {}]) expect(toMuted(v), String(v)).toBe(false);
  });

  it('has a silent stand-in with the same interface', async () => {
    const s = silentSoundscape();
    await s.ready;
    s.update({} as never, 0.1);
    s.chime(); // silence
    expect(Object.values(s.gains()).every((g) => g === 0)).toBe(true);
    expect(s.sources().owl).toBe('off');
  });
});
