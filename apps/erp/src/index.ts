import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.get('/health', (context) => context.json({ status: 'ok', service: 'sabores-da-canastra' }));

export default app;
