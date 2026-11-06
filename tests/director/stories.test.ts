import { describe, expect, it } from 'vitest';
import { StoryBook } from '../../src/director/stories';
import type { AgentView, DirectorWorld } from '../../src/director/types';
import { HIGH, LOW, MEDIUM } from '../../src/sim/types';
import type { Moment } from '../../src/sim/types';
import type { Viewpoint } from '../../src/valley/types';

const agent = (id: string, o: Partial<AgentView> = {}): AgentView => ({ id, species: id.split('#')[0], name: id, native: true,
  released: false, doing: 'walk', group: null, focus: null, pos: { x: 0, y: 0, z: 0 }, size: 1, bodyLength: 1, flying: false,
  altitude: 0, swimmer: false, wet: false, hunter: false, grazer: false, plural: false, ...o });

const world = (agents: AgentView[], now = 0, viewpoints: Viewpoint[] = []): DirectorWorld => ({ now, hours: 9, night: false,
  camera: { x: 0, y: 0, z: 0 }, agent: (id) => agents.find((a) => a.id === id) ?? null, agents: () => agents, viewpoints,
  ground: () => 0 });

const moment = (o: Partial<Moment>): Moment => ({ id: 1, hours: 9, kind: 'stalk', actors: ['fox#0', 'rabbit#0'], species: ['fox', 'rabbit'],
  at: { x: 5, z: 6 }, follow: 'fox#0', interest: HIGH, text: '', ...o });

const fox = (o: Partial<AgentView> = {}) => agent('fox#0', { doing: 'stalk', focus: 'rabbit#0', hunter: true, ...o });

describe('StoryBook', () => {
  it('a stalk moment makes a live hunt story at the creep beat', () => {
    const b = new StoryBook();
    b.offer(moment({}), 0);
    b.update(world([fox(), agent('rabbit#0')], 1));
    const s = b.list()[0];
    expect(b.list()).toHaveLength(1);
    expect(s).toMatchObject({ kind: 'event', tag: 'stalk', subject: 'fox#0', live: true, hunt: { hunter: 'fox#0', prey: 'rabbit#0', beat: 'creep' } });
  });

  it("it becomes the chase beat when the hunter's doing turns to chase", () => {
    const b = new StoryBook();
    b.offer(moment({}), 0);
    const id = b.list()[0].id;
    b.update(world([fox({ doing: 'chase' }), agent('rabbit#0')], 5));
    expect(b.list()).toHaveLength(1);
    expect(b.get(id)).toMatchObject({ tag: 'chase', live: true, hunt: { beat: 'chase' } });
    b.offer(moment({ kind: 'chase' }), 5);
    expect(b.list()).toHaveLength(1);
  });

  it('a catch moment moves it to that beat and it is no longer live 20 s later', () => {
    for (const kind of ['catch'] as const) {
      const b = new StoryBook();
      b.offer(moment({}), 0);
      const id = b.list()[0].id;
      b.offer(moment({ kind }), 10);
      b.update(world([fox({ doing: 'eat' }), agent('rabbit#0')], 12));
      expect(b.get(id)).toMatchObject({ tag: kind, live: true, hunt: { beat: kind } });
      b.update(world([fox({ doing: 'eat' }), agent('rabbit#0')], 30));
      expect(b.get(id)!.live).toBe(false);
    }
  });

  it('the real escape moment (about the prey) ends the hunt after it', () => {
    const b = new StoryBook();
    b.offer(moment({}), 0);
    const id = b.list()[0].id;
    b.update(world([fox({ doing: 'chase' }), agent('rabbit#0')], 5));
    b.offer(moment({ kind: 'escape', follow: 'rabbit#0', actors: ['rabbit#0'], species: ['rabbit'] }), 8);
    expect(b.list()).toHaveLength(1);
    b.update(world([fox({ doing: 'search' }), agent('rabbit#0')], 10));
    expect(b.get(id)).toMatchObject({ tag: 'escape', live: true, hunt: { hunter: 'fox#0', beat: 'escape' } });
    b.update(world([fox({ doing: 'search' }), agent('rabbit#0')], 30));
    expect(b.get(id)!.live).toBe(false);
  });

  it('a pack stalk takes the last actor as prey', () => {
    const b = new StoryBook();
    b.offer(moment({ actors: ['wolf#0', 'wolf#1', 'deer#0'], follow: 'wolf#0' }), 0);
    expect(b.list()[0].hunt).toMatchObject({ hunter: 'wolf#0', prey: 'deer#0' });
  });

  it('a swimmer on the bank makes no water check-in', () => {
    const b = new StoryBook();
    b.update(world([agent('duck#0', { doing: 'rest', swimmer: true, wet: false })], 0));
    expect(b.list()).toHaveLength(0);
  });

  it('low and below-medium moments only feed check-ins', () => {
    const b = new StoryBook();
    b.offer(moment({ kind: 'graze', interest: LOW, follow: 'deer#0', actors: ['deer#0', 'deer#1'] }), 0);
    b.offer(moment({ kind: 'startle', interest: MEDIUM - 0.1 }), 0);
    expect(b.list()).toHaveLength(0);
    const herd = [agent('deer#0', { doing: 'graze', group: 'g' }), agent('deer#1', { doing: 'graze', group: 'g' })];
    b.update(world(herd, 0));
    expect(b.list().map((s) => [s.kind, s.tag])).toEqual([['checkin', 'herd']]);
    expect(b.list()[0].interest).toBeGreaterThanOrEqual(LOW);
  });

  it('a drink story stays live while any actor is drinking, then ends', () => {
    const b = new StoryBook();
    b.offer(moment({ kind: 'drink', interest: MEDIUM, follow: 'deer#0', actors: ['deer#0', 'deer#1'] }), 0);
    b.update(world([agent('deer#0', { doing: 'walk' }), agent('deer#1', { doing: 'drink' })], 1));
    expect(b.list()[0]).toMatchObject({ tag: 'drink', live: true });
    b.update(world([agent('deer#0', { doing: 'walk' }), agent('deer#1', { doing: 'walk' })], 2));
    expect(b.list()[0].live).toBe(false);
  });

  it('the sweep makes check-ins from live state, one per group, refreshed not duplicated', () => {
    const b = new StoryBook();
    const deer = [0, 1, 2, 3].map((i) => agent(`deer#${i}`, { doing: 'graze', group: 'deer-g', plural: true, pos: { x: i * 2, y: 0, z: 10 } }));
    const ducks = [0, 1].map((i) => agent(`duck#${i}`, { doing: 'rest', group: 'duck-g', swimmer: true, wet: true, plural: true }));
    const bears = [0, 1].map((i) => agent(`bear#${i}`, { doing: 'sleep', group: 'bear-g', plural: true }));
    const hawk = agent('hawk#0', { doing: 'walk', flying: true, altitude: 40 });
    const low = agent('hawk#1', { flying: true, altitude: 5 });
    const w = (now: number) => world([...deer, ...ducks, ...bears, hawk, low], now);
    b.update(w(0));
    const tags = b.list().map((s) => s.tag).sort();
    expect(tags).toEqual(['herd', 'sleeping', 'soaring', 'water']);
    const herd = b.get('herd:deer-g')!;
    expect(herd).toMatchObject({ kind: 'checkin', live: true, at: { x: 3, z: 10 }, actors: ['deer#0', 'deer#1', 'deer#2', 'deer#3'] });
    deer[0].pos = { x: 100, y: 0, z: 10 };
    b.update(w(1));
    expect(b.list()).toHaveLength(4);
    expect(herd.at.x).toBe(3);
    b.update(w(2.5));
    expect(b.list()).toHaveLength(4);
    expect(b.get('herd:deer-g')!.at.x).toBeCloseTo(28);
  });

  it('a check-in ends when its group stops, and a stale one is dropped', () => {
    const b = new StoryBook();
    const herd = (doing: AgentView['doing']) => [0, 1].map((i) => agent(`deer#${i}`, { doing, group: 'g' }));
    b.update(world(herd('graze'), 0));
    b.update(world(herd('walk'), 3));
    expect(b.get('herd:g')!.live).toBe(false);
    b.update(world(herd('walk'), 125));
    expect(b.get('herd:g')).toBeUndefined();
  });

  it('scenery stories come from every viewpoint and never end', () => {
    const b = new StoryBook();
    const vps: Viewpoint[] = [{ name: 'Lake Shore', pos: { x: 1, z: 2, h: 3 }, look: { x: 4, z: 5, h: 6 } },
      { name: 'Ridge', pos: { x: 7, z: 8, h: 9 }, look: { x: 0, z: 0, h: 0 } }];
    b.update(world([], 0, vps));
    b.update(world([], 1000, vps));
    const s = b.list();
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.kind === 'scenery' && x.tag === 'vista' && x.live && x.viewpoint)).toBe(true);
    expect(s[0].viewpoint).toBe(vps[0]);
  });

  it('an actor that has gone ends its story', () => {
    const b = new StoryBook();
    b.offer(moment({}), 0);
    b.update(world([agent('rabbit#0')], 1));
    expect(b.list()[0].live).toBe(false);
  });

  it('released is true when any actor is released', () => {
    const b = new StoryBook();
    b.offer(moment({ kind: 'drink', follow: 'deer#0', actors: ['deer#0', 'pip#0'] }), 0);
    b.update(world([agent('deer#0', { doing: 'drink' }), agent('pip#0', { doing: 'drink', released: true })], 1));
    expect(b.list()[0].released).toBe(true);
  });
});
