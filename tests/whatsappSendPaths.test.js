const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/../server.js`, "utf8");

function handler(name, globals) {
    const start = source.indexOf(`async function ${name}(`);
    const next = source.indexOf("\nasync function ", start + 1);
    const context = vm.createContext({ console: { log() {}, error() {} }, ...globals });
    vm.runInContext(source.slice(start, next), context);
    return context[name];
}

test("confirmed bookings send staff the date, exact hours, package and party size", async () => {
    const sends = [];
    const notify = handler("sendConfirmedBookingToStaff", {
        process: { env: { STAFF_PHONE_NUMBER: "6580583517" } },
        BOOKING_CONFIG: require("../bookingSchedule"),
        sendMessage: async (...args) => sends.push(args)
    });
    for (const route of ["weekday", "weekend", "exclusive", "premium", "first_public"]) {
        await notify("6591234567", { id: "booking", booking_date: "2026-10-08", booking_time: "16:00", party_size: 3 }, route);
        const [recipient, body] = sends.at(-1);
        assert.equal(recipient, "6580583517");
        assert.ok(body.includes("Date: 2026-10-08"));
        assert.ok(body.includes(require("../bookingSchedule").formatSessionHours("16:00", false)));
        assert.ok(body.includes("Number of people: 3"));
        assert.ok(body.includes(route === "first_public" ? "$68 promotional" : route[0].toUpperCase() + route.slice(1)));
    }
});
test("staff notification failure reaches the webhook instead of claiming success", async () => {
    const error = new Error("rate limit exhausted");
    const notify = handler("notifyStaff", {
        getLanguage: () => "en", process: { env: { STAFF_PHONE_NUMBER: "staff" } },
        sendMessage: async () => { throw error; }
    });
    await assert.rejects(notify("customer", "question"), e => e === error);
});

test("booking handlers propagate delivery failures without sending a misleading fallback", async () => {
    const error = Object.assign(new Error("rate limit exhausted"), { isWhatsAppSendError: true });
    for (const name of ["handleBookingConfirm", "handleBookingPartySize"]) {
        let sends = 0;
        const run = handler(name, {
            getLanguage: () => "en", getDraft: async () => null,
            sendMessage: async () => { sends++; throw error; }
        });
        await assert.rejects(run("customer", "BOOK_SIZE_2"), e => e === error);
        assert.equal(sends, 1);
    }
});

test("every active server message request uses the shared sender", () => {
    assert.equal((source.match(/https:\/\/waba-v2\.360dialog\.io\/messages/g) || []).length, 17);
    assert.equal((source.match(/postWhatsApp\(\s*"https:\/\/waba-v2\.360dialog\.io\/messages"/g) || []).length, 17);
    assert.ok(!/axios\.post\([^\n]*messages/.test(source));
});

test("FAQ uploads the bundled PDF through 360dialog and sends its media ID", async () => {
    const uploads = [], sends = [];
    const run = handler("sendFAQDocument", {
        __dirname: "project", path: require("node:path"), FormData, Blob,
        process: { env: { WHATSAPP_API_KEY: "test-key" } },
        readFile: async file => {
            assert.equal(file, require("node:path").join("project", "FAQ", "FAQ.pdf"));
            return Buffer.from("test PDF");
        },
        axios: { post: async (...args) => {
            uploads.push(args);
            return { data: { id: "pdf-media" } };
        } },
        postWhatsApp: async (...args) => sends.push(args),
        getLanguage: () => "en",
        sendMessage: async (to, text) => {
            assert.equal(sends.length, 1);
            assert.equal(to, "customer");
            assert.ok(text.startsWith("Frequently asked questions are answered in this file above"));
        }
    });
    await run("customer");
    assert.equal(uploads[0][0], "https://waba-v2.360dialog.io/media");
    assert.equal(uploads[0][2].headers["D360-API-KEY"], "test-key");
    assert.equal(sends[0][1].document.id, "pdf-media");
    assert.equal(sends[0][1].document.filename, "FAQ.pdf");
    assert.equal(sends[0][1].to, "customer");
});

test("Chinese FAQ reads, uploads and sends 常见问题.pdf with Chinese instructions", async () => {
    const run = handler("sendFAQDocument", {
        __dirname: "project", path: require("node:path"), FormData, Blob,
        process: { env: {} }, getLanguage: () => "zh",
        readFile: async file => {
            assert.equal(file, require("node:path").join("project", "FAQ", "常见问题.pdf"));
            return Buffer.from("Chinese PDF");
        },
        axios: { post: async (url, form) => {
            assert.equal(form.get("file").name, "常见问题.pdf");
            return { data: { id: "chinese-pdf" } };
        } },
        postWhatsApp: async (url, payload) => {
            assert.equal(payload.document.filename, "常见问题.pdf");
            assert.equal(payload.document.id, "chinese-pdf");
        },
        sendMessage: async (to, text) => {
            assert.equal(to, "customer");
            assert.ok(text.startsWith("常见问题"));
        }
    });
    await run("customer");
});

test("FAQ upload without a media ID fails before sending a document", async () => {
    const run = handler("sendFAQDocument", {
        __dirname: "project", path: require("node:path"), FormData, Blob,
        process: { env: {} }, getLanguage: () => "en", readFile: async () => Buffer.from("test PDF"),
        axios: { post: async () => ({ data: {} }) },
        postWhatsApp: async () => assert.fail("must not send without a media ID")
    });
    await assert.rejects(run("customer"), /did not return a media ID/);
});

test("reminder tests use the approved customer's booking and template", async () => {
    const booking = { customer_phone: "customer", status: "approved" };
    const sends = [];
    const run = handler("handleReminderTest", {
        getBookingById: async () => booking, getLanguage: () => "en",
        process: { env: { WHATSAPP_REMINDER_TEMPLATE: "tea_session_reminder" } },
        reminderPayload: (value, config) => {
            assert.equal(value, booking);
            assert.equal(config.template, "tea_session_reminder");
            return { to: value.customer_phone, type: "template" };
        },
        postWhatsApp: async (...args) => sends.push(args),
        sendMessage: async () => assert.fail("valid test should send the template")
    });
    await run("customer", "booking-id");
    assert.equal(sends.length, 1);
    assert.equal(sends[0][1].to, "customer");
});

test("another customer cannot trigger a reminder test for someone else's booking", async () => {
    let replies = 0;
    const run = handler("handleReminderTest", {
        getBookingById: async () => ({ customer_phone: "owner", status: "approved" }),
        getLanguage: () => "en", sendMessage: async () => replies++,
        postWhatsApp: async () => assert.fail("must not send another customer's reminder")
    });
    await run("other", "booking-id");
    assert.equal(replies, 1);
});

test("booking window spans three calendar months and clamps month ends", () => {
    const context = vm.createContext({ BOOKING_CONFIG: require("../bookingSchedule") });
    vm.runInContext(source.slice(source.indexOf("function getBookingDates("),
        source.indexOf("async function sendAvailableDates(")), context);
    assert.equal(context.getBookingDates(new Date("2026-10-05T00:00:00+08:00")).at(-1), "2027-01-05");
    assert.equal(context.getBookingDates(new Date("2026-11-30T00:00:00+08:00")).at(-1), "2027-02-28");
});
