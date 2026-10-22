const test=require('node:test');
const assert=require('node:assert/strict');
const {definitions,reminderSequence,ADDRESS,DIRECTIONS_PDF}=require('../reminderTemplates');
const {createReminderWorker}=require('../bookingReminders');
const booking={id:'b',session_id:'s',customer_phone:'6590000000',status:'approved',booking_date:'2026-10-30',booking_time:'10:30:00'};
test('full reminder preserves the requested content and shifts all private booking times',()=>{
    for(const d of definitions){const body=d.components.find(c=>c.type==='BODY');assert.ok(body.text.length<=1024);}
    const sequence=reminderSequence(booking);
    assert.equal(sequence.length,3);
    assert.deepEqual(sequence[0].template.components[0].parameters.map(p=>p.text),['10:30 AM','10:45 AM','10:45 AM','11:00 AM','11:00 AM','11:00 AM','morning']);
    assert.ok(sequence[1].template.components[0].parameters[0].text.includes('10:30'));
    assert.equal(sequence[1].template.components[0].parameters[6].text,'上午');
    assert.equal(sequence[2].template.components[0].parameters[0].document.link,DIRECTIONS_PDF);
    assert.ok(definitions[2].components[1].text.includes(ADDRESS));
    assert.ok(definitions[0].components[0].text.includes('Wear socks'));
    assert.ok(definitions[1].components[0].text.includes('香水'));
});
test('partial API rejection resumes without duplicating accepted English',async()=>{
    let currentParts={},claimed=false,attempt=0;const sends=[],outcomes=[];
    const store={claim:async()=>claimed?null:(claimed=true,{booking_id:'b',session_id:'s',booking_date:booking.booking_date,booking_time:booking.booking_time,delivery_parts:currentParts}),getBooking:async()=>booking,saveParts:async(_,parts)=>{currentParts={...parts};},finish:async(_,status)=>outcomes.push(status)};
    const run=createReminderWorker({store,config:{format:'full_v2'},now:()=>new Date('2026-10-29T03:00:00Z'),logger:{error(){}},send:async p=>{sends.push(p.template.name);if(attempt++===1)throw {response:{status:400,data:{error:{code:132001}}}};return {messages:[{id:'message-'+attempt}]};}});
    await run();assert.deepEqual(outcomes,['failed']);claimed=false;
    await run();assert.deepEqual(outcomes,['failed','accepted']);
    assert.equal(sends.filter(n=>n===definitions[0].name).length,1);
    assert.equal(Object.keys(currentParts).length,3);
});
test('uncertain checkpoint outcome never continues to the next message',async()=>{
    let claimed=false,sends=0;const outcomes=[];
    const run=createReminderWorker({store:{claim:async()=>claimed?null:(claimed=true,{booking_id:'b',session_id:'s',booking_date:booking.booking_date,booking_time:booking.booking_time}),getBooking:async()=>booking,saveParts:async()=>{throw new Error('Database unavailable');},finish:async(_,status)=>outcomes.push(status)},config:{format:'full_v2'},now:()=>new Date('2026-10-29T03:00:00Z'),logger:{error(){}},send:async()=>{sends++;return {messages:[{id:'accepted'}]};}});
    await run();assert.equal(sends,1);assert.deepEqual(outcomes,['unknown']);
});
