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
    assert.equal((source.match(/https:\/\/waba-v2\.360dialog\.io\/messages/g) || []).length, 14);
    assert.equal((source.match(/postWhatsApp\(\s*"https:\/\/waba-v2\.360dialog\.io\/messages"/g) || []).length, 14);
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
        postWhatsApp: async (...args) => sends.push(args)
    });
    await run("customer");
    assert.equal(uploads[0][0], "https://waba-v2.360dialog.io/media");
    assert.equal(uploads[0][2].headers["D360-API-KEY"], "test-key");
    assert.equal(sends[0][1].document.id, "pdf-media");
    assert.equal(sends[0][1].document.filename, "FAQ.pdf");
    assert.equal(sends[0][1].to, "customer");
});

test("FAQ upload without a media ID fails before sending a document", async () => {
    const run = handler("sendFAQDocument", {
        __dirname: "project", path: require("node:path"), FormData, Blob,
        process: { env: {} }, readFile: async () => Buffer.from("test PDF"),
        axios: { post: async () => ({ data: {} }) },
        postWhatsApp: async () => assert.fail("must not send without a media ID")
    });
    await assert.rejects(run("customer"), /did not return a media ID/);
});
