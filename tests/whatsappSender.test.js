const test = require("node:test");
const assert = require("node:assert/strict");
const { createWhatsAppSender } = require("../whatsappSender");

function fixture(post) {
    let time = 1000;
    const calls = [];
    const sender = createWhatsAppSender({
        now: () => time, sleep: async ms => { time += ms; }, warn: () => {},
        post: async (...args) => {
            calls.push({ time, payload: args[1] });
            return post ? post(...args) : { data: { messages: [{ id: "sent" }] } };
        }
    });
    return { calls, send: to => sender("endpoint", { to }) };
}

test("paces concurrent image/menu sends to one recipient and channel sends", async () => {
    const f = fixture();
    await Promise.all([f.send("a"), f.send("a"), f.send("b")]);
    assert.deepEqual(f.calls.map(c => c.time), [1000, 7500, 8600]);
});

test("retries the rejected menu without resending the successful banner", async () => {
    let attempts = 0;
    const f = fixture(() => {
        if (++attempts === 2) throw { response: { status: 400,
            data: { error: "Too many requests for one number" },
            headers: { "retry-after": "40" } } };
        return "ok";
    });
    await f.send("a");
    assert.equal(await f.send("a"), "ok");
    assert.deepEqual(f.calls.map(c => c.time), [1000, 7500, 47500]);
});

test("exhausted retries reject and leave the queue usable", async () => {
    let limited = true;
    const error = { response: { status: 429 } };
    const f = fixture(() => { if (limited) throw error; return "ok"; });
    await assert.rejects(f.send("a"), e => e === error);
    assert.equal(f.calls.length, 4);
    limited = false;
    assert.equal(await f.send("b"), "ok");
});

test("does not retry authentication failures or ambiguous network failures", async () => {
    for (const error of [{ response: { status: 401 } }, new Error("timeout")]) {
        const f = fixture(() => { throw error; });
        await assert.rejects(f.send("a"), e => e === error);
        assert.equal(f.calls.length, 1);
    }
});
