const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function fixture(rows, error) {
    const filters = [];
    const query = {
        select() { return this; },
        eq(key, value) {
            filters.push([key, value]);
            return this;
        },
        then(resolve) { return Promise.resolve({ data: rows, error }).then(resolve); }
    };
    const context = { module: { exports: {} }, require: () => ({ from: () => query }) };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/../packageService.js`, "utf8"), context);
    return { ...context.module.exports, filters };
}
test("combines valid entitlements and excludes expired packages in Singapore time", async () => {
    const f = fixture([
        { allowed_routes: ["premium"], expires_on: "2026-10-04" },
        { allowed_routes: ["weekday"], expires_on: "2026-10-05" },
        { allowed_routes: ["weekend", "weekday"], expires_on: null }
    ]);
    const p = await f.getActivePackage("6591234567", new Date("2026-10-04T17:00:00Z"));
    assert.deepEqual(Array.from(p.allowed_routes), ["weekday", "weekend"]);
    assert.deepEqual(f.filters, [["customer_phone", "6591234567"], ["active", true]]);
});
test("missing packages return null and database errors remain distinguishable", async () => {
    assert.equal(await fixture([]).getActivePackage("customer"), null);
    const error = new Error("missing table");
    await assert.rejects(fixture(null, error).getActivePackage("customer"), e => e === error);
});

test("final reservation rejects a package revoked after category selection", async () => {
    const config = require("../bookingSchedule");
    const context = { module: { exports: {} }, require: name =>
        name === "./bookingSchedule" ? config : name === "./packageService"
            ? { getActivePackage: async () => null }
            : { rpc: async () => assert.fail("revoked package must not reserve") }
    };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/../bookingDatabase.js`, "utf8"), context);
    const db = context.module.exports;
    const draft = await db.startBooking("customer");
    draft.journey_step = "dates"; draft.booking_route = "weekday";
    await db.saveBookingDate("customer", "2026-10-08");
    await db.saveBookingTime("customer", "16:00");
    await db.savePartySize("customer", 2);
    await assert.rejects(db.submitBooking("customer"), /Package is no longer active/);
});
