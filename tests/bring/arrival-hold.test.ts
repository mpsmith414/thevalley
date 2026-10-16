import { describe, expect, it } from 'vitest';
import { ArrivalHold, FOLLOW, PUSH, PUSH_MAX, type Phase } from '../../src/bring/arrival-hold';
import { HOLD_CAP } from '../../src/bring/release';

const dt = 0.1;
type Look = { seen?: boolean; onward?: boolean };
/** Step `n` frames; returns the phases seen, in order, without repeats (null once it ended). */
const run = (h: ArrivalHold, n: number, look: Look = {}, moved = false) => {
  const phases: (Phase | null)[] = [];
  for (let i = 0; i < n; i++) {
    const p = h.frame(dt, { inView: () => !!look.seen, onward: () => !!look.onward }, moved);
    if (phases.at(-1) !== p) phases.push(p);
  }
  return phases;
};

describe('ArrivalHold (arrival v2: glide, push-in, follow)', () => {
  it('goes glide → push-in → follow → done, the follow once the lead walks on and the push is over', () => {
    const h = new ArrivalHold();
    h.begin('c1');
    expect(h.phase).toBe('glide');
    expect(run(h, 20)).toEqual(['glide']); // the glide, then waiting for the family to compile
    expect(h.start('c1', 0.5)).toBe(true);
    expect(h.phase).toBe('push');
    expect(run(h, 20, { seen: true })).toEqual(['push']);
    expect(h.time).toBeCloseTo(2, 5);
    // the lead walks on early: the push-in still finishes first
    expect(run(h, Math.round(PUSH / dt) - 20 - 1, { seen: true, onward: true })).toEqual(['push']);
    expect(run(h, 1, { seen: true, onward: true })).toEqual(['follow']);
    expect(run(h, Math.round(FOLLOW / dt) - 1, { seen: true, onward: true })).toEqual(['follow']);
    expect(run(h, 1, { seen: true, onward: true })).toEqual([null]);
    expect(h.active).toBe(false);
    expect(h.phase).toBeNull();
  });

  it('follows after PUSH_MAX s even if the lead never walks on', () => {
    const h = new ArrivalHold();
    h.begin('c1');
    h.start('c1');
    expect(run(h, Math.round(PUSH_MAX / dt) - 1, { seen: true })).toEqual(['push']);
    expect(run(h, 1, { seen: true })).toEqual(['follow']);
  });

  it('says when the first of the family is in the picture, once, timed from the glide end (Ruling R6)', () => {
    const seen: [number, string][] = [];
    const h = new ArrivalHold({ onSeen: (since, id) => seen.push([since, id]) });
    h.begin('c1');
    run(h, 10, { seen: true }); // in the glide: not yet (it is not in the valley)
    h.start('c1', 0.5);
    run(h, 1, { seen: true }); // its bands are not known on the frame the push starts
    expect(seen).toEqual([]);
    run(h, 30, { seen: true });
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBeCloseTo(0.7, 5);
    expect(seen[0][1]).toBe('c1');
  });

  it('the stick or the mouse ends it at once, from any phase', () => {
    for (const to of ['glide', 'push', 'follow'] as const) {
      const h = new ArrivalHold();
      h.begin('c1');
      if (to !== 'glide') h.start('c1');
      if (to === 'follow') run(h, Math.round(PUSH_MAX / dt) + 1);
      expect(h.phase).toBe(to);
      expect(run(h, 1, {}, true)).toEqual([null]);
      expect(h.active).toBe(false);
      expect(h.start('c1'), 'a family that comes in after the player took the camera does not take it back').toBe(false);
      expect(h.active).toBe(false);
    }
  });

  it(`ends after HOLD_CAP (${HOLD_CAP}) s in all, from the glide's start`, () => {
    const h = new ArrivalHold();
    h.begin('c1');
    run(h, 100); // a 10 s compile
    h.start('c1');
    expect(run(h, 1000, { seen: false })).toEqual(['push', 'follow', null]);
    // the frames it lasted: HOLD_CAP s from begin
    const g = new ArrivalHold();
    g.begin('c1');
    let n = 0;
    while (g.frame(dt, { inView: () => false, onward: () => false }, false)) n++;
    expect(n).toBe(Math.round(HOLD_CAP / dt) - 1);
  });

  it('only the family it began for starts the push-in', () => {
    const h = new ArrivalHold();
    expect(h.start('c1')).toBe(false); // nothing began
    h.begin('c1');
    expect(h.start('c2')).toBe(false);
    expect(h.phase).toBe('glide');
  });

  it('idle() resolves only at the end (Ruling R17), and at once with no hold', async () => {
    const h = new ArrivalHold();
    let went = false;
    await h.idle();
    h.begin('c1');
    void h.idle().then(() => (went = true));
    run(h, 5);
    h.start('c1');
    run(h, Math.round(PUSH_MAX / dt) + 5, { seen: true });
    await Promise.resolve();
    expect(h.phase).toBe('follow');
    expect(went).toBe(false);
    run(h, Math.round(FOLLOW / dt), { seen: true });
    await Promise.resolve();
    expect(went).toBe(true);
    // a new arrival replacing the old (or `end`, for a jump) lets waiters go too
    h.begin('c2');
    let again = false;
    void h.idle().then(() => (again = true));
    h.end();
    await Promise.resolve();
    expect(again).toBe(true);
  });
});
