const test=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
async function page(role='owner'){
 const {window,document}=parseHTML(readFileSync('bi.html','utf8'));let saved=null;
 const state={oauth:{authorized:true,configured:true,storageReady:true},storage:{source:{mapping_version:1,mapping:{version:1,funnels:[]}},counts:{pipelines:2},runs:[]},canManage:role==='owner',canRun:role!=='viewer'};
 const DC={esc,guard:async()=>true,api:async(url,options)=>{
  const u=new URL(url,'https://qa.invalid');let data;
  if(u.searchParams.get('action')==='status')data=structuredClone(state);
  else if(u.searchParams.get('action')==='catalog')data={records:u.searchParams.get('entity')==='pipelines'?[{external_id:'p1',data:{name:'Entrada'}},{external_id:'p2',data:{name:'Contrato'}}]:[{external_id:'f1',data:{entity:'deal',slug:'vendedora',name:'Vendedora QA'}},{external_id:'f2',data:{entity:'deal',slug:'sdr',name:'SDR QA'}}],nextOffset:null};
  else if(u.searchParams.get('action')==='mapping'){saved=structuredClone(options.body);state.storage.source.mapping=structuredClone(saved.mapping);state.storage.source.mapping_version++;data={ok:true};}
  return {ok:true,data};
 }};
 vm.runInNewContext(readFileSync('assets/dev-console-bi.js','utf8'),{document,window,DC,structuredClone,URL,console});document.dispatchEvent(new window.Event('DOMContentLoaded'));await tick();
 return {document,window,saved:()=>saved};
}
function choose(select,value){for(const o of select.options)o.removeAttribute('selected');[...select.options].find(o=>o.value===value)?.setAttribute('selected','');}
test('mapping is selectable per funnel, persisted via API and keeps seller separate from SDR',async()=>{
 const {document:d,saved}=await page();await d.getElementById('biLoadMapping').onclick();
 const select=d.getElementById('biPipeline');choose(select,'p1');select.onchange();
 const seller=d.getElementById('bi-field-seller');assert.ok(![...seller.options].some(o=>o.value.includes('native:owner_id')));
 choose(seller,'deal:custom:vendedora');d.getElementById('biMapping').onchange();
 choose(select,'p2');select.onchange();assert.equal(d.getElementById('bi-field-seller').value,'');
 choose(d.getElementById('bi-field-sdr'),'deal:custom:sdr');d.getElementById('biMapping').onchange();
 await d.getElementById('biSaveMapping').onclick();assert.equal(saved().expected_version,1);assert.equal(saved().mapping.funnels[0].fields.seller.key,'vendedora');assert.equal(saved().mapping.funnels[1].fields.sdr.key,'sdr');assert.equal(saved().mapping.funnels[1].fields.seller,undefined);
 assert.match(d.getElementById('biMappingVersion').textContent,/Versão salva: 2/);
});
test('viewer sees status but no collection/authorization/write controls are enabled',async()=>{
 const {document:d}=await page('viewer');for(const id of ['biCatalog','biCommercial','biAuthorize','biSaveMapping'])assert.ok(d.getElementById(id).disabled);
 await d.getElementById('biRefresh').onclick();assert.equal(d.getElementById('biRefresh').disabled,false);
});
