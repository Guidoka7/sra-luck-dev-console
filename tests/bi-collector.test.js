const test=require('node:test'),assert=require('node:assert/strict');
const rd=require('../api/_lib/bi-rd'),oauth=require('../api/_lib/bi-oauth');
const stamp='2026-09-29T20:00:00.000Z';
test('commercial coverage includes contacts/deals/meetings/tasks and a frozen upper bound',()=>{
 const cp=rd.initialCheckpoint('commercial',null,Date.parse(stamp));assert.deepEqual(cp.tasks.map(t=>t.entity),rd.COMMERCIAL);
 assert.ok(cp.tasks.every(t=>t.window.to===Date.parse(stamp)+1000));assert.equal(cp.tasks[0].window.field,'created_at');assert.equal(cp.tasks[2].window.field,'updated_at');
 const inc=rd.initialCheckpoint('commercial','2026-09-28T00:00:00Z',Date.parse(stamp));assert.ok(inc.tasks.every(t=>t.window.field==='updated_at'));
 assert.throws(()=>rd.initialCheckpoint('commercial','wrong'),/BI_WINDOW_INVALID/);
});
test('pagination never follows a foreign URL or silently skips a page',()=>{
 const task={entity:'contacts',page:1};
 assert.equal(rd.parsePage({data:[{id:'a'}],links:{next:'https://api.rd.services/crm/v2/contacts?page[number]=2'}},task).nextPage,2);
 for(const next of ['https://evil.example/x?page[number]=2','https://api.rd.services/crm/v2/deals?page[number]=2','https://api.rd.services/crm/v2/contacts?page[number]=9'])assert.throws(()=>rd.parsePage({data:[],links:{next}},task),/BI_RD_PAGINATION_INVALID/);
 assert.equal(rd.parsePage({data:Array.from({length:100},(_,i)=>({id:String(i)}))},task).nextPage,2);
 assert.throws(()=>rd.parsePage({results:[]},task),/BI_RD_RESPONSE_INVALID/);
});
test('10k cap is handled by contiguous date partitions, with no false completion',()=>{
 const cp=rd.initialCheckpoint('commercial',null,Date.parse(stamp));const end=cp.tasks[0].window.to;
 const r=rd.advance(cp,{records:[{id:'a'}],total:10001,nextPage:2});assert.ok(r.split);assert.equal(r.done,false);assert.equal(cp.tasks.length,4);
 assert.equal(r.checkpoint.tasks[0].window.from,0);assert.equal(r.checkpoint.tasks[0].window.to,r.checkpoint.tasks[1].window.from);assert.equal(r.checkpoint.tasks[1].window.to,end);
 cp.tasks[0].window={from:0,to:1000,field:'created_at'};assert.throws(()=>rd.advance(cp,{records:[],total:10000}),/BI_RD_WINDOW_TOO_DENSE/);
});
test('catalog appends a stages task for every returned pipeline',()=>{
 let cp=rd.initialCheckpoint('catalog');const r=rd.advance(cp,{records:[{id:'p1'},{id:'p2'}],nextPage:null,total:2});assert.deepEqual(r.checkpoint.tasks.filter(t=>t.entity==='stages').map(t=>t.pipeline_id),['p1','p2']);
 assert.equal(rd.urlFor({entity:'stages',pipeline_id:'p1',page:1}).pathname,'/crm/v2/pipelines/p1/stages');
});
test('explicit mappings retain selected fields and never turn owner or SDR into seller',()=>{
 const mapping={funnels:[{pipeline_id:'p1',fields:{seller:{entity:'deal',kind:'custom',key:'seller_name'},sdr:{entity:'deal',kind:'custom',key:'sdr_name'}}}]};
 const raw={id:'d1',pipeline:{id:'p1'},owner:{id:'sdr-user'},updated_at:stamp,custom_fields:{seller_name:'Vendedora QA',sdr_name:'SDR QA',cpf:'private'},email:'private',phone:'private',notes:'private'};
 const r=rd.cleanRecord(raw,{entity:'deals'},mapping);assert.deepEqual(r.data.custom_fields,{seller_name:'Vendedora QA',sdr_name:'SDR QA'});assert.equal(r.data.owner_id,'sdr-user');assert.ok(!r.data.seller);assert.ok(!JSON.stringify(r).includes('private'));assert.equal(r.payload_hash,rd.hash(r.data));
 raw.pipeline.id='other';assert.deepEqual(rd.cleanRecord(raw,{entity:'deals'},mapping).data.custom_fields,{});
});
test('tokens are authenticated ciphertext bound to one connection, never a reusable plaintext blob',()=>{
 process.env.DEV_SESSION_SECRET='qa-only-session-secret-with-at-least-32-chars';
 const sealed=oauth.seal({access_token:'QA-access',refresh_token:'QA-refresh'},'qa-connection');assert.ok(!JSON.stringify(sealed).includes('QA-access'));assert.equal(oauth.open(sealed,'qa-connection').refresh_token,'QA-refresh');
 assert.throws(()=>oauth.open(sealed,'another-connection'));sealed.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>oauth.open(sealed,'qa-connection'));
});
