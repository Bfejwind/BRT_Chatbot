const test = require("node:test");
const assert = require("node:assert/strict");
const { isReminderDue, reminderPayload, createReminderWorker } = require("../bookingReminders");
const definition = require("../templates/booking_reminder.json");

const booking = {
    id: "booking-1", customer_phone: "6590000000", status: "approved",
    session_id: "session-1", booking_date: "2026-10-02", booking_time: "16:00:00"
};
const job = {
    booking_id: booking.id, session_id: booking.session_id,
    booking_date: booking.booking_date, booking_time: booking.booking_time,
    claim_token: "claim-1"
};
const config = { template: definition.name, language: definition.language };
const due = new Date("2026-10-01T08:00:00Z");

test("due 24 hours before the Singapore session, with previous-day catch-up only", () => {
    assert.equal(isReminderDue(booking, new Date("2026-10-01T07:59:59Z")), false);
    assert.equal(isReminderDue(booking, due), true);
    assert.equal(isReminderDue(booking, new Date("2026-10-01T15:59:59Z")), true);
    assert.equal(isReminderDue(booking, new Date("2026-10-01T16:00:00Z")), false);
    assert.equal(isReminderDue(booking, new Date("2026-10-02T09:00:00Z")), false);
    for (const status of ["pending", "rejected", "cancelled"]) {
        assert.equal(isReminderDue({ ...booking, status }, due), false);
    }
});

test("handles year and leap-day boundaries", () => {
    assert.equal(isReminderDue({ ...booking, booking_date: "2027-01-01" },
        new Date("2026-12-31T08:00:00Z")), true);
    assert.equal(isReminderDue({ ...booking, booking_date: "2028-03-01" },
        new Date("2028-02-29T08:00:00Z")), true);
});

test("template uses the booker's phone and dynamic times in both languages", () => {
    const payload = reminderPayload(booking, config);
    assert.equal(payload.to, booking.customer_phone);
    assert.equal(payload.type, "template");
    assert.equal(payload.template.name, definition.name);
    assert.deepEqual(payload.template.components[0].parameters.map(p => p.text),
        ["4:00 PM", "4:15 PM", "4:15 PM", "4:00 PM", "4:15 PM", "4:15 PM"]);
    const earlier = reminderPayload({ ...booking, booking_time: "12:00:00" }, config);
    assert.equal(earlier.template.components[0].parameters[0].text, "12:00 PM");
    assert.equal(earlier.template.components[0].parameters[1].text, "12:15 PM");
    const body = definition.components[0].text;
    assert.ok(body.includes("您好"));
    assert.ok(!body.includes("Jannalyn"));
    assert.ok(!body.includes("&#x20;"));
    assert.ok(body.length <= 1024);
    assert.deepEqual([...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]),
        ["1", "2", "3", "4", "5", "6"]);
});

function fixture({ current = booking, sendError, finishError } = {}) {
    let claimed = false;
    const sent = [], finished = [], errors = [];
    const store = {
        claim: async () => {
            if (claimed) return null;
            claimed = true;
            return job;
        },
        getBooking: async () => current,
        finish: async (...args) => {
            if (finishError) throw finishError;
            finished.push(args);
        }
    };
    const send = async payload => {
        sent.push(payload);
        if (sendError) throw sendError;
        return { messages: [{ id: "wamid.test" }] };
    };
    const args = { store, send, config, now: () => due, logger: { error: (...a) => errors.push(a) } };
    return { ...args, sent, finished, errors, run: createReminderWorker(args) };
}

test("records acceptance and does not resend on repeated/concurrent runs", async () => {
    const f = fixture();
    const secondWorker = createReminderWorker(f);
    await Promise.all([f.run(), f.run(), secondWorker()]);
    await f.run();
    assert.equal(f.sent.length, 1);
    assert.equal(f.finished[0][1], "accepted");
    assert.equal(f.finished[0][2], "wamid.test");
});

test("rechecks cancellation, deletion and rescheduling before sending", async () => {
    for (const current of [null, { ...booking, status: "rejected" },
        { ...booking, booking_date: "2026-10-03" }, { ...booking, session_id: "new-session" }]) {
        const f = fixture({ current });
        await f.run();
        assert.equal(f.sent.length, 0);
        assert.equal(f.finished[0][1], "skipped");
    }
});

test("definitive API rejection is retryable, ambiguous failures are not", async () => {
    const rejected = fixture({ sendError: { response: { status: 400, data: { error: { code: 132001 } } } } });
    await rejected.run();
    assert.equal(rejected.finished[0][1], "failed");
    for (const sendError of [new Error("timeout"), { response: { status: 500 } }]) {
        const f = fixture({ sendError });
        await f.run();
        assert.equal(f.finished[0][1], "unknown");
    }
});

test("database failure after acceptance never retries the send", async () => {
    const f = fixture({ finishError: new Error("database unavailable") });
    await f.run();
    await f.run();
    assert.equal(f.sent.length, 1);
    assert.equal(f.errors.length, 1);
});
