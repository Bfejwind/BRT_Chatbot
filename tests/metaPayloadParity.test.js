const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {messageRequest}=require('../whatsappProvider');
const {sequence}=require('../reminderDraft');
const {createDateFlowMessage}=require('../bookingDateFlow');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
function extract(name,globals){const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\nasync function ',start+1);const scope=vm.createContext({console:{log(){},error(){}},...globals});vm.runInContext(source.slice(start,end),scope);return scope[name];}
test('actual bilingual chatbot messages and booking/reminder payloads retain Meta transport parity',async()=>{
 for(const language of ['en','zh']){
  const payloads=[];
  const globals={process:{env:{WHATSAPP_API_KEY:'legacy-secret'}},getLanguage:()=>language,
   images:{directionsPDF:'https://example.test/directions.pdf',introductionVideo:'https://example.test/intro.mp4'},
   postWhatsApp:async(_url,payload)=>{payloads.push(payload);return {data:{messages:[{id:'mock'}]}};}};
  await extract('sendMessage',globals)('6582064900','Booking confirmed');
  await extract('sendImage',globals)('6582064900','https://example.test/image.jpg');
  await extract('sendLanguageMenu',globals)('6582064900');
  await extract('handleDirections',globals)('6582064900');
  await extract('sendIntroductionVideo',globals)('6582064900');
  payloads.push(createDateFlowMessage({to:'6582064900',draft:{},dates:['2026-11-01'],flowId:'999',isChinese:language==='zh'}));
  payloads.push(...sequence({customer_phone:'6582064900',booking_date:'2026-11-01',booking_time:'16:00'}));
  for(const payload of payloads){
   const [url,body,options]=messageRequest({provider:'meta',version:'v26.0',phoneNumberId:'123',wabaId:'456',accessToken:'mock-meta-token'},payload,{headers:{'D360-API-KEY':'legacy-secret'}});
   assert.equal(url,'https://graph.facebook.com/v26.0/123/messages');assert.equal(body,payload);
   assert.equal(options.headers.Authorization,'Bearer mock-meta-token');assert.ok(!JSON.stringify(options).includes('legacy-secret'));
   assert.equal(body.messaging_product,'whatsapp');assert.equal(body.to,'6582064900');
  }
  assert.equal(payloads.filter(p=>p.type==='template').length,3);
  assert.ok(payloads.some(p=>p.interactive?.type==='flow'));
  assert.ok(payloads.some(p=>p.document?.filename==='Directions.pdf'));
 }
});
