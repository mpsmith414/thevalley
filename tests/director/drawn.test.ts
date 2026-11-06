import { describe, expect, it } from 'vitest';
import { DRAWN_CELL_M, DRAWN_KEEP_S, DrawnMemory } from '../../src/director/drawn';

describe('DrawnMemory', () => {
  it('remembers a visited cell and forgets it after the keep time', () => {
    const m = new DrawnMemory();
    expect(m.seen(10, 10, 0)).toBe(false);
    m.visit(10, 10, 0);
    expect(m.seen(DRAWN_CELL_M - 1, 1, 5)).toBe(true); // same square
    expect(m.seen(DRAWN_CELL_M + 1, 1, 5)).toBe(false); // the next one
    expect(m.seen(10, 10, DRAWN_KEEP_S)).toBe(true);
    expect(m.seen(10, 10, DRAWN_KEEP_S + 1)).toBe(false);
  });

  it('a later visit renews it, and negative ground has its own squares', () => {
    const m = new DrawnMemory();
    m.visit(-5, -5, 0);
    expect(m.seen(5, 5, 1)).toBe(false);
    m.visit(-5, -5, 100);
    expect(m.seen(-60, -1, 250)).toBe(true);
  });
});
