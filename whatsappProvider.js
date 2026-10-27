const MESSAGE_URL='https://waba-v2.360dialog.io/messages';
const GRAPH_VERSION='v26.0';
function providerConfig(env=process.env,{test=false}={}) {
    const provider=test?'meta':env.WHATSAPP_PROVIDER||'360dialog';
    if(!['360dialog','meta'].includes(provider))throw new Error('Invalid WHATSAPP_PROVIDER');
    return {provider,version:env.META_GRAPH_API_VERSION||GRAPH_VERSION,
        apiKey:env.WHATSAPP_API_KEY,
        accessToken:env[test?'META_TEST_ACCESS_TOKEN':'META_ACCESS_TOKEN'],
        phoneNumberId:env[test?'META_TEST_PHONE_NUMBER_ID':'META_PHONE_NUMBER_ID'],
        wabaId:env[test?'META_TEST_WABA_ID':'META_WABA_ID']};
}
function validateMeta(config) {
    if(!/^v\d+\.0$/.test(config.version)||!/^\d+$/.test(config.phoneNumberId||'')
        ||!/^\d+$/.test(config.wabaId||'')||!config.accessToken||/\s/.test(config.accessToken))
        throw new Error('Meta requires a Graph version, access token, phone number ID and WABA ID');
}
function messageRequest(config,payload,options={}) {
    if(config.provider==='360dialog') {
        if(!config.apiKey)throw new Error('WHATSAPP_API_KEY is required');
        const safeHeaders=Object.fromEntries(Object.entries(options.headers||{}).filter(([name])=>!['authorization','d360-api-key'].includes(name.toLowerCase())));
        return [MESSAGE_URL,payload,{...options,headers:{...safeHeaders,
            'D360-API-KEY':config.apiKey,'Content-Type':'application/json'},timeout:options.timeout||30000}];
    }
    validateMeta(config);
    // Rebuild headers: never leak 360dialog credentials to Meta or vice versa.
    return [`https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`,payload,{
        timeout:options.timeout||30000,headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'}
    }];
}
async function listTemplates(config,get) {
    if(config.provider==='360dialog') {
        const response=await get('https://waba-v2.360dialog.io/v1/configs/templates',{
            headers:{'D360-API-KEY':config.apiKey},timeout:20000
        });
        return response.data.waba_templates||[];
    }
    validateMeta(config);
    const rows=[];let after;
    for(let page=0;page<100;page++) {
        const response=await get(`https://graph.facebook.com/${config.version}/${config.wabaId}/message_templates`,{
            headers:{Authorization:`Bearer ${config.accessToken}`},timeout:20000,
            params:{fields:'name,language,status',limit:100,...(after?{after}:{})}
        });
        rows.push(...(response.data.data||[]));
        if(!response.data.paging?.next)return rows;
        const cursor=response.data.paging.cursors?.after;
        if(!cursor||cursor===after)throw new Error('Invalid Meta template pagination');
        after=cursor;
    }
    throw new Error('Too many Meta template pages');
}
module.exports={MESSAGE_URL,GRAPH_VERSION,providerConfig,validateMeta,messageRequest,listTemplates};
