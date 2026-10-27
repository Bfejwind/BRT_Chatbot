const test=require('node:test');
const assert=require('node:assert/strict');
const draft=require('../reminderDraft');
const active=require('../reminderTemplates');
test('Chinese reminder draft matches the requested wording and keeps the existing PDF',()=>{
    const [en,zh]=draft.preview({booking_date:'2026-10-30',booking_time:'16:00:00'});
    assert.ok(zh.startsWith('尊敬的茶友：'));
    assert.ok(zh.includes('4:15pm - 4:30pm：茶荟介绍及入座静待茶荟开始'));
    assert.ok(zh.includes('避免饮酒。活动前1小时请避免进食。'));
    assert.ok(zh.includes('茶荟可能流汗，若必要请自行携带更换的衣物。'));
    assert.ok(zh.includes('●请避免使用香水。'));
    assert.ok(en.includes('alcohol. Please avoid eating for 1 hour'));
    assert.ok(en.includes('Bring a change of clothes'));
    for(const d of draft.definitions){assert.ok(d.components.find(c=>c.type==='BODY').text.length<=1024);}
    assert.deepEqual(draft.definitions[2],active.definitions[2]);
    assert.equal(draft.DIRECTIONS_PDF,active.DIRECTIONS_PDF);
    assert.equal(active.definitions[0].name,'tea_session_reminder_full_en_v2');
});
test('draft times remain dynamic for private sessions',()=>{
    const [en,zh]=draft.preview({booking_date:'2026-10-30',booking_time:'10:00:00'});
    assert.ok(en.includes('10:00am - 10:15am: Registration'));
    assert.ok(en.includes('10:30am: Tea Session begins'));
    assert.ok(en.includes('tomorrow morning!'));assert.ok(zh.includes('明天上午见！'));
});
test('revised English preserves owner wording and blank lines between reminders',()=>{
    const [en]=draft.preview({booking_date:'2026-10-30',booking_time:'16:00:00'});
    assert.ok(en.includes('tomorrow’s schedule:'));
    assert.ok(en.includes('4:00pm - 4:15pm: Registration \n4:15pm - 4:30pm: Tea Session introduction;'));
    assert.ok(en.includes('Please wear socks for the session.\n \n●Avoid'));
    assert.ok(en.includes('Bring a change of clothes if needed. \n\n●Please avoid wearing perfume. \n\nSee you tomorrow afternoon!'));
});
test('full_v3 payloads use six variables and the unchanged PDF template',()=>{
    const {reminderSequence,getDefinitions}=require('../reminderTemplates');
    const booking={customer_phone:'6582064900',booking_date:'2026-10-30',booking_time:'16:00:00'};
    const sequence=reminderSequence(booking,'full_v3');
    assert.deepEqual(sequence.map(p=>p.template.name),['tea_session_reminder_full_en_v3','tea_session_reminder_full_zh_v3','tea_session_directions_v2']);
    assert.equal(sequence[0].template.components[0].parameters.length,6);
    assert.equal(sequence[1].template.components[0].parameters[5].text,'下午');
    assert.equal(sequence[2].template.components[0].parameters[0].document.link,active.DIRECTIONS_PDF);
    assert.equal(getDefinitions('full_v3'),draft.definitions);
});

test('v4 uses Guests and spaced Chinese bullets while preserving v3 jobs and directions',()=>{
 const v4=require('../reminderRevision4');const booking={customer_phone:'6582064900',booking_date:'2026-10-27',booking_time:'16:00'};
 const [en,zh]=v4.preview(booking);assert.ok(en.startsWith('Dear Guests,\n\n'));assert.ok(!en.includes('Tea Friends'));
 assert.ok(zh.includes('茶荟时间请穿袜子。\n\n●请避免食用'));assert.ok(zh.includes('活动前1小时请避免进食。\n\n●茶荟可能流汗'));assert.ok(zh.includes('●请避免使用香水。\n\n明天下午见！'));
 assert.deepEqual(active.reminderSequence(booking,'full_v4').map(p=>p.template.name),['tea_session_reminder_full_en_v4','tea_session_reminder_full_zh_v4','tea_session_directions_v2']);
 assert.equal(active.reminderSequence(booking,'full_v3')[0].template.name,'tea_session_reminder_full_en_v3');assert.deepEqual(v4.definitions[2],draft.definitions[2]);
});
