import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTROLS, SPEEDS, TIMES, docChoice, docModel, menuModel, speedId, type MenuState } from '../../src/app/menu';
import { DOC_DEFAULTS, watchFromMenu } from '../../src/director/wire';
import { readDocSettings, saveDocSettings } from '../../src/director/settings';
import { PRESETS } from '../../src/world/clock';

const state = (over: Partial<MenuState> = {}): MenuState => ({
  speed: 1 / 60, paused: false, quality: 'auto', tier: 'high', volume: 0.8, muted: false, bring: false, dailyLimit: 10, today: 3, doc: { ...DOC_DEFAULTS }, voice: 'yes', ...over,
});
const row = (s: MenuState, id: string) => menuModel(s).find((r) => r.id === id)!;
const selected = (s: MenuState, id: string) => row(s, id).items.filter((i) => i.selected).map((i) => i.id);

describe('menuModel', () => {
  it('lists the rows in the spec order', () => {
    expect(menuModel(state()).map((r) => r.id)).toEqual(['resume', 'watch', 'time', 'speed', 'quality', 'volume', 'bring', 'limit', 'more']);
    expect(row(state(), 'more').items.map((i) => i.id)).toEqual(['lab', 'controls', 'valley', 'documentary']);
    expect(row(state(), 'more').items.map((i) => i.label)).toEqual(['Creature Lab', 'Controls', 'Valley', 'Documentary']);
    expect(row(state(), 'watch').items.map((i) => i.label)).toEqual(['Watch the documentary']);
    expect(menuModel(state()).some((r) => r.title === 'Moment captions')).toBe(false); // moved to the Documentary page
  });

  it('jumps to dawn, noon, golden hour and night', () => {
    expect(row(state(), 'time').items.map((i) => i.label)).toEqual(['Dawn', 'Noon', 'Golden hour', 'Night']);
    expect(TIMES.map((t) => t.hour)).toEqual([PRESETS.dawn, PRESETS.noon, PRESETS.golden, PRESETS.night]);
  });

  it('maps the clock speeds to 0, 1/120, 1/60, 1/15 and 4/15 valley hours per second', () => {
    expect(SPEEDS.map((s) => [s.id, s.speed])).toEqual([['paused', 0], ['slow', 1 / 120], ['normal', 1 / 60], ['fast', 1 / 15], ['fastest', 4 / 15]]);
    expect(row(state(), 'speed').items.map((i) => i.label)).toEqual(['Paused', 'Slow', 'Normal', 'Fast', 'Fastest']);
    // a day lasts 48, 24 and 6 real minutes, and 90 seconds at Fastest
    expect(SPEEDS.slice(1).map((s) => 24 / s.speed / 60)).toEqual([48, 24, 6, 1.5]);
  });

  it('marks the clock speed in use (paused wins over the speed)', () => {
    expect(selected(state(), 'speed')).toEqual(['normal']);
    expect(selected(state({ speed: 1 / 15 }), 'speed')).toEqual(['fast']);
    expect(selected(state({ speed: 1 / 120 }), 'speed')).toEqual(['slow']);
    expect(selected(state({ speed: 4 / 15 }), 'speed')).toEqual(['fastest']);
    expect(row(state(), 'speed').items).toHaveLength(5);
    expect(selected(state({ paused: true }), 'speed')).toEqual(['paused']);
    expect(speedId(1 / 60, false)).toBe('normal');
    expect(speedId(0.02, false)).toBe('normal'); // an odd speed reads as the nearest
    expect(row(state({ speed: 1 / 120 }), 'speed').note).toMatch(/48 minutes/);
  });

  it('lists Auto first in Quality and shows the tier Auto is using', () => {
    const q = row(state({ quality: 'auto', tier: 'medium' }), 'quality');
    expect(q.items.map((i) => i.id)).toEqual(['auto', 'high', 'medium', 'low']);
    expect(q.items[0].label).toBe('Auto');
    expect(q.items[0].hint).toBe('Medium');
    expect(selected(state({ quality: 'auto' }), 'quality')).toEqual(['auto']);
    expect(selected(state({ quality: 'low', tier: 'low' }), 'quality')).toEqual(['low']);
    expect(row(state({ quality: 'low', tier: 'low' }), 'quality').items[0].hint).toBeUndefined(); // only Auto in use names its tier
  });

  it('shows the volume as a level out of 10, with −, + and Mute', () => {
    const v = row(state({ volume: 0.8 }), 'volume');
    expect(v.items.map((i) => i.id)).toEqual(['down', 'up', 'mute']);
    expect(v.level).toBe(8);
    expect(row(state({ volume: 0 }), 'volume').items[0].disabled).toBe(true);
    expect(row(state({ volume: 1 }), 'volume').items[1].disabled).toBe(true);
    expect(row(state({ volume: 0.30000000000000004 }), 'volume').level).toBe(3);
    const muted = row(state({ muted: true }), 'volume');
    expect(muted.items[2]).toMatchObject({ label: 'Unmute', selected: true });
    expect(muted.level).toBe(8); // the level stays (dimmed): − or + unmutes at it
    expect(muted.off).toBe(true);
  });

  it('has Add a creature (marked while the join card is showing, unmarked when it is off) and Creatures', () => {
    const b = row(state(), 'bring');
    expect(b.items.map((i) => [i.id, i.label])).toEqual([['add', 'Add a creature'], ['creatures', 'Creatures']]);
    expect(selected(state(), 'bring')).toEqual([]);
    expect(selected(state({ bring: true }), 'bring')).toEqual(['add']);
  });

  it('offers the daily limit 5, 10, 20 or 50 with the one in use marked and the count so far', () => {
    const l = row(state({ dailyLimit: 20, today: 7 }), 'limit');
    expect(l.title).toBe('Creatures a day');
    expect(l.items.map((i) => i.label)).toEqual(['5', '10', '20', '50']);
    expect(selected(state({ dailyLimit: 20 }), 'limit')).toEqual(['20']);
    expect(l.note).toBe('7 made today');
    expect(row(state({ dailyLimit: 5, today: 0 }), 'limit').note).toBe('0 made today');
  });
});

const docRow = (s: MenuState, id: string) => docModel(s).find((r) => r.id === id)!;
const docSelected = (s: MenuState, id: string) => docRow(s, id).items.filter((i) => i.selected).map((i) => i.id);

describe('the Documentary page', () => {
  it('has four rows, with the defaults marked', () => {
    expect(docModel(state()).map((r) => r.id)).toEqual(['idle', 'narrator', 'timelapses', 'invitations']);
    expect(docRow(state(), 'idle').items.map((i) => i.label)).toEqual(['After 3 minutes', 'After 10 minutes', 'Off']);
    expect(docRow(state(), 'narrator').items.map((i) => i.label)).toEqual(['Voice and words', 'Words only', 'Off']);
    expect(docRow(state(), 'invitations').title).toBe('Moment invitations');
    expect(docSelected(state(), 'idle')).toEqual(['3']);
    expect(docSelected(state(), 'narrator')).toEqual(['voice']);
    expect(docSelected(state(), 'timelapses')).toEqual(['on']);
    expect(docSelected(state(), 'invitations')).toEqual(['on']);
  });

  it('marks what is chosen', () => {
    const doc = { idle: 'off', narrator: 'words', timelapses: false, invitations: false } as const;
    const s = state({ doc });
    expect([docSelected(s, 'idle'), docSelected(s, 'narrator'), docSelected(s, 'timelapses'), docSelected(s, 'invitations')]).toEqual([['off'], ['words'], ['off'], ['off']]);
  });

  it('says the voice is not available only when the voice client says no', () => {
    const hint = (voice: MenuState['voice']) => docRow(state({ voice }), 'narrator').items[0].hint;
    expect(hint('no')).toBe('not available');
    expect(hint('yes')).toBeUndefined();
    expect(hint('unknown')).toBeUndefined();
    expect(docRow(state({ voice: 'no' }), 'narrator').items[0].disabled).toBeFalsy(); // still selectable
  });

  it('turns each button into the setting it chooses', () => {
    expect(docChoice('idle', '10')).toEqual({ idle: '10' });
    expect(docChoice('idle', 'off')).toEqual({ idle: 'off' });
    expect(docChoice('narrator', 'words')).toEqual({ narrator: 'words' });
    expect(docChoice('timelapses', 'off')).toEqual({ timelapses: false });
    expect(docChoice('invitations', 'on')).toEqual({ invitations: true });
  });

  it('adds the documentary to the controls table', () => {
    const rows = Object.fromEntries(CONTROLS.map(([what, pad, keys]) => [what, [pad, keys]]));
    expect(rows['Watch the documentary (free flight)']).toEqual(['LB', 'P']);
    expect(rows['In the documentary: follow this animal']).toEqual(['A', 'Enter / Space']);
    expect(rows['In the documentary: menu']).toEqual(['Start', 'Esc or N']);
  });
});

describe('the remembered documentary settings', () => {
  const store = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
    return m;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('reads the defaults when nothing is stored', () => {
    store();
    expect(readDocSettings()).toEqual(DOC_DEFAULTS);
  });

  it('keeps each choice under its own key, the invitations on the old captions key', () => {
    const m = store();
    saveDocSettings({ idle: '10', narrator: 'words', timelapses: false, invitations: false });
    expect([...m]).toEqual([['valley.docIdle', '"10"'], ['valley.narrator', '"words"'], ['valley.timelapses', '"off"'], ['valley.captions', '"off"']]);
    expect(readDocSettings()).toEqual({ idle: '10', narrator: 'words', timelapses: false, invitations: false });
  });

  it('reads an old stored captions Off as invitations Off', () => {
    store({ 'valley.captions': '"off"' });
    expect(readDocSettings()).toEqual({ ...DOC_DEFAULTS, invitations: false });
  });

  it('reads junk as the defaults', () => {
    store({ 'valley.docIdle': '"7"', 'valley.narrator': '5', 'valley.timelapses': '"maybe"', 'valley.captions': 'not json' });
    expect(readDocSettings()).toEqual(DOC_DEFAULTS);
  });
});

describe('Watch the documentary from the menu', () => {
  const run = (mode: string, arrival = false, on = false) => {
    const log: string[] = [];
    const ok = watchFromMenu({ arrival, on, mode, letGo: () => log.push('letGo'), start: () => log.push('start') });
    return { ok, log };
  };
  it('starts from free flight as it is', () => expect(run('free')).toEqual({ ok: true, log: ['start'] }));
  it.each(['locked', 'reins', 'map', 'gliding'])('lets go from %s first, then starts', (mode) => expect(run(mode)).toEqual({ ok: true, log: ['letGo', 'start'] }));
  it('is refused during an arrival', () => expect(run('free', true)).toEqual({ ok: false, log: [] }));
  it.each(['directed', 'locked'])('does nothing while the documentary already runs (%s): its shot goes on', (mode) =>
    expect(run(mode, false, true)).toEqual({ ok: true, log: [] }));
});
