const DAY_MS = 24 * 60 * 60 * 1000;

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
                try {
                    const response = await send(reminderPayload(booking, config));
                    messageId = response?.messages?.[0]?.id;
                    if (!messageId) throw new Error("WhatsApp returned no message ID");
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
            logger.error("Booking reminder worker failed:", error.code || error.message);
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
        template: process.env.WHATSAPP_REMINDER_TEMPLATE,
        language: process.env.WHATSAPP_REMINDER_LANGUAGE || "en_US"
    };
    if (!config.template || !process.env.WHATSAPP_API_KEY) {
        throw new Error("Booking reminders require a template and WHATSAPP_API_KEY");
    }
    const db = require("./supabaseClient");
    const { postWhatsApp } = require("./whatsappSender");
    const { getBookingById } = require("./bookingDatabase");
    const store = {
        async claim() {
            const { data, error } = await db.rpc("claim_booking_reminder");
            if (error) throw error;
            return data?.[0] || null;
        },
        getBooking: getBookingById,
        async finish(job, status, messageId = null, errorText = null) {
            const { data, error } = await db.from("booking_reminders").update({
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
    };
    const run = createReminderWorker({ store, config, send: async payload => {
        const response = await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            payload,
            { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY,
                "Content-Type": "application/json" }, timeout: 30000 }
        );
        return response.data;
    } });
    void run();
    const timer = setInterval(() => { void run(); }, 60 * 1000);
    timer.unref();
    console.log("Booking reminder scheduler started (Singapore time).");
    return timer;
}

module.exports = { isReminderDue, reminderPayload, createReminderWorker, startBookingReminders };
