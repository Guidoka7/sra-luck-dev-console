// Monta dist/ com o que o navegador usa: as páginas HTML da raiz e a pasta assets/.
// É a pasta publicada pelo Cloudflare (wrangler.jsonc → assets.directory). Não altera
// nada na Vercel: lá o projeto continua servindo a raiz + as Functions em api/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const MAX = 25 * 1024 * 1024; // limite por arquivo de assets do Cloudflare Workers

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const copiados = [];
const copiar = (rel) => {
  const origem = path.join(root, rel), destino = path.join(dist, rel);
  const tam = fs.statSync(origem).size;
  if (tam > MAX) throw new Error(`${rel} tem ${(tam / 1048576).toFixed(1)} MiB (limite 25 MiB).`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
  copiados.push(rel);
};
const walk = (rel) => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = path.join(rel, e.name);
  return e.isDirectory() ? walk(r) : e.isFile() && !e.name.startsWith('.') ? [r] : [];
});

for (const f of fs.readdirSync(root)) if (f.endsWith('.html') && fs.statSync(path.join(root, f)).isFile()) copiar(f);
for (const f of walk('assets')) copiar(f);

// Mesmos cabeçalhos de segurança/cache do vercel.json (fonte única), no formato _headers do Cloudflare.
// Regras de /api/* ficam de fora: as Functions não existem neste Worker.
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const regras = (vercel.headers || []).filter((h) => !h.source.startsWith('/api/')).map((h) => `${h.source.replace(/\(\.\*\)/g, '*')}\n${h.headers.map((x) => `  ${x.key}: ${x.value}`).join('\n')}`);
if (regras.length) fs.writeFileSync(path.join(dist, '_headers'), `${regras.join('\n')}\n`);

// A Vercel serve index.html em "/"; com html_handling "none" (URLs .html como na Vercel), isso vira uma reescrita explícita.
fs.writeFileSync(path.join(dist, '_redirects'), '/ /index.html 200\n');

if (!copiados.includes('index.html')) throw new Error('index.html não encontrado na raiz.');
console.log(`dist/ pronto: ${copiados.length} arquivos (${copiados.filter((f) => f.endsWith('.html')).length} páginas HTML + assets/)${regras.length ? ' + _headers' : ''} + _redirects.`);
