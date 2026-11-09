const { timingSafeEqual } = require('node:crypto');
function equalSecret(value, expected) {
    if (!value || !expected) return false;
    const a = Buffer.from(value), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}
function eventsFrom(body) {
    if (!body || !Array.isArray(body.entry)) throw new Error('Invalid webhook envelope');
    const events = [];
    for (const entry of body.entry) {
        if (!Array.isArray(entry.changes)) throw new Error('Invalid changes');
        for (const change of entry.changes) {
            if (change.field === 'smb_message_echoes') {
                for (const echo of change.value?.message_echoes || []) {
                    if (echo.id && /^\d{7,15}$/.test(echo.to || '')) {
                        events.push({ id: `echo:${echo.id}`, customer_phone: echo.to, kind: 'echo',
                            payload: { ...change, value: { ...change.value, message_echoes: [echo] } } });
                    }
                }
            } else {
                for (const message of change.value?.messages || []) {
                    if (message.id && /^\d{7,15}$/.test(message.from || '') && ['text', 'interactive'].includes(message.type)) {
                        events.push({ id: message.id, customer_phone: message.from, kind: 'message', payload: message });
                    }
                }
            }
        }
    }
    if (events.length > 100) throw new Error('Too many messages');
    return events;
}
function createHandler({ store, drain, waitUntil, webhookSecret, workerSecret, enabled = false, prepare }) {
    return async request => {
        const route = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
        if (request.method === 'GET' && route === 'health') return Response.json({ status: 'ok', runtime: 'serverless', enabled });
        if (request.method !== 'POST') return new Response('Not found', { status: 404 });
        const worker = route === 'work' || route === 'prepare';
        if (!worker && !['webhook', 'whatsapp-bot'].includes(route)) return new Response('Not found', { status: 404 });
        if (!equalSecret(request.headers.get(worker ? 'x-worker-secret' : 'x-webhook-secret'), worker ? workerSecret : webhookSecret)) {
            return new Response('Unauthorized', { status: 401 });
        }
        if (route === 'prepare') {
            try { await prepare(); return Response.json({ prepared: true }); }
            catch { return new Response('Preparation failed', { status: 503 }); }
        }
        if (!enabled) return new Response('Cutover not enabled', { status: 503 });
        if (worker) {
            waitUntil(drain().catch(() => console.error('Worker invocation failed')));
            return new Response('Accepted', { status: 202 });
        }
        let events;
        try {
            const text = await request.text();
            if (Buffer.byteLength(text) > 1_000_000) return new Response('Too large', { status: 413 });
            events = eventsFrom(JSON.parse(text));
        } catch { return new Response('Invalid payload', { status: 400 }); }
        try {
            if (events.length) await store.enqueue(events);
        } catch {
            // Never acknowledge data that was not committed to durable storage.
            return new Response('Storage unavailable', { status: 503 });
        }
        if (events.length) waitUntil(drain().catch(() => console.error('Worker invocation failed')));
        return new Response('OK', { status: 200 });
    };
}
module.exports = { createHandler, eventsFrom, equalSecret };
