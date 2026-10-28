// Route only the existing test WABA. Production/app-wide callback is never changed.
const axios=require('axios');
const {loadStaging}=require('./full-staging-server');
const callbackArgument=process.argv.indexOf('--callback');
const CALLBACK=callbackArgument<0?'https://brt-meta-full-staging.onrender.com/webhook':process.argv[callbackArgument+1];
if(!['https://brt-meta-full-staging.onrender.com/webhook',
 'https://brt-meta-rehearsal.onrender.com/webhook'].includes(CALLBACK))throw Error('Known isolated staging callback required');
async function run(){
 const {stage:e}=loadStaging();
 if(e.META_WABA_ID!=='1011343481959468'||e.META_PHONE_NUMBER_ID!=='1334566233068780')throw Error('Test WABA required');
 const base=`https://graph.facebook.com/${e.META_GRAPH_API_VERSION}`;
 const app={headers:{Authorization:`Bearer ${e.FACEBOOK_APP_ID}|${e.META_APP_SECRET}`},timeout:15000};
 const test={headers:{Authorization:`Bearer ${e.META_ACCESS_TOKEN}`},timeout:20000};
 const snapshot=r=>(r.data.data||[]).filter(s=>s.object==='whatsapp_business_account').map(s=>({object:s.object,callback:s.callback_url,fields:s.fields?.map(f=>f.name).sort()}));
 const before=snapshot(await axios.get(`${base}/${e.FACEBOOK_APP_ID}/subscriptions`,app));
 if(!before.length)throw Error('Cannot verify production callback');
 const getSub=async()=>((await axios.get(`${base}/${e.META_WABA_ID}/subscribed_apps`,test)).data.data||[]).find(a=>String(a.whatsapp_business_api_data?.id||a.id)===e.FACEBOOK_APP_ID);
 if(!await getSub())throw Error('Test account must already be subscribed');
 const challenge='full-staging-verification';
 const verified=await axios.get(CALLBACK,{params:{'hub.mode':'subscribe','hub.verify_token':e.VERIFY_TOKEN,'hub.challenge':challenge},timeout:30000});
 if(verified.data!==challenge)throw Error('Staging verification failed');
 if(!process.argv.includes('--configure'))return console.log(JSON.stringify({ready:true,callback:CALLBACK,mutationsPerformed:false}));
 const r=await axios.post(`${base}/${e.META_WABA_ID}/subscribed_apps`,{override_callback_uri:CALLBACK,verify_token:e.VERIFY_TOKEN},test);
 if(r.data.success!==true)throw Error('Meta did not confirm update');
 const after=snapshot(await axios.get(`${base}/${e.FACEBOOK_APP_ID}/subscriptions`,app));
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('App-wide callback differs; review required');
 const sub=await getSub();
 console.log(JSON.stringify({testWaba:e.META_WABA_ID,callback:CALLBACK,metaConfirmed:true,overrideVerified:sub?.override_callback_uri===CALLBACK,appWideCallbackUnchanged:true}));
}
if(require.main===module)run().catch(x=>{console.error(JSON.stringify({error:x.response?'Test webhook setup failed':x.message,code:x.response?.data?.error?.code||x.code}));process.exitCode=1;});
