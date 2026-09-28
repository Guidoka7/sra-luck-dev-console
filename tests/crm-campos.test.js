const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const editor = require('../assets/dev-console-crm-campos.js');
const op = { campos: [{ entidade: 'deal', slug: 'sdr', nome: 'SDR' }, { entidade: 'contact', slug: 'modalidade', nome: 'Modalidade' }] };
function montar(campos = []) {
  const { document } = parseHTML(`<html><body><div id="a">${editor.render(campos, op)}</div><div id="b">${editor.render([], op)}</div></body></html>`);
  // linkedom não implementa selectedOptions nem foco; opções reais continuam no DOM.
  document.querySelectorAll('select').forEach((s) => Object.defineProperty(s, 'selectedOptions', { get: () => [...s.options].filter((o) => o.selected) }));
  return document;
}
test('seleção, nome, remoção e reabertura são independentes por funil', () => {
  const doc = montar();
  const a = doc.querySelector('#a'), b = doc.querySelector('#b');
  const select = a.querySelector('select');
  select.options[1].selected = true;
  editor.click({ target: a.querySelector('[data-rd-adicionar]') });
  a.querySelector('[data-rd-rotulo]').value = 'Responsável pela confirmação';
  const salvo = editor.ler(a);
  assert.deepEqual(salvo, [{ fonte: 'deal:sdr', rotulo: 'Responsável pela confirmação' }]);
  assert.deepEqual(editor.ler(b), []);
  assert.deepEqual(editor.ler(montar(salvo).querySelector('#a')), salvo);
  editor.click({ target: a.querySelector('[data-rd-remover]') });
  assert.deepEqual(editor.ler(a), []);
  assert.equal(select.options[1].disabled, false);
});
test('fonte desaparecida é preservada e sinalizada; rótulos são escapados', () => {
  const doc = montar([{ fonte: 'deal:antigo', rotulo: '<script>alert(1)</script>' }]);
  assert.equal(doc.querySelectorAll('script').length, 0);
  assert.match(doc.querySelector('#a').textContent, /Não retornado pelo RD/);
  assert.equal(editor.ler(doc.querySelector('#a'))[0].rotulo, '<script>alert(1)</script>');
});
test('edição desabilitada não adiciona nem remove campos', () => {
  const { document } = parseHTML(editor.render([{ fonte: 'deal:sdr', rotulo: 'SDR' }], op, ' disabled'));
  editor.click({ target: document.querySelector('[data-rd-remover]') });
  assert.equal(editor.ler(document).length, 1);
});
