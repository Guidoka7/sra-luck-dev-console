const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseHTML } = require('linkedom');
const DCCrmCampos = require('../assets/dev-console-crm-campos.js');

function carregar() {
  const window = {};
  const DC = { api: async () => ({}), currentUser: { role: 'owner' }, esc: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), relTime: () => 'há 5 min' };
  const code = fs.readFileSync('assets/dev-console-integracoes.js', 'utf8').replace('window.DCIntegracoes = {', 'window.DCIntegracoes = { teste: { formHtml, lerFormulario },');
  vm.runInNewContext(code, { window, DC, DCCrmCampos });
  return window.DCIntegracoes.teste;
}

const F1 = 'a'.repeat(24), F2 = 'b'.repeat(24), RAISSA = '1'.repeat(24), GIOVANA = '2'.repeat(24);
const itens = [{ chave: 'cpf', rotulo: 'CPF' }, { chave: 'vendedora', rotulo: 'Vendedora' }, { chave: 'banco', rotulo: 'Banco' }, { chave: 'procedimento', rotulo: 'Procedimento' }];
const campo = { chave: 'funis', tipo: 'rd_funis', rotulo: 'Funis', camposLivres: true, filtrosPorFunil: true, itens };
const op = {
  catalogo: { atualizadoEm: '2026-09-29T10:00:00Z', vencido: false, erro: null },
  funis: [
    {
      id: F1, nome: 'Comercial', etapas: [{ id: 'e1', nome: 'Novo' }], amostra: { negociacoes: 100, contatos: 80 },
      fontes: [
        { fonte: 'deal_field:owner_id', rotulo: 'Negociação: Responsável (vendedora)', grupo: 'deal_nativo', mapeavel: true, preenchidas: 100 },
        { fonte: 'deal:banco', rotulo: 'Negociação: Banco', grupo: 'deal_personalizado', mapeavel: true, preenchidas: 60 },
        { fonte: 'contact:cpf', rotulo: 'Contato: CPF', grupo: 'contact_personalizado', mapeavel: true, preenchidas: 70 },
      ],
      filtros: [
        { fonte: 'deal_field:owner_id', rotulo: 'Responsável (vendedora)', valores: [{ valor: RAISSA, rotulo: 'Raissa', negociacoes: 60 }, { valor: GIOVANA, rotulo: 'Giovana', negociacoes: 40 }] },
        { fonte: 'deal:banco', rotulo: 'Banco', valores: [{ valor: 'Itaú', rotulo: 'Itaú', negociacoes: 30 }] },
      ],
      sugestoes: { cpf: 'contact:cpf', vendedora: 'deal_field:owner_id', banco: 'deal:banco' },
    },
    { id: F2, nome: 'Pós-venda', etapas: [], amostra: { negociacoes: 3, contatos: 0 }, fontes: [], filtros: [], sugestoes: {} },
  ],
};
const f = (config) => ({ id: 'importacao', versao: 3, config, campos: [campo] });
const montar = (config) => {
  const t = carregar();
  const { document } = parseHTML(`<html><body>${t.formHtml({ id: 'rd_station' }, f(config), op)}</body></html>`);
  return { t, document, form: document.querySelector('form') };
};
const auto = { cpf: 'auto', vendedora: 'auto', banco: 'auto', procedimento: 'auto' };

test('cada funil mostra filtros com os valores do RD (vendedoras) e o catálogo com botão de atualizar', () => {
  const { document } = montar({ funis: [{ pipelineId: F1, etapas: [], mapeamento: auto, filtros: [{ fonte: 'deal_field:owner_id', valores: [RAISSA] }] }] });
  const donos = [...document.querySelectorAll(`[data-rd-filtro][data-fonte="deal_field:owner_id"]`)];
  assert.deepEqual(donos.map((x) => x.value), [RAISSA, GIOVANA]);
  assert.ok(donos[0].hasAttribute('checked'));
  assert.ok(!donos[1].hasAttribute('checked'));
  assert.match(document.body.textContent, /Raissa/);
  assert.match(document.body.textContent, /1 selecionado/);
  assert.ok(document.querySelector('[data-rd-atualizar-catalogo]'));
  assert.match(document.body.textContent, /100 negociações mais recentes/);
});

test('preenchimento: origem sugerida no lugar de Automático; origem salva é mantida; sem sugestão pede definição', () => {
  const { document } = montar({ funis: [{ pipelineId: F1, etapas: [], mapeamento: { ...auto, banco: 'ignorar' } }] });
  const sel = (sub) => document.querySelector(`[data-rd-map][data-pipeline="${F1}"][data-sub="${sub}"]`);
  const selecionado = (s) => [...s.querySelectorAll('option')].find((o) => o.hasAttribute('selected'))?.getAttribute('value');
  assert.equal(selecionado(sel('cpf')), 'contact:cpf');
  assert.equal(selecionado(sel('vendedora')), 'deal_field:owner_id');
  assert.equal(selecionado(sel('banco')), 'ignorar');
  assert.equal(selecionado(sel('procedimento')), 'auto');
  assert.ok(sel('cpf').hasAttribute('data-rd-map-explicito'));
  // Só origens do próprio funil, agrupadas.
  assert.deepEqual([...sel('cpf').querySelectorAll('optgroup')].map((g) => g.getAttribute('label')), ['Negociação · campos do RD', 'Negociação · campos personalizados', 'Contato · campos personalizados']);
  assert.match(document.body.textContent, /2 origem\(ns\) sugerida/);
  assert.match(document.body.textContent, /definir/);
});

test('salvar lê filtros e origens de cada funil marcado', () => {
  const { t, form } = montar({ funis: [{ pipelineId: F1, etapas: [], mapeamento: auto, filtros: [{ fonte: 'deal_field:owner_id', valores: [RAISSA] }] }] });
  form.querySelectorAll('select').forEach((s) => {
    const o = [...s.querySelectorAll('option')].find((x) => x.hasAttribute('selected')) || s.querySelector('option');
    Object.defineProperty(s, 'value', { get: () => o.getAttribute('value') });
  });
  form.querySelectorAll('input[type=checkbox]').forEach((i) => Object.defineProperty(i, 'checked', { get: () => i.hasAttribute('checked') }));
  const cfg = t.lerFormulario(form, f({}));
  assert.equal(cfg.funis.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(cfg.funis[0].filtros)), [{ fonte: 'deal_field:owner_id', valores: [RAISSA] }]);
  assert.equal(cfg.funis[0].mapeamento.cpf, 'contact:cpf');
  assert.equal(cfg.funis[0].mapeamento.vendedora, 'deal_field:owner_id');
});

test('backend antigo (sem filtrosPorFunil): mantém o editor anterior e não envia filtros', () => {
  const t = carregar();
  const antigo = { ...campo, filtrosPorFunil: undefined };
  const html = t.formHtml({ id: 'rd_station' }, { id: 'importacao', versao: 1, config: { funis: [{ pipelineId: F1, etapas: [], mapeamento: auto }] }, campos: [antigo] }, op);
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  assert.equal(document.querySelector('[data-rd-filtro]'), null);
  assert.equal(document.querySelector('[data-rd-map-explicito]'), null);
});
