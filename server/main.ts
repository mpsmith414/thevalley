import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { createApp } from './app';
import { DailyCap } from './cap';
import { createClaudeModel } from './model';
import { phoneHost } from './net';
import { Relay } from './relay';

/** The API both entry points serve (`server/index.ts` for dev, `server/home.ts` for home mode): the designer, the daily cap and the phone relay. */
export function makeServer(env: NodeJS.ProcessEnv): { app: Hono; model: string; workspaceId?: string; keyFound: boolean } {
  // Sonnet 5.5 by default; set DESIGNER_MODEL=claude-opus-5-5 for the stronger (pricier) eye.
  const model = env.DESIGNER_MODEL || 'claude-sonnet-5-5';
  // only needed for a key that works across workspaces (Console → Settings → Workspaces, the wrkspc_… ID)
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined;
  const relay = new Relay({ now: Date.now, id: () => randomUUID() });
  const app = createApp(createClaudeModel({ model, workspaceId }), { cap: new DailyCap({ file: 'data/daily.json' }), relay, host: () => phoneHost(env) });
  // the relay has no timers of its own: this finds a preview nobody has touched for two minutes
  setInterval(() => relay.tick(), 10000);
  return { app, model, workspaceId, keyFound: !!env.ANTHROPIC_API_KEY };
}
