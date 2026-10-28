import { describe, expect, it } from 'vitest';
import { CaptionQueue, GAP_S, SHOW_S, STALE_S, captionLift } from '../../src/app/captions';
import { HIGH, LOW, MEDIUM, type Moment } from '../../src/sim/types';

const moment = (id: number, interest: number): Moment =>
  ({ id, hours: 0, kind: 'stalk', actors: [`a${id}`], species: ['fox'], at: { x: 0, z: 0 }, follow: `a${id}`, interest, text: `moment ${id}` });

describe('CaptionQueue', () => {
  it('has the spec numbers: 8 s shown, 25 s apart, stale at 30 s', () => {
    expect([SHOW_S, GAP_S, STALE_S]).toEqual([8, 25, 30]);
  });

  it('ignores a low-interest moment', () => {
    const q = new CaptionQueue();
    q.offer(moment(1, LOW), 0);
    expect(q.update(0, false)).toBeNull();
    expect(q.showing).toBeNull();
  });

  it('shows a moment for SHOW_S and then nothing', () => {
    const q = new CaptionQueue();
    q.offer(moment(1, MEDIUM), 0);
    expect(q.update(0, false)?.id).toBe(1);
    expect(q.update(SHOW_S - 0.1, false)?.id).toBe(1);
    expect(q.showing?.id).toBe(1);
    expect(q.update(SHOW_S, false)).toBeNull();
  });

  it('shows two medium moments offered 1 s apart 25 s apart', () => {
    const q = new CaptionQueue();
    q.offer(moment(1, MEDIUM), 0);
    q.offer(moment(2, MEDIUM), 1);
    expect(q.update(0, false)?.id).toBe(1);
    for (let t = 1; t < GAP_S; t += 1) expect(q.update(t, false)?.id ?? null).toBe(t < SHOW_S ? 1 : null);
    expect(q.update(GAP_S, false)?.id).toBe(2);
  });

  it('shows a high moment offered while a medium one waits first', () => {
    const q = new CaptionQueue();
    q.offer(moment(1, MEDIUM), 0);
    q.update(0, false); // 1 is showing
    q.offer(moment(2, MEDIUM), 20);
    q.offer(moment(3, HIGH), 21);
    expect(q.update(GAP_S, false)?.id).toBe(3);
    expect(q.update(GAP_S * 2, false)?.id).toBe(2);
  });

  it('drops a moment queued more than STALE_S ago', () => {
    const q = new CaptionQueue();
    q.offer(moment(1, MEDIUM), 0);
    q.update(0, false);
    q.offer(moment(2, MEDIUM), 1);
    expect(q.update(STALE_S + 1.5, false)).toBeNull(); // 2 has waited 30.5 s
    expect(q.update(GAP_S * 3, false)).toBeNull(); // and is gone for good
    q.offer(moment(3, MEDIUM), 45);
    expect(q.update(GAP_S * 3, false)?.id).toBe(3); // a moment of 30 s is still in time
  });

  it('keeps at most 3 waiting, dropping the least interesting first (the oldest of equals)', () => {
    const q = new CaptionQueue({ show: 1, gap: 2, stale: 100 });
    q.offer(moment(1, MEDIUM), 0);
    q.update(0, false);
    for (const [id, i] of [[2, MEDIUM], [3, MEDIUM], [4, MEDIUM + 0.1], [5, HIGH]] as const) q.offer(moment(id, i), 1);
    const order: number[] = [];
    for (let t = 2; t <= 10; t += 2) {
      const m = q.update(t, false);
      if (m) order.push(m.id);
      q.update(t + 1, false);
    }
    expect(order).toEqual([5, 3, 4]); // 2 went; only a high one jumps the queue
  });

  it('hides the shown moment while blocked, holds the queue, and carries on after', () => {
    const q = new CaptionQueue();
    q.offer(moment(1, MEDIUM), 0);
    expect(q.update(0, false)?.id).toBe(1);
    expect(q.update(2, true)).toBeNull();
    expect(q.showing).toBeNull();
    q.offer(moment(2, MEDIUM), 3);
    expect(q.update(GAP_S + 1, true)).toBeNull(); // still blocked: nothing shows
    expect(q.update(GAP_S + 2, false)?.id).toBe(2); // the gap has passed and 2 has waited under STALE_S
    expect(q.update(GAP_S + 2 + SHOW_S, false)).toBeNull();
  });
});

describe('captionLift', () => {
  it('is the height of the join card while it shows, and nothing otherwise', () => {
    expect(captionLift({ hidden: false, offsetHeight: 300 })).toBe(300);
    expect(captionLift({ hidden: true, offsetHeight: 300 })).toBe(0);
    expect(captionLift(null)).toBe(0);
  });
});
