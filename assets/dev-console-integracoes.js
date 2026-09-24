(() => {
  // Padrão de integração no Dev Console. Monta as abas a partir do catálogo do Sra Luck
  // (GET /api/admin/integrations/catalogo): credenciais mascaradas, funções com situação real,
  // origem/destino, mapeamento, sincronização, webhooks, histórico e regras. A única escrita
  // é a configuração não secreta de funções (POST /api/admin/integrations/config); segredos
  // continuam no cofre do Admin.
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const SITUACAO = { disponivel: ['Disponível', 'ok'], api_permite: ['API permite · não implementado', 'warn'], api_nao_permite: ['API não permite', 'neutral'] };
  const DIRECAO = { entrada: 'Entrada', saida: 'Saída', bidirecional: 'Bidirecional', interna: 'Interna' };
  const MODO = { manual: 'Manual', agendada: 'Agendada', webhook: 'Webhook', polling: 'Polling', sob_demanda: 'Sob demanda' };
  const PROMPT_LABEL = {
    mensagem_diaria: ['Instruções de estilo', 'Substitui as instruções de estilo padrão da mensagem diária. Em branco, usa o padrão.'],
    notificacoes: ['Orientação extra de tom', 'Somada às regras fixas de segurança (sem CPF, sem inventar valores). Não substitui essas regras.'],
  };
  const S = { catalogo: null, erro: null, aba: null };

  async function carregar() {
    const r = await DC.api('/api/admin/integrations/catalogo');
    S.catalogo = r.ok ? r.data : null;
    S.erro = r.ok ? null : (r.status === 404 ? 'O Sra Luck em produção ainda não tem o catálogo de integrações (branch claude/integracoes-padrao).' : r.error || 'Catálogo indisponível.');
    return S.catalogo;
  }
  const integracao = (id) => (S.catalogo?.integracoes || []).find((i) => i.id === id) || null;
  const podeConfigurar = () => ['owner', 'developer'].includes(String(DC.currentUser?.role || '').toLowerCase());

  const chipSit = (s) => DC.chip(...(SITUACAO[s] || [s, 'neutral']));

  function abaFuncoes(i) {
    return i.funcoes.map((f) => `<article class="dc-ip-fn ${f.situacao}">
      <header><strong>${esc(f.nome)}</strong>${chipSit(f.situacao)}${DC.chip(DIRECAO[f.direcao] || f.direcao, 'neutral')}</header>
      <p>${esc(f.descricao)}</p>
      ${f.motivo ? `<p class="dc-ip-motivo">${esc(f.motivo)}</p>` : ''}
      ${f.config ? formConfig(i, f) : ''}
    </article>`).join('');
  }

  function formConfig(i, f) {
    const c = f.config, dis = podeConfigurar() ? '' : ' disabled', [pl, ph] = PROMPT_LABEL[f.id] || ['Prompt', ''];
    const uso = c.limiteDiario ? `${f.usoHoje}/${c.limiteDiario} chamadas hoje` : `${f.usoHoje} chamada(s) hoje · sem limite`;
    return `<form class="dc-ip-form" data-cfg="${esc(f.id)}" data-versao="${f.versao}">
      <label class="dc-ip-toggle"><span class="dc-switch"><input type="checkbox" name="ativo"${c.ativo ? ' checked' : ''}${dis}/><span></span></span><b>${c.ativo ? 'Função ligada' : 'Função desligada'}</b><small>${esc(uso)}</small></label>
      <div class="dc-ip-grid">
        <label>Modelo<input name="modelo" value="${esc(c.modelo || '')}" placeholder="em branco = modelo geral" maxlength="80"${dis}/></label>
        <label>Temperatura<input name="temperatura" type="number" min="0" max="2" step="0.1" value="${c.temperatura ?? ''}" placeholder="padrão"${dis}/></label>
        <label>Máx. tokens<input name="maxTokens" type="number" min="64" max="8192" step="1" value="${c.maxTokens ?? ''}" placeholder="padrão"${dis}/></label>
        <label>Limite diário<input name="limiteDiario" type="number" min="1" max="1000" step="1" value="${c.limiteDiario ?? ''}" placeholder="sem limite"${dis}/></label>
      </div>
      <label class="dc-ip-full">${esc(pl)}<textarea name="prompt" maxlength="1500" rows="3" placeholder="${esc(ph)}"${dis}>${esc(c.prompt || '')}</textarea><small>${esc(ph)}</small></label>
      <footer><small class="dc-muted">${f.versao ? `Versão ${f.versao} · ${f.atualizadoEm ? DC.relTime(f.atualizadoEm) : ''}` : 'Sem configuração salva: valem os padrões do sistema.'}</small>${podeConfigurar() ? '<button class="dc-btn primary" type="submit">Salvar função</button>' : '<small class="dc-muted">Só owner/developer podem alterar.</small>'}</footer>
    </form>`;
  }

  const abaDados = (i) => `<h3 class="dc-nc-h">Origem e destino por função</h3>
    <div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Função</th><th>Origem</th><th>Destino</th><th>Situação</th></tr></thead><tbody>${i.funcoes.map((f) => `<tr><td>${esc(f.nome)}</td><td>${esc(f.origem)}</td><td>${esc(f.destino)}</td><td>${chipSit(f.situacao)}</td></tr>`).join('')}</tbody></table></div>
    <h3 class="dc-nc-h">Mapeamento de campos</h3>${i.mapeamento.length ? `<div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Origem</th><th>Destino</th><th>Observação</th></tr></thead><tbody>${i.mapeamento.map((m) => `<tr><td class="dc-mono">${esc(m.origem)}</td><td class="dc-mono">${esc(m.destino)}</td><td>${esc(m.observacao || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dc-empty">Sem mapeamento de campos nesta integração.</div>'}`;

  const abaSync = (i) => `<div class="dc-ip-list">${i.sincronizacao.map((m) => `<div class="dc-ip-row"><b>${esc(MODO[m.modo] || m.modo)}</b><span>${esc(m.descricao)}${m.motivo ? `<small>${esc(m.motivo)}</small>` : ''}</span>${chipSit(m.situacao)}</div>`).join('') || '<div class="dc-empty">Sem modos de sincronização.</div>'}</div>`;

  const abaWebhooks = (i) => `<div class="dc-ip-list">${i.webhooks.map((w) => `<div class="dc-ip-row"><b>${w.direcao === 'entrada' ? 'Entrada' : 'Saída'}</b><span>${esc(w.descricao)}${w.caminho ? `<code>${esc(w.caminho)}</code>` : ''}${w.eventos.length ? `<small>Eventos: ${esc(w.eventos.join(', '))}</small>` : ''}<small>Autenticação: ${esc(w.autenticacao)}</small>${w.motivo ? `<small>${esc(w.motivo)}</small>` : ''}</span>${chipSit(w.situacao)}</div>`).join('') || '<div class="dc-empty">Esta integração não usa webhooks.</div>'}</div>`;

  const abaRegras = (i) => `<h3 class="dc-nc-h">Autenticação</h3><p class="dc-ov-p">${esc(i.autenticacao)}</p>
    ${i.limites.length ? `<h3 class="dc-nc-h">Limites</h3><ul class="dc-ip-ul">${i.limites.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${i.regras.length ? `<h3 class="dc-nc-h">Regras que não mudam</h3><ul class="dc-ip-ul">${i.regras.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <p class="dc-ov-p dc-muted">Documentação do provedor: <a href="${esc(i.documentacao)}" target="_blank" rel="noopener">${esc(i.documentacao)}</a></p>`;

  /** Drawer do padrão. partes: { topo, credenciais, eventos, extras, rodape } em HTML já montado pela página. */
  function abrir(id, partes, aoSalvar) {
    const i = integracao(id);
    if (!i) return false;
    const disp = i.funcoes.filter((f) => f.situacao === 'disponivel').length;
    const abas = [
      ['visao', 'Visão', `${partes.topo}${partes.extras || ''}<h3 class="dc-nc-h">Credenciais</h3>${partes.credenciais}<div class="dc-note" style="margin-top:6px">Segredos ficam no cofre cifrado do Sra Luck e são editados no Admin → Integrações. Aqui aparecem só a origem e a máscara.</div>
        <h3 class="dc-nc-h">Resumo</h3><p class="dc-ov-p">${disp} de ${i.funcoes.length} funções disponíveis · ${i.funcoes.filter((f) => f.situacao === 'api_permite').length} que a API permite e ainda não foram feitas · ${i.funcoes.filter((f) => f.situacao === 'api_nao_permite').length} que a API não permite.</p>`],
      ['funcoes', `Funções (${i.funcoes.length})`, abaFuncoes(i)],
      ['dados', 'Dados e mapeamento', abaDados(i)],
      ['sync', 'Sincronização', abaSync(i)],
      ['webhooks', 'Webhooks', abaWebhooks(i)],
      ['historico', 'Histórico', `${partes.eventos}<p class="dc-ov-p dc-muted" style="margin-top:8px">Testes, sincronizações, configurações e credenciais alteradas (auditoria do Sra Luck).</p>`],
      ['regras', 'Regras e limites', abaRegras(i)],
    ];
    // Ao reabrir depois de salvar, volta para a mesma aba.
    const ativa = S.aba?.id === id && abas.some(([k]) => k === S.aba.aba) ? S.aba.aba : 'visao';
    S.aba = { id, aba: ativa };
    const ov = DC.openDrawer(i.nome, `<div class="dc-tabs" role="tablist">${abas.map(([k, l]) => `<button type="button" data-aba="${k}" class="${k === ativa ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>${abas.map(([k, , h]) => `<section data-painel="${k}"${k === ativa ? '' : ' hidden'}>${h}</section>`).join('')}`, { footer: partes.rodape || '' });
    ov.querySelector('.dc-drawer')?.classList.add('wide');
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-aba]'); if (!b) return;
      S.aba = { id, aba: b.dataset.aba };
      ov.querySelectorAll('[data-aba]').forEach((x) => x.classList.toggle('active', x === b));
      ov.querySelectorAll('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== b.dataset.aba; });
    });
    ov.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-cfg]'); if (!form) return;
      e.preventDefault();
      const v = (n) => form.elements[n].value.trim();
      const num = (n) => (v(n) === '' ? null : Number(v(n)));
      const config = { ativo: form.elements.ativo.checked, modelo: v('modelo') || null, prompt: v('prompt') || null, temperatura: num('temperatura'), maxTokens: num('maxTokens'), limiteDiario: num('limiteDiario') };
      const btn = form.querySelector('[type="submit"]');
      const r = await DC.action(btn, () => DC.api('/api/admin/integrations/config', { method: 'POST', body: { provedor: id, funcao: form.dataset.cfg, config, versao: Number(form.dataset.versao) } }), { success: 'Função salva. Vale a partir da próxima chamada (até 30 s de cache).' });
      if (r?.ok) { await carregar(); aoSalvar?.(id); }
    });
    ov.addEventListener('change', (e) => {
      const t = e.target; if (t.name !== 'ativo') return;
      const b = t.closest('.dc-ip-toggle')?.querySelector('b'); if (b) b.textContent = t.checked ? 'Função ligada' : 'Função desligada';
    });
    return true;
  }

  window.DCIntegracoes = { carregar, integracao, abrir, erro: () => S.erro, catalogo: () => S.catalogo };
})();
