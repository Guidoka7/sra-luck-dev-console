const { json, body, sameOrigin, methodNotAllowed, requestId } = require('./_lib/http');
const { authRecover } = require('./_lib/supabase');
module.exports=async function handler(req,res){
 if(req.method!=='POST')return methodNotAllowed(res,['POST']);
 if(!sameOrigin(req))return json(res,403,{erro:'Origem não autorizada.'});
 res.setHeader('x-request-id',requestId(req));
 let b;try{b=await body(req,8*1024)}catch{return json(res,400,{erro:'Requisição inválida.'})}
 const email=String(b.email||'').trim().toLowerCase();if(!email)return json(res,400,{erro:'Informe o e-mail.'});
 const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0];const host=req.headers['x-forwarded-host']||req.headers.host;const redirect=`${proto}://${host}/reset-password.html`;
 try{await authRecover(email,redirect)}catch(_){}
 return json(res,200,{ok:true,message:'Se o e-mail estiver cadastrado, você receberá as instruções de redefinição.'});
};
