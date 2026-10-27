const test=require('node:test');
const assert=require('node:assert/strict');
const {MESSAGE_URL,providerConfig,messageRequest,listTemplates}=require('../whatsappProvider');
const meta={provider:'meta',version:'v26.0',phoneNumberId:'123',wabaId:'456',accessToken:'meta-test-token'};
test('360dialog remains the default and never receives a Meta access token',()=>{
    const config=providerConfig({WHATSAPP_API_KEY:'d360-test-key',META_ACCESS_TOKEN:'unused-meta-token'});
    assert.equal(config.provider,'360dialog');
    const payload={to:'6582064900',type:'text',text:{body:'test'}};
    const [url,body,options]=messageRequest(config,payload,{headers:{Authorization:'Bearer must-not-leak','d360-api-key':'wrong'}});
    assert.equal(url,MESSAGE_URL);assert.equal(body,payload);
    assert.equal(options.headers['D360-API-KEY'],'d360-test-key');
    assert.ok(!Object.keys(options.headers).some(h=>h.toLowerCase()==='authorization'));
});
test('Meta uses the configured number and bearer token without leaking 360dialog headers',()=>{
    for(const type of ['text','interactive','image','video','document','template']){
        const payload={to:'6582064900',type};
        const [url,body,options]=messageRequest(meta,payload,{headers:{'D360-API-KEY':'must-not-leak'},timeout:12000});
        assert.equal(url,'https://graph.facebook.com/v26.0/123/messages');assert.equal(body,payload);
        assert.deepEqual(options,{timeout:12000,headers:{Authorization:'Bearer meta-test-token','Content-Type':'application/json'}});
    }
});
test('invalid provider or incomplete Meta credentials fail closed without fallback',()=>{
    assert.throws(()=>providerConfig({WHATSAPP_PROVIDER:'other'}));
    for(const patch of [{accessToken:''},{phoneNumberId:'123/other'},{wabaId:''},{version:'v26.0/evil'}])assert.throws(()=>messageRequest({...meta,...patch},{to:'test'}));
});
test('test credentials cannot change the active production provider',()=>{
    const env={WHATSAPP_API_KEY:'d360',META_TEST_ACCESS_TOKEN:'test-token',META_TEST_PHONE_NUMBER_ID:'789',META_TEST_WABA_ID:'987'};
    assert.equal(providerConfig(env).provider,'360dialog');
    assert.equal(providerConfig(env,{test:true}).accessToken,'test-token');
    assert.equal(providerConfig(env,{test:true}).phoneNumberId,'789');
    assert.equal(providerConfig(env).accessToken,undefined);
});
test('template readiness uses the active provider and follows only Meta cursors',async()=>{
    const calls=[];
    const get=async(url,options)=>{calls.push({url,options});return {data:calls.length===1?{data:[{name:'one'}],paging:{next:'https://must-not-follow.test/secret',cursors:{after:'cursor'}}}:{data:[{name:'two'}]}};};
    const rows=await listTemplates(meta,get);assert.deepEqual(rows.map(t=>t.name),['one','two']);
    assert.ok(calls.every(c=>c.url==='https://graph.facebook.com/v26.0/456/message_templates'));
    assert.equal(calls[1].options.params.after,'cursor');
    assert.equal(calls[0].options.headers.Authorization,'Bearer meta-test-token');
    const legacy=await listTemplates({provider:'360dialog',apiKey:'d360'},async(url,options)=>{
        assert.equal(url,'https://waba-v2.360dialog.io/v1/configs/templates');assert.equal(options.headers['D360-API-KEY'],'d360');return {data:{waba_templates:[{name:'legacy'}]}};
    });assert.equal(legacy[0].name,'legacy');
});
