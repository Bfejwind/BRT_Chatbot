const test=require('node:test');
const assert=require('node:assert/strict');
const {createPrivateCalendarWorker}=require('../privateBookings');
function fixture(status='approved'){
    const calls=[];const booking={id:'private',status,customer_phone:'6590000000'};
    const db={from:()=>({
        select:columns=>({eq:()=>{
            if(columns==='status')return {maybeSingle:async()=>({data:{status:booking.status}})};
            return {order:()=>({limit:async()=>({data:[booking]})})};
        }}),
        update:value=>({eq:(key,id)=>({eq:async(statusKey,statusValue)=>{
            calls.push({value,key,id,statusKey,statusValue});return {};
        }})})
    })};
    return {db,calls,booking};
}
test('calendar synchronization is guarded against a concurrent cancellation',async()=>{
    const f=fixture();let syncs=0;
    const run=createPrivateCalendarWorker({...f,synchronize:async b=>{assert.equal(b,f.booking);syncs++;return 'private-event';}});
    await Promise.all([run(),run()]);assert.equal(syncs,1);assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].statusValue,'approved');assert.equal(f.calls[0].value.calendar_sync_status,'synced');
});
test('cancelled private bookings run calendar deletion and keep cancellation guard',async()=>{
    const f=fixture('cancelled');await createPrivateCalendarWorker({...f,synchronize:async b=>{assert.equal(b.status,'cancelled');return 'private-event';}})();assert.equal(f.calls[0].statusValue,'cancelled');
});
test('calendar failure keeps the booking pending and shows a safe staff error',async()=>{
    const f=fixture();await createPrivateCalendarWorker({...f,logger:{error(){}},synchronize:async()=>{throw new Error('credential detail');}})();assert.ok(f.calls[0].value.calendar_error);assert.equal(f.calls[0].value.calendar_sync_status,undefined);assert.ok(!f.calls[0].value.calendar_error.includes('credential detail'));
});
