import type { Soundscape } from '../audio/soundscape';
import { DEFAULT_LIMIT } from '../bring/protocol';
import { fillCreatures, type CreaturesDeps } from '../bring/creatures-menu';
import { getCap, setCap, type CapNow } from '../bring/host';
import type { QualityChoice, Tier } from '../render/quality';
import type { Button } from '../shared/input';
import { remember } from '../shared/settings';
import type { ValleyClock } from '../world/clock';
import { SPEEDS, openMenu, showLabel, type Menu, type MenuState, type SpeedId } from './menu';

/** Set the clock to a speed from the menu (Paused stops it and keeps the speed it had). */
export function setSpeed(clock: ValleyClock, id: SpeedId) {
  const s = SPEEDS.find((x) => x.id === id);
  if (!s) return;
  clock.paused = id === 'paused';
  if (s.speed > 0) clock.speed = s.speed;
}

export type MenuDeps = {
  ui: HTMLElement;
  clock: ValleyClock;
  sound: Soundscape;
  /** The Quality setting, and the tier running. */
  choice: QualityChoice;
  tier: Tier;
  /** Relight the world (`Infinity` snaps it, after a jump). */
  light(dt: number): void;
  /** The join card's toggle ("Add a creature"): marked while the card is showing, switches it off or on. */
  bring: { readonly cardShown: boolean; toggle(): boolean };
  /** The daily creature limit and today's count, from the server (null when it cannot say). */
  cap?: { get(): Promise<CapNow | null>; set(limit: number): Promise<CapNow | null> };
  /** Is the start screen still up? It comes first. */
  waiting(): boolean;
  /** Does something else have the screen (the workshop)? Then Esc is its Back and the menu stays shut. */
  busy?(): boolean;
  /** The Creatures page's list and what its buttons do (the menu closes itself for Visit and Come back). */
  creatures?: Omit<CreaturesDeps, 'close'>;
};

/**
 * The pause menu's wiring: Start or Esc opens and closes it, B goes back, and its buttons drive the clock, the quality
 * setting and the sound. The world runs on behind it. `press` takes the controller's presses first (true when it used one).
 */
export function menuControl(d: MenuDeps) {
  let menu: Menu | null = null;
  const cap = d.cap ?? { get: () => getCap(), set: (n: number) => setCap(n) };
  let today: CapNow = { count: 0, limit: DEFAULT_LIMIT }; // the last the server said
  const state = (): MenuState => ({
    speed: d.clock.speed, paused: d.clock.paused, quality: d.choice, tier: d.tier, volume: d.sound.volume, muted: d.sound.muted,
    bring: d.bring.cardShown, dailyLimit: today.limit, today: today.count,
  });
  /** Take the server's word for the count and limit (a null answer changes nothing) and redraw if the menu is up. */
  const learn = (c: CapNow | null) => {
    if (c) today = c;
    menu?.update(state());
  };
  const close = () => {
    menu?.close();
    menu = null;
  };
  const toggleMute = () => {
    d.sound.mute(!d.sound.muted);
    menu?.update(state());
  };
  const show = () => {
    if (menu || d.waiting() || d.busy?.()) return;
    if (document.pointerLockElement) document.exitPointerLock(); // hand the mouse back for the buttons
    menu = openMenu(d.ui, state(), {
      resume: close,
      time: (hour, label) => {
        d.clock.jumpTo(hour);
        d.light(Infinity);
        close(); // straight back to the valley to see the new light
        showLabel(d.ui, label);
      },
      speed: (id) => {
        setSpeed(d.clock, id);
        remember('valley.speed', id);
        menu?.update(state());
      },
      quality: (q) => {
        if (q === d.choice && q !== 'auto') return; // Auto again means: measure again
        remember('valley.tier', q);
        if (q === 'auto') remember('valley.autoTier', null); // Auto measures afresh
        location.reload(); // the tier shapes the whole world: build it again (cached, so quick), like the lab does
      },
      volume: (delta) => {
        if (d.sound.muted) d.sound.mute(false);
        d.sound.setVolume(Math.round((d.sound.volume + delta) * 10) / 10);
        menu?.update(state());
      },
      mute: toggleMute,
      bring: () => {
        d.bring.toggle();
        menu?.update(state());
      },
      limit: (n) => {
        today = { ...today, limit: n }; // show the choice at once; the server's answer follows
        menu?.update(state());
        void cap.set(n).then((c) => (c ? learn(c) : cap.get().then(learn)));
      },
      lab: () => (location.href = '/lab.html'),
      creatures: d.creatures && ((page, nav) => void fillCreatures(page, { ...d.creatures!, close }, nav)),
    });
    void cap.get().then(learn); // today's count may have moved since the menu was last up
  };
  const toggle = () => (menu ? close() : show());

  // Esc toggles the menu (like Start). `Input` maps Esc to B, so it is caught first, in the capture phase, and goes no further.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || d.waiting() || d.busy?.()) return; // the start screen's own handler takes it, or the workshop's Back
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) toggle();
  }, true);
  // The browser keeps Esc for itself while the mouse is captured (it lets the mouse go and the page never sees the key), so
  // losing the capture opens the menu, as the press meant. (Opening the menu lets go of it too, with the menu already up.)
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && !menu && !d.waiting()) show();
  });

  return {
    /** The open menu, or null. */
    get open() {
      return menu;
    },
    show,
    close,
    toggleMute,
    /** A controller press: while the menu is open it takes them all (Start closes it); otherwise Start opens it. */
    press(b: Button, repeat = false): boolean {
      if (menu) {
        if (b === 'start') {
          if (!repeat) close();
        } else menu.press(b, repeat);
        return true;
      }
      if (b !== 'start') return false;
      if (!repeat) show();
      return true;
    },
  };
}
export type MenuControl = ReturnType<typeof menuControl>;
