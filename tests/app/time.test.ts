import { describe, expect, it } from 'vitest';
import { SPEEDS } from '../../src/app/menu';
import { ReleaseTimeHold, animalRate, stepSpeed } from '../../src/app/time';
import { DEFAULT_SPEED, ValleyClock } from '../../src/world/clock';

const clockAt = (speed: number, paused = false) => Object.assign(new ValleyClock(), { speed, paused });

describe('animalRate', () => {
  it('is 0 paused, 0.5 Slow, 1 Normal, 4 Fast and 16 Fastest', () => {
    const rate = (id: string) => {
      const s = SPEEDS.find((x) => x.id === id)!;
      return animalRate({ paused: id === 'paused', speed: s.speed || DEFAULT_SPEED });
    };
    expect(['paused', 'slow', 'normal', 'fast', 'fastest'].map(rate)).toEqual([0, 0.5, 1, 4, 16]);
  });
  it('stays 0 while paused whatever speed the clock keeps', () => {
    expect(animalRate(clockAt(4 / 15, true))).toBe(0);
  });
});

describe('stepSpeed', () => {
  it('steps one speed and stops at both ends', () => {
    expect(stepSpeed('normal', 1)).toBe('fast');
    expect(stepSpeed('normal', -1)).toBe('slow');
    expect(stepSpeed('fast', 1)).toBe('fastest');
    expect(stepSpeed('fastest', 1)).toBe('fastest');
    expect(stepSpeed('paused', -1)).toBe('paused');
    expect(stepSpeed('paused', 1)).toBe('slow');
  });
});

describe('ReleaseTimeHold', () => {
  it('plays at Normal and gives Fastest back', () => {
    const clock = clockAt(4 / 15), hold = new ReleaseTimeHold(clock);
    hold.hold();
    expect(clock).toMatchObject({ speed: DEFAULT_SPEED, paused: false });
    expect(hold.held).toBe(true);
    expect(hold.remembered).toEqual({ speed: 4 / 15, paused: false });
    hold.release();
    expect(clock).toMatchObject({ speed: 4 / 15, paused: false });
    expect(hold.held).toBe(false);
    expect(hold.remembered).toBeNull();
  });

  it('runs a paused clock for the arrival and pauses it again after', () => {
    const clock = clockAt(1 / 15, true), hold = new ReleaseTimeHold(clock);
    hold.hold();
    expect(clock).toMatchObject({ speed: DEFAULT_SPEED, paused: false });
    hold.release();
    expect(clock).toMatchObject({ speed: 1 / 15, paused: true });
  });

  it("keeps the player's pick when they change the speed meanwhile", () => {
    const clock = clockAt(4 / 15), hold = new ReleaseTimeHold(clock);
    hold.hold();
    hold.playerChanged();
    clock.speed = 1 / 120;
    hold.release();
    expect(clock).toMatchObject({ speed: 1 / 120, paused: false });
    expect(hold.held).toBe(false);
  });

  it('keeps the first remembered speed when held twice', () => {
    const clock = clockAt(4 / 15), hold = new ReleaseTimeHold(clock);
    hold.hold();
    hold.hold();
    hold.release();
    expect(clock.speed).toBe(4 / 15);
  });

  it('release without a hold changes nothing', () => {
    const clock = clockAt(1 / 15), hold = new ReleaseTimeHold(clock);
    hold.release();
    expect(clock).toMatchObject({ speed: 1 / 15, paused: false });
  });
});
