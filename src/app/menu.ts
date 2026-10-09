import { h } from '../lab/ui/dom';
import { QUALITY_CHOICES, type QualityChoice, type Tier } from '../render/quality';
import { FocusRing } from '../shared/focus';
import type { Button } from '../shared/input';
import { PRESETS } from '../world/clock';

/** The time-of-day jumps. */
export const TIMES = [
  { id: 'dawn', label: 'Dawn', hour: PRESETS.dawn },
  { id: 'noon', label: 'Noon', hour: PRESETS.noon },
  { id: 'golden', label: 'Golden hour', hour: PRESETS.golden },
  { id: 'night', label: 'Night', hour: PRESETS.night },
] as const;

export type SpeedId = 'paused' | 'slow' | 'normal' | 'fast';
/** The clock speeds, in valley hours per real second (Paused stops the clock and keeps its speed). */
export const SPEEDS: readonly { id: SpeedId; label: string; speed: number; note: string }[] = [
  { id: 'paused', label: 'Paused', speed: 0, note: 'The sun and moon stand still.' },
  { id: 'slow', label: 'Slow', speed: 1 / 120, note: 'A whole day takes 48 minutes.' },
  { id: 'normal', label: 'Normal', speed: 1 / 60, note: 'A whole day takes 24 minutes.' },
  { id: 'fast', label: 'Fast', speed: 1 / 15, note: 'A whole day takes 6 minutes.' },
];
/** The speed setting a clock is at: Paused, or the nearest of the others. */
export const speedId = (speed: number, paused: boolean): SpeedId => {
  if (paused || !(speed > 0)) return 'paused';
  const off = (s: number) => Math.abs(Math.log(speed / s));
  return SPEEDS.slice(1).reduce((a, b) => (off(b.speed) < off(a.speed) ? b : a)).id;
};

const TIER_LABEL: Record<Tier, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const tierLabel = (t: Tier) => TIER_LABEL[t];

/** What the menu shows: the clock, the quality setting (and the tier running now), and the sound. */
export type MenuState = { speed: number; paused: boolean; quality: QualityChoice; tier: Tier; volume: number; muted: boolean };
export type MenuItem = { id: string; label: string; hint?: string; selected?: boolean; disabled?: boolean; aria?: string };
export type MenuRow = {
  id: 'resume' | 'time' | 'speed' | 'quality' | 'volume' | 'more'; title?: string; items: MenuItem[]; note?: string;
  /** Volume only: the level out of 10, and whether it is muted (the level then shows dimmed). */
  level?: number; off?: boolean;
};

/** The menu's rows and buttons for a state, with the values in use marked (pure: the DOM is drawn from this). */
export function menuModel(s: MenuState): MenuRow[] {
  const sp = speedId(s.speed, s.paused), level = Math.round(s.volume * 10);
  return [
    { id: 'resume', items: [{ id: 'resume', label: 'Resume' }] },
    { id: 'time', title: 'Time of day', items: TIMES.map((t) => ({ id: t.id, label: t.label })) },
    { id: 'speed', title: 'Clock speed', items: SPEEDS.map((x) => ({ id: x.id, label: x.label, selected: x.id === sp })),
      note: SPEEDS.find((x) => x.id === sp)!.note },
    { id: 'quality', title: 'Quality',
      items: QUALITY_CHOICES.map((q) => ({ id: q, label: q === 'auto' ? 'Auto' : tierLabel(q), hint: q === 'auto' && s.quality === 'auto' ? tierLabel(s.tier) : undefined, selected: q === s.quality })),
      note: 'Changing it restarts the valley.' },
    { id: 'volume', title: 'Volume', level, off: s.muted, items: [
      { id: 'down', label: '−', aria: 'Quieter', disabled: level <= 0 },
      { id: 'up', label: '+', aria: 'Louder', disabled: level >= 10 },
      { id: 'mute', label: s.muted ? 'Unmute' : 'Mute', selected: s.muted },
    ] },
    { id: 'more', items: [{ id: 'lab', label: 'Creature Lab' }, { id: 'controls', label: 'Controls' }] },
  ];
}

/** What the menu's buttons do. */
export type MenuHandlers = {
  resume(): void;
  time(hour: number, label: string): void;
  speed(id: SpeedId): void;
  quality(q: QualityChoice): void;
  /** Change the volume by `delta` (±0.1). */
  volume(delta: number): void;
  mute(): void;
  lab(): void;
};

/** The controls, as the valley binds them: what it does, the controller, the keyboard and mouse. */
export const CONTROLS: readonly [string, string, string][] = [
  ['Look around', 'Right stick', 'Mouse (click the valley first)'],
  ['Move', 'Left stick', 'W A S D'],
  ['Fly up / down', 'RT / LT', 'E / Q'],
  ['Go faster', 'Hold RB', 'Hold Shift'],
  ['Walk on the ground', 'Y', 'G'],
  ['Fly to the next place', 'D-pad ◀ ▶', 'Arrow keys ◀ ▶'],
  ['Fly to place 1 to 8', '', 'Keys 1 to 8'],
  ['Menu', 'Start', 'Esc'],
  ['Choose in the menu', 'D-pad and A', 'Arrow keys and Enter'],
  ['Back', 'B', 'Backspace'],
  ['Sound on / off', '', 'M'],
];

/**
 * The pause menu: a big, centred panel of buttons for the couch (the d-pad moves a focus ring, A presses, B goes back).
 * `press` takes the controller's buttons while it is open; `update` redraws it for a new state (the focus stays put).
 * The world keeps running behind it.
 */
export function openMenu(root: HTMLElement, state: MenuState, on: MenuHandlers) {
  const main = h('section', { class: 'menu-panel', role: 'dialog', 'aria-label': 'Valley menu' });
  const controls = h('section', { class: 'menu-panel menu-controls', role: 'dialog', 'aria-label': 'Controls', hidden: true },
    h('h2', { class: 'menu-heading' }, 'Controls'),
    h('table', { class: 'menu-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '🎮 Controller'), h('th', {}, '⌨️ Keyboard and mouse'))),
      h('tbody', {}, ...CONTROLS.map(([what, pad, keys]) => h('tr', {}, h('th', { scope: 'row' }, what), h('td', {}, pad || '—'), h('td', {}, keys))))),
    h('button', { class: 'menu-btn menu-back', type: 'button', 'data-focus': true, 'data-key': 'back', onclick: () => showControls(false) }, 'Back'),
  );
  const screen = h('div', { class: 'menu' }, main, controls);
  root.append(screen);
  const ring = new FocusRing(() => (controls.hidden ? main : controls));
  // a click or Tab moves the ring too, so the controller and the mouse agree on what is focused
  screen.addEventListener('focusin', (e) => e.target instanceof HTMLElement && e.target.dataset.focus !== undefined && ring.focus(e.target));

  const act = (row: MenuRow['id'], id: string) => {
    if (row === 'resume') on.resume();
    else if (row === 'time') {
      const t = TIMES.find((x) => x.id === id)!;
      on.time(t.hour, t.label);
    } else if (row === 'speed') on.speed(id as SpeedId);
    else if (row === 'quality') on.quality(id as QualityChoice);
    else if (row === 'volume') {
      if (id === 'mute') on.mute();
      else if (!current.find((r) => r.id === 'volume')!.items.find((i) => i.id === id)!.disabled) on.volume(id === 'up' ? 0.1 : -0.1);
    } else if (id === 'lab') on.lab();
    else if (id === 'controls') showControls(true);
  };

  let current: MenuRow[] = [];
  const draw = (s: MenuState) => {
    const was = main.querySelector<HTMLElement>('.focused')?.dataset.key;
    current = menuModel(s);
    main.replaceChildren(h('h2', { class: 'menu-heading' }, 'Valley menu'), ...current.map((row) => {
      const buttons: HTMLElement[] = row.items.map((it) => h('button', {
        class: `menu-btn${it.selected ? ' on' : ''}${row.id === 'resume' ? ' menu-resume' : ''}${it.disabled ? ' dim' : ''}`, type: 'button',
        'data-focus': true, 'data-key': `${row.id}:${it.id}`, 'aria-label': it.aria, 'aria-disabled': it.disabled ? 'true' : undefined,
        'aria-pressed': row.id === 'speed' || row.id === 'quality' || it.id === 'mute' ? String(!!it.selected) : undefined,
        onclick: () => act(row.id, it.id),
      }, it.label, it.hint ? h('span', { class: 'menu-hint' }, ` · ${it.hint}`) : null));
      if (row.level !== undefined) {
        const pips = h('span', { class: `menu-level${row.off ? ' off' : ''}`, role: 'img', 'aria-label': row.off ? 'Sound off' : `Volume ${row.level} of 10` },
          ...Array.from({ length: 10 }, (_, i) => h('i', { class: i < row.level! ? 'lit' : '', style: `height: ${20 + i * 4}px` })));
        buttons.splice(1, 0, pips);
      }
      return h('div', { class: `menu-row menu-row-${row.id}` },
        h('div', { class: 'menu-title' }, row.title ?? ''),
        h('div', { class: 'menu-items' }, ...buttons),
        row.note ? h('div', { class: 'menu-note' }, row.note) : null);
    }));
    const keep = was && main.querySelector<HTMLElement>(`[data-key="${was}"]`);
    if (keep) ring.focus(keep);
  };
  const showControls = (show: boolean) => {
    controls.hidden = !show;
    main.hidden = show;
    if (show) ring.reset();
    else ring.focus(main.querySelector<HTMLElement>('[data-key="more:controls"]'));
  };

  draw(state);
  ring.reset();
  return {
    el: screen,
    focus: ring,
    /** Is the controls panel showing? */
    get controlsOpen() {
      return !controls.hidden;
    },
    /** A controller (or keyboard) press while the menu is open: the d-pad moves, A presses, B goes back. */
    press(b: Button, repeat = false) {
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') return ring.move(b);
      if (repeat) return;
      if (b === 'a') return ring.activate();
      if (b === 'b') return controls.hidden ? on.resume() : showControls(false);
    },
    update: draw,
    close() {
      screen.classList.add('closing');
      setTimeout(() => screen.remove(), 250);
    },
  };
}
export type Menu = ReturnType<typeof openMenu>;

let label: HTMLElement | null = null;
/** A soft pill at the bottom centre for 2.5 s ("Golden hour", "Lake Shore"); a new one replaces the last. */
export function showLabel(root: HTMLElement, text: string, ms = 2500) {
  label?.remove();
  const el = (label = h('div', { class: 'label-pill', role: 'status' }, text));
  root.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => {
    el.remove();
    if (label === el) label = null;
  }, ms + 500);
}
