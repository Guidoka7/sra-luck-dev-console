const crypto = require('crypto');
const { json, rawBody, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { audit } = require('./_lib/supabase');

function permissionFor(path,method){
 const read=method==='GET'||method==='HEAD';
 if(path==='/api/health'||path==='/api/ready')return 'monitoring.view';
 if(path.includes('/monitoramento')||path.includes('/diagnostico'))return 'monitoring.view';
 if(path.startsWith('/api/admin/central/')||path.startsWith('/api/admin/previsao-liberacoes'))return read?'v46.inspect':'v46.correct';
 if(path.startsWith('/api/admin/financeiro/')||path.startsWith('/api/admin/credit-ops/finance/'))return read?'finance.inspect':'finance.correct';
 if(path.startsWith('/api/admin/monitoramento-app')||path.includes('/liberar-acesso-app'))return read?'app.inspect':'app.correct';
 if(path.startsWith('/api/admin/notificacoes/'))return read?'notifications.view':'notifications.manage';
 if(path.startsWith('/api/admin/integrations/'))return read?'integrations.view':'integrations.manage';
 if(path.startsWith('/api/admin/staff'))return read?'sra.staff.view':'users.manage';
 if(path.startsWith('/api/admin/credit-ops/club')||path.startsWith('/api/admin/credit-ops/rewards'))return read?'monitoring.view':'finance.correct';
 if(path.startsWith('/api/admin/configuracoes'))return read?'monitoring.view':'agents.configure';
 if(path.startsWith('/api/admin/visao-geral'))return 'monitoring.view';
 if(path.startsWith('/api/admin/clientes'))return read?'app.inspect':'app.correct';
 return 'monitoring.view';
}
function safePath(value){
 const p=String(value||'');if(!p.startsWith('/api/'))return null;
 try{const u=new URL(p,'https://local.invalid');if(u.origin!=='https://local.invalid')return null;return u.pathname+u.search}catch{return null}
}
module.exports=async function handler(req,res){
 if(!['GET','HEAD','POST','PATCH','PUT','DELETE'].includes(req.method))return methodNotAllowed(res,['GET','HEAD','POST','PATCH','PUT','DELETE']);
 const path=safePath(req.query?.path);if(!path)return json(res,400,{erro:'Endpoint de destino inválido.',codigo:'SRA_PROXY_PATH_INVALID'});
 const actor=await requireSession(req,res,permissionFor(path,req.method));if(!actor)return;
 const base=String(process.env.SRA_LUCK_BASE_URL||'https://sra-luck-react.vercel.app').replace(/\/$/,'');const token=String(process.env.SRA_LUCK_SERVICE_TOKEN||'');
 const publicProbe=path==='/api/health'||path==='/api/ready';
 if(!publicProbe&&!token)return json(res,503,{erro:'Conector server-to-server com o Sra Luck ainda não está configurado.',codigo:'SRA_CONNECTOR_NOT_CONFIGURED'});
 const rid=requestId(req);res.setHeader('x-request-id',rid);
 const headers={'Accept':'application/json','x-request-id':rid,'x-dev-actor-id':actor.id,'x-dev-actor-role':actor.role};
 const ct=req.headers['content-type'];if(ct)headers['Content-Type']=ct;if(token)headers['x-dev-console-token']=token;
 let payload;try{if(!['GET','HEAD'].includes(req.method))payload=await rawBody(req)}catch(e){return json(res,e.statusCode||400,{erro:'Payload inválido.'})}
 const started=Date.now();let upstream;
 try{upstream=await fetch(base+path,{method:req.method,headers,body:payload&&payload.length?payload:undefined,redirect:'manual',cache:'no-store'})}catch{return json(res,502,{erro:'Não foi possível conectar ao Sra Luck.',codigo:'SRA_UPSTREAM_UNREACHABLE'})}
 const buf=Buffer.from(await upstream.arrayBuffer());res.statusCode=upstream.status;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json; charset=utf-8');const upstreamRid=upstream.headers.get('x-request-id');if(upstreamRid)res.setHeader('x-upstream-request-id',upstreamRid);
 if(!['GET','HEAD'].includes(req.method)){await audit({actor_user_id:actor.id,action:'sra.proxy.mutation',resource:path,details:{method:req.method,status:upstream.status,duration_ms:Date.now()-started,request_id:rid,upstream_request_id:upstreamRid||null}})}
 res.end(buf);
};
