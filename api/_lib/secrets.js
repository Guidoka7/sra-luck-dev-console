const crypto = require('crypto');
const { rest } = require('./supabase');

const CATALOG = {
  sra_luck: {
    name: 'Sra Luck',
    fields: [
      { key:'SRA_LUCK_BASE_URL', label:'URL do sistema', secret:false, placeholder:'https://sra-luck-react.vercel.app' },
      { key:'SRA_LUCK_SERVICE_TOKEN', label:'Service Token M2M', secret:true },
    ],
  },
  github: {
    name: 'GitHub',
    fields: [
      { key:'GITHUB_TOKEN', label:'Token GitHub', secret:true },
      { key:'GITHUB_REPOSITORY', label:'Repositório principal', secret:false, placeholder:'Guidoka7/sra-luck-react' },
      { key:'GITHUB_CONSOLE_REPOSITORY', label:'Repositório Dev Console', secret:false, placeholder:'Guidoka7/sra-luck-dev-console' },
    ],
  },
  supabase_sra: {
    name: 'Supabase Sra Luck',
    fields: [
      { key:'SRA_SUPABASE_PROJECT_REF', label:'Project Ref', secret:false },
      { key:'SRA_SUPABASE_ACCESS_TOKEN', label:'Management API Token', secret:true },
    ],
  },
  supabase_dev_metrics: {
    name: 'Supabase Dev · métricas',
    fields: [
      { key:'DEV_SUPABASE_PROJECT_REF', label:'Project Ref', secret:false },
      { key:'DEV_SUPABASE_ACCESS_TOKEN', label:'Management API Token', secret:true },
    ],
  },
  cloudflare: {
    name: 'Cloudflare',
    fields: [
      { key:'CLOUDFLARE_ACCOUNT_ID', label:'Account ID', secret:false },
      { key:'CLOUDFLARE_API_TOKEN', label:'API Token', secret:true },
      { key:'CLOUDFLARE_WORKER_SCRIPT', label:'Worker Script', secret:false },
    ],
  },
  vercel: {
    name: 'Vercel',
    fields: [
      { key:'DEV_VERCEL_ACCESS_TOKEN', label:'Access Token', secret:true },
      { key:'DEV_VERCEL_PROJECT_ID', label:'Project ID · Dev Console', secret:false },
      { key:'DEV_VERCEL_TEAM_ID', label:'Team ID', secret:false },
      { key:'SRA_VERCEL_PROJECT_ID', label:'Project ID · Sra Luck', secret:false },
    ],
  },
  dev_ai: {
    name: 'IA do Dev',
    fields: [
      { key:'GEMINI_API_KEY', label:'Gemini API Key', secret:true },
      { key:'GEMINI_MODEL', label:'Modelo', secret:false, placeholder:'gemini-2.5-flash' },
    ],
  },
  scheduler: {
    name: 'Rotinas do Dev',
    fields: [
      { key:'CRON_SECRET', label:'Cron Secret', secret:true },
    ],
  },
};

const ALLOWED = new Map(Object.values(CATALOG).flatMap(g => g.fields.map(f => [f.key, f])));
let cache = new Map();
let cacheAt = 0;
const CACHE_MS = 30_000;

function keyBytes(){
  const source=String(process.env.DEV_SESSION_SECRET||'');
  if(source.length<32) throw new Error('DEV_SESSION_SECRET_REQUIRED_FOR_VAULT');
  return crypto.createHash('sha256').update('sra-luck-dev-connector-v1:').update(source).digest();
}
function encrypt(value){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',keyBytes(),iv);
  const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return {value_cipher:encrypted.toString('base64'),iv:iv.toString('base64'),auth_tag:cipher.getAuthTag().toString('base64')};
}
function decrypt(row){
  const decipher=crypto.createDecipheriv('aes-256-gcm',keyBytes(),Buffer.from(row.iv,'base64'));
  decipher.setAuthTag(Buffer.from(row.auth_tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.value_cipher,'base64')),decipher.final()]).toString('utf8');
}
function clearCache(){cache=new Map();cacheAt=0}
async function rows(){
  if(Date.now()-cacheAt<CACHE_MS&&cache.size)return cache;
  const list=await rest('dev_connector_secrets?select=name,value_cipher,iv,auth_tag,updated_by,updated_at',{method:'GET'});
  cache=new Map((list||[]).map(r=>[r.name,r])); cacheAt=Date.now(); return cache;
}
async function getSecret(name,{fallback=true}={}){
  if(!ALLOWED.has(name)) return fallback?String(process.env[name]||'').trim()||null:null;
  try{
    const row=(await rows()).get(name);
    if(row){const value=decrypt(row).trim();if(value)return value}
  }catch(_){}
  return fallback?String(process.env[name]||'').trim()||null:null;
}
async function saveSecret(name,value,actor){
  if(!ALLOWED.has(name)) throw Object.assign(new Error('Credencial técnica desconhecida.'),{status:400});
  const clean=String(value||'').trim();
  if(!clean) throw Object.assign(new Error('Informe o valor.'),{status:400});
  const payload={name,...encrypt(clean),updated_by:String(actor||'dev'),updated_at:new Date().toISOString()};
  await rest('dev_connector_secrets?on_conflict=name',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(payload)});
  clearCache();
}
async function removeSecret(name){
  if(!ALLOWED.has(name)) throw Object.assign(new Error('Credencial técnica desconhecida.'),{status:400});
  await rest(`dev_connector_secrets?name=eq.${encodeURIComponent(name)}`,{method:'DELETE'});
  clearCache();
}
function mask(value){
  const s=String(value||'');if(!s)return'';if(s.length<=8)return '••••';return `•••• ${s.slice(-4)}`;
}
async function catalogStatus(){
  const stored=await rows().catch(()=>new Map());
  const groups=[];
  for(const [id,g] of Object.entries(CATALOG)){
    const fields=[];
    for(const f of g.fields){
      const row=stored.get(f.key);
      const env=String(process.env[f.key]||'').trim();
      let visible=null,masked='';
      if(row){
        try{const v=decrypt(row);masked=f.secret?mask(v):'';visible=f.secret?null:v}catch{masked='inválido'}
      }else if(env){
        masked=f.secret?mask(env):'';visible=f.secret?null:env;
      }
      fields.push({...f,configured:Boolean(row||env),source:row?'cofre_dev':env?'variavel_ambiente':'nao_configurado',masked,visible,updatedAt:row?.updated_at||null});
    }
    groups.push({id,name:g.name,fields});
  }
  return groups;
}

module.exports={CATALOG,ALLOWED,getSecret,saveSecret,removeSecret,catalogStatus,clearCache};
