// Standalone staging server: never imports server.js, Supabase or calendar workers.
require('dotenv').config({quiet:true});
const express=require('express');
const axios=require('axios');
const {mountMetaTestWebhook,validateTestConfig}=require('../metaWebhook');
const {createWhatsAppSender}=require('../whatsappSender');
const {providerConfig,messageRequest,validateMeta}=require('../whatsappProvider');
function createTestApp({env=process.env,send,logger=console}={}){
    const config=validateTestConfig(env);
    if(env.META_TEST_ENABLED!=='true')throw new Error('Set META_TEST_ENABLED=true only for this standalone test instance');
    const app=express();app.disable('x-powered-by');
    app.use(express.json({limit:'256kb',verify:(req,_res,buffer)=>{req.rawBody=Buffer.from(buffer);}}));
    app.get('/health',(_req,res)=>res.json({status:'ok',mode:'meta-test-only'}));
    const queued=createWhatsAppSender({post:(...args)=>axios.post(...args)});
    mountMetaTestWebhook(app,{env,logger,send:send||((payload)=>queued(...messageRequest(config,payload))),
        onStatus:status=>logger.log('Meta test receipt',{messageId:status.id,status:status.status})});
    app.use((_req,res)=>res.sendStatus(404));
    return app;
}
if(require.main===module){
    try{
        const host=process.env.META_TEST_HOST||'127.0.0.1';
        const port=Number(process.env.PORT||3100);
        createTestApp().listen(port,host,()=>console.log(`Meta test-only server listening on ${host}:${port}`));
        const config=providerConfig(process.env,{test:true});
        axios.get(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}`,{
            headers:{Authorization:`Bearer ${config.accessToken}`},params:{fields:'id'},timeout:15000
        }).then(response=>console.log('Meta test token probe',{
            httpStatus:response.status,expectedPhone:response.data.id===config.phoneNumberId,
            tokenLength:config.accessToken.length
        })).catch(error=>console.error('Meta test token probe failed',{
            httpStatus:error.response?.status,metaCode:error.response?.data?.error?.code,
            metaType:error.response?.data?.error?.type,contentType:error.response?.headers?.['content-type'],
            tokenLength:config.accessToken.length
        }));
    }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={createTestApp};
