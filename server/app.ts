import Anthropic from '@anthropic-ai/sdk';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { z } from 'zod';
import type { RecipeEdit } from '../src/recipe/edits';
import { normalizeRecipe, RecipeError } from '../src/recipe/normalize';
import {
  LookAgainCheck, LookAgainRequestSchema, ReadCheck, ReadRequestSchema, TweakCheck, TweakRequestSchema,
  type LookAgainRequest, type LookAgainResult, type ReadResult, type TweakRequest, type TweakResult,
} from '../src/designer/types';
import { Declined, type DesignerModel } from './model';

const MAX_BODY = 12 * 1024 * 1024;

/** Is this failure the service being unavailable (network, overload, no key) rather than bad output? */
function isResting(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return true;
  // a key that spans workspaces but no (or an unknown) workspace ID
  if (e instanceof Anthropic.APIError && /anthropic-workspace-id|Workspace .* not found/i.test(e.message)) return true;
  if (e instanceof Anthropic.RateLimitError) return true;
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return true;
  return e instanceof Error && /api key|apiKey|ANTHROPIC_API_KEY|credentials/i.test(e.message);
}

class Invalid extends Error {}

/**
 * Ask the model, check its output against the schema and our own rules, and try once more
 * if it comes back malformed (the "repair attempt").
 */
async function twice<S extends z.ZodType, T>(call: () => Promise<unknown>, schema: S, check: (v: z.infer<S>) => T): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await call();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      last = parsed.error;
      continue;
    }
    try {
      return check(parsed.data);
    } catch (e) {
      if (!(e instanceof RecipeError || e instanceof Invalid)) throw e;
      last = e;
    }
  }
  throw new Invalid(String(last));
}

export function createApp(model: DesignerModel): Hono {
  const app = new Hono();
  app.use('/api/*', bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: 'too big' }, 413) }));

  app.get('/api/health', (c) => c.json({ ok: true, model: model.model }));

  const handle = async (c: Context, work: () => Promise<unknown>) => {
    try {
      return c.json(await work());
    } catch (e) {
      if (e instanceof Declined) return c.json({ status: 'declined', message: 'Let’s make a different creature!' });
      if (e instanceof Invalid) return c.json({ error: 'invalid' }, 422);
      if (isResting(e)) {
        // say why in the server's terminal (a wrong key or missing workspace ID shows up here)
        console.warn(`designer resting: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
        return c.json({ error: 'resting' }, 503);
      }
      console.error(e);
      return c.json({ error: 'resting' }, 503);
    }
  };

  app.post('/api/read', async (c) => {
    const req = ReadRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!req.success || (!req.data.image && !req.data.words.trim())) return c.json({ error: 'bad request' }, 400);
    return handle(c, () =>
      twice(() => model.read(req.data), ReadCheck, (w): ReadResult => {
        if (w.status !== 'ok') return { status: w.status, message: w.message || 'Let’s try another drawing!' };
        if (!w.recipe) throw new Invalid('no recipe');
        const { recipe, fixes } = normalizeRecipe(w.recipe);
        return { status: 'ok', recipe, checklist: w.checklist, view: w.view, cards: w.cards, fixes };
      }),
    );
  });

  app.post('/api/look-again', async (c) => {
    const req = LookAgainRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!req.success) return c.json({ error: 'bad request' }, 400);
    let recipe;
    try {
      recipe = normalizeRecipe(req.data.recipe).recipe;
    } catch {
      return c.json({ error: 'bad request' }, 400);
    }
    const r: LookAgainRequest = { ...req.data, recipe };
    return handle(c, () => twice(() => model.lookAgain(r), LookAgainCheck, (w) => ({ status: 'ok' as const, ...w }) as LookAgainResult));
  });

  app.post('/api/tweak', async (c) => {
    const req = TweakRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!req.success) return c.json({ error: 'bad request' }, 400);
    let recipe;
    try {
      recipe = normalizeRecipe(req.data.recipe).recipe;
    } catch {
      return c.json({ error: 'bad request' }, 400);
    }
    const r: TweakRequest = { ...req.data, recipe };
    return handle(c, () =>
      twice(() => model.tweak(r), TweakCheck, (w): TweakResult =>
        w.status === 'declined' ? { status: 'declined', message: w.message || 'Let’s try a different change!' } : { status: 'ok', edits: w.edits as RecipeEdit[], cards: w.cards, note: w.note }),
    );
  });

  return app;
}
