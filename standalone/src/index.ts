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

// embed.js - 无缓存，方便更新后立刻生效
app.get('/embed.js', async (c) => {
  const fs = await import('fs/promises');
  const path = await import('path');

  try {
    const filePath = path.join(process.cwd(), 'public', 'embed.js');
    const content = await fs.readFile(filePath, 'utf-8');

    return c.text(content, 200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
  } catch (error) {
    console.error('Failed to read embed.js:', error);
    return c.text('// embed.js not found', 404);
  }
});

// theme-snippet.html - 同样无缓存
app.get('/theme-snippet.html', async (c) => {
  const fs = await import('fs/promises');
  const path = await import('path');

  try {
    const filePath = path.join(process.cwd(), 'public', 'theme-snippet.html');
    const content = await fs.readFile(filePath, 'utf-8');

    return c.text(content, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
  } catch (error) {
    console.error('Failed to read theme-snippet.html:', error);
    return c.text('<!-- theme-snippet.html not found -->', 404);
  }
});

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

