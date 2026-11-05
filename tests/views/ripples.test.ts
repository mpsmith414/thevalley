import { describe, expect, it } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import { createRippleMesh, noisy } from '../../src/views/ripples';
import type { AnimalPose } from '../../src/views/types';

/** A deer-sized walker (top speed 10 m/s), standing still and quiet on dry land. */
const still = { doing: 'graze' as const, speed: 0, topSpeed: 10, calling: 0, flying: false, climb: 0, inWater: false };

describe('noisy', () => {
  it('is silent for a grazer standing still, and a walker at a stroll', () => {
    expect(noisy(still)).toBe(0);
    expect(noisy({ ...still, doing: 'walk', speed: 2 })).toBe(0);
  });

  it('is heard for a runner, louder the faster', () => {
    const trot = noisy({ ...still, doing: 'flee', speed: 6 }), flat = noisy({ ...still, doing: 'flee', speed: 10 });
    expect(trot).toBeGreaterThan(0);
    expect(flat).toBeGreaterThan(trot);
    expect(flat).toBeLessThanOrEqual(1);
  });

  it('is heard for a caller, and for one splashing through the water', () => {
    expect(noisy({ ...still, doing: 'call', calling: 1 })).toBeGreaterThan(0);
    expect(noisy({ ...still, doing: 'flee', speed: 6, inWater: true })).toBeGreaterThan(noisy({ ...still, doing: 'flee', speed: 6 }));
  });

  it('is loudest for a flier taking off; one gliding aloft is silent', () => {
    const takeOff = noisy({ ...still, doing: 'walk', speed: 3, flying: true, climb: 2 });
    expect(takeOff).toBe(1);
    for (const a of [{ ...still, doing: 'flee' as const, speed: 10 }, { ...still, doing: 'call' as const, calling: 1 }, { ...still, doing: 'flee' as const, speed: 10, inWater: true }])
      expect(takeOff).toBeGreaterThan(noisy(a));
    expect(noisy({ ...still, doing: 'walk', speed: 14, flying: true, climb: 0 })).toBe(0);
  });
});

describe('the ripple mesh', () => {
  const world: FlyWorld = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, inside: () => true, trunksNear: () => [] };
  const pose: AnimalPose = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, size: 0.4, bodyLength: 0.4, backHeight: 0.25, flying: false, turnRate: 0 };

  it('forgets who it heard once put right out: switched back on, no rings from before', () => {
    const m = createRippleMesh(world);
    m.frame([{ id: 'rabbit#0', pose, loud: 0.8 }], 0.5, 1, 1);
    expect(m.object.count).toBeGreaterThan(0);
    m.frame(null, 0.016, 1.1, 0.5); // easing out: its rings still spread
    expect(m.object.count).toBeGreaterThan(0);
    m.frame(null, 0.016, 1.2, 0); // right out
    expect(m.object.visible).toBe(false);
    m.frame([], 0.016, 5, 0.1); // back on, nobody making noise now
    expect(m.object.count).toBe(0);
  });
});
