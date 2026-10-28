// Verify the replacement stage without invoking customer message handlers.
const fs=require('node:fs'),crypto=require('node:crypto'),axios=require('axios');
const {loadStaging}=require('./full-staging-server');
async function run(){
 const {stage:e}=loadStaging(),url='https://brt-meta-rehearsal.onrender.com';
 const checks=[];
 const health=await axios.get(url+'/health',{timeout:55000});
 checks.push({name:'health',status:health.status,passed:health.status===200});
 async function post(name,body,signed,expected){
  const raw=JSON.stringify(body),headers={'Content-Type':'application/json'};
  if(signed)headers['X-Hub-Signature-256']='sha256='+crypto.createHmac('sha256',e.META_APP_SECRET).update(raw).digest('hex');
  const r=await axios.post(url+'/webhook',raw,{headers,timeout:20000,validateStatus:()=>true});
  checks.push({name,status:r.status,passed:r.status===expected});
 }
 const body=messages=>({object:'whatsapp_business_account',entry:[{id:e.META_WABA_ID,
  changes:[{field:'messages',value:{metadata:{phone_number_id:e.META_PHONE_NUMBER_ID},messages}}]}]});
 await post('unsigned_rejected',body([]),false,401);
 await post('signed_empty_accepted',body([]),true,200);
 const foreign={object:'whatsapp_business_account',entry:[{id:'0',changes:[{field:'messages',value:{metadata:{phone_number_id:'0'}}}]}]};
 await post('foreign_account_rejected',foreign,true,403);
 const outsider='6599999999';
 if(e.STAGING_RECIPIENTS.split(',').map(p=>p.trim()).includes(outsider))throw Error('Non-allowlisted fixture required');
 await post('non_allowlisted_sender_rejected',body([{id:'TEST-isolation-'+crypto.randomUUID(),from:outsider,type:'text',text:{body:'Hi'}}]),true,403);
 const report={checkedAt:new Date().toISOString(),url,customerSendRequested:false,passed:checks.every(c=>c.passed),checks};
 fs.writeFileSync('meta-rehearsal-host-check.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=2;
}
if(require.main===module)run().catch(e=>{console.error(JSON.stringify({error:'Staging host check unavailable',status:e.response?.status,code:e.code}));process.exitCode=1;});
module.exports={run};
