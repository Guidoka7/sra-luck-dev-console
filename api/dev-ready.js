const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { rest } = require('./_lib/supabase');

module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);
 res.setHeader('x-request-id',requestId(req));
 const mode=String(req.query?.mode||'ready');
 if(mode==='health')return json(res,200,{ok:true,service:'sra-luck-dev-console',runtime:'vercel-functions',time:new Date().toISOString()});
 const env=Boolean(process.env.DEV_SUPABASE_URL&&process.env.DEV_SUPABASE_ANON_KEY&&process.env.DEV_SUPABASE_SERVICE_ROLE_KEY&&process.env.DEV_SESSION_SECRET);
 let db=false;
 if(env){try{await rest('dev_users?select=id&limit=1',{method:'GET'});db=true}catch{}}
 const ok=env&&db;
 return json(res,ok?200:503,{ok,status:ok?'ready':'not_ready',checks:{environment:env,database:db}});
};
