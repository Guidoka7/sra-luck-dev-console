const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const records = new Map();
const db = path.resolve(__dirname, '../api/_lib/supabase.js');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
  rest: async (query, init) => {
    if (init.method === 'GET') return [...records.values()];
    if (init.method === 'POST') { const row=JSON.parse(init.body); records.set(row.name,row); return [row]; }
    if (init.method === 'DELETE') { records.delete(decodeURIComponent(query.split('eq.')[1])); return []; }
  }
}};
process.env.DEV_SESSION_SECRET = 'test-only-vault-key-that-is-at-least-32-characters';
const vault = require('../api/_lib/secrets');

test('BI mantém namespace próprio e não afirma que o provedor está conectado', async () => {
  const group = (await vault.catalogStatus()).find(g => g.id === 'bi');
  assert.equal(group.setupOnly, true);
  assert.match(group.description, /ainda não ativados/);
  assert.ok(group.fields.every(f => f.key.startsWith('BI_') && !f.configured));
});
test('segredo BI é cifrado, recuperável só no backend e mascarado no catálogo', async () => {
  const value='test-only-provider-secret-7654321';
  await vault.saveSecret('BI_RD_CLIENT_SECRET',value,'qa-owner');
  assert.equal(JSON.stringify(records.get('BI_RD_CLIENT_SECRET')).includes(value), false);
  assert.equal(await vault.getSecret('BI_RD_CLIENT_SECRET'),value);
  const field=(await vault.catalogStatus()).find(g=>g.id==='bi').fields.find(f=>f.key==='BI_RD_CLIENT_SECRET');
  assert.equal(field.visible,null);
  assert.equal(field.configured,true);
  assert.equal(JSON.stringify(field).includes(value),false);
  await vault.removeSecret('BI_RD_CLIENT_SECRET');
  assert.equal(await vault.getSecret('BI_RD_CLIENT_SECRET',{fallback:false}),null);
});
test('URL n8n aceita HTTPS e recusa credenciais embutidas', async () => {
  for (const url of ['http://example.com','https://user:password@example.com','https://example.com?token=secret','not-a-url']) {
    await assert.rejects(vault.saveSecret('BI_N8N_BASE_URL',url,'qa-owner'),e=>e.status===400);
  }
  await vault.saveSecret('BI_N8N_BASE_URL','https://automation.example.com','qa-owner');
  assert.equal(await vault.getSecret('BI_N8N_BASE_URL'),'https://automation.example.com');
});
