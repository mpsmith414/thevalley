/**
 * The special senses an animal lends the player (the Sense button, spec section 5): which it has, from its recipe's
 * senses and the valley's food web, in the order X steps through them, their names on the card, and the line that
 * explains each the first time it is switched on. Pure: the wiring asks the valley and acts on the answers.
 */
import type { Recipe } from '../recipe/schema';
import type { SenseName } from './types';

/** An animal has the scent trails from this keen a smell, the sound ripples from this keen a hearing, and the hawk's zoom from this sharp a sight (its acuity). */
export const SMELL = 0.7, HEARING = 0.85, SHARP = 0.85;

/** Each sense's name on the screen. */
export const SENSE_LABEL: Record<SenseName, string> = { smell: 'Smell', hearing: 'Hearing', sharp: 'Sharp eyes', fear: 'Fear' };

/**
 * What the valley tells the senses about the animal watched now: the senses it has (in the Sense button's order), its
 * fear (the simulation's `needs.fear`, 0..1), the animal it is afraid of (its `threat`, or null), and what it hunts as a
 * line says it ("the rabbits", or a released family's "Bramble and family"; null for an animal that hunts nothing).
 */
export type Sensing = { senses: SenseName[]; fear: number; threat: string | null; prey: string | null };

/**
 * The senses of an animal with `senses` (its recipe's), `isPrey` (someone in the valley hunts it now, or it is a fish)
 * and `afraid` now: smell, hearing and sharp eyes where they are keen enough, keenest first, and Fear for prey (first
 * while it is afraid, last while it is calm). An animal with none of them gets the keener of its smell and hearing, so
 * everyone has at least one.
 */
export function sensesOf(senses: Recipe['mind']['senses'], isPrey: boolean, afraid: boolean): SenseName[] {
  const keen: [SenseName, number][] = [];
  if (senses.smell >= SMELL) keen.push(['smell', senses.smell]);
  if (senses.hearing >= HEARING) keen.push(['hearing', senses.hearing]);
  if (senses.acuity >= SHARP) keen.push(['sharp', senses.acuity]);
  const list = keen.sort((a, b) => b[1] - a[1]).map(([s]) => s);
  if (isPrey) afraid ? list.unshift('fear') : list.push('fear');
  if (!list.length) list.push(senses.hearing > senses.smell ? 'hearing' : 'smell');
  return list;
}

/** The sense X switches to from `current` (null: off) through `list`: off, the first, the next, … then off again (off too if it no longer has `current`). */
export function nextSense(list: SenseName[], current: SenseName | null): SenseName | null {
  if (current === null) return list[0] ?? null;
  const i = list.indexOf(current);
  return i >= 0 ? (list[i + 1] ?? null) : null;
}

/**
 * The line that explains `sense` the first time it is switched on, for the animal called `name` as a line says it ("the
 * fox", or a released creature's own name), which hunts `prey` ("the rabbits"; none: it hunts nothing):
 * "The fox can smell where the rabbits have been."
 */
export function firstLine(sense: SenseName, name: string, prey?: string | null): string {
  const lines: Record<SenseName, string> = {
    smell: `${name} can smell where ${prey ?? 'other animals'} have been.`,
    hearing: `${name} can hear animals moving, even out of sight.`,
    sharp: `${name} can spot ${prey ?? 'animals'} moving from far away.`,
    fear: `${name}'s heart beats faster when danger is near.`,
  };
  const line = lines[sense];
  return line[0].toUpperCase() + line.slice(1);
}
