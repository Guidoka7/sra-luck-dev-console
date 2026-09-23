import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ignored = new Set(['.git','node_modules','docs','supabase']);
const ignoredFiles = new Set(['.env.example','BUILD-MANIFEST.json','FILE-INVENTORY.md']);
const candidates=[];
function walk(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(e.isDirectory() && ignored.has(e.name)) continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) walk(p);
    else if(!ignoredFiles.has(e.name) && /\.(?:js|html|json|md|yml|yaml)$/i.test(e.name)) candidates.push(p);
  }
}
walk(root);

const patterns=[
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['supabase service-role JWT',/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/],
  ['GitHub PAT',/github_pat_[A-Za-z0-9_]{30,}/],
  ['GitHub token',/gh[pousr]_[A-Za-z0-9]{30,}/],
  ['Vercel token',/vercel_[A-Za-z0-9_-]{20,}/i],
];
const findings=[];
for(const file of candidates){
  const src=fs.readFileSync(file,'utf8');
  for(const [label,re] of patterns){
    if(re.test(src)) findings.push(`${path.relative(root,file)}: possível ${label}`);
  }
}
if(fs.existsSync(path.join(root,'.env'))) findings.push('.env existe no repositório');
if(findings.length){console.error(findings.join('\n'));process.exit(1)}
console.log(`PASS · verificação básica de segredos em ${candidates.length} arquivos`);
