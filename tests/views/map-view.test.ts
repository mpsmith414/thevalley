import { describe, expect, it } from 'vitest';
import { wheelTurn } from '../../src/views/map-view';

describe("the map's wheel", () => {
  const canvas = {}, menu = {};
  const over = (t: unknown) => t === canvas;
  it('zooms the map (a notch at a time, in for a turn away) only over the valley with nothing over the map', () => {
    expect(wheelTurn({ deltaY: -100, target: canvas }, over, true)).toBe(1);
    expect(wheelTurn({ deltaY: 250, target: canvas }, over, true)).toBe(-1);
    expect(wheelTurn({ deltaY: 30, target: canvas }, over, true)).toBeCloseTo(-0.3, 9);
  });

  it('leaves the wheel alone with the menu over the map, over anything else, or off the map', () => {
    expect(wheelTurn({ deltaY: -100, target: canvas }, over, false)).toBeNull(); // the menu (or the workshop) is up, or the map is not
    expect(wheelTurn({ deltaY: -100, target: menu }, over, true)).toBeNull(); // over the menu's own page: it scrolls
  });
});
