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
test("customer follow-ups during staff handover are forwarded without automated replies", async () => {
    const forwarded = [];
    const run = handler("handleTextMessage", {
        staffHandover: { isActive: () => true },
        notifyStaff: async (...args) => forwarded.push(args),
        sendMessage: async () => assert.fail("No automated acknowledgement"),
        sendContactNavigation: async () => assert.fail("No automated menu"),
        sendFAQDocument: async () => assert.fail("No FAQ during handover")
    });
    for (const text of ["A follow-up question?", "Thank you", "Hello, can you clarify the price?", "好的，谢谢"]) {
        await run("customer", { text: { body: text } });
    }
    assert.equal(forwarded.length, 4);
    assert.equal(forwarded[0][1], "A follow-up question?");
});
test("greetings can reopen the chatbot during staff handover", async () => {
    let menus = 0;
    const run = handler("handleTextMessage", {
        staffHandover: { isActive: () => true },
        getLanguage: () => "en", userLanguages: { customer: "en" },
        sendLanguageMenu: async () => { menus++; },
        notifyStaff: async () => assert.fail("Greetings should reopen the chatbot")
    });
    for (const text of ["Hi", "Hello!", "hey", "good morning", "你好", "您好！"]) {
        await run("customer", { text: { body: text } });
    }
    assert.equal(menus, 6);
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
    assert.equal((source.match(/https:\/\/waba-v2\.360dialog\.io\/messages/g) || []).length, 19);
    assert.equal((source.match(/postWhatsApp\(\s*"https:\/\/waba-v2\.360dialog\.io\/messages"/g) || []).length, 19);
    assert.ok(!/axios\.post\([^\n]*messages/.test(source));
});

test("FAQs send Supabase links and matching filenames in both languages", async () => {
    for (const language of ['en','zh']) {
        const sends=[];
        const run=handler('sendFAQDocument',{
            images:{faqEnglish:'https://example.test/FAQ.pdf',faqChinese:'https://example.test/FAQChinese.pdf'},
            getLanguage:()=>language, process:{env:{}},
            postWhatsApp:async (...args)=>sends.push(args),
            sendMessage:async(to,text)=>assert.ok(text.startsWith(language==='zh'?'常见问题':'Frequently asked questions'))
        });
        await run('customer');
        const doc=sends[0][1].document;
        assert.equal(doc.filename,language==='zh'?'FAQChinese.pdf':'FAQ.pdf');
        assert.equal(doc.link,'https://example.test/'+doc.filename);
        assert.equal(doc.id,undefined);
    }
});
test("Directions sends the configured PDF to the customer",async()=>{
    const run=handler('handleDirections',{
        images:{directionsPDF:'https://example.test/directions.pdf'},getLanguage:()=> 'en',process:{env:{}},
        postWhatsApp:async(url,payload)=>{assert.equal(payload.to,'customer');assert.equal(payload.document.link,'https://example.test/directions.pdf');}
    });await run('customer');
});
test("Things to Note sends notes, introduction video, then the menu",async()=>{
    const order=[];
    const run=handler('handleThingsToNote',{
        getLanguage:()=> 'en',sendMessage:async()=>order.push('notes'),
        sendIntroductionVideo:async()=>order.push('video'),sleep:async()=>{},sendMainMenu:async()=>order.push('menu')
    });await run('customer');assert.deepEqual(order,['notes','video','menu']);
});
test("introduction video includes bilingual captions and propagates delivery failure",async()=>{
    for(const language of ['en','zh']) {
        const run=handler('sendIntroductionVideo',{
            images:{introductionVideo:'https://example.test/intro.mp4'},getLanguage:()=>language,process:{env:{}},
            postWhatsApp:async(url,payload)=>{
                assert.equal(payload.video.link,'https://example.test/intro.mp4');
                assert.equal(payload.video.caption,language==='zh'?'您可以观看附上的视频，全面了解茶道。':'You can watch the attached video for a thorough introduction to Tea Ceremony');
                throw new Error('send failed');
            }
        });await assert.rejects(run('customer'),/send failed/);
    }
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
