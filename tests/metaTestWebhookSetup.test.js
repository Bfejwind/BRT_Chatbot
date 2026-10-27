const test=require('node:test');
const assert=require('node:assert/strict');
const {configureTestWebhook}=require('../scripts/meta-test-webhook-setup');
const env={META_TEST_ACCESS_TOKEN:'test-token',META_TEST_PHONE_NUMBER_ID:'1334566233068780',META_TEST_WABA_ID:'1011343481959468',META_PHONE_NUMBER_ID:'1394261800429249',META_WABA_ID:'1548018376588125',FACEBOOK_APP_ID:'789',META_APP_SECRET:'app-secret',META_TEST_VERIFY_TOKEN:'verify'};
test('test-only webhook setup verifies staging and leaves the app-wide callback unchanged',async()=>{
    let updated=false;const writes=[];
    const result=await configureTestWebhook({env,get:async url=>{
        if(url.endsWith('/subscriptions'))return {data:{data:[{object:'whatsapp_business_account',active:true,callback_url:'https://production.test/webhook',fields:[{name:'messages'}]}]}};
        if(url.includes('/subscribed_apps'))return {data:{data:[{whatsapp_business_api_data:{id:'789'},...(updated?{override_callback_uri:'https://brt-meta-test.onrender.com/meta-test/webhook'}:{})}]}};
        assert.equal(url,'https://brt-meta-test.onrender.com/meta-test/webhook');return {data:'staging-routing-check'};
    },post:async(url,body)=>{writes.push({url,body});updated=true;return {data:{success:true}};}});
    assert.equal(writes.length,1);assert.ok(writes[0].url.includes('/1011343481959468/subscribed_apps'));
    assert.equal(result.overrideVerified,true);assert.equal(result.appWideCallbackUnchanged,true);
});
test('webhook setup refuses production IDs before making any request',async()=>{
    await assert.rejects(configureTestWebhook({env:{...env,META_TEST_WABA_ID:env.META_WABA_ID},get:()=>assert.fail('must not request'),post:()=>assert.fail('must not mutate')}),/separate Meta test account/);
});
