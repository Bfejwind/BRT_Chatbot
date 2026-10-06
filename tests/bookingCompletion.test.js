const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompletionWorker } = require('../bookingCompletion');
function setup(failure) {
    let job = {booking_id:'booking',request_id:'receipt',stage:'calendar',status:'pending'};
    const calls=[];
    let failed=false;
    const work = name => async () => {
        calls.push(name);
        if (failure?.stage===name && !failed) { failed=true; throw failure.error; }
    };
    const run = createCompletionWorker({
        store:{
            claim:async()=>job.status==='pending' && !job.wait ? {...job,status:'sending'} : null,
            getBooking:async()=>({status:'approved'}),
            finish:async(previous,stage,status,error,outcomes)=>{job={...job,...outcomes,stage,status,wait:!!error};}
        }, synchronize:work('calendar'),sendCustomer:work('customer'),sendStaff:work('staff')
    });
    return {run,calls,job:()=>job,retry:()=>{job.wait=false;}};
}
test('calendar failure resumes the existing reservation before sending confirmations', async()=>{
    const f=setup({stage:'calendar',error:new Error('calendar unavailable')});
    await f.run();assert.equal(f.job().status,'pending');assert.deepEqual(f.calls,['calendar']);
    f.retry();await f.run();assert.deepEqual(f.calls,['calendar','calendar','customer','staff']);assert.equal(f.job().status,'done');
});
test('staff API rejection retries staff only, without resending customer confirmation',async()=>{
    const f=setup({stage:'staff',error:Object.assign(new Error('window closed'),{response:{status:400}})});
    await f.run();assert.equal(f.job().stage,'staff');f.retry();await f.run();
    assert.deepEqual(f.calls,['calendar','customer','staff','staff']);assert.equal(f.job().status,'done');
});
test('ambiguous message timeouts are recorded for review instead of blindly duplicated',async()=>{
    const f=setup({stage:'staff',error:new Error('timeout')});await f.run();
    assert.equal(f.job().status,'unknown');f.retry();await f.run();assert.equal(f.calls.filter(x=>x==='staff').length,1);
});
test('customer send failure does not block staff notification',async()=>{
    const f=setup({stage:'customer',error:new Error('timeout')});await f.run();
    f.retry();await f.run();assert.deepEqual(f.calls,['calendar','customer','staff']);
    assert.equal(f.job().customer_status,'unknown');assert.equal(f.job().staff_status,'done');
});
