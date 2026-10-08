import { describe, it, expect } from 'vitest';
import { FreeFly, intentFrom, type FlyIntent, type FlyWorld } from '../../src/camera/freefly';
import { EMPTY_PAD, type PadState } from '../../src/shared/input';

const idle: FlyIntent = { move: { x: 0, y: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, fast: false, toggleWalk: false };
const intent = (p: Partial<Omit<FlyIntent, 'move'>> & { move?: Partial<FlyIntent['move']> } = {}): FlyIntent => ({ ...idle, ...p, move: { ...idle.move, ...p.move } });

/** A steep sine hill world, dry, with a square border. */
const HALF = 800;
function world(over: Partial<FlyWorld> = {}): FlyWorld {
  return {
    heightAt: (x, z) => 40 * Math.sin(x / 15) * Math.cos(z / 15),
    isWater: () => false,
    waterLevelAt: () => NaN,
    trunksNear: () => [],
    inside: (x, z, m = 0) => Math.abs(x) <= HALF - m && Math.abs(z) <= HALF - m,
    ...over,
  };
}
const flat = (y = 0) => world({ heightAt: () => y });
const run = (f: FreeFly, w: FlyWorld, secs: number, i: FlyIntent, dt = 1 / 60) => {
  for (let k = 0; k < Math.round(secs / dt); k++) f.update(dt, i, w);
};
const pad = (p: Partial<PadState>): PadState => ({ ...EMPTY_PAD, ...p });
const none = () => false;
const keys = (...ks: string[]) => (k: string) => ks.includes(k);
const still = { dx: 0, dy: 0 };

describe('FreeFly movement', () => {
  it('forward intent moves along -z at yaw 0', () => {
    const f = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0);
    run(f, flat(), 2, intent({ move: { z: 1 } }));
    expect(f.pos.z).toBeLessThan(-10);
    expect(Math.abs(f.pos.x)).toBeLessThan(1e-9);
  });
  it('forward follows yaw (positive yaw turns left, towards -x)', () => {
    const f = new FreeFly({ x: 0, y: 50, z: 0 }, Math.PI / 2, 0);
    run(f, flat(), 2, intent({ move: { z: 1 } }));
    expect(f.pos.x).toBeLessThan(-10);
    expect(Math.abs(f.pos.z)).toBeLessThan(1e-6);
  });
  it('strafe right at yaw 0 moves +x', () => {
    const f = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0);
    run(f, flat(), 1, intent({ move: { x: 1 } }));
    expect(f.pos.x).toBeGreaterThan(5);
  });
  it('flying forward while looking up climbs', () => {
    const f = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0.5);
    run(f, flat(), 1, intent({ move: { z: 1 } }));
    expect(f.pos.y).toBeGreaterThan(51);
  });
  it('cruises at 12 m/s, or 60 m/s when fast', () => {
    const a = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0), b = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0);
    run(a, flat(), 4, intent({ move: { z: 1 } }));
    run(b, flat(), 4, intent({ move: { z: 1 }, fast: true }));
    expect(Math.abs(a.vel.z)).toBeCloseTo(12, 0);
    expect(Math.abs(b.vel.z)).toBeCloseTo(60, 0);
  });
  it('velocity eases rather than jumping', () => {
    const f = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0);
    f.update(1 / 60, intent({ move: { z: 1 } }), flat());
    expect(Math.abs(f.vel.z)).toBeGreaterThan(0);
    expect(Math.abs(f.vel.z)).toBeLessThan(2);
  });
  it('look turns and clamps pitch to +-1.35', () => {
    const f = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0);
    f.update(0.016, intent({ look: { yaw: 0.5, pitch: 5 } }), flat());
    expect(f.yaw).toBeCloseTo(0.5);
    expect(f.pitch).toBeCloseTo(1.35);
    f.update(0.016, intent({ look: { yaw: 0, pitch: -9 } }), flat());
    expect(f.pitch).toBeCloseTo(-1.35);
  });
  it('apply sets position and a YXZ rotation', () => {
    const f = new FreeFly({ x: 1, y: 2, z: 3 }, 0.4, -0.2);
    const cam = {
      position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      rotation: { args: [] as unknown[], set(...a: unknown[]) { this.args = a; } },
    };
    f.apply(cam as never);
    expect([cam.position.x, cam.position.y, cam.position.z]).toEqual([1, 2, 3]);
    expect(cam.rotation.args).toEqual([-0.2, 0.4, 0, 'YXZ']);
  });
});

describe('FreeFly collision', () => {
  it('never goes under ground + 1.2 over a steep hill, flying fast and downwards', () => {
    const w = world();
    const f = new FreeFly({ x: 0, y: 30, z: 0 }, 0.7, -1.2);
    let min = Infinity;
    for (let k = 0; k < 600; k++) {
      f.update(1 / 60, intent({ move: { x: 0.3, y: -1, z: 1 }, fast: true }), w);
      min = Math.min(min, f.pos.y - w.heightAt(f.pos.x, f.pos.z));
    }
    expect(min).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });
  it('stays above the water surface', () => {
    const w = world({ heightAt: () => -5, isWater: () => true, waterLevelAt: () => 0 });
    const f = new FreeFly({ x: 0, y: 10, z: 0 }, 0, -1);
    run(f, w, 3, intent({ move: { y: -1, z: 1 } }));
    expect(f.pos.y).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });
  it('ignores a NaN water level on dry land', () => {
    const w = world({ heightAt: () => 10, waterLevelAt: () => NaN });
    const f = new FreeFly({ x: 0, y: 50, z: 0 }, 0, 0);
    run(f, w, 4, intent({ move: { y: -1 } }));
    expect(f.pos.y).toBeCloseTo(11.2, 5);
  });
  it('walk mode settles at ground + 1.6 within 2 s, is slower, and ignores vertical intent', () => {
    const w = flat(7);
    const f = new FreeFly({ x: 0, y: 40, z: 0 }, 0, 0);
    f.update(0, intent({ toggleWalk: true }), w);
    expect(f.walk).toBe(true);
    run(f, w, 2, intent({ move: { y: 1 } }));
    expect(f.pos.y).toBeCloseTo(8.6, 1);
    run(f, w, 4, intent({ move: { z: 1 } }));
    expect(Math.abs(f.vel.z)).toBeCloseTo(12 * 0.35, 1);
    expect(f.pos.y).toBeCloseTo(8.6, 1);
    f.update(0, intent({ toggleWalk: true }), w);
    expect(f.walk).toBe(false);
  });
  it('walk mode keeps to the ground when looking up', () => {
    const w = flat(0);
    const f = new FreeFly({ x: 0, y: 1.6, z: 0 }, 0, 1);
    f.walk = true;
    run(f, w, 2, intent({ move: { z: 1 } }));
    expect(f.pos.y).toBeCloseTo(1.6, 1);
    expect(f.pos.z).toBeLessThan(-2);
  });
  it('walk mode over water rides the surface + 1.6', () => {
    const w = world({ heightAt: () => -4, isWater: () => true, waterLevelAt: () => 0 });
    const f = new FreeFly({ x: 0, y: 30, z: 0 }, 0, 0);
    f.walk = true;
    run(f, w, 2, idle);
    expect(f.pos.y).toBeCloseTo(1.6, 1);
  });
  it('pushes out of trunk circles plus 0.6 m', () => {
    const trunk = { x: 0, z: -10, r: 1 };
    const w = flat(0);
    w.trunksNear = (x, z, r) => (Math.hypot(x - trunk.x, z - trunk.z) - trunk.r <= r ? [trunk] : []);
    const f = new FreeFly({ x: 0, y: 5, z: 0 }, 0, 0);
    run(f, w, 4, intent({ move: { z: 1 } }));
    expect(Math.hypot(f.pos.x - trunk.x, f.pos.z - trunk.z)).toBeGreaterThanOrEqual(1.6 - 1e-6);
    expect(f.pos.z).toBeGreaterThan(-10); // did not pass through
  });
  it('flies straight over a trunk circle at ground + 100 m', () => {
    const w = flat(0);
    w.trunksNear = () => [{ x: 0, z: -10, r: 1 }];
    const f = new FreeFly({ x: 0, y: 100, z: 0 }, 0, 0);
    run(f, w, 2, intent({ move: { z: 1 } }));
    expect(f.pos.z).toBeLessThan(-10.6); // went through the circle and out the far side
  });
  it('a long frame (fast, dt 0.1) never tunnels through a trunk dead ahead', () => {
    const trunk = { x: 0, z: -40, r: 1 };
    const w = flat(0);
    w.trunksNear = (x, z, r) => (Math.hypot(x - trunk.x, z - trunk.z) - trunk.r <= r ? [trunk] : []);
    const f = new FreeFly({ x: 0, y: 5, z: 0 }, 0, 0);
    for (let k = 0; k < 60; k++) {
      f.update(0.1, intent({ move: { z: 1 }, fast: true }), w);
      expect(Math.hypot(f.pos.x - trunk.x, f.pos.z - trunk.z)).toBeGreaterThanOrEqual(1.6 - 1e-6);
      expect(f.pos.z).toBeGreaterThan(trunk.z);
    }
  });
  it('a long frame never jumps the border either', () => {
    const w = flat(0);
    const f = new FreeFly({ x: 780, y: 20, z: 0 }, -Math.PI / 2, 0);
    for (let k = 0; k < 30; k++) {
      f.update(0.1, intent({ move: { z: 1 }, fast: true }), w);
      expect(w.inside(f.pos.x, f.pos.z, 10)).toBe(true);
    }
  });
  it('a camera dead centre in a trunk is still pushed out', () => {
    const w = flat(0);
    w.trunksNear = () => [{ x: 3, z: 4, r: 0.5 }];
    const f = new FreeFly({ x: 3, y: 5, z: 4 }, 0, 0);
    f.update(1 / 60, idle, w);
    expect(Math.hypot(f.pos.x - 3, f.pos.z - 4)).toBeGreaterThanOrEqual(1.1 - 1e-6);
  });
  it('never leaves the valley border (inside margin 10), and slides along it', () => {
    const w = flat(0);
    const f = new FreeFly({ x: 700, y: 20, z: 0 }, -Math.PI / 2, 0); // facing +x
    run(f, w, 20, intent({ move: { z: 1 }, fast: true }));
    expect(w.inside(f.pos.x, f.pos.z, 10)).toBe(true);
    expect(f.pos.x).toBeGreaterThan(780);
    f.yaw = -Math.PI / 4; // towards +x and -z: slides north along the edge
    const z0 = f.pos.z;
    run(f, w, 1, intent({ move: { z: 1 } }));
    expect(f.pos.z).toBeLessThan(z0 - 5);
    expect(w.inside(f.pos.x, f.pos.z, 10)).toBe(true);
  });
  it('caps height at 600', () => {
    const f = new FreeFly({ x: 0, y: 590, z: 0 }, 0, 0);
    run(f, flat(), 5, intent({ move: { y: 1 }, fast: true }));
    expect(f.pos.y).toBeLessThanOrEqual(600);
  });
});

describe('intentFrom', () => {
  it('maps the left stick: forward is -ly, strafe is lx', () => {
    const i = intentFrom(pad({ lx: 0.5, ly: -0.5 }), none, still);
    expect(i.move.z).toBeCloseTo(0.5);
    expect(i.move.x).toBeCloseTo(0.5);
    expect(intentFrom(pad({ ly: 1 }), none, still).move.z).toBeCloseTo(-1);
  });
  it('maps WASD', () => {
    expect(intentFrom(EMPTY_PAD, keys('w'), still).move.z).toBe(1);
    expect(intentFrom(EMPTY_PAD, keys('s'), still).move.z).toBe(-1);
    expect(intentFrom(EMPTY_PAD, keys('d'), still).move.x).toBe(1);
    expect(intentFrom(EMPTY_PAD, keys('a'), still).move.x).toBe(-1);
  });
  it('keeps diagonals at length 1', () => {
    const m = intentFrom(EMPTY_PAD, keys('w', 'd'), still).move;
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(1);
  });
  it('maps up/down to RT/LT and E/Q', () => {
    expect(intentFrom(pad({ rt: true }), none, still).move.y).toBe(1);
    expect(intentFrom(pad({ lt: true }), none, still).move.y).toBe(-1);
    expect(intentFrom(EMPTY_PAD, keys('e'), still).move.y).toBe(1);
    expect(intentFrom(EMPTY_PAD, keys('q'), still).move.y).toBe(-1);
    expect(intentFrom(pad({ rt: true, lt: true }), none, still).move.y).toBe(0);
  });
  it('fast is RB or shift', () => {
    expect(intentFrom(pad({ rb: true }), none, still).fast).toBe(true);
    expect(intentFrom(EMPTY_PAD, keys('shift'), still).fast).toBe(true);
    expect(intentFrom(EMPTY_PAD, none, still).fast).toBe(false);
  });
  it('right stick looks at 1.8 / 1.2 rad/s (right turns right, up looks up); dt scales it', () => {
    const i = intentFrom(pad({ rx: 1, ry: -1 }), none, still);
    expect(i.look.yaw).toBeCloseTo(-1.8);
    expect(i.look.pitch).toBeCloseTo(1.2);
    const h = intentFrom(pad({ rx: 1, ry: -1 }), none, still, 0.5);
    expect(h.look.yaw).toBeCloseTo(-0.9);
    expect(h.look.pitch).toBeCloseTo(0.6);
  });
  it('mouse adds 0.0022 rad per pixel (right turns right, down looks down), not scaled by dt', () => {
    const i = intentFrom(EMPTY_PAD, none, { dx: 100, dy: 50 }, 0.5);
    expect(i.look.yaw).toBeCloseTo(-0.22);
    expect(i.look.pitch).toBeCloseTo(-0.11);
  });
  it('toggleWalk is an edge of Y or G (wasDown suppresses repeats)', () => {
    expect(intentFrom(pad({ y: true }), none, still).toggleWalk).toBe(true);
    expect(intentFrom(EMPTY_PAD, keys('g'), still).toggleWalk).toBe(true);
    expect(intentFrom(pad({ y: true }), none, still, 1, true).toggleWalk).toBe(false);
    expect(intentFrom(EMPTY_PAD, keys('g'), still, 1, true).toggleWalk).toBe(false);
    expect(intentFrom(EMPTY_PAD, none, still).toggleWalk).toBe(false);
  });
});
