import { describe, expect, it } from 'vitest';
import { FearBeat, Heartbeat, MAX_EDGE, bpm, pulse } from '../../src/views/fear';

describe('the fear pulse', () => {
  it('beats from 50 a minute calm to 140 afraid', () => {
    expect(bpm(0)).toBe(50);
    expect(bpm(1)).toBe(140);
    expect(bpm(0.5)).toBe(95);
    expect(bpm(-1)).toBe(50);
    expect(bpm(2)).toBe(140);
  });

  it('darkens the edges at most 0.6, smoothly, never with a jump', () => {
    expect(MAX_EDGE).toBe(0.6);
    for (const fear of [0, 0.3, 0.7, 1]) {
      let last = pulse(0, fear), top = 0, low = Infinity;
      for (let i = 1; i <= 120 * 10; i++) {
        const p = pulse(i / 120, fear);
        expect(Math.abs(p - last)).toBeLessThanOrEqual(0.05);
        expect(p).toBeLessThanOrEqual(0.6);
        expect(p).toBeGreaterThanOrEqual(0);
        (top = Math.max(top, p)), (low = Math.min(low, p)), (last = p);
      }
      expect(top - low, `beats at fear ${fear}`).toBeGreaterThan(0.03);
    }
    expect(Math.max(...Array.from({ length: 1200 }, (_, i) => pulse(i / 120, 1)))).toBeCloseTo(0.6, 2);
  });

  it('is faint when calm and darker when afraid', () => {
    const top = (fear: number) => Math.max(...Array.from({ length: 240 }, (_, i) => pulse(i / 120, fear)));
    expect(top(0)).toBeLessThan(0.2);
    expect(top(1)).toBeGreaterThan(top(0.5));
    expect(top(0.5)).toBeGreaterThan(top(0));
  });

  it('beats at its rate', () => {
    // count the lubs (the darkness rising past 80% of its range: the softer dub stays under it) over 60 s
    const lubs = (fear: number) => {
      let n = 0, last = pulse(0, fear);
      const low = pulse(0, fear), mid = low + 0.8 * (Math.max(...Array.from({ length: 240 }, (_, i) => pulse(i / 120, fear))) - low);
      for (let i = 1; i <= 120 * 60; i++) {
        const p = pulse(i / 120, fear);
        if (last < mid && p >= mid) n++;
        last = p;
      }
      return n;
    };
    expect(lubs(0)).toBeCloseTo(50, -1);
    expect(lubs(1)).toBeCloseTo(140, -1);
  });

  it('keeps its beat smooth as the fear changes (FearBeat carries the phase on)', () => {
    const beat = new FearBeat();
    let last = beat.step(0, 0);
    for (let i = 1; i <= 120 * 6; i++) {
      const fear = Math.min(1, i / 360); // calm to afraid in 3 s
      const p = beat.step(1 / 120, fear);
      expect(Math.abs(p - last)).toBeLessThanOrEqual(0.05);
      last = p;
    }
  });
});

/** A stand-in audio context that records the thumps it is asked to play. */
function fakeAudio() {
  const started: number[] = [];
  /** Each thump: when it starts, when it was last told to stop, and its loudness's last target (null: none set). */
  const thumps: { start: number; stop: number; hushed: number | null }[] = [];
  const param = (onTarget?: (v: number) => void) => ({
    value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
    setTargetAtTime: (v: number) => onTarget?.(v),
  });
  const node = () => ({ connect: (n: unknown) => n });
  let gainTarget: (v: number) => void = () => {};
  const ctx = {
    currentTime: 0,
    createOscillator: () => {
      const th = { start: NaN, stop: NaN, hushed: null as number | null };
      thumps.push(th);
      gainTarget = (v) => void (th.hushed = v); // the next gain made belongs to this thump (`thump` makes them in pairs)
      return { ...node(), type: 'sine', frequency: param(), start: (t: number) => (started.push(t), (th.start = t)), stop: (t: number) => void (th.stop = t), onended: null };
    },
    createGain: () => {
      const th = gainTarget;
      return { ...node(), gain: param((v) => th(v)) };
    },
  };
  return { ctx, started, thumps };
}

describe('Heartbeat', () => {
  it('makes no sound and no nodes while off', () => {
    const { ctx, started } = fakeAudio();
    const h = new Heartbeat(ctx as unknown as AudioContext, {} as AudioNode);
    for (let i = 0; i < 100; i++) (ctx.currentTime += 0.05), h.set(140, false);
    expect(started).toEqual([]);
  });

  it('thumps twice a beat at the rate asked, scheduled a little ahead', () => {
    const { ctx, started } = fakeAudio();
    const h = new Heartbeat(ctx as unknown as AudioContext, {} as AudioNode);
    for (let i = 0; i < 200; i++) (ctx.currentTime += 0.05), h.set(60, true); // 10 s at 60 a minute
    const lubs = started.length / 2;
    expect(lubs).toBeGreaterThanOrEqual(9);
    expect(lubs).toBeLessThanOrEqual(11);
    h.set(60, false);
    const n = started.length;
    for (let i = 0; i < 20; i++) (ctx.currentTime += 0.05), h.set(60, false);
    expect(started.length).toBe(n);
  });

  it('switched off, ends on no thump: those not begun never play, the one sounding fades at once', () => {
    const { ctx, thumps } = fakeAudio();
    const h = new Heartbeat(ctx as unknown as AudioContext, {} as AudioNode);
    for (let i = 0; i < 25; i++) (ctx.currentTime += 0.05), h.set(140, true);
    // just after a lub began (its dub, and maybe the next lub, still to come)
    const lub = thumps.filter((t) => t.start <= ctx.currentTime).pop()!;
    ctx.currentTime = lub.start + 0.02;
    h.set(140, false);
    const now = ctx.currentTime;
    for (const t of thumps.filter((x) => x.start > now)) expect(t.stop).toBeLessThanOrEqual(t.start); // never plays
    expect(lub.stop).toBeLessThanOrEqual(now + 0.1);
    expect(lub.hushed).toBe(0);
  });

  it('starts in step with the edges: its first lub where their beat has its lub', () => {
    const { ctx, started } = fakeAudio();
    const h = new Heartbeat(ctx as unknown as AudioContext, {} as AudioNode);
    ctx.currentTime = 10;
    h.set(60, true, 0.5); // half way through a 1 s beat: the edges' next lub is 0.7 s away (at 0.2 of the next beat)
    ctx.currentTime = 10.5;
    h.set(60, true, 0); // (the phase only counts when it starts)
    expect(started[0]).toBeCloseTo(10.7, 6);
  });
});
