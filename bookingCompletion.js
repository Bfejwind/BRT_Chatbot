function createCompletionWorker({ store, synchronize, sendCustomer, sendStaff }) {
    let running = false;
    return async function run(requestId = null) {
        if (running) return;
        running = true;
        try {
            for (let i = 0; i < 30; i++) {
                const job = await store.claim(requestId);
                if (!job) break;
                try {
                    const booking = await store.getBooking(job.booking_id);
                    if (!booking || booking.status !== 'approved') {
                        await store.finish(job, 'done', 'done');
                        continue;
                    }
                    if (job.stage === 'calendar') await synchronize(booking);
                    else if (job.stage === 'customer') await sendCustomer(job, booking);
                    else if (job.stage === 'staff') await sendStaff(job, booking);
                    if (job.stage === 'calendar') await store.finish(job, 'customer', 'pending');
                    else await advance(job, 'done');
                } catch (error) {
                    // Only retry rejected sends. A timeout or a crash may already
                    // have delivered the message, and requires manual review.
                    const rejected = error.response?.status >= 400 && error.response?.status < 500;
                    if (job.stage === 'calendar') await store.finish(job, job.stage, 'pending', error.message);
                    else await advance(job, rejected ? 'pending' : 'unknown', error.message);
                }
            }
        } finally { running = false; }
    };
    async function advance(job, result, errorText = null) {
        const outcomes = {
            customer_status: job.customer_status || 'pending',
            staff_status: job.staff_status || 'pending',
            [job.stage + '_status']: result
        };
        // A failed customer confirmation must not prevent the staff alert, and
        // a failed staff alert must not prevent the customer confirmation.
        const other = job.stage === 'customer' ? 'staff' : 'customer';
        const next = outcomes[other + '_status'] === 'pending' ? other
            : result === 'pending' ? job.stage : 'done';
        const status = next !== 'done' ? 'pending'
            : Object.values(outcomes).includes('unknown') ? 'unknown' : 'done';
        await store.finish(job, next, status, errorText, outcomes);
    }
}
function createSupabaseCompletionStore(db, getBooking) {
    return {
        getBooking,
        async claim(requestId) {
            const { data, error } = await db.rpc('claim_booking_completion', {p_request_id:requestId});
            if (error) throw error;
            return data?.[0] || null;
        },
        async finish(job, stage, status, errorText = null, outcomes = {}) {
            const { data, error } = await db.from('booking_completion_jobs').update({
                stage, status, ...outcomes, last_error:errorText ||
                    (Object.values(outcomes).includes('unknown') ? job.last_error : null),
                next_attempt_at:new Date(Date.now() + (errorText ? 60_000 : 0)).toISOString(),
                updated_at:new Date().toISOString()
            }).eq('request_id',job.request_id).eq('claim_token',job.claim_token).eq('status','sending').select('request_id');
            if (error) throw error;
            if (data?.length !== 1) throw new Error('Booking completion claim was lost');
        }
    };
}
module.exports = { createCompletionWorker, createSupabaseCompletionStore };
