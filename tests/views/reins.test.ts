import { describe, expect, it } from 'vitest';
import { DoLatch, ReinsClock, steerFrom } from '../../src/views/reins';
import { DEFAULT_SPEED, ValleyClock } from '../../src/world/clock';

const FAST = 1 / 15, FASTEST = 4 / 15, SLOW = 1 / 120;
const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;

describe('steerFrom', () => {
  it('goes the way the stick is pushed, from the camera: up is where it looks, right is its right', () => {
    // the camera faces -z (yaw 0): forward in the simulation's atan2(dx, dz) is π, its right (+x) is π/2
    expect(near(steerFrom({ x: 0, y: 1 }, 0, false, 0, false).yaw, Math.PI)).toBe(true);
    expect(near(steerFrom({ x: 1, y: 0 }, 0, false, 0, false).yaw, Math.PI / 2)).toBe(true);
    expect(near(steerFrom({ x: 0, y: -1 }, 0, false, 0, false).yaw, 0)).toBe(true);
    // the camera turned left a quarter (facing -x): up goes -x
    expect(near(steerFrom({ x: 0, y: 1 }, Math.PI / 2, false, 0, false).yaw, -Math.PI / 2)).toBe(true);
  });

  it('goes as fast as the stick is pushed, at most 1', () => {
    expect(steerFrom({ x: 0, y: 0.4 }, 0, false, 0, false).speed).toBeCloseTo(0.4);
    expect(steerFrom({ x: 1, y: 1 }, 0, false, 0, false).speed).toBe(1);
  });

  it('stands, facing the way it faced, with the stick at rest (run alone does not move it)', () => {
    const s = steerFrom({ x: 0, y: 0 }, 0, true, 0, false, 1.2);
    expect(s.speed).toBe(0);
    expect(s.run).toBe(false);
    expect(s.yaw).toBe(1.2);
    expect(steerFrom({ x: 0, y: 1 }, 0, true, 0, false).run).toBe(true);
  });

  it('passes fly and Do through', () => {
    const s = steerFrom({ x: 0, y: 0 }, 0, false, -1, true);
    expect(s.fly).toBe(-1);
    expect(s.act).toBe(true);
  });
});

describe('DoLatch', () => {
  it('holds a press until the simulation has ticked with it, then lets it go', () => {
    const d = new DoLatch();
    expect(d.at(10)).toBe(false);
    d.press();
    expect(d.at(10)).toBe(true); // sent with time 10
    expect(d.at(10)).toBe(true); // no tick yet (a fast frame): still down
    expect(d.at(10.1)).toBe(false); // a tick has seen it
    expect(d.at(10.2)).toBe(false);
    d.press();
    expect(d.at(10.2)).toBe(true);
  });

  it('forgets a press when cleared', () => {
    const d = new DoLatch();
    d.press();
    d.clear();
    expect(d.at(0)).toBe(false);
  });
});

describe('ReinsClock', () => {
  const at = (speed: number, paused = false) => Object.assign(new ValleyClock(), { speed, paused });

  it('from Paused, runs at Normal unpaused while steering and gives Paused back', () => {
    const c = at(DEFAULT_SPEED, true), r = new ReinsClock();
    r.take(c);
    expect([c.speed, c.paused]).toEqual([DEFAULT_SPEED, false]);
    expect(r.held).toBe(true);
    r.give(c);
    expect([c.speed, c.paused]).toEqual([DEFAULT_SPEED, true]);
    expect(r.held).toBe(false);
  });

  it('from Fastest, gives Fastest back', () => {
    const c = at(FASTEST), r = new ReinsClock();
    r.take(c);
    expect(c.speed).toBe(DEFAULT_SPEED);
    expect(r.remembered).toEqual({ speed: FASTEST, paused: false });
    r.give(c);
    expect(c.speed).toBe(FASTEST);
  });

  it('lets a speed the player picked meanwhile stand', () => {
    const c = at(FAST), r = new ReinsClock();
    r.take(c);
    c.speed = SLOW; // picked meanwhile
    r.give(c);
    expect(c.speed).toBe(SLOW);
    // even Normal, when the player says so
    const d = at(FAST), s = new ReinsClock();
    s.take(d);
    s.playerChanged();
    s.give(d);
    expect(d.speed).toBe(DEFAULT_SPEED);
  });

  it('remembers the speed only the first time, and gives back nothing it did not take', () => {
    const c = at(FAST), r = new ReinsClock();
    r.give(c);
    expect(c.speed).toBe(FAST);
    r.take(c);
    r.take(c);
    r.give(c);
    expect(c.speed).toBe(FAST);
  });
});
