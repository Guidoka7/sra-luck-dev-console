const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseHTML } = require('linkedom');
function carregar(api) {
  const window = {};
  const DC = { api, currentUser: { role: 'owner' }, esc: (v) => String(v).replace(/</g, '&lt;').replace(/"/g, '&quot;'), relTime: () => 'agora' };
  const code = fs.readFileSync('assets/dev-console-integracoes.js', 'utf8').replace('window.DCIntegracoes = {', 'window.DCIntegracoes = { teste: { opcoesDe, formHtml },');
  vm.runInNewContext(code, { window, DC });
  return window.DCIntegracoes.teste;
}
test('erro de opções não fica preso no cache; sucesso fica', async () => {
  let chamadas = 0;
  const t = carregar(async () => ++chamadas === 1 ? { ok: false, error: 'RD indisponível' } : { ok: true, data: { funis: [{ id: 'funil' }] } });
  assert.equal((await t.opcoesDe('rd_station')).erro, 'RD indisponível');
  assert.equal((await t.opcoesDe('rd_station')).funis[0].id, 'funil');
  await t.opcoesDe('rd_station');
  assert.equal(chamadas, 2);
});
test('falha de carregamento bloqueia salvar e oferece nova tentativa', () => {
  const t = carregar(async () => ({}));
  const html = t.formHtml({ id: 'rd_station' }, { id: 'importacao', config: { ativo: true }, versao: 10, campos: [{ chave: 'ativo', tipo: 'booleano', rotulo: 'Importação' }] }, { erro: 'Falha temporária' });
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('[type="submit"]'), null);
  assert.ok(document.querySelector('[data-recarregar-opcoes]'));
  assert.ok(document.querySelector('[data-c="ativo"]').hasAttribute('disabled'));
  assert.match(document.textContent || html, /configuração existente foi preservada/);
});
