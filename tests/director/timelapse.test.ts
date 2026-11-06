import { describe, expect, it } from 'vitest';
import { nightLapseOver, wantTimelapse } from '../../src/director/timelapse';

const base = { now: 1000, night: false, enabled: true, lastDayLapse: -Infinity, quietFor: 0, nightWorthyFor: 0 };

describe('wantTimelapse', () => {
  it('by day, after two quiet minutes, at most once in ten minutes', () => {
    expect(wantTimelapse({ ...base, quietFor: 119 })).toBeNull();
    expect(wantTimelapse({ ...base, quietFor: 120 })).toBe('day');
    expect(wantTimelapse({ ...base, quietFor: 300, lastDayLapse: 500 })).toBeNull();
    expect(wantTimelapse({ ...base, quietFor: 300, lastDayLapse: 400 })).toBe('day');
  });

  it('at night, after three minutes with nothing night-worthy', () => {
    expect(wantTimelapse({ ...base, night: true, nightWorthyFor: 179, quietFor: 1000 })).toBeNull();
    expect(wantTimelapse({ ...base, night: true, nightWorthyFor: 180 })).toBe('night');
  });

  it('never when time-lapses are off', () => {
    expect(wantTimelapse({ ...base, enabled: false, quietFor: 1000 })).toBeNull();
    expect(wantTimelapse({ ...base, enabled: false, night: true, nightWorthyFor: 1000 })).toBeNull();
  });
});

describe('nightLapseOver', () => {
  it('once the sun is within 6° below the horizon', () => {
    expect(nightLapseOver(-20)).toBe(false);
    expect(nightLapseOver(-6.5)).toBe(false);
    expect(nightLapseOver(-6)).toBe(true);
    expect(nightLapseOver(3)).toBe(true);
  });

  it('and rising: not while it is still going down past the lowest it has been', () => {
    expect(nightLapseOver(-4, -4)).toBe(false);
    expect(nightLapseOver(-5, -30)).toBe(true);
  });
});
