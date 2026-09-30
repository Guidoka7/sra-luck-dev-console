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
  const STATUS_RD = { won: 'ganhas', ongoing: 'em andamento', lost: 'perdidas', paused: 'pausadas' };
  const n = (v) => Number(v || 0).toLocaleString('pt-BR');
  /** Contagem exata do funil (varredura do Sra Luck): status, etapas, responsáveis e meses. */
  const contagemDe = (op, funilId) => op?.contagens?.porFunil?.[funilId] || null;
  const statusTexto = (c) => c ? Object.entries(STATUS_RD).filter(([k]) => c.status?.[k]).map(([k, rotulo]) => `${n(c.status[k])} ${rotulo}`).join(' · ') : '';
  const detalheContagemHtml = (c, atualizadoEm) => {
    if (!c) return '';
    const linhas = (lista, max) => lista.slice(0, max).map((x) => `<li><span>${esc(x.nome ?? x.mes)}</span><b>${n(x.negociacoes)}</b></li>`).join('');
    return `<details class="dc-rd-contagem"><summary>Negociações deste funil no RD: ${n(c.total)}${statusTexto(c) ? ` · ${esc(statusTexto(c))}` : ''}</summary>
      <div class="dc-rd-contagem-grid">
        <div><b>Por responsável</b><ul>${linhas(c.responsaveis || [], 30)}</ul></div>
        <div><b>Por mês de criação</b><ul>${linhas((c.meses || []).slice().reverse(), 36)}</ul></div>
      </div>
      <small class="dc-muted">Contagem exata de todas as negociações do funil${atualizadoEm ? `, feita ${esc(DC.relTime(atualizadoEm))}` : ''}.</small>
    </details>`;
  };
  /** Quantas negociações o funil tem no RD (catálogo; acima de 10 mil o RD só permite estimar). */
  const totalNoRd = (funil) => {
    const t = funil?.total;
    if (!t || t.negociacoes == null) return '';
    return `${t.exato ? '' : '≈ '}${Number(t.negociacoes).toLocaleString('pt-BR')} negociação(ões) no RD · `;
  };
  /** Importação do RD em etapas: quanto da passada atual já foi lido. */
  const textoPassada = (p) => {
    if (!p) return '';
    const lidas = Number(p.lidas || 0);
    const total = typeof p.total === 'number' && p.total > 0 ? p.total : null;
    const de = total ? ` de ${total.toLocaleString('pt-BR')} (${Math.min(100, Math.floor((lidas / total) * 100))}%)` : '';
    return p.concluida ? ` · leitura completa do RD (${lidas.toLocaleString('pt-BR')} negociações)` : ` · passada em andamento: ${lidas.toLocaleString('pt-BR')}${de} negociações lidas até agora, continua sozinha a cada 5 min`;
  };

  // ------------------------------------------------------------------ formulário genérico

  // O catálogo do RD vem pré-calculado; só a primeira montagem (sem catálogo guardado) lê o RD.
  const OPCOES_TIMEOUT = 45000;
  const carregandoOpcoes = {};

  async function opcoesDe(provedor) {
    if (!OPCOES_URL[provedor]) return null;
    if (S.opcoes[provedor] && !S.opcoes[provedor].erro) return S.opcoes[provedor];
    // Reaproveita a leitura em andamento: "Tentar novamente" não dispara uma segunda varredura no RD.
    if (!carregandoOpcoes[provedor]) {
      carregandoOpcoes[provedor] = DC.api(OPCOES_URL[provedor], { timeout: OPCOES_TIMEOUT })
        .then((r) => { S.opcoes[provedor] = r.ok ? r.data : { erro: r.error || 'Lista do provedor indisponível.' }; return S.opcoes[provedor]; })
        .finally(() => { delete carregandoOpcoes[provedor]; });
    }
    return carregandoOpcoes[provedor];
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

  const GRUPOS_FONTE = [
    ['deal_nativo', 'Negociação · campos do RD'], ['deal_personalizado', 'Negociação · campos personalizados'],
    ['contact_nativo', 'Contato · campos do RD'], ['contact_personalizado', 'Contato · campos personalizados'],
  ];
  const semPrefixo = (r) => String(r || '').replace(/^(Negociação|Contato):\s*/, '');

  // Origem de um dado do Sra Luck neste funil: só origens reais do próprio funil ou "Não importar".
  // Nada genérico: o "Automático" antigo vira a sugestão concreta do catálogo ou "Não importar" (a definir).
  function origemSelectHtml(funil, atual, sugestao, dis, attrs) {
    const fontes = (funil.fontes || []).filter((f) => f.mapeavel !== false);
    const valor = atual && atual !== 'auto' ? atual : (sugestao || 'ignorar');
    const amostra = (f) => {
      const total = f.grupo.startsWith('deal') ? funil.amostra?.negociacoes : funil.amostra?.contatos;
      return total ? ` · ${f.preenchidas}/${total}` : '';
    };
    const extras = valor !== 'ignorar' && !fontes.some((f) => f.fonte === valor) ? `<option value="${esc(valor)}" selected>Salvo anteriormente: ${esc(valor)} · não encontrado neste funil</option>` : '';
    const grupos = GRUPOS_FONTE.map(([g, rot]) => {
      const itens = fontes.filter((f) => f.grupo === g);
      return itens.length ? `<optgroup label="${esc(rot)}">${itens.map((f) => `<option value="${esc(f.fonte)}"${f.fonte === valor ? ' selected' : ''}>${esc(semPrefixo(f.rotulo))}${f.fonte === sugestao ? ' · sugerido' : ''}${amostra(f)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    return `<select ${attrs}${dis}>${extras}<option value="ignorar"${valor === 'ignorar' ? ' selected' : ''}>Não importar</option>${grupos}</select>`;
  }

  function filtrosHtml(funil, cfg, dis) {
    const filtros = funil.filtros || [];
    if (!filtros.length) return '';
    const salvos = new Map((cfg?.filtros || []).map((x) => [x.fonte, x.valores || []]));
    return `<section class="dc-rd-subsection" data-rd-filtros>
      <div class="dc-rd-subhead"><b>Filtros</b><small>Importa só as negociações com os valores marcados. Nada marcado = todas.</small></div>
      <div class="dc-rd-filtros">${filtros.map((filtro) => {
        const marcados = salvos.get(filtro.fonte) || [];
        const conhecidos = new Set(filtro.valores.map((v) => v.valor));
        const valores = [...filtro.valores, ...marcados.filter((v) => !conhecidos.has(v)).map((v) => ({ valor: v, rotulo: `${v} · não encontrado no RD`, negociacoes: 0 }))];
        return `<details class="dc-rd-filtro" data-rd-filtro-grupo="${esc(filtro.fonte)}"${marcados.length ? ' open' : ''}>
          <summary><span><b>${esc(filtro.rotulo)}</b><small data-rd-filtro-resumo>${marcados.length ? `${marcados.length} selecionado(s)` : 'Todas'}</small></span><span>${valores.length} opção(ões)</span></summary>
          <div class="dc-rd-filtro-body">
            ${valores.length > 8 ? '<input type="search" data-rd-filtro-busca placeholder="Procurar…" aria-label="Procurar valor">' : ''}
            <div class="dc-rd-filtro-valores">${valores.map((v) => `<label data-busca="${esc(String(v.rotulo).toLowerCase())}"><input type="checkbox" data-rd-filtro data-fonte="${esc(filtro.fonte)}" value="${esc(v.valor)}"${marcados.includes(v.valor) ? ' checked' : ''}${dis}/><span>${esc(v.rotulo)}</span>${v.negociacoes ? `<small title="Negociações na amostra">${v.negociacoes}</small>` : ''}</label>`).join('')}</div>
          </div>
        </details>`;
      }).join('')}</div>
    </section>`;
  }

  function catalogoHtml(op) {
    const c = op?.catalogo;
    if (!c) return '';
    const estado = c.erro ? `<span class="dc-rd-catalogo-erro">Última atualização falhou (${esc(c.erro)}); mostrando a anterior.</span>` : c.vencido ? '<span class="dc-rd-catalogo-erro">Desatualizado.</span>' : '';
    return `<div class="dc-rd-catalogo" data-rd-catalogo>
      <span><b>Catálogo do RD</b> · atualizado ${esc(c.atualizadoEm ? DC.relTime(c.atualizadoEm) : '—')} · ${(op.funis || []).length} funil(is) · campos e valores das 100 negociações mais recentes de cada funil ${estado}</span>
      <button type="button" class="dc-btn" data-rd-atualizar-catalogo>Atualizar do RD</button>
    </div>`;
  }

  function rdFunisHtml(campo, valores, op, dis) {
    const configurados = Array.isArray(valores.funis) ? valores.funis : [];
    const mapaPadrao = valores.mapeamento || {};
    const fontes = [{ valor: 'auto', rotulo: 'Automático' }, { valor: 'ignorar', rotulo: 'Não importar' }, ...(op?.campos || []).map((c) => ({ valor: `${c.entidade}:${c.slug}`, rotulo: `${c.entidade === 'deal' ? 'Negociação' : 'Contato'}: ${c.nome}` }))];
    const funis = op?.funis || [];
    if (op?.erro) return '<div class="dc-ip-full"><small class="dc-muted">Os funis aparecem quando as listas do RD Station carregarem. A seleção salva não foi alterada.</small></div>';
    if (!funis.length) return `<div class="dc-ip-full">${catalogoHtml(op)}<div class="dc-warn-box">Nenhum funil foi retornado pelo RD Station.</div></div>`;
    // Backend novo: filtros por valor e origem explícita de cada dado, por funil.
    const explicito = Boolean(campo.filtrosPorFunil);

    const mapaAlterado = (mapa) => (campo.itens || []).filter((it) => {
      const atual = mapa?.[it.chave] ?? 'auto';
      const padrao = mapaPadrao?.[it.chave] ?? 'auto';
      return atual !== padrao;
    }).length;

    const preenchimentoHtml = (funil, mapa) => {
      if (!explicito || !funil.fontes) {
        const alterados = mapaAlterado(mapa);
        return `<details class="dc-rd-subsection dc-rd-map-details">
            <summary><span><b>Preenchimento dos dados</b><small>${alterados ? `${alterados} diferente(s) do padrão` : 'Usando o preenchimento padrão'}</small></span><span>Editar campos</span></summary>
            <div class="dc-rd-map-grid">
              ${(campo.itens || []).map((it) => `<label><span>${esc(it.rotulo)}</span><select data-rd-map data-pipeline="${esc(funil.id)}" data-sub="${esc(it.chave)}"${dis}>${opcoesHtml(fontes, mapa?.[it.chave] ?? 'auto', false)}</select></label>`).join('')}
            </div>
          </details>`;
      }
      const sugeridos = (campo.itens || []).filter((it) => (mapa?.[it.chave] ?? 'auto') === 'auto' && funil.sugestoes?.[it.chave]).length;
      return `<section class="dc-rd-subsection" data-rd-preenchimento>
          <div class="dc-rd-subhead"><b>Preenchimento dos dados</b><small>De onde vem cada dado da venda neste funil.${sugeridos ? ` ${sugeridos} origem(ns) sugerida(s) pelo catálogo: revise e salve.` : ''}</small></div>
          <div class="dc-rd-map-grid">
            ${(campo.itens || []).map((it) => {
              const salvo = mapa?.[it.chave] ?? 'auto';
              const sugestao = funil.sugestoes?.[it.chave] || '';
              const marca = salvo === 'auto' ? (sugestao ? '<em class="dc-rd-tag">sugerido</em>' : '<em class="dc-rd-tag warn">definir</em>') : '';
              return `<label><span>${esc(it.rotulo)} ${marca}</span>${origemSelectHtml(funil, salvo, sugestao, dis, `data-rd-map data-rd-map-explicito data-pipeline="${esc(funil.id)}" data-sub="${esc(it.chave)}"`)}</label>`;
            }).join('')}
          </div>
        </section>`;
    };

    const funilHtml = (funil) => {
      const cfg = configurados.find((x) => x.pipelineId === funil.id) || null;
      const marcado = Boolean(cfg);
      const etapasMarcadas = Array.isArray(cfg?.etapas) ? cfg.etapas : [];
      const mapa = cfg?.mapeamento || mapaPadrao;
      const totalEtapas = (funil.etapas || []).length;
      const resumoEtapas = etapasMarcadas.length ? `${etapasMarcadas.length}/${totalEtapas} etapas` : `Todas as ${totalEtapas} etapas`;
      const nFiltros = (cfg?.filtros || []).filter((x) => x.valores?.length).length;
      const definidos = (campo.itens || []).filter((it) => (mapa?.[it.chave] ?? 'auto') !== 'auto').length;
      const sugeridos = (campo.itens || []).filter((it) => (mapa?.[it.chave] ?? 'auto') === 'auto' && funil.sugestoes?.[it.chave]).length;
      const resumo = explicito
        ? `${resumoEtapas} · ${nFiltros ? `${nFiltros} filtro(s)` : 'sem filtros'} · ${definidos}/${(campo.itens || []).length} dados com origem salva${sugeridos ? ` · ${sugeridos} sugerida(s) a revisar` : ''}`
        : `${resumoEtapas} · ${mapaAlterado(mapa) ? `${mapaAlterado(mapa)} campo(s) personalizado(s)` : 'preenchimento padrão'}`;
      const amostra = funil.amostra ? `<div class="dc-note dc-rd-amostra">Baseado nas ${funil.amostra.negociacoes} negociação(ões) mais recentes deste funil${funil.amostra.contatos ? ` e em ${funil.amostra.contatos} contato(s) ligados a elas` : ''}.${funil.amostra.contatosIndisponiveis ? ' Os contatos não puderam ser lidos agora; campos de contato podem faltar.' : ''}</div>` : '';
      return `<div class="dc-rd-funil${marcado ? ' active' : ''}">
        <div class="dc-rd-funil-row">
          <label class="dc-rd-funil-main">
            <input type="checkbox" data-rd-funil-toggle value="${esc(funil.id)}"${marcado ? ' checked' : ''}${dis}/>
            <span><b>${esc(funil.nome)}</b><small>${totalNoRd(funil)}${contagemDe(op, funil.id) ? `${esc(statusTexto(contagemDe(op, funil.id)))} · ` : ''}${op?.origens?.porFunil?.[funil.id] ? `fonte e campanha: ${n(op.origens.porFunil[funil.id].porSituacao?.encontrada)}/${n(op.origens.porFunil[funil.id].clientes)} clientes · ` : ''}${marcado ? resumo : `${totalEtapas} etapa(s)`}</small></span>
          </label>
          <button type="button" class="dc-rd-config-btn" data-rd-funil-open="${esc(funil.id)}" aria-expanded="false"${marcado ? '' : ' disabled'}>Configurar</button>
        </div>
        <div class="dc-rd-funil-body" data-rd-funil-body="${esc(funil.id)}" hidden>
          ${detalheContagemHtml(contagemDe(op, funil.id), op?.contagens?.atualizadoEm)}
          ${amostra}
          <section class="dc-rd-subsection">
            <div class="dc-rd-subhead"><b>Etapas</b><small>Nenhuma marcada = todas.</small></div>
            <div class="dc-ip-checks dc-rd-stage-grid">
              ${(funil.etapas || []).map((etapa) => { const qtd = contagemDe(op, funil.id)?.etapas?.find((x) => x.chave === etapa.id)?.negociacoes; return `<label><input type="checkbox" data-rd-stage data-pipeline="${esc(funil.id)}" value="${esc(etapa.id)}"${etapasMarcadas.includes(etapa.id) ? ' checked' : ''}${dis}/><span>${esc(etapa.nome)}${contagemDe(op, funil.id) ? ` <small class="dc-muted">(${n(qtd)})</small>` : ''}</span></label>`; }).join('') || '<small class="dc-muted">Este funil não retornou etapas.</small>'}
            </div>
          </section>
          ${explicito ? filtrosHtml(funil, cfg, dis) : ''}
          ${preenchimentoHtml(funil, mapa)}
          ${campo.camposLivres ? DCCrmCampos.render(cfg?.camposSelecionados || [], op, dis) : '<p class="dc-muted">A seleção livre de campos estará disponível após atualizar o backend do App.</p>'}
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
      : `<div class="dc-rd-fallback-note"><b>Todos os funis</b><span>Nenhum funil específico foi marcado: a importação lê todos com a leitura automática. ${explicito ? 'Marque os funis para escolher filtros e a origem de cada dado.' : ''}</span></div>`;

    const seletorRestantes = restantes.length
      ? `<details class="dc-rd-more-funnels">
          <summary><span><b>${selecionados.length ? 'Adicionar outros funis' : 'Escolher funis específicos'}</b><small>${selecionados.length ? 'Os demais ficam fora da seleção atual.' : 'Ao selecionar, a importação passa a usar somente os funis marcados.'}</small></span><span>${restantes.length} disponível(is)</span></summary>
          <div class="dc-rd-funnel-list">${restantes.map(funilHtml).join('')}</div>
        </details>`
      : '';

    return `<div class="dc-ip-full dc-rd-funnels">
      ${catalogoHtml(op)}
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
        if (f.id === 'importacao' && campo.chave === 'deduplicarPor') return `<div class="dc-ip-full dc-rd-dedupe"><span><b>${esc(rot)}</b><small>${esc(ajuda || 'Evita criar a mesma cliente novamente.')}</small></span><div class="dc-ip-checks">${(campo.itens || []).map((it) => `<label><input type="checkbox" data-c="${esc(campo.chave)}" data-sub="${esc(it.chave)}" data-t="grupo"${v?.[it.chave] !== false ? ' checked' : ''}${dis}/>${esc(it.rotulo)}</label>`).join('')}</div></div>`;
        return `<div class="dc-ip-full"><span>${esc(rot)}</span><div class="dc-ip-checks">${(campo.itens || []).map((it) => `<label><input type="checkbox" data-c="${esc(campo.chave)}" data-sub="${esc(it.chave)}" data-t="grupo"${v?.[it.chave] !== false ? ' checked' : ''}${dis}/>${esc(it.rotulo)}</label>`).join('')}</div>${aj}</div>`;
      case 'rd_funis': return rdFunisHtml(campo, valores, op, dis);
      default: return '';
    }
  }

  function formHtml(i, f, op) {
    const bloqueado = Boolean(op?.erro);
    const editavelAqui = Boolean(f.config), pode = editavelAqui && podeConfigurar() && !bloqueado, dis = pode ? '' : ' disabled';
    const c = f.config || {}, campos = f.campos || [];
    const uso = campos.some((x) => x.chave === 'limiteDiario') ? (c.limiteDiario ? `${f.usoHoje}/${c.limiteDiario} chamadas hoje` : `${f.usoHoje} chamada(s) hoje · sem limite`) : '';
    const rodape = !editavelAqui ? '<small class="dc-muted">Esta função não possui parâmetros configuráveis.</small>'
      : bloqueado ? '<small class="dc-muted">Carregue as opções antes de salvar. A configuração existente foi preservada.</small>' : pode ? '<button class="dc-btn primary" type="submit">Salvar função</button>' : '<small class="dc-muted">Seu acesso não permite alterar.</small>';
    const rdImport = i.id === 'rd_station' && f.id === 'importacao';

    if (rdImport) {
      const principais = campos.filter((campo) => !['mapeamento', 'rd_funis', 'grupo_booleano'].includes(campo.tipo));
      const padrao = campos.filter((campo) => campo.tipo === 'mapeamento');
      const funis = campos.filter((campo) => campo.tipo === 'rd_funis');
      const dedupe = campos.filter((campo) => campo.tipo === 'grupo_booleano');
      return `<form class="dc-ip-form dc-rd-import-form" data-cfg="${esc(f.id)}" data-versao="${f.versao}">
        ${op?.erro ? `<div class="dc-warn-box">Listas do provedor indisponíveis: ${esc(op.erro)} <button type="button" class="dc-btn" data-recarregar-opcoes>Tentar novamente</button></div>` : ''}
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
      ${op?.erro ? `<div class="dc-warn-box">Listas do provedor indisponíveis: ${esc(op.erro)} <button type="button" class="dc-btn" data-recarregar-opcoes>Tentar novamente</button></div>` : ''}
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
        const funil = { pipelineId, etapas, mapeamento };
        if ((f.campos || []).some((c) => c.tipo === 'rd_funis' && c.camposLivres)) funil.camposSelecionados = DCCrmCampos.ler(card);
        if ((f.campos || []).some((c) => c.tipo === 'rd_funis' && c.filtrosPorFunil)) {
          const porFonte = new Map();
          (card?.querySelectorAll('[data-rd-filtro]:checked') || []).forEach((x) => { porFonte.set(x.dataset.fonte, [...(porFonte.get(x.dataset.fonte) || []), x.value]); });
          funil.filtros = [...porFonte].map(([fonte, valores]) => ({ fonte, valores }));
        }
        cfg.funis.push(funil);
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

  // Fonte e campanha das vendas do RD: achadas, só o canal registrado, sem registro, e a busca em outros cadastros.
  function coberturaOrigensHtml(c) {
    if (!c) return '';
    const s = c.porSituacao || {}, r = c.ultimaRodada || null;
    const sem = (s.sem_registro_no_rd || 0) + (s.sem_contato || 0);
    return `<h3 class="dc-nc-h">Origem das clientes (fonte e campanha)</h3>
      <div class="dc-ip-kpis">
        <div><small>Fonte e campanha no RD</small><b>${s.encontrada || 0} / ${c.total || 0}</b></div>
        <div><small>Só o canal registrado</small><b>${s.parcial || 0}</b></div>
        <div><small>Sem registro no RD</small><b>${sem}</b></div>
        <div><small>Busca em outros cadastros</small><b>${c.buscaAmpliadaFeita || 0} feitas · ${c.buscaAmpliadaPendente || 0} na fila</b></div>
      </div>
      <p class="dc-ov-p dc-muted">Sem registro, o Admin mostra o que o RD tem (ex.: “Orgânico — sem campanha paga”, “Não registrada no RD”), nunca um dado inventado.${c.colunasEmBranco ? ` ${c.colunasEmBranco} venda(s) ainda com a coluna em branco (preenchidas na próxima passada).` : ''}${r?.em ? ` Última rodada da busca por e-mail/telefone: ${esc(quando(r.em))} · ${r.analisadas || 0} analisada(s) · ${r.comOutrosContatos || 0} com outro cadastro · ${r.melhoradas || 0} completada(s).` : ''}${r?.erro ? ` ${esc(r.erro)}` : ''}</p>`;
  }

  async function abaCrm(alvo) {
    const [imps, rev] = await Promise.all([DC.api('/api/admin/integrations/rd-station/importacoes'), DC.api('/api/admin/integrations/rd-station/importacoes/revisao')]);
    if (!imps.ok) { alvo.innerHTML = `<div class="dc-warn-box">${esc(imps.error || 'Histórico indisponível.')}</div>`; return; }
    const lista = imps.data.importacoes || [], revisao = rev.ok ? rev.data.itens || [] : [];
    alvo.innerHTML = `<div class="dc-note">Toda cliente nova entra em <b>Aguardando cadastro</b>; a importação nunca cria cliente nem encaminha ao Financeiro. A venda só avança com parcelas cadastradas e acesso ao app liberado. Duplicidades (CPF, telefone, e-mail) não viram venda: são revisadas no Admin.</div>
      <div style="display:flex;justify-content:flex-end;margin:8px 0">${podeConfigurar() ? '<button class="dc-btn primary" data-importar>Importar agora</button>' : '<small class="dc-muted">Importar agora: owner/developer.</small>'}</div>
      ${!imps.data.disponivel ? '<div class="dc-warn-box">Estrutura de histórico ainda não aplicada no Sra Luck (migration_091).</div>' : ''}
      ${revisao.length ? `<h3 class="dc-nc-h">Aguardando revisão no Admin (${revisao.length})</h3><div class="dc-ip-list">${revisao.map(itemHtml).join('')}</div>` : ''}
      ${coberturaOrigensHtml(imps.data.origens)}
      <h3 class="dc-nc-h">Histórico de importações</h3>
      <div class="dc-ip-list">${lista.map((i) => `<button type="button" class="dc-ip-row dc-ip-click" data-imp="${esc(i.id)}"><b>${esc(quando(i.iniciado_em))}</b><span>${esc(i.origem)} · ${i.totais?.totalRd ?? 0} lida(s) · ${i.totais?.criadas ?? 0} nova(s) · ${(i.totais?.duplicadas ?? 0) + (i.totais?.clienteExistente ?? 0)} duplicidade(s)${esc(textoPassada(i.totais?.passada))}${i.erro ? `<small>${esc(i.erro)}</small>` : ''}${i.filtro ? `<small class="dc-mono">${esc(i.filtro)}</small>` : ''}</span>${DC.chip(i.status, i.status === 'concluida' ? 'ok' : i.status === 'erro' ? 'bad' : 'warn')}</button><div data-itens="${esc(i.id)}" hidden></div>`).join('') || '<div class="dc-empty">Nenhuma importação registrada.</div>'}</div>`;
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
    const eventosRd = (hist.ok ? (hist.data?.eventos || []) : [])
      .filter((e) => e.entidade_id === 'rd_station' || e.detalhes?.provedor === 'rd_station');
    const ultimoTeste = eventosRd.find((e) => e.acao === 'testou_conexao_integracao') || null;
    const testeRealAprovado = ultimoTeste?.detalhes?.conectado === true;
    const ativa = status.ativo === true && testeRealAprovado && basePronta;
    const eventos = eventosRd.slice(0, 30);
    const gate = [
      ['Credenciais OAuth', (cred.campos || []).filter((x) => x.obrigatorio).every((x) => x.origem !== 'nao_configurado'), 'Client ID, Client Secret, Redirect URI e segredo do webhook'],
      ['Conta autorizada', oauth, 'Access Token e Refresh Token presentes no cofre'],
      ['Persistência', basePronta, 'estrutura de importações disponível no backend'],
      ['Teste real', testeRealAprovado, ultimoTeste ? `último teste autenticado ${testeRealAprovado ? 'aprovado' : 'reprovado'} · ${quando(ultimoTeste.created_at)}` : 'nenhum teste autenticado registrado'],
    ];
    alvo.innerHTML = `
      <div class="dc-note"><b>RD Station CRM v2.</b> O Dev Console usa somente capacidades que o backend do Sra Luck já implementa. A API do RD possui operações de escrita, mas o projeto mantém o RD em <b>somente leitura</b>; por isso nenhuma ação de criar/alterar negócio ou contato é exposta aqui.</div>
      <h3 class="dc-nc-h">Pré-requisitos de ativação</h3>
      <div class="dc-ip-list">${gate.map(([nome, ok, detalhe]) => `<div class="dc-ip-row"><b>${esc(nome)}</b><span>${esc(detalhe)}</span>${DC.chip(ok ? 'OK' : 'Pendente', ok ? 'ok' : 'warn')}</div>`).join('')}</div>
      ${status.ativo === true
        ? '<div class="dc-note" style="margin-top:8px"><b>Integração ativa.</b> O RD Station está liberado para a automação configurada.</div>'
        : testeRealAprovado && basePronta && oauth
          ? '<div class="dc-note" style="margin-top:8px"><b>Teste real aprovado.</b> A integração continua desativada até você ativá-la. Ao ativar, o sistema executa uma nova validação real antes de liberar a automação.</div>'
          : '<div class="dc-warn-box" style="margin-top:8px">A integração permanece desativada enquanto houver pré-requisito pendente. Ao ativar, o sistema executa uma validação real; falha de autenticação mantém a integração desligada.</div>'}
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

  // Os 15 funis do RD: quantidade exata, e fonte/campanha de cada cliente (espelho do Sra Luck).
  const SITUACAO_ORIGEM = { encontrada: ['Fonte e campanha', 'ok'], parcial: ['Só o canal', 'warn'], sem_registro_no_rd: ['Sem registro no RD', 'bad'], sem_contato: ['Sem contato', 'bad'] };
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  function funisSelecionados() {
    const f = integracao('rd_station')?.funcoes?.find((x) => x.id === 'importacao');
    return new Set((f?.config?.funis || []).map((x) => x.pipelineId));
  }
  function listaOrigensHtml(d, funilId, situacao) {
    if (!d?.disponivel) return '<div class="dc-warn-box">Lista indisponível (migration_122 ainda não aplicada no Sra Luck).</div>';
    const paginas = Math.max(1, Math.ceil((d.total || 0) / (d.tamanho || 50)));
    const prova = (p) => `${esc(p.rotulo)}: <b>${esc(p.valor)}</b> — ${p.propria ? 'nesta negociação' : `negociação${p.funil ? ` do funil ${esc(p.funil)}` : ''}`}${p.criadaEm ? ` de ${esc(DC.dateFmt ? DC.dateFmt.format(new Date(p.criadaEm)) : String(p.criadaEm).slice(0, 10))}` : ''}${p.outroContato ? ` (outro cadastro com o mesmo ${p.outroContato === 'email' ? 'e-mail' : 'telefone'})` : ''}`;
    return `<div class="dc-ip-list">${(d.itens || []).map((it) => `<div class="dc-ip-row"><b>${esc(it.cliente || 'Sem nome no RD')}</b><span>Fonte: ${esc(it.fonte || '—')} · Campanha: ${esc(it.campanha || '—')}${(it.provas || []).map((p) => `<small>${prova(p)}</small>`).join('')}</span>${DC.chip(...(SITUACAO_ORIGEM[it.situacao] || [it.situacao || 'Aguardando', 'neutral']))}</div>`).join('') || '<div class="dc-empty">Nenhuma negociação nesta seleção.</div>'}</div>
      <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin:6px 0">
        <small class="dc-muted">${n(d.total)} negociação(ões) · página ${d.pagina} de ${paginas}</small>
        <button type="button" class="dc-btn" data-origem-pagina="${d.pagina - 1}" data-funil="${esc(funilId)}" data-situacao="${esc(situacao || '')}"${d.pagina <= 1 ? ' disabled' : ''}>Anterior</button>
        <button type="button" class="dc-btn" data-origem-pagina="${d.pagina + 1}" data-funil="${esc(funilId)}" data-situacao="${esc(situacao || '')}"${d.pagina >= paginas ? ' disabled' : ''}>Próxima</button>
      </div>`;
  }
  async function abaOrigens(alvo) {
    const op = await opcoesDe('rd_station');
    if (!op || op.erro) { alvo.innerHTML = `<div class="dc-warn-box">${esc(op?.erro || 'Catálogo do RD indisponível.')}</div>`; return; }
    const sel = funisSelecionados();
    const cob = op.origens?.porFunil || {};
    const esp = op.espelho || null;
    const funis = (op.funis || []).slice().sort((a, b) => (b.total?.negociacoes || 0) - (a.total?.negociacoes || 0));
    const tot = funis.reduce((acc, f) => { const c = cob[f.id]; acc.neg += f.total?.negociacoes || 0; if (c) { acc.cli += c.clientes; acc.fc += c.porSituacao?.encontrada || 0; } return acc; }, { neg: 0, cli: 0, fc: 0 });
    const top = (lista) => (lista || []).slice(0, 8).map((x) => `<li><span>${esc(x.valor)}</span><b>${n(x.clientes)}</b></li>`).join('');
    alvo.innerHTML = `<div class="dc-note">Todos os ${funis.length} funis do RD, com a quantidade exata de negociações e a <b>fonte e campanha de cada cliente</b>. A origem é procurada na negociação, nas outras negociações da cliente em qualquer funil e em outros cadastros dela no RD com o mesmo e-mail ou telefone. Sem registro em lugar nenhum, aparece “Não registrada no RD”: nada é inventado.<br/><b>A sincronização com o Admin continua só com os funis marcados</b> em Importação (${sel.size} marcado(s)); os demais só aparecem aqui.</div>
      <div class="dc-ip-kpis" style="margin-top:8px">
        <div><small>Negociações no RD</small><b>${n(tot.neg)}</b></div>
        <div><small>Clientes (pessoas)</small><b>${n(tot.cli)}</b></div>
        <div><small>Com fonte e campanha</small><b>${n(tot.fc)} (${pct(tot.fc, tot.cli)})</b></div>
        <div><small>Espelho do RD</small><b>${esp?.concluidoEm ? esc(DC.relTime(esp.concluidoEm)) : 'lendo…'}</b></div>
      </div>
      ${!Object.keys(cob).length ? '<div class="dc-warn-box" style="margin-top:8px">A primeira leitura completa do RD (negociações e contatos) ainda está em andamento; a origem por funil aparece ao terminar (a cada 6 h ela se atualiza sozinha).</div>' : ''}
      ${esp?.erro ? `<div class="dc-warn-box" style="margin-top:8px">${esc(esp.erro)}</div>` : ''}
      <div class="dc-ip-list" style="margin-top:8px">${funis.map((f) => {
        const c = cob[f.id];
        const s = c?.porSituacao || {};
        return `<details class="dc-rd-contagem" data-origem-funil="${esc(f.id)}"><summary><b>${esc(f.nome)}</b>${sel.has(f.id) ? ' ' + DC.chip('Sincroniza com o Admin', 'ok') : ''} · ${n(f.total?.negociacoes)} negociação(ões)${c ? ` · ${n(c.clientes)} cliente(s) · <b>${n(s.encontrada)} (${pct(s.encontrada || 0, c.clientes)}) com fonte e campanha</b> · ${n(s.parcial)} só o canal · ${n((s.sem_registro_no_rd || 0) + (s.sem_contato || 0))} sem registro` : ''}</summary>
          ${c ? `<div class="dc-rd-contagem-grid"><div><b>Fontes</b><ul>${top(c.fontes)}</ul></div><div><b>Campanhas</b><ul>${top(c.campanhas)}</ul></div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${[['', 'Todas'], ['encontrada', 'Fonte e campanha'], ['parcial', 'Só o canal'], ['sem_registro_no_rd', 'Sem registro']].map(([k, l]) => `<button type="button" class="dc-btn" data-origem-pagina="1" data-funil="${esc(f.id)}" data-situacao="${k}">${l}</button>`).join('')}</div>
          <div data-origem-lista="${esc(f.id)}"><small class="dc-muted">Escolha acima para ver as clientes deste funil.</small></div>` : '<small class="dc-muted">Aguardando a leitura completa deste funil.</small>'}
        </details>`;
      }).join('')}</div>`;
    alvo.addEventListener('click', async (e) => {
      const b = e.target.closest?.('[data-origem-pagina]');
      if (!b || b.disabled) return;
      const funil = b.dataset.funil, situacao = b.dataset.situacao || '';
      const lista = alvo.querySelector(`[data-origem-lista="${CSS.escape(funil)}"]`);
      if (!lista) return;
      lista.innerHTML = '<div class="dc-muted">Carregando…</div>';
      const q = new URLSearchParams({ funil, pagina: b.dataset.origemPagina });
      if (situacao) q.set('situacao', situacao);
      const r = await DC.api(`/api/admin/integrations/rd-station/origens/negociacoes?${q}`);
      lista.innerHTML = r.ok ? listaOrigensHtml(r.data, funil, situacao) : `<div class="dc-warn-box">${esc(r.error || 'Falha ao carregar.')}</div>`;
    });
  }

  // Conta Azul: central técnica (configuração, OAuth, saúde, webhooks e logs). Nada financeiro aqui:
  // vínculo de clientes e parcelas é feito pela equipe no Admin. O backend nunca devolve segredo.
  const TOKEN_ESTADO = { valido: ['Token válido', 'ok'], expirado: ['Token expirado', 'warn'], ausente: ['Sem token', 'bad'], sem_validade: ['Token sem validade', 'warn'] };
  const EVENTO_CA = { token_renovado: 'Token renovado', token_falhou: 'Falha ao renovar token', conexao_testada: 'Conexão testada', desconectado: 'Desconectado', sync_manual: 'Sincronização manual', sync_agendada: 'Sincronização agendada', oauth_conectado: 'OAuth conectado', oauth_falhou: 'Falha no OAuth', diagnostico_api: 'Diagnóstico da API' };
  const CAMPOS_APP_CA = [
    ['client_id', 'Client ID', 'text', 'Do App de Desenvolvimento (Portal do Desenvolvedor)'],
    ['client_secret', 'Client Secret', 'password', 'Nunca é exibido de volta; só a máscara'],
    ['redirect_uri', 'Redirect URI', 'text', 'App de Desenvolvimento: https://www.contaazul.com'],
  ];
  function formularioAppCa(s, cred, conexao) {
    const campo = (k) => (cred?.campos || []).find((c) => c.chave === k) || {};
    const cfg = conexao?.config || {};
    return `<h3 class="dc-nc-h">Configuração do App (credenciais e endereços)</h3>
      <div class="dc-note">Client Secret e tokens vão direto para o cofre cifrado do Sra Luck. Esta tela só envia valores novos e recebe de volta a máscara. Deixe em branco o que não quiser trocar.</div>
      <div class="dc-grid g2" style="margin-top:8px" data-ca-form>
        ${CAMPOS_APP_CA.map(([k, l, t, ajuda]) => `<div class="dc-field"><label for="ca-${k}">${esc(l)}</label><input id="ca-${k}" class="dc-input" type="${t}" autocomplete="off" spellcheck="false" data-ca-cred="${k}" placeholder="${esc(campo(k).mascara ? `salvo: ${campo(k).mascara}` : ajuda)}"><small class="dc-muted">${esc(campo(k).origem === 'nao_configurado' || !campo(k).origem ? 'não configurado' : `salvo${campo(k).atualizadoEm ? ` ${DC.relTime(campo(k).atualizadoEm)}` : ''}`)}</small></div>`).join('')}
        <div class="dc-field"><label for="ca-ambiente">Ambiente</label><select id="ca-ambiente" class="dc-input" data-ca-cfg="ambiente"><option value="teste"${cfg.ambiente !== 'producao' ? ' selected' : ''}>Teste (conta ERP de desenvolvimento)</option><option value="producao"${cfg.ambiente === 'producao' ? ' selected' : ''}>Produção (conta real)</option></select></div>
        <div class="dc-field"><label for="ca-authorizeUrl">Authorization URL</label><input id="ca-authorizeUrl" class="dc-input" data-ca-cfg="authorizeUrl" value="${esc(cfg.authorizeUrl || s.urls?.authorizeUrl || '')}"></div>
        <div class="dc-field"><label for="ca-tokenUrl">Token URL</label><input id="ca-tokenUrl" class="dc-input" data-ca-cfg="tokenUrl" value="${esc(cfg.tokenUrl || s.urls?.tokenUrl || '')}"></div>
        <div class="dc-field"><label for="ca-apiBaseUrl">API Base URL</label><input id="ca-apiBaseUrl" class="dc-input" data-ca-cfg="apiBaseUrl" value="${esc(cfg.apiBaseUrl || s.urls?.apiBaseUrl || '')}"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="dc-btn primary" data-ca="salvar-config">Salvar configuração</button></div>`;
  }
  async function abaCentralContaAzul(alvo) {
    const [r, credR] = await Promise.all([DC.api('/api/admin/integrations/conta-azul/central/status'), DC.api('/api/admin/integrations/credenciais')]);
    if (r.ok && !S.catalogo) await carregar();
    const cred = credR.ok ? (credR.data.provedores || []).find((p) => p.id === 'conta_azul') : null;
    const conexaoFuncao = integracao('conta_azul')?.funcoes?.find((f) => f.id === 'conexao') || null;
    if (!r.ok) { alvo.innerHTML = `<div class="dc-warn-box">${esc(r.status === 404 ? 'A central técnica ainda não está publicada neste Sra Luck (branch claude/conta-azul-parcela-unica).' : (r.data?.erro || r.error || 'Central indisponível.'))}</div>`; return; }
    const s = r.data, t = s.token || {};
    const [tokTxt, tokTom] = TOKEN_ESTADO[t.estado] || [t.estado || '—', 'neutral'];
    const linha = (rotulo, valor, detalhe) => `<div class="dc-ip-row"><b>${esc(rotulo)}</b><span>${valor}${detalhe ? `<small>${detalhe}</small>` : ''}</span></div>`;
    const ultimoSync = s.ultimaSincronizacao;
    alvo.innerHTML = `
      <div class="dc-note">Central técnica da Conta Azul: configuração, OAuth, saúde, webhooks e logs. <b>Operação financeira das clientes não é feita aqui</b> (vínculo por CPF, parcelas e importação ficam no Admin do Sra Luck). Client Secret e tokens ficam só no cofre cifrado do backend; esta tela recebe apenas estados.</div>
      ${s.ambiente === 'producao' ? '<div class="dc-critical-box" style="margin-top:8px"><b>Ambiente: PRODUÇÃO.</b> A conta conectada é a conta real.</div>' : '<div class="dc-warn-box" style="margin-top:8px"><b>Ambiente: TESTE.</b> Use a conta ERP do App de Desenvolvimento da Conta Azul (dados fictícios, 30 dias).</div>'}
      <div class="dc-ip-kpis" style="margin-top:8px">
        <div><small>Configuração</small><b>${s.configurado ? 'Configurado' : 'Não configurado'}</b></div>
        <div><small>Conexão OAuth</small><b>${s.conectado ? 'Conectado' : 'Desconectado'}</b></div>
        <div><small>Token</small><b>${DC.chip(tokTxt, tokTom)}</b></div>
        <div><small>Empresa conectada</small><b>${esc(s.empresa?.nome || '—')}</b></div>
      </div>
      <h3 class="dc-nc-h">Saúde</h3>
      <div class="dc-ip-list">
        ${linha('Renovação automática', t.renovacaoAutomatica ? 'Ligada (refresh token no cofre; renova 2 min antes de expirar, com trava)' : 'Desligada — conecte pelo OAuth')}
        ${linha('Token expira em', esc(quando(t.expiraEm)))}
        ${linha('Última renovação', esc(quando(t.ultimaRenovacao)), t.ultimaFalha ? `Falha ${esc(quando(t.ultimaFalha.em))}: ${esc(t.ultimaFalha.erro || t.ultimaFalha.codigo || '')}` : '')}
        ${linha('Empresa conectada', esc(s.empresa ? `${s.empresa.nome}${s.empresa.documento ? ` · ${s.empresa.documento}` : ''}` : 'Ainda não verificada — use Testar conexão'), s.empresa ? `verificada ${esc(quando(s.empresa.verificadaEm))}` : '')}
        ${linha('Última sincronização', ultimoSync ? `${esc(quando(ultimoSync.created_at))} · ${esc(ultimoSync.status)}` : 'nunca', ultimoSync?.erro ? esc(ultimoSync.erro) : '')}
        ${linha('Último erro', s.ultimoErro ? `${esc(EVENTO_CA[s.ultimoErro.event_type] || s.ultimoErro.event_type)} · ${esc(quando(s.ultimoErro.created_at))}` : 'nenhum', s.ultimoErro?.erro ? esc(s.ultimoErro.erro) : '')}
      </div>
      ${formularioAppCa(s, cred, conexaoFuncao)}
      <h3 class="dc-nc-h">Ações</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="dc-btn primary" data-ca="conectar">${s.conectado ? 'Reautorizar' : 'Conectar'} (OAuth)</button>
        <button class="dc-btn" data-ca="testar"${s.conectado ? '' : ' disabled'}>Testar conexão</button>
        <button class="dc-btn" data-ca="renovar"${s.conectado ? '' : ' disabled'}>Renovar token agora</button>
        <button class="dc-btn" data-ca="sincronizar"${s.conectado ? '' : ' disabled'}>Sincronização manual</button>
        <button class="dc-btn danger" data-ca="desconectar"${s.conectado ? '' : ' disabled'}>Desconectar</button>
      </div>
      <div class="dc-note" style="margin-top:8px"><b>App de Desenvolvimento:</b> a Conta Azul devolve o login para a Redirect URI do app (https://www.contaazul.com), fora do Sra Luck. Depois de <b>Conectar</b> e entrar com o usuário do ERP de teste, copie o endereço completo da barra do navegador (tem <span class="dc-mono">?code=…&state=…</span>) e cole abaixo em até 3 minutos.</div>
      <div style="display:flex;gap:8px;margin-top:6px"><input class="dc-input grow" type="password" autocomplete="off" spellcheck="false" data-ca-retorno placeholder="https://www.contaazul.com/?code=…&state=…"><button class="dc-btn primary" data-ca="concluir">Concluir conexão</button></div>
      <p class="dc-ov-p dc-muted">A sincronização manual executa a mesma rodada do agendador (regras automáticas seguras).</p>
      <h3 class="dc-nc-h">Diagnóstico da API (Fase 1, só leitura)</h3>
      <div class="dc-note">Chamadas reais na conta conectada: empresa, pessoa pelo CPF, pessoa pelo ID, receitas da pessoa, estrutura de uma parcela e alterações das últimas 24 h. Registra só a estrutura das respostas e valores não pessoais (status, datas, valores, versão) — sem nome, documento ou e-mail.</div>
      <div style="display:flex;gap:8px;margin-top:6px"><input class="dc-input" style="width:220px" data-ca-cpf placeholder="CPF de uma pessoa de teste"><button class="dc-btn" data-ca="diagnostico"${s.conectado ? '' : ' disabled'}>Rodar diagnóstico</button></div>
      <div data-ca-diag></div>
      <h3 class="dc-nc-h">Endereços (${esc(s.ambiente === 'producao' ? 'produção' : 'teste')})</h3>
      <div class="dc-ip-list">
        ${linha('Authorization URL', `<span class="dc-mono">${esc(s.urls?.authorizeUrl)}</span>`)}
        ${linha('Token URL', `<span class="dc-mono">${esc(s.urls?.tokenUrl)}</span>`)}
        ${linha('API Base URL', `<span class="dc-mono">${esc(s.urls?.apiBaseUrl)}</span>`)}
        ${linha('Redirect / Callback', `<span class="dc-mono">${esc(s.urls?.callback)}</span>`, 'Cadastre exatamente este endereço no App da Conta Azul (Portal do Desenvolvedor).')}
      </div>
      <h3 class="dc-nc-h">Webhooks</h3>
      <div class="dc-ip-list">${linha('Situação', DC.chip('API não oferece', 'neutral'), esc(s.webhooks?.motivo))}${linha('Contingência ativa', esc(s.webhooks?.contingencia))}</div>
      <h3 class="dc-nc-h">Comprovantes como anexo</h3>
      <div class="dc-ip-list">${linha('Situação', DC.chip('API não permite', 'neutral'), esc(s.anexos?.motivo))}</div>
      <h3 class="dc-nc-h">Logs técnicos</h3>
      <div class="dc-ip-list">${(s.eventos || []).map((e) => `<div class="dc-ip-row"><b>${esc(EVENTO_CA[e.tipo] || e.tipo)}</b><span>${esc(quando(e.em))}${e.resumo ? ` · ${esc(e.resumo)}` : ''}${e.erro ? `<small>${esc(e.erro)}</small>` : ''}</span>${DC.chip(e.status, e.status === 'erro' ? 'bad' : 'ok')}</div>`).join('') || '<div class="dc-empty">Sem eventos técnicos ainda.</div>'}</div>`;
    alvo.addEventListener('click', async (ev) => {
      const b = ev.target.closest?.('[data-ca]');
      if (!b || b.disabled) return;
      const acao = b.dataset.ca;
      const recarregar = () => abaCentralContaAzul(alvo);
      if (acao === 'conectar') return window.DCIntegrationEditor?.oauthProvider('conta_azul', b);
      if (acao === 'salvar-config') {
        const creds = [...alvo.querySelectorAll('[data-ca-cred]')].map((i) => [i.dataset.caCred, i.value.trim()]).filter(([, v]) => v);
        const config = Object.fromEntries([...alvo.querySelectorAll('[data-ca-cfg]')].map((i) => [i.dataset.caCfg, i.value.trim()]));
        const x = await DC.action(b, async () => {
          for (const [chave, valor] of creds) {
            const c = await DC.api('/api/admin/integrations/credenciais', { method: 'POST', body: { provedor: 'conta_azul', chave, valor } });
            if (!c.ok) return c;
          }
          return DC.api('/api/admin/integrations/config', { method: 'POST', body: { provedor: 'conta_azul', funcao: 'conexao', config, versao: conexaoFuncao?.versao ?? 0 } });
        }, { success: 'Configuração salva. Segredos no cofre; a integração fica desativada até nova validação.' });
        alvo.querySelectorAll('[data-ca-cred]').forEach((i) => { i.value = ''; });
        if (x?.ok) { await carregar(); return recarregar(); }
        return;
      }
      if (acao === 'concluir') {
        const campo = alvo.querySelector('[data-ca-retorno]');
        const url = String(campo?.value || '').trim();
        if (!url) return DC.toast('Cole o endereço de retorno da Conta Azul.', true);
        const x = await DC.action(b, () => DC.api('/api/admin/integrations/conta-azul/central/concluir-oauth', { method: 'POST', body: { url }, timeout: 30000 }), { success: 'Conta Azul conectada: tokens salvos no cofre.' });
        if (campo) campo.value = '';
        return x?.ok ? recarregar() : undefined;
      }
      if (acao === 'diagnostico') {
        const cpf = String(alvo.querySelector('[data-ca-cpf]')?.value || '').replace(/\D/g, '');
        const x = await DC.action(b, () => DC.api('/api/admin/integrations/conta-azul/central/diagnostico', { method: 'POST', body: { cpf }, timeout: 60000 }));
        const box = alvo.querySelector('[data-ca-diag]');
        if (x?.ok && box) box.innerHTML = `<div class="dc-ip-list" style="margin-top:8px">${(x.data.etapas || []).map((e) => `<div class="dc-ip-row"><b>${esc(e.etapa.replace(/_/g, ' '))}</b><span>${e.ok ? `HTTP ${esc(e.status)} · ${esc(e.ms)} ms${e.observacao ? ` · ${esc(e.observacao)}` : ''}` : esc(e.erro || 'falhou')}${e.cabecalhos && Object.keys(e.cabecalhos).length ? `<small class="dc-mono">${esc(Object.entries(e.cabecalhos).map(([k, v]) => `${k}: ${v}`).join(' · '))}</small>` : ''}${e.formato ? `<details><summary class="dc-muted">estrutura da resposta</summary><pre class="dc-codebox">${esc(JSON.stringify(e.formato, null, 1))}</pre></details>` : ''}</span>${DC.chip(e.ok ? 'OK' : 'Falhou', e.ok ? 'ok' : 'bad')}</div>`).join('')}</div>`;
        return;
      }
      if (acao === 'testar') { const x = await DC.action(b, () => DC.api('/api/admin/integrations/conta-azul/central/testar-conexao', { method: 'POST', body: {}, timeout: 30000 })); if (x?.ok) DC.toast(`Conexão OK: ${x.data.empresa?.nome || 'empresa'} (${x.data.latenciaMs} ms).`); return recarregar(); }
      if (acao === 'renovar') { const x = await DC.action(b, () => DC.api('/api/admin/integrations/conta-azul/central/renovar-token', { method: 'POST', body: {}, timeout: 30000 }), { success: 'Token renovado; o refresh token novo foi guardado no cofre.' }); return x && recarregar(); }
      if (acao === 'sincronizar') { const x = await DC.action(b, () => DC.api('/api/admin/integrations/conta-azul/sincronizar', { method: 'POST', body: {}, timeout: 60000 })); if (x?.ok) DC.toast(x.data.executada === false ? `Não executada: ${x.data.motivo}` : `Sincronização ${x.data.status}${x.data.erro ? `: ${x.data.erro}` : ''}.`, x.data.status === 'erro'); return recarregar(); }
      if (acao === 'desconectar') {
        if (!await DC.modal('Desconectar Conta Azul', '<div class="dc-critical-box">Revoga o acesso na Conta Azul (DELETE /oauth/connections/{id_empresa}) e apaga os tokens do cofre. A sincronização para até uma nova autorização. Parcelas, vínculos e histórico continuam no Sra Luck.</div>', { confirmText: 'Desconectar', danger: true })) return;
        const x = await DC.action(b, () => DC.api('/api/admin/integrations/conta-azul/central/desconectar', { method: 'POST', body: {}, timeout: 30000 }));
        if (x?.ok) DC.toast(x.data.revogadaNaContaAzul ? 'Acesso revogado na Conta Azul e tokens removidos.' : `Tokens removidos. A revogação na Conta Azul não foi confirmada: ${x.data.motivo || ''}`, !x.data.revogadaNaContaAzul);
        return recarregar();
      }
    });
  }

  const EXTRAS = { rd_station: [['operacao', 'Monitoramento', abaRdOperacao], ['origens', 'Funis e origem', abaOrigens], ['importacoes', 'Importações', abaCrm]], conta_azul: [['central', 'Central', abaCentralContaAzul], ['operacao', 'Operação', abaContaAzul]] };

  // ------------------------------------------------------------------ drawer

  /** Drawer do padrão. partes: { topo, credenciais, eventos, extras, rodape } em HTML já montado pela página. */
  function abrir(id, partes, aoSalvar) {
    const i = integracao(id);
    if (!i) return false;
    const disp = i.funcoes.filter((f) => f.situacao === 'disponivel').length;
    const extras = EXTRAS[id] || [];
    const resumoFuncoes = `${disp} de ${i.funcoes.length} funções disponíveis · ${i.funcoes.filter((f) => f.situacao === 'api_permite').length} que a API permite e ainda não foram feitas · ${i.funcoes.filter((f) => f.situacao === 'api_nao_permite').length} que a API não permite.`;
    const visaoHtml = id === 'rd_station'
      ? `${partes.topo}${partes.extras || ''}${partes.credenciais}<details class="dc-rd-overview-details dc-rd-tech-summary"><summary><span><b>Resumo técnico</b><small>Capacidades disponíveis nesta integração</small></span><span>${disp}/${i.funcoes.length} funções</span></summary><p class="dc-ov-p">${resumoFuncoes}</p></details>`
      : `${partes.topo}${partes.extras || ''}<h3 class="dc-nc-h">Credenciais</h3>${partes.credenciais}<div class="dc-note" style="margin-top:6px">Segredos ficam no cofre cifrado do Sra Luck. O Dev Console grava novos valores, mas nunca recebe o segredo atual em texto puro.</div><h3 class="dc-nc-h">Resumo</h3><p class="dc-ov-p">${resumoFuncoes}</p>`;
    const abas = [
      ['visao', 'Visão', visaoHtml],
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
      const filtro = e.target.closest?.('[data-rd-filtro]');
      if (filtro) {
        const grupo = filtro.closest('[data-rd-filtro-grupo]');
        const n = grupo?.querySelectorAll('[data-rd-filtro]:checked').length || 0;
        const resumo = grupo?.querySelector('[data-rd-filtro-resumo]');
        if (resumo) resumo.textContent = n ? `${n} selecionado(s)` : 'Todas';
        return;
      }
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
    ov.addEventListener('input', (e) => {
      const busca = e.target.closest?.('[data-rd-filtro-busca]');
      if (!busca) return;
      const q = busca.value.trim().toLowerCase();
      busca.closest('.dc-rd-filtro')?.querySelectorAll('[data-busca]').forEach((l) => { l.hidden = Boolean(q) && !l.dataset.busca.includes(q); });
    });
    ov.addEventListener('click', async (e) => {
      const atualizarCatalogo = e.target.closest?.('[data-rd-atualizar-catalogo]');
      if (atualizarCatalogo) {
        if (!await DC.modal('Atualizar do RD', '<div class="dc-note">Relê funis, etapas, campos e valores de cada funil no RD (somente leitura). Alterações ainda não salvas neste formulário serão descartadas.</div>', { confirmText: 'Atualizar' })) return;
        const r = await DC.action(atualizarCatalogo, () => DC.api(`${OPCOES_URL[id]}/atualizar`, { method: 'POST', body: {}, timeout: 60000 }), { success: 'Catálogo do RD atualizado.' });
        if (r?.ok) { S.opcoes[id] = r.data; await preencherFormularios(ov, i); }
        return;
      }
      const recarregar = e.target.closest?.('[data-recarregar-opcoes]');
      if (recarregar) {
        recarregar.disabled = true;
        recarregar.textContent = 'Carregando… (pode levar até 1 min)';
        delete S.opcoes[id];
        try { await preencherFormularios(ov, i); }
        finally { recarregar.disabled = false; recarregar.textContent = 'Tentar novamente'; }
        return;
      }
      if (DCCrmCampos.click(e)) return;
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
        if (r?.ok) DC.toast(`RD: ${r.data.totalRd ?? 0} lida(s) · ${r.data.criadas ?? 0} nova(s) · ${(r.data.duplicadas ?? 0) + (r.data.clienteExistente ?? 0)} para revisar${textoPassada(r.data.passada)}.`);
        carregados.delete('importacoes'); carregarExtra('importacoes');
      }
    });
    ov.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-cfg]'); if (!form) return;
      e.preventDefault();
      const f = i.funcoes.find((x) => x.id === form.dataset.cfg);
      if (S.opcoes[id]?.erro) return;
      const config = lerFormulario(form, f);
      const btn = form.querySelector('[type="submit"]');
      const enviar = () => DC.api('/api/admin/integrations/config', { method: 'POST', body: { provedor: id, funcao: form.dataset.cfg, config, versao: Number(form.dataset.versao) } });
      let r = await DC.action(btn, enviar, { success: 'Função salva. Vale a partir da próxima execução (até 30 s de cache).' });
      // A configuração mudou enquanto a tela estava aberta: antes toda nova tentativa era recusada e
      // recarregar apagava a seleção. Agora as escolhas desta tela são mantidas e podem ser gravadas
      // por cima da versão nova, com confirmação.
      if (!r?.ok && r?.data?.codigo === 'conflito_versao' && Number.isFinite(Number(r.data.versaoAtual))) {
        form.dataset.versao = String(r.data.versaoAtual);
        const ok = await DC.modal('Configuração alterada enquanto você editava', `<div class="dc-warn-box">A função passou para a versão ${esc(String(r.data.versaoAtual))} depois que esta tela foi aberta. As escolhas que estão na tela (funis, etapas, filtros e preenchimento) serão gravadas por cima.</div>`, { confirmText: 'Salvar minhas escolhas' });
        if (ok) r = await DC.action(btn, enviar, { success: 'Função salva. Vale a partir da próxima execução (até 30 s de cache).' });
      }
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
