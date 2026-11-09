// Synthetic configuration only; this probe must never contact production.
Deno.env.set('SUPABASE_URL', 'https://isolated-test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'isolated-test-key');
Deno.env.set('WHATSAPP_PROVIDER', '360dialog');
Deno.env.set('BOT_SERVERLESS_ENABLED', 'false');
const { default: app } = await import('../supabase/functions/whatsapp-bot/index.ts');
const health = await app.fetch(new Request('https://example.test/whatsapp-bot/health'));
if (health.status !== 200 || (await health.json()).enabled !== false) throw new Error('Health probe failed');
const unauthenticated = await app.fetch(new Request('https://example.test/whatsapp-bot/webhook', { method: 'POST', body: '{}' }));
if (unauthenticated.status !== 401) throw new Error('Authentication probe failed');
console.log('Deno startup, health and authentication probes passed; no production requests made.');
