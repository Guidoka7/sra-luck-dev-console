(() => {
  // Padrão de integração no Dev Console. Monta as abas a partir do catálogo do Sra Luck
  // (GET /api/admin/integrations/catalogo): credenciais mascaradas, funções com situação real,
  // origem/destino, mapeamento, sincronização, webhooks, histórico e regras. O formulário de
  // cada função é gerado pela descrição de campos do catálogo.
  // Escritas daqui: configuração das funções catalogadas. As credenciais secretas são
  // gerenciadas pela camada de edição do Dev Console e permanecem cifradas no Sra Luck.
  // A operação financeira diária da Conta Azul continua no Admin; sua configuração é do Dev.
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const SITUACAO = { disponivel: ['Disponível', 'ok'], api_permite: ['API permite · não implementado', 'warn'], api_nao_permite: ['API não permite', 'neutral'] };
  const DIRECAO = { entrada: 'Entrada', saida: 'Saída', bidirecional: 'Bidirecional', interna: 'Interna' };
  const MODO = { manual: 'Manual', agendada: 'Agendada', webhook: 'Webhook', polling: 'Polling', sob_demanda: 'Sob demanda' };
  const PROMPT_LABEL = {
    mensagem_diaria: ['Instruções de estilo', 'Substitui as instruções de estilo padrão da mensagem diária. Em branco, usa o padrão.'],
    notificacoes: ['Orientação extra de tom', 'Somada às regras fixas de segurança (sem CPF, sem inventar valores). Não substitui essas regras.'],
  };
  // Toda função que o catálogo marca como configurável é editável pelo Dev.
  // O backend continua sendo a autoridade: valida esquema, versão e permissões.
  const EDITAVEL_AQUI = null;
  const OPCOES_URL = { rd_station: '/api/admin/integrations/rd-station/opcoes', conta_azul: '/api/admin/integrations/conta-azul/opcoes' };
  const S = { catalogo: null, erro: null, aba: null, opcoes: {} };

  async function carregar() {
    const r = await DC.api('/api/admin/integrations/catalogo');
    S.catalogo = r.ok ? r.data : null;
    S.erro = r.ok ? null : (r.status === 404 ? 'O Sra Luck em produção ainda não tem o catálogo de integrações (branch claude/integracoes-padrao).' : r.error || 'Catálogo indisponível.');
    return S.catalogo;
  }
  const integracao = (id) => (S.catalogo?.integracoes || []).find((i) => i.id === id) || null;
  const podeConfigurar = () => Boolean(DC.currentUser);
  const chip = (s) => DC.chip(...(SITUACAO[s] || [s, 'neutral']));
  const quando = (v) => (v ? DC.dateTimeFmt.format(new Date(v)) : '—');

  // ------------------------------------------------------------------ formulário genérico

  async function opcoesDe(provedor) {
    if (!OPCOES_URL[provedor]) return null;
    if (S.opcoes[provedor]) return S.opcoes[provedor];
    const r = await DC.api(OPCOES_URL[provedor], { timeout: 30000 });
    S.opcoes[provedor] = r.ok ? r.data : { erro: r.error || 'Lista do provedor indisponível.' };
    return S.opcoes[provedor];
  }

  function lista(campo, op, valores) {
    if (campo.opcoes) return campo.opcoes;
    if (!op || op.erro) return [];
    if (campo.opcoesDe === 'rd_funis') return (op.funis || []).map((f) => ({ valor: f.id, rotulo: f.nome }));
    if (campo.opcoesDe === 'rd_etapas') return ((op.funis || []).find((f) => f.id === valores.pipelineId)?.etapas || []).map((e) => ({ valor: e.id, rotulo: e.nome }));
    if (campo.opcoesDe === 'rd_campos') return [{ valor: 'auto', rotulo: 'Automático' }, { valor: 'ignorar', rotulo: 'Não importar' }, ...(op.campos || []).map((c) => ({ valor: `${c.entidade}:${c.slug}`, rotulo: `${c.entidade === 'deal' ? 'Negociação' : 'Contato'}: ${c.nome}` }))];
    if (campo.opcoesDe === 'ca_contas') return (op.contas || []).map((c) => ({ valor: c.id, rotulo: c.nome }));
    if (campo.opcoesDe === 'ca_categorias') return (op.categorias || []).map((c) => ({ valor: c.id, rotulo: c.nome }));
    return [];
  }

  const opcoesHtml = (itens, atual, vazio = true) => {
    const l = itens.some((o) => String(o.valor) === String(atual)) || atual == null || atual === '' ? itens : [...itens, { valor: atual, rotulo: atual }];
    return `${vazio ? '<option value="">—</option>' : ''}${l.map((o) => `<option value="${esc(o.valor)}"${String(o.valor) === String(atual ?? '') ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('')}`;
  };

  function rdFunisHtml(campo, valores, op, dis) {
    const configurados = Array.isArray(valores.funis) ? valores.funis : [];
    const mapaPadrao = valores.mapeamento || {};
    const fontes = [{ valor: 'auto', rotulo: 'Automático' }, { valor: 'ignorar', rotulo: 'Não importar' }, ...(op?.campos || []).map((c) => ({ valor: `${c.entidade}:${c.slug}`, rotulo: `${c.entidade === 'deal' ? 'Negociação' : 'Contato'}: ${c.nome}` }))];
    const funis = op?.funis || [];
    if (!funis.length) return '<div class="dc-ip-full"><div class="dc-warn-box">Nenhum funil foi retornado pelo RD Station.</div></div>';

    const mapaAlterado = (mapa) => (campo.itens || []).filter((it) => {
      const atual = mapa?.[it.chave] ?? 'auto';
      const padrao = mapaPadrao?.[it.chave] ?? 'auto';
      return atual !== padrao;
    }).length;

    const funilHtml = (funil) => {
      const cfg = configurados.find((x) => x.pipelineId === funil.id) || null;
      const marcado = Boolean(cfg);
      const etapasMarcadas = Array.isArray(cfg?.etapas) ? cfg.etapas : [];
      const mapa = cfg?.mapeamento || mapaPadrao;
      const totalEtapas = (funil.etapas || []).length;
      const resumoEtapas = etapasMarcadas.length ? `${etapasMarcadas.length}/${totalEtapas} etapas` : `Todas as ${totalEtapas} etapas`;
      const alterados = mapaAlterado(mapa);
      return `<div class="dc-rd-funil${marcado ? ' active' : ''}">
        <div class="dc-rd-funil-row">
          <label class="dc-rd-funil-main">
            <input type="checkbox" data-rd-funil-toggle value="${esc(funil.id)}"${marcado ? ' checked' : ''}${dis}/>
            <span><b>${esc(funil.nome)}</b><small>${marcado ? `${resumoEtapas} · ${alterados ? `${alterados} campo(s) personalizado(s)` : 'preenchimento padrão'}` : `${totalEtapas} etapa(s)`}</small></span>
          </label>
          <button type="button" class="dc-rd-config-btn" data-rd-funil-open="${esc(funil.id)}" aria-expanded="false"${marcado ? '' : ' disabled'}>Configurar</button>
        </div>
        <div class="dc-rd-funil-body" data-rd-funil-body="${esc(funil.id)}" hidden>
          <section class="dc-rd-subsection">
            <div class="dc-rd-subhead"><b>Etapas</b><small>Nenhuma marcada = todas.</small></div>
            <div class="dc-ip-checks dc-rd-stage-grid">
              ${(funil.etapas || []).map((etapa) => `<label><input type="checkbox" data-rd-stage data-pipeline="${esc(funil.id)}" value="${esc(etapa.id)}"${etapasMarcadas.includes(etapa.id) ? ' checked' : ''}${dis}/><span>${esc(etapa.nome)}</span></label>`).join('') || '<small class="dc-muted">Este funil não retornou etapas.</small>'}
            </div>
          </section>
          <details class="dc-rd-subsection dc-rd-map-details">
            <summary><span><b>Preenchimento dos dados</b><small>${alterados ? `${alterados} diferente(s) do padrão` : 'Usando o preenchimento padrão'}</small></span><span>Editar campos</span></summary>
            <div class="dc-rd-map-grid">
              ${(campo.itens || []).map((it) => `<label><span>${esc(it.rotulo)}</span><select data-rd-map data-pipeline="${esc(funil.id)}" data-sub="${esc(it.chave)}"${dis}>${opcoesHtml(fontes, mapa?.[it.chave] ?? 'auto', false)}</select></label>`).join('')}
            </div>
          </details>
        </div>
      </div>`;
    };

    const selecionados = funis.filter((f) => configurados.some((x) => x.pipelineId === f.id));
    const restantes = funis
      .filter((f) => !configurados.some((x) => x.pipelineId === f.id))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    const listaSelecionados = selecionados.length
      ? `<div class="dc-rd-selected">
          <div class="dc-rd-group-label"><span>Selecionados</span><small>${selecionados.length} funil(is)</small></div>
          <div class="dc-rd-funnel-list">${selecionados.map(funilHtml).join('')}</div>
        </div>`
      : `<div class="dc-rd-fallback-note"><b>Todos os funis</b><span>Nenhum funil específico foi marcado. A importação usa o preenchimento padrão em todos.</span></div>`;

    const seletorRestantes = restantes.length
      ? `<details class="dc-rd-more-funnels">
          <summary><span><b>${selecionados.length ? 'Adicionar outros funis' : 'Escolher funis específicos'}</b><small>${selecionados.length ? 'Os demais ficam fora da seleção atual.' : 'Ao selecionar, a importação passa a usar somente os funis marcados.'}</small></span><span>${restantes.length} disponível(is)</span></summary>
          <div class="dc-rd-funnel-list">${restantes.map(funilHtml).join('')}</div>
        </details>`
      : '';

    return `<div class="dc-ip-full dc-rd-funnels">
      <div class="dc-rd-section-head">
        <div><b>${esc(campo.rotulo)}</b><small>${esc(campo.ajuda || '')}</small></div>
        <span class="dc-rd-count">${configurados.length ? `${configurados.length} selecionado(s)` : 'Todos os funis'}</span>
      </div>
      ${listaSelecionados}
      ${seletorRestantes}
    </div>`;
  }

  function campoHtml(f, campo, valores, op, dis) {
    const v = valores[campo.chave];
    let [rot, ajuda] = [campo.rotulo, campo.ajuda || ''];
    if (campo.chave === 'prompt' && PROMPT_LABEL[f.id]) [rot, ajuda] = PROMPT_LABEL[f.id];
    const aj = ajuda ? `<small>${esc(ajuda)}</small>` : '';
    switch (campo.tipo) {
      case 'booleano': return `<label class="dc-ip-toggle dc-ip-full"><span class="dc-switch"><input type="checkbox" data-c="${esc(campo.chave)}" data-t="booleano"${v ? ' checked' : ''}${dis}/><span></span></span><b>${esc(rot)}</b>${aj}</label>`;
      case 'numero': return `<label>${esc(rot)}<input type="number" data-c="${esc(campo.chave)}" data-t="numero" min="${campo.min ?? ''}" max="${campo.max ?? ''}" step="${campo.passo ?? 'any'}" value="${v ?? ''}" placeholder="${esc(campo.placeholder || '')}"${dis}/></label>`;
      case 'texto': return `<label>${esc(rot)}<input data-c="${esc(campo.chave)}" data-t="texto" maxlength="${campo.maxLength || 200}" value="${esc(v || '')}" placeholder="${esc(campo.placeholder || '')}"${dis}/></label>`;
      case 'texto_longo': return `<label class="dc-ip-full">${esc(rot)}<textarea data-c="${esc(campo.chave)}" data-t="texto" maxlength="${campo.maxLength || 1500}" rows="3" placeholder="${esc(ajuda)}"${dis}>${esc(v || '')}</textarea>${aj}</label>`;
      case 'selecao': return `<label>${esc(rot)}<select data-c="${esc(campo.chave)}" data-t="selecao"${dis}>${opcoesHtml(lista(campo, op, valores), v, !campo.opcoes)}</select>${aj}</label>`;
      case 'multi_selecao': {
        const itens = lista(campo, op, valores), marcados = Array.isArray(v) ? v : [];
        return `<div class="dc-ip-full" data-multi="${esc(campo.chave)}"><span>${esc(rot)}</span><div class="dc-ip-checks">${itens.length ? itens.map((o) => `<label><input type="checkbox" data-c="${esc(campo.chave)}" data-t="multi" value="${esc(o.valor)}"${marcados.includes(o.valor) ? ' checked' : ''}${dis}/>${esc(o.rotulo)}</label>`).join('') : `<small>${valores.pipelineId ? 'Sem etapas neste funil.' : 'Escolha o funil primeiro.'}</small>`}</div>${aj}</div>`;
      }
      case 'mapeamento': {
        const fontes = lista(campo, op, valores);
        const itens = fontes.length ? fontes : [{ valor: 'auto', rotulo: 'Automático' }, { valor: 'ignorar', rotulo: 'Não importar' }];
        if (f.id === 'importacao' && campo.chave === 'mapeamento') {
          const personalizados = (campo.itens || []).filter((it) => (v?.[it.chave] ?? 'auto') !== 'auto').length;
          return `<details class="dc-ip-full dc-rd-default-map">
            <summary><span><b>${esc(rot)}</b><small>${personalizados ? `${personalizados} campo(s) personalizado(s)` : 'Todos os campos em Automático'}</small></span><span>Editar</span></summary>
            <div class="dc-rd-map-grid">${(campo.itens || []).map((it) => `<label><span>${esc(it.rotulo)}</span><select data-c="${esc(campo.chave)}" data-sub="${esc(it.chave)}" data-t="mapa"${dis}>${opcoesHtml(itens, v?.[it.chave] ?? 'auto', false)}</select></label>`).join('')}</div>
            ${aj}
          </details>`;
        }
        return `<div class="dc-ip-full"><span>${esc(rot)}</span><div class="dc-ip-map">${(campo.itens || []).map((it) => `<span>${esc(it.rotulo)}</span><select data-c="${esc(campo.chave)}" data-sub="${esc(it.chave)}" data-t="mapa"${dis}>${opcoesHtml(itens, v?.[it.chave] ?? 'auto', false)}</select>`).join('')}</div>${aj}</div>`;
      }
      case 'grupo_booleano':
        if (f.id === 'importacao' && campo.chave === 'deduplicarPor') return `<div class="dc-ip-full dc-rd-dedupe"><span><b>${esc(rot)}</b><small>Evita criar a mesma cliente novamente.</small></span><div class="dc-ip-checks">${(campo.itens || []).map((it) => `<label><input type="checkbox" data-c="${esc(campo.chave)}" data-sub="${esc(it.chave)}" data-t="grupo"${v?.[it.chave] !== false ? ' checked' : ''}${dis}/>${esc(it.rotulo)}</label>`).join('')}</div></div>`;
        return `<div class="dc-ip-full"><span>${esc(rot)}</span><div class="dc-ip-checks">${(campo.itens || []).map((it) => `<label><input type="checkbox" data-c="${esc(campo.chave)}" data-sub="${esc(it.chave)}" data-t="grupo"${v?.[it.chave] !== false ? ' checked' : ''}${dis}/>${esc(it.rotulo)}</label>`).join('')}</div>${aj}</div>`;
      case 'rd_funis': return rdFunisHtml(campo, valores, op, dis);
      default: return '';
    }
  }

  function formHtml(i, f, op) {
    const editavelAqui = Boolean(f.config), pode = editavelAqui && podeConfigurar(), dis = pode ? '' : ' disabled';
    const c = f.config || {}, campos = f.campos || [];
    const uso = campos.some((x) => x.chave === 'limiteDiario') ? (c.limiteDiario ? `${f.usoHoje}/${c.limiteDiario} chamadas hoje` : `${f.usoHoje} chamada(s) hoje · sem limite`) : '';
    const rodape = !editavelAqui ? '<small class="dc-muted">Esta função não possui parâmetros configuráveis.</small>'
      : pode ? '<button class="dc-btn primary" type="submit">Salvar função</button>' : '<small class="dc-muted">Seu acesso não permite alterar.</small>';
    const rdImport = i.id === 'rd_station' && f.id === 'importacao';

    if (rdImport) {
      const principais = campos.filter((campo) => !['mapeamento', 'rd_funis', 'grupo_booleano'].includes(campo.tipo));
      const padrao = campos.filter((campo) => campo.tipo === 'mapeamento');
      const funis = campos.filter((campo) => campo.tipo === 'rd_funis');
      const dedupe = campos.filter((campo) => campo.tipo === 'grupo_booleano');
      return `<form class="dc-ip-form dc-rd-import-form" data-cfg="${esc(f.id)}" data-versao="${f.versao}">
        ${op?.erro ? `<div class="dc-warn-box">Listas do provedor indisponíveis: ${esc(op.erro)}</div>` : ''}
        ${uso ? `<small class="dc-muted">${esc(uso)}</small>` : ''}
        <div class="dc-rd-config-stack">
          <section class="dc-rd-block">
            <div class="dc-rd-block-head"><div><b>Importação automática</b><small>Ativação, frequência e status das negociações lidas no RD.</small></div></div>
            <div class="dc-ip-grid dc-rd-control-grid">${principais.map((campo) => campoHtml(f, campo, c, op, dis)).join('')}</div>
          </section>
          ${padrao.length ? `<section class="dc-rd-block dc-rd-block-flat">${padrao.map((campo) => campoHtml(f, campo, c, op, dis)).join('')}</section>` : ''}
          ${funis.length ? `<section class="dc-rd-block dc-rd-block-flat">${funis.map((campo) => campoHtml(f, campo, c, op, dis)).join('')}</section>` : ''}
          ${dedupe.length ? `<section class="dc-rd-block dc-rd-block-flat">${dedupe.map((campo) => campoHtml(f, campo, c, op, dis)).join('')}</section>` : ''}
        </div>
        <footer><small class="dc-muted">${f.versao ? `Versão ${f.versao} · ${f.atualizadoEm ? DC.relTime(f.atualizadoEm) : ''}` : 'Sem configuração salva: valem os padrões do sistema.'}</small>${rodape}</footer>
      </form>`;
    }

    return `<form class="dc-ip-form" data-cfg="${esc(f.id)}" data-versao="${f.versao}">
      ${op?.erro ? `<div class="dc-warn-box">Listas do provedor indisponíveis: ${esc(op.erro)}</div>` : ''}
      ${uso ? `<small class="dc-muted">${esc(uso)}</small>` : ''}
      <div class="dc-ip-grid">${campos.map((campo) => campoHtml(f, campo, c, op, dis)).join('')}</div>
      <footer><small class="dc-muted">${f.versao ? `Versão ${f.versao} · ${f.atualizadoEm ? DC.relTime(f.atualizadoEm) : ''}` : 'Sem configuração salva: valem os padrões do sistema.'}</small>${rodape}</footer>
    </form>`;
  }

  function lerFormulario(form, f) {
    const cfg = {};
    const numericas = new Set((f.campos || []).filter((c) => c.tipo === 'selecao' && c.opcoes?.every((o) => /^\d+$/.test(o.valor))).map((c) => c.chave));
    form.querySelectorAll('[data-c]').forEach((el) => {
      const k = el.dataset.c, t = el.dataset.t;
      if (t === 'booleano') cfg[k] = el.checked;
      else if (t === 'numero') cfg[k] = el.value === '' ? null : Number(el.value);
      else if (t === 'texto') cfg[k] = el.value.trim() || null;
      else if (t === 'selecao') cfg[k] = el.value === '' ? null : numericas.has(k) ? Number(el.value) : el.value;
      else if (t === 'multi') { cfg[k] = cfg[k] || []; if (el.checked) cfg[k].push(el.value); }
      else if (t === 'mapa') { cfg[k] = cfg[k] || {}; cfg[k][el.dataset.sub] = el.value; }
      else if (t === 'grupo') { cfg[k] = cfg[k] || {}; cfg[k][el.dataset.sub] = el.checked; }
    });
    (f.campos || []).filter((c) => c.tipo === 'multi_selecao').forEach((c) => { if (!(c.chave in cfg)) cfg[c.chave] = []; });

    if ((f.campos || []).some((c) => c.tipo === 'rd_funis')) {
      cfg.funis = [];
      form.querySelectorAll('[data-rd-funil-toggle]:checked').forEach((toggle) => {
        const pipelineId = toggle.value;
        const card = toggle.closest('.dc-rd-funil');
        const etapas = [...(card?.querySelectorAll('[data-rd-stage]:checked') || [])].map((x) => x.value);
        const mapeamento = {};
        (card?.querySelectorAll('[data-rd-map]') || []).forEach((sel) => { mapeamento[sel.dataset.sub] = sel.value; });
        cfg.funis.push({ pipelineId, etapas, mapeamento });
      });
      // Garante que a configuração nova substitua o formato antigo de um único funil.
      cfg.pipelineId = null;
      cfg.etapas = [];
    }
    return cfg;
  }

  function abaFuncoes(i) {
    const card = (f) => `<article class="dc-ip-fn ${f.situacao}">
      <header><strong>${esc(f.nome)}</strong>${chip(f.situacao)}${DC.chip(DIRECAO[f.direcao] || f.direcao, 'neutral')}</header>
      <p>${esc(f.descricao)}</p>
      ${f.motivo ? `<p class="dc-ip-motivo">${esc(f.motivo)}</p>` : ''}
      ${f.config ? `<div data-form="${esc(f.id)}"><div class="dc-muted" style="margin-top:8px">Carregando configuração…</div></div>` : ''}
    </article>`;
    if (i.id !== 'rd_station') return i.funcoes.map(card).join('');
    const principais = i.funcoes.filter((f) => f.config);
    const auxiliares = i.funcoes.filter((f) => !f.config);
    const principal = (f) => `<article class="dc-ip-fn dc-rd-primary-function ${f.situacao}">
      <header class="dc-rd-primary-head">
        <div class="dc-rd-primary-copy"><strong>${esc(f.nome)}</strong><p>${esc(f.descricao)}</p>${f.motivo ? `<small class="dc-ip-motivo">${esc(f.motivo)}</small>` : ''}</div>
        <div class="dc-rd-primary-badges">${chip(f.situacao)}${DC.chip(DIRECAO[f.direcao] || f.direcao, 'neutral')}</div>
      </header>
      ${f.config ? `<div data-form="${esc(f.id)}"><div class="dc-muted" style="margin-top:8px">Carregando configuração…</div></div>` : ''}
    </article>`;
    return `<div class="dc-rd-functions-shell">${principais.map(principal).join('')}</div>
      ${auxiliares.length ? `<details class="dc-rd-related">
        <summary><span><b>Recursos técnicos relacionados</b><small>Deduplicação, avanço da venda, webhook e limitações da API</small></span><span>${auxiliares.length} recursos</span></summary>
        <div class="dc-rd-related-grid">${auxiliares.map((f) => `<div class="dc-rd-related-row"><div><b>${esc(f.nome)}</b><small>${esc(f.descricao)}</small>${f.motivo ? `<small class="dc-ip-motivo">${esc(f.motivo)}</small>` : ''}</div><span>${chip(f.situacao)}${DC.chip(DIRECAO[f.direcao] || f.direcao, 'neutral')}</span></div>`).join('')}</div>
      </details>` : ''}`;
  }

  async function preencherFormularios(ov, i) {
    const precisa = i.funcoes.some((f) => (f.campos || []).some((c) => c.opcoesDe));
    const op = precisa ? await opcoesDe(i.id) : null;
    i.funcoes.filter((f) => f.config).forEach((f) => {
      const alvo = ov.querySelector(`[data-form="${CSS.escape(f.id)}"]`);
      if (alvo) alvo.innerHTML = formHtml(i, f, op);
    });
  }

  // ------------------------------------------------------------------ demais abas

  const abaDados = (i) => `<h3 class="dc-nc-h">Origem e destino por função</h3>
    <div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Função</th><th>Origem</th><th>Destino</th><th>Situação</th></tr></thead><tbody>${i.funcoes.map((f) => `<tr><td>${esc(f.nome)}</td><td>${esc(f.origem)}</td><td>${esc(f.destino)}</td><td>${chip(f.situacao)}</td></tr>`).join('')}</tbody></table></div>
    <h3 class="dc-nc-h">Mapeamento de campos</h3>${i.mapeamento.length ? `<div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Origem</th><th>Destino</th><th>Observação</th></tr></thead><tbody>${i.mapeamento.map((m) => `<tr><td class="dc-mono">${esc(m.origem)}</td><td class="dc-mono">${esc(m.destino)}</td><td>${esc(m.observacao || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dc-empty">Sem mapeamento de campos nesta integração.</div>'}`;

  const abaSync = (i) => `<div class="dc-ip-list">${i.sincronizacao.map((m) => `<div class="dc-ip-row"><b>${esc(MODO[m.modo] || m.modo)}</b><span>${esc(m.descricao)}${m.motivo ? `<small>${esc(m.motivo)}</small>` : ''}</span>${chip(m.situacao)}</div>`).join('') || '<div class="dc-empty">Sem modos de sincronização.</div>'}</div>`;

  const abaWebhooks = (i) => `<div class="dc-ip-list">${i.webhooks.map((w) => `<div class="dc-ip-row"><b>${w.direcao === 'entrada' ? 'Entrada' : 'Saída'}</b><span>${esc(w.descricao)}${w.caminho ? `<code>${esc(w.caminho)}</code>` : ''}${w.eventos.length ? `<small>Eventos: ${esc(w.eventos.join(', '))}</small>` : ''}<small>Autenticação: ${esc(w.autenticacao)}</small>${w.motivo ? `<small>${esc(w.motivo)}</small>` : ''}</span>${chip(w.situacao)}</div>`).join('') || '<div class="dc-empty">Esta integração não usa webhooks.</div>'}</div>`;

  const abaRegras = (i) => `<h3 class="dc-nc-h">Autenticação</h3><p class="dc-ov-p">${esc(i.autenticacao)}</p>
    ${i.limites.length ? `<h3 class="dc-nc-h">Limites</h3><ul class="dc-ip-ul">${i.limites.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${i.regras.length ? `<h3 class="dc-nc-h">Regras que não mudam</h3><ul class="dc-ip-ul">${i.regras.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <p class="dc-ov-p dc-muted">Documentação do provedor: <a href="${esc(i.documentacao)}" target="_blank" rel="noopener">${esc(i.documentacao)}</a></p>`;

  // CRM: importações, revisão e "Importar agora".
  const RESULTADO = { criada: ['Aguardando cadastro', 'ok'], atualizada: ['Snapshot atualizado', 'neutral'], duplicada: ['Duplicada', 'warn'], cliente_existente: ['Cliente já existe', 'warn'], ignorada: ['Ignorada', 'neutral'], erro: ['Erro', 'bad'], importada_apos_revisao: ['Importada após revisão', 'info'] };
  const itemHtml = (it) => `<div class="dc-ip-row"><b>${esc(it.dados?.nome || it.externalId)}</b><span>${esc([it.dados?.cpf, it.dados?.telefone, it.dados?.email].filter(Boolean).join(' · ') || 'Sem contato')}${it.motivo ? `<small>${esc(it.motivo)}</small>` : ''}${(it.correspondencias || []).map((c) => `<small>↳ ${c.tipo === 'cliente' ? 'Cliente' : 'Venda pendente'} ${esc(c.nome || c.id)} (mesmo ${esc(c.por.join(', '))})</small>`).join('')}</span>${DC.chip(...(RESULTADO[it.resultado] || [it.resultado, 'neutral']))}</div>`;

  async function abaCrm(alvo) {
    const [imps, rev] = await Promise.all([DC.api('/api/admin/integrations/rd-station/importacoes'), DC.api('/api/admin/integrations/rd-station/importacoes/revisao')]);
    if (!imps.ok) { alvo.innerHTML = `<div class="dc-warn-box">${esc(imps.error || 'Histórico indisponível.')}</div>`; return; }
    const lista = imps.data.importacoes || [], revisao = rev.ok ? rev.data.itens || [] : [];
    alvo.innerHTML = `<div class="dc-note">Toda cliente nova entra em <b>Aguardando cadastro</b>; a importação nunca cria cliente nem encaminha ao Financeiro. A venda só avança com parcelas cadastradas e acesso ao app liberado. Duplicidades (CPF, telefone, e-mail) não viram venda: são revisadas no Admin.</div>
      <div style="display:flex;justify-content:flex-end;margin:8px 0">${podeConfigurar() ? '<button class="dc-btn primary" data-importar>Importar agora</button>' : '<small class="dc-muted">Importar agora: owner/developer.</small>'}</div>
      ${!imps.data.disponivel ? '<div class="dc-warn-box">Estrutura de histórico ainda não aplicada no Sra Luck (migration_091).</div>' : ''}
      ${revisao.length ? `<h3 class="dc-nc-h">Aguardando revisão no Admin (${revisao.length})</h3><div class="dc-ip-list">${revisao.map(itemHtml).join('')}</div>` : ''}
      <h3 class="dc-nc-h">Histórico de importações</h3>
      <div class="dc-ip-list">${lista.map((i) => `<button type="button" class="dc-ip-row dc-ip-click" data-imp="${esc(i.id)}"><b>${esc(quando(i.iniciado_em))}</b><span>${esc(i.origem)} · ${i.totais?.totalRd ?? 0} lida(s) · ${i.totais?.criadas ?? 0} nova(s) · ${(i.totais?.duplicadas ?? 0) + (i.totais?.clienteExistente ?? 0)} duplicidade(s)${i.erro ? `<small>${esc(i.erro)}</small>` : ''}${i.filtro ? `<small class="dc-mono">${esc(i.filtro)}</small>` : ''}</span>${DC.chip(i.status, i.status === 'concluida' ? 'ok' : i.status === 'erro' ? 'bad' : 'warn')}</button><div data-itens="${esc(i.id)}" hidden></div>`).join('') || '<div class="dc-empty">Nenhuma importação registrada.</div>'}</div>`;
  }

  // Conta Azul: leitura da operação.
  const CONFLITO = { baixa_na_conta_azul: 'Baixa na Conta Azul', alterada_na_conta_azul: 'Alterada na Conta Azul', alterada_nos_dois_lados: 'Alterada nos dois lados', baixa_removida_na_conta_azul: 'Baixa removida na Conta Azul', estorno_de_baixa_externa: 'Estorno de baixa externa', recebido_parcial: 'Recebido parcial', ca_cancelado: 'Cancelada na Conta Azul', ca_renegociado: 'Renegociada na Conta Azul', ca_perdido: 'Perdida na Conta Azul', vinculo_divergente: 'Vínculo divergente', nao_localizado: 'Lançamento não localizado', marcador_duplicado: 'Marcador duplicado', parcela_sumiu: 'Excluída na Conta Azul' };
  async function abaContaAzul(alvo) {
    const [p, conf, fila, hist] = await Promise.all(['painel', 'conflitos', 'fila', 'historico'].map((r) => DC.api(`/api/admin/integrations/conta-azul/${r}`)));
    if (!p.ok) { alvo.innerHTML = `<div class="dc-warn-box">${esc(p.error || 'Painel da Conta Azul indisponível.')}</div>`; return; }
    const d = p.data, c = d.conexao || {}, v = d.vinculos || {}, fl = d.fila || {};
    const n = (x) => (x == null ? '—' : x);
    alvo.innerHTML = `<div class="dc-note">A operação financeira diária continua no Admin. Credenciais, OAuth e parâmetros de sincronização são configurados pelo Dev Console.</div>
      ${!d.estruturaAplicada ? '<div class="dc-warn-box" style="margin-top:8px">Estrutura de sincronização ainda não aplicada no Sra Luck (migration_091).</div>' : ''}
      <div class="dc-ip-kpis" style="margin-top:8px">
        <div><small>OAuth</small><b>${c.autorizada ? 'Conectada' : c.tokenManual ? 'Token manual' : c.clientConfigurado ? 'Aguardando' : 'Sem Client ID'}</b></div>
        <div><small>Vínculos seguros</small><b>${n(v.vinculado)}</b></div>
        <div><small>Conflitos abertos</small><b>${n(d.conflitosAbertos)}</b></div>
        <div><small>Fila pendente / erro</small><b>${n(fl.pendente)} / ${n(fl.erro)}</b></div>
      </div>
      <p class="dc-ov-p dc-muted">Última sincronização: ${d.ultimaSincronizacao ? `${esc(quando(d.ultimaSincronizacao.created_at))} · ${esc(d.ultimaSincronizacao.status)}${d.ultimaSincronizacao.erro ? ` — ${esc(d.ultimaSincronizacao.erro)}` : ''}` : 'nunca'} · leitura de alterações até ${esc(quando(d.cursorAlteracoes))} · token ${c.expiraEm ? `renova antes de ${esc(quando(c.expiraEm))}` : '—'}</p>
      <h3 class="dc-nc-h">Conflitos em revisão</h3><div class="dc-ip-list">${(conf.data?.itens || []).map((x) => `<div class="dc-ip-row"><b>${esc(CONFLITO[x.tipo] || x.tipo)}</b><span>${esc(x.descricao)}${x.dados_sra?.valor != null || x.dados_externos?.valorBruto != null ? `<small class="dc-mono">Sra Luck ${esc(x.dados_sra?.valor ?? '—')} · ${esc(x.dados_sra?.vencimento ?? '—')} · ${esc(x.dados_sra?.status ?? '—')} | Conta Azul ${esc(x.dados_externos?.valorBruto ?? '—')} · ${esc(x.dados_externos?.vencimento ?? '—')} · ${esc(x.dados_externos?.status ?? '—')}</small>` : ''}</span><small>${esc(quando(x.created_at))}</small></div>`).join('') || '<div class="dc-empty">Nenhum conflito aberto.</div>'}</div>
      <h3 class="dc-nc-h">Fila</h3><div class="dc-ip-list">${(fila.data?.itens || []).slice(0, 30).map((o) => `<div class="dc-ip-row"><b>${esc(String(o.operacao).replace(/_/g, ' '))}</b><span>${o.tentativas}/${o.max_tentativas} tentativa(s) · ${o.estado === 'pendente' ? `próxima ${esc(quando(o.proxima_tentativa_em))}` : esc(quando(o.concluida_em || o.created_at))}${o.ultimo_erro ? `<small>${esc(o.ultimo_erro)}</small>` : ''}</span>${DC.chip(o.estado, o.estado === 'concluida' ? 'ok' : o.estado === 'erro' ? 'bad' : o.estado === 'pendente' ? 'warn' : 'neutral')}</div>`).join('') || '<div class="dc-empty">Fila vazia.</div>'}</div>
      <h3 class="dc-nc-h">Execuções</h3><div class="dc-ip-list">${(hist.data?.itens || []).slice(0, 20).map((e) => `<div class="dc-ip-row"><b>${esc(String(e.event_type).replace(/_/g, ' '))}</b><span>${esc(quando(e.created_at))}${e.erro ? `<small>${esc(e.erro)}</small>` : e.payload?.leitura ? `<small>${e.payload.leitura.eventos} evento(s) · ${e.payload.leitura.baixasAplicadas} baixa(s) aplicada(s) · ${e.payload.leitura.conflitos} conflito(s) · ${e.payload.envio?.enfileiradas ?? 0} envio(s)</small>` : ''}</span>${DC.chip(e.status, e.status === 'processado' ? 'ok' : e.status === 'erro' ? 'bad' : 'warn')}</div>`).join('') || '<div class="dc-empty">Nenhuma execução registrada.</div>'}</div>`;
  }

  async function abaRdOperacao(alvo) {
    const [imps, hist] = await Promise.all([
      DC.api('/api/admin/integrations/rd-station/importacoes'),
      DC.api('/api/admin/integrations/historico'),
    ]);
    const status = (I.status?.integracoes || []).find((x) => x.id === 'rd_station') || {};
    const cred = (I.creds?.provedores || []).find((x) => x.id === 'rd_station') || {};
    const campos = cred.campos || [];
    const configurada = (chave) => campos.find((x) => x.chave === chave)?.origem !== 'nao_configurado';
    const oauth = configurada('access_token') && configurada('refresh_token');
    const basePronta = Boolean(imps.ok && imps.data?.disponivel !== false && status.estado !== 'base_incompleta' && status.estadoValidacao !== 'base_incompleta');
    const validada = status.conexaoLiveVerificada === true;
    const ativa = status.ativo === true && validada && basePronta;
    const lista = imps.ok ? (imps.data?.importacoes || []) : [];
    const concluidas = lista.filter((x) => x.status === 'concluida').length;
    const falhas = lista.filter((x) => x.status === 'erro').length;
    const parciais = lista.filter((x) => x.status === 'parcial' || x.status === 'parcialmente_concluida').length;
    const totais = lista.reduce((acc, x) => {
      acc.lidas += Number(x.totais?.totalRd || 0);
      acc.criadas += Number(x.totais?.criadas || 0);
      acc.duplicadas += Number(x.totais?.duplicadas || 0) + Number(x.totais?.clienteExistente || 0);
      return acc;
    }, { lidas: 0, criadas: 0, duplicadas: 0 });
    const ultima = lista[0] || null;
    const eventos = (hist.ok ? (hist.data?.eventos || []) : [])
      .filter((e) => e.entidade_id === 'rd_station' || e.detalhes?.provedor === 'rd_station')
      .slice(0, 30);
    const gate = [
      ['Credenciais OAuth', (cred.campos || []).filter((x) => x.obrigatorio).every((x) => x.origem !== 'nao_configurado'), 'Client ID, Client Secret, Redirect URI e segredo do webhook'],
      ['Conta autorizada', oauth, 'Access Token e Refresh Token presentes no cofre'],
      ['Persistência', basePronta, 'estrutura de importações disponível no backend'],
      ['Teste real', validada, 'último teste autenticado aprovado'],
    ];
    alvo.innerHTML = `
      <div class="dc-note"><b>RD Station CRM v2.</b> O Dev Console usa somente capacidades que o backend do Sra Luck já implementa. A API do RD possui operações de escrita, mas o projeto mantém o RD em <b>somente leitura</b>; por isso nenhuma ação de criar/alterar negócio ou contato é exposta aqui.</div>
      <h3 class="dc-nc-h">Pré-requisitos de ativação</h3>
      <div class="dc-ip-list">${gate.map(([nome, ok, detalhe]) => `<div class="dc-ip-row"><b>${esc(nome)}</b><span>${esc(detalhe)}</span>${DC.chip(ok ? 'OK' : 'Pendente', ok ? 'ok' : 'warn')}</div>`).join('')}</div>
      ${ativa ? '' : '<div class="dc-warn-box" style="margin-top:8px">A automação permanece bloqueada enquanto houver pré-requisito pendente. O botão de ativação executa uma validação real no provedor; falha de autenticação mantém a integração desligada.</div>'}
      <h3 class="dc-nc-h">Monitoramento operacional</h3>
      <div class="dc-ip-kpis">
        <div><small>Última sincronização</small><b>${ultima?.iniciado_em ? esc(quando(ultima.iniciado_em)) : 'nunca'}</b></div>
        <div><small>Latência do último teste</small><b>${status.latenciaMs != null ? esc(status.latenciaMs + ' ms') : '—'}</b></div>
        <div><small>Concluídas</small><b>${concluidas}</b></div>
        <div><small>Falhas / parciais</small><b>${falhas} / ${parciais}</b></div>
      </div>
      <div class="dc-ip-kpis" style="margin-top:8px">
        <div><small>Negociações lidas</small><b>${totais.lidas}</b></div>
        <div><small>Novas</small><b>${totais.criadas}</b></div>
        <div><small>Duplicidades</small><b>${totais.duplicadas}</b></div>
        <div><small>Retentativas</small><b>Não há fila</b></div>
      </div>
      <p class="dc-ov-p dc-muted">O backend atual do RD não possui fila genérica de retries. Cada importação é uma execução independente; falhas ficam registradas no histórico para novo disparo manual ou pela próxima execução agendada.</p>
      <h3 class="dc-nc-h">Logs recentes</h3>
      <div class="dc-ip-list">${eventos.map((e) => `<div class="dc-ip-row"><b>${esc(String(e.acao || e.event_type || 'evento').replace(/_/g, ' '))}</b><span>${esc(e.detalhes?.detalhe || e.detalhes?.erro || e.erro || '')}</span><small>${esc(quando(e.created_at))}</small></div>`).join('') || '<div class="dc-empty">Sem eventos recentes do RD Station.</div>'}</div>`;
  }

  const EXTRAS = { rd_station: [['operacao', 'Monitoramento', abaRdOperacao], ['importacoes', 'Importações', abaCrm]], conta_azul: [['operacao', 'Operação', abaContaAzul]] };

  // ------------------------------------------------------------------ drawer

  /** Drawer do padrão. partes: { topo, credenciais, eventos, extras, rodape } em HTML já montado pela página. */
  function abrir(id, partes, aoSalvar) {
    const i = integracao(id);
    if (!i) return false;
    const disp = i.funcoes.filter((f) => f.situacao === 'disponivel').length;
    const extras = EXTRAS[id] || [];
    const abas = [
      ['visao', 'Visão', `${partes.topo}${partes.extras || ''}<h3 class="dc-nc-h">Credenciais</h3>${partes.credenciais}<div class="dc-note" style="margin-top:6px">Segredos ficam no cofre cifrado do Sra Luck. O Dev Console grava novos valores, mas nunca recebe o segredo atual em texto puro.</div>
        <h3 class="dc-nc-h">Resumo</h3><p class="dc-ov-p">${disp} de ${i.funcoes.length} funções disponíveis · ${i.funcoes.filter((f) => f.situacao === 'api_permite').length} que a API permite e ainda não foram feitas · ${i.funcoes.filter((f) => f.situacao === 'api_nao_permite').length} que a API não permite.</p>`],
      ['funcoes', `Funções (${i.funcoes.length})`, abaFuncoes(i)],
      ...extras.map(([k, l]) => [k, l, `<div data-extra="${k}"><div class="dc-muted">Carregando…</div></div>`]),
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
    const carregados = new Set();
    const carregarExtra = (k) => {
      const ex = extras.find(([x]) => x === k), alvo = ov.querySelector(`[data-extra="${k}"]`);
      if (!ex || !alvo || carregados.has(k)) return;
      carregados.add(k);
      ex[2](alvo).catch(() => { alvo.innerHTML = '<div class="dc-warn-box">Falha ao carregar.</div>'; });
    };
    carregarExtra(ativa);
    void preencherFormularios(ov, i);
    ov.addEventListener('change', (e) => {
      const toggle = e.target.closest?.('[data-rd-funil-toggle]');
      if (!toggle) return;
      const card = toggle.closest('.dc-rd-funil');
      const corpo = card?.querySelector('[data-rd-funil-body]');
      const abrir = card?.querySelector('[data-rd-funil-open]');
      card?.classList.toggle('active', toggle.checked);
      if (abrir) abrir.disabled = !toggle.checked;
      if (!toggle.checked && corpo) {
        corpo.hidden = true;
        if (abrir) { abrir.setAttribute('aria-expanded', 'false'); abrir.textContent = 'Configurar'; }
      }
    });
    ov.addEventListener('click', async (e) => {
      const abrirFunil = e.target.closest?.('[data-rd-funil-open]');
      if (abrirFunil) {
        const card = abrirFunil.closest('.dc-rd-funil');
        const corpo = card?.querySelector('[data-rd-funil-body]');
        if (!corpo) return;
        const vaiAbrir = corpo.hidden;
        corpo.hidden = !vaiAbrir;
        abrirFunil.setAttribute('aria-expanded', vaiAbrir ? 'true' : 'false');
        abrirFunil.textContent = vaiAbrir ? 'Fechar' : 'Configurar';
        return;
      }
      const b = e.target.closest('[data-aba]');
      if (b) {
        S.aba = { id, aba: b.dataset.aba };
        ov.querySelectorAll('[data-aba]').forEach((x) => x.classList.toggle('active', x === b));
        ov.querySelectorAll('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== b.dataset.aba; });
        carregarExtra(b.dataset.aba);
        return;
      }
      const imp = e.target.closest('[data-imp]');
      if (imp) {
        const alvo = ov.querySelector(`[data-itens="${CSS.escape(imp.dataset.imp)}"]`);
        if (!alvo) return;
        alvo.hidden = !alvo.hidden;
        if (!alvo.hidden && !alvo.dataset.ok) {
          alvo.innerHTML = '<div class="dc-muted">Carregando…</div>';
          const r = await DC.api(`/api/admin/integrations/rd-station/importacoes/${encodeURIComponent(imp.dataset.imp)}/itens`);
          alvo.dataset.ok = '1';
          alvo.innerHTML = r.ok ? `<div class="dc-ip-list" style="margin:4px 0 8px 12px">${(r.data.itens || []).map(itemHtml).join('') || '<div class="dc-empty">Sem itens (negociações só atualizadas não aparecem).</div>'}</div>` : `<div class="dc-warn-box">${esc(r.error || 'Falha.')}</div>`;
        }
        return;
      }
      const botao = e.target.closest('[data-importar]');
      if (botao) {
        if (!await DC.modal('Importar do RD Station', '<div class="dc-note">Lê o RD (somente leitura) com o funil, as etapas e o mapeamento configurados. Clientes novas entram em Aguardando cadastro; duplicidades vão para revisão no Admin.</div>', { confirmText: 'Importar agora' })) return;
        const r = await DC.action(botao, () => DC.api('/api/admin/integrations/rd-station/importar', { method: 'POST', body: {}, timeout: 60000 }));
        if (r?.ok) DC.toast(`RD: ${r.data.totalRd ?? 0} lida(s) · ${r.data.criadas ?? 0} nova(s) · ${(r.data.duplicadas ?? 0) + (r.data.clienteExistente ?? 0)} para revisar.`);
        carregados.delete('importacoes'); carregarExtra('importacoes');
      }
    });
    ov.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-cfg]'); if (!form) return;
      e.preventDefault();
      const f = i.funcoes.find((x) => x.id === form.dataset.cfg);
      const config = lerFormulario(form, f);
      const btn = form.querySelector('[type="submit"]');
      const r = await DC.action(btn, () => DC.api('/api/admin/integrations/config', { method: 'POST', body: { provedor: id, funcao: form.dataset.cfg, config, versao: Number(form.dataset.versao) } }), { success: 'Função salva. Vale a partir da próxima execução (até 30 s de cache).' });
      if (r?.ok) { await carregar(); aoSalvar?.(id); }
    });
    ov.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset?.c === 'pipelineId') {
        // Etapas dependem do funil escolhido.
        const form = t.closest('[data-cfg]'), f = i.funcoes.find((x) => x.id === form?.dataset.cfg);
        const campo = (f?.campos || []).find((c) => c.tipo === 'multi_selecao' && c.opcoesDe === 'rd_etapas');
        const alvo = form?.querySelector(`[data-multi="${CSS.escape(campo?.chave || '')}"]`);
        if (campo && alvo) alvo.outerHTML = campoHtml(f, campo, { ...(f.config || {}), pipelineId: t.value || null, [campo.chave]: [] }, S.opcoes[id], '');
      }
    });
    return true;
  }

  window.DCIntegracoes = { carregar, integracao, abrir, erro: () => S.erro, catalogo: () => S.catalogo };
})();
