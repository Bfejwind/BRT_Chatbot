const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),express=require('express');
const {metaAuthentication}=require('../metaWebhook');const {createStaffHandover}=require('../staffHandover');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8').replace(/\r\n/g,'\n');
const config={wabaId:'456',phoneNumberId:'123'},secret='isolated-secret';
function body(message){return {object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:message?[message]:[],statuses:message?[]:[{id:'receipt',status:'delivered'}]}}]}]};}
async function fixture(env={}){const app=express(),calls=[],completed=new Set(),handover=createStaffHandover();let fail=false;
app.use(express.json({verify:(req,res,b)=>{req.rawBody=Buffer.from(b);}}));
const globals={app,process:{env},console:{log(){},warn(){},error(){}},requireValid360DialogSecret:metaAuthentication(config,{secret}),staffHandover:handover,userLanguages:{},
 claimMessage:async id=>{calls.push(['claim',id]);return {result:completed.has(id)?'completed':'claimed',claimToken:'test'};},
 completeMessage:async id=>completed.add(id),releaseMessage:async id=>calls.push(['release',id]),getDraft:async()=>({language:'zh'}),reminderTestSelection:()=>null,shouldSkipReminderTest:()=>false,
 handleTextMessage:async(from,m)=>{if(fail)throw Error('simulated rejection');calls.push(['text',from,m.text.body]);},handleInteractiveMessage:async(from,m)=>calls.push(['interactive',from,m.interactive])};
const start=source.indexOf('app.post(\n    "/webhook"');assert.ok(start>0);vm.runInNewContext(source.slice(start,source.lastIndexOf('app.listen(PORT')),globals);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
return {calls,handover,setFailure:()=>{fail=true;},async post(payload,tamper=false){const raw=JSON.stringify(payload);const sig='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');return fetch(`http://127.0.0.1:${server.address().port}/webhook`,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':tamper?'sha256='+'0'.repeat(64):sig},body:raw});},close:()=>new Promise(r=>{server.close(r);server.closeAllConnections();})};}
test('real production webhook route accepts signed Meta text/Flow replies and deduplicates without production services',async()=>{const f=await fixture();try{
const message={id:'one',from:'6582064900',type:'text',text:{body:'Hi'}};
assert.equal((await f.post(body(message))).status,200);assert.equal((await f.post(body(message))).status,200);
assert.equal(f.calls.filter(c=>c[0]==='text').length,1);
assert.equal((await f.post(body({...message,id:'two',type:'interactive',interactive:{type:'nfm_reply',nfm_reply:{response_json:'{"flow_token":"isolated"}'}}}))).status,200);
assert.equal(f.calls.filter(c=>c[0]==='interactive').length,1);
assert.equal((await f.post(body())).status,200);assert.equal(f.calls.filter(c=>c[0]==='claim').length,3);
assert.equal((await f.post(body({...message,id:'bad'}),true)).status,401);
const foreign=body(message);foreign.entry[0].id='999';assert.equal((await f.post(foreign)).status,403);
}finally{await f.close();}});
test('production Meta route records Business App echoes and returns failure for unfinished processing',async()=>{const f=await fixture();try{
const echo={object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'smb_message_echoes',value:{metadata:{phone_number_id:'123',display_phone_number:'6580583517'},message_echoes:[{id:'echo',from:'6580583517',to:'6582064900',timestamp:String(Math.floor(Date.now()/1000))}]}}]}]};
assert.equal((await f.post(echo)).status,200);assert.equal(f.handover.isActive('6582064900'),true);assert.equal(f.calls.length,0);
f.setFailure();assert.equal((await f.post(body({id:'failed',from:'6582064900',type:'text',text:{body:'Hi'}}))).status,500);assert.ok(f.calls.some(c=>c[0]==='release'&&c[1]==='failed'));
}finally{await f.close();}});

test('full staging blocks inbound customers outside the explicit allowlist before claims',async()=>{const f=await fixture({BOT_STAGING:'true',STAGING_RECIPIENTS:'6582064900'});try{assert.equal((await f.post(body({id:'foreign',from:'6599999999',type:'text',text:{body:'Hi'}}))).status,403);assert.equal(f.calls.length,0);}finally{await f.close();}});
