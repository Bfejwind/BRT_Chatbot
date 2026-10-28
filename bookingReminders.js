const DAY_MS = 24 * 60 * 60 * 1000;
const isFullFormat=format=>['full_v2','full_v3','full_v4','full_v5','full_v6'].includes(format);

function singaporeDate(date) {
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

function sessionStart(booking) {
    return new Date(`${booking.booking_date}T${booking.booking_time}+08:00`);
}

function isReminderDue(booking, now = new Date()) {
    const start = sessionStart(booking);
    return booking.status === "approved" &&
        singaporeDate(start) === singaporeDate(new Date(now.getTime() + DAY_MS)) &&
        start.getTime() - DAY_MS <= now.getTime();
}

function reminderPayload(booking, config) {
    const start = sessionStart(booking);
    if (!Number.isFinite(start.getTime())) {
        throw new Error("Invalid reminder session date/time");
    }
    const format = date => date.toLocaleTimeString("en-US", {
        timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit", hour12: true
    });
    const welcome = format(start);
    const intro = format(new Date(start.getTime() + 15 * 60 * 1000));
    return {
        messaging_product: "whatsapp",
        to: booking.customer_phone,
        type: "template",
        template: {
            name: config.template,
            language: { code: config.language },
            components: [{
                type: "body",
                parameters: [welcome, intro, intro, welcome, intro, intro]
                    .map(text => ({ type: "text", text }))
            }]
        }
    };
}

function createReminderWorker({ store, send, config, now = () => new Date(), logger = console }) {
    let running = false;
    return async function run() {
        if (running) return;
        running = true;
        try {
            for (let i = 0; i < 50; i++) {
                const job = await store.claim();
                if (!job) break;
                // Recheck cancellations and rescheduling immediately before sending.
                const booking = await store.getBooking(job.booking_id);
                if (!booking || !isReminderDue(booking, now()) ||
                    String(booking.session_id) !== job.session_id ||
                    booking.booking_date !== job.booking_date ||
                    booking.booking_time !== job.booking_time) {
                    await store.finish(job, "skipped");
                    continue;
                }
                let messageId;
                const parts = { ...(job.delivery_parts || {}) };
                try {
                    // Preserve a multipart job's revision across a template change.
                    const format=parts._format || (parts[0]?'full_v2':config.format);
                    const payloads = isFullFormat(format)
                        ? require('./reminderTemplates').reminderSequence(booking,format) : [reminderPayload(booking, config)];
                    for (const [index,payload] of payloads.entries()) {
                        if(parts[index]) { messageId=parts[index]; continue; }
                        const response = await send(payload);
                        messageId = response?.messages?.[0]?.id;
                        if (!messageId) throw new Error("WhatsApp returned no message ID");
                        if(isFullFormat(format)) {
                            parts[index]=messageId;
                            if(['full_v3','full_v4','full_v5','full_v6'].includes(format))parts._format=format;
                            // A checkpoint failure is ambiguous: never resend this part.
                            await store.saveParts(job,parts);
                        }
                    }
                } catch (error) {
                    // Only an explicit API rejection is safe to retry. A timeout or
                    // connection loss may happen AFTER WhatsApp accepted the message.
                    const rejected = error.response?.status >= 400 &&
                        error.response?.status < 500 && error.response?.data?.error;
                    const detail = error.response?.data?.error;
                    await store.finish(job, rejected ? "failed" : "unknown", null,
                        rejected ? (typeof detail === "string" ? detail : `WhatsApp error ${detail.code}`) :
                            "Delivery outcome unknown; review before retrying");
                    logger.error(`Booking reminder ${job.booking_id}: ${rejected ? "rejected" : "unknown outcome"}`);
                    continue;
                }
                // Keep this outside the send catch: a DB failure must never trigger
                // another delivery of an already accepted message.
                await store.finish(job, "accepted", messageId);
            }
        } catch (error) {
            logger.error("Booking reminder worker failed:", {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint
            });
        } finally {
            running = false;
        }
    };
}

function startBookingReminders() {
    if (process.env.BOOKING_REMINDERS_ENABLED !== "true") {
        console.log("Booking reminders disabled; see REMINDERS.md for setup.");
        return;
    }
    const config = {
        format: process.env.BOOKING_REMINDER_FORMAT || 'full_v2',
        template: process.env.WHATSAPP_REMINDER_TEMPLATE,
        language: process.env.WHATSAPP_REMINDER_LANGUAGE || "en_US"
    };
    const {providerConfig,validateMeta,listTemplates}=require('./whatsappProvider');
    const channel=providerConfig();
    if(channel.provider==='meta')validateMeta(channel);
    if ((!config.template && !isFullFormat(config.format)) || (channel.provider==='360dialog'&&!channel.apiKey)) {
        throw new Error("Booking reminders require a template and WhatsApp channel credentials");
    }
    const db = require("./supabaseClient");
    const { postWhatsApp } = require("./whatsappSender");
    const { getBookingById } = require("./bookingDatabase");
    function makeStore(table,claimRpc,getBooking) { return {
        async claim() {
            const { data, error } = await db.rpc(claimRpc);
            if (error) throw error;
            const job=data?.[0];
            if(!job)return null;
            if(isFullFormat(config.format)) {
                const result=await db.from(table).select('delivery_parts').eq('booking_id',job.booking_id)
                    .eq('session_id',job.session_id).eq('booking_date',job.booking_date).eq('booking_time',job.booking_time).single();
                if(result.error)throw result.error;
                job.delivery_parts=result.data.delivery_parts;
            }
            return job;
        },
        getBooking,
        async saveParts(job,parts) {
            const result=await db.from(table).update({delivery_parts:parts,updated_at:new Date().toISOString()})
                .eq('booking_id',job.booking_id).eq('session_id',job.session_id)
                .eq('booking_date',job.booking_date).eq('booking_time',job.booking_time)
                .eq('claim_token',job.claim_token).eq('status','sending').select('booking_id');
            if(result.error)throw result.error;
            if(result.data?.length!==1)throw new Error('Reminder claim was lost');
        },
        async finish(job, status, messageId = null, errorText = null) {
            const { data, error } = await db.from(table).update({
                status,
                whatsapp_message_id: messageId,
                last_error: errorText,
                updated_at: new Date().toISOString(),
                next_attempt_at: status === "failed"
                    ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
            }).eq("booking_id", job.booking_id)
                .eq("session_id", job.session_id)
                .eq("booking_date", job.booking_date)
                .eq("booking_time", job.booking_time)
                .eq("claim_token", job.claim_token)
                .eq("status", "sending")
                .select("booking_id");
            if (error) throw error;
            if (data?.length !== 1) throw new Error("Reminder claim was lost");
        }
    }; }
    const send = async payload => {
        const response = await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            payload,
            { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY,
                "Content-Type": "application/json" }, timeout: 30000 }
        );
        return response.data;
    };
    const publicRun=createReminderWorker({store:makeStore('booking_reminders','claim_booking_reminder',getBookingById),config,send});
    const privateRun=createReminderWorker({store:makeStore('staff_private_reminders','claim_staff_private_reminder',async id=>{
        const {data,error}=await db.from('staff_private_bookings').select('*').eq('id',id).maybeSingle();
        if(error)throw error;
        return data&&data.reminder_consent&&data.calendar_sync_status==='synced'
            ? {...data,session_id:data.id}:null;
    }),config,send});
    let readyUntil=0;
    const run=async()=>{
        if(isFullFormat(config.format) && Date.now()>=readyUntil) {
            try {
                // Do not claim jobs or exhaust their retries while approval is pending.
                const rows=await listTemplates(channel,(...args)=>require('axios').get(...args));
                const ready=require('./reminderTemplates').getDefinitions(config.format).every(d=>rows.some(t=>
                    t.name===d.name&&t.language===d.language&&String(t.status).toLowerCase()==='approved'));
                if(!ready){console.log('Full reminders waiting for template approval; no jobs claimed.');return;}
                for(const table of ['booking_reminders','staff_private_reminders']) {
                    const result=await db.from(table).select('delivery_parts').limit(0);
                    if(result.error)throw result.error;
                }
                readyUntil=Date.now()+5*60_000;
            }catch(error){console.error('Reminder readiness check failed',error.code||'CONFIGURATION_ERROR');return;}
        }
        await publicRun();await privateRun();
    };
    void run();
    const timer = setInterval(() => { void run(); }, 60 * 1000);
    timer.unref();
    console.log("Booking reminder scheduler started (Singapore time).");
    return timer;
}

module.exports = { isReminderDue, reminderPayload, createReminderWorker, startBookingReminders };
