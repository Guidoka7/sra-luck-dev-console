import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const errors=[];
const walk=(dir,ext)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),ext):(e.name.endsWith(ext)?[path.join(dir,e.name)]:[]));
const htmls=fs.readdirSync(root).filter(x=>x.endsWith('.html')).map(x=>path.join(root,x));
const js=[...walk(path.join(root,'api'),'.js'),...walk(path.join(root,'assets'),'.js')];
const checkJs=(file,code=null)=>{
  let target=file;
  if(code!==null){target=path.join(os.tmpdir(),`dc-${Math.random().toString(16).slice(2)}.js`);fs.writeFileSync(target,code)}
  const r=spawnSync(process.execPath,['--check',target],{encoding:'utf8'});
  if(r.status!==0) errors.push(`JS inválido ${path.relative(root,file)}: ${r.stderr||r.stdout}`);
  if(code!==null) try{fs.unlinkSync(target)}catch{}
};
js.forEach(f=>checkJs(f));
for(const file of htmls){
  const src=fs.readFileSync(file,'utf8');
  const ids=[...src.matchAll(/\sid=["']([^"']+)["']/gi)].map(m=>m[1]);
  const dup=[...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))];
  if(dup.length) errors.push(`${path.basename(file)} IDs duplicados: ${dup.join(', ')}`);
  let n=0; for(const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)){if(m[1].trim())checkJs(file,m[1]),n++}
  for(const m of src.matchAll(/(?:href|src)=["']([^"']+)["']/gi)){
    const ref=m[1]; if(!ref||ref.includes('${')||/^(?:#|https?:|mailto:|tel:|javascript:|data:|\/)/i.test(ref))continue;
    const local=ref.split(/[?#]/)[0]; if(local&&!fs.existsSync(path.resolve(path.dirname(file),local)))errors.push(`${path.basename(file)} referência ausente: ${ref}`);
  }
}
const must=[
 ['infra page',fs.existsSync(path.join(root,'infraestrutura.html'))],
 ['infra migration',fs.existsSync(path.join(root,'supabase','002_infrastructure_observability.sql'))],
 ['guardian',fs.existsSync(path.join(root,'api','infra-scan.js'))],
 ['central de problemas',fs.existsSync(path.join(root,'problemas.html'))&&fs.existsSync(path.join(root,'api','_lib','problems.js'))],
];
for(const [label,ok] of must)if(!ok)errors.push(`Componente obrigatório ausente: ${label}`);

// Rotas consolidadas em infra-scan.js: o plano Hobby da Vercel limita o número de Functions.
const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const rewrites=new Map((vercel.rewrites||[]).map(r=>[r.source,r.destination]));
for(const [source,mode] of [['/api/infra-history','history'],['/api/infra-dev-supabase','dev-supabase'],['/api/problemas','problems']]){
  if(rewrites.get(source)!==`/api/infra-scan?mode=${mode}`)errors.push(`Rewrite obrigatório ausente: ${source} -> /api/infra-scan?mode=${mode}`);
}
const MAX_FUNCTIONS=12;
const ignoredApi=new Set(fs.readFileSync(path.join(root,'.vercelignore'),'utf8').split('\n').map(x=>x.trim()).filter(x=>x.startsWith('api/')));
const functions=fs.readdirSync(path.join(root,'api')).filter(x=>x.endsWith('.js')&&!ignoredApi.has(`api/${x}`));
if(functions.length>MAX_FUNCTIONS)errors.push(`Vercel Functions acima do limite (${functions.length}/${MAX_FUNCTIONS}). Consolide rotas em uma Function existente.`);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`PASS · ${htmls.length} HTML · ${js.length} JS · ${functions.length}/${MAX_FUNCTIONS} Functions · infraestrutura completa`);
