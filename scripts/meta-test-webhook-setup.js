// Routes only the already-subscribed Meta TEST WABA to the approved staging URL.
// Does not change app-wide/production callbacks or number registration.
require('dotenv').config({quiet:true});
const axios=require('axios');
const {providerConfig,validateMeta}=require('../whatsappProvider');
const CALLBACK='https://brt-meta-test.onrender.com/meta-test/webhook';
async function configureTestWebhook({env=process.env,get=axios.get,post=axios.post}={}){
    const config=providerConfig(env,{test:true});validateMeta(config);
    if(config.wabaId!=='1011343481959468'||config.phoneNumberId!=='1334566233068780'
        ||config.wabaId===env.META_WABA_ID||config.phoneNumberId===env.META_PHONE_NUMBER_ID)
        throw new Error('Expected the separate Meta test account');
    if(!env.FACEBOOK_APP_ID||!env.META_APP_SECRET||!env.META_TEST_VERIFY_TOKEN)throw new Error('App/test verification credentials missing');
    const base=`https://graph.facebook.com/${config.version}`;
    const appOptions={headers:{Authorization:`Bearer ${env.FACEBOOK_APP_ID}|${env.META_APP_SECRET}`},timeout:20000};
    const testOptions={headers:{Authorization:`Bearer ${config.accessToken}`},timeout:30000};
    const snapshot=response=>(response.data.data||[]).filter(s=>s.object==='whatsapp_business_account').map(s=>({object:s.object,active:s.active,callback:s.callback_url,fields:s.fields?.map(f=>f.name).sort()}));
    const before=snapshot(await get(`${base}/${env.FACEBOOK_APP_ID}/subscriptions`,appOptions));
    if(!before.length)throw new Error('App-wide callback could not be verified; no changes made');
    const subscriptions=(await get(`${base}/${config.wabaId}/subscribed_apps`,testOptions)).data.data||[];
    const current=subscriptions.find(a=>String(a.whatsapp_business_api_data?.id||a.id)===env.FACEBOOK_APP_ID);
    if(!current)throw new Error('Test WABA must already be subscribed; no new access granted');
    const challenge='staging-routing-check';
    const verify=await get(CALLBACK,{params:{'hub.mode':'subscribe','hub.verify_token':env.META_TEST_VERIFY_TOKEN,'hub.challenge':challenge},timeout:20000});
    if(verify.data!==challenge)throw new Error('Staging verification challenge failed');
    const result=await post(`${base}/${config.wabaId}/subscribed_apps`,{
        override_callback_uri:CALLBACK,verify_token:env.META_TEST_VERIFY_TOKEN
    },testOptions);
    if(result.data.success!==true)throw new Error('Meta did not confirm the test webhook update');
    const after=snapshot(await get(`${base}/${env.FACEBOOK_APP_ID}/subscriptions`,appOptions));
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('App-wide callback changed unexpectedly; review required');
    const confirmed=(await get(`${base}/${config.wabaId}/subscribed_apps`,testOptions)).data.data||[];
    const updated=confirmed.find(a=>String(a.whatsapp_business_api_data?.id||a.id)===env.FACEBOOK_APP_ID);
    return {testWabaId:config.wabaId,callback:CALLBACK,metaConfirmed:true,
        overrideVerified:updated?.override_callback_uri===CALLBACK,
        appWideCallbackUnchanged:true,appWideCallbacks:after.map(s=>s.callback)};
}
if(require.main===module){
    if(!process.argv.includes('--configure')){console.log('Pass --configure to route only the existing test WABA to staging.');}
    else configureTestWebhook().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
        console.error(JSON.stringify({error:error.response?'Meta test webhook configuration failed':error.message,
            status:error.response?.status,code:error.response?.data?.error?.code||error.code}));process.exitCode=1;
    });
}
module.exports={configureTestWebhook};
