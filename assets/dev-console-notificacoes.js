(() => {
  // Central Inteligente de Notificações (lotes financeiros com Gemini e aprovação).
  // Toda informação vem do Sra Luck (/api/admin/notificacoes/lotes*). O Dev
  // Console não guarda cópia de clientes, parcelas nem regras: só exibe, pede
  // confirmação e repassa a decisão. Sem dado → mostra que não há evidência.
  const BASE = '/api/admin/notificacoes/lotes';
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const quando = (v) => (v ? DC.dateTimeFmt.format(new Date(v)) : '—');

  const FAIXAS = {
    vence_amanha: ['Vence amanhã', 'Parcela mais antiga vence amanhã.'],
    vence_hoje: ['Vence hoje', 'Parcela mais antiga vence hoje.'],
    atraso_1: ['1 dia de atraso', 'Venceu ontem.'],
    atraso_2_5: ['2 a 5 dias', 'Atraso curto.'],
    atraso_6_10: ['6 a 10 dias', 'Atraso médio.'],
    atraso_11_30: ['11 a 30 dias', 'Atraso maior; ainda dentro da régua automática.'],
    fora_da_regua: ['Fora da régua', 'Mais de 30 dias: tratar com a equipe, sem lembrete automático.'],
  };
  const faixa = (id) => (FAIXAS[id] || [id])[0];

  const LOTE = {
    PREPARED: ['Preparado · nada enviado', 'neutral', 'O lote foi montado (quem receberia e por quê). Nenhuma mensagem foi escrita nem enviada ainda.'],
    AI_GENERATION_FAILED: ['Sem mensagem da IA', 'bad', 'Alguma cliente ficou sem mensagem aprovada (o Gemini falhou ou escreveu algo fora das regras). Nada é enviado assim: gere de novo ou edite a mensagem dela.'],
    AWAITING_APPROVAL: ['Aguardando sua aprovação', 'warn', 'Todas as mensagens foram escritas e passaram nas regras. Nada sai sem você aprovar.'],
    QUEUED_FOR_ALLOWED_WINDOW: ['Na fila · horário silencioso', 'warn', 'Você aprovou durante o horário silencioso. A rotina envia quando a janela abrir.'],
    PROCESSING: ['Enviando', 'warn', 'O Sra Luck está enviando agora, cliente por cliente.'],
    COMPLETED: ['Concluído', 'ok', 'O envio terminou. Veja abaixo quem recebeu, quem ficou só no app e quem falhou.'],
    CANCELLED: ['Cancelado', 'neutral', 'Este lote foi cancelado. Nada mais será enviado por ele.'],
  };
  const ITEM = {
    PREPARED: ['Sem mensagem', 'warn'], AWAITING_APPROVAL: ['Pronta', 'warn'], QUEUED: ['Na fila', 'warn'], PROCESSING: ['Enviando', 'warn'],
    PROVIDER_ACCEPTED: ['Push aceito', 'ok'], IN_APP_ONLY: ['Só no app', 'warn'], FAILED: ['Falhou', 'bad'],
    SKIPPED_DEDUPLICATION: ['Já avisada', 'neutral'], SKIPPED_RULE: ['Fora da regra', 'neutral'], CANCELLED: ['Cancelada', 'neutral'],
    OPENED: ['Abriu', 'ok'], CLICKED: ['Clicou', 'ok'],
  };
  const chipLote = (s) => DC.chip((LOTE[s] || [s])[0], (LOTE[s] || [0, 'neutral'])[1]);
  const chipItem = (s) => DC.chip((ITEM[s] || [s])[0], (ITEM[s] || [0, 'neutral'])[1]);

  function motivo(m) {
    if (!m) return '';
    const fixos = {
      atraso_acima_de_30_dias: 'Mais de 30 dias de atraso: fica fora da régua automática (a equipe trata direto).',
      faixa_desligada: 'A faixa dela está desligada em Regras.',
      cliente_inativa: 'Cliente inativa no cadastro.',
      parcela_suspensa: 'A parcela está suspensa no financeiro: não entra em cobrança automática.',
      contrato_cancelado_ou_suspenso: 'Contrato cancelado ou suspenso: não entra em cobrança automática.',
      fora_da_regra_de_cobranca: 'A parcela não atende à regra de cobrança automática do Sra Luck.',
      parcelas_mudaram_antes_do_envio: 'Uma parcela foi paga ou recebeu comprovante antes do envio; a mensagem ficaria errada, então não saiu.',
      cliente_sem_dispositivo_push: 'Ela não tem celular com notificações ativas: a mensagem ficou só dentro do app.',
      push_falhou: 'O serviço de push recusou o envio.',
      push_nao_configurado: 'O Web Push (VAPID) não está configurado no Sra Luck.',
    };
    if (fixos[m]) return fixos[m];
    let r = m.match(/^lembrete_nas_ultimas_(\d+)h$/);
    if (r) return `Já recebeu um lembrete financeiro nas últimas ${r[1]}h (deduplicação).`;
    r = m.match(/^ia_falhou:(.+)$/);
    if (r) return `O Gemini não respondeu (${r[1] === 'http_429' ? 'limite gratuito atingido' : r[1]}). Nenhum texto genérico foi usado.`;
    r = m.match(/^ia_reprovada:(.+)$/);
    if (r) {
      const t = { valor_inventado: 'citou um valor que não existe', data_inventada: 'citou uma data que não existe', dias_inventados: 'citou dias de atraso errados', quantidade_inventada: 'errou a quantidade de parcelas', tom_de_cobranca: 'usou tom de cobrança', documento: 'incluiu um documento', tamanho: 'ficou curta ou longa demais', caractere: 'usou link, # ou @', emoji: 'usou emoji demais' }[r[1]] || r[1];
      return `A mensagem do Gemini foi recusada: ${t}.`;
    }
    return m;
  }

  const st = { tab: 'operacao', lista: [], config: null, detalhe: null, loteId: null, chat: [], aberta: null, filtro: null, indisponivel: null, carregando: false };

  function explicarFalha(r) {
    if (r.status === 404) return 'A versão publicada do Sra Luck ainda não tem a Central de Notificações (Guidoka7/sra-luck-react#59 ainda não está em produção).';
    if (r.data?.codigo === 'migration_088') return 'A Central já está no código, mas a migration 088 (tabelas de lotes) ainda não foi aplicada no banco.';
    return r.error || r.data?.erro || `HTTP ${r.status}`;
  }

  async function carregar() {
    st.carregando = true;
    const r = await DC.api(BASE);
    st.carregando = false;
    if (!r.ok) { st.indisponivel = explicarFalha(r); st.lista = []; render(); return; }
    st.indisponivel = null;
    st.lista = r.data.lotes || [];
    st.config = r.data.config || null;
    const aberto = st.lista.find((l) => ['PREPARED', 'AI_GENERATION_FAILED', 'AWAITING_APPROVAL', 'QUEUED_FOR_ALLOWED_WINDOW', 'PROCESSING'].includes(l.status));
    st.loteId = st.loteId && st.lista.some((l) => l.id === st.loteId) ? st.loteId : (aberto || st.lista[0])?.id || null;
    await carregarDetalhe();
  }

  async function carregarDetalhe() {
    st.detalhe = null;
    if (st.loteId) {
      const r = await DC.api(`${BASE}/${st.loteId}`);
      st.detalhe = r.ok ? r.data : null;
    }
    render();
  }

  // -------------------------------------------------------------- ações
  async function executar(label, fn, sucesso) {
    const r = await fn();
    if (!r.ok) { DC.toast(`${label}: ${r.error || r.data?.erro || 'falhou'}`, true); return r; }
    DC.toast(sucesso);
    return r;
  }

  async function preparar() {
    if (!await DC.modal('Preparar lote (dry run)', '<div class="dc-note">O Sra Luck lê as parcelas em aberto, agrupa por cliente e mostra quem receberia e por quê. <b>Nada é enviado.</b></div>', { confirmText: 'Preparar' })) return;
    const r = await executar('Preparar', () => DC.api(`${BASE}/preparar`, { method: 'POST', body: {} }), 'Lote preparado. Nada foi enviado.');
    if (r.ok) { st.loteId = r.data.loteId; if (r.data.existente) DC.toast('Já existia um lote aberto: abri ele.'); await carregar(); }
  }

  async function gerar(opcoes = {}) {
    const alvo = opcoes.segmento ? ` da faixa <b>${esc(faixa(opcoes.segmento))}</b>` : '';
    const pedido = opcoes.instrucao ? `<div class="dc-note" style="margin-top:8px">Pedido: “${esc(opcoes.instrucao)}”</div>` : '';
    if (!await DC.modal('Gerar mensagens com o Gemini', `<div class="dc-note">O Gemini escreve uma mensagem por cliente${alvo}, só com o primeiro nome e as parcelas reais. Cada texto passa pelo validador (valores, datas e dias precisam ser os do sistema). <b>Nada é enviado.</b></div>${pedido}`, { confirmText: 'Gerar' })) return;
    const body = {};
    if (opcoes.segmento) body.segmento = opcoes.segmento;
    if (opcoes.instrucao) body.instrucao = opcoes.instrucao;
    const r = await DC.api(`${BASE}/${st.loteId}/gerar`, { method: 'POST', body, timeout: 60000 });
    if (!r.ok) DC.toast(r.error || r.data?.erro, true);
    else DC.toast(r.data.status === 'AWAITING_APPROVAL' ? `${r.data.geradas} mensagem(ns) prontas para aprovar.` : `${r.data.geradas} gerada(s), ${r.data.reprovadas} recusada(s) pelo validador, ${r.data.falhas} sem resposta do Gemini.`, r.data.status !== 'AWAITING_APPROVAL');
    await carregar();
  }

  async function aprovar() {
    const c = st.detalhe?.contagem || {};
    const prontas = c.porStatus?.AWAITING_APPROVAL || 0;
    const cfg = st.config || {};
    if (!await DC.modal('Aprovar e enviar', `<div class="dc-warn-box"><b>${prontas}</b> cliente(s) vão receber a mensagem no app e por push, com a sua aprovação registrada na auditoria.</div><div class="dc-note" style="margin-top:8px">Se agora for horário silencioso (${esc(cfg.silencioInicio || '—')}–${esc(cfg.silencioFim || '—')}), o lote fica na fila e sai quando a janela abrir. Antes de cada envio o Sra Luck confere de novo as parcelas e a deduplicação.</div>`, { confirmText: 'Aprovar e enviar' })) return;
    const r = await executar('Aprovar', () => DC.api(`${BASE}/${st.loteId}/aprovar`, { method: 'POST', body: {}, timeout: 60000 }), 'Lote aprovado.');
    if (r.ok && r.data.status === 'QUEUED_FOR_ALLOWED_WINDOW') DC.toast('Horário silencioso: o lote ficou na fila.');
    await carregar();
  }

  async function cancelar() {
    if (!await DC.modal('Cancelar lote', '<div class="dc-warn-box">Nenhuma mensagem deste lote será enviada. Para recalcular as elegíveis, prepare um novo lote depois.</div>', { confirmText: 'Cancelar lote', danger: true })) return;
    await executar('Cancelar', () => DC.api(`${BASE}/${st.loteId}/cancelar`, { method: 'POST', body: {} }), 'Lote cancelado.');
    await carregar();
  }

  async function recalcular() {
    if (!await DC.modal('Recalcular elegíveis', '<div class="dc-warn-box">Cancela o lote atual (nada dele é enviado) e prepara um novo com os dados de agora.</div>', { confirmText: 'Recalcular', danger: true })) return;
    const c = await DC.api(`${BASE}/${st.loteId}/cancelar`, { method: 'POST', body: {} });
    if (!c.ok) return DC.toast(c.error || c.data?.erro, true);
    const p = await DC.api(`${BASE}/preparar`, { method: 'POST', body: {} });
    if (!p.ok) return DC.toast(p.error || p.data?.erro, true);
    st.loteId = p.data.loteId;
    DC.toast('Lote recalculado. Nada foi enviado.');
    await carregar();
  }

  async function reprocessar() {
    const f = st.detalhe?.contagem?.porStatus?.FAILED || 0;
    if (!await DC.modal('Reprocessar só as falhas', `<div class="dc-note">Tenta de novo só para as <b>${f}</b> cliente(s) com falha. Quem já recebeu nunca recebe de novo.</div>`, { confirmText: 'Reprocessar' })) return;
    await executar('Reprocessar', () => DC.api(`${BASE}/${st.loteId}/reprocessar-falhas`, { method: 'POST', body: {}, timeout: 60000 }), 'Falhas reprocessadas.');
    await carregar();
  }

  async function editar(itemId) {
    const item = st.detalhe?.itens?.find((i) => i.id === itemId);
    if (!item) return;
    const parcelas = (item.parcelas || []).map((p) => `${DC.dateFmt.format(new Date(`${p.vencimento}T12:00:00`))} · ${brl(p.valor)} · ${p.diasAtraso > 0 ? `${p.diasAtraso} dia(s) de atraso` : p.diasAtraso === 0 ? 'vence hoje' : 'vence amanhã'}`).join('<br>');
    const ok = await DC.modal(`Mensagem para ${esc(item.nome)}`, `<div class="dc-note">Dados reais que a mensagem pode citar:<br>${parcelas}<br>Total: <b>${brl(item.valor_total)}</b></div><div class="dc-field" style="margin-top:8px"><label for="ncMsg">Mensagem (até 300 caracteres)</label><textarea class="dc-input area" id="ncMsg" rows="4" maxlength="300">${esc(item.mensagem || '')}</textarea></div><div class="dc-note" style="margin-top:6px">O Sra Luck valida de novo: valores, datas e dias precisam ser exatamente os de cima, sem tom de cobrança.</div>`, { confirmText: 'Salvar mensagem' });
    if (!ok) return;
    const mensagem = DC.$('ncMsg')?.value?.trim() || '';
    await executar('Editar', () => DC.api(`${BASE}/${st.loteId}/itens/${itemId}/editar`, { method: 'POST', body: { mensagem } }), 'Mensagem salva.');
    await carregar();
  }

  // -------------------------------------------------------------- render
  function abas() {
    const t = [['operacao', 'Operação'], ['chat', 'Chat Gemini'], ['regras', 'Regras financeiras'], ['eventos', 'Agenda, jornada e eventos'], ['relatorios', 'Relatórios'], ['config', 'Configurações'], ['auditoria', 'Auditoria']];
    return `<div class="dc-tabs">${t.map(([id, n]) => `<button class="${st.tab === id ? 'active' : ''}" data-tab="${id}">${n}</button>`).join('')}</div>`;
  }

  function segmentos(itens) {
    const ordem = ['vence_amanha', 'vence_hoje', 'atraso_1', 'atraso_2_5', 'atraso_6_10', 'atraso_11_30'];
    const elegiveis = itens.filter((i) => !['SKIPPED_RULE', 'SKIPPED_DEDUPLICATION', 'CANCELLED'].includes(i.status));
    return `<div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Faixa</th><th>Clientes</th><th>Com 2+ parcelas</th><th>Total em aberto</th><th></th></tr></thead><tbody>${ordem.map((s) => {
      const g = elegiveis.filter((i) => i.segmento === s);
      return `<tr><td>${esc(faixa(s))}</td><td>${g.length}</td><td>${g.filter((i) => i.quantidade_parcelas > 1).length}</td><td>${g.length ? brl(g.reduce((a, i) => a + Number(i.valor_total || 0), 0)) : '—'}</td><td>${g.length ? `<button class="dc-btn" data-seg="${s}">${st.aberta === s ? 'Fechar' : 'Ver clientes'}</button>` : ''}</td></tr>${st.aberta === s ? `<tr><td colspan="5">${tabelaClientes(g)}</td></tr>` : ''}`;
    }).join('')}</tbody></table></div>`;
  }

  function tabelaClientes(itens, comMotivo = true) {
    if (!itens.length) return '<div class="dc-empty">Ninguém aqui.</div>';
    const editavel = ['PREPARED', 'AI_GENERATION_FAILED', 'AWAITING_APPROVAL'].includes(st.detalhe?.lote?.status);
    return `<div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Cliente</th><th>Faixa</th><th>Parcelas</th><th>Total</th><th>Status</th>${comMotivo ? '<th>Por quê / mensagem</th>' : ''}<th></th></tr></thead><tbody>${itens.map((i) => `<tr><td>${esc(i.nome)}</td><td>${esc(faixa(i.segmento))}</td><td>${i.quantidade_parcelas}</td><td>${brl(i.valor_total)}</td><td>${chipItem(i.status)}</td>${comMotivo ? `<td style="max-width:320px">${i.motivo ? `<span class="dc-soft">${esc(motivo(i.motivo))}</span>` : esc(i.mensagem || '—')}</td>` : ''}<td>${editavel && ['PREPARED', 'AWAITING_APPROVAL'].includes(i.status) ? `<button class="dc-btn" data-edit="${esc(i.id)}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function amostras(itens) {
    const com = itens.filter((i) => i.mensagem);
    const pick = [
      ['1 parcela', com.find((i) => i.quantidade_parcelas === 1)],
      ['2+ parcelas', com.find((i) => i.quantidade_parcelas > 1)],
      ['Atraso curto (até 5 dias)', com.find((i) => i.maior_atraso >= 1 && i.maior_atraso <= 5)],
      ['Atraso maior (6+ dias)', com.find((i) => i.maior_atraso >= 6)],
    ].filter(([, i], idx, arr) => i && arr.findIndex(([, j]) => j === i) === idx);
    if (!pick.length) return '<div class="dc-empty">Ainda não há mensagens escritas neste lote.</div>';
    return `<div class="dc-list">${pick.map(([rot, i]) => `<div class="dc-nc-sample"><small>${esc(rot)} · ${esc(i.nome)} · ${esc(faixa(i.segmento))}</small><b>${esc(i.titulo || '')}</b><p>${esc(i.mensagem)}</p></div>`).join('')}</div>`;
  }

  function acoesLote(l, c) {
    const b = [];
    if (!l || ['COMPLETED', 'CANCELLED'].includes(l.status)) b.push('<button class="dc-btn primary" data-act="preparar">Preparar lote (dry run)</button>');
    if (l && ['PREPARED', 'AI_GENERATION_FAILED', 'AWAITING_APPROVAL'].includes(l.status) && c.elegiveis) b.push(`<button class="dc-btn ${l.status === 'AWAITING_APPROVAL' ? '' : 'primary'}" data-act="gerar">${l.status === 'PREPARED' ? 'Gerar mensagens (Gemini)' : 'Gerar outra versão'}</button>`);
    if (l?.status === 'AWAITING_APPROVAL') b.push('<button class="dc-btn primary" data-act="aprovar">Aprovar e enviar</button>');
    if (l && ['PREPARED', 'AI_GENERATION_FAILED', 'AWAITING_APPROVAL'].includes(l.status)) b.push('<button class="dc-btn" data-act="recalcular">Recalcular elegíveis</button>');
    if (l && ['PREPARED', 'AI_GENERATION_FAILED', 'AWAITING_APPROVAL', 'QUEUED_FOR_ALLOWED_WINDOW'].includes(l.status)) b.push('<button class="dc-btn danger" data-act="cancelar">Cancelar lote</button>');
    if (l?.status === 'COMPLETED' && c.porStatus?.FAILED) b.push(`<button class="dc-btn" data-act="reprocessar">Reprocessar só falhas (${c.porStatus.FAILED})</button>`);
    return `<div class="dc-toolbar" style="flex-wrap:wrap">${b.join('')}</div>`;
  }

  function tabOperacao() {
    const d = st.detalhe;
    if (!d) return `<div class="dc-empty">Nenhum lote ainda. Prepare um lote para ver quem receberia e por quê (nada é enviado).</div>${acoesLote(null, {})}`;
    const l = d.lote, c = d.contagem, itens = d.itens || [];
    const fora = itens.filter((i) => ['SKIPPED_RULE', 'SKIPPED_DEDUPLICATION'].includes(i.status) || (i.status === 'PREPARED' && i.motivo));
    const falhas = itens.filter((i) => i.status === 'FAILED');
    return `<div class="dc-nc-head"><div>${chipLote(l.status)} <span class="dc-soft">Lote de ${esc(DC.dateFmt.format(new Date(`${l.data_referencia}T12:00:00`)))} · ${l.origem === 'rotina' ? 'rotina diária' : 'preparado manualmente'}${l.modelo ? ` · ${esc(l.modelo)} · ${esc(l.prompt_version || '')}` : ''}</span></div><p>${esc((LOTE[l.status] || [])[2] || '')}${l.erro ? ` <b>${esc(l.erro)}</b>` : ''}</p></div>
      <div class="dc-nc-kpis"><div><small>Elegíveis</small><b>${c.elegiveis}</b></div><div><small>Com 2+ parcelas (1 mensagem só)</small><b>${c.multiplasParcelas}</b></div><div><small>Fora do lote</small><b>${(c.porStatus.SKIPPED_RULE || 0) + (c.porStatus.SKIPPED_DEDUPLICATION || 0)}</b></div>${l.status === 'COMPLETED' ? `<div><small>Push aceito / só app / falhas</small><b>${c.porStatus.PROVIDER_ACCEPTED || 0} / ${c.porStatus.IN_APP_ONLY || 0} / ${c.porStatus.FAILED || 0}</b></div>` : ''}</div>
      ${acoesLote(l, c)}
      <h3 class="dc-nc-h">Faixas da régua</h3>${segmentos(itens)}
      <h3 class="dc-nc-h">Prévia por amostragem</h3>${amostras(itens)}
      ${falhas.length ? `<h3 class="dc-nc-h">Falhas</h3>${tabelaClientes(falhas)}` : ''}
      <h3 class="dc-nc-h">Quem ficou de fora e por quê</h3>${fora.length ? tabelaClientes(fora) : '<div class="dc-empty">Ninguém ficou de fora.</div>'}`;
  }

  function resumoSistema() {
    const d = st.detalhe;
    if (!d) return 'Ainda não há lote. Peça “prepara o lote” ou use o botão em Operação: eu só monto a lista, nada é enviado.';
    const c = d.contagem, s = c.porSegmento || {};
    const partes = Object.entries(s).map(([k, v]) => `${v} em “${faixa(k)}”`);
    return `Lote de ${DC.dateFmt.format(new Date(`${d.lote.data_referencia}T12:00:00`))}: ${(LOTE[d.lote.status] || [d.lote.status])[0].toLowerCase()}. ${c.elegiveis} cliente(s) elegível(is)${partes.length ? ` (${partes.join(', ')})` : ''}. ${c.multiplasParcelas ? `${c.multiplasParcelas} com duas ou mais parcelas: cada uma recebe uma única mensagem. ` : ''}${(c.porStatus.SKIPPED_RULE || 0) + (c.porStatus.SKIPPED_DEDUPLICATION || 0)} ficaram de fora.`;
  }

  const ROTULO_ACAO = { aprovar: 'Aprovar e enviar', gerar_novamente: 'Gerar outra versão', cancelar: 'Cancelar lote', preparar_novamente: 'Recalcular elegíveis', mostrar_segmento: 'Ver clientes da faixa', mostrar_falhas: 'Ver falhas', reprocessar_falhas: 'Reprocessar só falhas' };

  function tabChat() {
    const msgs = st.chat.map((m, idx) => m.autor === 'equipe'
      ? `<div class="dc-nc-msg eu">${esc(m.texto)}</div>`
      : `<div class="dc-nc-msg ${m.autor}">${m.autor === 'erro' ? '<small>Falha real</small>' : '<small>Gemini</small>'}${esc(m.texto)}${m.acao && m.acao.tipo !== 'nenhuma' ? `<div style="margin-top:6px"><button class="dc-btn" data-chat-acao="${idx}">${esc(ROTULO_ACAO[m.acao.tipo] || m.acao.tipo)}${m.acao.segmento ? ` · ${esc(faixa(m.acao.segmento))}` : ''}</button> <span class="dc-soft">você confirma antes</span></div>` : ''}${m.autor === 'erro' ? '<div style="margin-top:6px"><button class="dc-btn" data-chat-retry>Tentar de novo</button></div>' : ''}</div>`).join('');
    return `<div class="dc-nc-chat"><div class="dc-nc-msg sistema"><small>Resumo do sistema · dados reais do lote, sem IA</small>${esc(resumoSistema())}</div>${msgs}</div>
      <div class="dc-nc-send"><input class="dc-input" id="ncChatIn" maxlength="300" placeholder="Ex.: me mostra quem vai receber · deixa a de 6 a 10 dias mais acolhedora · pode enviar"/><button class="dc-btn primary" data-chat-send>Enviar</button></div>
      <div class="dc-note" style="margin-top:6px">O Gemini só lê os dados deste lote e <b>não executa nada</b>: quando você pede uma ação, ele sugere um botão e você confirma.</div>`;
  }

  async function perguntar(texto) {
    if (!st.loteId) { st.chat.push({ autor: 'erro', texto: 'Ainda não há lote para conversar. Prepare um lote em Operação.' }); return render(); }
    st.chat.push({ autor: 'equipe', texto });
    render();
    const historico = st.chat.filter((m) => m.autor !== 'erro').slice(-9, -1).map((m) => ({ autor: m.autor === 'equipe' ? 'equipe' : 'gemini', texto: String(m.texto).slice(0, 300) }));
    const r = await DC.api(`${BASE}/${st.loteId}/chat`, { method: 'POST', body: { mensagem: texto, historico }, timeout: 45000 });
    st.chat.push(r.ok ? { autor: 'gemini', texto: r.data.resposta || '(sem resposta)', acao: r.data.acao } : { autor: 'erro', texto: `Não consegui falar com o Gemini agora: ${r.error || r.data?.erro}`, retry: texto });
    render();
  }

  async function acaoDoChat(a) {
    if (a.tipo === 'aprovar') return aprovar();
    if (a.tipo === 'gerar_novamente') return gerar({ segmento: a.segmento || undefined, instrucao: a.instrucao || undefined });
    if (a.tipo === 'cancelar') return cancelar();
    if (a.tipo === 'preparar_novamente') return st.detalhe && !['COMPLETED', 'CANCELLED'].includes(st.detalhe.lote.status) ? recalcular() : preparar();
    if (a.tipo === 'reprocessar_falhas') return reprocessar();
    if (a.tipo === 'mostrar_segmento') { st.tab = 'operacao'; st.aberta = a.segmento; return render(); }
    if (a.tipo === 'mostrar_falhas') { st.tab = 'relatorios'; st.filtro = 'FAILED'; return render(); }
  }

  function tabRegras() {
    const cfg = st.config;
    if (!cfg) return '<div class="dc-empty">Ainda não há evidência suficiente: a configuração não pôde ser lida.</div>';
    const ligadas = new Set(cfg.segmentos || []);
    return `<div class="dc-note">Uma cliente recebe <b>uma única mensagem</b>, mesmo com várias parcelas em aberto. A faixa é a da parcela mais antiga. Parcela paga ou com comprovante em conferência nunca entra.</div>
      <div class="dc-table-wrap" style="margin-top:8px"><table class="dc-compact-table"><thead><tr><th>Faixa</th><th>Quando entra</th><th>Ligada</th></tr></thead><tbody>${['vence_amanha', 'vence_hoje', 'atraso_1', 'atraso_2_5', 'atraso_6_10', 'atraso_11_30'].map((s) => `<tr><td>${esc(faixa(s))}</td><td class="dc-soft">${esc(FAIXAS[s][1])}</td><td><label class="dc-switch"><input type="checkbox" data-seg-toggle="${s}" ${ligadas.has(s) ? 'checked' : ''}/><span></span></label></td></tr>`).join('')}<tr><td>${esc(faixa('fora_da_regua'))}</td><td class="dc-soft">${esc(FAIXAS.fora_da_regua[1])}</td><td>${DC.chip('Sempre fora', 'neutral')}</td></tr></tbody></table></div>
      <div class="dc-note" style="margin-top:8px">O texto é escrito pelo Gemini a partir desses dados. Antes de salvar, o Sra Luck recusa qualquer valor, data, número de dias ou de parcelas que não esteja no sistema, e qualquer tom de cobrança (juros, multa, SPC, bloqueio...).</div>`;
  }

  function tabEventos() {
    const grupos = [
      ['Financeiro', ['Pagamento confirmado', 'Comprovante recebido', 'Comprovante aprovado', 'Comprovante recusado', 'Parcela regularizada']],
      ['Agenda', ['Termos agendados / reagendados', 'Lembrete de termos', 'Cirurgia agendada / reagendada', 'Lembrete de cirurgia']],
      ['Jornada', ['Elegibilidade atingida', 'Solicitação de liberação recebida', 'Entrada em Levantamentos', 'Termos confirmados', 'Entrada em Liberações Financeiras', 'Liberação cirúrgica disponível', 'Cirurgia confirmada']],
      ['App', ['Acesso liberado', 'Requisito pendente']],
    ];
    return `<div class="dc-warn-box">Estes eventos <b>ainda não geram notificação</b> no Sra Luck: hoje nenhum desses fluxos chama o envio. Eles serão ligados na próxima etapa, cada um com a opção “Automático” ou “Exigir aprovação”.</div>
      ${grupos.map(([g, evs]) => `<h3 class="dc-nc-h">${g}</h3><div class="dc-list">${evs.map((e) => `<div class="dc-row" style="grid-template-columns:1fr auto"><span>${esc(e)}</span>${DC.chip('Não conectado', 'neutral')}</div>`).join('')}</div>`).join('')}`;
  }

  function tabRelatorios() {
    if (!st.lista.length) return '<div class="dc-empty">Ainda não há evidência suficiente: nenhum lote foi preparado.</div>';
    const d = st.detalhe;
    const itens = (d?.itens || []).filter((i) => !st.filtro || i.status === st.filtro);
    const filtros = [null, 'PROVIDER_ACCEPTED', 'IN_APP_ONLY', 'FAILED', 'SKIPPED_DEDUPLICATION', 'SKIPPED_RULE'];
    return `<div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Lote</th><th>Status</th><th>Elegíveis</th><th>Push aceito</th><th>Só app</th><th>Falhas</th><th>Deduplicadas</th><th>Fora da regra</th><th>Aprovado por</th><th>Modelo / prompt</th></tr></thead><tbody>${st.lista.map((l) => {
      const s = l.contagem?.porStatus || {};
      return `<tr class="${l.id === st.loteId ? 'dc-row-active' : ''}" data-lote="${esc(l.id)}" style="cursor:pointer"><td>${quando(l.created_at)}</td><td>${chipLote(l.status)}</td><td>${l.contagem?.elegiveis ?? 0}</td><td>${s.PROVIDER_ACCEPTED || 0}</td><td>${s.IN_APP_ONLY || 0}</td><td>${s.FAILED || 0}</td><td>${s.SKIPPED_DEDUPLICATION || 0}</td><td>${s.SKIPPED_RULE || 0}</td><td>${esc(l.aprovado_por || '—')}</td><td class="dc-soft">${esc(l.modelo || '—')} ${esc(l.prompt_version || '')}</td></tr>`;
    }).join('')}</tbody></table></div>
      ${d ? `<div class="dc-nc-explain"><div class="dc-toolbar"><button class="dc-btn" data-act="explicar">Explicar este lote</button><span class="dc-soft">O Gemini só resume os números gravados deste lote; se citar algo fora deles, o resumo é descartado.</span></div>${explicacaoHtml()}</div>
      <h3 class="dc-nc-h">Por cliente · lote de ${quando(d.lote.created_at)}${d.duracaoMs != null ? ` · envio levou ${Math.round(d.duracaoMs / 1000)}s` : ''}</h3>
      <div class="dc-filter-chips">${filtros.map((f) => `<button class="dc-btn ${st.filtro === f ? 'primary' : ''}" data-filtro="${f || ''}">${f ? (ITEM[f] || [f])[0] : 'Todas'}</button>`).join('')}</div>
      ${tabelaClientes(itens)}
      <div class="dc-note" style="margin-top:6px">“Push aceito” quer dizer que o serviço de push recebeu a mensagem, <b>não</b> que a cliente viu. Abertura e clique ainda não são registrados pelo app.</div>` : ''}`;
  }

  const ROTULOS_FATOS = [['clientesAnalisadas', 'Clientes analisadas'], ['elegiveis', 'Elegíveis'], ['comMaisDeUmaParcela', 'Com 2+ parcelas (1 mensagem)'], ['aceitasPeloProvedor', 'Push aceito'], ['somenteNoApp', 'Só no app'], ['falhas', 'Falhas'], ['deduplicadas', 'Deduplicadas'], ['foraDaRegra', 'Fora da regra'], ['semMensagem', 'Sem mensagem']];
  function explicacaoHtml() {
    const e = st.explicacao;
    if (!e || e.loteId !== st.loteId) return '';
    if (e.carregando) return '<div class="dc-empty">Pedindo o resumo ao Gemini…</div>';
    const fatos = e.fatos ? `<div class="dc-nc-kpis">${ROTULOS_FATOS.filter(([k]) => e.fatos[k] != null).map(([k, n]) => `<div><small>${esc(n)}</small><b>${Number(e.fatos[k])}</b></div>`).join('')}</div>${Object.keys(e.fatos.motivos || {}).length ? `<div class="dc-list">${Object.entries(e.fatos.motivos).map(([m, q]) => `<div class="dc-row" style="grid-template-columns:1fr auto"><span>${esc(motivo(m))}</span><b>${Number(q)}</b></div>`).join('')}</div>` : ''}` : '';
    const texto = e.ok ? `<div class="dc-nc-msg gemini" style="max-width:100%"><small>Gemini · resumo validado</small>${esc(e.texto)}</div>` : `<div class="dc-nc-msg erro" style="max-width:100%"><small>Sem resumo</small>${esc(e.erro)}</div>`;
    return `${texto}${fatos ? `<h3 class="dc-nc-h">Fatos gravados do lote</h3>${fatos}` : ''}`;
  }

  async function explicar() {
    if (!st.loteId) return;
    st.explicacao = { loteId: st.loteId, carregando: true };
    render();
    const r = await DC.api(`${BASE}/${st.loteId}/explicar`, { method: 'POST', body: {}, timeout: 45000 });
    st.explicacao = r.ok ? { loteId: st.loteId, ok: true, texto: r.data.texto, fatos: r.data.fatos } : { loteId: st.loteId, ok: false, erro: explicarFalha(r), fatos: r.data?.fatos || null };
    render();
  }

  function tabConfig() {
    const c = st.config;
    if (!c) return '<div class="dc-empty">Ainda não há evidência suficiente: a configuração não pôde ser lida.</div>';
    return `<div class="dc-grid g2">
      <div class="dc-field"><label>Central de lotes</label><label class="dc-switch"><input type="checkbox" id="ncAtiva" ${c.ativa ? 'checked' : ''}/><span></span></label><small class="dc-soft">${c.ativa ? 'Ligada: a rotina por parcela não envia mais.' : 'Desligada: o Sra Luck segue com a rotina antiga (uma mensagem por parcela).'}</small></div>
      <div class="dc-field"><label>Aprovação obrigatória</label><label class="dc-switch"><input type="checkbox" id="ncAprov" ${c.aprovacaoObrigatoria ? 'checked' : ''}/><span></span></label><small class="dc-soft">${c.aprovacaoObrigatoria ? 'Nenhum lote sai sem uma pessoa aprovar.' : 'A rotina diária aprova sozinha quando todas as mensagens passam nas regras.'}</small></div>
      <div class="dc-field"><label for="ncSilIni">Horário silencioso: início</label><input class="dc-input" id="ncSilIni" type="time" value="${esc(c.silencioInicio)}"/></div>
      <div class="dc-field"><label for="ncSilFim">Horário silencioso: fim</label><input class="dc-input" id="ncSilFim" type="time" value="${esc(c.silencioFim)}"/></div>
      <div class="dc-field"><label for="ncDedup">Não repetir lembrete financeiro dentro de (horas)</label><input class="dc-input" id="ncDedup" type="number" min="1" max="168" step="1" value="${Number(c.janelaDedupHoras)}"/></div>
      <div class="dc-field"><label>Rotina diária</label><div class="dc-soft">Todo dia às 08:05 (Brasília): libera a fila e prepara o lote do dia. Esse horário fica no <span class="dc-mono">vercel.json</span> do Sra Luck (mudar exige deploy).</div></div>
      <div class="dc-field"><label>Canal</label><div class="dc-soft">Notificação no app + Web Push (o mesmo envio do Admin). WhatsApp, SMS e e-mail não fazem parte desta central.</div></div>
    </div><div class="dc-toolbar" style="margin-top:10px"><button class="dc-btn primary" data-act="salvar-config">Salvar configurações</button></div>`;
  }

  async function salvarConfig() {
    const c = st.config || {};
    const novo = { ativa: DC.$('ncAtiva').checked, aprovacaoObrigatoria: DC.$('ncAprov').checked, silencioInicio: DC.$('ncSilIni').value, silencioFim: DC.$('ncSilFim').value, janelaDedupHoras: Number(DC.$('ncDedup').value) };
    const body = Object.fromEntries(Object.entries(novo).filter(([k, v]) => v !== c[k]));
    if (!Object.keys(body).length) return DC.toast('Nada mudou.');
    const avisos = [];
    if (body.ativa === true) avisos.push('Ligar a Central <b>desliga a rotina antiga</b> (uma mensagem por parcela). A partir daí os lembretes financeiros só saem por lote, com aprovação.');
    if (body.ativa === false) avisos.push('Desligar a Central faz o Sra Luck <b>voltar para a rotina antiga</b> (uma mensagem por parcela, sem aprovação), se ela estiver agendada.');
    if (body.aprovacaoObrigatoria === false) avisos.push('Sem aprovação obrigatória, a rotina diária <b>envia sozinha</b> quando todas as mensagens passam nas regras.');
    if (!await DC.modal('Salvar configurações', `${avisos.map((a) => `<div class="dc-warn-box" style="margin-bottom:6px">${a}</div>`).join('')}<div class="dc-note">A mudança fica registrada na auditoria (valor anterior e novo).</div>`, { confirmText: 'Salvar', danger: avisos.length > 0 })) return;
    await executar('Configurações', () => DC.api(`${BASE}/config`, { method: 'POST', body }), 'Configuração salva no Sra Luck.');
    await carregar();
  }

  async function salvarFaixa(seg, ligada) {
    const atuais = new Set(st.config?.segmentos || []);
    if (ligada) atuais.add(seg); else atuais.delete(seg);
    if (!ligada && !await DC.modal('Desligar faixa', `<div class="dc-warn-box">Clientes na faixa <b>${esc(faixa(seg))}</b> deixam de receber lembrete automático até você religar.</div>`, { confirmText: 'Desligar', danger: true })) return render();
    await executar('Regras', () => DC.api(`${BASE}/config`, { method: 'POST', body: { segmentos: [...atuais] } }), 'Régua atualizada.');
    await carregar();
  }

  const ACOES_AUDIT = {
    preparou_lote_notificacoes: 'preparou um lote (dry run)', gerou_mensagens_lote: 'gerou mensagens com o Gemini', editou_mensagem_lote: 'editou uma mensagem',
    aprovou_lote_notificacoes: 'aprovou o lote', processou_lote_notificacoes: 'enviou o lote', reprocessou_falhas_lote: 'reprocessou falhas',
    cancelou_lote_notificacoes: 'cancelou o lote', alterou_config_central_notificacoes: 'alterou configurações',
  };
  let auditoria = null;
  async function carregarAuditoria() {
    const r = await DC.api(`${BASE}/auditoria`);
    auditoria = r.ok ? (r.data.eventos || []) : { erro: explicarFalha(r) };
    render();
  }
  function tabAuditoria() {
    if (auditoria == null) { carregarAuditoria(); return '<div class="dc-empty">Carregando…</div>'; }
    if (auditoria.erro) return `<div class="dc-empty">${esc(auditoria.erro)}</div>`;
    if (!auditoria.length) return '<div class="dc-empty">Ainda não há evidência suficiente: nenhuma ação registrada.</div>';
    const det = (e) => {
      const d = e.detalhes || {};
      if (e.acao === 'processou_lote_notificacoes' || e.acao === 'reprocessou_falhas_lote') return `${d.aceitas || 0} push aceito · ${d.somenteApp || 0} só app · ${d.falhas || 0} falha(s) · ${d.deduplicadas || 0} deduplicada(s) · ${d.ignoradas || 0} fora da regra`;
      if (e.acao === 'gerou_mensagens_lote') return `${d.geradas || 0} escrita(s) · ${d.reprovadas || 0} recusada(s) · ${d.falhas || 0} sem resposta · ${d.modelo || '—'} ${d.prompt_version || ''}${d.com_instrucao ? ' · com pedido da equipe' : ''}`;
      if (e.acao === 'preparou_lote_notificacoes') return `${d.elegiveis || 0} elegível(is) de ${d.candidatas || 0} · ${d.origem || ''}`;
      if (e.acao === 'alterou_config_central_notificacoes') return Object.keys(d.depois || {}).filter((k) => JSON.stringify(d.antes?.[k]) !== JSON.stringify(d.depois?.[k])).map((k) => `${k}: ${JSON.stringify(d.antes?.[k])} → ${JSON.stringify(d.depois?.[k])}`).join(' · ') || 'sem mudança efetiva';
      if (e.acao === 'aprovou_lote_notificacoes') return d.fila ? 'ficou na fila (horário silencioso)' : 'envio imediato';
      return '';
    };
    return `<div class="dc-timeline">${auditoria.map((e) => `<div class="dc-timeline-item"><h4>${esc(e.usuario)} ${esc(ACOES_AUDIT[e.acao] || e.acao)}</h4><p>${quando(e.created_at)}${det(e) ? ` · ${esc(det(e))}` : ''}</p></div>`).join('')}</div>`;
  }

  function corpo() {
    if (st.indisponivel) return `<div class="dc-warn-box"><b>Central indisponível.</b> ${esc(st.indisponivel)}</div><div class="dc-note" style="margin-top:8px">Enquanto isso, nada é simulado: as abas ficam vazias até o Sra Luck responder de verdade.</div>`;
    return ({ operacao: tabOperacao, chat: tabChat, regras: tabRegras, eventos: tabEventos, relatorios: tabRelatorios, config: tabConfig, auditoria: tabAuditoria }[st.tab] || tabOperacao)();
  }

  let overlay = null;
  function render() {
    if (!overlay || !document.body.contains(overlay)) return;
    const body = overlay.querySelector('.dc-drawer-body');
    const scroll = body.scrollTop;
    body.innerHTML = abas() + (st.carregando && !st.lista.length && !st.indisponivel ? '<div class="dc-empty">Carregando…</div>' : corpo());
    body.scrollTop = scroll;
    const chat = body.querySelector('.dc-nc-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    window.lucide?.createIcons();
  }

  function ligar(ov) {
    ov.addEventListener('click', (e) => {
      const t = e.target.closest('button,[data-lote]');
      if (!t) return;
      if (t.dataset.tab) { st.tab = t.dataset.tab; if (st.tab === 'auditoria') auditoria = null; return render(); }
      if (t.dataset.seg) { st.aberta = st.aberta === t.dataset.seg ? null : t.dataset.seg; return render(); }
      if (t.dataset.edit) return editar(t.dataset.edit);
      if (t.dataset.lote) { st.loteId = t.dataset.lote; return carregarDetalhe(); }
      if (t.dataset.filtro !== undefined) { st.filtro = t.dataset.filtro || null; return render(); }
      if (t.dataset.chatAcao !== undefined) { const m = st.chat[Number(t.dataset.chatAcao)]; return m?.acao && acaoDoChat(m.acao); }
      if (t.hasAttribute('data-chat-retry')) { const ult = [...st.chat].reverse().find((m) => m.retry); if (ult) { st.chat = st.chat.filter((m) => m !== ult && !(m.autor === 'equipe' && m.texto === ult.retry)); return perguntar(ult.retry); } }
      if (t.hasAttribute('data-chat-send')) { const i = DC.$('ncChatIn'); const v = i?.value.trim(); if (v) { i.value = ''; perguntar(v); } return; }
      const act = t.dataset.act;
      if (act === 'preparar') return preparar();
      if (act === 'gerar') return gerar();
      if (act === 'aprovar') return aprovar();
      if (act === 'cancelar') return cancelar();
      if (act === 'recalcular') return recalcular();
      if (act === 'reprocessar') return reprocessar();
      if (act === 'salvar-config') return salvarConfig();
      if (act === 'explicar') return explicar();
    });
    ov.addEventListener('change', (e) => { const s = e.target.dataset?.segToggle; if (s) salvarFaixa(s, e.target.checked); });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ncChatIn') { e.preventDefault(); ov.querySelector('[data-chat-send]')?.click(); } });
  }

  async function abrir(tab) {
    if (tab) st.tab = tab;
    overlay = DC.openDrawer('Central Inteligente de Notificações', '', { footer: '<button class="dc-btn" data-nc-refresh>Atualizar</button>' });
    overlay.querySelector('.dc-drawer').classList.add('wide');
    overlay.querySelector('[data-nc-refresh]').onclick = () => { auditoria = null; carregar(); };
    ligar(overlay);
    render();
    await carregar();
  }

  /** Resumo para a página (sem abrir o drawer). */
  async function resumo() {
    const r = await DC.api(BASE);
    if (!r.ok) return { ok: false, motivo: explicarFalha(r) };
    const lotes = r.data.lotes || [];
    const aberto = lotes.find((l) => ['PREPARED', 'AI_GENERATION_FAILED', 'AWAITING_APPROVAL', 'QUEUED_FOR_ALLOWED_WINDOW', 'PROCESSING'].includes(l.status));
    return { ok: true, config: r.data.config, aberto, ultimo: lotes[0] || null, rotulo: (s) => (LOTE[s] || [s])[0], tom: (s) => (LOTE[s] || [0, 'neutral'])[1] };
  }

  window.DCNotificacoes = { abrir, resumo };
})();
