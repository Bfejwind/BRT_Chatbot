const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingJourney } = require("../bookingJourney");
const schedule = require("../bookingSchedule");
function fixture(membership = null, chinese = false) {
    let draft;
    const menus = [], staff = [], dates = [], texts = [], messages = [], checks = [], images = [];
    const journey = createBookingJourney({
        startBooking: async () => (draft = {}), getDraft: async () => structuredClone(draft),
        saveDraft: async value => { draft = structuredClone(value); },
        checkPackage: async from => { checks.push(from); return membership; }, isChinese: () => chinese,
        ceremonyPrices: "https://example.test/CeremonyPrices.jpg",
        sendButtons: async (from, text, options, image) => { menus.push(options); texts.push(text); images.push(image); },
        sendMessage: async (from, text) => messages.push(text), notifyStaff: async (...args) => staff.push(args),
        showDates: async () => dates.push(draft.booking_route), showMainMenu: async () => {}
    });
    return { journey, menus, staff, dates, texts, messages, checks, images, draft: () => draft };
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
test("expired private buttons return to the first booking question", async () => {
    for (const chinese of [false, true]) {
        for (const choice of ["PRIVATE", "NO_BUY"]) {
            const f = fixture(null, chinese);
            await f.journey.select("customer", choice);
            assert.equal(f.staff.length, 0);
            assert.equal(f.draft().journey_step, "first");
            assert.equal(f.menus.at(-1)[0].id, "JOURNEY_FIRST");
        }
    }
});

test("private button from the purchase step also hands off to staff", async () => {
    const f = fixture();
    await f.journey.begin("customer");
    await f.journey.select("customer", "RETURNING");
    await f.journey.select("customer", "NO_PACKAGE");
    await f.journey.select("customer", "PRIVATE");
    assert.equal(f.staff.length, 1);
    assert.equal(f.draft().journey_step, "staff");
    assert.equal(f.dates.length, 0);
});

test("exclusive and premium remain distinct and only owned categories appear", async () => {
    for (const routes of [["exclusive"], ["premium"], ["exclusive", "premium"], ["weekday", "weekend", "exclusive", "premium"]]) {
        const f = fixture({ allowed_routes: routes });
        await f.journey.begin("customer"); await f.journey.select("customer", "RETURNING");
        await f.journey.select("customer", "HAS_PACKAGE"); await f.journey.select("customer", "PUBLIC");
        assert.deepEqual(f.menus.at(-1).map(row => row.id), routes.map(route => "JOURNEY_" + route.toUpperCase()));
    }
});

test("Unlimited is selectable only by holders, every day at all three session times", async () => {
    for (const chinese of [false, true]) {
        const f = fixture({ allowed_routes: ['unlimited'] }, chinese);
        await f.journey.begin('customer');
        await f.journey.select('customer', 'RETURNING');
        await f.journey.select('customer', 'HAS_PACKAGE');
        await f.journey.select('customer', 'PUBLIC');
        assert.deepEqual(f.menus.at(-1).map(row => row.id), ['JOURNEY_UNLIMITED']);
        await f.journey.select('customer', 'UNLIMITED');
        assert.deepEqual(f.dates, ['unlimited']);
    }
    const other = fixture({ allowed_routes: ['premium'] });
    await other.journey.begin('customer');
    await other.journey.select('customer', 'RETURNING');
    await other.journey.select('customer', 'HAS_PACKAGE');
    await other.journey.select('customer', 'PUBLIC');
    assert.ok(!other.menus.at(-1).some(row => row.id === 'JOURNEY_UNLIMITED'));
    await other.journey.select('customer', 'UNLIMITED');
    assert.deepEqual(other.dates, []);
    for (let day = 5; day <= 11; day++) {
        assert.equal(schedule.isRouteDateAllowed(`2026-10-${String(day).padStart(2,'0')}`, 'unlimited'), true);
    }
    assert.deepEqual(schedule.startTimes, ['12:00', '14:00', '16:00']);
    assert.equal(schedule.durationMinutes, 90);
});
test("first-time public visitors use weekdays and weekends at all three session times", async () => {
    const f = fixture(); await f.journey.begin("customer");
    await f.journey.select("customer", "FIRST");
    await f.journey.select("customer", "PUBLIC");
    assert.deepEqual(f.dates, ["first_public"]);
    assert.equal(schedule.isRouteDateAllowed("2026-10-08", "first_public"), true);
    assert.equal(schedule.isRouteDateAllowed("2026-10-09", "first_public"), true);
    assert.deepEqual(schedule.startTimes, ["12:00", "14:00", "16:00"]);
});
test("package category buttons and selections enforce verified entitlements", async () => {
    const f = fixture({ allowed_routes: ["weekend"] });
    await f.journey.begin("customer"); await f.journey.select("customer", "RETURNING");
    await f.journey.select("customer", "HAS_PACKAGE"); await f.journey.select("customer", "PUBLIC");
    assert.deepEqual(f.menus.at(-1).map(row => row.id), ["JOURNEY_WEEKEND"]);
    await f.journey.select("customer", "PREMIUM"); assert.equal(f.dates.length, 0);
    assert.equal(f.draft().journey_step, "first");
    await f.journey.select("customer", "RETURNING");
    await f.journey.select("customer", "HAS_PACKAGE");
    await f.journey.select("customer", "PUBLIC");
    await f.journey.select("customer", "WEEKEND"); assert.deepEqual(f.dates, ["weekend"]);
    assert.equal(schedule.isRouteDateAllowed("2026-10-09", "weekend"), true);
    assert.equal(schedule.isRouteDateAllowed("2026-10-08", "weekend"), false);
});
test("declining package purchase sends a private request to staff in both languages", async () => {
    for (const chinese of [false, true]) {
        for (const answer of ["HAS_PACKAGE", "NO_PACKAGE"]) {
            const f = fixture(null, chinese); await f.journey.begin("customer");
            await f.journey.select("customer", "RETURNING"); await f.journey.select("customer", answer);
            assert.match(f.menus.at(-1).find(row => row.id === "JOURNEY_NO_BUY").title, chinese ? /私人/ : /private/);
            assert.equal(f.images.at(-1), "https://example.test/CeremonyPrices.jpg");
            await f.journey.select("customer", "NO_BUY");
            assert.deepEqual(f.dates, []);
            assert.equal(f.draft().journey_step, "staff");
            assert.equal(f.draft().booking_route, undefined);
            assert.equal(f.staff.length, 1);
            assert.match(f.staff[0][1], /private tea session/);
            assert.equal(f.messages.at(-1), chinese
                ? "感谢您的关注，工作人员会尽快回复您，协助安排您的私人场次。\n\n我们的工作时间为新加坡时间12:00pm至5:30pm。"
                : "Thank you for your interest, a Staff member will reply as soon as possible to help arrange your private session.\n\nOur working hours are 12:00pm to 5:30pm Singapore Time.");
            await f.journey.select("customer", "NO_BUY");
            assert.equal(f.staff.length, 1);
        }
    }
});
test("private requests and package purchases go to staff without opening booking dates", async () => {
    const f = fixture(); await f.journey.begin("customer");
    await f.journey.select("customer", "FIRST"); await f.journey.select("customer", "PRIVATE");
    assert.equal(f.staff.length, 1); assert.equal(f.dates.length, 0);
    await f.journey.begin("customer"); await f.journey.select("customer", "RETURNING");
    await f.journey.select("customer", "NO_PACKAGE"); await f.journey.select("customer", "BUY");
    assert.equal(f.staff.length, 2); assert.equal(f.dates.length, 0);
});


test("expired journey selection immediately restarts booking", async () => {
    for (const chinese of [false, true]) {
        const f = fixture(null, chinese);
        await f.journey.begin("customer");
        await f.journey.select("customer", "PUBLIC");
        assert.equal(f.menus.at(-1)[0].id, "JOURNEY_FIRST");
        await f.journey.select("customer", "RESTART");
        assert.equal(f.draft().journey_step, "first");
        assert.equal(f.menus.at(-1)[0].id, "JOURNEY_FIRST");
    }
});


test("first trial pricing includes weekday and weekend usual prices in both languages", async () => {
    for (const chinese of [false, true]) {
        const f = fixture(null, chinese);
        await f.journey.begin("customer");
        await f.journey.select("customer", "FIRST");
        const text = f.texts.at(-1);
        for (const price of ["$68", "$128", "$88", "$148"]) assert.ok(text.includes(price));
        if (!chinese) {
            assert.ok(text.indexOf('For First time visitors, you may enjoy a discounted promotion price.') < text.indexOf('Promotion $68 Public session'));
            assert.equal(f.menus.at(-1)[0].title, 'Promo $68 Public');
        }
    }
});
