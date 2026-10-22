const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldSkipReminderTest } = require("../reminderTestGuard");
const now = Date.parse("2026-10-09T21:00:00Z");
const click = timestamp => ({
    type: "interactive", timestamp,
    interactive: { button_reply: { id: "REMINDER_TEST_booking-1" } }
});

test("recent reminder tests work; delayed tests expire after fifteen minutes", () => {
    assert.equal(shouldSkipReminderTest(click(now / 1000), now), false);
    assert.equal(shouldSkipReminderTest(click(now / 1000 - 900), now), false);
    assert.equal(shouldSkipReminderTest(click(now / 1000 - 901), now), true);
    assert.equal(shouldSkipReminderTest(click(now / 1000 - 8 * 3600), now), true);
});

test("missing, invalid and future timestamps cannot trigger reminder tests", () => {
    for (const timestamp of [undefined, null, "", "invalid", "0", "-1", now / 1000 + 31]) {
        assert.equal(shouldSkipReminderTest(click(timestamp), now), true);
    }
});

test("other customer messages and booking confirmations are unaffected", () => {
    assert.equal(shouldSkipReminderTest({ type: "text" }, now), false);
    assert.equal(shouldSkipReminderTest({ type: "interactive",
        interactive: { button_reply: { id: "BOOK_CONFIRM" } } }, now), false);
    assert.equal(shouldSkipReminderTest({ type: "interactive",
        interactive: { list_reply: { id: "REMINDER_TEST_booking-1" } },
        timestamp: now / 1000 - 901 }, now), true);
});
