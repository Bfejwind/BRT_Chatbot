// Read-only checks. No sends, subscriptions, reservations or provider changes.
const fs=require('node:fs');
const axios=require('axios');
const {loadStaging}=require('./full-staging-server');
const {providerConfig,listTemplates}=require('../whatsappProvider');
const {getDefinitions}=require('../reminderTemplates');
async function run(){
 const {stage:e}=loadStaging();const checks=[];
 async function check(name,fn){try{const detail=await fn();checks.push({name,status:detail?.ready===false?'blocked':'passed',detail});}catch(x){checks.push({name,status:'blocked',code:x.response?.data?.error?.code||x.code||'CHECK_FAILED'});}}
 const c=providerConfig(e),base=`https://graph.facebook.com/${c.version}`;
 const opts={headers:{Authorization:`Bearer ${c.accessToken}`},timeout:15000};
 await Promise.allSettled([
  check('database_runtime_client',async()=>{const {createClient}=require('@supabase/supabase-js');const db=createClient(e.SUPABASE_URL,e.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:require('ws')}});const r=await db.from('booking_requests').select('id',{head:true,count:'exact'});if(r.error)throw {code:r.error.code||'DATABASE_CLIENT_FAILED'};return {accessible:true};}),
  check('calendar',async()=>{const {google}=require('googleapis');const auth=new google.auth.GoogleAuth({credentials:JSON.parse(e.GOOGLE_CREDENTIALS_JSON),scopes:['https://www.googleapis.com/auth/calendar']});const api=google.calendar({version:'v3',auth});const r=await api.calendars.get({calendarId:e.GOOGLE_CALENDAR_ID});if(r.data.id!==e.GOOGLE_CALENDAR_ID)throw Error();return {accessible:true,timeZone:r.data.timeZone};}),
  check('database',async()=>{const tables=['booking_requests','booking_sessions','whatsapp_processed_messages','booking_reminders','customer_packages','package_booking_redemptions','staff_private_bookings','booking_drafts','booking_completion_jobs','staff_private_reminders'];for(const table of tables){await axios.head(`${e.SUPABASE_URL}/rest/v1/${table}`,{headers:{apikey:e.SUPABASE_SECRET_KEY,Authorization:`Bearer ${e.SUPABASE_SECRET_KEY}`},params:{select:'*',limit:0},timeout:15000});}return {tablesAccessible:tables.length};}),
  check('meta_phone',async()=>{const r=await axios.get(`${base}/${c.phoneNumberId}`,{...opts,params:{fields:'id,display_phone_number'}});if(r.data.id!==c.phoneNumberId)throw Error();return {id:r.data.id};}),
  check('meta_subscription',async()=>{const r=await axios.get(`${base}/${c.wabaId}/subscribed_apps`,opts);if(!r.data.data?.some(a=>String(a.whatsapp_business_api_data?.id||a.id)===e.FACEBOOK_APP_ID))throw Error();return {subscribed:true};}),
  check('reminder_templates',async()=>{const rows=await listTemplates(c,axios.get);const statuses=getDefinitions('full_v4').map(t=>({name:t.name,status:rows.find(r=>r.name===t.name&&r.language===t.language)?.status||'MISSING'}));return {ready:statuses.every(t=>t.status==='APPROVED'),templates:statuses};}),
  check('booking_flows',async()=>{const r=await axios.get(`${base}/${c.wabaId}/flows`,{...opts,params:{fields:'id,name,status',limit:100}});return {ready:r.data.data?.some(f=>f.id===e.WHATSAPP_BOOKING_DATE_FLOW_ID&&f.status==='PUBLISHED')===true,configured:!!e.WHATSAPP_BOOKING_DATE_FLOW_ID,flows:r.data.data};})
 ]);
 const report={checkedAt:new Date().toISOString(),isolation:'passed',mutationsPerformed:false,checks};
 fs.writeFileSync('meta-full-staging-readiness.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 if(checks.some(c=>c.status!=='passed'))process.exitCode=2;
}
if(require.main===module)run().catch(()=>{console.error('Staging configuration validation failed; no remote changes made.');process.exitCode=1;});
module.exports={run};
