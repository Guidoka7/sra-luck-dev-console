const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { rest } = require('./_lib/supabase');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'connectors.view');if(!actor)return;
 const base=String(process.env.SRA_LUCK_BASE_URL||'https://sra-luck-react.vercel.app').replace(/\/$/,'');
 const started=Date.now();let health={ok:false,status:0,ms:0},ready={ok:false,status:0,ms:0};
 try{const r=await fetch(base+'/api/health',{cache:'no-store'});health={ok:r.ok,status:r.status,ms:Date.now()-started}}catch{health={ok:false,status:0,ms:Date.now()-started}}
 const rs=Date.now();try{const r=await fetch(base+'/api/ready',{cache:'no-store'});ready={ok:r.ok,status:r.status,ms:Date.now()-rs}}catch{ready={ok:false,status:0,ms:Date.now()-rs}}
 let supabase=false;try{await rest('dev_users?select=id&limit=1',{method:'GET'});supabase=true}catch{}
 return json(res,200,{ok:true,environment:process.env.VERCEL_ENV||'local',devSupabase:supabase,sessionSecretConfigured:Boolean(process.env.DEV_SESSION_SECRET),sra:{baseUrl:base,serviceTokenConfigured:Boolean(process.env.SRA_LUCK_SERVICE_TOKEN),health,ready},github:{tokenConfigured:Boolean(process.env.GITHUB_TOKEN),repository:process.env.GITHUB_REPOSITORY||'Guidoka7/sra-luck-react'}});
};
