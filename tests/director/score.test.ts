import { describe, expect, it } from 'vitest';
import { HIGH, MEDIUM } from '../../src/sim/types';
import { INVITE_NEAR_M, NIGHT_TAGS, RELEASED_NUDGE, pickInvite, pickScene, placeOf, scoreStory } from '../../src/director/score';
import type { ScoreCtx } from '../../src/director/score';
import type { HuntBeat, Story } from '../../src/director/types';

const story = (o: Partial<Story> & { id: string }): Story => ({ kind: 'event', tag: 'drink', subject: null, actors: [], species: ['deer'],
  at: { x: 100, z: 0 }, interest: MEDIUM, born: 0, live: true, released: false, hunt: null, ...o });
const hunt = (id: string, beat: HuntBeat, o: Partial<Story> = {}) => story({ id, tag: beat === 'creep' ? 'stalk' : beat, species: ['fox'],
  hunt: { hunter: 'fox#0', prey: 'rabbit#0', beat }, ...o });
const ctx = (o: Partial<ScoreCtx> = {}): ScoreCtx => ({ now: 0, camera: { x: 0, y: 0, z: 0 }, night: false, recent: { species: [], tags: [], places: [] }, ...o });
const sc = (s: Story, c = ctx()) => scoreStory(s, c);

describe('scoring', () => {
  it('a running chase beats a finished one and a grazing herd', () => {
    const run = hunt('a', 'chase', { interest: HIGH }), done = hunt('b', 'chase', { interest: HIGH, live: false });
    const herd = story({ id: 'h', kind: 'checkin', tag: 'herd', interest: 0.2 });
    expect(sc(run)).toBeGreaterThan(sc(done));
    expect(sc(run)).toBeGreaterThan(sc(herd));
  });
  it('a creeping hunter beats a drink', () => {
    expect(sc(hunt('c', 'creep'))).toBeGreaterThan(sc(story({ id: 'd' })));
  });
  it('released x 1.25', () => {
    expect(sc(story({ id: 'r', released: true }))).toBeCloseTo(sc(story({ id: 'n' })) * RELEASED_NUDGE, 12);
  });
  it('variety: the last scene lowers a story, a sole story still wins', () => {
    const deer = story({ id: 'd', interest: 0.55 }), wolf = story({ id: 'w', species: ['wolf'], tag: 'chorus', interest: 0.5 });
    const recent = { species: ['deer'], tags: ['drink' as const], places: [placeOf(deer.at)] };
    expect(pickScene([deer, wolf], ctx())?.id).toBe('d');
    expect(pickScene([deer, wolf], ctx({ recent }))?.id).toBe('w');
    expect(pickScene([deer], ctx({ recent }))?.id).toBe('d');
  });
  it('night keeps only night-worthy stories', () => {
    const night = ctx({ night: true });
    for (const tag of NIGHT_TAGS) expect(sc(story({ id: tag, tag }), night)).toBeGreaterThan(0);
    expect(sc(story({ id: 'g', tag: 'herd', kind: 'checkin' }), night)).toBe(0);
    const vista = story({ id: 'v', kind: 'scenery', tag: 'vista', interest: 0.1 });
    expect(pickScene([story({ id: 'g', tag: 'herd' }), vista], night)?.id).toBe('v');
  });
  it('nearer is better at equal interest', () => {
    expect(sc(story({ id: 'n', at: { x: 50, z: 0 } }))).toBeGreaterThan(sc(story({ id: 'f', at: { x: 500, z: 0 } })));
  });
  it('pickScene falls back to a vista when no story is live, and is null only for an empty list', () => {
    const dead = story({ id: 'x', live: false }), vista = story({ id: 'v', kind: 'scenery', tag: 'vista', interest: 0.1, live: false });
    expect(pickScene([dead, vista], ctx())?.id).toBe('v');
    expect(pickScene([dead], ctx())?.id).toBe('x');
    expect(pickScene([], ctx())).toBeNull();
  });
  it('pickInvite: medium+ events, not near, not offered, high first', () => {
    const c = { ...ctx(), offered: new Set(['seen']) };
    const med = story({ id: 'm', interest: MEDIUM }), high = story({ id: 'h', interest: HIGH, at: { x: 600, z: 0 } });
    expect(pickInvite([med, high], c)?.id).toBe('h');
    expect(pickInvite([med, story({ id: 'low', interest: 0.3 }), story({ id: 'ci', kind: 'checkin', interest: 0.9 })], c)?.id).toBe('m');
    expect(pickInvite([story({ id: 'near', at: { x: INVITE_NEAR_M - 1, z: 0 } })], c)).toBeNull();
    expect(pickInvite([story({ id: 'seen' })], c)).toBeNull();
  });
});
