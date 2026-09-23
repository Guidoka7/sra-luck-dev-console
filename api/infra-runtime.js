const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { runtimeMetrics } = require('./_lib/infra');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'infrastructure.view');if(!actor)return;return json(res,200,{...runtimeMetrics(),generatedAt:new Date().toISOString()});
};
