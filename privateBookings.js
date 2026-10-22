function createPrivateCalendarWorker({db,synchronize,logger=console}) {
    let running=false;
    return async function run() {
        if(running)return;
        running=true;
        try {
            const {data,error}=await db.from('staff_private_bookings').select('*')
                .eq('calendar_sync_status','pending').order('created_at').limit(100);
            if(error)throw error;
            for(const b of data||[]) {
                try {
                    const eventId=await synchronize(b);
                    const current=await db.from('staff_private_bookings').select('status').eq('id',b.id).maybeSingle();
                    if(current.error)throw current.error;
                    // Another instance may have completed cancellation while this
                    // event insert was in flight. Delete the late insert as well.
                    if(b.status==='approved'&&current.data?.status==='cancelled') {
                        await synchronize({...b,status:'cancelled'});
                        const removed=await db.from('staff_private_bookings').update({
                            calendar_event_id:eventId,calendar_sync_status:'synced',calendar_error:null
                        }).eq('id',b.id).eq('status','cancelled');
                        if(removed.error)throw removed.error;
                        continue;
                    }
                    // A concurrent cancellation must retain its pending deletion.
                    const result=await db.from('staff_private_bookings').update({
                        calendar_event_id:eventId,calendar_sync_status:'synced',calendar_error:null
                    }).eq('id',b.id).eq('status',b.status);
                    if(result.error)throw result.error;
                }catch(error){
                    logger.error('Private booking calendar sync failed',b.id,error.code||'CALENDAR_ERROR');
                    const result=await db.from('staff_private_bookings').update({calendar_error:'Calendar synchronization failed. Check for an overlapping event or calendar access.'}).eq('id',b.id).eq('status',b.status);
                    if(result.error)logger.error('Private booking error could not be saved',b.id);
                }
            }
        }catch(error){logger.error('Private booking worker unavailable',error.code||error.message);}
        finally{running=false;}
    };
}
module.exports={createPrivateCalendarWorker};
