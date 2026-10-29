// Read-only production smoke checks. Empty webhook events never send messages.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),axios=require('axios');
async function run(){
 const base='https://brt-chatbot-live.onrender.com',checks=[];
 async function request(name,method,path,headers,expected){
  const response=await axios({method,url:base+path,headers,data:method==='POST'?{entry:[]}:undefined,timeout:55000,validateStatus:()=>true});
  checks.push({name,httpStatus:response.status,passed:response.status===expected});
 }
 await request('health','GET','/health',{},200);
 await request('unsigned_webhook_rejected','POST','/webhook',{},401);
 await request('360dialog_authenticated_empty_event','POST','/webhook',{'X-Webhook-Secret':process.env.D360_WEBHOOK_SECRET},200);
 await request('meta_test_route_disabled','POST','/meta-test/webhook',{},404);
 const response=await axios.get('https://waba-v2.360dialog.io/v1/configs/templates',{
  headers:{'D360-API-KEY':process.env.WHATSAPP_API_KEY},timeout:20000});
 for(const definition of require('../reminderRevision6').definitions){
  const remote=(response.data.waba_templates||[]).find(t=>t.name===definition.name&&t.language===definition.language);
  const expected=definition.components.find(c=>c.type==='BODY')?.text;
  const actual=remote?.components?.find(c=>String(c.type).toUpperCase()==='BODY')?.text;
  checks.push({name:definition.name,status:remote?.status||'MISSING',bodyMatches:actual===expected,
   passed:String(remote?.status).toUpperCase()==='APPROVED'&&actual===expected});
 }
 const report={checkedAt:new Date().toISOString(),customerMessagesSent:false,passed:checks.every(c=>c.passed),checks};
 fs.writeFileSync('production-v6-smoke-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=2;
}
if(require.main===module)run().catch(e=>{console.error(JSON.stringify({error:'Production release check failed',status:e.response?.status,code:e.code}));process.exitCode=1;});
module.exports={run};
