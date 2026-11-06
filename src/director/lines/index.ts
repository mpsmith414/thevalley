/** The narrator's line bank: every hand-written line, by beat. */
import { HUNTS } from './hunts';
import { CHECKINS, MOMENTS } from './life';
import { GREETINGS, MEANWHILES, OPENERS } from './openings';
import { SKIES } from './skies';
import { SPECIES } from './species';
import type { Line } from './types';

/** The lines: openings, hunts, calm life and the valley's moments, species notes, and the time-lapses. */
export const LINES: readonly Line[] = [...GREETINGS, ...OPENERS, ...MEANWHILES, ...HUNTS, ...CHECKINS, ...MOMENTS, ...SPECIES, ...SKIES];
