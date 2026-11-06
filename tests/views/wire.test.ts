import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import { deer as deerRecipe } from '../../src/cast/deer';
import { lensUniforms } from '../../src/render/lens';
import { lensFor } from '../../src/views/lens';
import type { Candidate } from '../../src/views/aim';
import type { Sensing } from '../../src/views/senses';
import { nearPlane, type Pose } from '../../src/views/types';
import { Views, type ViewAnimal, type ViewInput } from '../../src/views/views';
import type { Scents } from '../../src/views/trails';
import { CLOSE_FAR, ViewsWire, type ViewsWireDeps, type WireHands } from '../../src/views/wire';
import type { SteerInput } from '../../src/sim/types';
import type { Sound } from '../../src/views/ripples';
import type { Sighting } from '../../src/views/sharp';

/** A flat dry world with no trees. */
const world: FlyWorld = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, inside: () => true, trunksNear: () => [] };
const dt = 1 / 60;
const idle: ViewInput = { look: { yaw: 0, pitch: 0 }, zoom: 0, moved: false, any: false };
/** A deer 1.6 m long at (x, 0, z), heading along -z, its eyes a little ahead and up. */
const deer = (x: number, z: number): ViewAnimal => ({
  pose: { pos: { x, y: 0, z }, yaw: 0, size: 1.6, bodyLength: 1.4, backHeight: 1.1, flying: false, turnRate: 0 },
  eye: { pos: { x, y: 1.3, z: z - 0.7 }, yaw: 0, pitch: 0 },
  name: 'Deer', native: true, doing: 'graze', swimmer: false, chasing: false, gone: null,
});

/** The wiring over animals `a` (at 0, 0) and `b` (3 m to its right), a real controller and camera, and fakes for the rest. */
function setup(opts: { light?: number; world?: FlyWorld; sensing?: (id: string) => Sensing | null; smell?: ViewsWireDeps['smell']; extra?: Partial<ViewsWireDeps> } = {}) {
  const w = opts.world ?? world;
  const animals: Record<string, ViewAnimal> = { a: deer(0, 0), b: deer(3, 0) };
  const hidden = new Set<string>();
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 8000);
  const clock = { ms: 0 };
  const views = new Views({ world: w, animal: (id) => animals[id] ?? null, say: () => {}, now: () => clock.ms });
  /** What the screen shows of the senses now: the first-time line, the edge arc, the danger's ring and the heartbeat. */
  const shown = {
    line: null as string | null, arc: null as 'left' | 'right' | null, tone: '', ring: null as unknown, beat: { bpm: 0, on: false },
    tag: null as string | null, hints: null as string | null,
  };
  const hud = {
    tag: (at: unknown, name: string) => void (shown.tag = at ? name : null), card() {}, hints: (h: string | null) => void (shown.hints = h),
    senseLine: (l: string | null) => void (shown.line = l),
    edgeArc: (a: 'left' | 'right' | null, tone = 'danger') => void ((shown.arc = a), (shown.tone = tone)),
  };
  const threatRing = { object: null as never, show: (a: unknown) => void (shown.ring = a) };
  const heartbeat = { set: (bpm: number, on: boolean) => void (shown.beat = { bpm, on }) };
  const ring = { object: null as never, show() {} };
  const lens = lensUniforms();
  const wire = new ViewsWire({
    views, world: w, camera, lens, daylight: () => opts.light ?? 1, ring, hud, keys: () => false, now: () => clock.ms, screen: () => ({ w: 1920, h: 1080 }),
    sensing: opts.sensing, threatRing, heartbeat, smell: opts.smell, ...opts.extra,
    animals: {
      viewAnimal: (id) => animals[id] ?? null,
      candidates: (): Candidate[] => Object.entries(animals).map(([id, x]) => ({ id, pos: { ...x.pose.pos, y: 0.8 }, size: 1.6, drawn: true })),
      hideFromCamera: (id, on) => void (on ? hidden.add(id) : hidden.delete(id)),
      sensesOf: (id) => (animals[id] ? deerRecipe.mind.senses : null),
    },
  });
  let pose: Pose = { pos: { x: 0, y: 20, z: 60 }, yaw: 0, pitch: -0.2 };
  const t = {
    views, wire, camera, hidden, animals, lens, shown,
    /** `secs` of frames with the player's `hands` (none by default); the camera goes where the views put it. */
    run(secs: number, hands: WireHands = idle) {
      for (let s = 0; s < secs - 1e-9; s += dt) {
        clock.ms += dt * 1000;
        const out = wire.frame(dt, hands, pose, 1, false);
        if (out) pose = out;
      }
    },
    planes: () => [camera.near, camera.far],
  };
  return t;
}

const small = nearPlane(1.6);

describe('ViewsWire', () => {
  it('free flight highlights the animal ahead with its tag, but never while the documentary runs (quiet)', () => {
    const t = setup();
    t.camera.position.set(0, 2, 12); // looking along -z, at the deer
    const pose: Pose = { pos: { x: 0, y: 2, z: 12 }, yaw: 0, pitch: 0 };
    const frames = (n: number) => { for (let i = 0; i < n; i++) t.wire.frame(dt, idle, pose, 1, true); };
    frames(30);
    expect(t.shown.tag).toBe('Deer');
    t.wire.quiet = true;
    frames(1);
    expect(t.shown.tag).toBeNull();
    expect(t.wire.highlighted).toBeNull();
    frames(30);
    expect(t.shown.tag).toBeNull();
  });

  it('keeps the camera planes and the body as they are in Follow, and gives them back on letting go', () => {
    const t = setup();
    t.views.lock('a');
    t.run(6);
    expect(t.views.state.mode).toBe('locked');
    expect(t.planes()).toEqual([0.1, 8000]);
    expect(t.hidden.size).toBe(0);
    t.views.setView('eyes');
    t.run(2);
    expect(t.hidden.has('a')).toBe(true);
    expect(t.planes()).toEqual([small, CLOSE_FAR]);
    t.wire.act('letGo');
    t.run(dt);
    expect(t.hidden.size).toBe(0);
    expect(t.planes()).toEqual([0.1, 8000]);
  });

  it('Follow to Eyes: the body stays while the camera is still metres behind it, and goes once the camera is at its eyes', () => {
    const t = setup();
    t.views.lock('a');
    t.run(6);
    t.views.setView('eyes');
    t.run(2 * dt); // the switch has begun; the camera is still about 9 m back
    expect(t.hidden.size).toBe(0);
    expect(t.planes()).toEqual([0.1, 8000]);
    t.run(1);
    expect(t.hidden.has('a')).toBe(true);
    expect(t.planes()).toEqual([small, CLOSE_FAR]);
  });

  it('Eyes to Follow: the body stays hidden and the near plane small while the camera is still at the eyes', () => {
    const t = setup();
    t.views.lock('a', 'eyes');
    t.run(8);
    expect(t.hidden.has('a')).toBe(true);
    t.views.setView('follow');
    t.run(2 * dt);
    expect(t.hidden.has('a')).toBe(true);
    expect(t.planes()).toEqual([small, CLOSE_FAR]);
    t.run(1);
    expect(t.hidden.size).toBe(0);
    expect(t.planes()).toEqual([0.1, 8000]);
  });

  it('Close to Follow: the near plane stays small until the camera has stood back', () => {
    const t = setup();
    t.views.lock('a', 'close');
    t.run(8);
    expect(t.planes()).toEqual([small, CLOSE_FAR]);
    expect(t.hidden.size).toBe(0); // only Eyes hides the body
    t.views.setView('follow');
    t.run(2 * dt);
    expect(t.planes()).toEqual([small, CLOSE_FAR]);
    t.run(1);
    expect(t.planes()).toEqual([0.1, 8000]);
  });

  it('stepping to a neighbour in Eyes gives the old body back at once, and hides the new one once the camera is at its eyes', () => {
    const t = setup();
    t.views.lock('a', 'eyes');
    t.run(8);
    expect(t.hidden.has('a')).toBe(true);
    t.wire.act('next');
    t.run(dt);
    expect(t.views.state.id).toBe('b');
    expect(t.hidden.has('a')).toBe(false);
    t.run(3);
    expect(t.hidden.has('b')).toBe(true);
    expect([...t.hidden]).toEqual(['b']);
  });

  it("opens the map, steers its cursor each frame before the camera moves, and chooses on it", () => {
    const calls: string[] = [];
    const map = { open: () => void calls.push('open'), steer: (_: number, h: WireHands) => void calls.push(`steer ${h.zoom}`), choose: () => void calls.push('choose') };
    const t = setup({ extra: { map } });
    t.wire.act('map');
    expect(t.views.state.mode).toBe('map');
    t.run(dt, { ...idle, zoom: 1 });
    t.wire.act('choose');
    expect(calls).toEqual(['open', 'steer 1', 'choose']);
    t.wire.act('closeMap');
    expect(t.views.state.mode).toBe('diving'); // back down to where it was opened from
  });

  describe('the Eyes lens', () => {
    const DEG = Math.PI / 180;
    /** The camera's width across (degrees) at its aspect now. */
    const across = (c: PerspectiveCamera) => (2 * Math.atan(Math.tan((c.fov * DEG) / 2) * c.aspect)) / DEG;
    const deerDay = lensFor(deerRecipe.mind.senses, 1, false);

    it('leaves the camera and the picture alone in free flight and in Follow', () => {
      const t = setup();
      t.run(1);
      expect(t.camera.fov).toBe(55);
      t.views.lock('a');
      t.run(6);
      expect(t.camera.fov).toBe(55);
      expect([t.lens.barrel.value, t.lens.muted.value, t.lens.exposure.value]).toEqual([0, 0, 0]);
    });

    it("eases the deer's width and look in over half a second in Eyes, and out again, back to the camera's own 55°", () => {
      const t = setup();
      t.views.lock('a');
      t.run(6);
      t.views.setView('eyes');
      t.run(0.25);
      const half = t.lens.muted.value;
      expect(half).toBeGreaterThan(0.1);
      expect(half).toBeLessThan(0.75);
      expect(across(t.camera)).toBeGreaterThan(86);
      expect(across(t.camera)).toBeLessThan(deerDay.hfov - 1);
      t.run(1);
      expect(across(t.camera)).toBeCloseTo(deerDay.hfov, 6);
      expect(t.lens.muted.value).toBeCloseTo(0.85, 12);
      expect(t.lens.barrel.value).toBeCloseTo(deerDay.barrel, 12);
      t.views.setView('follow');
      t.run(0.6);
      expect(t.camera.fov).toBe(55);
      expect([t.lens.barrel.value, t.lens.sideBlur.value, t.lens.muted.value]).toEqual([0, 0, 0]);
    });

    it("keeps the deer's width across when the window changes shape", () => {
      const t = setup();
      t.views.lock('a', 'eyes');
      t.run(8);
      t.camera.aspect = 4 / 3;
      t.run(dt);
      expect(across(t.camera)).toBeCloseTo(deerDay.hfov, 6);
    });

    it('lifts the night for the deer after dark', () => {
      const t = setup({ light: 0 });
      t.views.lock('a', 'eyes');
      t.run(8);
      expect(t.lens.exposure.value).toBeCloseTo(1.5 * deerRecipe.mind.senses.night, 6);
      expect(t.lens.grain.value).toBeGreaterThan(0);
    });

    it('knows when the eye is under the water', () => {
      const wet: FlyWorld = { ...world, isWater: () => true, waterLevelAt: () => 5 };
      const t = setup({ world: wet });
      t.animals.a = { ...t.animals.a, swimmer: true, eye: { ...t.animals.a.eye, pos: { ...t.animals.a.eye.pos, y: 1.3 } } };
      t.views.lock('a', 'eyes');
      t.run(8);
      expect(t.lens.underwater.value).toBe(1);
      expect(t.lens.surface.value).toBe(5); // the surface over the eye, for the look from under it
    });

    it('lets go: the lens eases out with the camera', () => {
      const t = setup();
      t.views.lock('a', 'eyes');
      t.run(8);
      t.wire.act('letGo');
      t.run(0.6);
      expect(t.camera.fov).toBe(55);
      expect(t.lens.muted.value).toBe(0);
    });
  });
});

describe('ViewsWire senses', () => {
  /** A deer that senses `fear` and knows of `threat`, with hearing, smell and Fear. */
  const fearful = (sense: Partial<Sensing> = {}) => setup({ sensing: () => ({ senses: ['hearing', 'smell', 'fear'], fear: 0, threat: null, prey: null, ...sense }) });

  it('steps X through the animal’s senses and back to off, explaining each the first time only', () => {
    const t = fearful();
    t.views.lock('a');
    t.run(6);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i++) t.wire.act('sense'), t.run(dt), seen.push(t.views.state.sense);
    expect(seen).toEqual(['hearing', 'smell', 'fear', null]);
    t.wire.act('sense');
    t.run(dt);
    expect(t.views.state.sense).toBe('hearing');
    expect(t.shown.line).toBeNull(); // told once this session
    const u = setup({ sensing: () => ({ senses: ['smell'], fear: 0, threat: null, prey: 'the rabbits' }) });
    u.views.lock('a');
    u.run(6);
    u.wire.act('sense');
    u.run(dt);
    expect(u.shown.line).toBe('The deer can smell where the rabbits have been.');
    u.run(6);
    expect(u.shown.line).toBeNull(); // gone after a few seconds
  });

  it('keeps the order X started with, however the fear comes and goes, and always reaches off', () => {
    const fear = { afraid: false };
    const t = setup({ sensing: () => ({ senses: fear.afraid ? ['fear', 'hearing', 'smell'] : ['hearing', 'smell', 'fear'], fear: 0, threat: null, prey: null }) });
    t.views.lock('a');
    t.run(6);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i++) t.wire.act('sense'), t.run(dt), seen.push(t.views.state.sense), (fear.afraid = !fear.afraid);
    expect(seen).toEqual(['hearing', 'smell', 'fear', null]);
    // off again: the next cycle starts from the order now (afraid: Fear first)
    fear.afraid = true;
    t.wire.act('sense');
    expect(t.views.state.sense).toBe('fear');
    for (let i = 0; i < 3; i++) (fear.afraid = !fear.afraid), t.wire.act('sense');
    expect(t.views.state.sense).toBeNull();
  });

  it('Fear switched back on while it eases out carries on without a jump', () => {
    // half afraid: the beat's own steepest step is about 0.035 a frame at 60 a second
    // at several points in the beat
    for (let i = 0; i < 8; i++) {
      const t = setup({ sensing: () => ({ senses: ['fear'], fear: 0.5, threat: null, prey: null }) });
      t.views.lock('a');
      t.run(6);
      t.wire.act('sense');
      let last = 0, jump = 0;
      const watch = (secs: number) => {
        for (let s = 0; s < secs; s += dt) t.run(dt), (jump = Math.max(jump, Math.abs(t.lens.edge.value - last))), (last = t.lens.edge.value);
      };
      watch(1 + i * 0.08);
      t.wire.act('sense'); // off
      watch(0.2);
      t.wire.act('sense'); // on again, half way out
      watch(1);
      expect(t.lens.edge.value).toBeGreaterThan(0);
      expect(jump).toBeLessThan(0.05);
    }
  });

  it('Fear: the edges pulse, gently, and the heartbeat quickens with the fear; off, they ease out and stop', () => {
    const fear = { level: 0 };
    const t = setup({ sensing: () => ({ senses: ['fear'], fear: fear.level, threat: null, prey: null }) });
    t.views.lock('a');
    t.run(6);
    expect(t.lens.edge.value).toBe(0);
    t.wire.act('sense');
    let last = 0, top = 0, jump = 0;
    for (let i = 0; i < 240; i++) {
      t.run(dt);
      const e = t.lens.edge.value;
      (jump = Math.max(jump, Math.abs(e - last))), (top = Math.max(top, e)), (last = e);
    }
    expect(top).toBeGreaterThan(0.05);
    expect(top).toBeLessThan(0.2); // calm: faint
    expect(jump).toBeLessThan(0.05);
    expect(t.shown.beat).toEqual({ bpm: 50, on: true });
    fear.level = 1;
    t.run(4);
    expect(t.shown.beat.bpm).toBeGreaterThan(135);
    t.wire.act('sense'); // off
    t.run(1);
    expect(t.lens.edge.value).toBe(0);
    expect(t.shown.beat.on).toBe(false);
  });

  it('Smell: the trails round the animal are laid afresh a few times a second and eased in; off, eased out, then left alone', () => {
    const laid: { id: string; now: number }[] = [], ks: number[] = [];
    const clock = { t: 100 };
    const scents = (id: string): Scents => ({ at: { x: id === 'a' ? 0 : 3, z: 0 }, range: 40, points: [] });
    const mesh = { object: null as never, lay: (s: Scents, now: number) => void laid.push({ id: s.at.x === 0 ? 'a' : 'b', now }), frame: (_: number, k: number) => void ks.push(k) };
    const t = setup({ sensing: () => ({ senses: ['smell'], fear: 0, threat: null, prey: 'the rabbits' }), smell: { mesh, scents, time: () => clock.t } });
    t.views.lock('a');
    t.run(6);
    expect(laid).toEqual([]);
    expect(ks).toEqual([]); // off: nothing touched
    t.wire.act('sense');
    t.run(1);
    expect(laid.length).toBeGreaterThanOrEqual(4);
    expect(laid.length).toBeLessThanOrEqual(5); // every 0.25 s
    expect(laid.every((l) => l.id === 'a' && l.now === 100)).toBe(true);
    expect(ks[0]).toBeGreaterThan(0);
    expect(ks[0]).toBeLessThan(0.05); // eased in, not a jump
    expect(ks.at(-1)).toBe(1);
    t.wire.act('sense'); // off
    const before = laid.length;
    t.run(1);
    expect(laid.length).toBe(before); // nothing laid while it eases out
    expect(ks.at(-1)).toBe(0);
    const frames = ks.length;
    t.run(1);
    expect(ks.length).toBe(frames); // right out: left alone
  });

  it('Fear: the danger gets the red ring in view, the edge arc on its side out of view', () => {
    const t = fearful({ threat: 'b' });
    t.views.lock('a');
    t.run(6);
    t.wire.act('sense');
    t.wire.act('sense');
    t.wire.act('sense'); // hearing, smell, fear
    t.animals.b = deer(0, -30); // ahead of the camera (at the origin, looking along -z)
    t.run(dt);
    expect(t.shown.ring).toBe(t.animals.b.pose);
    expect(t.shown.arc).toBeNull();
    t.animals.b = deer(-10, 30); // behind, to the left
    t.run(dt);
    expect(t.shown.ring).toBeNull();
    expect(t.shown.arc).toBe('left');
    t.animals.b = deer(200, -30); // ahead but far off to the right, out of the picture
    t.run(dt);
    expect(t.shown.arc).toBe('right');
    t.wire.act('sense'); // off
    t.run(dt);
    expect(t.shown.ring).toBeNull();
    expect(t.shown.arc).toBeNull();
  });
});

describe('ViewsWire reins', () => {
  /** The wiring with the reins' simulation side faked: the steering sent, the clock held, and the animals' time (ticked by hand). */
  function reined() {
    const sent: { id: string; input: SteerInput | null }[] = [], clock = { held: 0, given: 0 }, sim = { t: 0 };
    const t = setup({
      extra: {
        reins: {
          steer: (id, input) => void sent.push({ id, input }), time: () => sim.t, heading: () => 0.5, flies: () => false,
          take: () => void clock.held++, give: () => void clock.given++,
        },
      },
    });
    return { ...t, sent, clock, sim, last: () => sent.at(-1)!.input };
  }
  const push: WireHands = { ...idle, moved: true, any: true, stick: { x: 0, y: 1 }, run: true };

  it('taking the reins holds the clock once and says whose they are; steering follows the stick from the camera', () => {
    const t = reined();
    t.views.lock('a');
    t.run(6);
    t.wire.act('reins');
    t.run(dt, push);
    expect(t.views.state.reins).toBe(true);
    expect(t.clock.held).toBe(1);
    expect(t.shown.tag ?? t.shown.line).toBe("You're the deer!");
    const s = t.last()!;
    expect(s.speed).toBe(1);
    expect(s.run).toBe(true);
    // the camera in Follow looks along -z behind the deer: up on the stick heads -z (the simulation's π)
    expect(Math.abs(Math.abs(s.yaw) - Math.PI)).toBeLessThan(0.05);
    expect(t.shown.hints).toContain('Run');
    t.run(0.5);
    expect(t.clock.held).toBe(1);
    expect(t.last()).toMatchObject({ speed: 0, yaw: 0.5, run: false }); // the stick let go: it stands, facing its own way
  });

  it('holds Do down until the simulation has ticked with it', () => {
    const t = reined();
    t.views.lock('a');
    t.run(6);
    t.wire.act('reins');
    t.run(dt);
    t.wire.act('do');
    t.run(dt);
    t.run(dt);
    expect(t.sent.slice(-2).map((x) => x.input!.act)).toEqual([true, true]); // no tick yet
    t.sim.t += 0.1; // a tick
    t.run(dt);
    expect(t.last()!.act).toBe(false);
  });

  it('pauses the reins while the steered hunter eats its catch', () => {
    const t = reined();
    t.views.lock('a');
    t.run(6);
    t.wire.act('reins');
    t.animals.a = { ...t.animals.a, doing: 'eat' };
    t.run(dt, push);
    expect(t.last()).toMatchObject({ speed: 0, run: false, fly: 0 });
    t.run(25); // the meal outlasts the idle hand-back: the reins wait for it
    expect(t.views.state.reins).toBe(true);
    t.animals.a = { ...t.animals.a, doing: 'watch' };
    t.run(dt, push);
    expect(t.last()!.speed).toBe(1);
  });

  it('hands back after 20 s with no input: the animal let go in the simulation, the clock given back once', () => {
    const t = reined();
    t.views.lock('a');
    t.run(6);
    t.wire.act('reins');
    t.run(dt);
    t.run(19);
    expect(t.views.state.reins).toBe(true);
    t.run(2);
    expect(t.views.state.mode).toBe('locked');
    expect(t.last()).toBeNull();
    expect(t.clock.given).toBe(1);
    t.run(1);
    expect(t.clock.given).toBe(1);
  });

  it('hands back however the reins end: the animal let go in the simulation, the clock given back once', () => {
    for (const end of ['reins', 'letGo'] as const) {
      const t = reined();
      t.views.lock('a');
      t.run(6);
      t.wire.act('reins');
      t.run(dt);
      t.wire.act(end);
      expect(t.last()).toBeNull();
      expect(t.sent.at(-1)!.id).toBe('a');
      expect(t.clock.given).toBe(1);
      t.run(dt);
      expect(t.clock.given).toBe(1);
    }
  });
});

describe('ViewsWire hearing and sharp eyes', () => {
  /** A deer that has only Sharp eyes, spotting animal `b` moving 40 m ahead of `a` (its prey); the shimmer rings' glows shown, frame by frame (null: none). */
  function sharpEyed() {
    const shimmer: (number | null)[] = [];
    const rings = [0, 1].map(() => ({ object: null as never, show: (a: unknown, _t: number, k = 1) => void shimmer.push(a ? k : null) }));
    const seen: Sighting[] = [{ id: 'b', pose: deer(0, -40).pose, speed: 3, prey: true }];
    const t = setup({ sensing: () => ({ senses: ['sharp'], fear: 0, threat: null, prey: null }), extra: { sharp: { rings, sightings: () => ({ range: 200, seen }) } } });
    return { ...t, shimmer, across: () => (2 * Math.atan(Math.tan((t.camera.fov * Math.PI) / 360) * t.camera.aspect) * 180) / Math.PI };
  }

  it('Sharp eyes in Eyes narrow the view to 20° across, eased, and shimmer the moving prey; off, the width and the shimmer ease back out', () => {
    const t = sharpEyed();
    t.views.lock('a', 'eyes');
    t.run(6);
    const lens = t.camera.fov;
    t.wire.act('sense');
    t.run(2);
    expect(t.views.state.sense).toBe('sharp');
    expect(t.across()).toBeCloseTo(20, 3);
    expect(t.shimmer.at(-1)).toBeGreaterThan(0.6); // the prey, at the full shimmer
    t.wire.act('sense'); // off
    t.run(dt);
    const fading = t.shimmer.at(-1)!;
    expect(fading).toBeGreaterThan(0); // the ring fades where it was, never vanishing at once
    expect(fading).toBeLessThan(0.7);
    t.run(2);
    expect(t.camera.fov).toBeCloseTo(lens, 6);
    expect(t.shimmer.at(-1)).toBeNull();
  });

  it('Sharp eyes in Follow keep its own width (no zoom onto the animal) but still shimmer across the picture', () => {
    const t = sharpEyed();
    t.views.lock('a');
    t.run(6);
    const own = t.camera.fov;
    t.wire.act('sense');
    t.run(2);
    expect(t.views.state.sense).toBe('sharp');
    expect(t.camera.fov).toBe(own);
    expect(t.shimmer.at(-1)).toBeGreaterThan(0.6);
  });

  it('Hearing: the ripples ease in, and one heard out of view shows as the pale arc on its side', () => {
    const frames: { sounds: Sound[] | null; k: number }[] = [];
    const mesh = { object: null as never, frame: (sounds: Sound[] | null, _dt: number, _t: number, k: number) => void frames.push({ sounds, k }) };
    const t = setup({
      sensing: () => ({ senses: ['hearing'], fear: 0, threat: null, prey: null }),
      extra: { hearing: { mesh, heard: () => [{ id: 'b', pose: t.animals.b.pose, loud: 0.6 }] } },
    });
    t.views.lock('a');
    t.run(6);
    expect(frames.length).toBe(0); // off: nothing done
    t.wire.act('sense');
    t.animals.b = deer(-10, 40); // behind, to the left
    t.run(1);
    expect(frames.at(-1)!.k).toBe(1);
    expect(t.shown.arc).toBe('left');
    expect(t.shown.tone).toBe('sound');
    t.wire.act('sense'); // off
    t.run(1);
    expect(frames.at(-1)!.k).toBe(0);
    expect(t.shown.arc).toBeNull();
  });
});
