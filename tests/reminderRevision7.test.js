const test = require('node:test');
const assert = require('node:assert/strict');
const previous = require('../reminderRevision6');
const revision = require('../reminderRevision7');
const { reminderSequence, getDefinitions } = require('../reminderTemplates');

test('v7 replaces both timelines and duplicate arrival lines while preserving directions and older revisions', () => {
    for (const [time, period] of [['09:00', 'morning'], ['14:00', 'afternoon'], ['19:00', 'evening']]) {
        const booking = { customer_phone: 'customer', booking_date: '2026-11-12', booking_time: time };
        const [en, zh] = revision.preview(booking);
        assert.ok(en.includes('🕰️ Please arrive 10–20 minutes before your session to allow time for registration and use of the restroom.'));
        assert.ok(!en.includes('Registration \n'));
        assert.ok(!en.includes('Session begins'));
        assert.ok(!en.includes('Please arrive 20 minutes early.'));
        assert.ok(en.includes(`See you tomorrow ${period}!`));
        assert.ok(zh.includes('🕰️ 请于茶荟开始前10–20分钟抵达，以便签到及使用洗手间。'));
        assert.ok(!zh.includes('请提前20分钟抵达。'));
        assert.ok(!zh.includes('茶荟正式开始'));
        assert.ok(zh.includes(`明天${{morning:'上午',afternoon:'下午',evening:'晚上'}[period]}见！`));
        const payloads = reminderSequence(booking, 'full_v7');
        assert.equal(payloads[0].template.name, 'tea_session_reminder_full_en_v7');
        assert.deepEqual(payloads[0].template.components[0].parameters, [{ type: 'text', text: period }]);
        assert.equal(payloads[1].template.name, 'tea_session_reminder_full_zh_v7');
        assert.deepEqual(payloads[1].template.components[0].parameters, [{type:'text',text:{morning:'上午',afternoon:'下午',evening:'晚上'}[period]}]);
        assert.deepEqual(payloads[2], previous.sequence(booking)[2]);
        assert.equal(reminderSequence(booking, 'full_v6')[0].template.name, 'tea_session_reminder_full_en_v6');
    }
    assert.equal(getDefinitions('full_v7'), revision.definitions);
    assert.deepEqual(revision.definitions[0].components[0].example.body_text, [['afternoon']]);
    assert.deepEqual(revision.definitions[1].components[0].example.body_text, [['下午']]);
    assert.ok(revision.definitions[0].components[0].text.length <= 1024);
});
