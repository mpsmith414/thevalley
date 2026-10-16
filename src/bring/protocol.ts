import { z } from 'zod';
import { ImageInSchema, KidCardsSchema, type KidCards } from '../designer/types';

/** The phone relay's messages, shared by the server, the valley and the phone page (no DOM, no node imports). */

/** The sticker a kid picks on the phone; 12 of them, so friends in the line look different. */
export const BADGES = ['🦊', '🐻', '🐸', '🐰', '🦉', '🐢', '🦄', '🐙', '🦖', '🐝', '🐧', '🐳'] as const;
/** The 4-letter join code uses no I, L or O (they look like 1 and 0). */
export const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
/** The daily creature limit's choices and its default (the server counts, the valley's menu offers the same four). */
export const LIMITS = [5, 10, 20, 50] as const;
export const DEFAULT_LIMIT = 10;

export const DesignInputSchema = z.object({ image: ImageInSchema.nullable(), words: z.string().max(500) });
export type DesignInput = z.infer<typeof DesignInputSchema>;
export type Maker = { name: string; badge: string };

export const StepMsgSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reading') }),
  z.object({ kind: z.literal('building') }),
  z.object({ kind: z.literal('looking'), pass: z.number() }),
  z.object({ kind: z.literal('fixing'), pass: z.number(), note: z.string() }),
]);
export type StepMsg = z.infer<typeof StepMsgSchema>;

export type PhoneSnapshot = {
  phase: 'idle' | 'waiting' | 'making' | 'preview' | 'released' | 'kept' | 'resting';
  place?: number; cards?: KidCards; tweaksLeft?: number;
};

/** To a phone (SSE `data:` JSON). */
export type PhoneMsg =
  | { type: 'hello'; state: PhoneSnapshot } // first message on every stream: where this phone is
  | { type: 'line'; place: number; ahead: Maker[] } // place 0 = on stage
  | { type: 'step'; step: StepMsg }
  | { type: 'preview'; cards: KidCards; tweaksLeft: number }
  | { type: 'tweaked'; cards: KidCards; note: string; tweaksLeft: number }
  | { type: 'released' } | { type: 'kept' }
  | { type: 'failed'; message: string; retry: boolean }
  | { type: 'resting' } | { type: 'noHost' };

/** To the valley host (SSE). */
export type HostMsg =
  | { type: 'hello'; code: string; url: string }
  | { type: 'joined'; token: string; maker: Maker } | { type: 'left'; token: string }
  | { type: 'line'; line: { token: string; maker: Maker }[] }
  | { type: 'turn'; token: string; maker: Maker; input: DesignInput }
  | { type: 'tweak'; token: string; words: string } | { type: 'release'; token: string } | { type: 'cancel'; token: string }
  | { type: 'replaced' };

/** From the valley host about the phone on stage (POST /api/relay/host/send; the route adds the token). The relay
 * fills `tweaksLeft` itself. */
export const HostSendSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), step: StepMsgSchema }),
  z.object({ type: z.literal('preview'), cards: KidCardsSchema }),
  z.object({ type: z.literal('tweaked'), cards: KidCardsSchema, note: z.string() }),
  z.object({ type: z.literal('released') }),
  z.object({ type: z.literal('kept') }),
  z.object({ type: z.literal('failed'), message: z.string(), retry: z.boolean() }),
]);
export type HostSend = z.infer<typeof HostSendSchema>;
