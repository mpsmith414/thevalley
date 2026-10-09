/** Frames in the median window; above `SLOW` ms it steps down, below `FAST` ms for `RECOVER` frames in a row it steps up. */
const WINDOW = 60, SLOW = 17.5, FAST = 14, RECOVER = 120;
const DOWN = 0.92, UP = 1.04, HOLD_MS = 500;

/**
 * Dynamic resolution: fed each frame's milliseconds, it lowers the render scale in heavy views to hold 60 fps and creeps back
 * to full resolution when frames are light again. It reads the median of the last 60 frames (so a hitch does not count),
 * steps by ×0.92 down (to `min`) or ×1.04 up (to 1), and changes at most once every 0.5 s of frames.
 */
export class ResolutionScaler {
  /** The render scale now, `min`..1 (multiply the base pixel ratio by it). */
  scale = 1;
  private frames: number[] = [];
  private fastRun = 0; // frames in a row with a fast median
  private sinceChange = 0; // ms of frames since the last change

  constructor(readonly min: number) {}

  /** One frame's milliseconds in; the scale to draw at out. */
  push(frameMs: number): number {
    this.frames.push(frameMs);
    if (this.frames.length > WINDOW) this.frames.shift();
    this.sinceChange += frameMs;
    const median = [...this.frames].sort((a, b) => a - b)[this.frames.length >> 1];
    this.fastRun = median < FAST ? this.fastRun + 1 : 0;
    if (this.sinceChange < HOLD_MS) return this.scale;
    if (this.frames.length === WINDOW && median > SLOW && this.scale > this.min) this.set(Math.max(this.min, this.scale * DOWN));
    else if (this.fastRun >= RECOVER && this.scale < 1) this.set(Math.min(1, this.scale * UP));
    return this.scale;
  }

  private set(scale: number) {
    this.scale = scale;
    this.sinceChange = 0;
    this.fastRun = 0;
  }
}
