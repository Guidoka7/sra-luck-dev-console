const { json, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession } = require('./_lib/rbac');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return methodNotAllowed(res,['GET']);res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'code.view');if(!actor)return;
 const repo=process.env.GITHUB_REPOSITORY||'Guidoka7/sra-luck-react';const resource=String(req.query?.resource||'commits');
 const token=process.env.GITHUB_TOKEN||'';const headers={Accept:'application/vnd.github+json','User-Agent':'sra-luck-dev-console'};if(token)headers.Authorization=`Bearer ${token}`;
 const paths={commits:'/commits?sha=main&per_page=10',actions:'/actions/runs?per_page=10',issues:'/issues?state=open&per_page=20'};if(!paths[resource])return json(res,400,{erro:'Recurso GitHub inválido.'});
 try{const r=await fetch(`https://api.github.com/repos/${repo}${paths[resource]}`,{headers,cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok)return json(res,r.status,{erro:data?.message||`GitHub HTTP ${r.status}`});return json(res,200,{repository:repo,resource,data})}catch{return json(res,502,{erro:'Não foi possível consultar o GitHub.'})}
};
