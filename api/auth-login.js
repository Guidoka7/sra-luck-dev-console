const crypto = require('crypto');
const { json, body, sameOrigin, setCookie, isHttps, clientIp, requestId, methodNotAllowed } = require('./_lib/http');
const { issueSession, COOKIE_NAME, SESSION_SECONDS } = require('./_lib/session');
const { authPassword, getProfileByAuth, rest, audit } = require('./_lib/supabase');

function actorKey(req) {
  const secret = process.env.DEV_SESSION_SECRET || 'dev-console';
  return crypto.createHmac('sha256', secret).update(clientIp(req)).digest('hex').slice(0,32);
}
async function recentFailures(key) {
  const since = new Date(Date.now()-15*60*1000).toISOString();
  try {
    const rows = await rest(`dev_auth_events?actor_key=eq.${key}&event=eq.login_failed&created_at=gte.${encodeURIComponent(since)}&select=id`, { method:'GET', headers:{Prefer:'count=exact'} });
    return Array.isArray(rows) ? rows.length : 0;
  } catch { return 0; }
}
async function logAuth(event, key, email, detail={}) {
  try { await rest('dev_auth_events',{method:'POST',body:JSON.stringify({event,actor_key:key,email_hint:String(email||'').slice(0,180),details:detail})}); } catch(_) {}
}
module.exports = async function handler(req,res){
  if(req.method!=='POST') return methodNotAllowed(res,['POST']);
  if(!sameOrigin(req)) return json(res,403,{erro:'Origem não autorizada.',codigo:'DEV_CSRF'});
  const rid=requestId(req);res.setHeader('x-request-id',rid);
  let data;try{data=await body(req,16*1024)}catch(e){return json(res,e.statusCode||400,{erro:'Requisição inválida.'})}
  const email=String(data.email||'').trim().toLowerCase(), password=String(data.password||'');
  if(!email||!password) return json(res,400,{erro:'Informe e-mail e senha.'});
  const key=actorKey(req);
  if(await recentFailures(key)>=10) return json(res,429,{erro:'Muitas tentativas de acesso. Aguarde alguns minutos.',codigo:'DEV_LOGIN_RATE_LIMIT'});
  let auth;try{auth=await authPassword(email,password)}catch{return json(res,503,{erro:'Serviço de autenticação indisponível.',codigo:'DEV_AUTH_UNAVAILABLE'})}
  if(!auth.ok||!auth.data?.user?.id){await logAuth('login_failed',key,email,{status:auth.status});return json(res,401,{erro:'E-mail ou senha inválidos.'})}
  let profile;try{profile=await getProfileByAuth(auth.data.user.id)}catch{return json(res,503,{erro:'Não foi possível validar seu perfil agora.'})}
  if(!profile||!profile.active){await logAuth('login_denied',key,email,{reason:'profile_inactive_or_missing'});return json(res,403,{erro:'Seu usuário não possui acesso ativo ao Dev Console.'})}
  const token=issueSession(profile);setCookie(res,COOKIE_NAME,token,{maxAge:SESSION_SECONDS,secure:isHttps(req),httpOnly:true,sameSite:'Lax'});
  try{await rest(`dev_users?id=eq.${encodeURIComponent(profile.id)}`,{method:'PATCH',body:JSON.stringify({last_login_at:new Date().toISOString(),updated_at:new Date().toISOString()})})}catch(_){}
  await logAuth('login_success',key,email,{role:profile.role});await audit({actor_user_id:profile.id,action:'auth.login',resource:'dev_console',details:{request_id:rid}});
  return json(res,200,{ok:true,user:{id:profile.id,name:profile.name,email:profile.email,role:profile.role}});
};
