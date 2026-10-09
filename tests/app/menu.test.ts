import { describe, expect, it } from 'vitest';
import { SPEEDS, TIMES, menuModel, speedId, type MenuState } from '../../src/app/menu';
import { PRESETS } from '../../src/world/clock';

const state = (over: Partial<MenuState> = {}): MenuState => ({
  speed: 1 / 60, paused: false, quality: 'auto', tier: 'high', volume: 0.8, muted: false, ...over,
});
const row = (s: MenuState, id: string) => menuModel(s).find((r) => r.id === id)!;
const selected = (s: MenuState, id: string) => row(s, id).items.filter((i) => i.selected).map((i) => i.id);

describe('menuModel', () => {
  it('lists the rows in the spec order', () => {
    expect(menuModel(state()).map((r) => r.id)).toEqual(['resume', 'time', 'speed', 'quality', 'volume', 'more']);
    expect(row(state(), 'more').items.map((i) => i.id)).toEqual(['lab', 'controls']);
  });

  it('jumps to dawn, noon, golden hour and night', () => {
    expect(row(state(), 'time').items.map((i) => i.label)).toEqual(['Dawn', 'Noon', 'Golden hour', 'Night']);
    expect(TIMES.map((t) => t.hour)).toEqual([PRESETS.dawn, PRESETS.noon, PRESETS.golden, PRESETS.night]);
  });

  it('maps the clock speeds to 0, 1/120, 1/60 and 1/15 valley hours per second', () => {
    expect(SPEEDS.map((s) => [s.id, s.speed])).toEqual([['paused', 0], ['slow', 1 / 120], ['normal', 1 / 60], ['fast', 1 / 15]]);
    expect(row(state(), 'speed').items.map((i) => i.label)).toEqual(['Paused', 'Slow', 'Normal', 'Fast']);
    // a day lasts 48, 24 and 6 real minutes
    expect(SPEEDS.slice(1).map((s) => 24 / s.speed / 60)).toEqual([48, 24, 6]);
  });

  it('marks the clock speed in use (paused wins over the speed)', () => {
    expect(selected(state(), 'speed')).toEqual(['normal']);
    expect(selected(state({ speed: 1 / 15 }), 'speed')).toEqual(['fast']);
    expect(selected(state({ speed: 1 / 120 }), 'speed')).toEqual(['slow']);
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
});
