import { DEFAULT_SPEED, type ValleyClock } from '../world/clock';
import { SPEEDS, type SpeedId } from './menu';

/** How fast the animals live compared with Normal: 0 paused, 0.5 Slow, 1 Normal, 4 Fast, 16 Fastest. */
export const animalRate = (clock: Pick<ValleyClock, 'paused' | 'speed'>): number => (clock.paused ? 0 : clock.speed / DEFAULT_SPEED);

/** The speed a step up (1) or down (-1) from `id` gives; it stops at Paused and at Fastest. */
export function stepSpeed(id: SpeedId, dir: 1 | -1): SpeedId {
  const i = SPEEDS.findIndex((s) => s.id === id) + dir;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))].id;
}

/**
 * A release arrival always plays at Normal: `hold()` sets Normal and remembers the player's speed, `release()` puts it back
 * (unless the player chose a speed meanwhile: then theirs stands).
 */
export class ReleaseTimeHold {
  private was: { speed: number; paused: boolean } | null = null;
  constructor(private readonly clock: ValleyClock) {}

  /** An arrival begins: remember the speed (the first time only) and play at Normal. */
  hold(): void {
    if (this.was) return;
    this.was = { speed: this.clock.speed, paused: this.clock.paused };
    this.clock.paused = false;
    this.clock.speed = DEFAULT_SPEED;
  }

  /** The arrival is over: give back the speed that was remembered, if any. */
  release(): void {
    if (!this.was) return;
    this.clock.speed = this.was.speed;
    this.clock.paused = this.was.paused;
    this.was = null;
  }

  /** The player picked a speed: it stands, so `release()` restores nothing. */
  playerChanged(): void {
    this.was = null;
  }

  get held(): boolean {
    return this.was !== null;
  }

  /** What `release()` would restore (for the save); null when nothing is held. */
  get remembered(): { speed: number; paused: boolean } | null {
    return this.was && { ...this.was };
  }
}
