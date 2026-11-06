/** Filling a line's slots and choosing which line to speak: one that fits the scene and was not heard lately. */
import { one, subject, the, type Who } from '../../sim/moments';
import type { LineBeat } from '../types';
import type { Line, TraitTag } from './types';

/** What the narrator knows of the scene when picking: who (and their prey), species, traits, hour of day, place. */
export type LineCtx = { who?: Who; prey?: Who; species?: string; traits: TraitTag[]; hours: number; place?: string };

/** The slots a line may use (see `Line`). */
export type Slots = Record<'who' | 'Who' | 'prey' | 'place' | 'time' | 'name', string>;

/** How many line ids are remembered, so the same words do not come back every evening. */
export const RECENT_KEEP = 200;

/** Fills every `{slot}` of a line's text in one pass, so a name holding braces cannot make a new slot. */
export function fillLine(text: string, slots: Slots): string {
  return text.replace(/\{(who|Who|prey|place|time|name)\}/g, (_, k: keyof Slots) => slots[k]);
}

/** A time of day for a line ("morning") from the hour. */
function timeOf(hours: number): string {
  return hours >= 5 && hours < 12 ? 'morning' : hours >= 12 && hours < 17 ? 'afternoon' : hours >= 17 && hours < 21 ? 'evening' : 'night';
}

/** The words to fill a line with for this scene, so every caller builds the slots the same way. */
export function slotsFor(c: LineCtx): Slots {
  const w = c.who ?? { name: 'animal', native: true, plural: false };
  const sub = subject(w);
  return {
    who: sub.replace(/^(The|An?) /, (x) => x.toLowerCase()), Who: sub,
    prey: c.prey ? one(c.prey) : 'something',
    place: c.place ? `the ${c.place === 'rock' ? 'rocks' : c.place}` : 'the valley', time: timeOf(c.hours),
    name: the({ ...w, plural: false }).replace(/^The /, 'the '),
  };
}

/** Whether a line fits the scene. */
function fits(l: Line, c: LineCtx): boolean {
  const w = l.when;
  if (!w) return true;
  const released = c.who ? !c.who.native : false;
  if (w.species && (released || !c.species || !w.species.includes(c.species))) return false;
  if (w.traits && !w.traits.some((t) => c.traits.includes(t))) return false;
  if (w.plural !== undefined && (c.who?.plural ?? false) !== w.plural) return false;
  if (w.released !== undefined && released !== w.released) return false;
  if (w.place && (!c.place || !w.place.includes(c.place as 'meadow'))) return false;
  if (w.hours) {
    const [a, b] = w.hours;
    if (!(a <= b ? c.hours >= a && c.hours < b : c.hours >= a || c.hours < b)) return false;
  }
  return true;
}

/** The last line ids spoken, oldest first, kept in a store (localStorage in the game). A store that throws is ignored. */
export class RecentLines {
  private ids: string[];
  constructor(private store: { get(): string[]; set(ids: string[]): void }, private keep = RECENT_KEEP) {
    try { this.ids = store.get().slice(-keep); } catch { this.ids = []; }
  }
  /** Whether this line was spoken lately. */
  has(id: string): boolean { return this.ids.includes(id); }
  /** Notes a line as just spoken. */
  add(id: string): void {
    this.ids = [...this.ids.filter((x) => x !== id), id].slice(-this.keep);
    try { this.store.set(this.ids); } catch { /* the memory is only a nicety */ }
  }
  /** Of these ids, the one heard longest ago (one never heard counts as oldest). */
  oldest(ids: string[]): string {
    return ids.reduce((a, b) => (this.ids.indexOf(b) < this.ids.indexOf(a) ? b : a));
  }
}

/**
 * Chooses a line for a `beat` that fits the scene and was not heard lately; when all that fit were, the one heard
 * longest ago. Nothing fits: null.
 */
export function pickLine(bank: readonly Line[], beat: LineBeat, c: LineCtx, recent: RecentLines, rng: () => number): { id: string; text: string } | null {
  const fit = bank.filter((l) => l.beat === beat && fits(l, c));
  if (!fit.length) return null;
  const fresh = fit.filter((l) => !recent.has(l.id));
  const line = fresh.length ? fresh[Math.floor(rng() * fresh.length) % fresh.length]
    : fit.find((l) => l.id === recent.oldest(fit.map((x) => x.id)))!;
  return { id: line.id, text: fillLine(line.text, slotsFor(c)) };
}
