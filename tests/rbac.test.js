const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// rbac.js importa supabase.js/session.js; aqui só as regras puras interessam.
for (const mod of ['session', 'supabase']) {
  const p = path.resolve(__dirname, `../api/_lib/${mod}.js`);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { readSession: () => null, getProfileById: async () => null, audit: async () => {} } };
}
const secretsPath = path.resolve(__dirname, '../api/_lib/secrets.js');
require.cache[secretsPath] = { id: secretsPath, filename: secretsPath, loaded: true, exports: { getSecret: async () => null } };
const { hasPermission } = require('../api/_lib/rbac');
const { permissionFor } = require('../api/sra-proxy');

const viewer = { role: 'viewer', permissions: [] };
const operator = { role: 'operator', permissions: [] };
const owner = { role: 'owner', permissions: [] };

test('viewer é somente leitura', () => {
  for (const p of ['integrations.manage', 'notifications.manage', 'agents.configure', 'app.correct', 'finance.correct', 'v46.correct', 'users.manage']) {
    assert.equal(hasPermission(viewer, p), false, p);
  }
  for (const p of ['monitoring.view', 'integrations.view', 'finance.inspect', 'connectors.view']) assert.equal(hasPermission(viewer, p), true, p);
});

test('proxy: escrita sem mapeamento exige sra.admin.write (só owner)', () => {
  const perm = permissionFor('/api/admin/boletos/123', 'POST');
  assert.equal(perm, 'sra.admin.write');
  assert.equal(hasPermission(viewer, perm), false);
  assert.equal(hasPermission(operator, perm), false);
  assert.equal(hasPermission(owner, perm), true);
  assert.equal(permissionFor('/api/admin/boletos/123', 'GET'), 'monitoring.view');
});

test('proxy: escritas mapeadas continuam exigindo a permissão do domínio', () => {
  assert.equal(permissionFor('/api/admin/financeiro/recebiveis/1/baixa', 'POST'), 'finance.correct');
  assert.equal(permissionFor('/api/admin/clientes/1/liberar-acesso-app', 'POST'), 'app.correct');
  assert.equal(hasPermission(viewer, 'finance.correct'), false);
  assert.equal(hasPermission(operator, 'finance.correct'), true);
});

test('cofre de credenciais: só owner e developer alteram (connectors.manage)', () => {
  const developer = { role: 'developer', permissions: [] };
  assert.equal(hasPermission(owner, 'connectors.manage'), true);
  assert.equal(hasPermission(developer, 'connectors.manage'), true);
  assert.equal(hasPermission(operator, 'connectors.manage'), false);
  assert.equal(hasPermission(viewer, 'connectors.manage'), false);
  // todos continuam vendo o estado mascarado do cofre
  for (const actor of [owner, developer, operator, viewer]) assert.equal(hasPermission(actor, 'integrations.view'), true);
});
