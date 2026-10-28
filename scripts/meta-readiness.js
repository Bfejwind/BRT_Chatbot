// Read-only diagnostics. Does not subscribe, register, migrate or send messages.
require('dotenv').config({quiet:true});
const axios=require('axios');
const {providerConfig,validateMeta}=require('../whatsappProvider');
async function inspectMeta({config,appId,get=axios.get}){
    validateMeta(config);
    const base=`https://graph.facebook.com/${config.version}`;
    const options={headers:{Authorization:`Bearer ${config.accessToken}`},timeout:20000};
    const phone=await get(`${base}/${config.phoneNumberId}`,{...options,params:{fields:'id,display_phone_number,verified_name,quality_rating,code_verification_status'}});
    const numbers=await get(`${base}/${config.wabaId}/phone_numbers`,{...options,params:{fields:'id',limit:100}});
    const subscriptions=await get(`${base}/${config.wabaId}/subscribed_apps`,options);
    const belongs=numbers.data.data?.some(p=>p.id===config.phoneNumberId)===true;
    const subscribed=subscriptions.data.data?.some(a=>String(a.whatsapp_business_api_data?.id||a.id)===appId)===true;
    return {phoneNumberId:phone.data.id,displayPhoneNumber:phone.data.display_phone_number,
        verifiedName:phone.data.verified_name,quality:phone.data.quality_rating,
        codeVerificationStatus:phone.data.code_verification_status,phoneBelongsToWaba:belongs,
        appSubscribed:subscribed,activeProvider:process.env.WHATSAPP_PROVIDER||'360dialog'};
}
if(require.main===module){
    const test=!process.argv.includes('--production');
    inspectMeta({config:providerConfig(process.env,{test}),appId:process.env.FACEBOOK_APP_ID})
        .then(result=>console.log(JSON.stringify({mode:test?'test':'production',...result},null,2)))
        .catch(error=>{console.error(JSON.stringify({error:'Meta readiness check failed',status:error.response?.status,
            code:error.response?.data?.error?.code||error.code,
            detail:error.response?'Check token validity, permissions and asset access.':error.message}));process.exitCode=1;});
}
module.exports={inspectMeta};
