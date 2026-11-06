/** The ground is cut into squares this wide (m) to remember where the main camera has drawn. */
export const DRAWN_CELL_M = 64;
/** A spot the main camera drew is remembered this long (real s): its shaders, bodies and plants are warm till then. */
export const DRAWN_KEEP_S = 180;

/**
 * Where the main camera has drawn lately, in coarse squares of ground. A cut to a spot it has not drawn will meet that
 * spot's first-sight work (shaders, bodies, plants), which can take a long frame: the documentary hides that frame behind
 * a dip through black, whatever the distance. Pure.
 */
export class DrawnMemory {
  private at = new Map<string, number>();
  private key = (x: number, z: number) => `${Math.floor(x / DRAWN_CELL_M)},${Math.floor(z / DRAWN_CELL_M)}`;

  /** The camera draws the ground at (`x`, `z`) at real time `now`. */
  visit(x: number, z: number, now: number): void {
    this.at.set(this.key(x, z), now);
    if (this.at.size > 400) for (const [k, t] of this.at) if (now - t > DRAWN_KEEP_S) this.at.delete(k);
  }

  /** Has the ground at (`x`, `z`) been drawn within the last DRAWN_KEEP_S? */
  seen(x: number, z: number, now: number): boolean {
    const t = this.at.get(this.key(x, z));
    return t !== undefined && now - t <= DRAWN_KEEP_S;
  }
}
