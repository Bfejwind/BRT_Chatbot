const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingJourney } = require("../bookingJourney");
const schedule = require("../bookingSchedule");
function fixture(membership = null, chinese = false) {
    let draft;
    const menus = [], staff = [], dates = [], texts = [], messages = [], checks = [];
    const journey = createBookingJourney({
        startBooking: async () => (draft = {}), getDraft: async () => draft,
        checkPackage: async from => { checks.push(from); return membership; }, isChinese: () => chinese,
        sendButtons: async (from, text, options) => { menus.push(options); texts.push(text); },
        sendMessage: async (from, text) => messages.push(text), notifyStaff: async (...args) => staff.push(args),
        showDates: async () => dates.push(draft.booking_route), showMainMenu: async () => {}
    });
    return { journey, menus, staff, dates, texts, messages, checks, draft: () => draft };
}

test("private pricing explanation accompanies the button in both languages", async () => {
    for (const chinese of [false, true]) {
        const f = fixture({ allowed_routes: ["premium"] }, chinese);
        await f.journey.begin("customer"); await f.journey.select("customer", "FIRST");
        assert.ok(f.menus.at(-1).some(row => row.id === "JOURNEY_PRIVATE"));
        assert.match(f.texts.at(-1), chinese ? /首次体验优惠价不适用/ : /first-session promotional price does not apply/);
        assert.match(f.texts.at(-1), chinese ? /收费有所不同.*工作人员/ : /priced differently.*staff/);
        await f.journey.begin("customer"); await f.journey.select("customer", "RETURNING");
        assert.equal(f.checks.length, 0);
        await f.journey.select("customer", "HAS_PACKAGE");
        assert.deepEqual(f.checks, ["customer"]);
        assert.match(f.texts.at(-1), chinese ? /会员配套不适用/ : /membership packages do not apply/);
    }
});

test("exclusive and premium remain distinct and only owned categories appear", async () => {
    for (const routes of [["exclusive"], ["premium"], ["exclusive", "premium"], ["weekday", "weekend", "exclusive", "premium"]]) {
        const f = fixture({ allowed_routes: routes });
        await f.journey.begin("customer"); await f.journey.select("customer", "RETURNING");
        await f.journey.select("customer", "HAS_PACKAGE"); await f.journey.select("customer", "PUBLIC");
        assert.deepEqual(f.menus.at(-1).map(row => row.id), routes.map(route => "JOURNEY_" + route.toUpperCase()));
    }
});
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
