const crypto=require('crypto');
const {rest}=require('./supabase');
const {getSecret}=require('./secrets');
const {readSession}=require('./session');
const TOKEN_URL='https://api.rd.services/oauth2/token';
function fail(code,status=400){return Object.assign(new Error(code),{status});}
function seal(value,connectionId){
 const secret=String(process.env.DEV_SESSION_SECRET||'');if(secret.length<32)throw fail('BI_VAULT_UNAVAILABLE',503);
 const key=crypto.createHash('sha256').update('sra-bi-oauth-v1:'+secret).digest();const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(connectionId));
 return {value:Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function open(value,connectionId){
 const secret=String(process.env.DEV_SESSION_SECRET||'');if(secret.length<32)throw fail('BI_VAULT_UNAVAILABLE',503);
 const key=crypto.createHash('sha256').update('sra-bi-oauth-v1:'+secret).digest();
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(connectionId));decipher.setAuthTag(Buffer.from(value.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.value,'base64')),decipher.final()]).toString('utf8'));
}
async function settings(){
 const [clientId,clientSecret,base]=await Promise.all(['BI_RD_CLIENT_ID','BI_RD_CLIENT_SECRET','BI_CONSOLE_BASE_URL'].map(k=>getSecret(k)));
 let origin;try{const u=new URL(base);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw 0;origin=u.origin;}catch{origin=null;}
 return {clientId,clientSecret,origin,redirectUri:origin?origin+'/api/bi/oauth/callback':null};
}
async function row(){return (await rest('dev_bi_oauth?provider=eq.rd_station&select=*',{method:'GET'}))?.[0]||null;}
async function status(){
 const config=await settings();let record=null;let storageReady=true;
 try{record=await row();}catch{storageReady=false;}
 return {configured:!!(config.clientId&&config.clientSecret&&config.origin),storageReady,redirectUri:config.redirectUri,
  authorized:!!(config.clientId&&config.clientSecret&&config.origin&&record&&record.client_id===config.clientId),connectionId:record?.connection_id??null,expiresAt:record?.expires_at??null,updatedAt:record?.updated_at??null};
}
async function start(req,actor){
 const c=await settings();if(!c.clientId||!c.clientSecret||!c.origin)throw fail('BI_OAUTH_CONFIG_REQUIRED');
 const current=new URL('https://'+String(req.headers.host||''));
 if(current.origin!==c.origin)throw fail('BI_USE_CANONICAL_CONSOLE');
 const session=readSession(req);if(!session?.jti)throw fail('BI_SESSION_REQUIRED',401);
 const state=crypto.randomBytes(32).toString('base64url');const connectionId=crypto.randomUUID();
 await rest('dev_bi_oauth_states?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE'});
 await rest('dev_bi_oauth_states',{method:'POST',body:JSON.stringify({state_hash:crypto.createHash('sha256').update(state).digest('hex'),actor_id:actor.id,session_id:session.jti,connection_id:connectionId,client_id:c.clientId,redirect_uri:c.redirectUri,expires_at:new Date(Date.now()+600000).toISOString()})});
 const url=new URL('https://accounts.rdstation.com/oauth/authorize');url.search=new URLSearchParams({response_type:'code',client_id:c.clientId,redirect_uri:c.redirectUri,state}).toString();
 return {authorizationUrl:url.toString()};
}
async function exchange(config,params){
 let response;try{response=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,...params}),redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw fail('BI_OAUTH_NETWORK',502);}
 if(!response.ok)throw fail('BI_OAUTH_HTTP_'+response.status,502);
 const tokens=await response.json();const seconds=Number(tokens.expires_in);
 if(typeof tokens.access_token!=='string'||!tokens.access_token||typeof tokens.refresh_token!=='string'||!tokens.refresh_token||!Number.isFinite(seconds)||seconds<60||seconds>86400)throw fail('BI_OAUTH_RESPONSE_INVALID',502);
 return {tokens:{access_token:tokens.access_token,refresh_token:tokens.refresh_token},expiresAt:new Date(Date.now()+seconds*1000).toISOString()};
}
async function callback(req,actor){
 const state=String(req.query?.state||''),code=String(req.query?.code||'');if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!code||code.length>4096)throw fail('BI_OAUTH_CALLBACK_INVALID');
 const session=readSession(req);if(!session?.jti)throw fail('BI_SESSION_REQUIRED',401);
 const stateHash=crypto.createHash('sha256').update(state).digest('hex');
 const matches=await rest(`dev_bi_oauth_states?state_hash=eq.${stateHash}&actor_id=eq.${encodeURIComponent(actor.id)}&session_id=eq.${encodeURIComponent(session.jti)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,{method:'DELETE'});
 const consumed=matches?.[0];if(!consumed)throw fail('BI_OAUTH_STATE_INVALID',403);
 const c=await settings();if(consumed.client_id!==c.clientId||consumed.redirect_uri!==c.redirectUri)throw fail('BI_OAUTH_CONFIG_CHANGED');
 const token=await exchange(c,{grant_type:'authorization_code',code,redirect_uri:c.redirectUri});
 // Consentimento novo recebe nova identidade de dataset: não mistura contas nem copia refresh token operacional.
 await rest('dev_bi_oauth?on_conflict=provider',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({provider:'rd_station',connection_id:consumed.connection_id,client_id:c.clientId,token_cipher:seal(token.tokens,consumed.connection_id),expires_at:token.expiresAt,updated_by:actor.id,version:1,lock_owner:null,lock_until:null,updated_at:new Date().toISOString()})});
 return {connectionId:consumed.connection_id};
}
async function accessToken({force=false}={}){
 const c=await settings();let record=await row();if(!c.clientId||!c.clientSecret||!c.origin||!record||record.client_id!==c.clientId)throw fail('BI_OAUTH_REQUIRED',409);
 if(!force&&Date.parse(record.expires_at)>Date.now()+300000)return {token:open(record.token_cipher,record.connection_id).access_token,connectionId:record.connection_id};
 const owner=crypto.randomUUID();let locked=false;
 try{
  record=await rest('rpc/dev_bi_claim_token',{method:'POST',body:JSON.stringify({p_owner:owner})});locked=true;
  if(!force&&Date.parse(record.expires_at)>Date.now()+300000)return {token:open(record.token_cipher,record.connection_id).access_token,connectionId:record.connection_id};
  const current=open(record.token_cipher,record.connection_id);const renewed=await exchange(c,{grant_type:'refresh_token',refresh_token:current.refresh_token});
  // Par de tokens salvo junto, protegido por versão e lease entre instâncias.
  await rest('rpc/dev_bi_save_token',{method:'POST',body:JSON.stringify({p_owner:owner,p_version:record.version,p_cipher:seal(renewed.tokens,record.connection_id),p_expires:renewed.expiresAt})});
  return {token:renewed.tokens.access_token,connectionId:record.connection_id};
 }catch(e){throw /^BI_[A-Z0-9_]+$/.test(e.message)?e:fail('BI_TOKEN_REFRESH_UNAVAILABLE',503);}
 finally{if(locked)await rest(`dev_bi_oauth?provider=eq.rd_station&lock_owner=eq.${owner}`,{method:'PATCH',body:JSON.stringify({lock_owner:null,lock_until:null})}).catch(()=>{});}
}
module.exports={settings,status,start,callback,accessToken,seal,open,fail};
