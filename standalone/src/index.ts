import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { generateRouter } from './routes/generate.js';

const app = new Hono();

// Middleware
app.use('*', logger());

// CORS - Allow requests from any Shopify store
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}));

// Routes
app.route('/api/generate', generateRouter);

// Static files (demo page, embed.js)
app.use('/public/*', serveStatic({ root: './' }));

// Shortcut: /demo -> /public/demo.html
app.get('/demo', (c) => c.redirect('/public/demo.html'));

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'AI Visual Generator',
    version: '1.0.0',
    endpoints: {
      generate: 'POST /api/generate',
      health: 'GET /api/generate/health',
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Start server
const port = parseInt(process.env.PORT || '3000', 10);

console.log(`
╔════════════════════════════════════════════╗
║       AI Visual Generator Service          ║
╠════════════════════════════════════════════╣
║  Server starting on port ${port}              ║
║  http://localhost:${port}                      ║
╚════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});

