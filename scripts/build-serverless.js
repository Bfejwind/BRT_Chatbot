// Build a self-contained application module; credentials are read only at runtime.
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'supabase/functions/whatsapp-bot');
const shims = {
    express: `function app(){return {use(){},get(){},post(){}}} app.json=()=>()=>{};module.exports=app;`,
    dotenv: `module.exports={config(){}};`,
    ws: `module.exports=globalThis.WebSocket;`,
    axios: `import value from 'npm:axios@1.20.0';module.exports=value;`,
    'google-auth-library': `import * as value from 'npm:google-auth-library@10.5.0';module.exports=value;`,
    '@supabase/supabase-js': `import * as value from 'npm:@supabase/supabase-js@2.109.0';module.exports=value;`
};
async function build() {
    fs.mkdirSync(output, {recursive:true});
    await esbuild.build({entryPoints:[path.join(root,'serverless/entry.js')],outfile:path.join(output,'bot.js'),
        bundle:true,platform:'node',format:'esm',target:'es2022',
        banner:{js:"import process from 'node:process'; import { Buffer } from 'node:buffer';"},
        plugins:[{name:'edge-runtime',setup(builder){
            builder.onResolve({filter:/^npm:/},args=>({path:args.path,external:true}));
            builder.onResolve({filter:/^(node:.*|crypto|path|fs)$/},args=>args.namespace==='node-shim'
                ? {path:args.path,external:true} : {path:args.path.startsWith('node:')?args.path:'node:'+args.path,namespace:'node-shim'});
            builder.onLoad({filter:/.*/,namespace:'node-shim'},args=>({
                contents:`import * as value from '${args.path}';module.exports=value;`,loader:'js'
            }));
            builder.onResolve({filter:/^(express|dotenv|axios|ws|google-auth-library|@supabase\/supabase-js)$/},args=>({path:args.path,namespace:'shim'}));
            builder.onLoad({filter:/.*/,namespace:'shim'},args=>({contents:shims[args.path],loader:'js'}));
            builder.onResolve({filter:/^googleapis$/},()=>({path:path.join(root,'serverless/calendar-adapter.js')}));
            builder.onLoad({filter:/[\\/]supabaseClient\.js$/},()=>({contents:`
                const {createClient}=require('@supabase/supabase-js');
                module.exports=createClient(process.env.SUPABASE_URL,process.env.BOT_DATABASE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,
                  {auth:{persistSession:false,autoRefreshToken:false}});`,loader:'js',resolveDir:root}));
            builder.onLoad({filter:/[\\/]whatsappSender\.js$/},()=>({contents:`
                const {createCheckpointedSender}=require('./serverless/worker');
                const {providerConfig,messageRequest}=require('./whatsappProvider');
                const axios=require('axios');
                const send=createCheckpointedSender((...args)=>axios.post(...args));
                module.exports={createWhatsAppSender:({post})=>createCheckpointedSender(post),
                    postWhatsApp:(url,payload,options)=>send(...messageRequest(providerConfig(),payload,options))};`,loader:'js',resolveDir:root}));
            builder.onLoad({filter:/[\\/]server\.js$/},()=>{
                let source=fs.readFileSync(path.join(root,'server.js'),'utf8');
                const end=source.lastIndexOf('app.listen(PORT');
                if(end<0)throw new Error('Cannot identify legacy server startup');
                source=source.slice(0,end);
                source=source.replace('const staffHandover = createStaffHandover();',
                    `const staffHandover={isActive:()=>((require('./serverless/context').getStore()?.state?.handover_until||0)>Date.now())};`);
                source+=`\nmodule.exports={async processMessage(from,message,state){
                    if(state.language)userLanguages[from]=state.language;else delete userLanguages[from];
                    if(state.pending_question)pendingQuestions[from]=state.pending_question;
                    try{
                        if(shouldSkipReminderTest(message))return;
                        if(!userLanguages[from]){const draft=await getDraft(from);if(['en','zh'].includes(draft?.language))userLanguages[from]=draft.language;}
                        if(message.type==='text')await handleTextMessage(from,message);
                        else if(message.type==='interactive')await handleInteractiveMessage(from,message);
                    }finally{
                        if(userLanguages[from])state.language=userLanguages[from];
                        if(pendingQuestions[from])state.pending_question=pendingQuestions[from];else delete state.pending_question;
                        delete userLanguages[from];delete pendingQuestions[from];
                    }
                }};`;
                return {contents:source,loader:'js',resolveDir:root};
            });
            builder.onLoad({filter:/[\\/]bookingCompletion\.js$/},args=>({
                contents:fs.readFileSync(args.path,'utf8').replace('if (running) return;',''),loader:'js',resolveDir:root
            }));
        }}]
    });
    // Native fetch entrypoint; Supabase handles the HTTP server lifecycle.
    fs.writeFileSync(path.join(output,'index.ts'), `import app from './bot.js';\nexport default app;\n`);
    console.log(JSON.stringify({output:'supabase/functions/whatsapp-bot',bytes:fs.statSync(path.join(output,'bot.js')).size}));
}
if(require.main===module)build().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build};
