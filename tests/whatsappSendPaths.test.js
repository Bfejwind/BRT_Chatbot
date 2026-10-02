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
    assert.equal((source.match(/https:\/\/waba-v2\.360dialog\.io\/messages/g) || []).length, 13);
    assert.equal((source.match(/postWhatsApp\(\s*"https:\/\/waba-v2\.360dialog\.io\/messages"/g) || []).length, 13);
    assert.ok(!source.includes("axios.post("));
});
