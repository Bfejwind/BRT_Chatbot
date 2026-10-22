// Usage: node scripts/reminder-templates.js [--submit]
// Submits definitions for approval only; never sends a customer message.
require('dotenv').config({quiet:true});
const axios=require('axios');
const {definitions}=require('../reminderTemplates');
const base='https://waba-v2.360dialog.io';
const headers={'D360-API-KEY':process.env.WHATSAPP_API_KEY};
async function main(){
    const list=await axios.get(base+'/v1/configs/templates',{headers,timeout:20000});
    const existing=list.data.waba_templates||[];
    for(const definition of definitions){
        const found=existing.find(t=>t.name===definition.name&&t.language===definition.language);
        if(found){console.log(JSON.stringify({name:found.name,language:found.language,status:found.status}));continue;}
        if(!process.argv.includes('--submit')){console.log(JSON.stringify({name:definition.name,status:'not_submitted'}));continue;}
        const body=structuredClone(definition);
        // 360dialog's template endpoint accepts a public URL for header samples.
        const response=await axios.post(base+'/v1/configs/templates',body,{headers,timeout:30000});
        console.log(JSON.stringify({name:body.name,httpStatus:response.status,status:response.data.status||response.data.status_info||'submitted'}));
    }
}
main().catch(error=>{console.error(JSON.stringify({status:error.response?.status,error:error.response?.data?.meta?.developer_message||error.response?.data?.error||error.message}));process.exitCode=1;});
