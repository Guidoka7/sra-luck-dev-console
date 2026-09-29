const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const source=crypto.randomUUID(),runId=crypto.randomUUID();const token='qa-automation-token-at-least-thirty-two-characters';const profiles=new Map(),calls=[];
const stub=(name,exports)=>{const file=path.resolve(__dirname,'../api/_lib/'+name+'.js');require.cache[file]={id:file,filename:file,loaded:true,exports};};
stub('supabase',{getProfileById:async id=>profiles.get(id),audit:async()=>{}});
stub('secrets',{getSecret:async key=>key==='BI_AUTOMATION_TOKEN'?token:null});
stub('sra-config',{sraConnection:async()=>({base:'https://app.example.invalid',token:'qa-m2m-token'})});
const oauth=require('../api/_lib/bi-oauth');oauth.status=async()=>({authorized:true,connectionId:source,configured:true,storageReady:true});
const rd=require('../api/_lib/bi-rd');
const {issueSession}=require('../api/_lib/session');const {handler}=require('../api/_lib/bi');
process.env.DEV_SESSION_SECRET='qa-only-secret-at-least-thirty-two-characters';
let failure=false;
global.fetch=async(url,options)=>{
 calls.push({url:String(url),options});const name=new URL(url).pathname.split('/').pop();let result;
 if(name==='claim')result={id:runId,source_id:source,version:0,checkpoint:{schema_version:1,index:0,tasks:[{entity:'deals',page:1}],completed:[]},mapping:{version:1,funnels:[]}};
 else if(name==='commit')result={collected:true,validated:false};
 else if(name==='fail')result={status:'running'};
 else result={};
 return new Response(JSON.stringify({ok:true,result}),{status:200,headers:{'Content-Type':'application/json'}});
};
rd.fetchPage=async()=>{if(failure)throw Object.assign(new Error('BI_RD_HTTP_429'),{status:429,retryAfter:31});return{connectionId:source,page:{records:[{id:'qa-deal',total_price:123.45,owner_id:'qa-owner',source_id:'qa-source',campaign_id:'qa-campaign',status:'won'}],nextPage:null,total:1}};};
async function request(action,{role,method='POST',bearer,body={run_id:runId},origin='https://console.example.invalid'}={}){
 const headers={host:'console.example.invalid','x-forwarded-proto':'https',origin};if(bearer)headers.authorization='Bearer '+bearer;
 if(role){const profile={id:'qa-'+role,auth_user_id:'qa-auth-'+role,role,active:true};profiles.set(profile.id,profile);headers.cookie='dc_session='+issueSession(profile);}
 const req={method,headers,query:{action},body};const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.data=value?JSON.parse(value):null;}};
 await handler(req,res);return res;
}
test('RBAC is enforced by the server: viewer cannot collect; operator cannot map or authorize',async()=>{
 for(const [action,role]of [['step','viewer'],['mapping','operator'],['authorize','operator']])assert.equal((await request(action,{role})).statusCode,403);
 assert.equal((await request('step',{role:'operator',origin:'https://other.invalid'})).statusCode,403);
});
test('automation token only authorizes a collection step, not setup or credential actions',async()=>{
 assert.equal((await request('step',{bearer:'wrong'})).statusCode,401);assert.equal((await request('mapping',{bearer:token})).statusCode,401);assert.equal((await request('authorize',{bearer:token})).statusCode,401);
});
test('one valid step preserves real commercial fields, commits once and identifies the machine actor',async()=>{
 calls.length=0;failure=false;const res=await request('step',{bearer:token});assert.equal(res.statusCode,200);assert.equal(res.data.result.validated,false);
 assert.deepEqual(calls.map(c=>new URL(c.url).pathname.split('/').pop()),['claim','commit']);
 const payload=JSON.parse(calls[1].options.body);assert.equal(payload.records[0].data.total_price,123.45);assert.equal(payload.records[0].data.owner_id,'qa-owner');assert.equal(payload.records[0].data.seller,undefined);assert.equal(calls[1].options.headers['x-dev-actor-role'],'operator');
});
test('provider failure never advances the checkpoint and exposes retry state',async()=>{
 calls.length=0;failure=true;const res=await request('step',{role:'operator'});assert.equal(res.statusCode,429);assert.equal(res.headers['Retry-After'],'31');assert.deepEqual(calls.map(c=>new URL(c.url).pathname.split('/').pop()),['claim','fail']);assert.equal(JSON.parse(calls[1].options.body).code,'BI_RD_HTTP_429');
});
