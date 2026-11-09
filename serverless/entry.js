const { createHandler } = require('./http');
const { createWorker } = require('./worker');
const { createStore } = require('./store');
const db = require('../supabaseClient');
const bot = require('../server');
const { createStaffHandover } = require('../staffHandover');
const store = createStore(db);
const drain = createWorker({ store, processMessage: bot.processMessage,
    async recordEcho(change, state) {
        // Reuse the original echo validation and keep its original timestamp.
        const validated = createStaffHandover().recordChange(change);
        if (validated.length) {
            const until = Number(change.value.message_echoes[0].timestamp) * 1000 + 60 * 60_000;
            state.handover_until = Math.max(state.handover_until || 0, until);
        }
    }
});
if ((process.env.WHATSAPP_PROVIDER || '360dialog') !== '360dialog') {
    throw new Error('This migration targets the existing 360dialog channel only');
}
const handler = createHandler({ store, drain,
    waitUntil: promise => EdgeRuntime.waitUntil(promise),
    webhookSecret: process.env.D360_WEBHOOK_SECRET,
    workerSecret: process.env.BOT_WORKER_SECRET || process.env.D360_WEBHOOK_SECRET,
    prepare: () => db.rpc('configure_bot_worker', {
        p_url: process.env.SUPABASE_URL + '/functions/v1/whatsapp-bot/work',
        p_secret: process.env.BOT_WORKER_SECRET || process.env.D360_WEBHOOK_SECRET
    }).then(({ error }) => { if (error) throw error; }),
    enabled: process.env.BOT_SERVERLESS_ENABLED === 'true'
});
module.exports = { fetch: handler };
