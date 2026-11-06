/** The form of the narrator's hand-written lines: what a line is, and what it may say about the scene. */
import type { LineBeat } from '../types';

/** What kind of creature a line suits: flies, swims, hunts, grazes, goes about in a group or alone. */
export type TraitTag = 'flier' | 'swimmer' | 'hunter' | 'grazer' | 'group' | 'alone';

/**
 * One line the narrator may speak, a template for a `beat`. Its `text` may hold these slots, filled by `fillLine`:
 * `{who}` the subject as used mid-sentence ("the deer", "a red fox", "Spotty Longlegs and family"); `{Who}` the same at
 * the start of a sentence ("The deer"); `{prey}` the prey as an object ("a rabbit", or a released prey's own name);
 * `{place}` a place phrase ("the meadow"); `{time}` a time of day ("morning"); `{name}` the one animal's name ("the
 * fox", "Spotty Longlegs"). `when` narrows where the line fits: any of the `species`, any of the `traits`, a group
 * (`plural` true) or a lone animal (false), the `hours` [from, to) of the day (may wrap past midnight), any of the
 * `place`s, and whether it is about a `released` creature. A line with no `when` fits anywhere. Species lines are never
 * spoken about a released creature.
 */
export type Line = { id: string; beat: LineBeat; text: string; when?: { species?: string[]; traits?: TraitTag[];
  plural?: boolean; hours?: [number, number]; place?: ('meadow' | 'forest' | 'water' | 'rock')[]; released?: boolean } };
