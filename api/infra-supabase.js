const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { fetchSupabaseMetrics, fetchSupabaseLogs } = require('./_lib/infra');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'infrastructure.view');if(!actor)return;
 const hours=Math.min(Math.max(Number(req.query?.hours||1),1),24);const [metrics,logs]=await Promise.all([fetchSupabaseMetrics(),fetchSupabaseLogs(hours)]);return json(res,200,{ok:metrics.ok,generatedAt:new Date().toISOString(),metrics,logs});
};
