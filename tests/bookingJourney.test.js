const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingJourney } = require("../bookingJourney");
const schedule = require("../bookingSchedule");
function fixture(membership = null) {
    let draft;
    const menus = [], staff = [], dates = [];
    const journey = createBookingJourney({
        startBooking: async () => (draft = {}), getDraft: async () => draft,
        checkPackage: async () => membership, isChinese: () => false,
        sendButtons: async (from, text, options) => menus.push(options),
        sendMessage: async () => {}, notifyStaff: async (...args) => staff.push(args),
        showDates: async () => dates.push(draft.booking_route), showMainMenu: async () => {}
    });
    return { journey, menus, staff, dates, draft: () => draft };
}
test("first-time public visitors use Monday–Thursday, 4–5:30 PM", async () => {
    const f = fixture(); await f.journey.begin("customer");
    await f.journey.select("customer", "FIRST");
    await f.journey.select("customer", "PUBLIC");
    assert.deepEqual(f.dates, ["first_public"]);
    assert.equal(schedule.isRouteDateAllowed("2026-10-08", "first_public"), true);
    assert.equal(schedule.isRouteDateAllowed("2026-10-09", "first_public"), false);
    assert.deepEqual(schedule.startTimes, ["16:00"]);
});
test("package category buttons and selections enforce verified entitlements", async () => {
    const f = fixture({ allowed_routes: ["weekend"] });
    await f.journey.begin("customer"); await f.journey.select("customer", "RETURNING");
    await f.journey.select("customer", "HAS_PACKAGE"); await f.journey.select("customer", "PUBLIC");
    assert.deepEqual(f.menus.at(-1).map(row => row.id), ["JOURNEY_WEEKEND"]);
    await f.journey.select("customer", "PREMIUM"); assert.equal(f.dates.length, 0);
    await f.journey.select("customer", "WEEKEND"); assert.deepEqual(f.dates, ["weekend"]);
    assert.equal(schedule.isRouteDateAllowed("2026-10-09", "weekend"), true);
    assert.equal(schedule.isRouteDateAllowed("2026-10-08", "weekend"), false);
});
test("unverified returning visitors decline purchase and can book any nonholiday day", async () => {
    const f = fixture(); await f.journey.begin("customer");
    await f.journey.select("customer", "RETURNING"); await f.journey.select("customer", "HAS_PACKAGE");
    await f.journey.select("customer", "NO_BUY"); assert.deepEqual(f.dates, ["no_package"]);
    assert.equal(schedule.isRouteDateAllowed("2026-10-09", "no_package"), true);
    assert.equal(schedule.isRouteDateAllowed("2026-11-09", "no_package"), false);
});
test("private requests and package purchases go to staff without opening booking dates", async () => {
    const f = fixture(); await f.journey.begin("customer");
    await f.journey.select("customer", "FIRST"); await f.journey.select("customer", "PRIVATE");
    assert.equal(f.staff.length, 1); assert.equal(f.dates.length, 0);
    await f.journey.begin("customer"); await f.journey.select("customer", "RETURNING");
    await f.journey.select("customer", "NO_PACKAGE"); await f.journey.select("customer", "BUY");
    assert.equal(f.staff.length, 2); assert.equal(f.dates.length, 0);
});
