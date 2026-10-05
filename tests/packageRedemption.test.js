const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const config = require("../bookingSchedule");
function fixture(route, failFetch = false) {
    const calls = [];
    let errorOnFetch = failFetch;
    const db = { rpc: async (...args) => { calls.push(args); return { data: "booking-id" }; },
        from: () => ({ select: () => ({ eq: () => ({ single: async () => {
            if (errorOnFetch) { errorOnFetch = false; return { error: { message: "network unavailable" } }; }
            return { data: { id: "booking-id", customer_phone: "customer", booking_sessions: {
                booking_date: "2026-10-08", booking_time: "16:00" } } };
        } }) }) }) };
    const context = { module: { exports: {} }, require: name =>
        name === "./bookingSchedule" ? config : name === "node:crypto" ? require("node:crypto") :
            name === "./packageService" ? { getActivePackage: async () => ({ allowed_routes: [route] }) } : db };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/../bookingDatabase.js`, "utf8"), context);
    return { ...context.module.exports, calls };
}
async function prepare(f, route) {
    const draft = await f.startBooking("customer");
    draft.journey_step = "dates"; draft.booking_route = route;
    await f.saveBookingDate("customer", "2026-10-08");
    await f.saveBookingTime("customer", "16:00");
    await f.savePartySize("customer", 3);
}
test("package confirmations use the atomic redemption RPC, ordinary bookings do not", async () => {
    for (const route of ["weekday", "exclusive", "premium", "no_package"]) {
        const f = fixture(route); await prepare(f, route); await f.submitBooking("customer");
        const [name, args] = f.calls[0];
        assert.equal(name, route === "no_package" ? "reserve_booking" : "reserve_package_booking");
        assert.equal(args.p_party_size, 3);
        if (route !== "no_package") {
            assert.equal(args.p_booking_route, route);
            assert.match(args.p_request_id, /^[0-9a-f-]{36}$/);
        } else assert.equal(args.p_request_id, undefined);
    }
});
test("a retry after a fetch failure reuses the redemption receipt key", async () => {
    const f = fixture("premium", true); await prepare(f, "premium");
    await assert.rejects(f.submitBooking("customer"), /could not be fetched/);
    await f.submitBooking("customer");
    assert.equal(f.calls[0][1].p_request_id, f.calls[1][1].p_request_id);
});
