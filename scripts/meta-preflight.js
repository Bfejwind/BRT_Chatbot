// Read-only production preflight. Does not migrate/register/subscribe/send.
require('dotenv').config({quiet:true});
const axios=require('axios');
const {providerConfig,validateMeta,listTemplates}=require('../whatsappProvider');
const {getDefinitions}=require('../reminderTemplates');
async function preflight({env=process.env,get=(...args)=>axios.get(...args)}={}){
    const config=providerConfig({...env,WHATSAPP_PROVIDER:'meta'});validateMeta(config);
    const base=`https://graph.facebook.com/${config.version}`;
    const options={headers:{Authorization:`Bearer ${config.accessToken}`},timeout:15000};
    const checks=[];
    const record=(name,passed,detail)=>checks.push({name,status:passed===null?'unverified':passed?'passed':'needs_attention',detail});
    async function check(name,fn){try{await fn();}catch(error){record(name,null,{httpStatus:error.response?.status,code:error.response?.data?.error?.code||error.code||'UNAVAILABLE'});}}
    await Promise.allSettled([
        check('token',async()=>{
            if(!env.FACEBOOK_APP_ID||!env.META_APP_SECRET)return record('token',null,'App credentials missing');
            const r=await get(base+'/debug_token',{headers:{Authorization:`Bearer ${env.FACEBOOK_APP_ID}|${env.META_APP_SECRET}`},params:{input_token:config.accessToken},timeout:15000});
            const d=r.data.data,required=['whatsapp_business_management','whatsapp_business_messaging'];
            record('token',Boolean(d.is_valid&&d.app_id===env.FACEBOOK_APP_ID&&d.type==='SYSTEM_USER'&&(!d.expires_at||d.expires_at>Date.now()/1000)&&(!d.data_access_expires_at||d.data_access_expires_at>Date.now()/1000)&&required.every(s=>d.scopes?.includes(s))),{
                appMatches:d.app_id===env.FACEBOOK_APP_ID,type:d.type,expiresAt:d.expires_at,dataAccessExpiresAt:d.data_access_expires_at,scopes:d.scopes
            });
        }),
        check('phone',async()=>{const r=await get(base+'/'+config.phoneNumberId,{...options,params:{fields:'id,display_phone_number,quality_rating,code_verification_status'}});record('phone',r.data.id===config.phoneNumberId,{phone:r.data.display_phone_number,quality:r.data.quality_rating,codeVerificationStatus:r.data.code_verification_status});}),
        check('number_ownership',async()=>{const r=await get(base+'/'+config.wabaId+'/phone_numbers',{...options,params:{fields:'id',limit:100}});record('number_ownership',r.data.data?.some(p=>p.id===config.phoneNumberId)===true);}),
        check('app_subscription',async()=>{const r=await get(base+'/'+config.wabaId+'/subscribed_apps',options);record('app_subscription',r.data.data?.some(a=>String(a.whatsapp_business_api_data?.id||a.id)===env.FACEBOOK_APP_ID)===true);}),
        check('reminder_templates',async()=>{const rows=await listTemplates(config,get);const required=getDefinitions(env.META_TARGET_REMINDER_FORMAT||'full_v4');const statuses=required.map(d=>({name:d.name,language:d.language,status:rows.find(t=>t.name===d.name&&t.language===d.language)?.status||'MISSING'}));record('reminder_templates',statuses.every(t=>t.status.toUpperCase()==='APPROVED'),statuses);}),
        check('booking_flow',async()=>{
            if(!/^\d+$/.test(env.WHATSAPP_BOOKING_DATE_FLOW_ID||''))return record('booking_flow',false,'A published booking Flow ID is required');
            const r=await get(base+'/'+env.WHATSAPP_BOOKING_DATE_FLOW_ID,{...options,params:{fields:'id,name,status'}});record('booking_flow',r.data.status==='PUBLISHED',r.data);
        })
    ]);
    record('app_secret',Boolean(env.META_APP_SECRET));
    record('webhook_verify_token',Boolean(env.VERIFY_TOKEN));
    record('direct_billing',null,'Confirm the billing arrangement for the destination WABA before migration.');
    record('number_migration',null,'Confirm registration/migration and coexistence requirements with Meta and 360dialog; not performed.');
    record('live_inbound_webhook',null,'Isolated test-number inbound/reply and delivered receipts passed on 2026-10-26. Production routing and complete booking journey remain unverified until authorized cutover.');
    return {activeProductionProvider:env.WHATSAPP_PROVIDER||'360dialog',mutationsPerformed:false,productionCutoverReady:false,
        apiChecksPassed:checks.filter(c=>!['direct_billing','number_migration','live_inbound_webhook'].includes(c.name)).every(c=>c.status==='passed'),checks};
}
if(require.main===module)preflight().then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{
    console.error(JSON.stringify({error:error.response?'Meta preflight unavailable':error.message}));process.exitCode=1;
});
module.exports={preflight};
