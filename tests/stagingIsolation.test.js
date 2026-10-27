const test=require('node:test'),assert=require('node:assert/strict');const {validateStaging,assertStagingRecipient}=require('../stagingIsolation');
const production={SUPABASE_URL:'https://prod.supabase.co',SUPABASE_SECRET_KEY:'production-secret',GOOGLE_CALENDAR_ID:'prod-calendar',META_PHONE_NUMBER_ID:'111',META_WABA_ID:'222'};
const env={BOT_STAGING:'true',WHATSAPP_PROVIDER:'meta',SUPABASE_URL:'https://stage.supabase.co',SUPABASE_SECRET_KEY:'stage-secret',GOOGLE_CALENDAR_ID:'stage-calendar',GOOGLE_CREDENTIALS_JSON:'{}',META_ACCESS_TOKEN:'stage-token',META_PHONE_NUMBER_ID:'333',META_WABA_ID:'444',META_APP_SECRET:'app',VERIFY_TOKEN:'verify',STAFF_PHONE_NUMBER:'6582064900',STAGING_RECIPIENTS:'6582064900'};
test('full staging refuses every production resource and missing configuration',()=>{assert.deepEqual(validateStaging(env,production),['6582064900']);for(const key of Object.keys(production)){assert.throws(()=>validateStaging({...env,[key]:production[key]},production));assert.throws(()=>validateStaging(env,{...production,[key]:undefined}));}assert.throws(()=>validateStaging({...env,WHATSAPP_PROVIDER:'360dialog'},production));assert.throws(()=>validateStaging({...env,META_ACCESS_TOKEN:''},production));});
test('staging outgoing messages require explicit customer/staff allowlist',()=>{assert.doesNotThrow(()=>assertStagingRecipient(env,'6582064900'));assert.throws(()=>assertStagingRecipient(env,'6599999999'));assert.throws(()=>validateStaging({...env,STAFF_PHONE_NUMBER:'6599999999'},production));assert.doesNotThrow(()=>assertStagingRecipient({},'6599999999'));});

test('hosted staging compares a fingerprint without needing the production database key',()=>{
 const {createHash}=require('node:crypto');const baseline={...production,SUPABASE_SECRET_KEY:undefined,SUPABASE_SECRET_KEY_SHA256:createHash('sha256').update(production.SUPABASE_SECRET_KEY).digest('hex')};
 assert.doesNotThrow(()=>validateStaging(env,baseline));assert.throws(()=>validateStaging({...env,SUPABASE_SECRET_KEY:production.SUPABASE_SECRET_KEY},baseline));assert.throws(()=>validateStaging({...env,SUPABASE_URL:'https://prod.supabase.co/other'},baseline));
 const {loadStaging}=require('../scripts/full-staging-server');
 assert.equal(loadStaging({inherited:{...env,STAGING_ENV_FROM_HOST:'true',STAGING_BASELINE_JSON:JSON.stringify(baseline)}}).hosted,true);
 assert.throws(()=>loadStaging({inherited:{...env,STAGING_ENV_FROM_HOST:'true'}}));
});
