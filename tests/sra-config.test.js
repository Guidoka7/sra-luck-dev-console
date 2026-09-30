const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Substitui o cofre (secrets.js) por valores controlados, sem Supabase.
const secretsPath = path.resolve(__dirname, '../api/_lib/secrets.js');
let valores = {};
require.cache[secretsPath] = { id: secretsPath, filename: secretsPath, loaded: true, exports: { getSecret: async (k) => valores[k] ?? null } };
const { sraConnection, normalizeBaseUrl, baseProblem } = require('../api/_lib/sra-config');
const { sraFetch } = require('../api/_lib/problems');

test('normaliza a URL base: HTTPS, sem caminho; inválida vira não configurada', () => {
  assert.equal(normalizeBaseUrl('https://sraluckapp.vercel.app/'), 'https://sraluckapp.vercel.app');
  assert.equal(normalizeBaseUrl('https://sraluckapp.vercel.app/api/x'), 'https://sraluckapp.vercel.app');
  assert.equal(normalizeBaseUrl('http://sraluckapp.vercel.app'), null);
  assert.equal(normalizeBaseUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeBaseUrl(''), null);
  assert.equal(normalizeBaseUrl('sraluckapp'), null);
});

test('sem SRA_LUCK_BASE_URL não há fallback para o endereço antigo', async () => {
  valores = { SRA_LUCK_SERVICE_TOKEN: 'x'.repeat(40) };
  const conn = await sraConnection();
  assert.equal(conn.base, null);
  assert.equal(conn.configured, false);
  assert.match(baseProblem(conn), /não configurada/);
});

test('endereço antigo configurado é sinalizado como legado', async () => {
  valores = { SRA_LUCK_BASE_URL: 'https://sra-luck-react.vercel.app' };
  const conn = await sraConnection();
  assert.equal(conn.legacy, true);
  valores = { SRA_LUCK_BASE_URL: 'https://sraluckapp.vercel.app' };
  assert.equal((await sraConnection()).legacy, false);
});

test('Central de Problemas usa a mesma configuração do proxy e não chama a rede sem URL', async () => {
  valores = { SRA_LUCK_SERVICE_TOKEN: 'x'.repeat(40) };
  const original = global.fetch;
  let chamadas = 0;
  global.fetch = async () => { chamadas++; throw new Error('não deveria chamar'); };
  try {
    const r = await sraFetch('/api/admin/visao-geral');
    assert.equal(r.ok, false);
    assert.equal(r.notConfigured, true);
    assert.equal(chamadas, 0);
  } finally { global.fetch = original; }
});

test('Central de Problemas chama a URL configurada no cofre com o token M2M', async () => {
  valores = { SRA_LUCK_BASE_URL: 'https://sraluckapp.vercel.app', SRA_LUCK_SERVICE_TOKEN: 't'.repeat(40) };
  const original = global.fetch;
  let url = null, headers = null;
  global.fetch = async (u, init) => { url = u; headers = init.headers; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const r = await sraFetch('/api/ready', { actor: { id: 'dev-1', role: 'viewer' } });
    assert.equal(r.ok, true);
    assert.equal(url, 'https://sraluckapp.vercel.app/api/ready');
    assert.equal(headers['x-dev-actor-role'], 'viewer');
  } finally { global.fetch = original; }
});

test('Engenharia: time do Sra Luck usa SRA_VERCEL_TEAM_ID e, sem ele, o time do Console', async () => {
  const { teamFor } = require('../api/github-status');
  valores = { DEV_VERCEL_TEAM_ID: 'team_novo' };
  assert.equal(await teamFor('sra'), 'team_novo');
  assert.equal(await teamFor('console'), 'team_novo');
  valores = { DEV_VERCEL_TEAM_ID: 'team_console', SRA_VERCEL_TEAM_ID: 'team_app' };
  assert.equal(await teamFor('sra'), 'team_app');
  assert.equal(await teamFor('console'), 'team_console');
});

test('Preview com SRA_LUCK_PREVIEW_BASE_URL aponta só para o Sra Luck de teste; produção segue o cofre', async () => {
  valores = { SRA_LUCK_BASE_URL: 'https://sraluckapp.vercel.app', SRA_LUCK_SERVICE_TOKEN: 'p'.repeat(40) };
  const antes = { env: process.env.VERCEL_ENV, base: process.env.SRA_LUCK_PREVIEW_BASE_URL, tok: process.env.SRA_LUCK_PREVIEW_SERVICE_TOKEN };
  try {
    process.env.SRA_LUCK_PREVIEW_BASE_URL = 'https://sraluckapp-git-teste.vercel.app';
    process.env.SRA_LUCK_PREVIEW_SERVICE_TOKEN = 't'.repeat(40);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await sraConnection()).base, 'https://sraluckapp.vercel.app');
    process.env.VERCEL_ENV = 'preview';
    const conn = await sraConnection();
    assert.equal(conn.base, 'https://sraluckapp-git-teste.vercel.app');
    assert.equal(conn.token, 't'.repeat(40));
    assert.equal(conn.alvo, 'preview');
  } finally {
    for (const [k, v] of [['VERCEL_ENV', antes.env], ['SRA_LUCK_PREVIEW_BASE_URL', antes.base], ['SRA_LUCK_PREVIEW_SERVICE_TOKEN', antes.tok]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
