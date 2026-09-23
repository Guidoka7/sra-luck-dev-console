const { json, body, sameOrigin, methodNotAllowed, requestId } = require('./_lib/http');
const { authUpdatePassword } = require('./_lib/supabase');
module.exports=async function handler(req,res){
 if(req.method!=='POST')return methodNotAllowed(res,['POST']);
 if(!sameOrigin(req))return json(res,403,{erro:'Origem não autorizada.'});
 res.setHeader('x-request-id',requestId(req));
 let b;try{b=await body(req,16*1024)}catch{return json(res,400,{erro:'Requisição inválida.'})}
 const token=String(b.accessToken||''), password=String(b.password||'');
 if(!token)return json(res,400,{erro:'Link de recuperação inválido ou expirado.'});
 if(password.length<12)return json(res,400,{erro:'A nova senha deve ter pelo menos 12 caracteres.'});
 const r=await authUpdatePassword(token,password);if(!r.ok)return json(res,r.status===401?401:400,{erro:r.data?.msg||r.data?.message||'Não foi possível alterar a senha.'});
 return json(res,200,{ok:true});
};
