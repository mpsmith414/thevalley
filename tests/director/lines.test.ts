import { describe, expect, it } from 'vitest';
import type { Who } from '../../src/sim/moments';
import { LINES } from '../../src/director/lines';
import { fillLine, pickLine, RecentLines, slotsFor, type LineCtx } from '../../src/director/lines/pick';
import type { Line } from '../../src/director/lines/types';

const deer: Who = { name: 'Deer', native: true, plural: false };
const ctx = (o: Partial<LineCtx> = {}): LineCtx => ({ who: deer, species: 'deer', traits: ['grazer'], hours: 9, place: 'meadow', ...o });
const mem = () => { let ids: string[] = []; return new RecentLines({ get: () => ids, set: (x) => { ids = x; } }); };
const L = (id: string, when?: Line['when']): Line => ({ id, beat: 'checkin', text: id, when });
const pick = (bank: Line[], c: LineCtx, r = mem()) => pickLine(bank, 'checkin', c, r, () => 0)?.id ?? null;

describe('fillLine', () => {
  const text = '{Who} / {who} / {prey} / {place} / {time} / {name}.';
  it('fills every slot', () => {
    const out = fillLine(text, slotsFor(ctx({ prey: { name: 'Rabbit', native: true, plural: false } })));
    expect(out).toBe('A deer / a deer / a rabbit / the meadow / morning / the deer.');
    expect(out).not.toMatch(/[{}]/);
  });
  it('fills a released name with an apostrophe or 40 characters cleanly', () => {
    const long = "O'Malley's " + 'x'.repeat(29);
    const out = fillLine(text, slotsFor(ctx({ who: { name: long, native: false, plural: true }, prey: { name: "Dot's Pal", native: false, plural: false } })));
    expect(out).toContain(`${long} and family`);
    expect(out).toContain("Dot's Pal");
    expect(out).not.toMatch(/[{}]/);
    expect(out.length).toBeLessThanOrEqual(300);
  });
  it('keeps every bank line under 300 characters once filled', () => {
    for (const l of LINES) {
      const out = fillLine(l.text, slotsFor(ctx({ who: { name: 'x'.repeat(40), native: false, plural: true }, prey: { name: 'y'.repeat(40), native: false, plural: false } })));
      expect(out.length).toBeLessThanOrEqual(300);
      expect(out).not.toMatch(/[{}]/);
    }
  });
});

describe('pickLine', () => {
  it('honours species, traits, plural, hours, place and released', () => {
    expect(pick([L('a', { species: ['fox'] })], ctx())).toBeNull();
    expect(pick([L('a', { species: ['fox', 'deer'] })], ctx())).toBe('a');
    expect(pick([L('a', { traits: ['flier'] })], ctx())).toBeNull();
    expect(pick([L('a', { traits: ['flier', 'grazer'] })], ctx())).toBe('a');
    expect(pick([L('a', { plural: true })], ctx())).toBeNull();
    expect(pick([L('a', { plural: true })], ctx({ who: { ...deer, plural: true } }))).toBe('a');
    expect(pick([L('a', { plural: false })], ctx())).toBe('a');
    expect(pick([L('a', { hours: [10, 12] })], ctx())).toBeNull();
    expect(pick([L('a', { hours: [20, 5] })], ctx({ hours: 23 }))).toBe('a');
    expect(pick([L('a', { hours: [20, 5] })], ctx({ hours: 12 }))).toBeNull();
    expect(pick([L('a', { place: ['water', 'rock'] })], ctx())).toBeNull();
    expect(pick([L('a', { place: ['meadow'] })], ctx({ place: undefined }))).toBeNull();
    expect(pick([L('a', { released: true })], ctx())).toBeNull();
    expect(pick([L('a', { released: true })], ctx({ who: { ...deer, native: false } }))).toBe('a');
  });
  it('a released creature never gets a native species line', () => {
    expect(pick([L('a', { species: ['deer'] })], ctx({ who: { ...deer, native: false } }))).toBeNull();
  });
  it('skips recent ids while others match, falls back to the oldest when all are recent', () => {
    const r = mem();
    r.add('a');
    expect(pick([L('a'), L('b')], ctx(), r)).toBe('b');
    r.add('b');
    r.add('c');
    expect(pick([L('c'), L('b'), L('a')], ctx(), r)).toBe('a');
  });
  it('is null for a beat with no match, and fills the text', () => {
    const bank: Line[] = [{ id: 'c', beat: 'chase', text: 'And now, {who} is after {prey}!', when: { traits: ['hunter'] } }];
    expect(pickLine(bank, 'dawn', ctx(), mem(), () => 0)).toBeNull();
    expect(pickLine(bank, 'chase', ctx({ traits: ['hunter'], prey: { name: 'Rabbit', native: true, plural: false } }), mem(), () => 0)!.text)
      .toBe('And now, a deer is after a rabbit!');
  });
});

describe('RecentLines', () => {
  it('keeps the last 200', () => {
    let saved: string[] = [];
    const r = new RecentLines({ get: () => saved, set: (x) => { saved = x; } });
    for (let i = 0; i < 250; i++) r.add(`l${i}`);
    expect(saved.length).toBe(200);
    expect(r.has('l49')).toBe(false);
    expect(r.has('l50')).toBe(true);
  });
  it('survives a store that throws', () => {
    const bad = { get: () => { throw new Error('no'); }, set: () => { throw new Error('no'); } };
    const r = new RecentLines(bad);
    expect(() => r.add('a')).not.toThrow();
    expect(r.has('a')).toBe(true);
  });
});
