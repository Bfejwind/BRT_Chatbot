function createStore(db) {
    async function rpc(name, args) {
        const { data, error } = await db.rpc(name, args);
        if (error) throw error;
        return data;
    }
    return {
        enqueue: events => rpc('enqueue_bot_events', { p_events: events }),
        async claim() { return (await rpc('claim_bot_event', {}))?.[0] || null; },
        async getState(phone) {
            const { data, error } = await db.from('bot_conversations').select('state').eq('customer_phone', phone).maybeSingle();
            if (error) throw error;
            return data?.state || {};
        },
        finish: (job, status, state) => rpc('finish_bot_event', {
            p_id: job.id, p_token: job.claim_token, p_status: status, p_state: state, p_error: null
        }),
        fail: (job, status, error, state) => rpc('finish_bot_event', {
            p_id: job.id, p_token: job.claim_token, p_status: status, p_state: state || null, p_error: error
        }),
        beginSend: (job, ordinal, payload) => rpc('begin_bot_send', {
            p_id: job.id, p_token: job.claim_token, p_ordinal: ordinal, p_payload: payload
        }),
        reserveSend: phone => rpc('reserve_bot_send', { p_phone: phone }),
        acceptSend: (job, ordinal, response) => rpc('finish_bot_send', {
            p_id: job.id, p_token: job.claim_token, p_ordinal: ordinal, p_status: 'accepted',
            p_response: { data: response.data }
        }),
        rejectSend: (job, ordinal) => rpc('finish_bot_send', {
            p_id: job.id, p_token: job.claim_token, p_ordinal: ordinal, p_status: 'rejected', p_response: null
        })
    };
}
module.exports = { createStore };
