import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Placeholder until the designer service lands (Task 13): health only.
const app = new Hono();
app.get('/api/health', (c) => c.json({ ok: true, model: null }));
serve({ fetch: app.fetch, port: 8787 }, () => console.log('designer service on http://localhost:8787'));
