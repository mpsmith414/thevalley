import { describe, expect, it } from 'vitest';
import { BUTTONS } from '../../src/shared/input';
import { keyAction, viewAction } from '../../src/views/keys';
import type { Mode } from '../../src/views/views';

const MODES: Mode[] = ['free', 'gliding', 'locked', 'reins', 'map', 'diving'];

describe('viewAction', () => {
  it('in free flight: A locks on to a highlighted animal, and nothing without one; X, Y, LB, RB and B are free flight own', () => {
    expect(viewAction('a', 'free', true)).toBe('lock');
    expect(viewAction('a', 'free', false)).toBeNull();
    for (const b of ['x', 'y', 'lb', 'rb', 'b', 'lt', 'rt', 'up', 'down', 'left', 'right', 'start'] as const) {
      expect(viewAction(b, 'free', true), b).toBeNull();
    }
  });

  it('locked: X senses, Y changes view, LB / RB step to the neighbours, A takes the reins, B lets go', () => {
    expect(viewAction('x', 'locked', false)).toBe('sense');
    expect(viewAction('y', 'locked', false)).toBe('cycleView');
    expect(viewAction('lb', 'locked', false)).toBe('prev');
    expect(viewAction('rb', 'locked', false)).toBe('next');
    expect(viewAction('a', 'locked', true)).toBe('reins');
    expect(viewAction('b', 'locked', false)).toBe('letGo');
    for (const b of ['lt', 'rt', 'up', 'down', 'left', 'right', 'start'] as const) expect(viewAction(b, 'locked', false), b).toBeNull();
  });

  it('gliding to an animal: as locked, but A waits for the glide to arrive', () => {
    expect(viewAction('a', 'gliding', true)).toBeNull();
    expect(viewAction('b', 'gliding', false)).toBe('letGo');
    expect(viewAction('y', 'gliding', false)).toBe('cycleView');
    expect(viewAction('x', 'gliding', false)).toBe('sense');
    expect(viewAction('rb', 'gliding', false)).toBe('next');
  });

  it('with the reins: A is Do, B hands them back, X and Y as locked, and RB (run) never steps to another animal', () => {
    expect(viewAction('a', 'reins', false)).toBe('do');
    expect(viewAction('b', 'reins', false)).toBe('reins');
    expect(viewAction('x', 'reins', false)).toBe('sense');
    expect(viewAction('y', 'reins', false)).toBe('cycleView');
    expect(viewAction('lb', 'reins', false)).toBeNull();
    expect(viewAction('rb', 'reins', false)).toBeNull();
  });

  it('View / Select opens the map from any mode, and on the map A chooses and B or Select closes it', () => {
    for (const m of MODES.filter((m) => m !== 'map')) expect(viewAction('select', m, false), m).toBe('map');
    expect(viewAction('a', 'map', true)).toBe('choose');
    expect(viewAction('b', 'map', false)).toBe('closeMap');
    expect(viewAction('select', 'map', false)).toBe('closeMap');
    for (const b of ['x', 'y', 'lb', 'rb'] as const) expect(viewAction(b, 'map', false), b).toBeNull();
  });

  it('never steps to a neighbour for the bumpers the keyboard sends ([ and ] are the time steps)', () => {
    for (const m of MODES) {
      for (const b of ['lb', 'rb'] as const) {
        const a = viewAction(b, m, true, true);
        expect(a === 'prev' || a === 'next', `${m} ${b}`).toBe(false);
      }
    }
    expect(viewAction('b', 'locked', false, true)).toBe('letGo'); // Backspace is the keyboard's B
    expect(viewAction('a', 'free', true, true)).toBe('lock'); // Enter / Space
  });

  it('knows every button without throwing', () => {
    for (const m of MODES) for (const b of BUTTONS) expect(() => viewAction(b, m, true)).not.toThrow();
  });
});

describe('keyAction', () => {
  it('V changes view, , and . step to the neighbours, R takes or hands back the reins, while watching an animal', () => {
    expect(keyAction('v', 'locked')).toBe('cycleView');
    expect(keyAction('V', 'reins')).toBe('cycleView');
    expect(keyAction(',', 'locked')).toBe('prev');
    expect(keyAction('.', 'locked')).toBe('next');
    expect(keyAction(',', 'reins')).toBeNull();
    expect(keyAction('r', 'locked')).toBe('reins');
    expect(keyAction('R', 'reins')).toBe('reins');
  });

  it('Tab opens the map from anywhere and closes it on the map', () => {
    for (const m of MODES.filter((m) => m !== 'map')) expect(keyAction('Tab', m), m).toBe('map');
    expect(keyAction('Tab', 'map')).toBe('closeMap');
  });

  it('leaves free flight and the map their own keys, and the time steps theirs', () => {
    for (const k of ['v', ',', '.', 'r']) {
      expect(keyAction(k, 'free'), k).toBeNull();
      expect(keyAction(k, 'map'), k).toBeNull();
    }
    for (const m of MODES) for (const k of ['[', ']', 'f', 'g', 'w', 'e', 'q']) expect(keyAction(k, m), `${m} ${k}`).toBeNull();
  });
});
