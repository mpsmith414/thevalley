/**
 * When the documentary lets the valley's time run fast: by day after a quiet spell (only check-ins and scenery), at most
 * once in ten minutes; at night when there has long been nothing night-worthy, until the sky starts to lighten. Pure.
 */

/** A day time-lapse comes after this many real seconds with no event going on. */
export const DAY_QUIET_S = 120;
/** At most one day time-lapse in this many real seconds. */
export const DAY_LAPSE_EVERY_S = 600;
/** A night time-lapse comes after this many real seconds of night with nothing night-worthy going on. */
export const NIGHT_QUIET_S = 180;
/** The sky starts to lighten once the sun is this far below the horizon (degrees), on its way up. */
export const DAWN_DEG = -6;

/**
 * Whether to play a time-lapse now, and which: `quietFor` is how long (s) there has been no event by day,
 * `nightWorthyFor` how long the night has gone with nothing night-worthy, and `lastDayLapse` when the last day one began.
 * None at all when time-lapses are off (the night is then filmed as it is).
 */
export function wantTimelapse(o: { now: number; night: boolean; enabled: boolean; lastDayLapse: number; quietFor: number; nightWorthyFor: number }): 'day' | 'night' | null {
  if (!o.enabled) return null;
  if (o.night) return o.nightWorthyFor >= NIGHT_QUIET_S ? 'night' : null;
  return o.quietFor >= DAY_QUIET_S && o.now - o.lastDayLapse >= DAY_LAPSE_EVERY_S ? 'day' : null;
}

/**
 * Whether a night time-lapse is over: the sun is within 6° below the horizon (degrees, `sunElevationDeg`) and rising,
 * that is above `lowestDeg`, the lowest it has been during the lapse (left out, only the height counts).
 */
export function nightLapseOver(sunElevationDeg: number, lowestDeg = -Infinity): boolean {
  return sunElevationDeg >= DAWN_DEG && sunElevationDeg > lowestDeg;
}
