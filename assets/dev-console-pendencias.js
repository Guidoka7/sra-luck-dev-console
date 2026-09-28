(() => {
  // Pendências de integração (RD Station). Fonte: GET /api/admin/integrations/pendencias no Sra Luck,
  // pelo proxy M2M (ver: integrations.view; reprocessar/descartar: integrations.manage).
  // Esta tela não decide pagamento nem venda: reprocessa com a mesma chave ou registra o descarte.
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const TIPOS = {
    execucao_falhou: ['Execução falhou', 'bad', 'A leitura do RD falhou inteira; nenhuma negociação foi processada.'],
    execucao_interrompida: ['Execução interrompida', 'bad', 'A execução parou no meio e não registrou o resultado.'],
    negociacao_com_erro: ['Negociação com erro', 'bad', 'Uma negociação específica falhou.'],
    ganha_fora_do_funil: ['Ganha fora do funil', 'warn', 'Venda ganha num funil que não está configurado.'],
    campos_ausentes: ['Campos ausentes', 'warn', 'Venda sem CPF, valor ou parcelas.'],
    vendedora_nao_vinculada: ['Vendedora sem vínculo', 'warn', 'Responsável do RD sem pessoa da equipe.'],
    status_nao_ganha: ['Não está ganha', 'info', 'Venda criada com negociação perdida ou em andamento.'],
    duplicidade_possivel: ['Possível duplicidade', 'info', 'Mesmo CPF, telefone ou e-mail de outro registro.'],
    excluida_no_rd: ['Excluída no RD', 'info', 'A negociação foi excluída no RD.'],
  };
  const ORIGEM = { agendada: 'Agendada', manual: 'Manual', webhook: 'Webhook', reprocessamento: 'Reprocessamento', recalculo: 'Recálculo', vinculo_equipe: 'Vínculo da equipe' };
  const mascara = (id) => { const s = String(id || ''); return s.length > 10 ? `…${s.slice(-6)}` : s; };
  const podeAgir = () => { const u = DC.currentUser; const p = u?.effectivePermissions || u?.permissions || []; return u?.role === 'owner' || p.includes('*') || p.includes('integrations.manage'); };
  let tipoSel = '';

  function linha(p) {
    const t = TIPOS[p.tipo] || [p.tipo, 'neutral', ''];
    const campos = (p.campos_faltantes || []).length ? ` · falta: ${esc(p.campos_faltantes.join(', '))}` : '';
    const acoes = p.estado === 'aberta' && podeAgir()
      ? `<button class="dc-btn" data-reprocessar="${esc(p.id)}"${p.tipo === 'duplicidade_possivel' ? ' disabled title="Duplicidade é decidida na revisão do RD, no Admin"' : ''}><i data-lucide="rotate-cw"></i>Reprocessar</button><button class="dc-btn danger" data-descartar="${esc(p.id)}"><i data-lucide="x"></i>Descartar</button>`
      : (p.estado === 'aberta' ? '<span class="dc-muted">Somente leitura</span>' : `<span class="dc-muted">${esc(p.resolucao || p.estado)} · ${esc(DC.relTime(p.resolvido_em))}${p.nota ? ` · ${esc(p.nota)}` : ''}</span>`);
    return `<div class="dc-card" style="padding:12px;margin-bottom:8px"><div class="dc-section-head" style="align-items:flex-start"><div><div>${DC.chip(t[0], t[1])} <span class="dc-mono dc-muted" title="${esc(p.external_id)}">${esc(mascara(p.external_id))}</span> <span class="dc-muted">· ${esc(ORIGEM[p.origem] || p.origem || '—')} · ${esc(p.ocorrencias)}× · última ${esc(DC.relTime(p.ultima_ocorrencia_em))} · primeira ${esc(p.primeira_ocorrencia_em ? DC.dateTimeFmt.format(new Date(p.primeira_ocorrencia_em)) : "—")}</span></div><div style="margin-top:6px"><b>${esc(p.motivo)}</b>${campos}</div><div class="dc-muted" style="margin-top:3px">Ação: ${esc(p.acao_necessaria)}</div></div><div class="dc-toolbar">${acoes}</div></div></div>`;
  }

  async function carregar() {
    const estado = DC.$('pdEstado').value;
    const q = new URLSearchParams({ estado }); if (tipoSel) q.set('tipo', tipoSel);
    const r = await DC.api(`/api/admin/integrations/pendencias?${q}`);
    DC.$('lastRefresh').textContent = new Date().toLocaleTimeString('pt-BR');
    if (!r.ok) { DC.$('pdLista').innerHTML = `<div class="dc-warn-box">${esc(r.error || 'Não foi possível ler a fila.')}</div>`; DC.setTopStatus('Fila indisponível', 'bad'); return; }
    const d = r.data || {}, res = d.resumo || {}, porTipo = res.abertasPorTipo || {};
    const total = Object.values(porTipo).reduce((a, b) => a + b, 0);
    DC.$('pdResumo').innerHTML = [`<span class="dc-ov-count"><b>${esc(total)}</b> abertas</span>`, `<span class="dc-ov-count"><b>${esc(res.vendasRd ?? '—')}</b> vendas do RD</span>`, `<span class="dc-ov-count"><b>${esc(res.vendasValidasBi ?? '—')}</b> válidas para o BI</span>`]
      .concat(Object.entries(porTipo).map(([k, n]) => `<span class="dc-ov-count" title="${esc((TIPOS[k] || [])[2] || '')}">${DC.chip((TIPOS[k] || [k])[0], (TIPOS[k] || [0, 'neutral'])[1])} ${esc(n)}</span>`)).join('');
    DC.$('pdTitulo').textContent = estado === 'aberta' ? 'Exigem ação' : estado === 'resolvida' ? 'Resolvidas' : 'Descartadas';
    const itens = d.itens || [];
    DC.$('pdLista').innerHTML = itens.length ? itens.map(linha).join('') : '<div class="dc-empty">Nada nesta situação.</div>';
    DC.setTopStatus(total ? `${total} pendência(s) aberta(s)` : 'Sem pendências abertas', total ? 'warn' : 'ok');
    window.lucide?.createIcons();
  }

  async function reprocessar(id, btn) {
    if (!await DC.modal('Reprocessar pendência', '<p>Relê a negociação no RD (ou recalcula com os dados já corrigidos no Admin). Nunca cria uma venda repetida.</p>', { confirmText: 'Reprocessar' })) return;
    const r = await DC.action(btn, () => DC.api(`/api/admin/integrations/pendencias/${encodeURIComponent(id)}/reprocessar`, { method: 'POST', body: {} }));
    if (r?.ok) { DC.toast(r.data?.estado === 'aberta' ? 'Reprocessada; a causa continua — a pendência segue aberta.' : 'Reprocessada e resolvida.'); await carregar(); }
  }
  async function descartar(id, btn) {
    const ok = await DC.modal('Descartar pendência', '<label class="dc-field"><span>Motivo (obrigatório, fica na auditoria)</span><textarea id="pdMotivo" rows="3" maxlength="500" class="dc-input"></textarea></label>', { confirmText: 'Descartar', danger: true });
    if (!ok) return;
    const motivo = String(document.getElementById('pdMotivo')?.value || '').trim();
    document.querySelector('.dc-modal-wrap')?.remove();
    if (motivo.length < 5) { DC.toast('Informe o motivo (mínimo 5 caracteres).', true); return; }
    const r = await DC.action(btn, () => DC.api(`/api/admin/integrations/pendencias/${encodeURIComponent(id)}/descartar`, { method: 'POST', body: { motivo } }));
    if (r?.ok) { DC.toast('Descartada.'); await carregar(); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!await DC.guard()) return;
    DC.$('pdTipo').innerHTML = '<option value="">Todos os tipos</option>' + Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('');
    DC.$('pdTipo').onchange = (e) => { tipoSel = e.target.value; carregar(); };
    DC.$('pdEstado').onchange = carregar;
    DC.$('refreshBtn').onclick = carregar;
    DC.$('pdLista').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.reprocessar) reprocessar(b.dataset.reprocessar, b);
      if (b.dataset.descartar) descartar(b.dataset.descartar, b);
    });
    await carregar();
  });
})();
