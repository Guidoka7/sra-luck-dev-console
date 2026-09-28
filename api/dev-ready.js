const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { rest } = require('./_lib/supabase');
const { sraConnection } = require('./_lib/sra-config');

module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);
 res.setHeader('x-request-id',requestId(req));
 const mode=String(req.query?.mode||'ready');
 if(mode==='health')return json(res,200,{ok:true,service:'sra-luck-dev-console',runtime:'vercel-functions',time:new Date().toISOString()});
 const env=Boolean(process.env.DEV_SUPABASE_URL&&process.env.DEV_SUPABASE_ANON_KEY&&process.env.DEV_SUPABASE_SERVICE_ROLE_KEY&&process.env.DEV_SESSION_SECRET);
 let db=false;
 if(env){try{await rest('dev_users?select=id&limit=1',{method:'GET'});db=true}catch{}}
 const ok=env&&db;
 // Origem efetiva do Sra Luck (URL pública do app, não é segredo): permite
 // conferir de fora que todos os módulos apontam para o mesmo destino.
 let sra={configured:false};
 try{const c=await sraConnection();sra={configured:c.configured,origin:c.base,legacy:c.legacy,tokenConfigured:c.tokenConfigured}}catch{sra={configured:false,erro:'Falha ao ler a configuração do Sra Luck.'}}
 return json(res,ok?200:503,{ok,status:ok?'ready':'not_ready',checks:{environment:env,database:db},sra});
};
