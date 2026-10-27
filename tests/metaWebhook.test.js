const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {verifyMetaSignature,matchesAccount,metaAuthentication,mountMetaTestWebhook}=require('../metaWebhook');
const {messageRequest,providerConfig}=require('../whatsappProvider');
const axios=require('axios');
const {createWhatsAppSender}=require('../whatsappSender');
const secret='app-test-secret';
const signed=body=>'sha256='+crypto.createHmac('sha256',secret).update(body).digest('hex');
const env={META_TEST_ENABLED:'true',META_APP_SECRET:secret,META_TEST_ACCESS_TOKEN:'test-token',META_TEST_PHONE_NUMBER_ID:'123',META_TEST_WABA_ID:'456',META_TEST_VERIFY_TOKEN:'verify-test',META_TEST_RECIPIENTS:'6582064900'};
const event=(phone='123',from='6582064900',id='wamid.test')=>({object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'messages',value:{metadata:{phone_number_id:phone},messages:[{id,from,type:'text',text:{body:'hello'}}]}}]}]});
async function server(app){const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));return {base:`http://127.0.0.1:${s.address().port}`,close:()=>new Promise(r=>{s.close(r);s.closeAllConnections();})};}
function makeApp(){const app=express();app.use(express.json({verify:(req,_res,buffer)=>{req.rawBody=Buffer.from(buffer);}}));return app;}
test('Meta signatures verify raw bytes and reject missing, malformed and changed content',()=>{
    const body=Buffer.from(JSON.stringify(event()));assert.ok(verifyMetaSignature(body,signed(body),secret));
    for(const signature of [undefined,'sha256=bad','sha1='+ 'a'.repeat(64),'sha256='+ '0'.repeat(64)])assert.equal(verifyMetaSignature(body,signature,secret),false);
    assert.equal(verifyMetaSignature(Buffer.from('{}'),signed(body),secret),false);
    assert.equal(verifyMetaSignature(body,signed(body),''),false);
    assert.equal(matchesAccount(event('999'),{wabaId:'456',phoneNumberId:'123'}),false);
});
test('Meta test endpoint is disabled by default, and incomplete isolation fails closed',async()=>{
    for(const [patch,status] of [[{META_TEST_ENABLED:undefined},404],[{META_TEST_ACCESS_TOKEN:undefined},503],[{META_TEST_RECIPIENTS:''},503],[{META_PHONE_NUMBER_ID:'123'},503]]){
        const app=makeApp();mountMetaTestWebhook(app,{env:{...env,...patch},send:async()=>assert.fail('must not send')});const s=await server(app);
        try{const r=await fetch(s.base+'/meta-test/webhook');assert.equal(r.status,status);}finally{await s.close();}
    }
});
test('signed test webhook sends through Meta only; duplicates and status receipts do not send again',async()=>{
    const captured=[];const api=express();api.use(express.json());api.post('/messages',(req,res)=>{captured.push({headers:req.headers,payload:req.body});res.json({messages:[{id:'wamid.accepted'}]});});const graph=await server(api);
    const app=makeApp();
    const sender=createWhatsAppSender({channelIntervalMs:0,recipientIntervalMs:0,post:async(url,payload,options)=>{
        assert.equal(url,'https://graph.facebook.com/v26.0/123/messages');
        return axios.post(graph.base+'/messages',payload,options);
    }});
    mountMetaTestWebhook(app,{env,send:payload=>sender(...messageRequest(providerConfig(env,{test:true}),payload))});
    const s=await server(app);
    try{
        const verify=await fetch(s.base+'/meta-test/webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=challenge');assert.equal(await verify.text(),'challenge');
        const body=JSON.stringify(event());const options={method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signed(body)},body};
        assert.equal((await fetch(s.base+'/meta-test/webhook',options)).status,200);
        assert.equal((await fetch(s.base+'/meta-test/webhook',options)).status,200);
        assert.equal(captured.length,1);assert.equal(captured[0].headers.authorization,'Bearer test-token');assert.equal(captured[0].headers['d360-api-key'],undefined);
        assert.equal(captured[0].payload.to,'6582064900');assert.ok(captured[0].payload.text.body.includes('does not create bookings'));
        const receipt=event();delete receipt.entry[0].changes[0].value.messages;receipt.entry[0].changes[0].value.statuses=[{id:'wamid.accepted',status:'delivered'}];const receiptBody=JSON.stringify(receipt);
        assert.equal((await fetch(s.base+'/meta-test/webhook',{...options,body:receiptBody,headers:{...options.headers,'X-Hub-Signature-256':signed(receiptBody)}})).status,200);assert.equal(captured.length,1);
    }finally{await s.close();await graph.close();}
});
test('foreign phones, customers, WABAs and tampered webhooks cannot trigger test sends',async()=>{
    const app=makeApp();mountMetaTestWebhook(app,{env,send:async()=>assert.fail('must not send')});const s=await server(app);
    try{
        const wrongWaba=event();wrongWaba.entry[0].id='999';
        for(const payload of [event('999'),event('123','6599999999'),wrongWaba]){const body=JSON.stringify(payload);assert.equal((await fetch(s.base+'/meta-test/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signed(body)},body})).status,403);}
        assert.equal((await fetch(s.base+'/meta-test/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event())})).status,401);
    }finally{await s.close();}
});
test('production Meta authentication refuses 360dialog headers and wrong account metadata',async()=>{
    const app=makeApp();app.post('/webhook',metaAuthentication({phoneNumberId:'123',wabaId:'456'},{secret}),(_req,res)=>res.sendStatus(200));const s=await server(app);
    try{const body=JSON.stringify(event());assert.equal((await fetch(s.base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Webhook-Secret':'legacy'},body})).status,401);assert.equal((await fetch(s.base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signed(body)},body})).status,200);}finally{await s.close();}
});
