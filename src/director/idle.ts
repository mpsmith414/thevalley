/**
 * When the documentary starts and stops: the idle timer that starts it once the family has put the controller down, and
 * the handover that gives the valley back the moment anyone touches anything (the touch is used up doing it). Pure.
 */
import type { Button } from '../shared/input';

/**
 * Starts the documentary after `afterS()` real seconds without input (null: never, the menu's Off). It only counts while
 * `counts` (free flight or the map, with nothing else on the screen); while it does not, it holds where it was. Any input
 * starts it again from nothing.
 */
export class IdleTimer {
  private t = 0;
  private fired = false;

  constructor(private readonly afterS: () => number | null) {}

  /** One frame of `dt` real seconds: true once, on the frame it fires (then not again until there has been input). */
  update(dt: number, o: { input: boolean; counts: boolean }): boolean {
    if (o.input) {
      this.t = 0;
      this.fired = false;
      return false;
    }
    const after = this.afterS();
    if (!o.counts || after === null || this.fired) return false;
    this.t += dt;
    if (this.t < after) return false;
    this.fired = true;
    return true;
  }
}

/** What the handover needs of the documentary: whether it runs, and giving the camera back (A: locked on to its subject). */
export type Takes = { readonly on: boolean; takeOver(how: 'free' | 'lock'): void };

/**
 * The player's hands while the documentary runs: any button, key, click, stick or mouse move takes over at once, and the
 * input that does is used up (it is not also passed to free flight or the views, so B or Esc does not also do its job).
 * A takes over locked on to the subject. Start is the menu's: it opens the menu over the documentary (the caller sends
 * it to the menu first).
 */
export class Handover {
  /** A key took over through its button: the same key's own handler must not act on it too. */
  private keyUsed = false;
  /** Something took over between frames: the next frame's sticks and mouse go nowhere. */
  private frameUsed = false;

  constructor(private readonly doc: Takes) {}

  /** A button (or a key that sends one, `fromKey`): true when the documentary took it. */
  press(b: Button, fromKey: boolean): boolean {
    if (!this.doc.on || b === 'start') return false;
    this.doc.takeOver(b === 'a' ? 'lock' : 'free');
    this.frameUsed = true;
    this.keyUsed = fromKey;
    return true;
  }

  /** Any other key, or a click: true when it is used up (it took over, or its button already did). */
  other(): boolean {
    if (this.keyUsed) {
      this.keyUsed = false;
      return true;
    }
    if (!this.doc.on) return false;
    this.doc.takeOver('free');
    this.frameUsed = true;
    return true;
  }

  /** The sticks and the mouse this frame (`any`: moved at all): true when they go nowhere else (the documentary has them). */
  hands(any: boolean): boolean {
    if (this.frameUsed) {
      this.frameUsed = false;
      return true;
    }
    if (!this.doc.on) return false;
    if (any) this.doc.takeOver('free');
    return true;
  }
}
