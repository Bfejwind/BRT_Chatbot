const MAX_AGE_MS = 15 * 60 * 1000;

function reminderTestSelection(message) {
    if (message.type !== "interactive") return null;
    const id = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id;
    return typeof id === "string" && id.startsWith("REMINDER_TEST_") ? id : null;
}

function shouldSkipReminderTest(message, now = Date.now()) {
    if (!reminderTestSelection(message)) return false;
    const timestamp = Number(message.timestamp) * 1000;
    // Without a valid timestamp we cannot establish that the click is recent.
    return !Number.isFinite(timestamp) || timestamp <= 0 ||
        now - timestamp > MAX_AGE_MS || timestamp - now > 30 * 1000;
}

module.exports = { reminderTestSelection, shouldSkipReminderTest };
