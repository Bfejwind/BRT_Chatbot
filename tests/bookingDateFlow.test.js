const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDateFlowMessage, readDateFlowReply } = require("../bookingDateFlow");
const flow = require("../flows/booking-date.json");
const dates = ["2026-10-02", "2026-10-03", "2026-10-04"];

test("calendar disables every excluded date between the selectable bounds", () => {
    const payload = createDateFlowMessage({ to: "customer", draft: {},
        dates: ["2026-11-07", "2026-11-10", "2026-11-12"], flowId: "test-flow" });
    const data = payload.interactive.action.parameters.flow_action_payload.data;
    assert.deepEqual(data.unavailable_dates, ["2026-11-08", "2026-11-09", "2026-11-11"]);
    const picker = flow.screens[0].layout.children[0].children[0];
    assert.equal(picker["unavailable-dates"], "${data.unavailable_dates}");
});

test("date availability excludes sold-out and blocked days but keeps partially full days", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    const config = require("../bookingSchedule");
    const sessions = config.startTimes.map(time => ({
        booking_date: dates[0], booking_time: time, capacity: 10, reserved_places: 10
    }));
    sessions.push({ booking_date: dates[2], booking_time: "12:00", capacity: 10, reserved_places: 9 });
    let databaseReads = 0, calendarReads = 0;
    const context = vm.createContext({ BOOKING_CONFIG: config,
        getBookingDates: () => dates,
        getSessionAvailabilityRange: async () => { databaseReads++; return sessions; },
        getEventsForDay: async () => { calendarReads++; return []; },
        hasExternalCalendarConflict: async ({ bookingDate }) => bookingDate === dates[1]
    });
    vm.runInContext(source.slice(source.indexOf("async function getSelectableBookingDates("),
        source.indexOf("async function sendAvailableTimes(")), context);
    assert.deepEqual(Array.from(await context.getSelectableBookingDates()), [dates[2]]);
    assert.equal(databaseReads, 1);
    assert.equal(calendarReads, 1);
});

function fixture(isChinese = false) {
    const draft = {};
    const payload = createDateFlowMessage({ to: "customer", draft, dates,
        flowId: "test-flow", isChinese, now: 1000 });
    const reply = JSON.stringify({ flow_token: draft.date_flow_token, booking_date: dates[1] });
    return { draft, payload, reply };
}

test("sends a native calendar Flow with current bounds and matching screen data", () => {
    const { draft, payload } = fixture();
    assert.equal(payload.to, "customer");
    assert.equal(payload.interactive.type, "flow");
    const params = payload.interactive.action.parameters;
    assert.equal(params.flow_token, draft.date_flow_token);
    assert.equal(params.flow_action_payload.screen, flow.screens[0].id);
    assert.equal(params.flow_action_payload.data.min_date, dates[0]);
    assert.equal(params.flow_action_payload.data.max_date, dates.at(-1));
    assert.deepEqual(Object.keys(params.flow_action_payload.data).sort(),
        Object.keys(flow.screens[0].data).sort());
    assert.equal(fixture(true).payload.interactive.action.parameters.flow_cta, "选择日期");
});

test("accepts the chosen date only for the customer's active calendar", () => {
    const a = fixture(), b = fixture();
    assert.equal(readDateFlowReply(a.reply, a.draft, dates, 2000), dates[1]);
    assert.equal(readDateFlowReply(a.reply, b.draft, dates, 2000), null);
    assert.equal(readDateFlowReply(a.reply, {}, dates, 2000), null);
    assert.equal(readDateFlowReply(a.reply, null, dates, 2000), null);
    assert.equal(readDateFlowReply(a.reply, a.draft, dates, a.draft.date_flow_expires_at), null);
});

test("rejects malformed responses, dates outside the window, and replaced calendars", () => {
    const f = fixture();
    for (const reply of [undefined, "{", "null", "[]", "{}", JSON.stringify({
        flow_token: f.draft.date_flow_token, booking_date: "2026-12-01"
    })]) {
        assert.equal(readDateFlowReply(reply, f.draft, dates, 2000), null);
    }
    assert.equal(readDateFlowReply(f.reply, f.draft, [dates[2]], 2000), null);
    createDateFlowMessage({ to: "customer", draft: f.draft, dates,
        flowId: "test-flow", isChinese: false, now: 2000 });
    assert.equal(readDateFlowReply(f.reply, f.draft, dates, 3000), null);
});

function handlerFixture(f) {
    const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    const selected = [], messages = [];
    let reopened = 0;
    const context = {
        getDraft: async () => f.draft,
        saveDraft: async draft => { f.draft = draft; },
        getBookingDates: () => dates,
        getLanguage: () => "en",
        readDateFlowReply: (reply, draft, available) => readDateFlowReply(reply, draft, available, 2000),
        handleBookingDate: async (...args) => selected.push(args),
        sendMessage: async (...args) => messages.push(args),
        sendAvailableDates: async () => { reopened++; }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf("async function handleInteractiveMessage("),
        source.indexOf("function requireValid360DialogSecret(")), context);
    return { context, selected, messages, reopened: () => reopened };
}

test("Flow completion continues the existing booking and consumes the calendar token", async () => {
    const f = fixture(), h = handlerFixture(f);
    await h.context.handleInteractiveMessage("customer", { interactive: {
        type: "nfm_reply", nfm_reply: { response_json: f.reply }
    } });
    assert.deepEqual(h.selected, [["customer", `BOOK_DATE_${dates[1]}`]]);
    assert.equal(f.draft.date_flow_token, undefined);
    assert.equal(h.reopened(), 0);
});

test("invalid completion prompts a fresh calendar without modifying the booking", async () => {
    const f = fixture(), h = handlerFixture(f);
    await h.context.handleInteractiveMessage("customer", { interactive: {
        type: "nfm_reply", nfm_reply: { response_json: "broken" }
    } });
    assert.equal(h.selected.length, 0);
    assert.equal(h.messages.length, 1);
    assert.equal(h.reopened(), 1);
});
