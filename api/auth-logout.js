const { json, clearCookie, sameOrigin, methodNotAllowed, requestId } = require('./_lib/http');
const { COOKIE_NAME } = require('./_lib/session');
const { requireSession } = require('./_lib/rbac');
const { audit } = require('./_lib/supabase');
module.exports=async function handler(req,res){
 if(req.method!=='POST')return methodNotAllowed(res,['POST']);
 if(!sameOrigin(req))return json(res,403,{erro:'Origem não autorizada.'});
 res.setHeader('x-request-id',requestId(req));
 const p=await requireSession(req,res);clearCookie(res,COOKIE_NAME,req);if(p)await audit({actor_user_id:p.id,action:'auth.logout',resource:'dev_console',details:{}});
 return json(res,200,{ok:true});
};
