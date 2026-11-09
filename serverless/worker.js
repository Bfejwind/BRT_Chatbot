const context = require('./context');
function createWorker({ store, processMessage, recordEcho, now = Date.now, logger = console }) {
    return async function drain() {
        const deadline = now() + 95_000;
        for (let i = 0; i < 10 && now() < deadline; i++) {
            const job = await store.claim();
            if (!job) break;
            let state;
            try {
                state = await store.getState(job.customer_phone);
                await context.run({ job, state, store, ordinal: 0, deadline }, async () => {
                    if (job.kind === 'echo') await recordEcho(job.payload, state);
                    else await processMessage(job.customer_phone, job.payload, state);
                });
                await store.finish(job, 'done', state);
            } catch (error) {
                // Delivery uncertainty is never automatically replayed.
                const status = error.deliveryUnknown ? 'unknown' : 'queued';
                await store.fail(job, status, error.code || 'PROCESSING_FAILED', state);
                logger.error('Serverless message processing failed', { status, code: error.code || 'PROCESSING_FAILED' });
            }
        }
    };
}

function createCheckpointedSender(post, { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    return async function send(url, payload, options) {
        const active = context.getStore();
        if (!active) throw new Error('Serverless sends require a claimed inbox message');
        const { job, store } = active;
        const ordinal = active.ordinal++;
        const receipt = await store.beginSend(job, ordinal, payload);
        if (receipt.status === 'accepted') return receipt.response;
        if (receipt.status !== 'ready') {
            throw Object.assign(new Error('Previous delivery outcome is uncertain'), { deliveryUnknown: true });
        }
        // Rate reservations are persisted across all function instances.
        while (true) {
            const wait = await store.reserveSend(payload.to);
            if (now() + wait + 25_000 > active.deadline) {
                await store.rejectSend(job, ordinal);
                throw Object.assign(new Error('Invocation deadline approaching'), { code: 'CONTINUE_LATER' });
            }
            if (wait <= 0) break;
            await sleep(wait);
        }
        let response;
        try {
            response = await post(url, payload, { ...options, timeout: 20_000 });
            if (!response?.data?.messages?.[0]?.id) {
                throw Object.assign(new Error('Provider returned no message ID'), { deliveryUnknown: true });
            }
        } catch (error) {
            // Only a definite API rejection proves that nothing was delivered.
            const rejected = error.response?.status >= 400 && error.response?.status < 500 && error.response?.data?.error;
            if (rejected) await store.rejectSend(job, ordinal);
            else error.deliveryUnknown = true;
            error.isWhatsAppSendError = true;
            throw error;
        }
        try {
            await store.acceptSend(job, ordinal, response);
        } catch (error) {
            error.deliveryUnknown = true;
            throw error;
        }
        return response;
    };
}
module.exports = { createWorker, createCheckpointedSender };
