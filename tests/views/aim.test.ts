import { describe, expect, it } from 'vitest';
import { AimHold, aimAngle, aimReach, neighbours, pickAim, stepNeighbour, type Candidate } from '../../src/views/aim';

const eye = { x: 0, y: 2, z: 0 };
const fwd = { x: 0, y: 0, z: -1 };
const free = () => false;
const deg = (d: number) => (d * Math.PI) / 180;
/** An animal `d` m ahead of the eye and `off` degrees to the right of the centre, at eye height. */
const at = (id: string, d: number, off = 0, size = 2, drawn = true): Candidate => ({
  id,
  size,
  drawn,
  pos: { x: d * Math.sin(deg(off)), y: 2, z: -d * Math.cos(deg(off)) },
});

describe('aimReach', () => {
  it('runs from 20 m for a small thing, to about 91 m for a deer, capped at 150 m', () => {
    expect(aimReach(0.1)).toBe(20);
    expect(aimReach(2)).toBeCloseTo(90.9, 0);
    expect(aimReach(50)).toBe(150);
  });
});

describe('pickAim', () => {
  it('takes the animal nearest the centre of the screen', () => {
    const pick = pickAim([at('a', 30, 4), at('b', 30, -1), at('c', 30, 6)], eye, fwd, free);
    expect(pick?.id).toBe('b');
    expect(pick?.angle).toBeCloseTo(deg(1), 5);
  });

  it('skips an animal out of reach, not drawn, or hidden behind the terrain', () => {
    const far = at('far', 120, 0, 0.1);
    const stowed = at('stowed', 20, 0, 2, false);
    const hidden = at('hidden', 20, 0);
    const shown = at('shown', 40, 5);
    const occluded = (_from: unknown, to: { z: number }) => to.z === hidden.pos.z;
    expect(pickAim([far, stowed, hidden, shown], eye, fwd, occluded)?.id).toBe('shown');
    expect(pickAim([far, stowed], eye, fwd, free)).toBeNull();
  });

  it('lets a near animal 12 degrees off in (its 1.5 m round is wide) but not a far one', () => {
    expect(pickAim([at('near', 5, 12)], eye, fwd, free)?.id).toBe('near');
    expect(pickAim([at('far', 60, 12)], eye, fwd, free)).toBeNull();
    expect(aimAngle(at('far', 60, 9), eye, fwd)).not.toBeNull();
  });

  it('gives a tie to the nearer', () => {
    expect(pickAim([at('far', 50, 3), at('near', 20, 3)], eye, fwd, free)?.id).toBe('near');
    expect(pickAim([at('near', 20, 3), at('far', 50, 3)], eye, fwd, free)?.id).toBe('near');
  });

  it('never picks one behind the camera', () => {
    expect(pickAim([at('behind', 10, 180)], eye, fwd, free)).toBeNull();
  });
});

describe('AimHold', () => {
  it('takes the first pick, keeps it against a slightly better one, switches to a clearly better one', () => {
    const h = new AimHold();
    const angles: Record<string, number> = { a: deg(3), b: deg(2.5) };
    expect(h.update({ id: 'a', angle: deg(3) }, (id) => angles[id], 0.016)).toBe('a');
    expect(h.update({ id: 'b', angle: deg(2.5) }, (id) => angles[id], 0.016)).toBe('a');
    angles.b = deg(1.5);
    expect(h.update({ id: 'b', angle: deg(1.5) }, (id) => angles[id], 0.016)).toBe('b');
  });

  it('forgets what it held when reset (a lock starting or ending), and takes the next pick at once', () => {
    const h = new AimHold();
    h.update({ id: 'a', angle: deg(3) }, () => deg(3), 0.016);
    h.reset();
    expect(h.update({ id: 'b', angle: deg(2.5) }, () => deg(2.5), 0.016)).toBe('b');
    h.reset();
    expect(h.update(null, () => null, 0.016)).toBeNull();
  });

  it('lets go 0.3 s after its animal leaves the cone, not before', () => {
    const h = new AimHold();
    h.update({ id: 'a', angle: deg(3) }, () => deg(3), 0.016);
    expect(h.update(null, () => null, 0.1)).toBe('a');
    expect(h.update(null, () => null, 0.1)).toBe('a');
    expect(h.update(null, () => null, 0.11)).toBeNull();
  });

  it('forgets a short absence, and takes the new pick when it lets go', () => {
    const h = new AimHold();
    h.update({ id: 'a', angle: deg(3) }, () => deg(3), 0.016);
    h.update(null, () => null, 0.25);
    expect(h.update(null, () => deg(3), 0.1)).toBe('a');
    expect(h.update(null, () => null, 0.25)).toBe('a');
    expect(h.update({ id: 'c', angle: deg(8) }, (id) => (id === 'a' ? null : deg(8)), 0.1)).toBe('c');
  });
});

describe('neighbours', () => {
  const herd = [at('mid', 40, 0), at('left', 40, -20), at('right', 40, 20), at('stowed', 40, 10, 2, false), at('far', 400, 5)];

  it('orders the drawn animals within 150 m of the locked one left to right, the locked one included', () => {
    expect(neighbours('mid', herd, eye, fwd)).toEqual(['left', 'mid', 'right']);
  });

  it('measures the range from the locked animal, and keeps the locked one even if undrawn', () => {
    expect(neighbours('far', herd, eye, fwd)).toEqual(['far']);
    expect(neighbours('stowed', herd, eye, fwd)).toEqual(['left', 'mid', 'stowed', 'right']);
  });

  it('reads left and right as the camera sees them, whichever way it looks', () => {
    // Looking along +x: right of the screen is +z.
    const ahead = { x: 1, y: 0, z: 0 };
    const cs: Candidate[] = [
      { id: 'rightish', pos: { x: 20, y: 2, z: 5 }, size: 1, drawn: true },
      { id: 'leftish', pos: { x: 20, y: 2, z: -5 }, size: 1, drawn: true },
    ];
    expect(neighbours('leftish', cs, eye, ahead)).toEqual(['leftish', 'rightish']);
  });

  it('steps left and right and wraps both ways', () => {
    const order = ['left', 'mid', 'right'];
    expect(stepNeighbour(order, 'mid', 1)).toBe('right');
    expect(stepNeighbour(order, 'mid', -1)).toBe('left');
    expect(stepNeighbour(order, 'right', 1)).toBe('left');
    expect(stepNeighbour(order, 'left', -1)).toBe('right');
    expect(stepNeighbour(order, 'gone', 1)).toBe('gone');
  });
});
