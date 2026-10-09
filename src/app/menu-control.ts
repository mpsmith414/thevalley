import type { Soundscape } from '../audio/soundscape';
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
  /** Is the start screen still up? It comes first. */
  waiting(): boolean;
};

/**
 * The pause menu's wiring: Start or Esc opens and closes it, B goes back, and its buttons drive the clock, the quality
 * setting and the sound. The world runs on behind it. `press` takes the controller's presses first (true when it used one).
 */
export function menuControl(d: MenuDeps) {
  let menu: Menu | null = null;
  const state = (): MenuState => ({ speed: d.clock.speed, paused: d.clock.paused, quality: d.choice, tier: d.tier, volume: d.sound.volume, muted: d.sound.muted });
  const close = () => {
    menu?.close();
    menu = null;
  };
  const toggleMute = () => {
    d.sound.mute(!d.sound.muted);
    menu?.update(state());
  };
  const show = () => {
    if (menu || d.waiting()) return;
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
        if (q === d.choice) return;
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
      lab: () => (location.href = '/lab.html'),
    });
  };
  const toggle = () => (menu ? close() : show());

  // Esc toggles the menu (like Start). `Input` maps Esc to B, so it is caught first, in the capture phase, and goes no further.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || d.waiting()) return; // the start screen's own handler takes it
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
