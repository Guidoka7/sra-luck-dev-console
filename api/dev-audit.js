const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { rest } = require('./_lib/supabase');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'audit.view');if(!actor)return;
 const limit=Math.min(Math.max(Number(req.query?.limit||100),1),300);
 const rows=await rest(`dev_audit_logs?select=id,actor_user_id,action,resource,resource_id,details,created_at&order=created_at.desc&limit=${limit}`,{method:'GET'}).catch(()=>null);
 if(!rows)return json(res,503,{erro:'Não foi possível carregar a auditoria.'});return json(res,200,{events:rows});
};
