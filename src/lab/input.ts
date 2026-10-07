/** Controller first, keyboard and mouse too: one stream of orbit/zoom/button events. */

export const BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'start', 'select', 'up', 'down', 'left', 'right'] as const;
export type Button = (typeof BUTTONS)[number];
export type PadState = { lx: number; ly: number; rx: number; ry: number } & Record<Button, boolean>;

const DEADZONE = 0.15;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

export const EMPTY_PAD: PadState = { lx: 0, ly: 0, rx: 0, ry: 0, ...(Object.fromEntries(BUTTONS.map((b) => [b, false])) as Record<Button, boolean>) };

/** Read a standard-mapping gamepad (Xbox / PlayStation layout) into a tidy state. */
export function readPad(gp: { axes: readonly number[]; buttons: readonly { pressed: boolean }[] } | null): PadState {
  if (!gp) return { ...EMPTY_PAD };
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  return {
    lx: dz(gp.axes[0] ?? 0), ly: dz(gp.axes[1] ?? 0), rx: dz(gp.axes[2] ?? 0), ry: dz(gp.axes[3] ?? 0),
    a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), lt: b(6), rt: b(7),
    select: b(8), start: b(9), up: b(12), down: b(13), left: b(14), right: b(15),
  };
}

/** Buttons that went down between two states. */
export function edges(prev: PadState, next: PadState): Button[] {
  return BUTTONS.filter((k) => next[k] && !prev[k]);
}

const KEYS: Record<string, Button> = {
  Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b', x: 'x', X: 'x', y: 'y', Y: 'y', '[': 'lb', ']': 'rb', n: 'start', N: 'start',
  '`': 'select', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

/**
 * Polls the first gamepad every frame and listens to the keyboard.
 * Emits presses (repeating d-pad/stick moves for menus) and continuous orbit/zoom.
 */
export class Input {
  private prev: PadState = { ...EMPTY_PAD };
  private held = new Set<string>();
  private repeatAt = 0;
  onPress: (b: Button) => void = () => {};
  /** Set by the gamepad hook in dev checks to stand in for a real controller. */
  padStub: PadState | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing && e.key !== 'Escape') return;
      this.held.add(e.key.toLowerCase());
      const b = KEYS[e.key];
      if (b) {
        e.preventDefault();
        this.onPress(b);
      }
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.key.toLowerCase()));
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Call once per frame; returns how far to orbit (radians) and zoom (factor change) this frame. */
  poll(dt: number, menuOpen: boolean): { orbitX: number; orbitY: number; zoom: number } {
    const pad = this.padStub ?? readPad(navigator.getGamepads?.()[0] ?? null);
    for (const b of edges(this.prev, pad)) this.onPress(b);
    // a held stick in a menu repeats like a d-pad
    const now = performance.now();
    if (menuOpen && (Math.abs(pad.lx) > 0.6 || Math.abs(pad.ly) > 0.6) && now > this.repeatAt) {
      this.repeatAt = now + 220;
      this.onPress(Math.abs(pad.lx) > Math.abs(pad.ly) ? (pad.lx > 0 ? 'right' : 'left') : pad.ly > 0 ? 'down' : 'up');
    }
    this.prev = pad;
    const k = (key: string) => (this.held.has(key) ? 1 : 0);
    const stickX = menuOpen ? 0 : pad.lx, stickY = menuOpen ? 0 : pad.ly;
    return {
      orbitX: (stickX + k('d') - k('a')) * 1.8 * dt,
      orbitY: (stickY + k('s') - k('w')) * 1.2 * dt,
      zoom: (pad.ry + k('e') - k('q')) * 1.5 * dt,
    };
  }
}
