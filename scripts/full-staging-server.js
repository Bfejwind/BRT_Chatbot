// Full-bot staging only. Never falls back to production settings.
const fs=require('node:fs'),path=require('node:path'),dotenv=require('dotenv');
const {validateStaging}=require('../stagingIsolation');
function loadStaging({root=path.resolve(__dirname,'..'),inherited=process.env}={}){
 const read=file=>dotenv.parse(fs.readFileSync(path.join(root,file)));
 const hosted=inherited.STAGING_ENV_FROM_HOST==='true';
 const stage=hosted?{...inherited}:read('.env.staging');
 const baseline=hosted?JSON.parse(inherited.STAGING_BASELINE_JSON||'null'):
  fs.existsSync(path.join(root,'.staging-baseline.json'))?JSON.parse(fs.readFileSync(path.join(root,'.staging-baseline.json'),'utf8')):read('.env');
 if(!baseline)throw Error('Sanitized staging baseline is required');
 validateStaging(stage,baseline);
 return {stage,hosted,root};
}
if(require.main===module){
 try{
  const {stage,hosted,root}=loadStaging();
  const productionFile=path.join(root,'.env');
  if(fs.existsSync(productionFile))for(const key of Object.keys(dotenv.parse(fs.readFileSync(productionFile))))delete process.env[key];
  Object.assign(process.env,stage);
  const original=dotenv.config;
  dotenv.config=options=>original({...options,path:path.join(root,'.env.staging'),quiet:true});
  require('../server');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={loadStaging};
