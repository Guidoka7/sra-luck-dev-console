const crypto=require('crypto');
const oauth=require('./bi-oauth');
const BASE='https://api.rd.services/crm/v2';
const CATALOG=['pipelines','sources','campaigns','users','custom_fields','lost_reasons'];
const COMMERCIAL=['contacts','deals','meetings','tasks'];
const FIELDS=['total_price','one_time_price','recurrence_price','expected_close_date','rating','created_by_id','completed_by_id','duration_minutes','subject','organization_id','id','name','created_at','updated_at','closed_at','status','amount','value','currency','pipeline_id','stage_id','source_id','campaign_id','owner_id','owner_ids','contact_id','contact_ids','deal_id','deal_ids','organizer_id','responsible_id','starts_at','ends_at','due_date','completed_at','type','lost_reason_id','slug','label','entity','options','display_rules','order','is_active','required'];
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function initialCheckpoint(mode,since=null,now=Date.now()){
 if(!['catalog','commercial'].includes(mode))throw oauth.fail('BI_MODE_INVALID');
 if(since!==null&&(!Number.isFinite(Date.parse(since))||Date.parse(since)>=now))throw oauth.fail('BI_WINDOW_INVALID');
 const end=Math.floor(now/1000)*1000+1000;
 return {schema_version:1,index:0,tasks:(mode==='catalog'?CATALOG:COMMERCIAL).map(entity=>({entity,page:1,...(mode==='commercial'?{window:{from:since?Date.parse(since):0,to:end,field:since||!['contacts','deals'].includes(entity)?'updated_at':'created_at'}}:{})})),completed:[],since,cutoff:new Date(end).toISOString()};
}
function pathFor(task){
 if(![...CATALOG,...COMMERCIAL,'stages'].includes(task?.entity)||!Number.isInteger(task.page)||task.page<1)throw oauth.fail('BI_CHECKPOINT_INVALID');
 if(task.entity==='stages'&&!identifier(task.pipeline_id))throw oauth.fail('BI_PIPELINE_INVALID');
 return task.entity==='stages'?`/pipelines/${encodeURIComponent(task.pipeline_id)}/stages`:`/${task.entity}`;
}
function urlFor(task){
 const url=new URL(BASE+pathFor(task));url.searchParams.set('page[number]',String(task.page));url.searchParams.set('page[size]','100');
 if(['contacts','deals'].includes(task.entity))url.searchParams.set('sort[created_at]','asc');
 if(task.window){
  const {from,to,field}=task.window;if(!['created_at','updated_at'].includes(field)||!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw oauth.fail('BI_WINDOW_INVALID');
  const date=n=>new Date(n).toISOString().slice(0,19).replace('T',' ');
  url.searchParams.set('filter',`${field}:>="${date(from)}" ${field}:<"${date(to)}"`);
 }
 return url;
}
function parsePage(response,task){
 if(!response||!Array.isArray(response.data)||response.data.length>100)throw oauth.fail('BI_RD_RESPONSE_INVALID',502);
 const next=response.links?.next;let nextPage=null;
 if(next){let u;try{u=new URL(next,BASE+'/')}catch{throw oauth.fail('BI_RD_PAGINATION_INVALID',502)}
  const n=Number(u.searchParams.get('page[number]'));
  if(u.origin!=='https://api.rd.services'||u.pathname!=='/crm/v2'+pathFor(task)||!Number.isInteger(n)||n!==task.page+1||u.username||u.password)throw oauth.fail('BI_RD_PAGINATION_INVALID',502);
  nextPage=n;
 } else if(response.data.length===100)nextPage=task.page+1;
 const total=Number(response.total??response.meta?.total??0);
 if(response.data.length===0&&nextPage)throw oauth.fail('BI_RD_EMPTY_PAGE_WITH_NEXT',502);
 return {records:response.data,nextPage,total};
}
function advance(checkpoint,page){
 const next=structuredClone(checkpoint);const task=next.tasks[next.index];let split=false;
 // Divisão antes do teto do RD. Releitura das metades é segura pela chave de origem.
 if(task.window&&(page.total>=9000||task.page*100>=9000&&page.records.length===100)){
  const middle=Math.floor((task.window.from+task.window.to)/2000)*1000;
  if(middle<=task.window.from||middle>=task.window.to)throw oauth.fail('BI_RD_WINDOW_TOO_DENSE',409);
  next.tasks.splice(next.index,1,{...task,page:1,window:{...task.window,to:middle}},{...task,page:1,window:{...task.window,from:middle}});split=true;
 } else {
  if(task.entity==='pipelines')for(const item of page.records){if(!identifier(item.id))throw oauth.fail('BI_RECORD_ID_INVALID',502);if(!next.tasks.some(t=>t.entity==='stages'&&t.pipeline_id===item.id))next.tasks.push({entity:'stages',pipeline_id:item.id,page:1});}
  if(page.nextPage)task.page=page.nextPage;
  else{next.completed.push({entity:task.entity,pipeline_id:task.pipeline_id??null,window:task.window??null});next.index++;}
 }
 if(JSON.stringify(next).length>64000)throw oauth.fail('BI_CHECKPOINT_CAPACITY',409);
 return {checkpoint:next,done:next.index>=next.tasks.length,split};
}
function cleanRecord(raw,task,mapping){
 if(!raw||!identifier(raw.id))throw Object.assign(oauth.fail('BI_RECORD_ID_INVALID',502),{recordId:identifier(raw?.id)?raw.id:null});
 const data={};for(const key of FIELDS)if(raw[key]!==undefined)data[key]=raw[key];
 // Relações explícitas, sem inferência por nome e sem copiar e-mails/notas/documentos.
 for(const key of ['pipeline','stage','source','campaign','owner','contact','deal','lost_reason'])if(data[key+'_id']===undefined&&identifier(raw[key]?.id))data[key+'_id']=raw[key].id;
 for(const key of ['contact','deal'])if(!data[key+'_ids']&&Array.isArray(raw[key+'s']))data[key+'_ids']=raw[key+'s'].map(x=>typeof x==='string'?x:x?.id).filter(identifier);
 if(task.entity==='stages')data.pipeline_id=task.pipeline_id;
 if(['contacts','deals'].includes(task.entity)){
  const entity=task.entity==='contacts'?'contact':'deal';const chosen=new Set();
  for(const funnel of mapping?.funnels||[]){if(entity==='deal'&&funnel.pipeline_id!==data.pipeline_id)continue;for(const f of Object.values(funnel.fields||{}))if(f.entity===entity&&f.kind==='custom')chosen.add(f.key);}
  const cf=raw.custom_fields;const values=Array.isArray(cf)?Object.fromEntries(cf.map(f=>[f.slug||f.custom_field?.slug,f.value])):cf&&typeof cf==='object'?cf:{};
  data.custom_fields=Object.fromEntries([...chosen].filter(k=>Object.hasOwn(values,k)).map(k=>[k,values[k]]));
 }
 if(JSON.stringify(data).length>40000)throw Object.assign(oauth.fail('BI_RECORD_TOO_LARGE',502),{recordId:raw.id});
 const stamp=raw.updated_at??null;if(stamp!==null&&(typeof stamp!=='string'||!Number.isFinite(Date.parse(stamp))))throw Object.assign(oauth.fail('BI_RECORD_DATE_INVALID',502),{recordId:raw.id});
 return {external_id:raw.id,data,source_updated_at:stamp,payload_hash:hash(data)};
}
async function fetchPage(task){
 let access=await oauth.accessToken();let response;
 async function read(token){try{return await fetch(urlFor(task),{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw oauth.fail('BI_RD_NETWORK',502);}}
 response=await read(access.token);
 if(response.status===401){access=await oauth.accessToken({force:true});response=await read(access.token);}
 if(!response.ok){const e=oauth.fail('BI_RD_HTTP_'+response.status,response.status===429?429:502);const retry=response.headers.get('Retry-After');const seconds=Number(retry);e.retryAfter=Number.isFinite(seconds)&&seconds>0?Math.min(86400,Math.ceil(seconds)):30;throw e;}
 return {connectionId:access.connectionId,page:parsePage(await response.json(),task)};
}
module.exports={CATALOG,COMMERCIAL,FIELDS,initialCheckpoint,pathFor,urlFor,parsePage,advance,cleanRecord,fetchPage,hash};
