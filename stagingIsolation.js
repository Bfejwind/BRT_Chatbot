const {createHash}=require('node:crypto');
function validateStaging(env,production){
 const required=['SUPABASE_URL','SUPABASE_SECRET_KEY','GOOGLE_CALENDAR_ID','GOOGLE_CREDENTIALS_JSON','META_ACCESS_TOKEN','META_PHONE_NUMBER_ID','META_WABA_ID','META_APP_SECRET','VERIFY_TOKEN','STAFF_PHONE_NUMBER','STAGING_RECIPIENTS'];
 if(env.BOT_STAGING!=='true'||env.WHATSAPP_PROVIDER!=='meta'||required.some(k=>!env[k]))throw Error('Full staging configuration is incomplete');
 for(const k of ['SUPABASE_URL','GOOGLE_CALENDAR_ID','META_PHONE_NUMBER_ID','META_WABA_ID']){
  if(!production[k]||String(env[k]).replace(/\/$/,'')===String(production[k]).replace(/\/$/,''))throw Error('Staging must use separate resources: '+k);
 }
 const fingerprint=value=>createHash('sha256').update(value).digest('hex');
 const productionKeyHash=production.SUPABASE_SECRET_KEY_SHA256 || (production.SUPABASE_SECRET_KEY&&fingerprint(production.SUPABASE_SECRET_KEY));
 if(!productionKeyHash||fingerprint(env.SUPABASE_SECRET_KEY)===productionKeyHash)throw Error('Staging must use a separate database credential');
 if(new URL(env.SUPABASE_URL).hostname===new URL(production.SUPABASE_URL).hostname)throw Error('Production database host is forbidden');
 const allowed=String(env.STAGING_RECIPIENTS).split(',').map(x=>x.trim());
 if(allowed.some(x=>!/^\d{7,15}$/.test(x))||!allowed.includes(env.STAFF_PHONE_NUMBER))throw Error('Staging recipients/staff must be allowlisted');
 JSON.parse(env.GOOGLE_CREDENTIALS_JSON);
 return allowed;
}
function assertStagingRecipient(env,to){if(env.BOT_STAGING==='true'&&!String(env.STAGING_RECIPIENTS||'').split(',').map(x=>x.trim()).includes(String(to)))throw Error('Staging recipient is not allowlisted');}
module.exports={validateStaging,assertStagingRecipient};
