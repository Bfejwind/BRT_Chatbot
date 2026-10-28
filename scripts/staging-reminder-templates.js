// Provision reminder copies only on the isolated Meta test WABA. Never sends.
const axios=require('axios');
const {loadStaging}=require('./full-staging-server');
const {providerConfig,listTemplates}=require('../whatsappProvider');
const {getDefinitions,DIRECTIONS_PDF}=require('../reminderTemplates');
async function run(){
 const {stage:e}=loadStaging(),c=providerConfig(e);
 if(c.wabaId!=='1011343481959468'||c.phoneNumberId!=='1334566233068780')throw Error('Test account required');
 const base=`https://graph.facebook.com/${c.version}`,headers={Authorization:`Bearer ${c.accessToken}`};
 const existing=await listTemplates(c,axios.get);
 for(const original of getDefinitions(process.argv.includes('--v6')?'full_v6':'full_v4')){
  const found=existing.find(t=>t.name===original.name&&t.language===original.language);
  if(found){console.log(JSON.stringify({name:found.name,status:found.status}));continue;}
  if(!process.argv.includes('--submit')){console.log(JSON.stringify({name:original.name,status:'MISSING'}));continue;}
  const body=structuredClone(original),header=body.components.find(c=>c.type==='HEADER');
  if(header){
   const pdf=await axios.get(DIRECTIONS_PDF,{responseType:'arraybuffer',timeout:20000});
   const bytes=Buffer.from(pdf.data);if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid directions PDF');
   const session=await axios.post(`${base}/${e.FACEBOOK_APP_ID}/uploads`,null,{headers,params:{file_length:bytes.length,file_type:'application/pdf',file_name:'Directions.pdf'},timeout:20000});
   if(!String(session.data.id).startsWith('upload:'))throw Error('Invalid upload session');
   const uploaded=await axios.post(`${base}/${session.data.id}`,bytes,{headers:{Authorization:`OAuth ${c.accessToken}`,file_offset:'0','Content-Type':'application/pdf'},timeout:30000});
   if(!uploaded.data.h)throw Error('Missing upload handle');
   header.example={header_handle:[uploaded.data.h]};
  }
  const r=await axios.post(`${base}/${c.wabaId}/message_templates`,body,{headers,timeout:30000});
  console.log(JSON.stringify({name:body.name,status:r.data.status||'submitted',id:r.data.id}));
 }
}
if(require.main===module)run().catch(x=>{console.error(JSON.stringify({error:'Test template preparation failed',status:x.response?.status,code:x.response?.data?.error?.code||x.code,subcode:x.response?.data?.error?.error_subcode}));process.exitCode=1;});
