const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { rest } = require('./_lib/supabase');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'infrastructure.view');if(!actor)return;
 const source=String(req.query?.source||'supabase').replace(/[^a-z0-9_-]/gi,'').slice(0,60);
 const metric=String(req.query?.metric||'memory_usage_percent').replace(/[^a-z0-9_.-]/gi,'').slice(0,100);
 const hours=Math.min(Math.max(Number(req.query?.hours||24),1),720);const since=new Date(Date.now()-hours*3600000).toISOString();
 try{const rows=await rest(`dev_metric_snapshots?source=eq.${encodeURIComponent(source)}&metric_key=eq.${encodeURIComponent(metric)}&observed_at=gte.${encodeURIComponent(since)}&select=metric_value,state,unit,observed_at&order=observed_at.asc&limit=2000`,{method:'GET'});return json(res,200,{ok:true,source,metric,hours,points:rows||[]})}catch(e){return json(res,503,{erro:'Não foi possível carregar o histórico de infraestrutura.',codigo:'INFRA_HISTORY_UNAVAILABLE'})}
};
