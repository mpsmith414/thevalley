import { describe, expect, it } from 'vitest';
import { GAP_S, HUNT_GAP_S, Pacer, STALE_S } from '../../src/director/pacing';
import type { LineCue } from '../../src/director/planner';
import type { LineBeat, Story } from '../../src/director/types';

const cue = (beat: LineBeat): LineCue => ({ beat, story: {} as Story });

describe('Pacer', () => {
  it('has the agreed numbers', () => { expect([GAP_S, HUNT_GAP_S, STALE_S]).toEqual([20, 4, 4]); });
  it('speaks at once when nothing has been said', () => {
    const p = new Pacer();
    p.want(cue('opener'), 0);
    expect(p.next(0, false)?.beat).toBe('opener');
    expect(p.next(0, false)).toBeNull();
  });
  it('keeps lines 20 s apart, measured from the end of the last', () => {
    const p = new Pacer();
    p.spoke(0, 8);
    p.want(cue('checkin'), 27);
    expect(p.next(27, false)).toBeNull();
    p.want(cue('checkin'), 28);
    expect(p.next(28, false)?.beat).toBe('checkin');
  });
  it('lets hunt cues go 4 s after the last line ends', () => {
    for (const b of ['creep', 'chase', 'catch', 'escape', 'dive'] as const) {
      const p = new Pacer();
      p.spoke(0, 5);
      p.want(cue(b), 8);
      expect(p.next(8, false)).toBeNull();
      expect(p.next(9, false)?.beat).toBe(b);
    }
  });
  it('never speaks while speaking', () => {
    const p = new Pacer();
    p.want(cue('chase'), 0);
    expect(p.next(1, true)).toBeNull();
    expect(p.next(2, false)?.beat).toBe('chase');
  });
  it('drops a cue not started within 4 s', () => {
    const p = new Pacer();
    p.spoke(0, 5);
    p.want(cue('checkin'), 6);
    expect(p.next(30, false)).toBeNull();
    expect(p.next(31, false)).toBeNull();
  });
});
