// Read-only verification of the owner's most recent isolated test booking.
const fs=require('node:fs'),axios=require('axios');
const {loadStaging}=require('./full-staging-server');
async function run(){
 const {stage:e}=loadStaging(),options={headers:{apikey:e.SUPABASE_SECRET_KEY,
  Authorization:'Bearer '+e.SUPABASE_SECRET_KEY},timeout:15000};
 const get=async(table,params)=>(await axios.get(e.SUPABASE_URL+'/rest/v1/'+table,{...options,params})).data;
 const bookings=await get('booking_requests',{select:'id,session_id,status',customer_phone:'eq.'+e.STAFF_PHONE_NUMBER,order:'created_at.desc',limit:1});
 const booking=bookings[0];if(!booking)throw Error('No staging booking');
 const sessions=await get('booking_sessions',{select:'booking_date,booking_time,calendar_event_id,calendar_sync_status',id:'eq.'+booking.session_id});
 const session=sessions[0];if(!session)throw Error('Missing session');
 const completion=await get('booking_completion_jobs',{select:'stage,status,customer_status,staff_status',booking_id:'eq.'+booking.id});
 let calendarEventVerified=false;
 if(session.calendar_event_id){
  const {google}=require('googleapis');
  const auth=new google.auth.GoogleAuth({credentials:JSON.parse(e.GOOGLE_CREDENTIALS_JSON),scopes:['https://www.googleapis.com/auth/calendar.readonly']});
  const result=await google.calendar({version:'v3',auth}).events.get({calendarId:e.GOOGLE_CALENDAR_ID,eventId:session.calendar_event_id});
  calendarEventVerified=result.data.status!=='cancelled'&&result.data.id===session.calendar_event_id;
 }
 const report={checkedAt:new Date().toISOString(),isolated:true,bookingStatus:booking.status,
  date:session.booking_date,time:session.booking_time,calendarSyncStatus:session.calendar_sync_status,
  calendarEventVerified,completion};
 report.passed=booking.status==='approved'&&calendarEventVerified&&completion.length===1&&completion[0].status==='done';
 fs.writeFileSync('meta-rehearsal-booking-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=2;
}
if(require.main===module)run().catch(e=>{console.error(JSON.stringify({error:'Staging booking check failed',status:e.response?.status,code:e.response?.data?.code||e.code}));process.exitCode=1;});
module.exports={run};
