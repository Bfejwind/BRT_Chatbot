const crypto=require('node:crypto');
const {providerConfig,validateMeta}=require('./whatsappProvider');
function verifyMetaSignature(rawBody,signature,secret) {
    if(!Buffer.isBuffer(rawBody)||!secret||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
    const expected=crypto.createHmac('sha256',secret).update(rawBody).digest();
    return crypto.timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));
}
function matchesAccount(body,config) {
    if(body?.object!=='whatsapp_business_account'||!Array.isArray(body.entry))return false;
    return body.entry.every(entry=>String(entry.id)===config.wabaId&&Array.isArray(entry.changes)&&entry.changes.every(change=>{
        // Account-level notifications may have no number metadata and no messages.
        const value=change.value;
        if(!value||typeof value!=='object')return false;
        if(value.messages&&!Array.isArray(value.messages))return false;
        if(value.statuses&&!Array.isArray(value.statuses))return false;
        if(value.messages?.length||value.statuses?.length||change.field==='smb_message_echoes')
            return String(value.metadata?.phone_number_id)===config.phoneNumberId;
        return !value.metadata?.phone_number_id||String(value.metadata.phone_number_id)===config.phoneNumberId;
    }));
}
function validateTestConfig(env){
    const config=providerConfig(env,{test:true});validateMeta(config);
    const recipients=String(env.META_TEST_RECIPIENTS||'').split(',').map(p=>p.trim()).filter(Boolean);
    if(config.phoneNumberId===env.META_PHONE_NUMBER_ID||!env.META_TEST_VERIFY_TOKEN||!env.META_APP_SECRET
        ||!recipients.length||recipients.some(p=>!/^\d{7,15}$/.test(p)))
        throw new Error('Meta test isolation is not configured');
    return config;
}
function metaAuthentication(config,{secret}={}) {
    return (req,res,next)=>{
        if(!verifyMetaSignature(req.rawBody,req.get('X-Hub-Signature-256'),secret))return res.sendStatus(401);
        if(!matchesAccount(req.body,config))return res.sendStatus(403);
        next();
    };
}
// A separate endpoint exercises Meta transport without touching live booking data.
// It deliberately acknowledges only allowlisted test customers, not booking flows.
function mountMetaTestWebhook(app,{env=process.env,send,logger=console,now=Date.now,onStatus=()=>{}}={}) {
    const enabled=()=>env.META_TEST_ENABLED==='true';
    const config=providerConfig(env,{test:true});
    const allowlist=new Set(String(env.META_TEST_RECIPIENTS||'').split(',').map(p=>p.trim()).filter(Boolean));
    const seen=new Map();
    const available=(req,res,next)=>{
        if(!enabled())return res.sendStatus(404);
        try{validateMeta(config);}catch{return res.status(503).json({error:'Meta test credentials are not configured'});}
        if(config.phoneNumberId===env.META_PHONE_NUMBER_ID||!env.META_TEST_VERIFY_TOKEN||!env.META_APP_SECRET
            ||!allowlist.size||[...allowlist].some(p=>!/^\d{7,15}$/.test(p)))
            return res.status(503).json({error:'Meta test isolation is not configured'});
        next();
    };
    app.get('/meta-test/webhook',available,(req,res)=>{
        if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===env.META_TEST_VERIFY_TOKEN
            &&typeof req.query['hub.challenge']==='string')return res.status(200).send(req.query['hub.challenge']);
        res.sendStatus(403);
    });
    app.post('/meta-test/webhook',available,metaAuthentication(config,{secret:env.META_APP_SECRET}),async(req,res)=>{
        try {
            for(const entry of req.body.entry)for(const change of entry.changes){
                for(const status of change.value.statuses||[]){
                    if(allowlist.has(status.recipient_id))onStatus(status);
                }
            }
            const messages=req.body.entry.flatMap(e=>e.changes.flatMap(c=>c.field==='messages'?c.value.messages||[]:[]));
            if(messages.some(m=>!allowlist.has(m.from)||typeof m.id!=='string'))return res.sendStatus(403);
            for(const [id,time] of seen)if(now()-time>24*60*60_000)seen.delete(id);
            for(const message of messages) {
                if(seen.has(message.id))continue;
                // Mark before sending: uncertain failures must not duplicate replies.
                if(seen.size>=10000)return res.sendStatus(503);
                seen.set(message.id,now());
                await send({messaging_product:'whatsapp',to:message.from,type:'text',text:{
                    body:'Meta Cloud API test successful. Your live chatbot is still running through 360dialog. This test does not create bookings or use packages.'
                }});
            }
            res.sendStatus(200);
        }catch(error){
            logger.error('Meta test webhook send outcome requires review',{status:error.response?.status,code:error.code});
            res.sendStatus(500);
        }
    });
}
module.exports={verifyMetaSignature,matchesAccount,metaAuthentication,mountMetaTestWebhook,validateTestConfig};
