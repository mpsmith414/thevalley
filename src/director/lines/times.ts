/** The parts of the valley's day the lines are written for, as `when.hours` spans [from, to) (night wraps past midnight). */
type Span = [number, number];

/** First light and the mist on the water (the sun is up by about 5). */
export const DAWN: Span = [4, 8];
/** The morning, after the mist. */
export const MORNING: Span = [6, 12];
/** The middle of the day. */
export const MIDDAY: Span = [11, 15];
/** The long warm afternoon. */
export const AFTERNOON: Span = [12, 17];
/** The golden hour and dusk. */
export const EVENING: Span = [17, 21];
/** Dark: moon and stars. */
export const NIGHT: Span = [21, 4];
/** Any time the sun is up. */
export const DAY: Span = [6, 20];
/** Dusk and the dark that follows: the hunters' hours. */
export const LATE: Span = [17, 4];
