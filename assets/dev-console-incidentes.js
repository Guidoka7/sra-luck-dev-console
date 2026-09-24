(() => {
  // Central de Incidentes: acompanhamento dos incidentes que a varredura registra (dev_incidents).
  // Fontes: /api/incidentes (incidentes, eventos, responsáveis), /api/github-status?resource=changes
  // (deploys e migrations) e /api/infra-history (leituras dos testes). Nada é estimado; mudar status,
  // responsável ou nota altera só o registro de acompanhamento, nunca a produção.
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const H = 3600000, DIA = 24 * H;
  const { COMP_NOME, FONTES_TESTE_COMP, DEPS, mapaDoIncidente } = DCInvest.MAPA;
  const STATUS = { open: ['Aberto', 'bad'], reopened: ['Reaberto', 'purple'], investigating: ['Investigando', 'info'], mitigated: ['Mitigado', 'warn'], resolved: ['Resolvido', 'ok'] };
  const SEV = { critical: [0, 'Crítico', 'bad'], high: [1, 'Alto', 'bad'], warning: [2, 'Atenção', 'warn'], info: [3, 'Info', 'info'] };
  const quando = (iso) => (iso ? DC.relTime(iso) : '—');
  const S = { dias: 7 };
  const V = {};

  // ------------------------------------------------------------- carga
  async function carregar() {
    const [inc, ch, hist] = await Promise.all([
      DC.api(`/api/incidentes?dias=${S.dias}`, { timeout: 30000 }),
      DC.api('/api/github-status?resource=changes', { timeout: 30000 }),
      DC.api(`/api/infra-history?series=${encodeURIComponent(DCInvest.PROBES.map((x) => `probe:${x}`).join(','))}&hours=168`, { timeout: 30000 }),
    ]);
    V.inc = inc; V.changes = ch.ok ? ch.data : null; V.probeHist = hist.ok ? hist.data.series || {} : null; V.histErro = hist.ok ? null : hist.error;
  }
  const dados = () => (V.inc?.ok ? V.inc.data : null);
  const mudancas = () => DCInvest.mudancasDe(V.changes);
  const eventosDe = (id) => (dados()?.eventos || []).filter((e) => e.incident_id === id);
  const nomeUsuario = (id) => (dados()?.responsaveis || []).find((u) => u.id === id)?.name || null;

  // ------------------------------------------------------------- modelo
  function enriquecer(inc) {
    const m = mapaDoIncidente(inc), ev = eventosDe(inc.id), agora = Date.now();
    const reaberturas = ev.filter((e) => e.event_type === 'reopened').length;
    const manual = inc.metadata?.manual || null;
    // "Mitigado, mas ainda detectado": alguém marcou mitigado e a varredura continuou vendo o problema depois.
    const aindaDetectado = inc.status === 'mitigated' && manual?.status === 'mitigated' && Date.parse(inc.last_seen_at) > Date.parse(manual.em) + 30 * 60000;
    const perto = DCInvest.perto(mudancas(), inc.first_seen_at);
    return { ...inc, ...m, ev, reaberturas, manual, aindaDetectado, perto, voltou: inc.status === 'reopened' || reaberturas > 0, idade: agora - Date.parse(inc.first_seen_at), responsavel: nomeUsuario(inc.assigned_to) };
  }
  const exigeAcao = (i) => (['open', 'reopened', 'investigating'].includes(i.status) && ['critical', 'high'].includes(i.severity)) || i.status === 'reopened' || i.aindaDetectado;

  // Agrupa alertas que provavelmente são o mesmo problema: mesmo deploy suspeito (início até 6 h
  // de diferença), mesmo componente (até 2 h) ou um componente que depende do outro (até 2 h).
  function agrupar(lista) {
    const pai = lista.map((_, k) => k), raiz = (k) => (pai[k] === k ? k : (pai[k] = raiz(pai[k])));
    const motivo = new Map();
    for (let a = 0; a < lista.length; a++) for (let b = a + 1; b < lista.length; b++) {
      const x = lista[a], y = lista[b], dt = Math.abs(Date.parse(x.first_seen_at) - Date.parse(y.first_seen_at));
      const dx = x.perto.find((m) => m.tipo === 'deploy'), dy = y.perto.find((m) => m.tipo === 'deploy');
      let porque = null;
      if (dx && dy && dx.t === dy.t && dt <= 6 * H) porque = `mesmo deploy suspeito (${dx.ref})`;
      else if (x.comp && x.comp === y.comp && dt <= 2 * H) porque = `mesmo componente (${COMP_NOME[x.comp]}), começaram com ${DCInvest.dur(dt)} de diferença`;
      else if (x.comp && y.comp && dt <= 2 * H && ((DEPS[x.comp] || []).includes(y.comp) || (DEPS[y.comp] || []).includes(x.comp))) porque = `${COMP_NOME[x.comp]} e ${COMP_NOME[y.comp]} dependem um do outro, começaram com ${DCInvest.dur(dt)} de diferença`;
      if (porque) { const ra = raiz(a), rb = raiz(b); if (ra !== rb) { pai[rb] = ra; motivo.set(ra, motivo.get(ra) || porque); } }
    }
    const grupos = new Map();
    lista.forEach((i, k) => { const r = raiz(k); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(i); });
    return [...grupos.entries()].map(([r, membros]) => {
      membros.sort((a, b) => SEV[a.severity][0] - SEV[b.severity][0] || Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at));
      return { id: membros[0].id, principal: membros[0], membros, motivo: membros.length > 1 ? motivo.get(r) || null : null };
    });
  }
  const ORDEM = (g) => [g.membros.some((i) => i.voltou) ? 0 : 1, SEV[g.principal.severity][0], g.principal.assigned_to ? 1 : 0, Date.parse(g.principal.first_seen_at)];
  const ordenar = (gs) => gs.sort((a, b) => { const x = ORDEM(a), y = ORDEM(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k]; return 0; });

  // ------------------------------------------------------------- render
  function chipStatus(i) { const s = STATUS[i.status] || [i.status, 'neutral']; return DC.chip(s[0], s[1]); }
  const chipMud = (m) => `<span class="dc-ov-link-chip ${m.tipo}"><i data-lucide="${m.tipo === 'deploy' ? 'rocket' : 'database'}"></i>${m.tipo === 'deploy' ? `Deploy ${esc(m.ref)}` : esc(m.titulo.replace(/^migration_/, '').replace(/\.sql$/, ''))} · ${esc(m.delta >= 0 ? `${DCInvest.dur(m.delta)} antes` : 'junto')}</span>`;
  function cartao(g) {
    const i = g.principal;
    return `<article class="dc-ic-card ${SEV[i.severity][2]}" data-grupo="${esc(g.id)}" tabindex="0" role="button" aria-label="Abrir ${esc(i.title)}">
      <header>${DC.chip(SEV[i.severity][1], SEV[i.severity][2])}${chipStatus(i)}${i.voltou ? DC.chip(i.reaberturas > 1 ? `Voltou ${i.reaberturas}x` : 'Voltou', 'purple') : ''}${i.aindaDetectado ? DC.chip('Mitigado, mas ainda detectado', 'warn') : ''}<strong>${esc(i.title)}</strong></header>
      <p class="ctx">Aberto ${esc(quando(i.first_seen_at))} · última detecção ${esc(quando(i.last_seen_at))} · ${esc(i.occurrence_count)} leitura(s)${i.comp ? ` · ${esc(COMP_NOME[i.comp])}` : ''}${i.fluxos.length ? ` · fluxo ${esc(i.fluxos.map((f) => f.nome).join(', '))}` : ''}</p>
      ${g.membros.length > 1 ? `<p class="dc-ic-grupo"><i data-lucide="layers"></i>${g.membros.length} alertas agrupados: ${esc(g.motivo || 'relacionados')}</p>` : ''}
      ${i.perto.length ? `<div class="dc-ov-links">${i.perto.slice(0, 3).map(chipMud).join('')}</div>` : ''}
      <footer><span class="dc-ic-owner ${i.responsavel ? '' : 'none'}"><i data-lucide="user"></i>${esc(i.responsavel || 'Sem responsável')}</span></footer></article>`;
  }
  function linhaCompacta(g) {
    const i = g.principal;
    return `<button class="dc-ov-watch-row" data-grupo="${esc(g.id)}"><span class="dc-fn-dot ${i.status === 'resolved' ? 'ok' : 'warn'}"></span><span class="dc-ov-comp-main"><strong>${esc(i.title)}${g.membros.length > 1 ? ` (+${g.membros.length - 1})` : ''}</strong><small>${esc(STATUS[i.status]?.[0] || i.status)} ${esc(quando(i.status === 'resolved' ? i.resolved_at || i.updated_at : i.updated_at))}${i.responsavel ? ` · ${i.responsavel}` : ''}${i.voltou ? ' · já voltou antes' : ''}</small></span>${chipStatus(i)}</button>`;
  }

  function render() {
    const d = dados();
    const box = { acao: DC.$('icAcao'), acomp: DC.$('icAcomp'), resolv: DC.$('icResolv') };
    if (!d) {
      const msg = V.inc?.error || 'Não foi possível ler os incidentes.';
      box.acao.innerHTML = `<div class="dc-empty">${esc(msg)}</div>`; box.acomp.innerHTML = ''; box.resolv.innerHTML = ''; DC.$('icResumo').innerHTML = '';
      DC.setTopStatus('Incidentes indisponíveis', 'bad'); renderEstabilidade([]); return;
    }
    const todos = d.incidentes.map(enriquecer);
    const grupos = agrupar(todos.filter((i) => i.status !== 'resolved'));
    const acao = ordenar(grupos.filter((g) => g.membros.some(exigeAcao))), acomp = ordenar(grupos.filter((g) => !g.membros.some(exigeAcao)));
    const resolvidos = agrupar(todos.filter((i) => i.status === 'resolved')).sort((a, b) => Date.parse(b.principal.resolved_at || b.principal.updated_at) - Date.parse(a.principal.resolved_at || a.principal.updated_at));
    V.grupos = [...acao, ...acomp, ...resolvidos];
    const voltaram = todos.filter((i) => i.voltou).length, semDono = acao.filter((g) => !g.principal.assigned_to).length;
    DC.$('icResumo').innerHTML = [DC.chip(`${acao.length} exigem ação`, acao.length ? 'bad' : 'ok'), semDono ? DC.chip(`${semDono} sem responsável`, 'warn') : '', DC.chip(`${acomp.length} em acompanhamento`, acomp.length ? 'warn' : 'neutral'), DC.chip(`${resolvidos.length} resolvido(s) em ${d.dias} dias`, 'neutral'), voltaram ? DC.chip(`${voltaram} ${voltaram > 1 ? 'voltaram' : 'voltou'}`, 'purple') : ''].join('');
    box.acao.innerHTML = acao.length ? acao.map(cartao).join('') : '<div class="dc-ov-allclear"><i data-lucide="shield-check"></i><div><strong>Nenhum incidente exige ação</strong><p>Nada aberto de gravidade alta, nada que voltou. Os mitigados seguem em acompanhamento abaixo.</p></div></div>';
    box.acomp.innerHTML = acomp.length ? `<details class="dc-ov-watch"><summary><span>Em acompanhamento</span>${DC.chip(String(acomp.length), 'warn')}<small>Mitigados ou de menor gravidade: não pedem ação agora.</small></summary>${acomp.map(linhaCompacta).join('')}</details>` : '';
    box.resolv.innerHTML = resolvidos.length ? `<details class="dc-ov-watch"><summary><span>Resolvidos nos últimos ${d.dias} dias</span>${DC.chip(String(resolvidos.length), 'ok')}<small>Se voltarem, reabrem sozinhos e sobem para "Exigem ação".</small></summary>${resolvidos.map(linhaCompacta).join('')}</details>` : '';
    DC.setTopStatus(acao.length ? `${acao.length} incidente(s) exigem ação` : 'Nenhum incidente exige ação', acao.length ? 'bad' : 'ok');
    const nb = DC.$('navBadge-incidentes'); if (nb) { nb.textContent = acao.length; nb.style.display = acao.length ? 'inline-flex' : 'none'; }
    renderEstabilidade(todos);
    DC.$('lastRefresh').textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
    window.lucide?.createIcons();
  }

  // ------------------------------------------------------------- estabilidade (24 h e 7 dias)
  // Taxa de leituras OK dos testes gravados de cada componente, episódios de falha e incidentes.
  // Não é "uptime": é o que os testes viram nas vezes em que rodaram.
  function janelaTestes(ids, desde, ate) {
    const ps = ids.flatMap((id) => DCInvest.pontos(V.probeHist?.[`probe:${id}`]).filter((p) => p.t >= desde && p.t < ate));
    return { n: ps.length, ok: ps.filter((p) => p.ok).length, eps: ids.reduce((s, id) => s + DCInvest.episodios(V.probeHist?.[`probe:${id}`], desde).filter((e) => e.ini < ate).length, 0) };
  }
  const tomTaxa = (r) => (!r.n ? 'none' : r.ok / r.n >= 0.99 ? 'ok' : r.ok / r.n >= 0.9 ? 'warn' : 'bad');
  const taxa = (r) => (r.n ? `${((r.ok / r.n) * 100).toFixed(r.ok === r.n ? 0 : 1)}%` : '—');
  function renderEstabilidade(todos) {
    const el = DC.$('icEstab'), agora = Date.now();
    if (!V.probeHist) { el.innerHTML = `<div class="dc-empty">${esc(V.histErro || 'Histórico dos testes indisponível.')}</div>`; return; }
    const comps = ['app', 'admin', 'api', 'supabase', 'storage'];
    const linhas = comps.map((c) => {
      const ids = Object.keys(FONTES_TESTE_COMP).filter((k) => FONTES_TESTE_COMP[k] === c);
      const d1 = janelaTestes(ids, agora - DIA, agora), d7 = janelaTestes(ids, agora - 7 * DIA, agora);
      const dias = Array.from({ length: 7 }, (_, k) => { const ini = agora - (7 - k) * DIA; const r = janelaTestes(ids, ini, ini + DIA); return { r, ini }; });
      const incs = todos.filter((i) => i.comp === c && Date.parse(i.first_seen_at) >= agora - 7 * DIA), voltas = todos.filter((i) => i.comp === c).reduce((s, i) => s + i.reaberturas, 0);
      return { c, d1, d7, dias, incs: incs.length, voltas };
    });
    const muds = mudancas().filter((m) => m.t >= agora - 7 * DIA);
    const semLeitura = linhas.every((l) => !l.d7.n);
    el.innerHTML = semLeitura ? '<div class="dc-empty">Ainda não há leituras gravadas dos testes nos últimos 7 dias. Elas entram a cada varredura.</div>' : `<div class="dc-table-wrap"><table class="dc-compact-table dc-ic-estab"><thead><tr><th>Componente</th><th>24 h</th><th>7 dias</th><th>Dia a dia (7 dias)</th><th>Incidentes abertos em 7 d</th></tr></thead><tbody>${linhas.map((l) => `<tr><td><strong>${esc(COMP_NOME[l.c])}</strong></td>
      <td><span class="dc-ic-rate ${tomTaxa(l.d1)}">${taxa(l.d1)}</span><small>${l.d1.n} leitura(s)${l.d1.eps ? ` · ${l.d1.eps} falha(s)` : ''}</small></td>
      <td><span class="dc-ic-rate ${tomTaxa(l.d7)}">${taxa(l.d7)}</span><small>${l.d7.n} leitura(s)${l.d7.eps ? ` · ${l.d7.eps} falha(s)` : ''}</small></td>
      <td><span class="dc-ic-days">${l.dias.map((x) => `<i class="${tomTaxa(x.r)}" title="${esc(`${DC.dateFmt ? DC.dateFmt.format(new Date(x.ini)) : new Date(x.ini).toLocaleDateString('pt-BR')}: ${x.r.n ? `${taxa(x.r)} de ${x.r.n} leituras OK` : 'sem leituras'}`)}"></i>`).join('')}</span></td>
      <td>${l.incs ? DC.chip(`${l.incs} incidente(s)`, 'warn') : '<span class="dc-muted">nenhum</span>'}${l.voltas ? ` ${DC.chip(`voltou ${l.voltas}x`, 'purple')}` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="dc-ov-p dc-muted" style="margin-top:8px">Percentual de leituras OK dos testes de cada componente (não é uptime: só vale para os momentos em que os testes rodaram). Nos últimos 7 dias: ${muds.filter((m) => m.tipo === 'deploy').length} deploy(s) de produção e ${muds.filter((m) => m.tipo === 'migration').length} migration(s) na main.</p>`;
  }

  // ------------------------------------------------------------- drawer
  function chaveVisaoGeral(i) { const fp = String(i.fingerprint || ''); return fp.startsWith('problem:') ? fp.slice(8) : fp; }
  function linhaDoTempoGrupo(g) {
    const i = g.principal, ctx = { mudancas: mudancas(), series: V.probeHist || {}, retestes: new Map(), agora: Date.now(),
      historico: { eventos: g.membros.flatMap((m) => m.ev.map((e) => ({ ...e, message: m.id === i.id ? e.message : `${m.title}: ${e.message || e.event_type}` }))).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) } };
    const alvo = { ancora: i.first_seen_at, ultima: i.last_seen_at, testes: [...new Set(g.membros.flatMap((m) => m.testes))], diag: { perto: i.perto }, amostras: [] };
    return DCInvest.linhaDoTempo(alvo, ctx);
  }
  function resumoTexto(g, tl) {
    const i = g.principal;
    return [`## [${SEV[i.severity][1]}] ${i.title}`,
      [`- **Status:** ${STATUS[i.status]?.[0] || i.status}${i.aindaDetectado ? ' (mitigado, mas ainda detectado)' : ''}`, `- **Responsável:** ${i.responsavel || 'ninguém'}`, `- **Aberto:** ${DC.dateTimeFmt.format(new Date(i.first_seen_at))} · **última detecção:** ${DC.dateTimeFmt.format(new Date(i.last_seen_at))} · ${i.occurrence_count} leitura(s)`, i.voltou ? `- **Recorrência:** voltou ${i.reaberturas || 1}x` : null, i.comp ? `- **Componente:** ${COMP_NOME[i.comp]}` : null, i.fluxos.length ? `- **Fluxo:** ${i.fluxos.map((f) => f.nome).join(', ')}` : null, i.perto.length ? `- **Mudanças perto do início:** ${i.perto.map((m) => `${m.tipo === 'deploy' ? `deploy ${m.ref}` : m.titulo} (${DCInvest.dur(m.delta)} antes)`).join('; ')}` : null].filter(Boolean).join('\n'),
      g.membros.length > 1 ? `### Alertas agrupados (${g.motivo || 'relacionados'})\n${g.membros.map((m) => `- ${m.title} — ${STATUS[m.status]?.[0] || m.status}`).join('\n')}` : null,
      tl.length ? `### Linha do tempo\n${tl.slice(-15).map((e) => `- ${DC.dateTimeFmt.format(new Date(e.t))} — ${e.txt}`).join('\n')}` : null,
      `_Gerado pela Central de Incidentes do Dev Console em ${new Date().toLocaleString('pt-BR')}._`].filter(Boolean).join('\n\n');
  }

  function abrir(grupoId, opts = {}) {
    const g = (V.grupos || []).find((x) => x.id === grupoId || x.membros.some((m) => m.id === grupoId)); if (!g) return;
    const i = g.principal, d = dados(), pode = Boolean(d?.podeGerenciar), tl = linhaDoTempoGrupo(g);
    const ev = (d?.evidencias || {})[i.id] || [];
    const situacao = i.aindaDetectado ? `<div class="dc-warn-box">Marcado como mitigado ${esc(quando(i.manual.em))}, mas a varredura continua detectando (última vez ${esc(quando(i.last_seen_at))}). Confira se a mitigação funcionou.</div>`
      : i.status === 'reopened' ? `<div class="dc-critical-box"><b>Este problema voltou.</b> ${i.reaberturas ? `Reaberto ${i.reaberturas}x nos últimos ${d.dias} dias.` : ''} Veja na linha do tempo quando ele tinha sido dado como resolvido ou mitigado.</div>`
        : i.status === 'resolved' ? `<div class="dc-ok-box">Resolvido ${esc(quando(i.resolved_at))}. Se a varredura voltar a detectar, ele reabre sozinho.</div>` : '';
    const acoes = pode ? `<div class="dc-ic-actions">
        <div class="dc-ic-status" role="group" aria-label="Mudar status">${['investigating', 'mitigated', 'resolved'].map((s) => `<button class="dc-btn${i.status === s ? ' primary' : ''}" data-status="${s}">${STATUS[s][0]}</button>`).join('')}</div>
        <textarea id="icNota" maxlength="500" rows="2" placeholder="Nota (opcional no status): o que foi feito, o que falta, onde olhar…"></textarea>
        <div class="dc-ic-row"><label class="dc-ic-check"><input type="checkbox" id="icGrupo" ${g.membros.length > 1 ? 'checked' : 'disabled'}> Aplicar aos ${g.membros.length} alerta(s) do grupo</label><button class="dc-btn" data-nota><i data-lucide="message-square"></i>Adicionar nota</button></div>
        <div class="dc-ic-row"><label for="icDono">Responsável</label><select id="icDono"><option value="">Sem responsável</option>${(d.responsaveis || []).map((u) => `<option value="${esc(u.id)}"${u.id === i.assigned_to ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>${d.eu && d.eu !== i.assigned_to ? '<button class="dc-btn" data-assumir>Assumir</button>' : ''}</div>
      </div>` : '<div class="dc-note">Seu perfil só visualiza. Mudar status e responsável exige a permissão de gerenciar incidentes.</div>';
    const cmpBtn = (m) => `<button class="dc-btn" data-cmp="${m.tipo}:${m.t}">Antes x depois de ${esc(m.tipo === 'deploy' ? `deploy ${m.ref}` : m.titulo.replace(/\.sql$/, ''))}</button>`;
    const ov = DC.openDrawer(i.title, `<div class="dc-ov-drawer-head">${DC.chip(SEV[i.severity][1], SEV[i.severity][2])}${chipStatus(i)}${i.voltou ? DC.chip(i.reaberturas > 1 ? `Voltou ${i.reaberturas}x` : 'Voltou', 'purple') : ''}<span class="dc-ic-owner ${i.responsavel ? '' : 'none'}"><i data-lucide="user"></i>${esc(i.responsavel || 'Sem responsável')}</span></div>
      <p class="dc-ov-p dc-muted">Aberto ${esc(DC.dateTimeFmt.format(new Date(i.first_seen_at)))} (${esc(quando(i.first_seen_at))}) · última detecção ${esc(quando(i.last_seen_at))} · ${esc(i.occurrence_count)} leitura(s) · origem: ${esc(i.source === 'problems' ? 'Central de Problemas' : 'Infraestrutura')}</p>
      ${situacao}
      <h3 class="dc-nc-h">Acompanhamento</h3>${acoes}
      <h3 class="dc-nc-h">Relacionado a</h3><div class="dc-list">
        <div class="dc-row" style="grid-template-columns:120px 1fr"><span>Componente</span><b>${i.comp ? esc(COMP_NOME[i.comp]) : '—'}</b></div>
        <div class="dc-row" style="grid-template-columns:120px 1fr"><span>Fluxo</span><b>${i.fluxos.length ? esc(i.fluxos.map((f) => f.nome).join(', ')) : '—'}</b></div>
        <div class="dc-row" style="grid-template-columns:120px 1fr"><span>Testes</span><b>${i.testes.length ? esc(i.testes.map((t) => DCInvest.PROBE_NOME[t] || t).join(', ')) : '—'}</b></div>
        <div class="dc-row" style="grid-template-columns:120px 1fr"><span>Mudanças perto do início</span><b>${i.perto.length ? i.perto.map(chipMud).join(' ') : V.changes ? 'nenhum deploy ou migration nas 6 h antes' : 'GitHub/Vercel indisponível'}</b></div>
      </div>
      ${i.perto.length ? `<div class="dc-ic-row" style="margin-top:8px">${i.perto.slice(0, 2).map(cmpBtn).join('')}</div><div id="icCmp"></div>` : ''}
      ${g.membros.length > 1 ? `<h3 class="dc-nc-h">Alertas agrupados</h3><p class="dc-ov-p dc-muted">Motivo: ${esc(g.motivo || 'relacionados')}. Tratados como um incidente só.</p><div class="dc-ov-watch-list">${g.membros.map((m) => `<div class="dc-ov-watch-row"><span class="dc-fn-dot ${SEV[m.severity][2] === 'bad' ? 'bad' : 'warn'}"></span><span class="dc-ov-comp-main"><strong>${esc(m.title)}</strong><small>Aberto ${esc(quando(m.first_seen_at))}${m.comp ? ` · ${COMP_NOME[m.comp]}` : ''}</small></span>${chipStatus(m)}</div>`).join('')}</div>` : ''}
      ${ev.length ? `<h3 class="dc-nc-h">Evidências registradas</h3><div class="dc-list">${ev.slice(0, 8).map((e) => `<div class="dc-row" style="grid-template-columns:minmax(90px,.4fr) 1fr"><span>${esc(e.label)}</span><b class="dc-ov-evid">${esc(e.valor)}</b></div>`).join('')}</div>` : ''}
      <h3 class="dc-nc-h">Linha do tempo</h3>${DCInvest.linhaDoTempoHtml(tl)}
      ${!V.probeHist ? '<p class="dc-ov-p dc-muted">Histórico dos testes indisponível: falhas e recuperações dos testes não aparecem.</p>' : ''}`,
      { footer: `<button class="dc-btn" data-copy><i data-lucide="clipboard-list"></i>Copiar resumo</button>${i.status !== 'resolved' ? `<a class="dc-btn primary" href="visao-geral.html?investigar=${encodeURIComponent(chaveVisaoGeral(i))}">Investigar com checklist</a>` : ''}` });
    ov.querySelector('.dc-drawer')?.classList.add('wide');
    if (opts.scroll) ov.querySelector('.dc-drawer-body').scrollTop = opts.scroll;
    ov.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(resumoTexto(g, tl)); DC.toast('Resumo copiado (Markdown).'); } catch { DC.toast('Não foi possível copiar neste navegador.', true); } };
    const alvos = () => (ov.querySelector('#icGrupo')?.checked ? g.membros.map((m) => m.id) : [i.id]);
    const enviar = async (btn, body, msg) => {
      const r = await DC.action(btn, () => DC.api('/api/incidentes', { method: 'POST', body, timeout: 30000 }), { success: msg });
      if (r?.ok) { const scroll = ov.querySelector('.dc-drawer-body')?.scrollTop || 0; await carregar(); render(); abrir(i.id, { scroll }); }
    };
    ov.addEventListener('click', async (e) => {
      const s = e.target.closest('[data-status]');
      if (s) {
        const para = s.dataset.status; if (para === i.status) return;
        const nota = ov.querySelector('#icNota')?.value || '';
        if (para === 'resolved' && !await DC.modal('Marcar como resolvido', `<p class="dc-ov-p">${alvos().length} incidente(s) serão marcados como resolvidos. Isso muda só o acompanhamento; se a varredura voltar a detectar, eles reabrem sozinhos e aparecem como "Voltou".</p>`, { confirmText: 'Marcar resolvido' })) return;
        return enviar(s, { ids: alvos(), acao: 'status', status: para, nota }, `Status: ${STATUS[para][0]}.`);
      }
      if (e.target.closest('[data-nota]')) { const nota = ov.querySelector('#icNota')?.value.trim(); if (!nota) { DC.toast('Escreva a nota primeiro.', true); return; } return enviar(e.target.closest('[data-nota]'), { ids: alvos(), acao: 'nota', nota }, 'Nota registrada.'); }
      if (e.target.closest('[data-assumir]')) return enviar(e.target.closest('[data-assumir]'), { ids: alvos(), acao: 'responsavel', usuario: d.eu }, 'Você é o responsável.');
      const c = e.target.closest('[data-cmp]');
      if (c) {
        const [tipo, t] = c.dataset.cmp.split(':'), m = mudancas().find((x) => x.tipo === tipo && x.t === Number(t)); if (!m) return;
        const ctx = { mudancas: mudancas(), series: V.probeHist || {}, eventos: null };
        ov.querySelector('#icCmp').innerHTML = V.probeHist ? DCInvest.tabelaComparacao(DCInvest.compararMudanca(m, ctx, i.testes.length ? [...new Set(g.membros.flatMap((x) => x.testes))] : undefined)) : '<div class="dc-empty">Histórico dos testes indisponível.</div>';
        window.lucide?.createIcons();
      }
    });
    ov.querySelector('#icDono')?.addEventListener('change', (e) => enviar(e.target, { ids: alvos(), acao: 'responsavel', usuario: e.target.value || null }, e.target.value ? 'Responsável definido.' : 'Responsável removido.'));
  }

  async function atualizar() {
    if (!await DC.guard()) return;
    DC.setTopStatus('Atualizando…', 'warn');
    await carregar();
    render();
    const alvo = decodeURIComponent(location.hash.slice(1) || '');
    if (alvo && !document.querySelector('.dc-overlay')) { const g = (V.grupos || []).find((x) => x.membros.some((m) => m.id === alvo || m.fingerprint === alvo)); if (g) abrir(g.id); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    DC.$('refreshBtn').onclick = atualizar;
    DC.$('icDias').onchange = (e) => { S.dias = Number(e.target.value) || 7; atualizar(); };
    const abrirDe = (e) => { const b = e.target.closest('[data-grupo]'); if (b) abrir(b.dataset.grupo); };
    for (const id of ['icAcao', 'icAcomp', 'icResolv']) { DC.$(id).addEventListener('click', abrirDe); DC.$(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') abrirDe(e); }); }
    atualizar();
    DC.poll(() => { if (!document.querySelector('.dc-overlay')) atualizar(); }, 120000);
  });
})();
