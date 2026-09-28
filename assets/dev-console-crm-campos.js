/* Seleção independente por funil. A origem vem apenas dos campos realmente observados naquele funil. */
(function (root) {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let ultimoOp = null;

  function funil(op, pipelineId) {
    return (op?.funis || []).find((f) => String(f.id) === String(pipelineId)) || null;
  }
  function fontes(op, pipelineId) {
    const f = funil(op, pipelineId);
    if (!f) return [];
    return [...(f.camposNativos || []), ...(f.campos || []).map((c) => ({
      fonte: `${c.entidade}:${c.slug}`, rotulo: `${c.entidade === 'deal' ? 'Negociação' : 'Contato'}: ${c.nome}`,
    }))];
  }
  function camposMapeaveis(op, pipelineId) {
    return fontes(op, pipelineId).filter((o) => o.fonte.startsWith('deal:') || o.fonte.startsWith('contact:'));
  }
  function pipelineDo(card) {
    return card?.querySelector?.('[data-rd-funil-toggle]')?.value || card?.querySelector?.('[data-rd-stage]')?.dataset?.pipeline || '';
  }
  function linha(campo, opcoes, dis, verificar = true) {
    const encontrado = opcoes.find((o) => o.fonte === campo.fonte);
    const aviso = verificar && !encontrado ? ' · Salvo anteriormente; esta origem não está disponível neste funil agora.' : '';
    return `<div class="dc-rd-campo" data-rd-campo data-fonte="${esc(campo.fonte)}">
      <label>Nome para este funil<input data-rd-rotulo value="${esc(campo.rotulo)}" maxlength="100"${dis}></label>
      <small data-rd-origem-resumo>${esc(encontrado?.rotulo || campo.fonte)}${esc(aviso)}</small>
      <button type="button" data-rd-remover${dis}>Remover campo</button>
    </div>`;
  }
  function render(campos, op, dis = '') {
    ultimoOp = op;
    return `<section class="dc-rd-subsection" data-rd-selecao>
      <div class="dc-rd-subhead"><b>Campos disponíveis neste funil</b></div>
      <p class="dc-muted">A lista abaixo é montada a partir das negociações e contatos deste funil no RD. Não usamos catálogo global nem campos genéricos. Você pode escolher e renomear somente origens disponíveis aqui. Até 100 campos.</p>
      <label>Campo de origem<select data-rd-origem${dis}><option value="">Carregando campos deste funil…</option></select></label>
      <button type="button" data-rd-adicionar${dis}>Adicionar campo</button>
      <p role="status" data-rd-aviso></p>
      <div data-rd-lista>${campos.map((c) => linha(c, [], dis, false)).join('')}</div>
      <p class="dc-muted">Campos salvos que deixarem de existir no funil são mantidos apenas para você revisar ou remover; eles não voltam para a lista de opções disponíveis.</p>
    </section>`;
  }
  function ler(card) {
    return [...card.querySelectorAll('[data-rd-campo]')].map((el) => ({ fonte: el.dataset.fonte, rotulo: el.querySelector('[data-rd-rotulo]').value.trim() }));
  }
  function reporSelect(select, opcoes, escolhidos) {
    if (!select) return;
    select.innerHTML = `<option value="">Selecione um campo deste funil</option>${opcoes.map((o) => `<option value="${esc(o.fonte)}"${escolhidos.has(o.fonte) ? ' disabled' : ''}>${esc(o.rotulo)}</option>`).join('')}`;
  }
  function reporMapeamento(select, opcoes) {
    const atual = select.value || 'auto';
    const base = [{ fonte: 'auto', rotulo: 'Automático' }, { fonte: 'ignorar', rotulo: 'Não importar' }, ...opcoes];
    if (!base.some((o) => o.fonte === atual)) base.push({ fonte: atual, rotulo: `Salvo anteriormente: ${atual}` });
    select.innerHTML = base.map((o) => `<option value="${esc(o.fonte)}"${o.fonte === atual ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('');
  }
  function hidratarCard(card) {
    if (!card || !ultimoOp) return;
    const pipelineId = pipelineDo(card);
    if (!pipelineId) return;
    const opcoes = fontes(ultimoOp, pipelineId);
    const escolhidos = new Set(ler(card).map((c) => c.fonte));
    reporSelect(card.querySelector('[data-rd-origem]'), opcoes, escolhidos);
    card.querySelectorAll('[data-rd-campo]').forEach((row) => {
      const fonte = row.dataset.fonte;
      const encontrado = opcoes.find((o) => o.fonte === fonte);
      const resumo = row.querySelector('[data-rd-origem-resumo]');
      if (resumo) resumo.textContent = encontrado?.rotulo || `${fonte} · Salvo anteriormente; esta origem não está disponível neste funil agora.`;
      row.classList.toggle('is-unavailable', !encontrado);
    });
    const mapeaveis = camposMapeaveis(ultimoOp, pipelineId);
    card.querySelectorAll('[data-rd-map]').forEach((select) => reporMapeamento(select, mapeaveis));
    const body = card.querySelector('.dc-rd-funil-body');
    if (body && !body.querySelector('[data-rd-escopo-aviso]')) {
      body.insertAdjacentHTML('afterbegin', `<div class="dc-note" data-rd-escopo-aviso><b>Origens deste funil.</b> ${opcoes.length} campo(s) disponível(is) encontrados nas negociações e contatos deste pipeline.</div>`);
    }
  }
  function hidratar(rootNode) {
    if (typeof document === 'undefined') return;
    const rootEl = rootNode?.querySelectorAll ? rootNode : document;
    rootEl.querySelectorAll('.dc-rd-funil').forEach(hidratarCard);
    document.querySelectorAll('.dc-rd-default-map').forEach((el) => { el.style.display = 'none'; });
  }
  function click(event) {
    const button = event.target.closest?.('[data-rd-adicionar], [data-rd-remover]');
    if (!button || button.disabled) return false;
    const section = button.closest('[data-rd-selecao]');
    const card = button.closest('.dc-rd-funil');
    hidratarCard(card);
    const select = section.querySelector('[data-rd-origem]');
    const aviso = section.querySelector('[data-rd-aviso]');
    aviso.textContent = '';
    if (button.hasAttribute('data-rd-remover')) {
      button.closest('[data-rd-campo]').remove();
      hidratarCard(card);
      aviso.textContent = 'Campo removido da seleção. Salve para aplicar.';
      return true;
    }
    if (ler(section).length >= 100) { aviso.textContent = 'Limite de 100 campos por funil.'; return true; }
    const option = select.selectedOptions?.[0] || [...select.options].find((o) => o.selected);
    if (!option?.value || option.disabled) { aviso.textContent = 'Selecione um campo disponível neste funil.'; return true; }
    const opcoes = fontes(ultimoOp, pipelineDo(card));
    section.querySelector('[data-rd-lista]').insertAdjacentHTML('beforeend', linha({ fonte: option.value, rotulo: option.textContent }, opcoes, ''));
    hidratarCard(card);
    select.value = '';
    section.querySelector('[data-rd-lista]').lastElementChild.querySelector('input')?.focus?.();
    aviso.textContent = 'Campo adicionado para este funil. Salve para aplicar.';
    return true;
  }

  if (typeof document !== 'undefined') {
    const observar = () => {
      hidratar(document);
      if (typeof MutationObserver !== 'undefined' && document.body) new MutationObserver(() => hidratar(document)).observe(document.body, { childList: true, subtree: true });
      document.addEventListener('click', () => setTimeout(() => hidratar(document), 0));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observar, { once: true }); else observar();
  }

  const api = { fontes, render, ler, click, hidratar, hidratarCard };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DCCrmCampos = api;
})(typeof window === 'undefined' ? globalThis : window);
