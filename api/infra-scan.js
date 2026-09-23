const crypto=require('crypto');
const { json, body, methodNotAllowed, requestId, sameOrigin } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
const { rest, audit } = require('./_lib/supabase');
const { detect, applyAction, autoResolve, persistIncidents } = require('./_lib/problems');
const customApis = require('./_lib/custom-apis');
const agents = require('./_lib/agents');
const { hasPermission } = require('./_lib/rbac');
const { getInfraOverview, fetchCloudflareWorker, fetchDevSupabaseMetrics, fetchSupabaseMetrics, fetchSupabaseLogs, fetchVercel, runtimeMetrics } = require('./_lib/infra');

function safeEqual(a,b){
 const A=Buffer.from(String(a||'')),B=Buffer.from(String(b||''));
 return A.length===B.length&&A.length>0&&crypto.timingSafeEqual(A,B);
}
function cronAuthorized(req){
 const secret=String(process.env.CRON_SECRET||'');
 const auth=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 return Boolean(secret&&safeEqual(secret,auth));
}
async function loadThresholds(){
 try{return await rest('dev_resource_thresholds?enabled=eq.true&select=source,metric_key,label,warning_value,critical_value,comparator,sustain_seconds,description',{method:'GET'})}catch{return[]}
}
function thresholdState(value,t){
 if(value==null||!Number.isFinite(Number(value)))return'unknown';const v=Number(value),warn=Number(t.warning_value),crit=Number(t.critical_value);
 if(t.comparator==='lte'){if(Number.isFinite(crit)&&v<=crit)return'critical';if(Number.isFinite(warn)&&v<=warn)return'warning';return'healthy'}
 if(Number.isFinite(crit)&&v>=crit)return'critical';if(Number.isFinite(warn)&&v>=warn)return'warning';return'healthy';
}
async function sustained(source,key,current,t,observedAt){
 if(!['warning','critical'].includes(current.state))return false;
 const seconds=Math.max(0,Number(t.sustain_seconds||0));if(seconds===0)return true;
 const since=new Date(new Date(observedAt).getTime()-seconds*1000).toISOString();
 let rows=[];try{rows=await rest(`dev_metric_snapshots?source=eq.${encodeURIComponent(source)}&metric_key=eq.${encodeURIComponent(key)}&observed_at=gte.${encodeURIComponent(since)}&select=metric_value,state,observed_at&order=observed_at.asc&limit=500`,{method:'GET'})}catch{return false}
 if(!rows.length)return false;const earliest=new Date(rows[0].observed_at).getTime();const coverage=(new Date(observedAt).getTime()-earliest)/1000;if(coverage<seconds*.8)return false;
 // O snapshot atual já foi persistido antes desta consulta; não duplicá-lo na janela.
 const all=rows.filter(x=>Number.isFinite(Number(x.metric_value??x.value)));if(all.length<2)return false;
 const bad=all.filter(x=>['warning','critical'].includes(x.state||thresholdState(Number(x.metric_value??x.value),t))).length;
 return bad/all.length>=.8;
}
async function upsertIncident(signal,t,observedAt){
 const fingerprint=`infra:${signal.source}:${signal.key}`;
 let existing=[];try{existing=await rest(`dev_incidents?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=id,status,occurrence_count,severity&limit=1`,{method:'GET'})}catch{}
 const severity=signal.state==='critical'?'critical':'high';
 if(existing[0]){
  const row=existing[0];const nextStatus=row.status==='resolved'?'reopened':row.status;
  const updated=await rest(`dev_incidents?id=eq.${encodeURIComponent(row.id)}`,{method:'PATCH',body:JSON.stringify({status:nextStatus,severity,occurrence_count:Number(row.occurrence_count||0)+1,last_seen_at:observedAt,metadata:{source:signal.source,metric_key:signal.key,value:signal.value,unit:signal.unit,warning:t.warning_value,critical:t.critical_value,sustain_seconds:t.sustain_seconds}})});
  try{await rest('dev_incident_events',{method:'POST',body:JSON.stringify({incident_id:row.id,event_type:'signal_repeated',message:`${signal.label} permanece ${signal.state}.`,details:{value:signal.value,unit:signal.unit}})})}catch{}
  return updated?.[0]||row;
 }
 const created=await rest('dev_incidents',{method:'POST',body:JSON.stringify({fingerprint,title:`${signal.label} em estado ${signal.state==='critical'?'crítico':'degradado'}`,module:'Infraestrutura',severity,status:'open',occurrence_count:1,affected_entities:0,first_seen_at:observedAt,last_seen_at:observedAt,source:'infrastructure',source_reference:`${signal.source}:${signal.key}`,metadata:{source:signal.source,metric_key:signal.key,value:signal.value,unit:signal.unit,warning:t.warning_value,critical:t.critical_value,sustain_seconds:t.sustain_seconds}})});
 const incident=created?.[0];if(incident)try{await rest('dev_incident_events',{method:'POST',body:JSON.stringify({incident_id:incident.id,event_type:'opened',message:'Infrastructure & Resource Guardian abriu o incidente após a condição permanecer sustentada.',details:{signal,t}})})}catch{}
 return incident||null;
}
async function markRecovered(signal,observedAt){
 const fingerprint=`infra:${signal.source}:${signal.key}`;let rows=[];try{rows=await rest(`dev_incidents?fingerprint=eq.${encodeURIComponent(fingerprint)}&status=in.(open,investigating,reopened)&select=id,status&limit=1`,{method:'GET'})}catch{}
 const row=rows?.[0];if(!row)return null;
 await rest(`dev_incidents?id=eq.${encodeURIComponent(row.id)}`,{method:'PATCH',body:JSON.stringify({status:'mitigated',last_seen_at:observedAt,metadata:{recovered_signal:true,value:signal.value,unit:signal.unit}})});
 try{await rest('dev_incident_events',{method:'POST',body:JSON.stringify({incident_id:row.id,event_type:'signal_recovered',message:'O sinal voltou à faixa saudável. Incidente marcado como mitigado e aguarda confirmação humana para resolução.',details:{value:signal.value,unit:signal.unit}})})}catch{}
 return row.id;
}
async function persistScan(overview){
 const observedAt=overview.generatedAt;const thresholds=await loadThresholds();const byKey=new Map(thresholds.map(t=>[`${t.source}:${t.metric_key}`,t]));const metrics=[];
 for(const signal of overview.signals||[]){const t=byKey.get(`${signal.source}:${signal.key}`)||{warning_value:signal.warn,critical_value:signal.crit,comparator:'gte',sustain_seconds:900,label:signal.label};signal.state=thresholdState(signal.value,t);metrics.push({source:signal.source,metric_key:signal.key,metric_value:signal.value,unit:signal.unit,state:signal.state,dimensions:{label:signal.label},observed_at:observedAt});}
 if(metrics.length)await rest('dev_metric_snapshots',{method:'POST',body:JSON.stringify(metrics)});
 const p=overview.providers||{};const scans=[];
 if(p.supabase?.configured!==false)scans.push({source:'supabase',status:p.supabase.ok?(overview.signals.some(s=>s.source==='supabase'&&s.state==='critical')?'critical':overview.signals.some(s=>s.source==='supabase'&&s.state==='warning')?'warning':'healthy'):(p.supabase.status||'down'),summary:{memory:p.supabase.metrics?.memory,swap:p.supabase.metrics?.swap,disk:p.supabase.metrics?.disk,rates:p.supabase.metrics?.rates,rawCounters:{cpuCounters:p.supabase.metrics?.cpuCounters,ioCounters:p.supabase.metrics?.ioCounters},oomKills:p.supabase.metrics?.oomKills,postgresRestarts:p.supabase.metrics?.postgresRestarts,errorCount:p.supabase.logs?.count||0},observed_at:observedAt});
 if(p.devSupabase?.configured!==false)scans.push({source:'dev_supabase',status:p.devSupabase.ok?(overview.signals.some(s=>s.source==='dev_supabase'&&s.state==='critical')?'critical':overview.signals.some(s=>s.source==='dev_supabase'&&s.state==='warning')?'warning':'healthy'):(p.devSupabase.status||'down'),summary:{database:p.devSupabase.database,memory:p.devSupabase.metrics?.memory,swap:p.devSupabase.metrics?.swap,disk:p.devSupabase.metrics?.disk,rates:p.devSupabase.metrics?.rates,rawCounters:{cpuCounters:p.devSupabase.metrics?.cpuCounters,ioCounters:p.devSupabase.metrics?.ioCounters},oomKills:p.devSupabase.metrics?.oomKills,postgresRestarts:p.devSupabase.metrics?.postgresRestarts},observed_at:observedAt});
 if(p.cloudflare?.configured!==false)scans.push({source:'cloudflare',status:p.cloudflare.ok?'healthy':(p.cloudflare.status||'down'),summary:{metrics:p.cloudflare.metrics,scriptName:p.cloudflare.scriptName},observed_at:observedAt});
 scans.push({source:'dev_runtime',status:'healthy',summary:{metrics:p.runtime?.metrics},observed_at:observedAt});
 if(p.vercel?.configured!==false)scans.push({source:'vercel',status:p.vercel.ok?'healthy':(p.vercel.status||'down'),summary:{latest:p.vercel.latest},observed_at:observedAt});
 if(p.storage?.configured!==false)scans.push({source:'storage',status:p.storage.ok?'healthy':(p.storage.status||'down'),summary:{checks:p.storage.checks,totalBuckets:p.storage.totalBuckets,latencyMs:p.storage.latencyMs},observed_at:observedAt});
 if(p.backups?.configured!==false)scans.push({source:'backups',status:p.backups.status||'unknown',summary:{latestAt:p.backups.latestAt,ageHours:p.backups.ageHours,count:p.backups.count,latencyMs:p.backups.latencyMs},observed_at:observedAt});
 scans.push({source:'guardian',status:p.guardian?.status||'healthy',summary:{previousRunAt:p.guardian?.lastRunAt,ageHours:p.guardian?.ageHours},observed_at:observedAt});
 if(scans.length)await rest('dev_infra_scans',{method:'POST',body:JSON.stringify(scans)});
 const incidents=[];const recovered=[];
 for(const signal of overview.signals||[]){const t=byKey.get(`${signal.source}:${signal.key}`);if(!t)continue;if(['warning','critical'].includes(signal.state)){if(await sustained(signal.source,signal.key,{...signal,metric_value:signal.value},t,observedAt)){const inc=await upsertIncident(signal,t,observedAt);if(inc)incidents.push(inc)}}else if(signal.state==='healthy'){const id=await markRecovered(signal,observedAt);if(id)recovered.push(id)}}
 return {observedAt,metricCount:metrics.length,scanCount:scans.length,incidentsOpenedOrUpdated:incidents.length,incidentsMitigated:recovered.length};
}
module.exports=async function handler(req,res){
 const mode=String(req.query?.mode||'scan');
 res.setHeader('x-request-id',requestId(req));

 // Central de Problemas (rewrite /api/problemas). Mora aqui para não criar uma
 // nova Vercel Function: o plano Hobby limita o total de Functions.
 if(mode==='problems'){
  if(req.method==='GET'){
   const actor=await requireSession(req,res,'monitoring.view');if(!actor)return;
   try{return json(res,200,await detect(actor))}
   catch(e){return json(res,503,{erro:'Não foi possível montar a Central de Problemas agora.',codigo:'PROBLEMS_UNAVAILABLE',detalhe:e?.message||null})}
  }
  if(req.method==='POST'){
   if(!sameOrigin(req))return json(res,403,{erro:'Origem da requisição não autorizada.',codigo:'ORIGIN_DENIED'});
   const actor=await requireSession(req,res,'monitoring.view');if(!actor)return;
   let input;try{input=await body(req)}catch(e){return json(res,e.statusCode||400,{erro:'Payload inválido.'})}
   const problemaId=String(input?.problema||'').slice(0,200),actionId=String(input?.acao||'').slice(0,80);
   if(!problemaId||!actionId)return json(res,400,{erro:'Informe o problema e a correção.',codigo:'PROBLEM_INPUT_INVALID'});
   try{const r=await applyAction({actor,problemaId,actionId,params:input?.params||null});return json(res,r.status,r.body)}
   catch(e){return json(res,500,{erro:'Falha ao aplicar a correção.',codigo:'PROBLEM_FIX_FAILED',detalhe:e?.message||null})}
  }
  return methodNotAllowed(res,['GET','POST']);
 }

 // Agentes (rewrite /api/agentes): resumo em linguagem simples e análise por IA.
 if(mode==='agents'){
  if(req.method==='GET'){
   const actor=await requireSession(req,res,'monitoring.view');if(!actor)return;
   try{return json(res,200,await agents.briefing(actor))}
   catch(e){return json(res,503,{erro:'Os agentes não conseguiram montar o resumo agora.',codigo:'AGENTS_UNAVAILABLE',detalhe:e?.message||null})}
  }
  if(req.method==='POST'){
   if(!sameOrigin(req))return json(res,403,{erro:'Origem da requisição não autorizada.',codigo:'ORIGIN_DENIED'});
   const actor=await requireSession(req,res,'monitoring.view');if(!actor)return;
   let input;try{input=await body(req)}catch(e){return json(res,e.statusCode||400,{erro:'Payload inválido.'})}
   if(input?.action!=='analisar')return json(res,400,{erro:'Ação desconhecida.'});
   const r=await agents.analisarComIA(actor,String(input?.problema||'').slice(0,200));
   if(r.ok)await audit({actor_user_id:actor.id,action:'agents.ai_analysis',resource:'problems',resource_id:String(input.problema).slice(0,200),details:{modelo:r.modelo}});
   const {status,...payload}=r;return json(res,status,payload);
  }
  return methodNotAllowed(res,['GET','POST']);
 }

 // APIs personalizadas (rewrite /api/custom-apis).
 if(mode==='custom-apis'){
  if(req.method==='GET'){
   const actor=await requireSession(req,res,'integrations.view');if(!actor)return;
   try{
    if(String(req.query?.check||'')==='1'){const r=await customApis.checkAll();return json(res,200,{ok:true,disponivel:r.available,apis:r.apis})}
    return json(res,200,{ok:true,disponivel:true,apis:await customApis.list()});
   }catch(e){return json(res,200,{ok:true,disponivel:false,apis:[],erro:'Tabela dev_custom_apis ainda não criada (aplique supabase/003_custom_apis.sql).'})}
  }
  if(req.method!=='POST')return methodNotAllowed(res,['GET','POST']);
  if(!sameOrigin(req))return json(res,403,{erro:'Origem da requisição não autorizada.',codigo:'ORIGIN_DENIED'});
  const actor=await requireSession(req,res,'integrations.view');if(!actor)return;
  let input;try{input=await body(req)}catch(e){return json(res,e.statusCode||400,{erro:'Payload inválido.'})}
  const action=String(input?.action||'');const id=String(input?.id||'').replace(/[^0-9a-f-]/gi,'').slice(0,36);
  const manage=['save','delete','toggle'].includes(action);
  if(manage&&!hasPermission(actor,'integrations.manage'))return json(res,403,{erro:'Seu perfil não pode alterar APIs personalizadas.',codigo:'DEV_PERMISSION_DENIED',permission:'integrations.manage'});
  try{
   if(action==='save'){
    const {errors,row}=customApis.validate(input);if(errors.length)return json(res,400,{erro:errors.join(' '),codigo:'CUSTOM_API_INVALID'});
    const saved=id?await rest(`dev_custom_apis?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({...row,updated_at:new Date().toISOString()})}):await rest('dev_custom_apis',{method:'POST',body:JSON.stringify({...row,created_by:actor.id})});
    const api=saved?.[0];if(!api)return json(res,404,{erro:'API não encontrada.'});
    await audit({actor_user_id:actor.id,action:id?'custom_api.update':'custom_api.create',resource:'custom_api',resource_id:api.id,details:{name:api.name,host:new URL(api.base_url).host}});
    return json(res,200,{ok:true,api:await customApis.checkAndStore(api)});
   }
   if(!id)return json(res,400,{erro:'Informe a API.'});
   const found=(await rest(`dev_custom_apis?id=eq.${id}&select=${customApis.FIELDS}&limit=1`,{method:'GET'}))?.[0];
   if(!found)return json(res,404,{erro:'API não encontrada.'});
   if(action==='test')return json(res,200,{ok:true,api:await customApis.checkAndStore(found)});
   if(action==='toggle'){const r=await rest(`dev_custom_apis?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({enabled:!found.enabled,updated_at:new Date().toISOString()})});await audit({actor_user_id:actor.id,action:'custom_api.toggle',resource:'custom_api',resource_id:id,details:{enabled:!found.enabled}});return json(res,200,{ok:true,api:r?.[0]})}
   if(action==='delete'){await rest(`dev_custom_apis?id=eq.${id}`,{method:'DELETE'});await audit({actor_user_id:actor.id,action:'custom_api.delete',resource:'custom_api',resource_id:id,details:{name:found.name}});return json(res,200,{ok:true})}
   return json(res,400,{erro:'Ação desconhecida.'});
  }catch(e){return json(res,503,{erro:'Não foi possível salvar. Confirme se supabase/003_custom_apis.sql foi aplicado.',detalhe:e?.message||null})}
 }

 if(mode!=='scan'){
  if(req.method!=='GET')return methodNotAllowed(res,['GET']);
  const actor=await requireSession(req,res,'infrastructure.view');if(!actor)return;

  if(mode==='cloudflare')return json(res,200,await fetchCloudflareWorker());

  if(mode==='dev-supabase'){
   try{
    const data=await fetchDevSupabaseMetrics();
    return json(res,data.ok?200:(data.configured===false?200:503),data);
   }catch(_){
    return json(res,503,{erro:'Não foi possível consultar o Supabase do Dev Console.',codigo:'DEV_SUPABASE_INFRA_UNAVAILABLE'});
   }
  }

  if(mode==='history'){
   const source=String(req.query?.source||'supabase').replace(/[^a-z0-9_-]/gi,'').slice(0,60);
   const metric=String(req.query?.metric||'memory_usage_percent').replace(/[^a-z0-9_.-]/gi,'').slice(0,100);
   const hours=Math.min(Math.max(Number(req.query?.hours||24),1),720);
   const since=new Date(Date.now()-hours*3600000).toISOString();
   try{
    const rows=await rest(`dev_metric_snapshots?source=eq.${encodeURIComponent(source)}&metric_key=eq.${encodeURIComponent(metric)}&observed_at=gte.${encodeURIComponent(since)}&select=metric_value,state,unit,observed_at&order=observed_at.asc&limit=2000`,{method:'GET'});
    return json(res,200,{ok:true,source,metric,hours,points:rows||[]});
   }catch(_){
    return json(res,503,{erro:'Não foi possível carregar o histórico de infraestrutura.',codigo:'INFRA_HISTORY_UNAVAILABLE'});
   }
  }

  if(mode==='overview'){
   const overview=await getInfraOverview({includeLogs:true});
   return json(res,200,overview);
  }

  if(mode==='runtime')return json(res,200,{...runtimeMetrics(),generatedAt:new Date().toISOString()});

  if(mode==='supabase'){
   const hours=Math.min(Math.max(Number(req.query?.hours||1),1),24);
   const [metrics,logs]=await Promise.all([fetchSupabaseMetrics(),fetchSupabaseLogs(hours)]);
   return json(res,200,{ok:metrics.ok,generatedAt:new Date().toISOString(),metrics,logs});
  }

  if(mode==='vercel'){
   const provider=await fetchVercel();
   return json(res,200,{...provider,runtime:runtimeMetrics()});
  }

  return json(res,404,{erro:'Rota de infraestrutura não encontrada.',codigo:'INFRA_ROUTE_NOT_FOUND'});
 }

 if(!['GET','POST'].includes(req.method))return methodNotAllowed(res,['GET','POST']);
 const cron=cronAuthorized(req);
 if(req.method==='GET'&&!cron)return json(res,401,{erro:'Execução agendada não autorizada.',codigo:'CRON_UNAUTHORIZED'});
 let actor=null;if(!cron){actor=await requireSession(req,res,'agents.run');if(!actor)return}
 try{
  const overview=await getInfraOverview({includeLogs:true});
  const result=await persistScan(overview);
  // A varredura agendada também roda a Central de Problemas: aplica só as
  // correções seguras (L2) e abre/mitiga incidentes dos problemas restantes.
  let problems=null;
  try{
   if(cron)problems=await autoResolve();
   else{const found=await detect(actor);problems={detectados:found.resumo.total,incidents:await persistIncidents(found,overview.generatedAt)}}
  }catch(e){problems={erro:e?.message||'Falha na Central de Problemas.'}}
  if(actor)await audit({actor_user_id:actor.id,action:'infra.guardian.scan',resource:'infrastructure',details:{...result,problems}});
  return json(res,200,{ok:true,result,problems,overall:overview.overall,signals:overview.signals});
 }catch(e){
  return json(res,500,{erro:'Falha ao executar o Infrastructure & Resource Guardian.',codigo:'INFRA_SCAN_FAILED',detalhe:e?.message||null});
 }
};
