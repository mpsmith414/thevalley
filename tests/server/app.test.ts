import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { Declined, type DesignerModel } from '../../server/model';
import { SYSTEM_PROMPT } from '../../server/prompts';
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

describe('the system prompt', () => {
  it('is stable (no dates) and insists on faithfulness', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/20\d\d-\d\d/);
    expect(SYSTEM_PROMPT).toMatch(/Never turn a drawing into a known animal/);
  });
});
