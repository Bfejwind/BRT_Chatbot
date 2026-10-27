// Read-only aggregate monitoring. Never retries jobs or sends messages.
require('dotenv').config({quiet:true});
async function inspectOperations(db,now=Date.now()){
 const stale=new Date(now-15*60_000).toISOString(),checks=[];
 const queries=[['booking_reminders','failed'],['booking_reminders','unknown'],['staff_private_reminders','failed'],['staff_private_reminders','unknown'],['booking_completion_jobs','unknown']];
 for(const [table,status] of queries){const r=await db.from(table).select('*',{count:'exact',head:true}).eq('status',status);checks.push({table,condition:status,count:r.count??null,error:!!r.error});}
 for(const table of ['booking_reminders','staff_private_reminders','booking_completion_jobs']){const r=await db.from(table).select('*',{count:'exact',head:true}).eq('status','sending').lt('updated_at',stale);checks.push({table,condition:'sending_older_than_15_minutes',count:r.count??null,error:!!r.error});}
 const r=await db.from('staff_private_bookings').select('*',{count:'exact',head:true}).eq('status','approved').eq('calendar_sync_status','pending').lt('created_at',stale);checks.push({table:'staff_private_bookings',condition:'calendar_pending_older_than_15_minutes',count:r.count??null,error:!!r.error});
 return {checkedAt:new Date(now).toISOString(),readOnly:true,attentionRequired:checks.some(c=>c.error||c.count>0),checks};
}
if(require.main===module)inspectOperations(require('../supabaseClient')).then(report=>{console.log(JSON.stringify(report,null,2));process.exitCode=report.attentionRequired?2:0;}).catch(()=>{console.error('Operations monitor unavailable');process.exitCode=1;});
module.exports={inspectOperations};
