import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createClaudeModel } from './model';

// Sonnet 5.5 by default; set DESIGNER_MODEL=claude-opus-5-5 for the stronger (pricier) eye.
const model = process.env.DESIGNER_MODEL || 'claude-sonnet-5-5';
const app = createApp(createClaudeModel({ model }));

serve({ fetch: app.fetch, port: 8787 }, () => {
  const key = process.env.ANTHROPIC_API_KEY ? 'key found' : 'no ANTHROPIC_API_KEY yet (the designer will say it is resting)';
  console.log(`creature designer on http://localhost:8787 using ${model}; ${key}`);
});
