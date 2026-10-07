import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import {
  LookAgainWire, ReadWire, TweakWire,
  type ImageIn, type LookAgainRequest, type ReadRequest, type TweakRequest,
} from '../src/designer/types';
import { READ_INSTRUCTION, SYSTEM_PROMPT, lookAgainInstruction, tweakInstruction } from './prompts';

/** Raw model output for each request; the app validates and normalises it. */
export interface DesignerModel {
  readonly model: string;
  read(r: ReadRequest): Promise<unknown>;
  lookAgain(r: LookAgainRequest): Promise<unknown>;
  tweak(r: TweakRequest): Promise<unknown>;
}

export class Declined extends Error {}

type Effort = 'low' | 'medium' | 'high';
type Block = Anthropic.Beta.BetaContentBlockParam;

const image = (img: ImageIn): Block => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
const text = (t: string): Block => ({ type: 'text', text: t });

/**
 * The designer backed by Claude: vision in, schema-checked JSON out.
 * Uses the beta parse path for server-side refusal fallbacks (`fallbacks: 'default'`):
 * if the chosen model declines, the API retries on a fallback model in the same call.
 */
export function createClaudeModel(opts: { model: string; effort?: Effort; client?: Anthropic }): DesignerModel {
  const client = opts.client ?? new Anthropic();
  const effort = opts.effort ?? 'medium';

  async function ask<S extends z.ZodType>(schema: S, content: Block[]): Promise<z.infer<S>> {
    const response = await client.beta.messages.parse({
      model: opts.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') throw new Declined('refused');
    return response.parsed_output as z.infer<S>;
  }

  return {
    model: opts.model,
    read(r) {
      const content: Block[] = [];
      if (r.image) content.push(text('This is the drawing:'), image(r.image));
      if (r.words.trim()) content.push(text(`The child says: "${r.words.trim()}"`));
      content.push(text(READ_INSTRUCTION));
      return ask(ReadWire, content);
    },
    lookAgain(r) {
      const content: Block[] = [];
      if (r.image) content.push(text('The original drawing:'), image(r.image));
      if (r.words.trim()) content.push(text(`The child said: "${r.words.trim()}"`));
      content.push(text('What I built:'), image(r.render));
      content.push(text(`The current recipe: ${JSON.stringify(r.recipe)}`));
      content.push(text(lookAgainInstruction(r.pass, r.checklist)));
      return ask(LookAgainWire, content);
    },
    tweak(r) {
      return ask(TweakWire, [
        text(`The current recipe: ${JSON.stringify(r.recipe)}`),
        text(`The current cards: ${JSON.stringify(r.cards)}`),
        text(tweakInstruction(r.words)),
      ]);
    },
  };
}
