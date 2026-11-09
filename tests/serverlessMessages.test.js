const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, eventsFrom } = require('../serverless/http');
const { createCheckpointedSender, createWorker } = require('../serverless/worker');
const context = require('../serverless/context');
const payload = { entry: [{ changes: [{ field: 'messages', value: { messages: [
    { id: 'wamid.one', from: '6591234567', type: 'text', text: { body: 'hello' } }
] } }] }] };
const request = (body, secret = 'webhook') => new Request('https://example.test/whatsapp-bot/webhook', {
    method: 'POST', headers: { 'x-webhook-secret': secret }, body: JSON.stringify(body)
});

test('webhook commits messages before acknowledgment and does not wait for replies', async () => {
    const calls = [], backgrounds = [];
    const handler = createHandler({ enabled: true, webhookSecret: 'webhook', workerSecret: 'worker',
        store: { enqueue: async events => { calls.push('committed'); assert.equal(events[0].id, 'wamid.one'); } },
        drain: () => new Promise(() => {}), waitUntil: promise => backgrounds.push(promise) });
    assert.equal((await handler(request(payload))).status, 200);
    assert.deepEqual(calls, ['committed']);
    assert.equal(backgrounds.length, 1);
});

test('unauthenticated, disabled and failed-storage requests never acknowledge messages', async () => {
    let writes = 0;
    const settings = { enabled: true, webhookSecret: 'webhook', workerSecret: 'worker',
        store: { enqueue: async () => { writes++; throw Error('DB down'); } }, drain: async () => {}, waitUntil() {} };
    const handler = createHandler(settings);
    assert.equal((await handler(request(payload, 'wrong'))).status, 401);
    assert.equal(writes, 0);
    assert.equal((await handler(request(payload))).status, 503);
    assert.equal(writes, 1);
    assert.equal((await createHandler({ ...settings, enabled: false })(request(payload))).status, 503);
    assert.equal(writes, 1);
    assert.equal((await handler(new Request('https://example.test/whatsapp-bot/webhook', {
        method: 'POST', headers: { 'x-webhook-secret': 'webhook' }, body: '{'
    }))).status, 400);
});

test('status callbacks create no work and invalid senders are ignored', () => {
    assert.deepEqual(eventsFrom({ entry: [{ changes: [{ value: { statuses: [{ id: 'receipt' }] } }] }] }), []);
    const invalid = structuredClone(payload);
    invalid.entry[0].changes[0].value.messages[0].from = 'invalid';
    assert.deepEqual(eventsFrom(invalid), []);
});

function senderFixture({ receipt = { status: 'ready' }, error, checkpointError } = {}) {
    const calls = [];
    const job = { id: 'one', claim_token: 'token' };
    const store = {
        beginSend: async () => receipt,
        reserveSend: async () => 0,
        rejectSend: async () => calls.push('rejected'),
        acceptSend: async () => { calls.push('accepted'); if (checkpointError) throw checkpointError; }
    };
    const send = createCheckpointedSender(async () => {
        calls.push('sent');
        if (error) throw error;
        return { data: { messages: [{ id: 'provider-id' }] } };
    });
    return { calls, run: () => context.run({ job, store, ordinal: 0, deadline: Date.now() + 90_000 },
        () => send('https://provider.test/messages', { to: '6591234567' }, {})) };
}

test('accepted replies are reused after retries instead of sent twice', async () => {
    const response = { data: { messages: [{ id: 'original' }] } };
    const f = senderFixture({ receipt: { status: 'accepted', response } });
    assert.deepEqual(await f.run(), response);
    assert.deepEqual(f.calls, []);
});

test('network timeouts and checkpoint failures stop retries as unknown', async () => {
    for (const options of [{ error: Error('timeout') }, { checkpointError: Error('DB unavailable') },
        { receipt: { status: 'unknown' } }, { receipt: { status: 'mismatch' } }]) {
        const f = senderFixture(options);
        await assert.rejects(f.run(), error => error.deliveryUnknown === true);
        assert.ok(!f.calls.includes('rejected'));
    }
});

test('explicit provider rejections can be retried without replaying accepted parts', async () => {
    const f = senderFixture({ error: { response: { status: 429, data: { error: { code: 130429 } } } } });
    await assert.rejects(f.run(), error => !error.deliveryUnknown);
    assert.deepEqual(f.calls, ['sent', 'rejected']);
});

test('worker restores conversation state and saves changes across invocations', async () => {
    const states = [], jobs = [{ id: 'first', customer_phone: 'customer', kind: 'message', payload: {} }];
    const state = { language: 'zh', handover_until: Date.now() + 60_000 };
    const worker = createWorker({ store: {
        claim: async () => jobs.shift(), getState: async () => state,
        finish: async (_, status, saved) => states.push({ status, saved: structuredClone(saved) }),
        fail: async () => assert.fail('Unexpected failure')
    }, processMessage: async (_, message, loaded) => {
        assert.equal(loaded.language, 'zh');
        assert.equal(context.getStore().state, state);
        loaded.language = 'en';
    }, recordEcho: async () => assert.fail('Unexpected echo') });
    await worker();
    assert.equal(states[0].status, 'done');
    assert.equal(states[0].saved.language, 'en');
    assert.equal(context.getStore(), undefined);
});
