// One deliberate v6 reminder preview to the existing allowlisted stage booking.
// Records accepted parts so rerunning cannot duplicate them; never sends from production.
const fs=require('node:fs'),axios=require('axios');
const {loadStaging}=require('./full-staging-server');
const {providerConfig,messageRequest,listTemplates}=require('../whatsappProvider');
const {reminderSequence,getDefinitions}=require('../reminderTemplates');
const {assertStagingRecipient}=require('../stagingIsolation');
async function run(){
 const {stage:e}=loadStaging(),config=providerConfig(e);
 if(config.wabaId!=='1011343481959468'||config.phoneNumberId!=='1334566233068780')throw Error('Isolated test sender required');
 assertStagingRecipient(e,e.STAFF_PHONE_NUMBER);
 const opts={headers:{apikey:e.SUPABASE_SECRET_KEY,Authorization:'Bearer '+e.SUPABASE_SECRET_KEY},timeout:15000};
 const get=async(table,params)=>(await axios.get(e.SUPABASE_URL+'/rest/v1/'+table,{...opts,params})).data;
 const [booking]=await get('booking_requests',{select:'id,session_id,customer_phone,status',customer_phone:'eq.'+e.STAFF_PHONE_NUMBER,order:'created_at.desc',limit:1});
 if(!booking||booking.status!=='approved')throw Error('Approved staging booking required');
 const [session]=await get('booking_sessions',{select:'booking_date,booking_time',id:'eq.'+booking.session_id});
 const available=await listTemplates(config,axios.get);
 if(!getDefinitions('full_v6').every(d=>available.some(t=>t.name===d.name&&t.language===d.language&&t.status==='APPROVED')))throw Error('All v6 test templates must be approved');
 const payloads=reminderSequence({...booking,...session},'full_v6');
 const file='meta-rehearsal-reminder-check.json';
 const report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):
  {checkedAt:new Date().toISOString(),isolated:true,bookingId:booking.id,format:'full_v6',parts:[]};
 if(report.bookingId!==booking.id)throw Error('Existing preview report belongs to a different booking; review before any resend');
 if(!process.argv.includes('--send'))return console.log(JSON.stringify({ready:true,format:'full_v6',parts:payloads.length,sendRequested:false}));
 for(const payload of payloads){
  const name=payload.template.name;
  if(report.parts.some(p=>p.name===name))continue;
  const part={name,status:'sending'};report.parts.push(part);fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  try{
   const response=await axios.post(...messageRequest(config,payload));
   const messageId=response.data.messages?.[0]?.id;if(!messageId)throw Error('Missing message ID');
   Object.assign(part,{status:'accepted',messageId});
  }catch(error){
   Object.assign(part,{status:error.response?'rejected':'unknown',httpStatus:error.response?.status,code:error.response?.data?.error?.code||error.code});
   fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');throw Error('Preview stopped; inspect result before retrying');
  }
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify({isolated:true,format:report.format,parts:report.parts.map(p=>({name:p.name,status:p.status})),deliveryConfirmed:false}));
}
if(require.main===module)run().catch(e=>{console.error(JSON.stringify({error:e.response?'Staging preview unavailable':e.message,status:e.response?.status,code:e.response?.data?.error?.code||e.code}));process.exitCode=1;});
module.exports={run};
