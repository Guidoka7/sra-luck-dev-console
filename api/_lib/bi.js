const crypto=require('crypto');
const {json,body,sameOrigin,methodNotAllowed}=require('./http');
const {requireSession,hasPermission}=require('./rbac');
const {audit}=require('./supabase');
const {getSecret}=require('./secrets');
const {sraConnection}=require('./sra-config');
const oauth=require('./bi-oauth');const rd=require('./bi-rd');
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function app(action,actor,payload=null,query=''){
 const c=await sraConnection();if(!c.base||!c.token)throw oauth.fail('BI_APP_CONNECTION_REQUIRED',503);
 let response;try{response=await fetch(c.base+'/api/admin/bi/collector/'+action+query,{method:payload?'POST':'GET',headers:{Accept:'application/json','Content-Type':'application/json','x-dev-console-token':c.token,'x-dev-actor-id':actor.id,'x-dev-actor-role':actor.role},body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:AbortSignal.timeout(18000)});}catch{throw oauth.fail('BI_APP_UNREACHABLE',502);}
 const result=await response.json().catch(()=>({}));if(!response.ok)throw oauth.fail(/^BI_[A-Z0-9_]+$/.test(result.codigo)?result.codigo:'BI_APP_HTTP_'+response.status,response.status);
 return payload?result.result:result;
}
async function step(runId,actor,connectionId){
 const lease=crypto.randomUUID();const run=await app('claim',actor,{run_id:runId,lease});
 try{
  if(run.source_id!==connectionId)throw oauth.fail('BI_SOURCE_CHANGED',409);
  const task=run.checkpoint.tasks[run.checkpoint.index];if(!task)throw oauth.fail('BI_CHECKPOINT_INVALID');
  const {connectionId:readId,page}=await rd.fetchPage(task);if(readId!==connectionId)throw oauth.fail('BI_SOURCE_CHANGED',409);
  const progress=rd.advance(run.checkpoint,page);
  const records=progress.split?[]:page.records.map(record=>rd.cleanRecord(record,task,run.mapping));
  if(new Set(records.map(x=>x.external_id)).size!==records.length)throw oauth.fail('BI_DUPLICATE_ID_IN_PAGE',502);
  return await app('commit',actor,{run_id:runId,lease,expected_version:run.version,batch_id:crypto.randomUUID(),entity:task.entity,records,checkpoint:progress.checkpoint,done:progress.done});
 }catch(e){
  const task=run.checkpoint.tasks?.[run.checkpoint.index];const code=/^BI_[A-Z0-9_]+$/.test(e.message)?e.message:'BI_COLLECTION_FAILED';
  await app('fail',actor,{run_id:runId,lease,code,details:{entity:task?.entity??null,page:task?.page??null,recordId:e.recordId??null},retry_after:e.retryAfter??30}).catch(()=>{});
  throw e;
 }
}
async function automation(req,action){
 if(action!=='step'||req.method!=='POST')return null;
 const input=String(req.headers.authorization||'');if(!input.startsWith('Bearer '))return null;
 const configured=await getSecret('BI_AUTOMATION_TOKEN');const token=input.slice(7);
 if(!configured||configured.length<32||Buffer.byteLength(token)!==Buffer.byteLength(configured)||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(configured)))throw oauth.fail('BI_AUTOMATION_UNAUTHORIZED',401);
 return {id:'bi-automation',role:'operator',machine:true};
}
const MANAGEMENT=new Set(['authorize','callback','mapping']);
async function handler(req,res){
 const action=String(req.query?.action||'status');
 try{
  if(!['GET','POST'].includes(req.method))return methodNotAllowed(res,['GET','POST']);
  const machine=await automation(req,action);
  if(!machine&&req.method==='POST'&&!sameOrigin(req))return json(res,403,{codigo:'ORIGIN_DENIED',erro:'Origem não autorizada.'});
  const actor=machine||await requireSession(req,res,MANAGEMENT.has(action)?'connectors.manage':req.method==='GET'?'integrations.view':'integrations.manage');if(!actor)return;
  if(action==='callback')res.setHeader('Referrer-Policy','no-referrer');
  if(action==='callback'&&req.method==='GET'){
   await oauth.callback(req,actor);await audit({actor_user_id:actor.id,action:'bi.oauth.authorized',resource:'bi',details:{provider:'rd_station'}});
   res.statusCode=303;res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Location','/bi.html?oauth=ok');return res.end();
  }
  const status=await oauth.status();
  if(action==='status'&&req.method==='GET'){
   let storage=null;let storageError=null;
   try{storage=await app('status',actor,null,status.connectionId?'?source='+status.connectionId:'');}catch(e){storageError=e.message;}
   return json(res,200,{oauth:status,storage,storageError,canManage:hasPermission(actor,'connectors.manage'),canRun:hasPermission(actor,'integrations.manage'),automationConfigured:String(await getSecret('BI_AUTOMATION_TOKEN')||'').length>=32,financial:{state:'later_phase'}});
  }
  if(action==='authorize'&&req.method==='POST')return json(res,200,await oauth.start(req,actor));
  if(!status.authorized)throw oauth.fail('BI_OAUTH_REQUIRED',409);
  const source=status.connectionId;
  if(action==='catalog'&&req.method==='GET'){
   const entity=String(req.query?.entity||'');if(![...rd.CATALOG,'stages'].includes(entity))throw oauth.fail('BI_ENTITY_INVALID');
   const offset=Number(req.query?.offset||0);if(!Number.isInteger(offset)||offset<0)throw oauth.fail('BI_PAGE_INVALID');
   return json(res,200,await app('catalog',actor,null,`?source=${source}&entity=${entity}&offset=${offset}`));
  }
  if(action==='issues'&&req.method==='GET'){
   const offset=Number(req.query?.offset||0);if(!Number.isInteger(offset)||offset<0)throw oauth.fail('BI_PAGE_INVALID');
   return json(res,200,await app('issues',actor,null,'?source='+source+'&offset='+offset));
  }
  if(req.method!=='POST')return methodNotAllowed(res,['POST']);
  const input=await body(req);if(JSON.stringify(input).length>80000)throw oauth.fail('BI_REQUEST_TOO_LARGE',413);
  let result;
  if(action==='start'){
   if(!['catalog','commercial'].includes(input.mode))throw oauth.fail('BI_MODE_INVALID');
   // Uma nova autorização registra outro dataset; nada é mesclado com a conta anterior.
   await app('register',actor,{source_id:source});
   result=await app('start',actor,{source_id:source,mode:input.mode,checkpoint:rd.initialCheckpoint(input.mode,input.since||null)});
   result={run_id:result.id,status:result.status,mode:result.mode};
  }else if(action==='mapping')result=await app('mapping',actor,{source_id:source,expected_version:input.expected_version,mapping:input.mapping});
  else if(action==='step'){
   let runId=input.run_id;
   if(!runId&&machine){const state=await app('status',actor,null,'?source='+source);runId=state.runs.find(r=>r.status==='running')?.id;if(!runId)return json(res,200,{ok:true,idle:true});}
   if(!ID.test(String(runId)))throw oauth.fail('BI_RUN_ID_INVALID');
   result=await step(runId,actor,source);
  }else if(action==='resume'){
   if(!ID.test(String(input.run_id)))throw oauth.fail('BI_RUN_ID_INVALID');
   const state=await app('status',actor,null,'?source='+source);if(!state.runs.some(r=>r.id===input.run_id))throw oauth.fail('BI_RUN_ID_INVALID');
   const run=await app('resume',actor,{run_id:input.run_id});result={run_id:run.id,status:run.status};
  }else return json(res,404,{erro:'Ação não encontrada.'});
  // Ações humanas auditadas, sem corpo comercial, segredos ou códigos OAuth.
  if(!machine)await audit({actor_user_id:actor.id,action:'bi.'+action,resource:'bi',details:{source_id:source,run_id:result?.run_id??null}});
  return json(res,200,{ok:true,result});
 }catch(e){const code=/^BI_[A-Z0-9_]+$/.test(e.message)?e.message:'BI_SERVICE_UNAVAILABLE';if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));return json(res,e.status||503,{erro:'Não foi possível concluir a operação do BI.',codigo:code});}
}
module.exports={handler,step,app,automation};
