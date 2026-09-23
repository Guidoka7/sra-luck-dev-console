const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);
 res.setHeader('x-request-id',requestId(req));
 const p=await requireSession(req,res);if(!p)return;
 return json(res,200,{autenticado:true,user:{id:p.id,name:p.name,email:p.email,role:p.role,permissions:p.effectivePermissions,lastLoginAt:p.last_login_at}});
};
