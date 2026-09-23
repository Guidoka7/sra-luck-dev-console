const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');

function headers(){
 const token=String(process.env.GITHUB_TOKEN||'').trim();
 const h={Accept:'application/vnd.github+json','User-Agent':'sra-luck-dev-console','X-GitHub-Api-Version':'2022-11-28'};
 if(token)h.Authorization=`Bearer ${token}`;
 return h;
}
async function github(repo,path){
 const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{headers:headers(),cache:'no-store'});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(data?.message||`GitHub HTTP ${r.status}`);e.status=r.status;throw e}
 return data;
}
function normalizeCommit(x){
 return {
  sha:x?.sha||null,
  message:String(x?.commit?.message||'').split('\n')[0]||'Commit',
  author:x?.commit?.author?.name||x?.author?.login||null,
  date:x?.commit?.author?.date||x?.commit?.committer?.date||null,
  url:x?.html_url||null,
 };
}
function normalizeRun(x){
 return {
  id:x?.id||null,
  name:x?.name||x?.display_title||'Workflow',
  status:x?.status||null,
  conclusion:x?.conclusion||null,
  head_sha:x?.head_sha||null,
  head_branch:x?.head_branch||null,
  created_at:x?.created_at||null,
  updated_at:x?.updated_at||null,
  url:x?.html_url||null,
 };
}
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);
 res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'code.view');if(!actor)return;
 const repo=process.env.GITHUB_REPOSITORY||'Guidoka7/sra-luck-react';
 const resource=String(req.query?.resource||'summary');
 try{
  if(resource==='commits'){
   const data=await github(repo,'/commits?sha=main&per_page=20');
   return json(res,200,{ok:true,repository:repo,resource,commits:(Array.isArray(data)?data:[]).map(normalizeCommit)});
  }
  if(resource==='actions'){
   const data=await github(repo,'/actions/runs?branch=main&per_page=20');
   const runs=(data?.workflow_runs||[]).map(normalizeRun);
   return json(res,200,{ok:true,repository:repo,resource,runs,workflows:runs});
  }
  if(resource==='issues'){
   const data=await github(repo,'/issues?state=open&per_page=20');
   return json(res,200,{ok:true,repository:repo,resource,issues:Array.isArray(data)?data:[]});
  }
  if(resource!=='summary')return json(res,400,{erro:'Recurso GitHub inválido.'});

  const [commitsRaw,runsRaw]=await Promise.all([
   github(repo,'/commits?sha=main&per_page=20'),
   github(repo,'/actions/runs?branch=main&per_page=20'),
  ]);
  const commits=(Array.isArray(commitsRaw)?commitsRaw:[]).map(normalizeCommit);
  const runs=(runsRaw?.workflow_runs||[]).map(normalizeRun);
  const commit=commits[0]||null;
  const latestRun=runs[0]||null;
  return json(res,200,{
   ok:true,
   repository:repo,
   commit,
   current:commit,
   sha:commit?.sha||null,
   message:commit?.message||null,
   commits,
   runs,
   workflows:runs,
   latestRun,
   ci:{
    ok:latestRun ? latestRun.status==='completed' && latestRun.conclusion==='success' : null,
    status:latestRun?.status||null,
    conclusion:latestRun?.conclusion||null,
    sha:latestRun?.head_sha||null,
   },
  });
 }catch(error){
  return json(res,error?.status||502,{ok:false,erro:error?.message||'Não foi possível consultar o GitHub.'});
 }
};
