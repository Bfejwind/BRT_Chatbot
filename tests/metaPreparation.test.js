const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createTestApp}=require('../scripts/meta-test-server');
const {preflight}=require('../scripts/meta-preflight');
const {getDefinitions}=require('../reminderTemplates');
const env={WHATSAPP_PROVIDER:'360dialog',META_TEST_ENABLED:'true',META_TEST_ACCESS_TOKEN:'test-token',META_TEST_PHONE_NUMBER_ID:'123',META_TEST_WABA_ID:'456',META_TEST_VERIFY_TOKEN:'verify',META_APP_SECRET:'test-secret',META_TEST_RECIPIENTS:'6582064900'};
test('standalone stage starts without production databases and has no chatbot booking routes',async()=>{
    const receipts=[],app=createTestApp({env,send:async()=>assert.fail('receipt must not send'),logger:{log:(_label,status)=>receipts.push(status)}});
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
    try{
        assert.deepEqual(await (await fetch(base+'/health')).json(),{status:'ok',mode:'meta-test-only'});
        assert.equal((await fetch(base+'/webhook',{method:'POST'})).status,404);
        const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},statuses:[{id:'wamid.test',status:'delivered',recipient_id:'6582064900'}]}}]}]});
        const signature='sha256='+crypto.createHmac('sha256',env.META_APP_SECRET).update(body).digest('hex');
        const r=await fetch(base+'/meta-test/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature},body});assert.equal(r.status,200);assert.deepEqual(receipts,[{messageId:'wamid.test',status:'delivered'}]);
    }finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});
test('standalone stage rejects missing isolation or production sender reuse',()=>{
    for(const patch of [{META_TEST_ENABLED:'false'},{META_APP_SECRET:''},{META_TEST_VERIFY_TOKEN:''},{META_TEST_RECIPIENTS:''},{META_PHONE_NUMBER_ID:'123'}])assert.throws(()=>createTestApp({env:{...env,...patch}}));
});
test('unfinished public signup cannot exchange credentials or claim a connection',async()=>{
    const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','server.js'),'utf8');
    const routes=source.slice(source.indexOf('// Meta account setup is staff-managed'),source.indexOf('// NOTE: Webhooks now arrive from 360dialog'));
    const app=require('express')();require('node:vm').runInNewContext(routes,{app});
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
    try{const r=await fetch(base+'/whatsapp-signup/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'untrusted-code'})});assert.equal(r.status,501);assert.equal((await r.json()).success,false);assert.ok((await (await fetch(base+'/connect-whatsapp')).text()).includes('managed by staff'));}finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});
test('preflight reports API access separately from unverified cutover steps without writes',async()=>{
    const config={WHATSAPP_PROVIDER:'360dialog',META_ACCESS_TOKEN:'production-token',META_PHONE_NUMBER_ID:'123',META_WABA_ID:'456',FACEBOOK_APP_ID:'789',META_APP_SECRET:'app-secret',VERIFY_TOKEN:'verify',WHATSAPP_BOOKING_DATE_FLOW_ID:'999'};
    const calls=[];
    const report=await preflight({env:config,get:async(url,options)=>{
        calls.push(url);assert.ok(!options.method);
        if(url.endsWith('/debug_token'))return {data:{data:{is_valid:true,app_id:'789',type:'SYSTEM_USER',expires_at:0,scopes:['whatsapp_business_management','whatsapp_business_messaging']}}};
        if(url.endsWith('/phone_numbers'))return {data:{data:[{id:'123'}]}};
        if(url.endsWith('/subscribed_apps'))return {data:{data:[{whatsapp_business_api_data:{id:'789'}}]}};
        if(url.endsWith('/message_templates'))return {data:{data:getDefinitions('full_v4').map(d=>({name:d.name,language:d.language,status:'APPROVED'}))}};
        if(url.endsWith('/999'))return {data:{id:'999',name:'Booking dates',status:'PUBLISHED'}};
        return {data:{id:'123',display_phone_number:'+65 80583517',quality_rating:'GREEN',code_verification_status:'NOT_VERIFIED'}};
    }});
    assert.equal(report.activeProductionProvider,'360dialog');assert.equal(report.mutationsPerformed,false);assert.equal(report.apiChecksPassed,true);
    assert.equal(report.checks.find(c=>c.name==='direct_billing').status,'unverified');
    assert.equal(calls.length,6);assert.ok(!JSON.stringify(report).includes('production-token'));
});

test('production preflight rejects temporary or expired credentials even when Meta marks token valid',async()=>{
 for(const patch of [{type:'USER'},{expires_at:1},{data_access_expires_at:1}]){
  const report=await preflight({env:{META_ACCESS_TOKEN:'secret',META_PHONE_NUMBER_ID:'123',META_WABA_ID:'456',FACEBOOK_APP_ID:'789',META_APP_SECRET:'app',VERIFY_TOKEN:'verify'},get:async url=>{
   if(url.endsWith('/debug_token'))return {data:{data:{is_valid:true,app_id:'789',type:'SYSTEM_USER',expires_at:0,scopes:['whatsapp_business_management','whatsapp_business_messaging'],...patch}}};
   return {data:{data:[],id:'123'}};
  }});
  assert.equal(report.checks.find(c=>c.name==='token').status,'needs_attention');
  assert.equal(report.productionCutoverReady,false);
 }
});
