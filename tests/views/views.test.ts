import { describe, expect, it } from 'vitest';
import type { FlyWorld } from '../../src/camera/freefly';
import type { Candidate } from '../../src/views/aim';
import { followFraming } from '../../src/views/follow';
import type { Pose } from '../../src/views/types';
import type { Viewpoint } from '../../src/valley/types';
import { Views, type ViewAnimal, type ViewInput } from '../../src/views/views';

/** A flat dry world with no trees. */
const world: FlyWorld = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, inside: () => true, trunksNear: () => [] };
const dt = 1 / 60;
const deg = (d: number) => (d * Math.PI) / 180;
const idle: ViewInput = { look: { yaw: 0, pitch: 0 }, zoom: 0, moved: false, any: false };
/** A deer 1.6 m long at (x, 0, z), heading along -z (camera yaw 0), eyes a little ahead and up. */
const deer = (x = 0, z = 0, over: Partial<ViewAnimal> = {}): ViewAnimal => ({
  pose: { pos: { x, y: 0, z }, yaw: 0, size: 1.6, bodyLength: 1.4, backHeight: 1.1, flying: false, turnRate: 0 },
  eye: { pos: { x, y: 1.3, z: z - 0.7 }, yaw: 0, pitch: 0 },
  name: 'Deer', native: true, doing: 'graze', swimmer: false, chasing: false, gone: null, ...over,
});
/** Move an animal (body and eyes) by (dx, dz). */
const move = (a: ViewAnimal, dx: number, dz: number) => {
  for (const p of [a.pose.pos, a.eye.pos]) (p.x += dx), (p.z += dz);
};
/** The map's pose in these tests: high over the middle, looking 75° down to the north. */
const MAP_UP: Pose = { pos: { x: 0, y: 1400, z: 380 }, yaw: 0, pitch: deg(-75) };
const gap = (a: Pose, b: Pose) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
const flat = (p: Pose, a: ViewAnimal) => Math.hypot(p.pos.x - a.pose.pos.x, p.pos.z - a.pose.pos.z);

/** A views controller over these animals, with a camera standing at `start`, a clock (ms) and the captions said. */
function rig(animals: Record<string, ViewAnimal>, start: Pose = { pos: { x: 0, y: 20, z: 60 }, yaw: 0, pitch: -0.2 }) {
  const clock = { ms: 0 }, said: string[] = [];
  const views = new Views({ world, animal: (id) => animals[id] ?? null, say: (t) => said.push(t), now: () => clock.ms, mapPose: () => MAP_UP });
  const r = {
    views, said, clock, pose: start, out: null as Pose | null, maxStep: 0,
    /** One frame: the camera goes where the views put it (or stays, in free flight). */
    step(input: ViewInput = idle, rate = 1) {
      clock.ms += dt * 1000;
      const out = views.update(dt, input, r.pose, rate);
      if (out) (r.maxStep = Math.max(r.maxStep, gap(out, r.pose))), (r.pose = out);
      r.out = out;
      return out;
    },
    /** `secs` of frames, calling `each` before each one. */
    run(secs: number, input: ViewInput = idle, each?: () => void, rate = 1) {
      for (let t = 0; t < secs - 1e-9; t += dt) each?.(), r.step(input, rate);
      return r.pose;
    },
    /** Lock on to `id` and ride the glide in. */
    locked(id: string) {
      views.lock(id);
      r.run(6);
      r.maxStep = 0;
    },
  };
  return r;
}

describe('Views', () => {
  it('lock glides then locks in Follow', () => {
    const a = deer(), r = rig({ a });
    r.views.lock('a');
    expect(r.views.state).toMatchObject({ mode: 'gliding', id: 'a', view: 'follow' });
    r.step();
    expect(r.maxStep).toBeLessThan(1); // a glide, not a jump
    let t = 0;
    while (r.views.state.mode === 'gliding' && t < 6) r.step(), (t += dt);
    expect(r.views.state.mode).toBe('locked');
    r.run(2);
    const { back, up } = followFraming(1.6);
    expect(Math.hypot(flat(r.pose, a), r.pose.pos.y)).toBeCloseTo(Math.hypot(back, up), 0);
    expect(r.pose.pos.z).toBeGreaterThan(back - 1); // behind it (it heads along -z)
  });

  it('shown: what is drawn while riding along, none while gliding there or in free flight', () => {
    const a = deer(), r = rig({ a });
    expect(r.views.shown).toBeNull();
    r.views.lock('a');
    r.step();
    expect(r.views.shown).toBeNull(); // gliding there
    r.run(6);
    expect(r.views.shown).toBe('follow');
    r.views.setView('eyes');
    r.step();
    expect(r.views.shown).toBe('eyes');
    a.chasing = true;
    r.step();
    expect(r.views.shown).toBe('wide'); // a chase widens Eyes out to a wide Follow
    r.views.letGo();
    expect(r.views.shown).toBeNull();
  });

  it('lands behind an animal that walked on during the glide', () => {
    const a = deer(), r = rig({ a });
    r.views.lock('a');
    let t = 0;
    while (r.views.state.mode === 'gliding' && t < 6) move(a, 0, -6 * dt), r.step(), (t += dt);
    expect(r.views.state.mode).toBe('locked');
    expect(a.pose.pos.z).toBeLessThan(-8); // it went some way
    expect(flat(r.pose, a)).toBeCloseTo(followFraming(1.6).back, 0); // arrived at its Follow spot now, not where it was
    expect(r.pose.pos.z).toBeGreaterThan(a.pose.pos.z);
  });

  it('setView blends: no jump over 0.5 m in one 1/60 s frame', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.views.setView('close');
    expect(r.views.state.view).toBe('close');
    r.run(1.5);
    expect(r.maxStep).toBeLessThan(0.5);
    expect(r.pose.pos.z).toBeCloseTo(1.2 * 1.4, 1); // at the shoulder
    r.maxStep = 0;
    r.views.setView('eyes');
    r.run(1.5);
    expect(r.maxStep).toBeLessThan(0.5);
    expect(gap(r.pose, { pos: a.eye.pos, yaw: 0, pitch: 0 })).toBeLessThan(0.05);
    r.maxStep = 0;
    r.views.setView('follow');
    r.run(1.5);
    expect(r.maxStep).toBeLessThan(0.5);
    expect(flat(r.pose, a)).toBeGreaterThan(5);
  });

  it('cycleView goes follow → close → eyes → follow', () => {
    const r = rig({ a: deer() });
    r.locked('a');
    const seen = [r.views.state.view];
    for (let i = 0; i < 3; i++) r.views.cycleView(), seen.push(r.views.state.view);
    expect(seen).toEqual(['follow', 'close', 'eyes', 'follow']);
  });

  it('letGo returns null from update', () => {
    const r = rig({ a: deer() });
    r.locked('a');
    r.views.letGo();
    expect(r.step()).toBeNull();
    expect(r.views.state).toMatchObject({ mode: 'free', id: null, reins: false });
  });

  it('moving the left stick in locked mode lets go; in reins mode moving does not', () => {
    const r = rig({ a: deer() });
    r.locked('a');
    r.views.reins(true);
    expect(r.views.state).toMatchObject({ mode: 'reins', reins: true });
    expect(r.step({ ...idle, moved: true, any: true })).not.toBeNull();
    expect(r.views.state.mode).toBe('reins');
    r.views.reins(false);
    expect(r.views.state).toMatchObject({ mode: 'locked', reins: false });
    r.step(); // the stick let go after steering
    expect(r.step({ ...idle, moved: true, any: true })).toBeNull();
    expect(r.views.state.mode).toBe('free');
  });

  it('a stick still held from flying does not throw away a fresh lock: it has to be let go first', () => {
    const r = rig({ a: deer() }), pushed = { ...idle, moved: true, any: true };
    r.run(0.5, pushed); // flying toward the deer
    r.views.lock('a'); // A while still pushing the stick
    r.run(1, pushed);
    expect(r.views.state).toMatchObject({ mode: 'gliding', id: 'a' });
    r.run(5, pushed);
    expect(r.views.state).toMatchObject({ mode: 'locked', id: 'a' });
    r.step(); // let go, then push afresh: now it takes the camera
    expect(r.step(pushed)).toBeNull();
    expect(r.views.state.mode).toBe('free');
  });

  it('handing back the reins while still steering stays locked on until the stick is let go and pushed again', () => {
    const r = rig({ a: deer() }), pushed = { ...idle, moved: true, any: true };
    r.locked('a');
    r.views.reins(true);
    r.run(1, pushed); // steering
    r.views.reins(false); // B with the stick still pushed
    r.run(1, pushed);
    expect(r.views.state).toMatchObject({ mode: 'locked', id: 'a', reins: false });
    r.step();
    expect(r.step(pushed)).toBeNull();
    expect(r.views.state.mode).toBe('free');
  });

  it('moving the left stick during the glide takes the camera', () => {
    const r = rig({ a: deer() });
    r.views.lock('a');
    r.run(0.5);
    expect(r.step({ ...idle, moved: true, any: true })).toBeNull();
    expect(r.views.state.mode).toBe('free');
  });

  it('the animal going lets go with its caption', () => {
    const a = deer(0, 0, { name: 'Rabbit' }), r = rig({ a });
    r.locked('a');
    a.gone = 'earth';
    expect(r.step()).toBeNull();
    expect(r.said).toEqual(['The rabbit has gone back to the earth.']);
    expect(r.views.state.mode).toBe('free');

    const b = deer(0, 0, { name: 'Bramble', native: false }), s = rig({ b });
    s.locked('b');
    b.gone = 'exploring';
    s.step();
    b.gone = 'earth';
    s.views.lock('b');
    s.step();
    expect(s.said).toEqual(['Bramble has gone exploring.', 'Bramble has gone back to the earth.']);
    expect(s.views.state.mode).toBe('free');
  });

  it('an animal removed from the valley lets go quietly', () => {
    const animals: Record<string, ViewAnimal> = { a: deer() }, r = rig(animals);
    r.locked('a');
    delete animals.a;
    expect(r.step()).toBeNull();
    expect(r.said).toEqual([]);
    expect(r.views.state.mode).toBe('free');
  });

  it('a stowed animal is still followed', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    // stowed (not drawn) and walking away: the views only read its pose, so the camera keeps with it
    r.run(8, idle, () => move(a, 0, -3 * dt));
    expect(a.pose.pos.z).toBeCloseTo(-24, 0);
    expect(flat(r.pose, a)).toBeLessThan(followFraming(1.6).back + 0.9 * 3 + 1); // its framing, plus Follow's lag (0.9 s) at 3 m/s
  });

  it('a chase widens the view and a miss gives it back', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.views.setView('eyes');
    r.run(1.5);
    expect(gap(r.pose, { pos: a.eye.pos, yaw: 0, pitch: 0 })).toBeLessThan(0.05);
    a.chasing = true;
    a.doing = 'chase';
    r.run(5);
    expect(r.views.state.view).toBe('eyes'); // the player's view stands
    expect(flat(r.pose, a)).toBeGreaterThan(2 * followFraming(1.6).back); // wide Follow
    expect(Math.abs(r.pose.pos.x - a.pose.pos.x)).toBeGreaterThan(5); // swung to the side
    r.maxStep = 0;
    a.chasing = false; // a miss
    a.doing = 'walk';
    r.run(1);
    expect(gap(r.pose, { pos: a.eye.pos, yaw: 0, pitch: 0 })).toBeLessThan(0.05); // back in Eyes after the blend
    expect(r.maxStep).toBeLessThan(1.5);
  });

  it('after a catch the hunter stays wide while it eats, then goes back', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.views.setView('close');
    a.chasing = true;
    r.run(5);
    a.chasing = false;
    a.doing = 'eat';
    r.run(5);
    expect(flat(r.pose, a)).toBeGreaterThan(2 * followFraming(1.6).back);
    a.doing = 'rest';
    r.run(1.5);
    expect(r.pose.pos.z).toBeCloseTo(1.2 * 1.4, 1);
  });

  it('a hunter at its meal is never seen up close: Y, LB / RB or a lock in Close or Eyes ride wide until it is done', () => {
    const wide = (r: ReturnType<typeof rig>, a: ViewAnimal) => flat(r.pose, a) > 2 * followFraming(1.6).back;
    // watched in Follow through the catch, then Y during the meal
    const a = deer(), r = rig({ a });
    r.locked('a');
    a.chasing = true;
    a.doing = 'chase';
    r.run(3);
    a.chasing = false;
    a.doing = 'eat';
    r.run(1);
    for (const v of ['close', 'eyes'] as const) {
      r.views.setView(v);
      r.run(3);
      expect(r.views.shown, v).toBe('wide');
      expect(wide(r, a), v).toBe(true);
    }
    // stepped onto an eating hunter with LB / RB in Close
    const b = deer(), c = deer(30, 0, { doing: 'eat' }), r2 = rig({ b, c });
    r2.locked('b');
    r2.views.setView('close');
    r2.run(1.5);
    r2.views.neighbour(1, [{ id: 'b', pos: b.pose.pos, size: 1.6, drawn: true }, { id: 'c', pos: c.pose.pos, size: 1.6, drawn: true }]);
    r2.run(3);
    expect(r2.views.state).toMatchObject({ id: 'c', view: 'close' });
    expect(r2.views.shown).toBe('wide');
    expect(wide(r2, c)).toBe(true);
    // locked on in Close (the Director) while it eats
    const d = deer(0, 0, { doing: 'eat' }), r3 = rig({ d });
    r3.views.lock('d', 'close');
    r3.run(6);
    expect(r3.views.shown).toBe('wide');
    expect(wide(r3, d)).toBe(true);
    d.doing = 'rest'; // done: back to Close
    r3.run(1.5);
    expect(r3.views.shown).toBe('close');
  });

  it('on the caught prey it stays wide and lets go once sunk', () => {
    const a = deer(0, 0, { name: 'Rabbit' }), r = rig({ a });
    r.locked('a');
    r.views.setView('eyes');
    a.chasing = true; // fleeing a charging threat
    r.run(4);
    // caught: it sinks into the earth (still reported as in the chase until it has gone)
    r.run(3, idle, () => (a.pose.pos.y -= 0.1 * dt));
    expect(r.views.state.mode).toBe('locked');
    expect(flat(r.pose, a)).toBeGreaterThan(2 * followFraming(1.6).back);
    a.gone = 'earth';
    expect(r.step()).toBeNull();
    expect(r.views.state.mode).toBe('free');
    expect(r.said).toEqual(['The rabbit has gone back to the earth.']);
  });

  it('the chase does not widen a Follow the player chose', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    a.chasing = true;
    r.run(4);
    expect(flat(r.pose, a)).toBeLessThan(followFraming(1.6).back + 1);
  });

  it('orbit eases back after 8 s of no orbit while moving', () => {
    /** How far round (radians) from straight behind (it walks along -z, so behind is +z) the camera stands. */
    const round = (p: Pose, a: ViewAnimal) => Math.abs(Math.atan2(p.pos.x - a.pose.pos.x, p.pos.z - a.pose.pos.z));
    const a = deer(), r = rig({ a });
    r.locked('a');
    const walk = () => move(a, 0, -1.5 * dt);
    r.run(3, idle, walk);
    r.run(0.5, { ...idle, look: { yaw: deg(90) * 2 * dt, pitch: 0 }, any: true }, walk); // a quarter turn round it
    r.run(5, idle, walk);
    expect(round(r.pose, a)).toBeGreaterThan(deg(60)); // the orbit is kept
    r.run(12, idle, walk);
    expect(round(r.pose, a)).toBeLessThan(deg(10)); // eased back to behind it
  });

  it('a still animal keeps the orbit', () => {
    const round = (p: Pose, a: ViewAnimal) => Math.abs(Math.atan2(p.pos.x - a.pose.pos.x, p.pos.z - a.pose.pos.z));
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.run(0.5, { ...idle, look: { yaw: deg(90) * 2 * dt, pitch: 0 }, any: true });
    r.run(20);
    expect(round(r.pose, a)).toBeGreaterThan(deg(60));
  });

  it('RT pushes Follow back and LT brings it nearer', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    const near = flat(r.pose, a);
    r.run(3, { ...idle, zoom: 1, any: true });
    r.run(3);
    expect(flat(r.pose, a)).toBeGreaterThan(1.8 * near);
    r.run(5, { ...idle, zoom: -1, any: true });
    r.run(3);
    expect(flat(r.pose, a)).toBeLessThan(0.7 * near);
  });

  it('look in Close springs back within 1 s of release', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.views.setView('close');
    r.run(1.5);
    r.run(0.25, { ...idle, look: { yaw: deg(60) * 4 * dt, pitch: 0 }, any: true });
    expect(r.pose.yaw).toBeGreaterThan(deg(50));
    r.run(1);
    expect(Math.abs(r.pose.yaw)).toBeLessThan(deg(2));
  });

  it('reins hand back after 20 s of no input (real seconds)', () => {
    const a = deer(), r = rig({ a });
    let handed = 0;
    r.views.onReinsOff = () => handed++;
    r.locked('a');
    r.views.reins(true);
    r.run(15);
    r.step({ ...idle, any: true }); // a touch restarts the wait
    r.run(19);
    expect(r.views.state).toMatchObject({ mode: 'reins', reins: true });
    r.clock.ms += 1500; // real time passes (a slow frame)
    r.step();
    expect(r.views.state).toMatchObject({ mode: 'locked', reins: false, id: 'a' });
    expect(handed).toBe(1);
  });

  it('letting go from the reins hands them back first', () => {
    const r = rig({ a: deer() });
    let handed = 0;
    r.views.onReinsOff = () => handed++;
    r.locked('a');
    r.views.reins(true);
    r.views.letGo();
    expect(handed).toBe(1);
    expect(r.views.state.mode).toBe('free');
  });

  it('neighbour glides across in the same view', () => {
    const a = deer(), b = deer(30, 0, { name: 'Fox' }), r = rig({ a, b });
    r.locked('a');
    r.views.setView('close');
    r.run(1.5);
    r.maxStep = 0;
    const cands: Candidate[] = [{ id: 'a', pos: a.pose.pos, size: 1.6, drawn: true }, { id: 'b', pos: b.pose.pos, size: 1.6, drawn: true }];
    r.views.neighbour(1, cands); // b is to the right of the camera behind a
    expect(r.views.state).toMatchObject({ mode: 'locked', id: 'b', view: 'close' });
    r.step();
    expect(r.maxStep).toBeLessThan(0.5); // a glide, not a cut
    r.run(2.5);
    expect(r.pose.pos.x).toBeCloseTo(30, 1);
    expect(r.pose.pos.z).toBeCloseTo(1.2 * 1.4, 1);
    expect(r.maxStep).toBeLessThan(2);
  });

  it('the map glides up to its pose in 2–3 s, a glide, not a cut, and holds there', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.views.openMap();
    expect(r.views.state.mode).toBe('map');
    expect(r.views.mapIn).toBe(0);
    r.run(1);
    expect(r.views.mapIn).toBeGreaterThan(0);
    expect(r.views.mapIn).toBeLessThan(1);
    expect(r.pose.pos.y).toBeGreaterThan(100);
    r.run(1.6);
    expect(r.views.mapIn).toBe(1);
    expect(gap(r.pose, MAP_UP)).toBeLessThan(1e-9);
    expect(r.maxStep).toBeLessThan(30); // about 1.4 km in 2.5 s, eased
    r.run(1, { ...idle, moved: true }); // the stick moves the map's cursor: it never lets go
    expect(r.views.state.mode).toBe('map');
    expect(gap(r.pose, MAP_UP)).toBeLessThan(1e-9);
  });

  it('the map goes back where you were: the lock, in its view, with its sense', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.views.setView('close');
    r.views.sense('smell');
    r.run(1.5);
    r.views.openMap();
    r.run(3);
    expect(r.views.state.sense).toBe('smell'); // kept while the map is up (nothing shows it there)
    r.views.closeMap();
    expect(r.views.state).toMatchObject({ mode: 'gliding', id: 'a', view: 'close', sense: 'smell' });
    r.run(4);
    expect(r.views.state).toMatchObject({ mode: 'locked', id: 'a', view: 'close', sense: 'smell' });
    expect(r.views.mapIn).toBe(0);
    expect(r.pose.pos.z).toBeCloseTo(1.2 * 1.4, 1);

    // from free flight: a dive back to where the map was opened from, then free flight has the camera there
    const s = rig({ a: deer() }), at = s.pose;
    s.step();
    s.views.openMap();
    s.run(3);
    s.views.closeMap();
    expect(s.views.state.mode).toBe('diving');
    s.run(1);
    expect(s.views.mapIn).toBeGreaterThan(0);
    s.run(2);
    expect(s.views.state.mode).toBe('free');
    expect(gap(s.pose, at)).toBeLessThan(1e-9);
    expect(s.step()).toBeNull();
  });

  it('an animal that went while the map was up: its caption on closing, and back where the map was opened from', () => {
    const a = deer(0, 0, { name: 'Bramble', native: false }), r = rig({ a });
    r.locked('a');
    const at = r.pose;
    r.views.openMap();
    r.run(3);
    a.gone = 'exploring';
    r.views.closeMap();
    expect(r.said).toEqual(['Bramble has gone exploring.']);
    expect(r.views.state).toMatchObject({ mode: 'diving', id: null });
    r.run(3);
    expect(r.views.state.mode).toBe('free');
    expect(gap(r.pose, at)).toBeLessThan(1e-9);
  });

  it('choosing an animal on the map dives down to it and locks on in Follow, the stick held through the dive', () => {
    const a = deer(), b = deer(200, -100), r = rig({ a, b });
    r.locked('a');
    r.views.setView('eyes');
    r.views.sense('hearing');
    r.views.openMap();
    r.run(3);
    r.maxStep = 0;
    r.views.chooseAnimal('b');
    expect(r.views.state).toMatchObject({ mode: 'gliding', id: 'b', view: 'follow', sense: null });
    const moved = { ...idle, moved: true }; // still pushing the stick from steering the cursor
    r.run(1, moved);
    expect(r.views.state.mode).toBe('gliding');
    expect(r.views.mapIn).toBeGreaterThan(0);
    r.run(2.5, moved);
    expect(r.views.state).toMatchObject({ mode: 'locked', id: 'b', view: 'follow' });
    expect(r.views.mapIn).toBe(0);
    expect(flat(r.pose, b)).toBeLessThan(15);
    expect(r.maxStep).toBeLessThan(30);
    r.run(0.1); // let go of the stick, then push it again: now it takes the camera
    r.step(moved);
    expect(r.views.state.mode).toBe('free');

    // the animal you were watching keeps its sense
    r.locked('a');
    r.views.sense('smell');
    r.views.openMap();
    r.run(3);
    r.views.chooseAnimal('a');
    expect(r.views.state).toMatchObject({ id: 'a', sense: 'smell' });
  });

  it('choosing a place on the map dives down to its spot into free flight', () => {
    const r = rig({ a: deer() });
    r.views.openMap();
    r.run(3);
    const spot: Viewpoint = { name: '', pos: { x: 100, z: 30, h: 15 }, look: { x: 100, z: 0, h: 0 } };
    r.views.diveTo(spot);
    expect(r.views.state.mode).toBe('diving');
    r.run(1);
    expect(r.views.state.mode).toBe('diving');
    r.run(2);
    expect(r.views.state.mode).toBe('free');
    expect(r.pose.pos).toEqual({ x: 100, y: 15, z: 30 });
    expect(r.pose.pitch).toBeCloseTo(-Math.atan2(15, 30), 6);
    expect(r.step()).toBeNull();
    // only from the map
    r.views.diveTo(spot);
    r.views.chooseAnimal('a');
    expect(r.views.state.mode).toBe('free');
  });

  it('sense is stored while locked and cleared on letting go', () => {
    const r = rig({ a: deer() });
    r.views.sense('smell');
    expect(r.views.state.sense).toBeNull(); // nothing to sense with in free flight
    r.locked('a');
    r.views.sense('hearing');
    expect(r.views.state.sense).toBe('hearing');
    r.views.sense(null);
    expect(r.views.state.sense).toBeNull();
    r.views.sense('fear');
    r.views.letGo();
    expect(r.views.state.sense).toBeNull();
  });

  it('keeps up at Fastest and frames a little wider', () => {
    const a = deer(), r = rig({ a });
    r.locked('a');
    r.run(6, idle, () => move(a, 0, -16 * 3 * dt), 16); // a trot at 16x
    expect(flat(r.pose, a)).toBeGreaterThan(followFraming(1.6).back * 1.3);
    expect(flat(r.pose, a)).toBeLessThan(followFraming(1.6).back * 2.5);
  });

  describe('directed moves and place', () => {
    const A: Pose = { pos: { x: 0, y: 10, z: 0 }, yaw: 0, pitch: -0.2 }, B: Pose = { pos: { x: 20, y: 10, z: 0 }, yaw: 0, pitch: -0.2 };

    it('direct then update returns the pose of the move and calls onEnd once, then holds', () => {
      const r = rig({}), ends: number[] = [];
      r.views.direct({ kind: 'drift', from: A, to: B, s: 1 }, () => ends.push(1));
      expect(r.views.state.mode).toBe('directed');
      r.step();
      expect(r.out!.pos.x).toBeLessThan(1);
      r.run(0.5);
      expect(r.out!.pos.x).toBeGreaterThan(5);
      expect(ends).toHaveLength(0);
      r.run(1);
      r.run(1);
      expect(ends).toHaveLength(1);
      expect(r.out!.pos.x).toBeCloseTo(20); // holds the last pose
      expect(r.views.state.mode).toBe('directed');
    });

    it('ignores the player in a move', () => {
      const r = rig({});
      r.views.direct({ kind: 'hold', pose: A, s: 5 });
      r.run(1, { look: { yaw: 1, pitch: 1 }, zoom: 1, moved: true, any: true });
      expect(r.views.state.mode).toBe('directed');
      expect(r.out!.pos).toEqual(A.pos);
    });

    it('lock, place, letGo or openMap during a move ends it without onEnd', () => {
      const a = deer(), ends: number[] = [];
      for (const end of [(v: Views) => v.lock('a'), (v: Views) => v.place('a', 'follow'), (v: Views) => v.letGo(), (v: Views) => v.openMap(), (v: Views) => v.direct({ kind: 'hold', pose: B, s: 0.1 })]) {
        const r = rig({ a });
        r.views.direct({ kind: 'hold', pose: A, s: 0.5 }, () => ends.push(1));
        r.run(0.2);
        end(r.views);
        r.run(1);
      }
      expect(ends).toHaveLength(0);
    });

    it('direct hands the reins back and clears the sense', () => {
      const a = deer(), r = rig({ a });
      let handed = 0;
      r.views.onReinsOff = () => handed++;
      r.locked('a');
      r.views.reins(true);
      r.views.sense('hearing');
      r.views.direct({ kind: 'hold', pose: A, s: 1 });
      expect(handed).toBe(1);
      expect(r.views.state).toMatchObject({ mode: 'directed', reins: false, sense: null });
    });

    it('place locks at once: the first frame is the settled pose of the view, no glide', () => {
      const a = deer(), r = rig({ a }, { pos: { x: 300, y: 80, z: 300 }, yaw: 2, pitch: 0 });
      r.views.place('a', 'follow');
      expect(r.views.state).toMatchObject({ mode: 'locked', id: 'a', view: 'follow' });
      r.step();
      const { back, up } = followFraming(1.6);
      expect(Math.hypot(r.out!.pos.x - 0, r.out!.pos.z - back)).toBeLessThan(0.5);
      expect(r.out!.pos.y).toBeCloseTo(up, 0);
      expect(r.views.shown).toBe('follow');
    });

    it('place in Close and Eyes gives their usual pose; a stick held does not take the camera', () => {
      const a = deer(), r = rig({ a });
      r.views.place('a', 'close');
      r.step({ ...idle, moved: true, any: true });
      expect(r.views.state.mode).toBe('locked'); // held from before: not taken
      expect(r.out!.pos.z).toBeCloseTo(1.2 * 1.4, 1);
      r.step(); // let go
      r.step({ ...idle, moved: true, any: true });
      expect(r.views.state.mode).toBe('free'); // a fresh push takes it
      const b = deer(), r2 = rig({ b });
      r2.views.place('b', 'eyes');
      r2.step();
      expect(gap(r2.out!, { pos: b.eye.pos, yaw: 0, pitch: 0 })).toBeLessThan(0.05);
    });

    it('place on a gone animal is as lock would: the caption, then free flight', () => {
      const r = rig({ g: deer(0, 0, { gone: 'earth' }) });
      r.views.place('g');
      expect(r.step()).toBeNull();
      expect(r.said).toEqual(['The deer has gone back to the earth.']);
      expect(r.views.state.mode).toBe('free');
      r.views.place('nobody');
      expect(r.step()).toBeNull();
      expect(r.views.state.mode).toBe('free');
    });
  });
});
