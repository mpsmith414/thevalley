import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { LINES } from '../../src/director/lines';
import { fillLine, slotsFor, type LineCtx } from '../../src/director/lines/pick';
import type { LineBeat } from '../../src/director/types';

const BEATS: LineBeat[] = ['first', 'welcome', 'opener', 'meanwhile', 'creep', 'chase', 'catch', 'escape', 'dive', 'checkin',
  'species', 'arrive', 'newcomer', 'drink', 'chorus', 'raft', 'startle', 'lapse-day', 'nightfall', 'dawn'];
const NATIVES = CAST.map((m) => m.recipe.id);
const count = (beat: LineBeat) => LINES.filter((l) => l.beat === beat).length;

/** The bank's lines filled as the game would: a native pack and its prey, and a released family with long names. */
const native: LineCtx = { who: { name: 'Red Fox', native: true, plural: true }, prey: { name: 'Rabbit', native: true, plural: false }, species: 'fox', traits: ['hunter'], hours: 19, place: 'meadow' };
const released: LineCtx = { who: { name: 'W'.repeat(40), native: false, plural: true }, prey: { name: 'P'.repeat(40), native: false, plural: false }, traits: ['flier'], hours: 9, place: 'water' };
const fills = LINES.flatMap((l) => [fillLine(l.text, slotsFor(native)), ...(l.when?.species ? [] : [fillLine(l.text, slotsFor(released))])]);

describe('the line bank', () => {
  it('every beat has at least 6 lines (species: 4 a native, checkin: 30)', () => {
    for (const b of BEATS) expect(count(b), b).toBeGreaterThanOrEqual(6);
    for (const s of NATIVES) expect(LINES.filter((l) => l.beat === 'species' && l.when?.species?.includes(s)).length, s).toBeGreaterThanOrEqual(4);
    expect(count('checkin')).toBeGreaterThanOrEqual(30);
  });
  it('has 300–400 lines in all', () => {
    expect(LINES.length).toBeGreaterThanOrEqual(300);
    expect(LINES.length).toBeLessThanOrEqual(400);
  });
  it('ids are unique', () => {
    expect(new Set(LINES.map((l) => l.id)).size).toBe(LINES.length);
  });
  it('every line fills', () => {
    for (const t of fills) expect(t).not.toMatch(/[{}]/);
  });
  it('no forbidden words', () => {
    for (const l of LINES) expect(l.text, l.id).not.toMatch(/\b(blood|kill|dead|die|death|eat him|tear|rip|prey's body)\b/i);
  });
  it('no line over 220 characters filled', () => {
    for (const t of fills) expect(t.length, t).toBeLessThanOrEqual(220);
  });
  it('species notes are about natives and never about a released creature', () => {
    for (const l of LINES.filter((x) => x.when?.species)) {
      expect(l.when!.released, l.id).not.toBe(true);
      for (const s of l.when!.species!) expect(NATIVES, l.id).toContain(s);
    }
    for (const l of LINES.filter((x) => x.beat === 'species')) expect(l.when?.species?.length, l.id).toBeGreaterThan(0);
  });
});
