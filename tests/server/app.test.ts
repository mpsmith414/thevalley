import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { DailyCap } from '../../server/cap';
import { Declined, type DesignerModel } from '../../server/model';
import { SYSTEM_PROMPT } from '../../server/prompts';
import { COATS } from '../../src/recipe/schema';
import { quadruped } from '../fixtures/recipes';

const cards = { name: 'Bob', eats: 'flowers 🌸', speed: 'slow 🐌', mood: 'shy 🙈', special: 'six legs' };
const goodRead = {
  status: 'ok', message: '', recipe: { ...quadruped, parts: quadruped.parts.map((p) => (p.id === 'tail' ? { ...p, length: 99 } : p)) },
  checklist: ['4 legs', 'spotted tail'], view: { angle: 'side', facing: 'left' }, cards,
};
const image = { base64: 'aGVsbG8=', mediaType: 'image/png' as const };

/** A model that answers from a queue of canned replies (or throws them). */
function fake(replies: Partial<Record<'read' | 'lookAgain' | 'tweak', unknown[]>>): DesignerModel & { calls: number } {
  const m = {
    model: 'fake',
    calls: 0,
    async next(kind: 'read' | 'lookAgain' | 'tweak') {
      m.calls++;
      const r = replies[kind]!.shift();
      if (r instanceof Error) throw r;
      return r;
    },
    read() { return m.next('read'); },
    lookAgain() { return m.next('lookAgain'); },
    tweak() { return m.next('tweak'); },
  };
  return m;
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('designer service', () => {
  it('reports its model', async () => {
    const res = await createApp(fake({})).request('/api/health');
    expect(await res.json()).toEqual({ ok: true, model: 'fake' });
  });

  it('reads a drawing into a normalised recipe, passing fixes along', async () => {
    const res = await post(createApp(fake({ read: [goodRead] })), '/api/read', { image, words: '' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.recipe.parts.find((p: { id: string }) => p.id === 'tail').length).toBe(6);
    expect(body.fixes.some((f: string) => f.includes('length'))).toBe(true);
    expect(body.cards.name).toBe('Bob');
  });

  it('retries once when the output is malformed', async () => {
    const m = fake({ read: [{ nonsense: true }, goodRead] });
    const res = await post(createApp(m), '/api/read', { image: null, words: 'a six legged snail' });
    expect(res.status).toBe(200);
    expect(m.calls).toBe(2);
  });

  it('gives up with 422 after two malformed answers', async () => {
    const res = await post(createApp(fake({ read: [{}, { status: 'ok', recipe: { parts: [] } }] })), '/api/read', { image, words: '' });
    expect(res.status).toBe(422);
  });

  it('is "resting" when Claude cannot be reached', async () => {
    const err = new Anthropic.APIConnectionError({ message: 'offline' });
    const res = await post(createApp(fake({ read: [err] })), '/api/read', { image, words: '' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'resting' });
  });

  it('turns a refusal into a friendly decline', async () => {
    const res = await post(createApp(fake({ read: [new Declined('no')] })), '/api/read', { image, words: 'something unkind' });
    expect((await res.json()).status).toBe('declined');
  });

  it('passes "no creature here" through', async () => {
    const res = await post(createApp(fake({ read: [{ ...goodRead, status: 'noCreature', message: 'I couldn’t find a creature!', recipe: null }] })), '/api/read', { image, words: '' });
    expect(await res.json()).toEqual({ status: 'noCreature', message: 'I couldn’t find a creature!' });
  });

  it('rejects empty, oversized and over-long requests', async () => {
    const app = createApp(fake({}));
    expect((await post(app, '/api/read', { image: null, words: '  ' })).status).toBe(400);
    expect((await post(app, '/api/look-again', { image, words: '', render: image, recipe: quadruped, checklist: [], pass: 6 })).status).toBe(400);
    const huge = JSON.stringify({ image: { base64: 'a'.repeat(13 * 1024 * 1024), mediaType: 'image/png' }, words: '' });
    expect((await post(app, '/api/read', huge)).status).toBe(413);
  });

  it('looks again and returns edits', async () => {
    const edits = [{ op: 'set', path: 'parts.tail.length', valueJson: '0.5' }];
    const res = await post(createApp(fake({ lookAgain: [{ verdict: 'edits', edits, note: 'Longer tail!' }] })), '/api/look-again', {
      image, words: '', render: image, recipe: quadruped, checklist: ['long tail'], pass: 1,
    });
    expect(await res.json()).toEqual({ status: 'ok', verdict: 'edits', edits, note: 'Longer tail!' });
  });

  it('tweaks with edits and new cards', async () => {
    const reply = { status: 'ok', message: '', edits: [{ op: 'set', path: 'life.sizeM', valueJson: '2' }], cards: { ...cards, name: 'Big Bob' }, note: 'Now it’s huge!' };
    const res = await post(createApp(fake({ tweak: [reply] })), '/api/tweak', { recipe: quadruped, cards, words: 'make it bigger' });
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.cards.name).toBe('Big Bob');
  });
});

describe('the daily cap', () => {
  const today = () => new Date(2026, 9, 14, 12, 0);

  it('answers 429 "resting" without calling the model once the day is full', async () => {
    const cap = new DailyCap({ now: today });
    cap.setLimit(5);
    for (let i = 0; i < 5; i++) cap.take();
    const m = fake({ read: [goodRead] });
    const res = await post(createApp(m, { cap }), '/api/read', { image, words: '' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'resting' });
    expect(m.calls).toBe(0);
  });

  it('counts each read, even one that then fails, but not a bad request', async () => {
    const cap = new DailyCap({ now: today });
    const app = createApp(fake({ read: [goodRead, {}, {}] }), { cap });
    await post(app, '/api/read', { image, words: '' });
    expect(cap.state().count).toBe(1);
    expect((await post(app, '/api/read', { image, words: '' })).status).toBe(422);
    expect(cap.state().count).toBe(2);
    expect((await post(app, '/api/read', { image: null, words: ' ' })).status).toBe(400);
    expect(cap.state().count).toBe(2);
  });

  it('is uncapped when no cap is passed', async () => {
    const app = createApp(fake({ read: [goodRead] }));
    expect((await post(app, '/api/read', { image, words: '' })).status).toBe(200);
    expect((await app.request('/api/cap')).status).toBe(404);
  });

  it('reads and sets the limit over /api/cap', async () => {
    const cap = new DailyCap({ now: today });
    const app = createApp(fake({}), { cap });
    expect(await (await app.request('/api/cap')).json()).toEqual({ day: '2026-10-14', count: 0, limit: 10 });
    const res = await post(app, '/api/cap', { limit: 20 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: '2026-10-14', count: 0, limit: 20 });
    expect((await (await app.request('/api/cap')).json()).limit).toBe(20);
    expect((await post(app, '/api/cap', { limit: 7 })).status).toBe(400);
    expect((await post(app, '/api/cap', 'nope')).status).toBe(400);
    expect(cap.state().limit).toBe(20);
  });
});

describe('the system prompt', () => {
  it('is stable (no dates) and insists on faithfulness', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/20\d\d-\d\d/);
    expect(SYSTEM_PROMPT).toMatch(/Never turn a drawing into a known animal/);
  });
  it('teaches every coat word', () => {
    for (const w of COATS) expect(SYSTEM_PROMPT).toContain(`"${w}"`);
  });
  it('asks for a feather length (feathers without one draw none)', () => {
    expect(SYSTEM_PROMPT).toContain('feathers (with furLength 0.01-0.03 m)');
  });
});

describe('extractJson', () => {
  it('finds the object in a reply, with or without fences', async () => {
    const { extractJson } = await import('../../server/model');
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":{"b":[1,2]}}\n```')).toEqual({ a: { b: [1, 2] } });
    expect(extractJson('Here you go: {"a":1} hope it helps')).toEqual({ a: 1 });
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('{broken')).toBeUndefined();
  });
});
