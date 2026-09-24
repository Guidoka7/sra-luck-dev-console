(() => {
  // Investigação guiada: checklist por tipo de falha, comparação antes x depois de mudanças,
  // linha do tempo única do incidente e relatório técnico. Só lê dados que o painel já tem
  // (testes, histórico gravado, eventos de erro, deploys, migrations, eventos do incidente).
  // Nada aqui corrige produção: as ações são retestar, abrir uma página ou copiar o relatório.
  const H = 3600000;
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const fmtMs = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(v)} ms`);
  const fmtPct = (v) => `${Math.round(v * 100)}%`;
  const hora = (t) => DC.dateTimeFmt.format(new Date(t));
  const horaSP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const horaCurta = (iso) => horaSP.format(new Date(iso));
  const falhaTxt = (f) => `${f.status ? `HTTP ${f.status}` : 'sem resposta'}${f.erro && f.erro !== `HTTP ${f.status}` ? ` (${f.erro})` : ''}`;
  const dur = (v) => { const m = Math.max(1, Math.round(Math.abs(v) / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} dias`; };
  const mediana = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b), k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

  // Testes gravados a cada varredura (até 16 séries por consulta; "erros" fica de fora por ser o próprio registro).
  const PROBES = ['ready', 'diagnostico', 'storage', 'visaoGeral', 'configuracoes', 'staff', 'v46', 'previsoes', 'validacoes', 'financeiroResumo', 'app', 'clube', 'recompensas', 'notificacoes', 'vapid', 'integracoes'];
  const PROBE_NOME = { ready: 'Prontidão da API', diagnostico: 'Diagnóstico do banco', storage: 'Storage', visaoGeral: 'Visão geral do Admin', configuracoes: 'Configurações', staff: 'Equipe', v46: 'Jornada V46', previsoes: 'Previsão de liberações', validacoes: 'Validações financeiras', financeiroResumo: 'Resumo financeiro', app: 'App da cliente', clube: 'Clube', recompensas: 'Recompensas', notificacoes: 'Notificações', vapid: 'Web Push', integracoes: 'Integrações' };
  const pontos = (serie) => (serie || []).map((p) => ({ t: Date.parse(p.observed_at), v: Number(p.metric_value), ok: p.state !== 'critical', status: p.dimensions?.status ?? null, manual: Boolean(p.dimensions?.manual) })).filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);

  // ------------------------------------------------------------- antes x depois
  // A janela de cada lado vai até 24 h, mas para na mudança vizinha: assim o "depois" de um deploy
  // não mistura o efeito do deploy seguinte.
  // Só deploy muda o que roda em produção: a janela de um deploy é limitada pelos deploys vizinhos;
  // a de uma migration (horário do commit na main) por qualquer mudança vizinha.
  function janela(m, todas, agora = Date.now()) {
    const outras = todas.filter((x) => !(x.tipo === m.tipo && x.t === m.t) && (m.tipo !== 'deploy' || x.tipo === 'deploy')).map((x) => x.t);
    const prev = Math.max(-Infinity, ...outras.filter((t) => t < m.t)), next = Math.min(Infinity, ...outras.filter((t) => t > m.t));
    return { antesIni: Math.max(m.t - 24 * H, prev), antesFim: m.t, depoisIni: m.t, depoisFim: Math.min(m.t + 24 * H, next, agora) };
  }
  function compararTeste(serie, j) {
    const ps = pontos(serie), A = ps.filter((p) => p.t >= j.antesIni && p.t < j.antesFim), D = ps.filter((p) => p.t > j.depoisIni && p.t <= j.depoisFim);
    const lado = (xs) => ({ n: xs.length, falhas: xs.filter((p) => !p.ok).length, taxa: xs.length ? xs.filter((p) => !p.ok).length / xs.length : null, med: mediana(xs.filter((p) => p.ok).map((p) => p.v)) });
    const a = lado(A), d = lado(D);
    if (a.n < 2 || d.n < 2) return { a, d, veredito: 'sem_dados', texto: `Leituras insuficientes (${a.n} antes, ${d.n} depois; mínimo 2 de cada lado).` };
    if (a.taxa <= 0.2 && d.taxa >= 0.5) return { a, d, veredito: 'regressao', texto: `Passou a falhar: ${fmtPct(a.taxa)} → ${fmtPct(d.taxa)} das leituras com erro.` };
    if (a.taxa >= 0.5 && d.taxa <= 0.2) return { a, d, veredito: 'melhora', texto: `Voltou a responder: ${fmtPct(a.taxa)} → ${fmtPct(d.taxa)} das leituras com erro.` };
    if (a.med != null && d.med != null && d.med >= a.med * 1.5 && d.med - a.med >= 300) return { a, d, veredito: 'regressao', texto: `Ficou mais lento: mediana ${fmtMs(a.med)} → ${fmtMs(d.med)}.` };
    if (a.med != null && d.med != null && a.med >= d.med * 1.5 && a.med - d.med >= 300) return { a, d, veredito: 'melhora', texto: `Ficou mais rápido: mediana ${fmtMs(a.med)} → ${fmtMs(d.med)}.` };
    return { a, d, veredito: 'estavel', texto: 'Sem mudança relevante.' };
  }
  // Erros registrados (App/Admin/API) por hora. Só compara se os eventos carregados cobrem a janela inteira.
  function compararErros(eventos, filtro, j, coberturaDesde) {
    if (coberturaDesde != null && coberturaDesde > j.antesIni) return { veredito: 'sem_dados', texto: `Os eventos carregados só vão até ${hora(coberturaDesde)}; o período anterior não está coberto.` };
    const conta = (ini, fim) => eventos.filter((e) => { const t = Date.parse(e.criado_em); return t >= ini && t < fim && filtro(e); }).length;
    const ha = (j.antesFim - j.antesIni) / H, hd = (j.depoisFim - j.depoisIni) / H;
    if (ha < 1 || hd < 1) return { veredito: 'sem_dados', texto: `Janela curta demais (${dur(j.antesFim - j.antesIni)} antes, ${dur(j.depoisFim - j.depoisIni)} depois).` };
    const ca = conta(j.antesIni, j.antesFim), cd = conta(j.depoisIni, j.depoisFim), ra = ca / ha, rd = cd / hd;
    const base = { a: { n: ca, taxaHora: ra }, d: { n: cd, taxaHora: rd } };
    if (cd >= 5 && rd >= 2 * ra && rd - ra >= 0.2) return { ...base, veredito: 'regressao', texto: `Mais erros: ${ra.toFixed(1)}/h → ${rd.toFixed(1)}/h (${ca} → ${cd}).` };
    if (ca >= 5 && ra >= 2 * rd && ra - rd >= 0.2) return { ...base, veredito: 'melhora', texto: `Menos erros: ${ra.toFixed(1)}/h → ${rd.toFixed(1)}/h (${ca} → ${cd}).` };
    return { ...base, veredito: 'estavel', texto: `${ra.toFixed(1)}/h → ${rd.toFixed(1)}/h (${ca} → ${cd}).` };
  }
  // ctx: { mudancas, series: {probeId: pontos crus}, eventos, coberturaDesde, areaDoEvento }
  function compararMudanca(m, ctx, soTestes, soAreas) {
    const j = janela(m, ctx.mudancas);
    const linhas = [];
    for (const id of soTestes || PROBES) {
      if (!ctx.series?.[`probe:${id}`]) continue;
      const r = compararTeste(ctx.series[`probe:${id}`], j);
      if (soTestes || r.a.n || r.d.n) linhas.push({ chave: `probe:${id}`, nome: `Teste · ${PROBE_NOME[id] || id}`, ...r, antes: r.a.n ? `${r.a.med != null ? fmtMs(r.a.med) : '—'} · ${r.a.falhas}/${r.a.n} falhas` : '—', depois: r.d.n ? `${r.d.med != null ? fmtMs(r.d.med) : '—'} · ${r.d.falhas}/${r.d.n} falhas` : '—' });
    }
    if (ctx.eventos) for (const area of soAreas || ['App da cliente', 'Admin', 'API e rotinas']) {
      const r = compararErros(ctx.eventos, (e) => ctx.areaDoEvento(e) === area, j, ctx.coberturaDesde);
      linhas.push({ chave: `erros:${area}`, nome: `Erros · ${area}`, ...r, antes: r.a ? `${r.a.n} (${r.a.taxaHora.toFixed(1)}/h)` : '—', depois: r.d ? `${r.d.n} (${r.d.taxaHora.toFixed(1)}/h)` : '—' });
    }
    return { mudanca: m, janela: j, linhas, regressoes: linhas.filter((l) => l.veredito === 'regressao'), melhoras: linhas.filter((l) => l.veredito === 'melhora'), cedo: j.depoisFim - j.depoisIni < H };
  }
  const VEREDITO = { regressao: ['Regressão', 'bad'], melhora: ['Melhorou', 'ok'], estavel: ['Estável', 'neutral'], sem_dados: ['Sem dados', 'neutral'] };
  function tabelaComparacao(c) {
    const j = c.janela;
    return `<p class="dc-ov-p dc-muted">Antes: ${esc(hora(j.antesIni))} → ${esc(hora(j.antesFim))} (${esc(dur(j.antesFim - j.antesIni))}) · Depois: ${esc(hora(j.depoisIni))} → ${esc(hora(j.depoisFim))} (${esc(dur(j.depoisFim - j.depoisIni))}). Mediana de tempo das leituras OK; falhas = leituras com erro.</p>
      ${c.cedo ? '<div class="dc-warn-box">Menos de 1 h de dados depois da mudança: cedo para concluir.</div>' : ''}
      ${c.linhas.length ? `<div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Métrica</th><th>Antes</th><th>Depois</th><th>Resultado</th></tr></thead><tbody>${c.linhas.map((l) => `<tr${l.veredito === 'regressao' ? ' class="dc-ov-reg"' : ''}><td>${esc(l.nome)}</td><td>${esc(l.antes)}</td><td>${esc(l.depois)}</td><td>${DC.chip(VEREDITO[l.veredito][0], VEREDITO[l.veredito][1])}<small class="dc-ov-cmp-txt">${esc(l.texto)}</small></td></tr>`).join('')}</tbody></table></div>` : '<div class="dc-empty">Ainda não há leituras gravadas em volta desta mudança.</div>'}`;
  }

  // ------------------------------------------------------------- recorrência e transições
  function episodios(serie, desde) {
    const ps = pontos(serie).filter((p) => p.t >= desde), out = [];
    let atual = null;
    for (const p of ps) {
      if (!p.ok && !atual) atual = { ini: p.t, status: p.status, fim: null };
      else if (p.ok && atual) { atual.fim = p.t; out.push(atual); atual = null; }
    }
    if (atual) out.push(atual);
    return out;
  }

  // ------------------------------------------------------------- checklist
  function tipoFalha(i) {
    const k = String(i.key || ''), s = i.http == null ? null : Number(i.http) || 0;
    if (k === 'deploy') return 'deploy';
    if (k === 'sync') return 'sync';
    if (k === 'ci') return 'ci';
    if (k.startsWith('regressao:')) return 'regressao';
    if (k.startsWith('plataforma:diagnostico') || (k.startsWith('infra:supabase') && i.origem === 'infra')) return 'banco';
    if (k === 'plataforma:storage' || k.startsWith('infra:storage')) return 'storage';
    if (i.origem === 'infra') return 'recurso';
    if (s === 401 || s === 403) return 'acesso';
    if (s === 404) return 'rota';
    if (s === 0) return 'timeout';
    if (s >= 500) return 'servidor';
    if (k.startsWith('bug:') || k.startsWith('app:desempenho')) return 'tela';
    return 'operacional';
  }
  const TIPO_NOME = { servidor: 'Erro no servidor (5xx)', acesso: 'Acesso negado (401/403)', rota: 'Rota não encontrada (404)', timeout: 'Sem resposta / timeout', banco: 'Banco de dados', storage: 'Storage de arquivos', recurso: 'Recurso de infraestrutura', deploy: 'Deploy com falha', sync: 'Produção desatualizada', ci: 'CI falhou', tela: 'Erro de tela / desempenho no app', operacional: 'Pendência operacional', regressao: 'Regressão após mudança' };

  // ctx: { byId, deps, fontes, ready, changes, signal, retestes, comparacao, agora }
  function passos(i, ctx) {
    const teste = (i.testes || [])[0], fonte = teste ? ctx.fontes.find((f) => f.id === teste) : null, rt = teste ? ctx.retestes.get(teste) : null;
    const reteste = () => ({
      titulo: 'O erro continua agora?', porque: 'Separa falha intermitente de falha persistente antes de investigar mais fundo.',
      ...(rt ? (rt.ok ? { estado: 'ok', detalhe: `Reteste às ${horaCurta(rt.testadoEm)}: respondeu OK em ${fmtMs(rt.ms)}. Pode ter sido intermitente; acompanhe a recorrência.` } : { estado: 'falhou', detalhe: `Reteste às ${horaCurta(rt.testadoEm)}: ${falhaTxt(rt)}. A falha é persistente.` })
        : fonte ? { estado: fonte.naoConfigurado ? 'sem_dados' : fonte.ok ? 'ok' : 'atencao', detalhe: fonte.naoConfigurado ? 'Conector não configurado: não dá para testar daqui.' : `Última varredura: ${fonte.ok ? `OK em ${fmtMs(fonte.ms)}` : `HTTP ${fonte.status || 'sem resposta'}`}. Reteste para confirmar agora.` }
          : { estado: 'sem_dados', detalhe: 'Sem teste associado.' }),
      acao: teste && !fonte?.naoConfigurado ? { tipo: 'reteste', teste, label: `Retestar ${PROBE_NOME[teste] || teste}` } : null,
    });
    const deps = () => {
      const ds = (ctx.deps[i.comp] || []).map((id) => ctx.byId[id]).filter(Boolean), ruim = ds.filter((d) => d.tone === 'bad');
      return { titulo: 'As dependências estão saudáveis?', porque: 'Se a API ou o banco estão com falha, o sintoma aparece em tudo que depende deles.',
        estado: !ds.length ? 'sem_dados' : ruim.length ? 'falhou' : 'ok', detalhe: !ds.length ? 'Sem dependências mapeadas para este item.' : ruim.length ? `${ruim.map((d) => d.nome).join(', ')} com falha: comece por ${ruim.length > 1 ? 'eles' : 'ele'}.` : `${ds.map((d) => `${d.nome}: ${d.tone === 'ok' ? 'normal' : d.tone === 'warn' ? 'atenção' : 'sem dados'}`).join(' · ')}.` };
    };
    const deploy = () => {
      const d = i.diag.perto.find((m) => m.tipo === 'deploy');
      return { titulo: 'Começou depois de um deploy?', porque: 'A maioria das falhas novas vem da última publicação.',
        estado: !i.ancora ? 'sem_dados' : d ? 'atencao' : 'ok', detalhe: !i.ancora ? 'O início não está registrado; use a linha do tempo abaixo.' : d ? `Sim: deploy ${d.ref} ("${d.titulo}") ${dur(d.delta)} antes do início.` : 'Nenhum deploy de produção nas 6 h antes do início.' };
    };
    const antesDepois = () => {
      const c = ctx.comparacao;
      if (!c) return { titulo: 'Piorou depois da mudança suspeita?', porque: 'Compara as leituras gravadas antes e depois da mudança.', estado: 'sem_dados', detalhe: 'Nenhuma mudança suspeita para comparar.' };
      const nome = c.mudanca.tipo === 'deploy' ? `deploy ${c.mudanca.ref}` : c.mudanca.titulo;
      const reg = c.regressoes[0], sem = c.linhas.every((l) => l.veredito === 'sem_dados');
      return { titulo: `Piorou depois do ${c.mudanca.tipo === 'deploy' ? 'deploy' : 'migration'}?`, porque: 'Confirma com números se a mudança suspeita realmente mudou o comportamento.',
        estado: sem ? 'sem_dados' : reg ? 'falhou' : 'ok', detalhe: sem ? `Ainda não há leituras suficientes em volta de ${nome}.` : reg ? `${reg.nome}: ${reg.texto}` : `Nada piorou depois de ${nome} nas métricas com dados.`, acao: { tipo: 'comparar', label: 'Ver antes x depois' } };
    };
    const migration = () => {
      const m = i.diag.perto.find((x) => x.tipo === 'migration');
      return { titulo: 'Alguma migration recente pode faltar no banco?', porque: 'Código publicado que espera coluna ou tabela nova quebra se a migration não foi aplicada.',
        estado: m ? 'manual' : 'ok', detalhe: m ? `${m.titulo} entrou na main ${dur(m.delta)} antes do início. Confira no Supabase (SQL Editor ou Table Editor) se a coluna/tabela dela existe.` : 'Nenhuma migration na main nas 6 h antes do início.' };
    };
    const logs = () => ({ titulo: 'O que diz a exceção nos logs?', porque: 'O log mostra a linha exata que quebrou.', estado: 'manual',
      detalhe: `Vercel → projeto sra-luck-react → Logs, filtrando por ${fonte?.path || 'a rota afetada'}${i.ancora ? ` a partir de ${hora(Date.parse(i.ancora))}` : ''}${i.requestIds?.length ? `; request IDs: ${i.requestIds.slice(0, 3).join(', ')}` : ''}.`, acao: { tipo: 'link', href: 'engenharia.html', label: 'Abrir Engenharia' } });
    const sync = () => {
      const s = ctx.changes?.sincronia;
      return { titulo: 'A produção roda o código da main?', porque: 'Rota ou correção que existe só na main ainda não chegou às clientes.',
        estado: !s || s.estado === 'desconhecido' ? 'sem_dados' : s.estado === 'sincronizado' ? 'ok' : 'atencao', detalhe: !s ? 'GitHub/Vercel indisponível agora.' : s.estado === 'sincronizado' ? 'Sim, produção = main.' : s.estado === 'producao_atras' ? `Não: produção ${s.commitsAtras} commit(s) atrás.` : s.motivo || 'Produção roda um commit fora da main.' };
    };
    const outrasFuncoes = () => {
      const ativas = ctx.fontes.filter((f) => !f.naoConfigurado), negadas = ativas.filter((f) => f.status === 401 || f.status === 403);
      return { titulo: 'Outras funções do conector respondem?', porque: 'Tudo negado = token; só esta rota negada = permissão ou allowlist.',
        estado: !ativas.length ? 'sem_dados' : negadas.length === ativas.length ? 'falhou' : 'atencao', detalhe: !ativas.length ? 'Conector não configurado.' : negadas.length === ativas.length ? `Todas as ${ativas.length} funções negadas: o token do conector não confere.` : `${ativas.length - negadas.length} de ${ativas.length} respondem: o token funciona; o problema é a permissão desta rota.` };
    };
    const allowlist = () => ({ titulo: 'A rota está liberada para o Dev Console?', porque: 'O Sra Luck só aceita do conector as rotas da allowlist.', estado: 'manual', detalhe: `No sra-luck-react, confira ALLOWED_READ_EXACT e ALLOWED_READ_PREFIXES em worker/dev-console-auth.ts${fonte ? ` para ${fonte.path}` : ''}.` });
    const token = () => ({ titulo: 'O token é o mesmo nos dois projetos?', porque: 'Token diferente derruba todas as leituras.', estado: 'manual', detalhe: 'SRA_LUCK_SERVICE_TOKEN (Dev Console) deve ser igual a DEV_CONSOLE_SERVICE_TOKEN (Sra Luck), nas variáveis da Vercel.', acao: { tipo: 'link', href: 'conexoes.html', label: 'Abrir Conexões' } });
    const ready = () => ({ titulo: 'A API responde à prontidão?', porque: 'Se /api/ready falha, o problema é a API inteira, não esta função.',
      estado: !ctx.ready ? 'sem_dados' : ctx.ready.ok ? 'ok' : 'falhou', detalhe: !ctx.ready ? 'Sem leitura.' : ctx.ready.ok ? `Sim, em ${fmtMs(ctx.ready.ms)}.` : `Não: HTTP ${ctx.ready.status || 'sem resposta'}.`, acao: { tipo: 'reteste', teste: 'ready', label: 'Retestar prontidão' } });
    const recursos = () => {
      const ss = ['cpu_usage_percent', 'memory_usage_percent', 'disk_usage_percent'].map((k) => ctx.signal('supabase', k)).filter(Boolean), alto = ss.filter((x) => x.state === 'warning' || x.state === 'critical');
      return { titulo: 'CPU, RAM e disco do banco estão normais?', porque: 'Banco no limite deixa tudo lento ou derruba consultas.',
        estado: !ss.length ? 'sem_dados' : alto.length ? 'falhou' : 'ok', detalhe: !ss.length ? 'Métricas do Supabase não configuradas.' : ss.map((x) => `${x.label || x.key}: ${Math.round(x.value)}%`).join(' · ') + (alto.length ? ' (acima do alerta)' : '') };
    };
    const ciCommit = (sha, rotulo) => {
      const run = (ctx.changes?.runs || []).find((r) => r.head_sha && sha && r.head_sha.startsWith(String(sha).slice(0, 7)));
      return { titulo: `O CI ${rotulo} passou?`, porque: 'Código que não passou nos testes não deve ir para produção.',
        estado: !run ? 'sem_dados' : run.status !== 'completed' ? 'atencao' : run.conclusion === 'success' ? 'ok' : 'falhou', detalhe: !run ? 'Nenhuma execução de CI encontrada para esse commit entre as 10 últimas.' : run.status !== 'completed' ? `"${run.name}" ainda rodando.` : `"${run.name}": ${run.conclusion}.` };
    };
    const recente = () => ({ titulo: 'Ainda está acontecendo?', porque: 'Erro que parou pode ter sido corrigido por um deploy posterior.',
      estado: !i.ultima ? 'sem_dados' : ctx.agora - Date.parse(i.ultima) <= H ? 'falhou' : 'ok', detalhe: !i.ultima ? 'Sem registro da última ocorrência.' : `Última ocorrência ${DC.relTime(i.ultima)}${ctx.agora - Date.parse(i.ultima) > H ? ': parou há mais de 1 h.' : '.'}` });
    const manual = (titulo, detalhe, acao) => ({ titulo, porque: '', estado: 'manual', detalhe, acao });
    const reverificar = () => ({ titulo: 'A pendência ainda existe?', porque: 'Os dados mudam conforme a equipe trabalha.', estado: 'atencao', detalhe: 'Detectado na última leitura da Central. Depois de resolver na tela, reverifique.', acao: { tipo: 'reverificar', label: 'Reverificar problemas' } });

    const t = tipoFalha(i);
    const lista = {
      servidor: [reteste, deps, deploy, antesDepois, migration, logs],
      acesso: [reteste, outrasFuncoes, allowlist, token],
      rota: [reteste, sync, deploy, () => manual('A rota foi renomeada ou removida?', 'Veja os últimos commits da main em Engenharia e procure a rota no código do sra-luck-react.', { tipo: 'link', href: 'engenharia.html', label: 'Abrir Engenharia' })],
      timeout: [reteste, ready, recursos, deploy, logs],
      banco: [reteste, recursos, migration, deploy, () => manual('O que dizem os logs do Postgres?', 'Supabase → Logs → Postgres, no horário do início: procure erros de conexão, timeout ou "does not exist".')],
      storage: [reteste, () => manual('Os buckets existem e são privados?', 'Supabase → Storage: confira boletos, comprovantes, fotos e vouchers, e as políticas de acesso.', { tipo: 'link', href: 'infraestrutura.html', label: 'Abrir Infraestrutura' }), deploy],
      recurso: [() => { const [src, key] = String(i.key).split(':').slice(1); const sg = ctx.signal(src, key); return { titulo: 'Qual o valor agora e o limite?', porque: 'Mostra se ainda está acima do limite ou se já normalizou.', estado: !sg ? 'sem_dados' : sg.state === 'healthy' ? 'ok' : 'falhou', detalhe: sg ? `${sg.label || key}: ${sg.unit === '%' ? `${Math.round(sg.value)}%` : sg.value} (alerta ${sg.warn ?? '—'}, crítico ${sg.crit ?? '—'}).` : 'Sem leitura atual deste sinal.' }; }, deploy, () => manual('O que está consumindo?', i.diag.texto, { tipo: 'link', href: 'infraestrutura.html', label: 'Abrir Infraestrutura' })],
      deploy: [() => ciCommit(i.sha, 'do commit do deploy'), () => manual('Qual foi o erro de build?', 'Engenharia → deploys do Sra Luck → abra o deploy com erro e leia o log de build.', { tipo: 'link', href: 'engenharia.html', label: 'Abrir Engenharia' }), sync],
      sync: [sync, () => ciCommit(ctx.changes?.sincronia?.mainSha, 'da main'), () => manual('Publicar a main', 'Se o CI passou, faça o redeploy/promoção em Engenharia. O painel não publica sozinho.', { tipo: 'link', href: 'engenharia.html', label: 'Abrir Engenharia' })],
      ci: [() => manual('Qual job falhou e por quê?', 'Engenharia → CI da main → abra o log do job vermelho.', { tipo: 'link', href: 'engenharia.html', label: 'Abrir Engenharia' }), sync, () => manual('É falha do código ou do GitHub?', 'Se o erro for de instalação/rede do runner, re-rode uma vez; se for teste, corrija na main.')],
      tela: [recente, deploy, antesDepois, () => manual('Reproduza na tela afetada', `Abra ${i.rota || 'a tela citada'} no app/Admin e siga o caminho da cliente; use as evidências e o pacote técnico na Central de Problemas.`, { tipo: 'link', href: 'problemas.html', label: 'Central de Problemas' })],
      operacional: [reverificar, () => manual('Resolva na tela certa', i.passos?.[0] || 'Abra a página indicada e resolva a pendência.', { tipo: 'link', href: i.href, label: 'Abrir página' })],
      regressao: [antesDepois, reteste, logs],
    }[t] || [reteste, deploy, logs];
    return { tipo: t, nome: TIPO_NOME[t] || t, passos: lista.map((f, n) => ({ n: n + 1, ...f() })) };
  }
  const ESTADO = { ok: ['✓', 'ok', 'verificado'], falhou: ['✕', 'bad', 'confirmado'], atencao: ['!', 'warn', 'pista'], manual: ['?', 'info', 'verificar você'], sem_dados: ['–', 'neutral', 'sem dados'] };
  function checklistHtml(ck) {
    return `<p class="dc-ov-p dc-muted">Tipo de falha: <b>${esc(ck.nome)}</b>. Siga na ordem; cada passo descarta ou confirma uma causa.</p><ol class="dc-ck">${ck.passos.map((p) => `<li class="${ESTADO[p.estado][1]}"><span class="dc-ck-mark" title="${esc(ESTADO[p.estado][2])}">${ESTADO[p.estado][0]}</span><div class="dc-ck-body"><strong>${p.n}. ${esc(p.titulo)}</strong>${p.porque ? `<small>${esc(p.porque)}</small>` : ''}<p>${esc(p.detalhe)}</p>${p.acao ? (p.acao.tipo === 'link' ? `<a class="dc-btn" href="${esc(p.acao.href)}">${esc(p.acao.label)}</a>` : `<button class="dc-btn" data-ck="${esc(p.acao.tipo)}"${p.acao.teste ? ` data-teste="${esc(p.acao.teste)}"` : ''}>${p.acao.tipo === 'reteste' ? '<i data-lucide="play"></i>' : ''}${esc(p.acao.label)}</button>`) : ''}</div></li>`).join('')}</ol>`;
  }

  // ------------------------------------------------------------- linha do tempo única
  // ctx: { mudancas, series, historico, retestes, agora }
  function linhaDoTempo(i, ctx) {
    const ev = [], t0 = Date.parse(i.ancora || i.ultima || '') || ctx.agora, ini = Math.min(t0 - 24 * H, ctx.agora - 7 * 24 * H), perto = new Set(i.diag.perto.map((m) => `${m.tipo}:${m.t}`));
    for (const m of ctx.mudancas) if (m.t >= t0 - 24 * H && m.t <= ctx.agora) ev.push({ t: m.t, tipo: m.tipo, txt: m.tipo === 'deploy' ? `Deploy de produção ${m.ref}${m.estado && m.estado !== 'READY' ? ` (${m.estado})` : ''} · ${m.titulo}` : `Migration ${m.titulo} entrou na main`, suspeita: perto.has(`${m.tipo}:${m.t}`) });
    for (const id of i.testes || []) {
      const ps = pontos(ctx.series?.[`probe:${id}`]).filter((p) => p.t >= ini);
      let prev = null;
      for (const p of ps) {
        if (prev && prev.ok && !p.ok) ev.push({ t: p.t, tipo: 'erro', txt: `Teste ${PROBE_NOME[id] || id} passou a falhar (${p.status ? `HTTP ${p.status}` : 'sem resposta'})${p.manual ? ' · reteste manual' : ''}` });
        if (prev && !prev.ok && p.ok) ev.push({ t: p.t, tipo: 'recuperacao', txt: `Teste ${PROBE_NOME[id] || id} voltou a responder (${fmtMs(p.v)})${p.manual ? ' · reteste manual' : ''}` });
        if (!prev && !p.ok) ev.push({ t: p.t, tipo: 'erro', txt: `Teste ${PROBE_NOME[id] || id} já falhando na primeira leitura gravada (${p.status ? `HTTP ${p.status}` : 'sem resposta'})` });
        prev = p;
      }
    }
    // Eventos gravados do incidente; repetições seguidas viram uma linha só.
    let rep = null;
    for (const e of ctx.historico?.eventos || []) {
      const t = Date.parse(e.created_at);
      if (e.event_type === 'signal_repeated') { if (rep) { rep.n++; rep.fim = t; } else { rep = { t, n: 1, fim: t }; ev.push(rep); rep.tipo = 'repeticao'; } continue; }
      rep = null;
      const map = { opened: ['inicio', 'Incidente aberto'], signal_recovered: ['recuperacao', 'Recuperou (marcado como mitigado)'], reopened: ['recorrencia', 'Voltou a acontecer (reaberto)'], fix_applied: ['acao', 'Correção registrada'], autofix_applied: ['acao', 'Correção automática registrada'] }[e.event_type] || ['acao', e.event_type];
      ev.push({ t, tipo: map[0], txt: `${map[1]}${e.message ? ` · ${e.message}` : ''}` });
    }
    for (const r of ev) if (r.tipo === 'repeticao') r.txt = `Continuou fora do normal em ${r.n} leitura(s)${r.n > 1 ? ` até ${hora(r.fim)}` : ''}`;
    for (const a of i.amostras || []) { const t = Date.parse(a.criado_em); if (Number.isFinite(t)) ev.push({ t, tipo: 'erro', txt: `Erro registrado${a.nivel ? ` (${a.nivel})` : ''}${a.ambiente ? ` · ${a.ambiente}` : ''}` }); }
    if (i.ancora && !ev.some((e) => e.tipo === 'inicio')) ev.push({ t: Date.parse(i.ancora), tipo: 'inicio', txt: 'Início detectado' });
    if (i.ultima) ev.push({ t: Date.parse(i.ultima), tipo: 'ultima', txt: 'Última ocorrência registrada' });
    for (const id of i.testes || []) { const r = ctx.retestes.get(id); if (r) ev.push({ t: Date.parse(r.testadoEm), tipo: r.ok ? 'recuperacao' : 'erro', txt: `Reteste agora: ${r.ok ? `OK em ${fmtMs(r.ms)}` : `${r.status ? `HTTP ${r.status}` : 'sem resposta'}`}`, reteste: true }); }
    const vistos = new Set();
    return ev.filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t).filter((e) => { const k = `${e.t}|${e.txt}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  }
  function recorrencia(i, ctx) {
    const desde = ctx.agora - 7 * 24 * H;
    const eps = (i.testes || []).flatMap((id) => episodios(ctx.series?.[`probe:${id}`], desde));
    const reab = (ctx.historico?.eventos || []).filter((e) => e.event_type === 'reopened' && Date.parse(e.created_at) >= desde).length;
    return { episodios: eps.length, reaberturas: reab, texto: eps.length > 1 || reab ? `${eps.length > 1 ? `${eps.length} episódios de falha` : ''}${eps.length > 1 && reab ? ' e ' : ''}${reab ? `${reab} reabertura(s)` : ''} em 7 dias` : null };
  }
  const TL_ICON = { deploy: 'rocket', migration: 'database', erro: 'circle-x', recuperacao: 'circle-check', recorrencia: 'repeat', inicio: 'flag', ultima: 'clock', repeticao: 'more-horizontal', acao: 'wrench' };
  function linhaDoTempoHtml(ev) {
    return ev.length ? `<ol class="dc-ov-tl">${ev.map((e) => `<li class="${e.tipo}${e.suspeita ? ' perto' : ''}"><time>${esc(hora(e.t))}</time><span><i data-lucide="${TL_ICON[e.tipo] || 'dot'}"></i>${esc(e.txt)}</span>${e.suspeita ? DC.chip('suspeita', 'warn') : e.reteste ? DC.chip('agora', 'info') : ''}</li>`).join('')}</ol>` : '<div class="dc-empty">Sem eventos registrados para este incidente.</div>';
  }

  // ------------------------------------------------------------- relatório técnico
  // Markdown curto para issue/chat. Não inclui dados pessoais: evidências de pendências
  // operacionais (que listam clientes) entram só como contagem.
  function relatorio(i, ctx, ck, comp, tl, rec) {
    const s = ctx.changes?.sincronia, L = [];
    const semPII = ['operacional', 'dados', 'configuracao'].includes(i.tipoProblema) && i.http == null;
    L.push(`## [${i.sevNome}] ${i.titulo}`);
    L.push([`- **Componente:** ${comp ? `${comp.nome} (${comp.toneNome})` : '—'}`, `- **Tipo de falha:** ${ck.nome}`, `- **Início:** ${i.ancora ? `${hora(Date.parse(i.ancora))} (${DC.relTime(i.ancora)})` : 'não registrado'}${i.ultima ? ` · **última ocorrência:** ${hora(Date.parse(i.ultima))}` : ''}`, rec?.texto ? `- **Recorrência:** ${rec.texto}` : null, s ? `- **Versões:** produção \`${String(s.producaoSha || '—').slice(0, 7)}\` · main \`${String(s.mainSha || '—').slice(0, 7)}\`${s.estado === 'producao_atras' ? ` (${s.commitsAtras} commit(s) atrás)` : s.estado === 'sincronizado' ? ' (iguais)' : ''}` : null].filter(Boolean).join('\n'));
    if (i.impacto) L.push(`### Impacto\n${i.impacto}`);
    L.push(`### Causa provável (${i.forcaNome})\n${i.diag.texto}${i.diag.base.length ? `\n\n_Base: ${i.diag.base.join('; ')}._` : ''}`);
    const ev = semPII ? [[`Registros afetados`, `${i.evid.length} (lista no Dev Console; omitida por conter dados de clientes)`]] : i.evid;
    const rts = (i.testes || []).map((id) => ctx.retestes.get(id)).filter(Boolean);
    if (ev.length || rts.length || i.requestIds?.length) L.push(`### Evidências\n${[...ev.map(([k, v]) => `- ${k}: ${v}`), ...rts.map((r) => `- Reteste ${horaCurta(r.testadoEm)} (horário de Brasília): \`GET ${r.path}\` → ${r.ok ? `OK ${fmtMs(r.ms)}` : `${r.status ? `HTTP ${r.status}` : 'sem resposta'} ${fmtMs(r.ms)}`}`), i.requestIds?.length ? `- Request IDs: ${i.requestIds.slice(0, 5).map((x) => `\`${x}\``).join(', ')}` : null].filter(Boolean).join('\n')}`);
    L.push(`### Checklist\n${ck.passos.map((p) => `- [${p.estado === 'ok' || p.estado === 'falhou' ? 'x' : ' '}] ${p.titulo} — ${ESTADO[p.estado][2]}: ${p.detalhe}`).join('\n')}`);
    const c = ctx.comparacao;
    if (c && c.linhas.some((l) => l.veredito !== 'sem_dados')) L.push(`### Antes x depois de ${c.mudanca.tipo === 'deploy' ? `deploy ${c.mudanca.ref}` : c.mudanca.titulo}\n| Métrica | Antes | Depois | Resultado |\n|---|---|---|---|\n${c.linhas.filter((l) => l.veredito !== 'sem_dados').map((l) => `| ${l.nome} | ${l.antes} | ${l.depois} | ${VEREDITO[l.veredito][0]}: ${l.texto} |`).join('\n')}`);
    if (tl.length) L.push(`### Linha do tempo\n${tl.slice(-12).map((e) => `- ${hora(e.t)} — ${e.txt}${e.suspeita ? ' **(suspeita)**' : ''}`).join('\n')}`);
    const pend = ck.passos.filter((p) => p.estado === 'manual' || p.estado === 'atencao' || p.estado === 'sem_dados');
    L.push(`### Próximos passos\n${(pend.length ? pend.map((p) => `${p.titulo} ${p.detalhe}`) : i.passos || []).slice(0, 4).map((p, n) => `${n + 1}. ${p}`).join('\n') || '—'}`);
    L.push(`_Gerado pelo Dev Console em ${new Date().toLocaleString('pt-BR')}. Nenhuma correção foi aplicada em produção._`);
    return L.join('\n\n');
  }

  window.DCInvest = { PROBES, PROBE_NOME, pontos, janela, compararTeste, compararErros, compararMudanca, tabelaComparacao, VEREDITO, episodios, recorrencia, tipoFalha, passos, checklistHtml, linhaDoTempo, linhaDoTempoHtml, relatorio };
})();
