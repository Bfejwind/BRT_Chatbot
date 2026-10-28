// Sends one standard hello_world template from the separate Meta test number.
// Usage: node scripts/meta-test-send.js --to 6582064900
require('dotenv').config({quiet:true});
const {providerConfig,messageRequest,validateMeta}=require('../whatsappProvider');
const {createWhatsAppSender}=require('../whatsappSender');
const axios=require('axios');
async function main(){
    const position=process.argv.indexOf('--to');
    const to=position>=0?process.argv[position+1]:null;
    const allowed=String(process.env.META_TEST_RECIPIENTS||'').split(',').map(p=>p.trim());
    if(!/^\d{7,15}$/.test(to||'')||!allowed.includes(to))throw new Error('An explicit --to recipient in META_TEST_RECIPIENTS is required');
    const config=providerConfig(process.env,{test:true});validateMeta(config);
    if(config.phoneNumberId===process.env.META_PHONE_NUMBER_ID)throw new Error('Test sender must differ from production Meta sender');
    const send=createWhatsAppSender({post:(...args)=>axios.post(...args)});
    const response=await send(...messageRequest(config,{
        messaging_product:'whatsapp',to,type:'template',template:{name:'hello_world',language:{code:'en_US'}}
    }));
    const messageId=response.data.messages?.[0]?.id;
    if(!messageId)throw new Error('No Meta message ID returned; do not retry automatically');
    console.log(JSON.stringify({provider:'meta-test',to,template:'hello_world',httpStatus:response.status,
        messageId,status:response.data.messages[0].message_status||'accepted',
        activeProductionProvider:process.env.WHATSAPP_PROVIDER||'360dialog'}));
}
main().catch(error=>{console.error(JSON.stringify({error:error.response?'Meta test send rejected or uncertain':error.message,
    status:error.response?.status,code:error.response?.data?.error?.code||error.code}));process.exitCode=1;});
