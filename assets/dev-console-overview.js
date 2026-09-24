(() => {
  // Visão Geral operacional. Tudo vem de fontes reais já existentes:
  //   /api/health, /api/ready            → prontidão da API do Sra Luck
  //   /api/infra-overview                → Supabase, Storage, Cloudflare, Vercel, backups, incidentes
  //   /api/problemas                     → fluxos testados agora + problemas com explicação
  //   /api/admin/monitoramento-erros     → erros do App e do Admin
  //   /api/infra-history?series=         → histórico gravado a cada varredura
  //   /api/github-status?resource=changes→ deploy de produção, main, CI, migrations
  // Sem dado → o painel diz que não há evidência; nada é estimado.
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const PAL = ['#3987e5', '#d95926', '#199e70', '#c98500'];
  const SEV = { critical: [0, 'Crítico', 'bad'], high: [1, 'Alto', 'bad'], warning: [2, 'Atenção', 'warn'], info: [3, 'Info', 'info'] };
  const TONE_LABEL = { ok: 'Normal', warn: 'Atenção', bad: 'Com falha', neutral: 'Sem dados' };
  const quando = (iso) => (iso ? DC.relTime(iso) : '—');
  const ms = (v) => (v == null ? '—' : `${Math.round(v)} ms`);
  const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(0)}%`);
  const S = { hours: 24 };

  const ADMIN_AREAS = ['admin', 'v46', 'financeiro', 'clube', 'notificacoes', 'integracoes'];
  const FLOWS = [
    { id: 'plataforma', nome: 'Acesso e API', desc: 'Prontidão, banco, storage e registro de erros', areas: ['plataforma'] },
    { id: 'admin', nome: 'Painel Admin', desc: 'Visão geral, configurações e equipe', areas: ['admin'] },
    { id: 'v46', nome: 'Jornada V46', desc: 'Central da jornada e previsão de liberações', areas: ['v46'] },
    { id: 'financeiro', nome: 'Financeiro', desc: 'Validação de comprovantes e resumo', areas: ['financeiro'] },
    { id: 'app', nome: 'App da cliente', desc: 'Acesso, telemetria e desempenho do app', areas: ['app'] },
    { id: 'clube', nome: 'Clube de vantagens', desc: 'Recompensas, indicações e vouchers', areas: ['clube'] },
    { id: 'notificacoes', nome: 'Notificações', desc: 'Rotinas, templates e Web Push', areas: ['notificacoes'] },
    { id: 'integracoes', nome: 'Integrações', desc: 'Gemini, pagamentos, CRM e bancos', areas: ['integracoes'] },
  ];
  const INFRA_TXT = {
    supabase: ['Banco do Sra Luck lento ou instável: Admin e App podem demorar ou falhar.', 'Veja CPU, RAM e disco em Infraestrutura; se persistir, avalie consultas pesadas ou upgrade do plano.'],
    cloudflare: ['A API usada pelo App e pelo Admin pode responder erro ou lentidão.', 'Abra Infraestrutura → Cloudflare e confira erros e memória do Worker; um deploy recente pode ser a causa.'],
    storage: ['Envio e visualização de comprovantes, carnês, fotos ou vouchers podem falhar.', 'Confira os buckets críticos em Infraestrutura → Storage.'],
    backups: ['Sem cópia recente do banco: risco de perda de dados em caso de incidente.', 'Confira o último backup no Supabase e o agendamento.'],
    guardian: ['O monitoramento automático parou: problemas novos podem passar despercebidos.', 'Rode uma varredura agora e confira o agendador (cron / GitHub Actions).'],
    dev_runtime: ['O próprio Dev Console está perto do limite de memória.', 'Veja o consumo em Infraestrutura; costuma normalizar após o próximo deploy.'],
    dev_supabase: ['O banco do Dev Console está sob pressão: histórico e auditoria podem falhar.', 'Veja o banco do Dev Console em Infraestrutura.'],
  };

  const V = {};

  // ------------------------------------------------------------- carga
  async function carregarBase() {
    const paths = { health: '/api/health', ready: '/api/ready', infra: '/api/infra-overview', errors: '/api/admin/monitoramento-erros?limite=250' };
    const res = await Promise.all(Object.entries(paths).map(async ([k, p]) => [k, await DC.api(p)]));
    for (const [k, r] of res) V[k] = r;
  }
  async function carregarProblemas() { V.problemas = await DC.api('/api/problemas', { timeout: 45000 }); }
  async function carregarMudancas() { V.changes = await DC.api('/api/github-status?resource=changes', { timeout: 30000 }); }

  // ------------------------------------------------------------- dados
  const infra = () => (V.infra?.ok ? V.infra.data : null);
  const prob = () => (V.problemas?.ok ? V.problemas.data : null);
  const fontes = () => prob()?.fontes || [];
  const problemas = () => prob()?.problemas || [];
  const eventos = () => V.errors?.data?.eventos || [];
  const signal = (source, key) => (infra()?.signals || []).find((s) => s.source === source && s.key === key) || null;
  const areaDoEvento = (e) => {
    const r = String(e.rota || '');
    if (r.startsWith('/admin') || r.startsWith('/api/admin')) return 'Admin';
    if (r.startsWith('/api/cliente') || r.startsWith('/app') || r === '/' || r.startsWith('/agenda') || (e.origem === 'frontend' && !r.startsWith('/api/'))) return 'App da cliente';
    return 'API e rotinas';
  };
  const errosDesde = (area, horas) => eventos().filter((e) => (!area || areaDoEvento(e) === area) && Date.now() - new Date(e.criado_em).getTime() <= horas * 3600000);
  const piorSinal = (...sinais) => { const ss = sinais.filter(Boolean); return ss.some((s) => s.state === 'critical') ? 'bad' : ss.some((s) => s.state === 'warning') ? 'warn' : ss.length ? 'ok' : null; };

  // ------------------------------------------------------------- componentes
  function componentes() {
    const I = infra(), P = I?.providers || {}, fs = fontes(), ps = problemas(), ch = V.changes?.ok ? V.changes.data : null;
    const graves = (lista) => lista.filter((p) => p.severidade === 'critical' || p.severidade === 'high');
    const out = [];

    // App da cliente
    {
      const f = fs.find((x) => x.id === 'app'), rel = ps.filter((p) => p.dominio === 'app'), e24 = errosDesde('App da cliente', 24), fatais = e24.filter((e) => e.nivel === 'fatal').length;
      const tone = !prob() ? 'neutral' : !f || f.naoConfigurado ? 'neutral' : !f.ok ? 'bad' : graves(rel).length || fatais ? 'warn' : rel.length ? 'warn' : 'ok';
      out.push({ id: 'app', nome: 'App da cliente', icone: 'smartphone', tone, href: 'app-cliente.html', pagina: 'Clientes & App',
        frase: tone === 'neutral' ? 'Sem conector com o Sra Luck: não dá para testar o app daqui.' : tone === 'bad' ? `O monitoramento do app não respondeu (HTTP ${f.status || 'sem resposta'}).` : rel.length ? `Funciona, com ${rel.length} ponto(s) de atenção: ${rel[0].titulo}.` : 'Respondendo normalmente.',
        metrica: V.errors?.ok ? `${e24.length} erro(s) em 24 h` : '', relacionados: rel,
        medidas: [['Teste do app', f ? (f.ok ? `OK · ${ms(f.ms)}` : `Falhou · HTTP ${f.status || '—'}`) : '—'], ['Erros em 24 h', V.errors?.ok ? String(e24.length) : 'indisponível'], ['Erros fatais em 24 h', V.errors?.ok ? String(fatais) : 'indisponível']] });
    }
    // Admin
    {
      const fa = fs.filter((x) => ADMIN_AREAS.includes(x.area) && !x.naoConfigurado), falhas = fa.filter((x) => !x.ok), rel = ps.filter((p) => ADMIN_AREAS.includes(p.dominio)), e24 = errosDesde('Admin', 24);
      const tone = !prob() || !fa.length ? 'neutral' : falhas.length ? 'bad' : graves(rel).length ? 'warn' : 'ok';
      out.push({ id: 'admin', nome: 'Admin', icone: 'layout-dashboard', tone, href: 'sistema.html', pagina: 'Admin Sra Luck',
        frase: tone === 'neutral' ? 'Sem conector com o Sra Luck: as funções do Admin não puderam ser testadas.' : falhas.length ? `${falhas.length} função(ões) do Admin sem resposta: ${falhas.map((x) => x.label).slice(0, 2).join(', ')}.` : graves(rel).length ? `Funções respondendo, mas ${graves(rel).length} problema(s) importante(s) na operação.` : `Todas as ${fa.length} funções testadas responderam.`,
        metrica: fa.length ? `${fa.length - falhas.length}/${fa.length} funções` : '', relacionados: rel,
        medidas: fa.map((x) => [x.label, x.ok ? `OK · ${ms(x.ms)}` : `Falhou · HTTP ${x.status || '—'}`]).concat([['Erros em 24 h', V.errors?.ok ? String(e24.length) : 'indisponível']]) });
    }
    // API / Worker
    {
      const h = V.health, r = V.ready, er = signal('cloudflare', 'worker_error_rate_percent');
      const tone = !r ? 'neutral' : !r.ok ? 'bad' : er?.state === 'critical' ? 'bad' : er?.state === 'warning' || (r.ms || 0) > 1500 ? 'warn' : 'ok';
      out.push({ id: 'api', nome: 'API / Worker', icone: 'server', tone, href: 'infraestrutura.html', pagina: 'Infraestrutura',
        frase: tone === 'bad' && !r.ok ? 'A API do Sra Luck não está pronta: App e Admin podem não carregar.' : er?.state && er.state !== 'healthy' ? `Taxa de erro do Worker em ${pct(er.value)}.` : (r?.ms || 0) > 1500 ? `API lenta: prontidão levou ${ms(r.ms)}.` : 'API pronta e respondendo.',
        metrica: r?.ok ? ms(r.ms) : r ? `HTTP ${r.status || '—'}` : '', relacionados: [],
        medidas: [['/api/health', h ? (h.ok ? `OK · ${ms(h.ms)}` : `Falhou · HTTP ${h.status || '—'}`) : '—'], ['/api/ready', r ? (r.ok ? `OK · ${ms(r.ms)}` : `Falhou · HTTP ${r.status || '—'}`) : '—'], ['Taxa de erro do Worker', er ? pct(er.value) : 'sem leitura']] });
    }
    // Supabase
    {
      const p = P.supabase, cpu = signal('supabase', 'cpu_usage_percent'), ram = signal('supabase', 'memory_usage_percent'), disk = signal('supabase', 'disk_usage_percent');
      const worst = piorSinal(cpu, ram, disk);
      const tone = !I || !p || p.configured === false ? 'neutral' : p.ok === false ? 'bad' : worst || 'ok';
      out.push({ id: 'supabase', nome: 'Supabase', logo: 'supabase', tone, href: 'infraestrutura.html', pagina: 'Infraestrutura',
        frase: tone === 'neutral' ? 'Métricas do banco não configuradas no Dev Console.' : p.ok === false ? `Não foi possível ler o banco${p.message ? `: ${p.message}` : '.'}` : worst === 'bad' ? 'Banco sob pressão crítica de recursos.' : worst === 'warn' ? 'Banco respondendo, com recurso acima do nível de alerta.' : 'Banco respondendo com folga de recursos.',
        metrica: ram ? `RAM ${pct(ram.value)}` : '', relacionados: [],
        medidas: [['CPU', cpu ? pct(cpu.value) : 'sem leitura'], ['RAM', ram ? pct(ram.value) : 'sem leitura'], ['Disco', disk ? pct(disk.value) : 'sem leitura'], ['Backup', P.backups?.ageHours != null ? `há ${P.backups.ageHours.toFixed(1)} h` : 'sem leitura']] });
    }
    // Storage
    {
      const p = P.storage, checks = p?.checks || [], okc = checks.filter((c) => c.existe && c.acessivel && c.privado === true).length;
      const tone = !I || !p || p.configured === false ? 'neutral' : p.ok === false ? 'bad' : 'ok';
      out.push({ id: 'storage', nome: 'Storage', icone: 'hard-drive', tone, href: 'infraestrutura.html', pagina: 'Infraestrutura',
        frase: tone === 'neutral' ? 'Verificação de storage não configurada.' : tone === 'bad' ? 'Algum bucket crítico está inacessível ou público.' : 'Buckets de comprovantes, carnês, fotos e vouchers acessíveis e privados.',
        metrica: checks.length ? `${okc}/${checks.length} buckets` : '', relacionados: [],
        medidas: checks.map((c) => [c.bucket || c.nome || 'bucket', c.existe && c.acessivel ? (c.privado === true ? 'OK · privado' : 'Acessível, mas NÃO privado') : 'Inacessível']) });
    }
    // Vercel
    {
      const d = ch?.deploy, prodDep = d?.producao, sinc = ch?.sincronia;
      const tone = !ch || !d?.configured ? 'neutral' : prodDep?.state === 'ERROR' ? 'bad' : sinc?.estado === 'producao_atras' || sinc?.estado === 'divergente' || prodDep?.state !== 'READY' ? 'warn' : 'ok';
      out.push({ id: 'vercel', nome: 'Vercel', logo: 'vercel', tone, href: 'engenharia.html', pagina: 'Engenharia',
        frase: !ch ? 'Não foi possível consultar deploys agora.' : !d?.configured ? `Deploys não configurados: ${d?.erro || 'defina SRA_VERCEL_PROJECT_ID e DEV_VERCEL_ACCESS_TOKEN'}.` : !prodDep ? 'Nenhum deploy de produção encontrado.' : sinc?.estado === 'producao_atras' ? `Produção está ${sinc.commitsAtras} commit(s) atrás da main.` : sinc?.estado === 'sincronizado' ? 'Produção roda o mesmo código da main.' : `Deploy de produção ${String(prodDep.state || '').toLowerCase()}.`,
        metrica: prodDep ? quando(prodDep.createdAt ? new Date(prodDep.createdAt).toISOString() : null) : '', relacionados: [],
        medidas: [['Deploy de produção', prodDep ? `${prodDep.state || '—'} · ${(prodDep.sha || '').slice(0, 7) || 'sem commit'}` : '—'], ['Commit da main', ch?.main ? `${ch.main.sha.slice(0, 7)} · ${ch.main.message}` : '—'], ['Sincronia', sinc?.estado === 'sincronizado' ? 'Igual à main' : sinc?.estado === 'producao_atras' ? `${sinc.commitsAtras} commit(s) atrás` : sinc?.motivo || '—']] });
    }
    // Cloudflare
    {
      const p = P.cloudflare, mem = signal('cloudflare', 'worker_memory_p99_percent'), er = signal('cloudflare', 'worker_error_rate_percent');
      const tone = !I || !p || p.configured === false ? 'neutral' : p.ok === false ? 'bad' : piorSinal(mem, er) || 'ok';
      out.push({ id: 'cloudflare', nome: 'Cloudflare', logo: 'cloudflare', tone, href: 'infraestrutura.html', pagina: 'Infraestrutura',
        frase: tone === 'neutral' ? 'Analytics do Worker não configurado (token Cloudflare).' : p.ok === false ? `Não foi possível ler o Worker${p.message ? `: ${p.message}` : '.'}` : tone === 'ok' ? 'Worker com memória e taxa de erro normais.' : 'Worker com memória ou taxa de erro acima do alerta.',
        metrica: mem ? `Mem P99 ${pct(mem.value)}` : '', relacionados: [],
        medidas: [['Memória P99', mem ? pct(mem.value) : 'sem leitura'], ['Taxa de erro', er ? pct(er.value) : 'sem leitura'], ['Requisições (janela)', p?.metrics?.requests != null ? String(p.metrics.requests) : '—']] });
    }
    return out;
  }

  // ------------------------------------------------------------- incidentes
  function incidentes() {
    const itens = [], I = infra(), ch = V.changes?.ok ? V.changes.data : null;
    if (V.ready && !V.ready.ok) itens.push({ sev: 'critical', titulo: 'API do Sra Luck não está pronta', contexto: `/api/ready respondeu HTTP ${V.ready.status || 'sem resposta'} agora`, impacto: 'Clientes e equipe podem não conseguir usar o App e o Admin.', acao: 'Abra Infraestrutura e confira Worker, banco e variáveis; veja se houve deploy recente.', href: 'infraestrutura.html' });
    for (const p of problemas()) {
      if (p.severidade === 'info') continue;
      const ev = (p.evidencias || [])[0];
      itens.push({ sev: p.severidade, titulo: p.titulo, contexto: [p.ocorrencias > 1 ? `${p.ocorrencias} ocorrências` : null, ev ? `${ev.label}: ${ev.valor}` : null].filter(Boolean).join(' · '), impacto: p.impacto || p.explicacao?.porQue || '', acao: p.explicacao?.comoResolver?.[0] || '', href: 'problemas.html', fix: (p.acoes || []).some((a) => a.tipo === 'seguro' || a.tipo === 'confirmar') });
    }
    for (const i of I?.incidents || []) {
      if (!['open', 'investigating', 'reopened'].includes(i.status)) continue;
      const src = i.metadata?.source, txt = INFRA_TXT[src] || ['Recurso de infraestrutura fora do normal.', 'Veja o detalhe em Infraestrutura.'];
      itens.push({ sev: i.severity === 'critical' ? 'critical' : i.severity === 'high' ? 'high' : 'warning', titulo: i.title, contexto: `desde ${quando(i.first_seen_at)} · ${i.occurrence_count || 1} ocorrência(s) · última ${quando(i.last_seen_at)}`, impacto: txt[0], acao: txt[1], href: 'infraestrutura.html' });
    }
    if (ch?.ci?.status === 'completed' && ch.ci.conclusion === 'failure') itens.push({ sev: 'high', titulo: 'CI da main do Sra Luck falhou', contexto: `${ch.ci.name} · ${quando(ch.ci.updated_at || ch.ci.created_at)}`, impacto: 'O código mais recente não passou nos testes; um deploy dele pode quebrar algo.', acao: 'Abra Engenharia, veja o log e re-rode ou corrija antes de publicar.', href: 'engenharia.html' });
    if (ch?.deploy?.producao?.state === 'ERROR') itens.push({ sev: 'high', titulo: 'Último deploy de produção falhou', contexto: quando(ch.deploy.producao.createdAt ? new Date(ch.deploy.producao.createdAt).toISOString() : null), impacto: 'A versão nova não entrou no ar; as clientes seguem na anterior.', acao: 'Abra Engenharia, veja o erro de build e faça redeploy.', href: 'engenharia.html' });
    if (ch?.sincronia?.estado === 'producao_atras') itens.push({ sev: 'warning', titulo: `Produção ${ch.sincronia.commitsAtras} commit(s) atrás da main`, contexto: `produção ${String(ch.sincronia.producaoSha).slice(0, 7)} · main ${String(ch.sincronia.mainSha).slice(0, 7)}`, impacto: 'Correções já integradas na main ainda não chegaram às clientes.', acao: 'Em Engenharia, faça o redeploy/promoção do commit da main (confira o CI antes).', href: 'engenharia.html' });
    return itens.sort((a, b) => SEV[a.sev][0] - SEV[b.sev][0]);
  }

  // ------------------------------------------------------------- render
  function renderHero(comps, incs) {
    const bad = comps.filter((c) => c.tone === 'bad').length, warn = comps.filter((c) => c.tone === 'warn').length, sem = comps.filter((c) => c.tone === 'neutral').length;
    const crit = incs.filter((i) => i.sev === 'critical' || i.sev === 'high').length;
    const flowsBad = FLOWS.filter((f) => fontes().some((x) => f.areas.includes(x.area) && !x.ok && !x.naoConfigurado)).length;
    const tone = bad || incs.some((i) => i.sev === 'critical') ? 'bad' : warn || incs.length ? 'warn' : sem === comps.length ? 'neutral' : 'ok';
    DC.$('ovDot').className = `dc-ov-dot ${tone}`;
    DC.$('ovTitle').textContent = tone === 'ok' ? 'Tudo funcionando' : tone === 'bad' ? 'Há falha afetando o sistema' : tone === 'warn' ? `${incs.length} item(ns) pedem atenção` : 'Ainda sem dados suficientes';
    DC.$('ovSub').textContent = tone === 'ok' ? 'Nenhum componente com falha e nenhum alerta aberto.' : tone === 'neutral' ? 'Configure o conector e as integrações de monitoramento para o painel ter evidência.' : `${bad ? `${bad} componente(s) com falha. ` : ''}${crit ? `${crit} alerta(s) importante(s). ` : ''}Veja os detalhes abaixo.`;
    const ch = V.changes?.ok ? V.changes.data : null;
    const sinc = ch?.sincronia?.estado === 'sincronizado' ? ['Produção = main', 'ok'] : ch?.sincronia?.estado === 'producao_atras' ? [`Produção ${ch.sincronia.commitsAtras} atrás`, 'warn'] : ['Sincronia desconhecida', 'neutral'];
    DC.$('ovCounts').innerHTML = [DC.chip(`${incs.length} alerta(s)`, incs.length ? (crit ? 'bad' : 'warn') : 'ok'), DC.chip(prob() ? `${flowsBad} fluxo(s) com falha` : 'Fluxos não testados', prob() ? (flowsBad ? 'bad' : 'ok') : 'neutral'), DC.chip(sinc[0], sinc[1])].join('');
    DC.setTopStatus(tone === 'ok' ? 'Operação normal' : tone === 'bad' ? 'Falha em andamento' : tone === 'warn' ? 'Atenção operacional' : 'Sem evidência', tone === 'neutral' ? 'warn' : tone);
    const nb = DC.$('navBadge-problemas'); if (nb) { nb.textContent = crit; nb.style.display = crit ? 'inline-flex' : 'none'; }
  }

  const marca = (c) => (c.logo ? `<img class="dc-ov-logo" src="assets/logos/${c.logo}.svg" alt="">` : `<span class="dc-ov-icon"><i data-lucide="${c.icone}"></i></span>`);
  function renderComponentes(comps) {
    DC.$('components').innerHTML = comps.map((c) => `<button class="dc-ov-comp" data-comp="${c.id}">${marca(c)}<span class="dc-ov-comp-main"><strong>${esc(c.nome)}</strong><small>${esc(c.frase)}</small></span><span class="dc-ov-comp-metric">${esc(c.metrica || '')}</span>${DC.chip(TONE_LABEL[c.tone], c.tone === 'neutral' ? 'neutral' : c.tone)}</button>`).join('');
  }

  function renderIncidentes(incs) {
    const el = DC.$('incidents');
    if (!prob() && !infra()) { el.innerHTML = '<div class="dc-empty">Ainda não há evidência suficiente: problemas e infraestrutura não puderam ser lidos.</div>'; return; }
    if (!incs.length) { el.innerHTML = '<div class="dc-ov-allclear"><i data-lucide="shield-check"></i><div><strong>Nenhum alerta aberto</strong><p>Nada pede ação agora. Os fluxos e a infraestrutura continuam sendo vigiados.</p></div></div>'; return; }
    const shown = incs.slice(0, 7);
    el.innerHTML = shown.map((i) => `<article class="dc-ov-inc ${SEV[i.sev][2]}"><header>${DC.chip(SEV[i.sev][1], SEV[i.sev][2])}<strong>${esc(i.titulo)}</strong></header>${i.contexto ? `<p class="ctx">${esc(i.contexto)}</p>` : ''}${i.impacto ? `<p><b>Impacto:</b> ${esc(i.impacto)}</p>` : ''}${i.acao ? `<p><b>O que fazer:</b> ${esc(i.acao)}</p>` : ''}<footer><a class="dc-btn" href="${i.href}">${i.fix ? 'Corrigir na Central' : 'Abrir'}</a></footer></article>`).join('') + (incs.length > shown.length ? `<a class="dc-ov-more" href="problemas.html">+ ${incs.length - shown.length} outro(s) na Central de Problemas</a>` : '');
  }

  function renderFluxos() {
    const el = DC.$('flows');
    if (!prob()) { el.innerHTML = `<div class="dc-empty">${esc(V.problemas?.error || 'Os fluxos não puderam ser testados.')}</div>`; return; }
    el.innerHTML = FLOWS.map((f) => {
      const fs = fontes().filter((x) => f.areas.includes(x.area)), ativos = fs.filter((x) => !x.naoConfigurado), falhas = ativos.filter((x) => !x.ok), rel = problemas().filter((p) => f.areas.includes(p.dominio));
      const tone = !ativos.length ? 'neutral' : falhas.length ? 'bad' : rel.some((p) => p.severidade === 'critical' || p.severidade === 'high') ? 'warn' : 'ok';
      const maior = ativos.filter((x) => x.ok).reduce((m, x) => Math.max(m, x.ms || 0), 0);
      return `<button class="dc-ov-flow" data-flow="${f.id}"><span class="dc-fn-dot ${tone === 'neutral' ? 'neutral' : tone}"></span><span class="dc-ov-comp-main"><strong>${esc(f.nome)}</strong><small>${esc(!ativos.length ? 'Sem conector: não testado' : falhas.length ? `${falhas.length} de ${ativos.length} etapa(s) falhando` : `${ativos.length} etapa(s) OK · mais lenta ${ms(maior)}`)}</small></span>${rel.length ? DC.chip(`${rel.length} problema(s)`, tone === 'ok' ? 'info' : tone) : ''}</button>`;
    }).join('');
  }

  const TIPO = { deploy: ['Deploy', 'rocket'], commit: ['Commit', 'git-commit-horizontal'], ci: ['CI', 'activity'], migration: ['Migration', 'database'] };
  function renderMudancas() {
    const sync = DC.$('sync'), el = DC.$('changes');
    if (!V.changes?.ok) { sync.innerHTML = ''; el.innerHTML = `<div class="dc-empty">${esc(V.changes?.error || 'Não foi possível consultar GitHub e Vercel.')}</div>`; return; }
    const c = V.changes.data, s = c.sincronia || {};
    sync.innerHTML = s.estado === 'sincronizado' ? `<div class="dc-ov-sync ok"><strong>Produção roda o mesmo código da main</strong><span class="dc-mono">${esc(String(s.mainSha).slice(0, 7))}</span></div>`
      : s.estado === 'producao_atras' ? `<div class="dc-ov-sync warn"><strong>Produção está ${s.commitsAtras} commit(s) atrás da main</strong><span>As últimas alterações ainda não chegaram às clientes. <span class="dc-mono">${esc(String(s.producaoSha).slice(0, 7))} → ${esc(String(s.mainSha).slice(0, 7))}</span></span></div>`
      : s.estado === 'divergente' ? `<div class="dc-ov-sync warn"><strong>Produção roda um commit fora da main</strong><span class="dc-mono">${esc(String(s.producaoSha).slice(0, 7))}</span></div>`
      : `<div class="dc-ov-sync neutral"><strong>Não dá para afirmar se produção = main</strong><span>${esc(s.motivo || 'Faltam dados para comparar.')}</span></div>`;
    const itens = [];
    for (const d of (c.deploy?.recentes || []).filter((x) => x.target === 'production').slice(0, 4)) itens.push({ tipo: 'deploy', data: d.createdAt ? new Date(d.createdAt).toISOString() : null, titulo: d.message || 'Deploy de produção', sub: `${(d.sha || '').slice(0, 7) || 'sem commit'}${d.current ? ' · em produção agora' : ''}`, chip: [d.state || '—', d.state === 'READY' ? 'ok' : d.state === 'ERROR' ? 'bad' : 'warn'] });
    for (const m of c.commits?.slice(0, 5) || []) itens.push({ tipo: 'commit', data: m.date, titulo: m.message, sub: `${m.sha.slice(0, 7)} · ${m.author || ''}` });
    for (const r of c.runs?.slice(0, 3) || []) itens.push({ tipo: 'ci', data: r.updated_at || r.created_at, titulo: r.name, sub: (r.head_sha || '').slice(0, 7), chip: r.status !== 'completed' ? ['Rodando', 'warn'] : r.conclusion === 'success' ? ['Passou', 'ok'] : [r.conclusion === 'failure' ? 'Falhou' : r.conclusion || '—', r.conclusion === 'failure' ? 'bad' : 'neutral'] });
    for (const m of c.migrations?.itens || []) itens.push({ tipo: 'migration', data: m.alteradaEm, titulo: m.arquivo, sub: 'no repositório · aplicação no banco é manual' });
    itens.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
    el.innerHTML = itens.slice(0, 12).map((i) => `<div class="dc-ov-change"><span class="dc-ov-change-type"><i data-lucide="${TIPO[i.tipo][1]}"></i>${TIPO[i.tipo][0]}</span><span class="dc-ov-comp-main"><strong>${esc(i.titulo)}</strong><small>${esc(i.sub)}</small></span>${i.chip ? DC.chip(i.chip[0], i.chip[1]) : ''}<time class="dc-muted">${esc(quando(i.data))}</time></div>`).join('') || '<div class="dc-empty">Sem alterações recentes.</div>';
  }

  // ------------------------------------------------------------- histórico
  async function renderHistorico() {
    const box = DC.$('charts'), note = DC.$('histNote');
    const h = S.hours, to = Date.now(), from = to - h * 3600000;
    const LAT = [['probe:ready', 'API (prontidão)'], ['probe:v46', 'Jornada V46'], ['probe:validacoes', 'Financeiro'], ['probe:app', 'App da cliente']];
    const REC = [['supabase:cpu_usage_percent', 'Supabase CPU'], ['supabase:memory_usage_percent', 'Supabase RAM'], ['supabase:disk_usage_percent', 'Supabase disco'], ['cloudflare:worker_memory_p99_percent', 'Worker memória P99']];
    const r = await DC.api(`/api/infra-history?series=${encodeURIComponent([...LAT, ...REC].map((x) => x[0]).join(','))}&hours=${h}`);
    box.innerHTML = '';
    const card = (titulo, sub) => { const c = document.createElement('div'); c.className = 'dc-ov-chart'; c.innerHTML = `<header><strong>${esc(titulo)}</strong><small>${esc(sub)}</small></header><div></div>`; box.appendChild(c); return c.lastElementChild; };
    const data = r.ok ? r.data.series || {} : {};
    const pts = (k) => (data[k] || []).map((p) => ({ t: p.observed_at, v: p.metric_value }));
    DCChart.line(card('Latência dos fluxos', 'Tempo de resposta real de cada fluxo testado (ms)'), { series: LAT.map(([k, n], i) => ({ name: n, color: PAL[i], points: pts(k) })), unit: ' ms', from, to, legend: true, label: 'Latência dos fluxos em milissegundos', empty: r.ok ? 'Sem leituras de latência neste período. Elas passam a ser gravadas a cada varredura.' : (r.error || 'Histórico indisponível.') });
    // Erros por janela, a partir dos eventos registrados (não inventa zero antes do primeiro evento conhecido).
    const ev = eventos(), limite = 250, cheio = ev.length >= limite, desde = cheio ? Math.min(...ev.map((e) => new Date(e.criado_em).getTime())) : from;
    const passo = h <= 24 ? 3600000 : h <= 168 ? 6 * 3600000 : 86400000, ini = Math.max(from, Math.floor(desde / passo) * passo);
    const areas = ['App da cliente', 'Admin', 'API e rotinas'];
    const buckets = areas.map(() => new Map());
    for (let t = ini; t <= to; t += passo) buckets.forEach((b) => b.set(t, 0));
    for (const e of ev) { const t = new Date(e.criado_em).getTime(); if (t < ini) continue; const k = ini + Math.floor((t - ini) / passo) * passo; const b = buckets[areas.indexOf(areaDoEvento(e))]; b.set(k, (b.get(k) || 0) + 1); }
    DCChart.line(card('Erros registrados', `Erros do App, do Admin e da API por ${passo === 3600000 ? 'hora' : passo === 86400000 ? 'dia' : '6 horas'}`), { series: V.errors?.ok ? areas.map((n, i) => ({ name: n, color: PAL[i], points: [...buckets[i]].map(([t, v]) => ({ t, v })) })) : [], unit: '', decimals: 0, from, to, legend: true, label: 'Erros registrados por período', empty: V.errors?.ok ? 'Sem eventos de erro.' : (V.errors?.error || 'Registro de erros indisponível.') });
    DCChart.line(card('Recursos', 'Uso de CPU, RAM e disco do banco e memória do Worker (%)'), { series: REC.map(([k, n], i) => ({ name: n, color: PAL[i], points: pts(k) })), unit: '%', yMax: 100, from, to, legend: true, references: [{ v: 80, label: 'alerta', tone: 'warn' }, { v: 90, label: 'crítico', tone: 'bad' }], label: 'Uso de recursos em porcentagem', empty: r.ok ? 'Sem leituras de recursos neste período.' : (r.error || 'Histórico indisponível.') });
    // Honestidade sobre densidade e cobertura.
    const n = pts('probe:ready').length || pts('supabase:memory_usage_percent').length, avisos = [];
    if (r.ok && n < Math.min(6, h / 4)) avisos.push(`Só ${n} leitura(s) neste período: hoje as coletas vêm do cron diário e das varreduras manuais. Ative a varredura horária (GitHub Actions, ver SCHEDULER.md) para curvas mais densas.`);
    if (cheio) avisos.push(`O gráfico de erros usa os últimos ${limite} eventos (desde ${DC.dateTimeFmt.format(new Date(desde))}); antes disso não há dado carregado.`);
    note.hidden = !avisos.length; note.textContent = avisos.join(' ');
  }

  // ------------------------------------------------------------- drawers
  function drawerComponente(id) {
    const c = componentes().find((x) => x.id === id); if (!c) return;
    const rel = c.relacionados || [];
    DC.openDrawer(c.nome, `<div class="dc-ov-drawer-head">${marca(c)}${DC.chip(TONE_LABEL[c.tone], c.tone === 'neutral' ? 'neutral' : c.tone)}</div>
      <h3 class="dc-nc-h">O que está acontecendo</h3><p class="dc-ov-p">${esc(c.frase)}</p>
      ${c.medidas?.length ? `<h3 class="dc-nc-h">Medições agora</h3><div class="dc-list">${c.medidas.map(([k, v]) => `<div class="dc-row" style="grid-template-columns:1fr auto"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      ${rel.length ? `<h3 class="dc-nc-h">Problemas relacionados</h3>${rel.slice(0, 6).map((p) => `<div class="dc-ov-inc ${SEV[p.severidade]?.[2] || 'info'}"><header>${DC.chip(SEV[p.severidade]?.[1] || p.severidade, SEV[p.severidade]?.[2] || 'info')}<strong>${esc(p.titulo)}</strong></header>${p.explicacao?.oQue ? `<p>${esc(p.explicacao.oQue)}</p>` : ''}${p.explicacao?.comoResolver?.length ? `<p><b>Como resolver:</b> ${esc(p.explicacao.comoResolver.join(' '))}</p>` : ''}</div>`).join('')}` : ''}
      <p class="dc-muted" style="margin-top:10px;font-size:9.5px">Verificado ${esc(new Date().toLocaleTimeString('pt-BR'))}.</p>`, { footer: `<a class="dc-btn primary" href="${c.href}">Abrir ${esc(c.pagina)}</a>` });
  }

  function drawerFluxo(id) {
    const f = FLOWS.find((x) => x.id === id); if (!f) return;
    const fs = fontes().filter((x) => f.areas.includes(x.area)), rel = problemas().filter((p) => f.areas.includes(p.dominio));
    DC.openDrawer(f.nome, `<p class="dc-ov-p">${esc(f.desc)}.</p>
      <h3 class="dc-nc-h">Etapas testadas agora</h3><div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Etapa</th><th>Endpoint</th><th>Resultado</th><th>Tempo</th></tr></thead><tbody>${fs.map((x) => `<tr><td>${esc(x.label)}</td><td class="dc-mono">${esc(x.path)}</td><td>${x.naoConfigurado ? DC.chip('Sem conector', 'neutral') : x.ok ? DC.chip('OK', 'ok') : DC.chip(`HTTP ${x.status || '—'}`, 'bad')}</td><td>${x.naoConfigurado ? '—' : ms(x.ms)}</td></tr>`).join('')}</tbody></table></div>
      ${fs.some((x) => !x.ok && !x.naoConfigurado) ? '<div class="dc-warn-box" style="margin-top:8px">Uma etapa sem resposta costuma ser: deploy com erro, variável faltando no Sra Luck ou banco indisponível. A Central de Problemas mostra a causa provável e a correção.</div>' : ''}
      <h3 class="dc-nc-h">Problemas neste fluxo</h3>${rel.length ? rel.map((p) => `<div class="dc-ov-inc ${SEV[p.severidade]?.[2] || 'info'}"><header>${DC.chip(SEV[p.severidade]?.[1] || p.severidade, SEV[p.severidade]?.[2] || 'info')}<strong>${esc(p.titulo)}</strong></header>${p.impacto ? `<p><b>Impacto:</b> ${esc(p.impacto)}</p>` : ''}${p.explicacao?.comoResolver?.[0] ? `<p><b>O que fazer:</b> ${esc(p.explicacao.comoResolver[0])}</p>` : ''}</div>`).join('') : '<div class="dc-empty">Nenhum problema detectado neste fluxo.</div>'}`, { footer: '<a class="dc-btn primary" href="problemas.html">Central de Problemas</a>' });
  }

  // ------------------------------------------------------------- ciclo
  function renderTudo() {
    const comps = componentes(), incs = incidentes();
    renderHero(comps, incs); renderComponentes(comps); renderIncidentes(incs); renderFluxos(); renderMudancas();
    DC.$('lastRefresh').textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
    window.lucide?.createIcons();
  }

  async function atualizar(completo = true) {
    if (!await DC.guard()) return;
    DC.setTopStatus('Atualizando…', 'warn');
    await Promise.all([carregarBase(), completo || !V.problemas ? carregarProblemas() : null, completo || !V.changes ? carregarMudancas() : null]);
    renderTudo();
    renderHistorico();
  }

  async function varredura(btn) {
    const r = await DC.action(btn, () => DC.api('/api/infra-scan', { method: 'POST', body: {}, timeout: 60000 }), { success: 'Varredura concluída e gravada no histórico.' });
    if (r?.ok) atualizar(true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    DC.$('refreshBtn').onclick = () => atualizar(true);
    DC.$('scanBtn').onclick = (e) => varredura(e.currentTarget);
    DC.$('components').addEventListener('click', (e) => { const b = e.target.closest('[data-comp]'); if (b) drawerComponente(b.dataset.comp); });
    DC.$('flows').addEventListener('click', (e) => { const b = e.target.closest('[data-flow]'); if (b) drawerFluxo(b.dataset.flow); });
    DC.$('histRange').addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (!b) return; S.hours = Number(b.dataset.h); DC.$('histRange').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); renderHistorico(); });
    atualizar(true);
    DC.poll(() => atualizar(false), 60000);
    DC.poll(() => { carregarProblemas().then(renderTudo); }, 180000);
    DC.poll(() => { carregarMudancas().then(renderTudo); }, 300000);
  });
})();
