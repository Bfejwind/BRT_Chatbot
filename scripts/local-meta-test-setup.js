// One-time loopback form for saving an owner-authorized Meta test token.
// Never logs credentials, never changes the production provider or channel key.
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const nonce=crypto.randomBytes(32).toString('hex');
const envFile=path.join(__dirname,'..','.env');
let origin,completed=false;
const html=()=>`<!doctype html><html><head><meta charset="utf-8"><title>Local Meta test credentials</title><style>body{font:16px system-ui;max-width:600px;margin:40px auto;padding:20px}label{display:block;margin:18px 0 6px}input{display:block;width:95%;padding:10px}button{margin-top:24px;padding:12px}small{display:block;margin:16px 0;color:#444}</style></head><body><h1>Local Meta test credentials</h1><p>Save the approved temporary token to this project's ignored .env file. Production stays on 360dialog. Meta test webhooks remain disabled.</p><form id="setup"><label for="token">Temporary Meta test access token</label><input id="token" type="password" autocomplete="off" required maxlength="4096"><label for="phone">Meta test phone number ID</label><input id="phone" value="1334566233068780" required pattern="[0-9]+"><label for="waba">Meta test WABA ID</label><input id="waba" value="1011343481959468" required pattern="[0-9]+"><button>Save test credentials locally</button></form><p id="status" role="status"></p><script>document.getElementById('setup').onsubmit=async e=>{e.preventDefault();const token=document.getElementById('token');try{const r=await fetch('/meta-test-credentials',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':'${nonce}'},body:JSON.stringify({token:token.value,phone:document.getElementById('phone').value,waba:document.getElementById('waba').value})});token.value='';document.getElementById('status').textContent=r.ok?'Saved locally. Production provider unchanged; Meta test webhooks disabled.':'Could not save. Check the test credentials.';if(r.ok)document.getElementById('setup').hidden=true;}catch{token.value='';document.getElementById('status').textContent='Local setup service unavailable.';}};</script></body></html>`;
const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
    if(req.headers.host!==new URL(origin).host||req.url!=='/meta-test-credentials'){res.writeHead(404);return res.end();}
    if(req.method==='GET'&&!completed){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html());}
    if(req.method!=='POST'||completed||req.headers.origin!==origin||req.headers['x-setup-token']!==nonce
        ||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403);return res.end();}
    try{
        let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw new Error('Invalid request');}
        const input=JSON.parse(body);
        if(typeof input.token!=='string'||input.token.length<30||input.token.length>4096||/\s/.test(input.token)
            ||!/^\d+$/.test(input.phone)||!/^\d+$/.test(input.waba))throw new Error('Invalid request');
        let content=fs.readFileSync(envFile,'utf8');
        const values={META_TEST_ACCESS_TOKEN:input.token,META_TEST_PHONE_NUMBER_ID:input.phone,META_TEST_WABA_ID:input.waba,META_TEST_ENABLED:'false'};
        for(const [key,value] of Object.entries(values)){
            const expression=new RegExp('^'+key+'=.*$','gm');
            if(expression.test(content))content=content.replace(expression,()=>key+'='+value);
            else content+=(content.endsWith('\n')?'':'\n')+key+'='+value+'\n';
        }
        fs.writeFileSync(envFile,content,{mode:0o600});completed=true;
        console.log('Meta test credentials saved; production settings untouched.');res.writeHead(200);res.end('Saved');server.close();
    }catch{res.writeHead(400);res.end('Unable to save test credentials');}
});
server.listen(0,'127.0.0.1',()=>{origin=`http://127.0.0.1:${server.address().port}`;console.log('Local setup: '+origin+'/meta-test-credentials');});
setTimeout(()=>server.close(),5*60_000).unref();
