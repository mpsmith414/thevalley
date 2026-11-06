import { describe, expect, it } from 'vitest';
import { Handover, IdleTimer } from '../../src/director/idle';

/** Run the timer for `s` seconds in 0.5 s frames; the frames it fired on (seconds in). */
const run = (t: IdleTimer, s: number, o = { input: false, counts: true }) => {
  const fired: number[] = [];
  for (let i = 1; i <= s * 2; i++) if (t.update(0.5, o)) fired.push(i / 2);
  return fired;
};

describe('IdleTimer', () => {
  it('fires once after 180 s without input while counting', () => {
    const t = new IdleTimer(() => 180);
    expect(run(t, 179)).toEqual([]);
    expect(run(t, 100)).toEqual([1]); // at 180 s, and not again
  });
  it('input starts it again from nothing', () => {
    const t = new IdleTimer(() => 180);
    run(t, 170);
    expect(t.update(0.5, { input: true, counts: true })).toBe(false);
    expect(run(t, 179.5)).toEqual([]);
    expect(run(t, 1)).toEqual([0.5]);
  });
  it('not counting holds it where it was', () => {
    const t = new IdleTimer(() => 180);
    run(t, 170);
    expect(run(t, 600, { input: false, counts: false })).toEqual([]);
    expect(run(t, 10)).toEqual([10]);
  });
  it('fires again after input once it has fired', () => {
    const t = new IdleTimer(() => 180);
    expect(run(t, 180)).toEqual([180]);
    t.update(0.5, { input: true, counts: true });
    expect(run(t, 180)).toEqual([180]);
  });
  it('Off (null) never fires', () => {
    expect(run(new IdleTimer(() => null), 3600)).toEqual([]);
  });
  it('10 minutes works', () => {
    const t = new IdleTimer(() => 600);
    expect(run(t, 599.5)).toEqual([]);
    expect(run(t, 1)).toEqual([0.5]);
  });
});

describe('Handover', () => {
  const doc = () => {
    const d = { on: true, taken: [] as string[], takeOver(how: 'free' | 'lock') { this.taken.push(how); this.on = false; } };
    return { d, h: new Handover(d) };
  };
  it('any button takes over and is used up; A locks on; Start is left to the menu', () => {
    const { d, h } = doc();
    expect(h.press('start', false)).toBe(false);
    expect(d.taken).toEqual([]);
    expect(h.press('a', false)).toBe(true);
    expect(d.taken).toEqual(['lock']);
    const b = doc();
    expect(b.h.press('b', false)).toBe(true);
    expect(b.d.taken).toEqual(['free']);
  });
  it('does nothing while the documentary is off', () => {
    const { d, h } = doc();
    d.on = false;
    expect(h.press('b', false)).toBe(false);
    expect(h.other()).toBe(false);
    expect(h.hands(true)).toBe(false);
    expect(d.taken).toEqual([]);
  });
  it('the press that took over is not passed on: its key, and the next frame\'s hands', () => {
    const { d, h } = doc();
    expect(h.press('lb', true)).toBe(true); // `[`: through its button
    expect(h.other()).toBe(true); // the same key's own handler (the time step) is skipped
    expect(h.other()).toBe(false); // the next key is the player's again
    expect(h.hands(true)).toBe(true); // that frame's sticks go nowhere
    expect(h.hands(true)).toBe(false); // the next frame's do
    expect(d.taken).toEqual(['free']);
  });
  it('a key, a click or a stick takes over; while it runs the hands go nowhere else', () => {
    const k = doc();
    expect(k.h.other()).toBe(true);
    expect(k.d.taken).toEqual(['free']);
    const s = doc();
    expect(s.h.hands(false)).toBe(true); // nothing moved: still the documentary's
    expect(s.d.taken).toEqual([]);
    expect(s.h.hands(true)).toBe(true); // the stick: taken over, and used up
    expect(s.d.taken).toEqual(['free']);
    expect(s.h.hands(true)).toBe(false);
  });
});
