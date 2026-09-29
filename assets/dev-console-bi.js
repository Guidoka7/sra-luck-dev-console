/* Recepção do BI: estado persistido, sem números comerciais simulados. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),esc=value=>DC.esc(String(value??''));
const SEMANTICS={seller:'Nome da vendedora',meeting_seller:'Vendedora que realizou a reunião',sdr:'SDR',lead_owner:'Responsável pelo lead',source:'Fonte',campaign:'Campanha',appointment_date:'Data do agendamento',appointment_confirmed:'Confirmação do agendamento',attendance:'Comparecimento',modality:'Modalidade',contract_id:'Identificador do contrato',sale_value:'Valor da venda'};
const NATIVES={deal:['owner_id','source_id','campaign_id','total_price','one_time_price','recurrence_price','closed_at','status','pipeline_id','stage_id'],contact:['created_at']};
let state=null,mapping={version:1,funnels:[]},pipelines=[],fields=[],dirty=false,selected='',issuesOffset=null;
async function api(action,payload,params=''){
 const r=await DC.api('/api/bi?action='+action+params,payload===undefined?{}:{method:'POST',body:payload});
 if(!r.ok)throw new Error(r.data?.codigo||r.error||'Não foi possível concluir.');return r.data;
}
function feedback(message,bad=false){$('biFeedback').className=bad?'dc-critical-box':'dc-note';$('biFeedback').textContent=message;}
async function action(button,fn){button.disabled=true;try{await fn();}catch(e){feedback(e.message,true);}finally{button.disabled=false;if(state)render();}}
function render(){
 const o=state.oauth,s=state.storage;const configured=o.configured&&o.storageReady;
 $('biConnection').innerHTML='<strong>'+esc(o.authorized?'RD autorizado':configured?'Pronto para autorização':'Configuração pendente')+'</strong><p>'+esc(!o.storageReady?'A estrutura do cofre ainda precisa ser instalada.':!o.configured?'Cadastre Client ID, Client Secret e a URL canônica do Console no grupo Power BI de Conexões.':'Callback a cadastrar no aplicativo RD: '+o.redirectUri)+'</p>'+(state.storageError?'<p>Recepção no App: '+esc(state.storageError)+'</p>':'');
 $('biAuthorize').disabled=!state.canManage||!configured;
 $('biAuthorize').textContent=o.authorized?'Autorizar outra conexão':'Autorizar no RD Station';
 const ready=o.authorized&&!state.storageError;
 $('biCatalog').disabled=!state.canRun||!ready;
 $('biCommercial').disabled=!state.canRun||!ready||!s?.source?.mapping_version;
 $('biLoadMapping').disabled=!ready||!s?.counts?.pipelines;
 $('biIssuesRefresh').disabled=!ready;
 $('biSaveMapping').disabled=!state.canManage||!selected||!dirty;
 $('biMappingVersion').textContent='Versão salva: '+(s?.source?.mapping_version??0)+(dirty?' · alterações não salvas':'');
 $('biCounts').textContent=s?.source?Object.entries(s.counts||{}).map(([entity,count])=>entity+': '+count).join(' · '):'Nenhum catálogo recebido. Autorize e inicie a carga.';
 $('biAutomation').textContent=state.automationConfigured?'Token dedicado do n8n configurado. Agendamento externo ainda precisa ser ligado.':'O token dedicado BI_AUTOMATION_TOKEN ainda não foi cadastrado em Conexões.';
 const names={catalog:'Catálogo',commercial:'Comercial'},statuses={running:'Em andamento',paused:'Pausada',collected:'Recebida · não validada'};
 $('biRuns').innerHTML='<table class="dc-table"><thead><tr><th>Carga / início</th><th>Estado</th><th>Páginas gravadas</th><th>Recebimentos / quarentena</th><th>Falha</th><th>Ação</th></tr></thead><tbody>'+(s?.runs||[]).map(r=>'<tr><td>'+esc(names[r.mode])+'<br/>'+esc(new Date(r.started_at).toLocaleString('pt-BR'))+'<br/><small>'+esc(r.id)+'</small></td><td>'+esc(statuses[r.status])+'</td><td>'+esc(r.version)+'</td><td>'+esc(r.received)+' / '+esc(r.quarantined)+'</td><td>'+esc(r.last_error||'—')+(r.error_details?'<br/>'+esc(JSON.stringify(r.error_details)):'')+(r.next_attempt_at&&r.status==='running'?'<br/>Próxima tentativa: '+esc(new Date(r.next_attempt_at).toLocaleTimeString('pt-BR')):'')+'</td><td>'+(r.status==='running'?'<button class="dc-btn" data-step="'+esc(r.id)+'" '+(!state.canRun?'disabled':'')+'>Processar próxima página</button>':r.status==='paused'?'<button class="dc-btn" data-resume="'+esc(r.id)+'" '+(!state.canRun?'disabled':'')+'>Retomar carga</button>':'—')+'</td></tr>').join('')+'</tbody></table>';
 if(!s?.runs?.length)$('biRuns').innerHTML='<div class="dc-empty">Nenhuma carga iniciada.</div>';
}
async function refresh(){state=await api('status');if(!dirty)mapping=structuredClone(state.storage?.source?.mapping||{version:1,funnels:[]});render();}
async function catalog(entity){const items=[];let offset=0;while(offset!==null){const page=await api('catalog',undefined,'&entity='+entity+'&offset='+offset);items.push(...page.records);offset=page.nextOffset;}return items;}
function stash(){if(!selected)return;const result={};for(const el of $('biMapping').querySelectorAll('select[data-semantic]'))if(el.value){const [entity,kind,key]=el.value.split(':');result[el.dataset.semantic]={entity,kind,key};}
 const index=mapping.funnels.findIndex(f=>f.pipeline_id===selected);const f={pipeline_id:selected,fields:result};if(index>=0)mapping.funnels[index]=f;else mapping.funnels.push(f);
}
function renderMapping(){
 const current=mapping.funnels.find(f=>f.pipeline_id===selected)?.fields||{};
 $('biMapping').innerHTML=selected?'<div class="dc-grid g2">'+Object.entries(SEMANTICS).map(([key,label])=>{
  const options=[];if(!['seller','meeting_seller','sdr'].includes(key))for(const [entity,keys]of Object.entries(NATIVES))for(const name of keys)options.push({value:entity+':native:'+name,label:entity+' · nativo · '+name});
  for(const {data}of fields)if(['deal','contact'].includes(data.entity)&&/^[A-Za-z0-9_-]{1,160}$/.test(data.slug||''))options.push({value:data.entity+':custom:'+data.slug,label:(data.entity==='deal'?'Negociação':'Contato')+' · '+(data.label||data.name||data.slug)+' ['+data.slug+']'});
  const value=current[key]?[current[key].entity,current[key].kind,current[key].key].join(':'):'';
  if(value&&!options.some(o=>o.value===value))options.push({value,label:'Campo salvo não encontrado no catálogo · '+value});
  return '<div class="dc-field"><label for="bi-field-'+key+'">'+esc(label)+'</label><select class="dc-input" id="bi-field-'+key+'" data-semantic="'+key+'" '+(!state.canManage?'disabled':'')+'><option value="" '+(!value?'selected':'')+'>Não selecionado</option>'+options.map(o=>'<option value="'+esc(o.value)+'" '+(o.value===value?'selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select></div>';
 }).join('')+'</div>':'<p class="dc-muted">Selecione um funil.</p>';
 render();
}
async function loadMapping(){if(dirty)throw new Error('Salve o mapeamento antes de recarregar o catálogo.');[pipelines,fields]=await Promise.all([catalog('pipelines'),catalog('custom_fields')]);
 $('biPipeline').innerHTML='<option value="">Selecione o funil</option>'+pipelines.map(x=>'<option value="'+esc(x.external_id)+'">'+esc(x.data.name||x.external_id)+'</option>').join('');$('biPipeline').disabled=!pipelines.length;selected='';renderMapping();feedback(pipelines.length+' funis e '+fields.length+' campos carregados do catálogo recebido.');}
async function start(mode){const since=mode==='commercial'&&$('biSince').value?new Date($('biSince').value+'Z').toISOString():null;const r=await api('start',{mode,since});feedback('Carga '+r.result.run_id+' iniciada. Processe as páginas abaixo ou pelo n8n.');await refresh();}
async function issues(offset=0){const r=await api('issues',undefined,'&offset='+offset);issuesOffset=r.nextOffset;$('biMoreIssues').hidden=issuesOffset===null;$('biIssues').innerHTML=r.records.length?r.records.map(i=>'<p><b>'+esc(i.code)+'</b> · '+esc(i.entity)+' / '+esc(i.external_id)+'<br/>'+esc(JSON.stringify(i.details))+'</p>').join(''):'Nenhuma divergência de versão encontrada nesta página.';}
document.addEventListener('DOMContentLoaded',async()=>{
 if(!await DC.guard())return;
 $('biRefresh').onclick=()=>action($('biRefresh'),refresh);
 $('biAuthorize').onclick=()=>action($('biAuthorize'),async()=>{if(state.oauth.authorized&&!await DC.modal('Autorizar uma nova conexão','<p>Um novo consentimento cria uma base separada. Os dados anteriores são preservados, mas não são mesclados com a nova conta.</p>',{confirmText:'Continuar'}))return;const r=await api('authorize',{});window.location.assign(r.authorizationUrl);});
 $('biCatalog').onclick=()=>action($('biCatalog'),()=>start('catalog'));
 $('biCommercial').onclick=()=>action($('biCommercial'),()=>start('commercial'));
 $('biLoadMapping').onclick=()=>action($('biLoadMapping'),loadMapping);
 $('biPipeline').onchange=()=>{stash();selected=$('biPipeline').value;renderMapping();};
 $('biMapping').onchange=()=>{dirty=true;stash();render();};
 $('biSaveMapping').onclick=()=>action($('biSaveMapping'),async()=>{stash();await api('mapping',{expected_version:state.storage.source.mapping_version,mapping});dirty=false;await refresh();feedback('Mapeamento salvo. A próxima carga usará esta versão.');});
 $('biRuns').onclick=e=>{const b=e.target.closest('button[data-step],button[data-resume]');if(!b)return;action(b,async()=>{const kind=b.dataset.step?'step':'resume';const r=await api(kind,{run_id:b.dataset.step||b.dataset.resume});feedback(kind==='resume'?'Carga retomada.':r.result.collected?'Carga recebida. Indicadores ainda dependem de validação.':'Página gravada. O progresso está salvo.');await refresh();});};
 $('biIssuesRefresh').onclick=()=>action($('biIssuesRefresh'),()=>issues());$('biMoreIssues').onclick=()=>action($('biMoreIssues'),()=>issues(issuesOffset));
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 try{await refresh();}catch(e){feedback(e.message,true);}
});
})();
