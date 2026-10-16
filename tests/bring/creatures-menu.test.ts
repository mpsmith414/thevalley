import { describe, expect, it } from 'vitest';
import { NO_CREATURES, creatureRows } from '../../src/bring/creatures-menu';
import { CAST } from '../../src/cast';
import type { GalleryItem } from '../../src/lab/gallery';
import { quadruped } from '../fixtures/recipes';

const item = (id: string, extra: Partial<GalleryItem> = {}): GalleryItem => ({
  id, recipe: quadruped, cards: { ...CAST[0].cards, name: `Name ${id}` }, drawing: null, words: '', thumb: null, history: [], createdAt: 1, native: false, ...extra,
});
const valley = (status: 'released' | 'exploring', releasedAt: number) => ({ status, seeds: [1, 2, 3] as [number, number, number], releasedAt });

describe('creatureRows', () => {
  it('lists released and exploring creatures newest first, with badge, name and maker', () => {
    const rows = creatureRows([
      item('a', { valley: valley('released', 10), maker: { name: 'Mia', badge: '🦊' } }),
      item('b', { valley: valley('exploring', 30), maker: { name: '', badge: '🐸' } }),
      item('c', { valley: valley('released', 20) }), // released in the lab
      item('kept'), // kept only: not in the valley
      item('native:fox', { native: true, valley: valley('released', 5) }),
    ]);
    expect(rows.map((r) => [r.id, r.badge, r.name, r.maker, r.status])).toEqual([
      ['b', '🐸', 'Name b', 'by a friend', 'exploring'],
      ['c', '🧪', 'Name c', 'from the Creature Lab', 'released'],
      ['a', '🦊', 'Name a', 'by Mia', 'released'],
    ]);
  });

  it('offers Visit and Off exploring to a released creature, Come back to an exploring one', () => {
    const [b, a] = creatureRows([item('a', { valley: valley('released', 1) }), item('b', { valley: valley('exploring', 2) })]);
    expect(a.buttons).toEqual([{ id: 'visit', label: 'Visit' }, { id: 'explore', label: 'Off exploring' }]);
    expect(b.buttons).toEqual([{ id: 'back', label: 'Come back' }]);
  });

  it('is empty with none, and the page then says how to add one', () => {
    expect(creatureRows([item('kept')])).toEqual([]);
    expect(NO_CREATURES).toBe('No creatures yet — scan the code to add one!');
  });
});
