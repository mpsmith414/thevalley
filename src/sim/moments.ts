import type { Biomes } from '../valley/types';
import type { Moment, MomentKind } from './types';

/** The same kind of moment from the same group (or lone animal) is held back for this many valley hours. */
const COOLDOWN = 1;

/**
 * Something worth watching, as it happens: the last `capacity` moments, listeners, and "what is happening now". A moment
 * of the same kind from the same group (or the same lone animal) within a valley hour of the last one is held back.
 */
export class MomentStream {
  /** The next moment's id. */
  next = 1;
  /** When each (kind, group or actor) last spoke, in valley hours: part of the simulation's state. */
  cooldowns: Record<string, number> = {};
  private list: Moment[] = [];
  private fns = new Set<(m: Moment) => void>();

  constructor(private capacity = 200) {}

  /** Adds a moment from `group` (by default its first actor), or returns null while that group's cool-down holds. */
  emit(m: Omit<Moment, 'id'>, group: string = m.actors[0] ?? m.follow): Moment | null {
    const key = `${m.kind}:${group}`, last = this.cooldowns[key];
    if (last !== undefined && m.hours >= last && m.hours - last < COOLDOWN) return null;
    for (const k in this.cooldowns) if (m.hours - this.cooldowns[k] >= COOLDOWN) delete this.cooldowns[k]; // long over
    this.cooldowns[key] = m.hours;
    const out: Moment = { id: this.next++, ...m };
    this.list.push(out);
    if (this.list.length > this.capacity) this.list.shift();
    this.fns.forEach((fn) => fn(out));
    return out;
  }

  /** The kept moments, oldest first. */
  recent(): readonly Moment[] {
    return this.list;
  }

  /** The moments of the last `within` valley hours before `hours`. */
  now(hours: number, within = 0.5): Moment[] {
    return this.list.filter((m) => m.hours > hours - within && m.hours <= hours);
  }

  /** Calls `fn` with every moment from now on; returns the way to stop. */
  on(fn: (m: Moment) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}

/** Who a moment is about: a species' name (a native's kid card name, a released creature's own), and whether a group. */
export type Who = { name: string; native: boolean; plural: boolean };

/** Plurals that are not just an added "s". */
const PLURALS: Record<string, string> = { deer: 'deer', trout: 'trout', fish: 'fish', sheep: 'sheep', wolf: 'wolves', mouse: 'mice', goose: 'geese' };

function plural(name: string): string {
  const words = name.split(' '), last = words.pop()!;
  const many = PLURALS[last] ?? (/(s|x|z|ch|sh)$/.test(last) ? `${last}es` : `${last}s`);
  return [...words, many].join(' ');
}

/** "The deer" / "A red fox" for natives; "Spotty Longlegs and family" / "Spotty Longlegs" for a released creature. */
function subject(w: Who): string {
  if (!w.native) return w.plural ? `${w.name} and family` : w.name;
  const name = w.name.toLowerCase();
  return w.plural ? `The ${plural(name)}` : `${/^[aeiou]/.test(name) ? 'An' : 'A'} ${name}`;
}

/** "The deer" / "The red fox" for natives (the one we are watching); a released creature by its name, as `subject`. */
function the(w: Who): string {
  return w.native && !w.plural ? `The ${w.name.toLowerCase()}` : subject(w);
}

/** One animal of a kind, as the object of a line: "a deer" for a native, its own name for a released creature. */
function one(w: Who): string {
  return subject({ ...w, plural: false }).replace(/^(An?) /, (x) => x.toLowerCase());
}

/** Lower-cased "the"/"a" at the start, for a subject used inside a line. */
const inner = (s: string) => s.replace(/^(The|An?) /, (w) => w.toLowerCase());

/** Each kind's line, in a documentary voice: about `w`, `where` a phrase like " in the meadow" (or ""), `prey` a hunt's prey. */
const LINES: Partial<Record<MomentKind, (w: Who, where: string, prey?: Who) => string>> = {
  graze: (w, where) => `${subject(w)} ${w.plural ? 'are' : 'is'} grazing${where}.`,
  drink: (w) => `${subject(w)} ${w.plural ? 'have' : 'has'} come down to drink.`,
  rest: (w) => `${subject(w)} ${w.plural ? 'are' : 'is'} resting.`,
  sleep: (w) => `${subject(w)} ${w.plural ? 'have' : 'has'} settled down to sleep.`,
  raft: (w) => `${subject(w)} ${w.plural ? 'are' : 'is'} gathering for the night.`,
  chorus: (w) => `${subject(w)} ${w.plural ? 'are' : 'is'} calling.`,
  startle: (w) => `Something has startled ${inner(subject(w))}.`,
  stalk: (w, _, prey) => `${subject(w)} ${w.plural ? 'are' : 'is'} creeping up on ${prey ? inner(subject(prey)) : 'something'}.`,
  chase: (w, _, prey) => `${the(w)} ${w.plural ? 'are' : 'is'} chasing ${prey ? one(prey) : 'something'}!`,
  dive: (w) => `${the(w)} ${w.plural ? 'are' : 'is'} diving!`,
  catch: (w, _, prey) => `${the(w)} ${w.plural ? 'have' : 'has'} caught ${!prey || prey.native ? (w.plural ? 'their supper' : 'its supper') : prey.name}.`,
  newcomer: (w, where) => `A new ${w.native ? w.name.toLowerCase() : w.name} has come to the ${where || 'valley'}.`,
  arrive: (w) => `${subject(w)} ${w.plural ? 'have' : 'has'} arrived in the valley.`,
  escape: (w) => `${the({ ...w, plural: false })} got away!`,
};

/** The line for a moment of `kind` about `who` (and, for a hunt, its `prey`). */
export function momentText(kind: MomentKind, who: Who, where = '', prey?: Who): string {
  const line = LINES[kind];
  return line ? line(who, where, prey) : `${subject(who)}.`;
}

/** Where an animal is, as a phrase for a line: on the water, in the meadow, at the forest edge, or nothing. */
export function whereText(b: Biomes, wet: boolean): string {
  if (wet) return ' on the water';
  if (b.meadow >= 0.4) return ' in the meadow';
  if (b.forest >= 0.3) return ' at the forest edge';
  return '';
}
