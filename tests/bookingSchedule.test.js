const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const config = require("../bookingSchedule");

test("blocks gazetted holidays and substitute Mondays, and closes unverified years", () => {
    for (const date of ["2026-11-08", "2026-11-09", "2026-12-25", "2027-02-06", "2027-02-07", "2027-02-08", "2028-01-02"]) {
        assert.equal(config.isBookableDate(date), false, date);
    }
    assert.equal(config.isBookableDate("2026-11-10"), true);
    assert.equal(config.isBookableDate("2027-02-09"), true);
});

test("confirmation hours include the entire 90-minute Singapore session", () => {
    assert.equal(config.formatSessionHours("14:00:00"), "2:00 PM - 3:30 PM (Singapore time)");
    assert.equal(config.formatSessionHours("16:00", true), "16:00 - 17:30 (新加坡时间)");
});

function calendarFixture(events = [], insertError) {
    const writes = [];
    const api = {
        list: async () => ({ data: { items: events } }),
        insert: async args => {
            if (insertError) throw insertError;
            writes.push(args.resource);
            return { data: args.resource };
        },
        get: async () => ({ data: events[0] }),
        patch: async args => { writes.push(args.requestBody); return { data: args.requestBody }; }
    };
    const context = { module: { exports: {} }, process: { env: {} }, require: name =>
        name === "./bookingSchedule" ? config : {
            google: { auth: { GoogleAuth: class {} }, calendar: () => ({ events: api }) }
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../calendarService.js"), "utf8"), context);
    return { ...context.module.exports, writes };
}

test("calendar offers only the three 90-minute sessions", async () => {
    const slots = await calendarFixture().getAvailableSlots("2026-10-02");
    assert.deepEqual(Array.from(slots, s => s.start.toISOString()), [
        "2026-10-02T04:00:00.000Z", "2026-10-02T06:00:00.000Z", "2026-10-02T08:00:00.000Z"
    ]);
    for (const slot of slots) assert.equal(slot.end - slot.start, 90 * 60_000);
});

test("conflicts in the final 30 minutes block a session; touching the end does not", async () => {
    const make = time => calendarFixture([{
        start: { dateTime: `2026-10-02T${time}:00+08:00` },
        end: { dateTime: "2026-10-02T14:00:00+08:00" }
    }]);
    const args = { bookingDate: "2026-10-02", bookingTime: "12:00" };
    assert.equal(await make("13:15").hasExternalCalendarConflict(args), true);
    assert.equal(await make("13:30").hasExternalCalendarConflict(args), false);
});

test("new calendar event ends at 5:30 PM and reused event gets the new duration", async () => {
    const args = { sessionId: "11111111-1111-1111-1111-111111111111",
        bookingDate: "2026-10-02", bookingTime: "16:00" };
    const fresh = calendarFixture();
    await fresh.createSessionEvent(args);
    assert.equal(fresh.writes[0].end.dateTime, "2026-10-02T09:30:00.000Z");
    const existing = calendarFixture([{
        end: { dateTime: "2026-10-02T09:00:00Z" },
        extendedProperties: { private: { bookingSessionId: args.sessionId } }
    }], { code: 409 });
    await existing.createSessionEvent(args);
    assert.equal(existing.writes[0].end.dateTime, "2026-10-02T09:30:00.000Z");
});

test("customer menu uses the same schedule, full ranges, and valid row lengths", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    const payloads = [];
    const context = { BOOKING_CONFIG: config, process: { env: {} }, console,
        getBookingDates: () => ["2026-10-02"], getSessionAvailability: async () => [],
        hasExternalCalendarConflict: async () => false, getLanguage: () => "en",
        postWhatsApp: async (url, body) => payloads.push(body) };
    vm.createContext(context);
    const start = source.indexOf("async function getBookableSlots(");
    const end = source.indexOf("\nasync function ", source.indexOf("async function sendAvailableTimes(") + 1);
    vm.runInContext(source.slice(start, end), context);
    await context.sendAvailableTimes("customer", "2026-10-02");
    const rows = payloads[0].interactive.action.sections[0].rows;
    assert.deepEqual(Array.from(rows, r => r.id), ["BOOK_TIME_12:00", "BOOK_TIME_14:00", "BOOK_TIME_16:00"]);
    assert.deepEqual(Array.from(rows, r => r.title), [
        "12:00 PM - 1:30 PM", "2:00 PM - 3:30 PM", "4:00 PM - 5:30 PM"
    ]);
    context.getLanguage = () => "zh";
    await context.sendAvailableTimes("customer", "2026-10-02");
    for (const payload of payloads) {
        for (const row of payload.interactive.action.sections[0].rows) assert.ok(row.title.length <= 24);
    }
});

test("booking persistence rejects old 1 PM and 3 PM options", async () => {
    const context = { module: { exports: {} }, require: name =>
        name === "./bookingSchedule" ? config : {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../bookingDatabase.js"), "utf8"), context);
    const db = context.module.exports;
    await db.startBooking("customer");
    await db.saveBookingDate("customer", "2026-10-02");
    for (const time of ["13:00", "15:00", "17:00"]) {
        await assert.rejects(db.saveBookingTime("customer", time), /Invalid booking session time/);
    }
    for (const time of config.startTimes) await db.saveBookingTime("customer", time);
});
