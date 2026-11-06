import { describe, expect, it } from 'vitest';
import { INVITE_GAP_S, INVITE_SHOW_S, INVITE_STALE_S, InviteCards, InviteQueue, peekVantage, stillFov, storySpot, type InviteDeps, type Warm } from '../../src/director/invite';
import { AIM, type VantageWorld } from '../../src/director/vantage';
import { mulberry32 } from '../../src/util/rng';
import type { Story } from '../../src/director/types';
import type { PeekRect } from '../../src/render/peek';
import { HIGH, LOW, MEDIUM } from '../../src/sim/types';
import type { Pose } from '../../src/views/types';
import type { Vec3 } from '../../src/util/vec';

const story = (id: string, o: Partial<Story> = {}): Story => ({ id, kind: 'event', tag: 'drink', subject: `deer#${id}`, actors: [`deer#${id}`],
  species: ['deer'], at: { x: 500, z: 0 }, interest: MEDIUM, born: 0, live: true, released: false, hunt: null, ...o });
const unseen = () => false;

describe('InviteQueue', () => {
  it('has the spec numbers: one every 40 s at most, shown 12 s, stale at 30 s', () => {
    expect([INVITE_GAP_S, INVITE_SHOW_S, INVITE_STALE_S]).toEqual([40, 12, 30]);
  });

  it('offers medium and high stories only, one at a time, each for 12 s', () => {
    const q = new InviteQueue();
    q.offer(story('a', { interest: LOW }), 0);
    expect(q.update(0, false, unseen)).toBeNull();
    q.offer(story('b'), 0);
    expect(q.update(0, false, unseen)?.id).toBe('b');
    expect(q.update(11.9, false, unseen)?.id).toBe('b');
    expect(q.showing?.id).toBe('b');
    expect(q.update(12, false, unseen)).toBeNull();
    expect(q.showing).toBeNull();
  });

  it('waits 40 s from one card\'s start to the next', () => {
    const q = new InviteQueue();
    q.offer(story('a'), 0);
    q.offer(story('b'), 1);
    expect(q.update(1, false, unseen)?.id).toBe('a');
    expect(q.update(20, false, unseen)).toBeNull();
    q.offer(story('c'), 25); // b went stale at 31; c is still fresh at 41
    expect(q.update(40.9, false, unseen)).toBeNull();
    expect(q.update(41, false, unseen)?.id).toBe('c');
  });

  it('never offers what the camera already sees within 80 m, and ends a card once the camera is there', () => {
    const q = new InviteQueue();
    q.offer(story('near', { at: { x: 10, z: 0 } }), 0);
    q.offer(story('far'), 0);
    const seen = (at: { x: number; z: number }) => Math.hypot(at.x, at.z) < 80;
    expect(q.update(0, false, seen)?.id).toBe('far'); // near was dropped, not just skipped
    expect(q.update(5, false, (at) => at.x === 500)).toBeNull(); // flew there by hand
    expect(q.update(60, false, unseen)).toBeNull();
  });

  it('a story waiting more than 30 s goes stale', () => {
    const q = new InviteQueue({ gap: 0 });
    q.offer(story('a'), 0);
    q.update(0, true, unseen); // blocked
    expect(q.update(30.1, false, unseen)).toBeNull();
  });

  it('puts high stories first', () => {
    const q = new InviteQueue({ gap: 0 });
    q.offer(story('m1'), 0);
    q.offer(story('m2'), 0);
    q.offer(story('h', { interest: HIGH }), 0);
    expect(q.update(0, false, unseen)?.id).toBe('h');
  });

  it('keeps three waiting at most, dropping the oldest of the least interesting', () => {
    const q = new InviteQueue({ gap: 0, show: 1 });
    q.offer(story('m1'), 0);
    q.offer(story('h1', { interest: HIGH }), 0);
    q.offer(story('m2'), 0);
    q.offer(story('m3'), 0);
    const seen: string[] = [];
    for (let t = 0; t < 10; t++) {
      const s = q.update(t, false, unseen);
      if (s && seen.at(-1) !== s.id) seen.push(s.id);
    }
    expect(seen).toEqual(['h1', 'm2', 'm3']);
  });

  it('while blocked, hides the card for good and starts none', () => {
    const q = new InviteQueue();
    q.offer(story('a'), 0);
    expect(q.update(0, false, unseen)?.id).toBe('a');
    expect(q.update(1, true, unseen)).toBeNull();
    expect(q.update(2, false, unseen)).toBeNull();
  });

  it('never shows a catch, nor a story no longer going on; a story shown once is not offered again', () => {
    const q = new InviteQueue({ gap: 0 });
    q.offer(story('c', { tag: 'catch', interest: HIGH }), 0);
    expect(q.update(0, false, unseen)).toBeNull();
    const hunt = story('hunt', { tag: 'chase', interest: HIGH });
    q.offer(hunt, 0);
    expect(q.update(0, false, unseen)?.id).toBe('hunt');
    hunt.tag = 'catch'; // the hunt the card is about ends in a catch: the card goes
    expect(q.update(1, false, unseen)).toBeNull();
    q.offer(story('gone', { live: false }), 2);
    expect(q.update(2, false, unseen)).toBeNull();
    hunt.tag = 'escape';
    q.offer(hunt, 3);
    expect(q.update(3, false, unseen)).toBeNull();
  });

  it('a story offered again while it waits keeps one place, freshened', () => {
    const q = new InviteQueue({ gap: 0, show: 1 });
    const a = story('a');
    q.offer(a, 0);
    q.update(0, true, unseen);
    q.offer(a, 25);
    expect(q.update(40, false, unseen)?.id).toBe('a');
    expect(q.update(41, false, unseen)).toBeNull();
  });

  it('showNow shows a story at once, whatever the gap (the dev hook)', () => {
    const q = new InviteQueue();
    q.offer(story('a'), 0);
    q.update(0, false, unseen);
    q.showNow(story('b'), 1);
    expect(q.update(1, false, unseen)?.id).toBe('b');
  });
});

describe('storySpot', () => {
  const animals: Record<string, { pos: Vec3; size: number }> = { 'fox#0': { pos: { x: 0, y: 1, z: 0 }, size: 1 }, 'rabbit#0': { pos: { x: 1.2, y: 1, z: 1.6 }, size: 0.4 } };
  const animal = (id: string) => animals[id] ?? null;
  it('is the subject, framed by its size', () => {
    expect(storySpot(story('a', { subject: 'fox#0' }), animal, () => 0)).toEqual({ pos: { x: 0, y: 1, z: 0 }, size: 1 });
  });
  it('is the hunter alone when its prey is more than three of its lengths off', () => {
    const s = story('h', { subject: 'fox#0', hunt: { hunter: 'fox#0', prey: 'rabbit#1', beat: 'creep' } });
    const far = (id: string) => (id === 'rabbit#1' ? { pos: { x: 3.5, y: 1, z: 0 }, size: 0.4 } : animal(id));
    expect(storySpot(s, far, () => 0)).toEqual({ pos: { x: 0, y: 1, z: 0 }, size: 1 });
  });
  it('is the middle of a hunter and its prey near it, framed to show both', () => {
    const s = story('h', { subject: 'fox#0', hunt: { hunter: 'fox#0', prey: 'rabbit#0', beat: 'chase' } });
    const spot = storySpot(s, animal, () => 0);
    expect(spot.pos.x).toBeCloseTo(0.6);
    expect(spot.pos.z).toBeCloseTo(0.8);
    expect(spot.size).toBeCloseTo(2);
  });
  it("is the story's point on the ground when its animal has gone", () => {
    expect(storySpot(story('a', { subject: 'gone#0', at: { x: 5, z: 7 } }), animal, () => 3)).toEqual({ pos: { x: 5, y: 3, z: 7 }, size: 4 });
  });
});

describe('the still', () => {
  /** Open flat ground, no trees, no water. */
  const flat: VantageWorld = { heightAt: () => 0, isWater: () => false, waterLevelAt: () => NaN, trunksNear: () => [], inside: (x, z) => Math.abs(x) < 500 && Math.abs(z) < 500 };
  /** How much of the still's height `size` fills from `pose`, looking at `at` with a `fov`° lens. */
  const fill = (pose: Pose, at: Vec3, size: number, fov: number) =>
    size / (2 * Math.hypot(at.x - pose.pos.x, at.y - pose.pos.y, at.z - pose.pos.z) * Math.tan((fov * Math.PI) / 360));
  const shoot = (spot: { pos: Vec3; size: number }) => {
    const pose = peekVantage(spot, flat, { rng: mulberry32(3) }), fov = stillFov(pose, spot);
    return { pose, fov, at: { ...spot.pos, y: spot.pos.y + Math.min(spot.size, 2) * AIM } };
  };
  for (const [name, size] of [['a fox', 1], ['a rabbit', 0.4], ['a frog', 0.18]] as const) {
    it(`fills 0.3 of the picture with ${name}, from a safe distance with a longer lens`, () => {
      const spot = { pos: { x: 0, y: 0, z: 0 }, size }, { pose, fov, at } = shoot(spot);
      expect(Math.hypot(pose.pos.x, pose.pos.z)).toBeGreaterThanOrEqual(8 * 0.9 - 1e-9);
      expect(fov).toBeLessThan(55);
      expect(fill(pose, at, size, fov)).toBeCloseTo(0.3, 2);
    });
  }
  it('fills 0.3 with a hunter and its prey together, the hunter itself 0.1 or more', () => {
    const fox = { pos: { x: 0, y: 0, z: 0 }, size: 1 }, rabbit = { pos: { x: 2.4, y: 0, z: 1.2 }, size: 0.4 };
    const s = story('h', { subject: 'fox', hunt: { hunter: 'fox', prey: 'rabbit', beat: 'chase' } });
    const spot = storySpot(s, (id) => (id === 'fox' ? fox : rabbit), () => 0), { pose, fov, at } = shoot(spot);
    const both = fill(pose, at, spot.size, fov); // 0.3, a little more when the vantage stands nearer than the widest lens allows
    expect(both).toBeGreaterThanOrEqual(0.3 - 1e-3);
    expect(both).toBeLessThan(0.4);
    expect(fill(pose, at, fox.size, fov)).toBeGreaterThanOrEqual(0.1);
  });
  it('never takes a wider lens than the valley camera\'s', () => {
    const spot = { pos: { x: 0, y: 0, z: 0 }, size: 40 }, { fov } = shoot(spot);
    expect(fov).toBe(55);
  });
});

/** A card's world: a queue, a peek and a pre-warm that report what was done to them. */
function cards() {
  const log: string[] = [];
  let ready = false, drawn = false, doc = false;
  const camera: Vec3 = { x: 0, y: 10, z: 0 };
  const rect: PeekRect = { x: 24, y: 700, w: 384, h: 216 };
  const fades: number[] = [], fovs: number[] = [];
  const warmPose: Pose = { pos: { x: 480, y: 12, z: 0 }, yaw: 0, pitch: 0 };
  const deps: InviteDeps = {
    queue: new InviteQueue(),
    peek: {
      open: (p, fov) => void (log.push(`open ${p.pos.x}`), fovs.push(fov)), close: () => void (log.push('close'), (drawn = false)), fade: (a) => void fades.push(a),
      get drawn() { return drawn; },
    },
    prewarm: (at) => (log.push(`warm ${at.x}`), { ready: () => ready, done: () => void log.push('done'), pose: warmPose, prime: (p) => void log.push(`prime ${p}`) } satisfies Warm),
    animal: (id) => (id.startsWith('deer') ? { pos: { x: 500, y: 2, z: 0 }, size: 1.6 } : null),
    ground: () => 0,
    camera: () => camera,
    card: { show: (s, line, hint) => void log.push(s ? `card ${s.id} ${line} ${hint}` : 'card none') },
    rect: () => rect,
    line: (s) => `line-${s.id}`,
    hint: () => 'X Go there',
    documentary: () => doc,
  };
  const c = new InviteCards(deps);
  let now = 0;
  const frame = (dt = 0.1, blocked = false) => void c.frame((now += dt), dt, blocked);
  return { c, deps, log, fades, fovs, frame, set: (o: { ready?: boolean; drawn?: boolean; doc?: boolean }) => void ({ ready = ready, drawn = drawn, doc = doc } = { ready, drawn, doc, ...o }) };
}

describe('InviteCards', () => {
  it('warms the spot first, opens the peek once warm, and shows the card only once its still is taken', () => {
    const t = cards();
    t.deps.queue.offer(story('0'), 0);
    t.frame();
    expect(t.log).toEqual(['warm 500']);
    t.frame();
    expect(t.log).toEqual(['warm 500']); // not ready: no peek, no card
    t.set({ ready: true });
    t.frame();
    expect(t.log).toEqual(['warm 500', 'open 480']); // the warm holds the spot until the still is taken
    expect(t.c.story).toBeNull(); // nothing on the screen yet
    t.set({ drawn: true });
    t.frame();
    expect(t.log.slice(2)).toEqual(['done', 'card 0 line-0 X Go there']);
    expect(t.c.story?.id).toBe('0');
    // the picture fades in with the card
    for (let i = 0; i < 10; i++) t.frame();
    expect(t.fades.at(-1)).toBe(1);
  });

  it('midway through the warm draws the spot once, unseen: the animals, then the plants a frame later (R14)', () => {
    const t = cards();
    t.deps.queue.offer(story('0'), 0);
    for (let i = 0; i < 8; i++) t.frame();
    expect(t.log).toEqual(['warm 500']);
    t.frame();
    expect(t.log).toEqual(['warm 500', 'prime 0']);
    t.set({ ready: true });
    t.frame();
    expect(t.log).toEqual(['warm 500', 'prime 0', 'prime 1']); // the peek opens a frame later
    t.frame();
    expect(t.log).toEqual(['warm 500', 'prime 0', 'prime 1', 'open 480']);
    expect(t.fovs[0]).toBeLessThan(55); // a longer lens for the deer's still
  });

  it('shows nothing if the player moves on while the spot warms', () => {
    const t = cards();
    t.deps.queue.offer(story('0'), 0);
    t.frame();
    t.frame(0.1, true); // blocked: the player locked on, or the menu opened
    expect(t.log).toEqual(['warm 500', 'done']);
    t.set({ ready: true, drawn: true });
    for (let i = 0; i < 5; i++) t.frame();
    expect(t.log).toEqual(['warm 500', 'done']);
    expect(t.c.story).toBeNull();
  });

  it('close (Go there, or the documentary starting) hides the card at once; the picture fades out, then the peek closes', () => {
    const t = cards();
    t.deps.queue.offer(story('0'), 0);
    t.set({ ready: true, drawn: true });
    for (let i = 0; i < 12; i++) t.frame();
    expect(t.c.story?.id).toBe('0');
    t.c.close();
    expect(t.c.story).toBeNull();
    expect(t.log.at(-1)).toBe('card none');
    for (let i = 0; i < 10; i++) t.frame();
    expect(t.fades.at(-1)).toBe(0);
    expect(t.log.at(-1)).toBe('close');
    expect(t.deps.queue.showing).toBeNull();
  });

  it('closed for the documentary (at once), the picture goes with the card: nothing fades over its opening', () => {
    const t = cards();
    t.deps.queue.offer(story('0'), 0);
    t.set({ ready: true, drawn: true });
    for (let i = 0; i < 12; i++) t.frame();
    t.c.close(true);
    expect(t.log.slice(-2)).toEqual(['card none', 'close']);
    const n = t.log.length, fades = t.fades.length;
    t.set({ doc: true });
    for (let i = 0; i < 10; i++) t.frame(0.1, true);
    expect(t.log.length).toBe(n); // closed once, and nothing more
    expect(t.fades.length).toBe(fades);
  });
});
