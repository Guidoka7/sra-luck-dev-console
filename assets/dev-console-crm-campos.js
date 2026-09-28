/* Seleção independente por funil. Fontes são IDs do catálogo, nunca nomes inferidos. */
(function (root) {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function fontes(op) {
    return [...(op?.camposNativos || []), ...(op?.campos || []).map((c) => ({
      fonte: `${c.entidade}:${c.slug}`, rotulo: `${c.entidade === 'deal' ? 'Negociação' : 'Contato'}: ${c.nome}`,
    }))];
  }
  function linha(campo, opcoes, dis) {
    const existe = opcoes.some((o) => o.fonte === campo.fonte);
    return `<div class="dc-rd-campo" data-rd-campo data-fonte="${esc(campo.fonte)}">
      <label>Nome para este funil<input data-rd-rotulo value="${esc(campo.rotulo)}" maxlength="100"${dis}></label>
      <small>${esc(opcoes.find((o) => o.fonte === campo.fonte)?.rotulo || campo.fonte)}${existe ? '' : ' · Não retornado pelo RD; confira a origem antes de sincronizar.'}</small>
      <button type="button" data-rd-remover${dis}>Remover campo</button>
    </div>`;
  }
  function render(campos, op, dis = '') {
    const opcoes = fontes(op);
    return `<section class="dc-rd-subsection" data-rd-selecao>
      <div class="dc-rd-subhead"><b>Campos escolhidos para este funil</b></div>
      <p class="dc-muted">Escolha os campos do RD que deseja acompanhar e dê um nome a cada um. A seleção é independente em cada funil. Valores ausentes não são preenchidos automaticamente. Até 100 campos.</p>
      <label>Campo de origem<select data-rd-origem${dis}><option value="">Selecione um campo</option>${opcoes.map((o) => `<option value="${esc(o.fonte)}"${campos.some((c) => c.fonte === o.fonte) ? ' disabled' : ''}>${esc(o.rotulo)}</option>`).join('')}</select></label>
      <button type="button" data-rd-adicionar${dis}>Adicionar campo</button>
      <p role="status" data-rd-aviso></p>
      <div data-rd-lista>${campos.map((c) => linha(c, opcoes, dis)).join('')}</div>
      <p class="dc-muted">Os campos selecionados ficam no registro da importação. Os destinos do cadastro são configurados abaixo. Esta seleção não cria indicadores de BI.</p>
    </section>`;
  }
  function ler(card) {
    return [...card.querySelectorAll('[data-rd-campo]')].map((el) => ({ fonte: el.dataset.fonte, rotulo: el.querySelector('[data-rd-rotulo]').value.trim() }));
  }
  function click(event) {
    const button = event.target.closest?.('[data-rd-adicionar], [data-rd-remover]');
    if (!button || button.disabled) return false;
    const section = button.closest('[data-rd-selecao]');
    const select = section.querySelector('[data-rd-origem]');
    const aviso = section.querySelector('[data-rd-aviso]');
    aviso.textContent = '';
    if (button.hasAttribute('data-rd-remover')) {
      const row = button.closest('[data-rd-campo]');
      [...select.options].forEach((o) => { if (o.value === row.dataset.fonte) o.disabled = false; });
      row.remove();
      aviso.textContent = 'Campo removido da seleção. Salve para aplicar.';
      return true;
    }
    if (ler(section).length >= 100) { aviso.textContent = 'Limite de 100 campos por funil.'; return true; }
    const option = select.selectedOptions[0];
    if (!option?.value || option.disabled) { aviso.textContent = 'Selecione um campo de origem disponível.'; return true; }
    const opcoes = [...select.options].map((o) => ({ fonte: o.value, rotulo: o.textContent }));
    section.querySelector('[data-rd-lista]').insertAdjacentHTML('beforeend', linha({ fonte: option.value, rotulo: option.textContent }, opcoes, ''));
    option.disabled = true;
    select.value = '';
    section.querySelector('[data-rd-lista]').lastElementChild.querySelector('input').focus();
    aviso.textContent = 'Campo adicionado. Salve para aplicar.';
    return true;
  }
  const api = { fontes, render, ler, click };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DCCrmCampos = api;
})(typeof window === 'undefined' ? globalThis : window);
