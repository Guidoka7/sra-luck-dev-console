const { rest } = require('./supabase');
const { getSecret } = require('./secrets');

function nowIso(){ return new Date().toISOString(); }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function pct(part,total){ return total>0 ? Math.max(0,Math.min(100,(part/total)*100)) : null; }
function mb(bytes){ return Number.isFinite(bytes) ? bytes/1024/1024 : null; }
function gb(bytes){ return Number.isFinite(bytes) ? bytes/1024/1024/1024 : null; }

async function timedFetch(url, init={}, timeoutMs=12000){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 const started=Date.now();
 try{
  const response=await fetch(url,{...init,signal:controller.signal,cache:'no-store'});
  return {response,ms:Date.now()-started};
 }finally{clearTimeout(timer)}
}

function parseLabels(raw=''){
 const out={}; const re=/([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g; let m;
 while((m=re.exec(raw))) out[m[1]]=m[2].replace(/\\"/g,'"').replace(/\\n/g,'\n').replace(/\\\\/g,'\\');
 return out;
}
function parsePrometheus(text=''){
 const samples=[]; const names=new Set();
 for(const line of String(text).split(/\r?\n/)){
  const s=line.trim(); if(!s||s.startsWith('#')) continue;
  const m=s.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/);
  if(!m) continue; const value=Number(m[3]); if(!Number.isFinite(value)) continue;
  const row={name:m[1],labels:parseLabels(m[2]||''),value}; samples.push(row); names.add(row.name);
 }
 return {samples,names:[...names].sort()};
}
function dbSamples(parsed,name){ return parsed.samples.filter(s=>s.name===name && (!s.labels.service_type||s.labels.service_type==='db')); }
function firstMetric(parsed,name,filter=()=>true){ return parsed.samples.find(s=>s.name===name&&filter(s))?.value ?? null; }
function sumMetric(parsed,name,filter=()=>true){ const a=parsed.samples.filter(s=>s.name===name&&filter(s)); return a.length?a.reduce((n,s)=>n+s.value,0):null; }
function rootFs(parsed,name){
 const rows=dbSamples(parsed,name).filter(s=>s.labels.mountpoint==='/'||!s.labels.mountpoint);
 return rows.length?Math.max(...rows.map(s=>s.value)):null;
}
function cpuCounters(parsed){
 const rows=dbSamples(parsed,'node_cpu_seconds_total');
 if(!rows.length)return null;
 const total=rows.reduce((a,s)=>a+s.value,0),idle=rows.filter(s=>s.labels.mode==='idle').reduce((a,s)=>a+s.value,0),iowait=rows.filter(s=>s.labels.mode==='iowait').reduce((a,s)=>a+s.value,0);
 return {total,idle,iowait};
}
function ioCounters(parsed){
 const readOps=sumMetric(parsed,'node_disk_reads_completed_total',s=>!s.labels.service_type||s.labels.service_type==='db');
 const writeOps=sumMetric(parsed,'node_disk_writes_completed_total',s=>!s.labels.service_type||s.labels.service_type==='db');
 const readBytes=sumMetric(parsed,'node_disk_read_bytes_total',s=>!s.labels.service_type||s.labels.service_type==='db');
 const writtenBytes=sumMetric(parsed,'node_disk_written_bytes_total',s=>!s.labels.service_type||s.labels.service_type==='db');
 return {readOps,writeOps,readBytes,writtenBytes};
}
function findConnectionSignals(parsed){
 const candidates=parsed.samples.filter(s=>/connection|numbackends|pool/i.test(s.name)&&(!s.labels.service_type||s.labels.service_type==='db'||s.labels.service_type==='supavisor'));
 return candidates.slice(0,40).map(s=>({name:s.name,value:s.value,labels:s.labels}));
}
function serviceMemory(parsed){
 const names=new Set(['process_resident_memory_bytes','go_memstats_alloc_bytes','process_runtime_go_mem_heap_alloc_bytes']);
 const rows=parsed.samples.filter(s=>names.has(s.name)&&s.labels.service_type); const map=new Map();
 for(const r of rows){const key=r.labels.service_type;const prev=map.get(key);if(!prev||r.value>prev.value)map.set(key,{service:key,value:r.value,metric:r.name});}
 return [...map.values()].sort((a,b)=>b.value-a.value);
}
function deriveSupabaseMetrics(parsed){
 const total=firstMetric(parsed,'node_memory_MemTotal_bytes',s=>s.labels.service_type==='db');
 const available=firstMetric(parsed,'node_memory_MemAvailable_bytes',s=>s.labels.service_type==='db');
 const free=firstMetric(parsed,'node_memory_MemFree_bytes',s=>s.labels.service_type==='db');
 const cache=firstMetric(parsed,'node_memory_Cached_bytes',s=>s.labels.service_type==='db');
 const buffers=firstMetric(parsed,'node_memory_Buffers_bytes',s=>s.labels.service_type==='db');
 const swapTotal=firstMetric(parsed,'node_memory_SwapTotal_bytes',s=>s.labels.service_type==='db');
 const swapFree=firstMetric(parsed,'node_memory_SwapFree_bytes',s=>s.labels.service_type==='db');
 const used=(total!=null&&available!=null)?Math.max(0,total-available):null;
 const swapUsed=(swapTotal!=null&&swapFree!=null)?Math.max(0,swapTotal-swapFree):null;
 const diskSize=rootFs(parsed,'node_filesystem_size_bytes'),diskAvail=rootFs(parsed,'node_filesystem_avail_bytes');
 const diskUsed=(diskSize!=null&&diskAvail!=null)?Math.max(0,diskSize-diskAvail):null;
 return {
  memory:{totalBytes:total,availableBytes:available,freeBytes:free,usedBytes:used,cacheBytes:cache,buffersBytes:buffers,usagePercent:pct(used,total)},
  swap:{totalBytes:swapTotal,freeBytes:swapFree,usedBytes:swapUsed,usagePercent:pct(swapUsed,swapTotal)},
  disk:{totalBytes:diskSize,availableBytes:diskAvail,usedBytes:diskUsed,usagePercent:pct(diskUsed,diskSize)},
  load:{load1:firstMetric(parsed,'node_load1',s=>s.labels.service_type==='db'),load5:firstMetric(parsed,'node_load5',s=>s.labels.service_type==='db'),load15:firstMetric(parsed,'node_load15',s=>s.labels.service_type==='db')},
  oomKills:firstMetric(parsed,'node_vmstat_oom_kill',s=>s.labels.service_type==='db'),
  postgresRestarts:firstMetric(parsed,'postgresql_restarts_total',s=>s.labels.service_type==='db'),
  ioNow:sumMetric(parsed,'node_disk_io_now',s=>!s.labels.service_type||s.labels.service_type==='db'),
  cpuCounters:cpuCounters(parsed),ioCounters:ioCounters(parsed),connectionSignals:findConnectionSignals(parsed),serviceMemory:serviceMemory(parsed),seriesCount:parsed.names.length,sampleCount:parsed.samples.length
 };
}
function deriveRates(current,previous,elapsedSeconds){
 if(!previous||!current||!elapsedSeconds||elapsedSeconds<=0)return null;
 const out={};
 if(current.cpuCounters&&previous.cpuCounters){
  const dt=current.cpuCounters.total-previous.cpuCounters.total,di=current.cpuCounters.idle-previous.cpuCounters.idle,dw=current.cpuCounters.iowait-previous.cpuCounters.iowait;
  if(dt>0){out.cpuUsagePercent=Math.max(0,Math.min(100,((dt-di)/dt)*100));out.cpuIowaitPercent=Math.max(0,Math.min(100,(dw/dt)*100));}
 }
 if(current.ioCounters&&previous.ioCounters){
  for(const key of ['readOps','writeOps','readBytes','writtenBytes']){
   const a=current.ioCounters[key],b=previous.ioCounters[key]; if(a!=null&&b!=null&&a>=b)out[key+'PerSecond']=(a-b)/elapsedSeconds;
  }
 }
 return out;
}

async function latestSnapshot(source){
 try{
  const rows=await rest(`dev_infra_scans?source=eq.${encodeURIComponent(source)}&select=id,source,status,summary,observed_at&order=observed_at.desc&limit=1`,{method:'GET'});
  return rows?.[0]||null;
 }catch{return null}
}

async function fetchSupabaseProjectMetrics({source,ref,token,snapshotSource=source,displayName='Supabase'}){
 if(!ref||!token)return {source,configured:false,ok:false,status:'not_configured',message:`Configure as credenciais de observabilidade do ${displayName}.`};
 const url=`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/analytics/endpoints/metrics`;
 try{
  const {response,ms}=await timedFetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'text/plain'}},15000);
  const text=await response.text();
  if(!response.ok)return {source,configured:true,ok:false,status:'down',httpStatus:response.status,latencyMs:ms,message:`${displayName} Metrics API retornou HTTP ${response.status}.`};
  const parsed=parsePrometheus(text); const metrics=deriveSupabaseMetrics(parsed); const previous=await latestSnapshot(snapshotSource);
  let rates=null;
  if(previous?.summary?.rawCounters&&previous.observed_at){rates=deriveRates({cpuCounters:metrics.cpuCounters,ioCounters:metrics.ioCounters},previous.summary.rawCounters,(Date.now()-new Date(previous.observed_at).getTime())/1000)}
  const prevOom=num(previous?.summary?.oomKills),prevRestarts=num(previous?.summary?.postgresRestarts);
  const events={
   oomKillsDelta:metrics.oomKills!=null&&prevOom!=null?Math.max(0,metrics.oomKills-prevOom):null,
   postgresRestartsDelta:metrics.postgresRestarts!=null&&prevRestarts!=null?Math.max(0,metrics.postgresRestarts-prevRestarts):null,
  };
  return {source,configured:true,ok:true,status:'healthy',latencyMs:ms,projectRef:ref,metrics:{...metrics,rates,events},catalog:{seriesCount:metrics.seriesCount,sampleCount:metrics.sampleCount}};
 }catch(e){return {source,configured:true,ok:false,status:'down',message:e?.name==='AbortError'?`Timeout ao consultar ${displayName} Metrics API.`:(e?.message||`Falha ao consultar ${displayName} Metrics API.`)}}
}

async function fetchSupabaseMetrics(){
 const [ref,token]=await Promise.all([getSecret('SRA_SUPABASE_PROJECT_REF'),getSecret('SRA_SUPABASE_ACCESS_TOKEN')]);
 return fetchSupabaseProjectMetrics({source:'supabase',ref:String(ref||''),token:String(token||''),snapshotSource:'supabase',displayName:'Supabase Sra Luck'});
}

async function fetchDevSupabaseMetrics(){
 const url=String(process.env.DEV_SUPABASE_URL||'').replace(/\/$/,'');
 const service=String(process.env.DEV_SUPABASE_SERVICE_ROLE_KEY||'').trim();
 const [refRaw,tokenRaw]=await Promise.all([getSecret('DEV_SUPABASE_PROJECT_REF'),getSecret('DEV_SUPABASE_ACCESS_TOKEN')]);
 const ref=String(refRaw||'').trim();
 const token=String(tokenRaw||'').trim();
 if(!url||!service)return {source:'dev_supabase',configured:false,ok:false,status:'not_configured',message:'Configure DEV_SUPABASE_URL e DEV_SUPABASE_SERVICE_ROLE_KEY.'};
 let database={ok:false,latencyMs:null,httpStatus:null};
 try{
  const probe=await timedFetch(`${url}/rest/v1/dev_users?select=id&limit=1`,{headers:{apikey:service,Authorization:`Bearer ${service}`,Accept:'application/json'}},10000);
  database={ok:probe.response.ok,latencyMs:probe.ms,httpStatus:probe.response.status};
 }catch(e){database={ok:false,latencyMs:null,httpStatus:null,message:e?.message||'Falha no probe do Supabase Dev.'}}
 let management=null;
 if(ref&&token)management=await fetchSupabaseProjectMetrics({source:'dev_supabase',ref,token,snapshotSource:'dev_supabase',displayName:'Supabase Dev Console'});
 const ok=database.ok && (!management || management.ok);
 const status=!database.ok?'down':management&&!management.ok?'degraded':'healthy';
 return {
  source:'dev_supabase',configured:true,ok,status,database,
  metricsConfigured:Boolean(ref&&token),
  metrics:management?.metrics||null,catalog:management?.catalog||null,projectRef:management?.projectRef||ref||null,
  latencyMs:database.latencyMs,
  message:!database.ok?'Banco de controle do Dev Console indisponível.':!management?'Banco acessível. Configure DEV_SUPABASE_PROJECT_REF e DEV_SUPABASE_ACCESS_TOKEN para memória/CPU/IO.':management.message||null,
 };
}

async function fetchSupabaseLogs(hours=1){
 const [refRaw,tokenRaw]=await Promise.all([getSecret('SRA_SUPABASE_PROJECT_REF'),getSecret('SRA_SUPABASE_ACCESS_TOKEN')]);
 const ref=String(refRaw||'').trim(); const token=String(tokenRaw||'').trim();
 if(!ref||!token)return {configured:false,ok:false,status:'not_configured',items:[]};
 const end=new Date(),start=new Date(end.getTime()-Math.min(Math.max(hours,1),24)*3600000);
 const sql=`select timestamp, source, event_message, toInt32OrZero(log_attributes['response.status_code']) as status, log_attributes['request.path'] as path from logs where positionCaseInsensitive(event_message, 'error') > 0 or positionCaseInsensitive(event_message, 'fatal') > 0 or positionCaseInsensitive(event_message, 'panic') > 0 or toInt32OrZero(log_attributes['response.status_code']) >= 500 order by timestamp desc limit 100`;
 const params=new URLSearchParams({sql,iso_timestamp_start:start.toISOString(),iso_timestamp_end:end.toISOString()});
 try{
  const {response,ms}=await timedFetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/analytics/endpoints/logs?${params}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}},15000);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)return {configured:true,ok:false,status:'degraded',httpStatus:response.status,latencyMs:ms,items:[],message:data?.message||data?.error||`HTTP ${response.status}`};
  const result=Array.isArray(data?.result)?data.result:[];
  return {configured:true,ok:true,status:'healthy',latencyMs:ms,items:result.slice(0,100),count:result.length};
 }catch(e){return {configured:true,ok:false,status:'degraded',items:[],message:e?.message||'Falha ao consultar logs do Supabase.'}}
}

async function fetchSraStorage(){
 const [baseRaw,tokenRaw]=await Promise.all([getSecret('SRA_LUCK_BASE_URL'),getSecret('SRA_LUCK_SERVICE_TOKEN')]);
 const base=String(baseRaw||'https://sra-luck-react.vercel.app').replace(/\/$/,'');
 const token=String(tokenRaw||'').trim();
 if(!token)return {source:'storage',configured:false,ok:false,status:'not_configured',message:'Configure SRA_LUCK_SERVICE_TOKEN para validar o Storage principal.'};
 try{
  const {response,ms}=await timedFetch(base+'/api/admin/monitoramento-storage',{headers:{Accept:'application/json','x-dev-console-token':token,'x-dev-actor-id':'infra-guardian','x-dev-actor-role':'owner'}},12000);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)return {source:'storage',configured:true,ok:false,status:response.status===503?'degraded':'down',httpStatus:response.status,latencyMs:ms,message:data?.erro||`Storage monitor HTTP ${response.status}.`,checks:data?.checks||[]};
  return {source:'storage',configured:true,ok:Boolean(data?.ok),status:data?.ok?'healthy':'degraded',latencyMs:ms,totalBuckets:data?.totalBuckets??null,checks:data?.checks||[],generatedAt:data?.geradoEm||null,message:data?.ok?null:'Há bucket crítico ausente, público ou inacessível.'};
 }catch(e){return {source:'storage',configured:true,ok:false,status:'down',message:e?.name==='AbortError'?'Timeout ao validar Storage.':(e?.message||'Falha ao validar Storage.')}}
}

function pickBackupRows(data){
 if(Array.isArray(data))return data;
 for(const key of ['backups','items','data','results'])if(Array.isArray(data?.[key]))return data[key];
 return [];
}
function backupTimestamp(item){
 for(const key of ['completed_at','completedAt','created_at','createdAt','inserted_at','insertedAt','started_at','startedAt','timestamp']){
  const v=item?.[key];if(v&&Number.isFinite(new Date(v).getTime()))return new Date(v).toISOString();
 }
 return null;
}
async function fetchSupabaseBackups(){
 const [refRaw,tokenRaw]=await Promise.all([getSecret('SRA_SUPABASE_PROJECT_REF'),getSecret('SRA_SUPABASE_ACCESS_TOKEN')]);
 const ref=String(refRaw||'').trim();
 const token=String(tokenRaw||'').trim();
 if(!ref||!token)return {source:'backups',configured:false,ok:false,status:'not_configured',message:'Configure o acesso de observabilidade do Supabase para validar backups.'};
 try{
  const {response,ms}=await timedFetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/backups`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}},12000);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)return {source:'backups',configured:true,ok:false,status:'degraded',httpStatus:response.status,latencyMs:ms,message:data?.message||data?.error||`Backups API HTTP ${response.status}.`};
  const rows=pickBackupRows(data);
  const dated=rows.map(x=>({item:x,at:backupTimestamp(x)})).filter(x=>x.at).sort((a,b)=>new Date(b.at)-new Date(a.at));
  const latest=dated[0]||null;
  const ageHours=latest?Math.max(0,(Date.now()-new Date(latest.at).getTime())/3600000):null;
  const status=ageHours==null?'degraded':ageHours>=60?'critical':ageHours>=36?'warning':'healthy';
  return {source:'backups',configured:true,ok:status==='healthy'||status==='warning',status,latencyMs:ms,count:rows.length,latestAt:latest?.at||null,ageHours,latest:latest?.item||null,message:latest?null:'A API não retornou um backup com data identificável.'};
 }catch(e){return {source:'backups',configured:true,ok:false,status:'down',message:e?.name==='AbortError'?'Timeout ao consultar backups do Supabase.':(e?.message||'Falha ao consultar backups do Supabase.')}}
}

async function fetchGuardianFreshness(){
 try{
  const rows=await rest('dev_infra_scans?select=source,status,observed_at&order=observed_at.desc&limit=1',{method:'GET'});
  const last=rows?.[0]||null;
  if(!last)return {source:'guardian',configured:true,ok:false,status:'degraded',lastRunAt:null,ageHours:null,message:'Nenhuma coleta persistida do Guardian ainda.'};
  const ageHours=Math.max(0,(Date.now()-new Date(last.observed_at).getTime())/3600000);
  const status=ageHours>=36?'critical':ageHours>=27?'warning':'healthy';
  return {source:'guardian',configured:true,ok:status==='healthy'||status==='warning',status,lastRunAt:last.observed_at,ageHours,lastSource:last.source,lastStatus:last.status};
 }catch(e){return {source:'guardian',configured:true,ok:false,status:'down',lastRunAt:null,ageHours:null,message:e?.message||'Falha ao consultar a última coleta do Guardian.'}}
}

async function fetchCloudflareWorker(){
 const [accountRaw,tokenRaw,scriptRaw]=await Promise.all([getSecret('CLOUDFLARE_ACCOUNT_ID'),getSecret('CLOUDFLARE_API_TOKEN'),getSecret('CLOUDFLARE_WORKER_SCRIPT')]);
 const account=String(accountRaw||'').trim(),token=String(tokenRaw||'').trim(),script=String(scriptRaw||'').trim();
 if(!account||!token||!script)return {source:'cloudflare',configured:false,ok:false,status:'not_configured',message:'Configure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN e CLOUDFLARE_WORKER_SCRIPT.'};
 const end=new Date(),start=new Date(end.getTime()-15*60000);
 const query=`query WorkerInfra($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) { viewer { accounts(filter: {accountTag: $accountTag}) { workersInvocationsAdaptive(limit: 1, filter: {scriptName: $scriptName, datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd}) { sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 memoryUsageBytesP50 memoryUsageBytesP90 memoryUsageBytesP99 memoryUsageBytesP999 } } } } }`;
 const variables={accountTag:account,datetimeStart:start.toISOString(),datetimeEnd:end.toISOString(),scriptName:script};
 try{
  const {response,ms}=await timedFetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,variables})},15000);
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.errors?.length){
   return {source:'cloudflare',configured:true,ok:false,status:'degraded',httpStatus:response.status,latencyMs:ms,message:data?.errors?.[0]?.message||`Cloudflare GraphQL HTTP ${response.status}.`,scriptName:script};
  }
  const row=data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]||null;
  const q=row?.quantiles||{},sum=row?.sum||{}; const limit=128*1024*1024;
  return {source:'cloudflare',configured:true,ok:true,status:'healthy',latencyMs:ms,scriptName:script,windowMinutes:15,metrics:{requests:num(sum.requests)||0,errors:num(sum.errors)||0,subrequests:num(sum.subrequests)||0,cpuTimeP50Us:num(q.cpuTimeP50),cpuTimeP99Us:num(q.cpuTimeP99),memoryBytesP50:num(q.memoryUsageBytesP50),memoryBytesP90:num(q.memoryUsageBytesP90),memoryBytesP99:num(q.memoryUsageBytesP99),memoryBytesP999:num(q.memoryUsageBytesP999),memoryLimitBytes:limit,memoryP99Percent:pct(num(q.memoryUsageBytesP99),limit)}};
 }catch(e){return {source:'cloudflare',configured:true,ok:false,status:'down',scriptName:script,message:e?.message||'Falha ao consultar Cloudflare GraphQL.'}}
}

function runtimeMetrics(){
 const m=process.memoryUsage();
 const limitMb=num(process.env.DEV_FUNCTION_MEMORY_LIMIT_MB||process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
 const memoryLimitBytes=limitMb&&limitMb>0?limitMb*1024*1024:null;
 return {source:'dev_runtime',configured:true,ok:true,status:'healthy',metrics:{rssBytes:m.rss,heapTotalBytes:m.heapTotal,heapUsedBytes:m.heapUsed,heapUsagePercent:pct(m.heapUsed,m.heapTotal),memoryLimitBytes,rssUsagePercent:pct(m.rss,memoryLimitBytes),externalBytes:m.external,arrayBuffersBytes:m.arrayBuffers||0,nodeVersion:process.version,region:process.env.VERCEL_REGION||process.env.AWS_REGION||null,environment:process.env.VERCEL_ENV||'local'}};
}

async function fetchVercel(){
 const [tokenRaw,projectRaw,teamRaw]=await Promise.all([getSecret('DEV_VERCEL_ACCESS_TOKEN'),getSecret('DEV_VERCEL_PROJECT_ID'),getSecret('DEV_VERCEL_TEAM_ID')]);
 const token=String(tokenRaw||'').trim(),project=String(process.env.VERCEL_PROJECT_ID||projectRaw||'').trim(),team=String(teamRaw||'').trim();
 if(!token||!project)return {source:'vercel',configured:false,ok:false,status:'not_configured',message:'Configure DEV_VERCEL_ACCESS_TOKEN; o projeto usa VERCEL_PROJECT_ID do runtime da Vercel ou DEV_VERCEL_PROJECT_ID como fallback. Métricas avançadas de função permanecem no Vercel Observability até existir export/API configurada.'};
 const p=new URLSearchParams({projectId:project,limit:'8'});if(team)p.set('teamId',team);
 try{
  const {response,ms}=await timedFetch(`https://api.vercel.com/v6/deployments?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}},12000);
  const data=await response.json().catch(()=>({})); if(!response.ok)return {source:'vercel',configured:true,ok:false,status:'degraded',httpStatus:response.status,latencyMs:ms,message:data?.error?.message||`Vercel API HTTP ${response.status}.`};
  const deployments=(data.deployments||[]).map(d=>({uid:d.uid,name:d.name,url:d.url,state:d.state,readyState:d.readyState,target:d.target,createdAt:d.createdAt,ready:d.ready,buildingAt:d.buildingAt,creator:d.creator?.username||d.creator?.email||null,meta:{githubCommitSha:d.meta?.githubCommitSha||null,githubCommitMessage:d.meta?.githubCommitMessage||null,githubCommitRef:d.meta?.githubCommitRef||null}}));
  return {source:'vercel',configured:true,ok:true,status:'healthy',latencyMs:ms,projectId:project,deployments,latest:deployments[0]||null,advancedMetricsAvailable:false,advancedMetricsNote:'Memória/CPU histórica de Vercel Functions é exibida no Vercel Observability. O Dev Console mede seu próprio runtime e deixa o provider preparado para ingestão/export de observabilidade.'};
 }catch(e){return {source:'vercel',configured:true,ok:false,status:'down',message:e?.message||'Falha ao consultar Vercel API.'}}
}

function statusFromPct(value,warn,crit){if(value==null)return 'unknown';if(value>=crit)return'critical';if(value>=warn)return'warning';return'healthy'}
function buildSignals({supabase,devSupabase,cloudflare,runtime,storage,backups,guardian}){
 const out=[]; const add=(source,key,label,value,unit,warn,crit,extra={})=>out.push({source,key,label,value,unit,warn,crit,state:statusFromPct(value,warn,crit),...extra});
 const availability=(provider,source,label)=>{if(provider?.configured!==false)add(source,'provider_unavailable',`${label} · disponibilidade`,provider?.ok?0:1,'flag',1,1,{hidden:true,providerStatus:provider?.status||null})};
 availability(supabase,'supabase','Supabase Sra Luck · fonte de observabilidade');
 if(devSupabase?.configured!==false)add('dev_supabase','provider_unavailable','Supabase Dev Console · banco de controle',devSupabase?.database?.ok?0:1,'flag',1,1,{hidden:true,providerStatus:devSupabase?.status||null});
 availability(cloudflare,'cloudflare','Cloudflare Worker · Analytics');
 const sm=supabase?.metrics;
 if(sm?.memory?.usagePercent!=null)add('supabase','memory_usage_percent','Supabase · RAM',sm.memory.usagePercent,'%',85,92,{raw:sm.memory});
 if(sm?.swap?.usagePercent!=null)add('supabase','swap_usage_percent','Supabase · Swap',sm.swap.usagePercent,'%',70,90,{raw:sm.swap});
 if(sm?.disk?.usagePercent!=null)add('supabase','disk_usage_percent','Supabase · Disco',sm.disk.usagePercent,'%',80,90,{raw:sm.disk});
 if(sm?.rates?.cpuUsagePercent!=null)add('supabase','cpu_usage_percent','Supabase · CPU',sm.rates.cpuUsagePercent,'%',80,92);
 if(sm?.events?.oomKillsDelta!=null)add('supabase','oom_kills_delta','Supabase · OOM kill',sm.events.oomKillsDelta,'eventos',1,1,{hidden:true});
 if(sm?.events?.postgresRestartsDelta!=null)add('supabase','postgres_restarts_delta','Supabase · reinícios Postgres',sm.events.postgresRestartsDelta,'eventos',1,3,{hidden:true});
 const dm=devSupabase?.metrics;
 if(dm?.memory?.usagePercent!=null)add('dev_supabase','memory_usage_percent','Supabase Dev · RAM',dm.memory.usagePercent,'%',85,92,{raw:dm.memory});
 if(dm?.swap?.usagePercent!=null)add('dev_supabase','swap_usage_percent','Supabase Dev · Swap',dm.swap.usagePercent,'%',70,90,{raw:dm.swap});
 if(dm?.disk?.usagePercent!=null)add('dev_supabase','disk_usage_percent','Supabase Dev · Disco',dm.disk.usagePercent,'%',80,90,{raw:dm.disk});
 if(dm?.rates?.cpuUsagePercent!=null)add('dev_supabase','cpu_usage_percent','Supabase Dev · CPU',dm.rates.cpuUsagePercent,'%',80,92);
 if(dm?.events?.oomKillsDelta!=null)add('dev_supabase','oom_kills_delta','Supabase Dev · OOM kill',dm.events.oomKillsDelta,'eventos',1,1,{hidden:true});
 if(dm?.events?.postgresRestartsDelta!=null)add('dev_supabase','postgres_restarts_delta','Supabase Dev · reinícios Postgres',dm.events.postgresRestartsDelta,'eventos',1,3,{hidden:true});
 const cm=cloudflare?.metrics;
 if(cm?.memoryP99Percent!=null)add('cloudflare','worker_memory_p99_percent','Worker · Memória P99',cm.memoryP99Percent,'%',75,90,{raw:{bytes:cm.memoryBytesP99,limitBytes:cm.memoryLimitBytes}});
 if(cm&&cm.requests>0)add('cloudflare','worker_error_rate_percent','Worker · Taxa de erro',(cm.errors/cm.requests)*100,'%',1,5,{raw:{errors:cm.errors,requests:cm.requests}});
 const rm=runtime?.metrics;
 // heapUsagePercent é exibido para diagnóstico, mas não abre incidente: o V8 ajusta o heap dinamicamente.
 if(rm?.rssUsagePercent!=null)add('dev_runtime','rss_usage_percent','Dev Console · RSS',rm.rssUsagePercent,'%',75,90,{raw:{rssBytes:rm.rssBytes,limitBytes:rm.memoryLimitBytes}});
 if(storage?.configured!==false)add('storage','storage_unavailable','Storage · buckets críticos',storage?.ok?0:1,'flag',1,1,{raw:{checks:storage?.checks||[]}});
 if(backups?.ageHours!=null)add('backups','backup_age_hours','Backup · idade da última cópia',backups.ageHours,'h',36,60,{raw:{latestAt:backups.latestAt}});
 if(guardian?.ageHours!=null)add('guardian','guardian_age_hours','Guardian · tempo desde a última coleta',guardian.ageHours,'h',27,36,{raw:{lastRunAt:guardian.lastRunAt}});
 return out;
}

async function getInfraOverview({includeLogs=true}={}){
 const [supabase,devSupabase,cloudflare,vercel,logs,storage,backups,guardian]=await Promise.all([
  fetchSupabaseMetrics(),
  fetchDevSupabaseMetrics(),
  fetchCloudflareWorker(),
  fetchVercel(),
  includeLogs?fetchSupabaseLogs(1):Promise.resolve(null),
  fetchSraStorage(),
  fetchSupabaseBackups(),
  fetchGuardianFreshness(),
 ]);
 const runtime=runtimeMetrics(); const signals=buildSignals({supabase,devSupabase,cloudflare,runtime,storage,backups,guardian});
 let incidents=[];try{incidents=await rest('dev_incidents?source=eq.infrastructure&status=in.(open,investigating,mitigated,reopened)&select=id,fingerprint,title,module,severity,status,occurrence_count,first_seen_at,last_seen_at,metadata&order=last_seen_at.desc&limit=30',{method:'GET'})}catch{}
 const providers=[supabase,devSupabase,cloudflare,vercel,runtime,storage,backups,guardian];
 const states=providers.filter(x=>x.configured!==false).map(x=>x.status);
 const missingProviders=providers.filter(x=>x.configured===false).map(x=>x.source);
 let overall='healthy';
 if(states.includes('down')||states.includes('critical')||signals.some(s=>s.state==='critical'))overall='critical';
 else if(states.includes('degraded')||states.includes('warning')||signals.some(s=>s.state==='warning'))overall='degraded';
 else if(missingProviders.length)overall='incomplete';
 return {ok:true,generatedAt:nowIso(),overall,configurationComplete:missingProviders.length===0,missingProviders,signals,providers:{supabase:{...supabase,logs},devSupabase,cloudflare,vercel,runtime,storage,backups,guardian},incidents};
}

module.exports={parsePrometheus,deriveSupabaseMetrics,deriveRates,fetchSupabaseMetrics,fetchDevSupabaseMetrics,fetchSupabaseLogs,fetchSraStorage,fetchSupabaseBackups,fetchGuardianFreshness,fetchCloudflareWorker,fetchVercel,runtimeMetrics,buildSignals,getInfraOverview,mb,gb,pct};
