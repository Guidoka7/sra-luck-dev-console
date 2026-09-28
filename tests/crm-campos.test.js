const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const editor = require('../assets/dev-console-crm-campos.js');

const op = {
  // Deve ser ignorado: nenhuma opção global/genérica pode vazar para os funis.
  campos: [{ entidade: 'deal', slug: 'global_proibido', nome: 'Global proibido' }],
  camposNativos: [{ fonte: 'deal_field:status', rotulo: 'Status global proibido' }],
  funis: [
    {
      id: 'p1', nome: 'Funil Comercial',
      campos: [{ entidade: 'deal', slug: 'sdr', nome: 'SDR' }],
      camposNativos: [{ fonte: 'deal_field:name', rotulo: 'Negociação: name' }],
    },
    {
      id: 'p2', nome: 'Funil Pós-venda',
      campos: [{ entidade: 'contact', slug: 'modalidade', nome: 'Modalidade' }],
      camposNativos: [{ fonte: 'contact_field:phones', rotulo: 'Contato: phones' }],
    },
  ],
};

function card(id, campos = []) {
  return `<div class="dc-rd-funil"><input data-rd-funil-toggle value="${id}" checked><div class="dc-rd-funil-body"><select data-rd-map><option value="auto" selected>Automático</option><option value="deal:global_proibido">Global</option></select>${editor.render(campos, op)}</div></div>`;
}

function montar(campos = []) {
  const { document } = parseHTML(`<html><body><div id="a">${card('p1', campos)}</div><div id="b">${card('p2')}</div><details class="dc-rd-default-map"><summary>Genérico</summary></details></body></html>`);
  document.querySelectorAll('select').forEach((s) => Object.defineProperty(s, 'selectedOptions', { get: () => [...s.options].filter((o) => o.selected) }));
  editor.hidratar(document);
  return document;
}

test('origens são independentes e específicas de cada funil, sem catálogo global', () => {
  const doc = montar();
  const a = doc.querySelector('#a'), b = doc.querySelector('#b');
  const opA = [...a.querySelector('[data-rd-origem]').options].map((o) => o.value);
  const opB = [...b.querySelector('[data-rd-origem]').options].map((o) => o.value);
  assert.ok(opA.includes('deal:sdr'));
  assert.ok(opA.includes('deal_field:name'));
  assert.ok(!opA.includes('contact:modalidade'));
  assert.ok(!opA.includes('deal:global_proibido'));
  assert.ok(opB.includes('contact:modalidade'));
  assert.ok(opB.includes('contact_field:phones'));
  assert.ok(!opB.includes('deal:sdr'));
  assert.ok(!opB.includes('deal:global_proibido'));
  assert.equal(doc.querySelector('.dc-rd-default-map').style.display, 'none');
});

test('preenchimento dos dados usa somente campos personalizados do próprio funil', () => {
  const doc = montar();
  const mapA = [...doc.querySelector('#a [data-rd-map]').options].map((o) => o.value);
  const mapB = [...doc.querySelector('#b [data-rd-map]').options].map((o) => o.value);
  assert.deepEqual(mapA, ['auto', 'ignorar', 'deal:sdr']);
  assert.deepEqual(mapB, ['auto', 'ignorar', 'contact:modalidade']);
});

test('seleção, nome, remoção e reabertura continuam independentes por funil', () => {
  const doc = montar();
  const a = doc.querySelector('#a'), b = doc.querySelector('#b');
  const select = a.querySelector('[data-rd-origem]');
  [...select.options].forEach((o) => { o.selected = o.value === 'deal:sdr'; });
  editor.click({ target: a.querySelector('[data-rd-adicionar]') });
  a.querySelector('[data-rd-rotulo]').value = 'Responsável pela confirmação';
  const salvo = editor.ler(a);
  assert.deepEqual(salvo, [{ fonte: 'deal:sdr', rotulo: 'Responsável pela confirmação' }]);
  assert.deepEqual(editor.ler(b), []);
  assert.deepEqual(editor.ler(montar(salvo).querySelector('#a')), salvo);
  editor.click({ target: a.querySelector('[data-rd-remover]') });
  assert.deepEqual(editor.ler(a), []);
  assert.equal([...a.querySelector('[data-rd-origem]').options].find((o) => o.value === 'deal:sdr').disabled, false);
});

test('fonte antiga é preservada e sinalizada, sem reaparecer como disponível', () => {
  const doc = montar([{ fonte: 'deal:antigo', rotulo: '<script>alert(1)</script>' }]);
  const a = doc.querySelector('#a');
  assert.equal(doc.querySelectorAll('script').length, 0);
  assert.match(a.textContent, /Salvo anteriormente/);
  assert.ok(![...a.querySelector('[data-rd-origem]').options].some((o) => o.value === 'deal:antigo'));
  assert.equal(editor.ler(a)[0].rotulo, '<script>alert(1)</script>');
});

test('edição desabilitada não adiciona nem remove campos', () => {
  const { document } = parseHTML(`<div class="dc-rd-funil"><input data-rd-funil-toggle value="p1">${editor.render([{ fonte: 'deal:sdr', rotulo: 'SDR' }], op, ' disabled')}</div>`);
  editor.hidratar(document);
  editor.click({ target: document.querySelector('[data-rd-remover]') });
  assert.equal(editor.ler(document).length, 1);
});
