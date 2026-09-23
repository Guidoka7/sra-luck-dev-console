const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { fetchDevSupabaseMetrics } = require('./_lib/infra');

module.exports = async function handler(req,res){
  if(req.method!=='GET') return methodNotAllowed(res,['GET']);
  res.setHeader('x-request-id',requestId(req));
  const actor=await requireSession(req,res,'infrastructure.view');
  if(!actor) return;
  try{
    const data=await fetchDevSupabaseMetrics();
    return json(res,data.ok?200:(data.configured===false?200:503),data);
  }catch(_){
    return json(res,503,{erro:'Não foi possível consultar o Supabase do Dev Console.',codigo:'DEV_SUPABASE_INFRA_UNAVAILABLE'});
  }
};
