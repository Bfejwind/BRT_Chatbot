const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectMeta}=require('../scripts/meta-readiness');
test('readiness diagnostic checks number ownership and app subscription without writes',async()=>{
    const calls=[];
    const result=await inspectMeta({config:{provider:'meta',version:'v26.0',accessToken:'test-token',phoneNumberId:'123',wabaId:'456'},appId:'789',get:async(url,options)=>{
        calls.push(url);assert.equal(options.headers.Authorization,'Bearer test-token');
        if(url.endsWith('/123'))return {data:{id:'123',display_phone_number:'+1 555 0000',code_verification_status:'VERIFIED'}};
        if(url.endsWith('/phone_numbers'))return {data:{data:[{id:'123'}]}};
        return {data:{data:[{whatsapp_business_api_data:{id:'789'}}]}};
    }});
    assert.equal(result.phoneBelongsToWaba,true);assert.equal(result.appSubscribed,true);
    assert.equal(calls.length,3);assert.ok(!JSON.stringify(result).includes('test-token'));
});
