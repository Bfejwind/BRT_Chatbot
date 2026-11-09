// Creates an ignored deployment file; never prints credential values.
require('dotenv').config({quiet:true});
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const credentials = process.env.GOOGLE_CREDENTIALS_JSON || fs.readFileSync(path.join(root,'google-service-account.json'),'utf8');
const values = {
    BOT_DATABASE_KEY: process.env.SUPABASE_SECRET_KEY,
    D360_WEBHOOK_SECRET: process.env.D360_WEBHOOK_SECRET,
    WHATSAPP_API_KEY: process.env.WHATSAPP_API_KEY,
    WHATSAPP_PROVIDER: '360dialog',
    GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID,
    GOOGLE_CREDENTIALS_JSON: JSON.stringify(JSON.parse(credentials)),
    STAFF_PHONE_NUMBER: process.env.STAFF_PHONE_NUMBER,
    WHATSAPP_BOOKING_DATE_FLOW_ID: process.env.WHATSAPP_BOOKING_DATE_FLOW_ID || '',
    BOOKING_REMINDER_FORMAT: process.env.BOOKING_REMINDER_FORMAT || 'full_v5',
    BOT_SERVERLESS_ENABLED: 'false'
};
for (const key of ['BOT_DATABASE_KEY','D360_WEBHOOK_SECRET','WHATSAPP_API_KEY','GOOGLE_CALENDAR_ID','STAFF_PHONE_NUMBER']) {
    if (!values[key]) throw new Error('Missing deployment setting: '+key);
}
fs.writeFileSync(path.join(root,'.env.serverless-deploy'),Object.entries(values).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n');
console.log('Created ignored .env.serverless-deploy with '+Object.keys(values).length+' settings; activation is disabled.');
