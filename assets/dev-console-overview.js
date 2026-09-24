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
  // Erros por período a partir dos eventos carregados. Se a lista veio cheia (limite), não há dado antes
  // do evento mais antigo: a série começa ali, sem inventar zeros.
  const LIMITE_EVENTOS = 250;
  const inicioEventos = () => { const ev = eventos(); return ev.length >= LIMITE_EVENTOS ? Math.min(...ev.map((e) => new Date(e.criado_em).getTime())) : null; };
  function serieErros(area, from, to, passo) {
    const ini = Math.max(from, Math.floor((inicioEventos() ?? from) / passo) * passo), b = new Map();
    for (let t = ini; t <= to; t += passo) b.set(t, 0);
    for (const e of eventos()) { const t = new Date(e.criado_em).getTime(); if (t < ini || areaDoEvento(e) !== area) continue; const k = ini + Math.floor((t - ini) / passo) * passo; b.set(k, (b.get(k) || 0) + 1); }
    return [...b].map(([t, v]) => ({ t, v }));
  }
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
        frase: tone === 'neutral' ? 'Sem conector com o Sra Luck: não dá para testar o app daqui.' : tone === 'bad' ? `O monitoramento do app não respondeu (HTTP ${f.status || 'sem resposta'}).` : rel.length ? `Funciona, com ${rel.length} ponto(s) de atenção: ${rel[0].titulo}.` : fatais ? `Funciona, mas teve ${fatais} erro(s) fatal(is) nas últimas 24 h.` : 'Respondendo normalmente.',
        metrica: V.errors?.ok ? `${e24.length} erro(s) em 24 h` : '', relacionados: rel,
        medidas: [['Teste do app', f ? (f.ok ? `OK · ${ms(f.ms)}` : `Falhou · HTTP ${f.status || '—'}`) : '—', 'teste'], ['Erros em 24 h', V.errors?.ok ? String(e24.length) : 'indisponível'], ['Erros fatais em 24 h', V.errors?.ok ? String(fatais) : 'indisponível']] });
    }
    // Admin
    {
      const fa = fs.filter((x) => ADMIN_AREAS.includes(x.area) && !x.naoConfigurado), falhas = fa.filter((x) => !x.ok), rel = ps.filter((p) => ADMIN_AREAS.includes(p.dominio)), e24 = errosDesde('Admin', 24);
      const tone = !prob() || !fa.length ? 'neutral' : falhas.length ? 'bad' : graves(rel).length ? 'warn' : 'ok';
      out.push({ id: 'admin', nome: 'Admin', icone: 'layout-dashboard', tone, href: 'sistema.html', pagina: 'Admin Sra Luck',
        frase: tone === 'neutral' ? 'Sem conector com o Sra Luck: as funções do Admin não puderam ser testadas.' : falhas.length ? `${falhas.length} função(ões) do Admin sem resposta: ${falhas.map((x) => x.label).slice(0, 2).join(', ')}.` : graves(rel).length ? `Funções respondendo, mas ${graves(rel).length} problema(s) importante(s) na operação.` : `Todas as ${fa.length} funções testadas responderam.`,
        metrica: fa.length ? `${fa.length - falhas.length}/${fa.length} funções` : '', relacionados: rel,
        medidas: fa.map((x) => [x.label, x.ok ? `OK · ${ms(x.ms)}` : `Falhou · HTTP ${x.status || '—'}`, 'teste']).concat([['Erros em 24 h', V.errors?.ok ? String(e24.length) : 'indisponível']]) });
    }
    // API / Worker
    {
      const h = V.health, r = V.ready, er = signal('cloudflare', 'worker_error_rate_percent');
      const tone = !r ? 'neutral' : !r.ok ? 'bad' : er?.state === 'critical' ? 'bad' : er?.state === 'warning' || (r.ms || 0) > 1500 ? 'warn' : 'ok';
      out.push({ id: 'api', nome: 'API / Worker', icone: 'server', tone, href: 'infraestrutura.html', pagina: 'Infraestrutura',
        frase: tone === 'bad' && !r.ok ? 'A API do Sra Luck não está pronta: App e Admin podem não carregar.' : er?.state && er.state !== 'healthy' ? `Taxa de erro do Worker em ${pct(er.value)}.` : (r?.ms || 0) > 1500 ? `API lenta: prontidão levou ${ms(r.ms)}.` : 'API pronta e respondendo.',
        metrica: r?.ok ? ms(r.ms) : r ? `HTTP ${r.status || '—'}` : '', relacionados: [],
        medidas: [['/api/health', h ? (h.ok ? `OK · ${ms(h.ms)}` : `Falhou · HTTP ${h.status || '—'}`) : '—'], ['/api/ready', r ? (r.ok ? `OK · ${ms(r.ms)}` : `Falhou · HTTP ${r.status || '—'}`) : '—', 'teste'], ['Taxa de erro do Worker', er ? pct(er.value) : 'sem leitura']] });
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
    for (const c of out) c.relacionados = problemas().filter((p) => compDoProblema(p) === c.id);
    return out;
  }

  // ------------------------------------------------------------- dependências
  // Arquitetura real do sra-luck-react: App e Admin são o mesmo SPA (Vite) publicado na Vercel e
  // chamam /api/*, que roda o código de worker/ (Edge Function da Vercel em api/[...path].ts; o mesmo
  // Worker tem configuração Cloudflare em wrangler.jsonc). A API lê e grava no Supabase e no Storage.
  const DEPS = { app: ['api'], admin: ['api'], api: ['supabase', 'storage'], storage: ['supabase'], supabase: [], vercel: [], cloudflare: [] };
  const HOSPEDAGEM = { app: 'vercel', admin: 'vercel', api: 'vercel' };
  const RELACIONADO = { api: ['cloudflare'], cloudflare: ['api'] };
  const dependentes = (id) => Object.keys(DEPS).filter((k) => DEPS[k].includes(id));
  function compDoProblema(p) {
    const id = String(p.id || '');
    if (id.startsWith('plataforma:diagnostico')) return 'supabase';
    if (id === 'plataforma:storage') return 'storage';
    if (p.dominio === 'plataforma') return 'api';
    if (p.dominio === 'app') return 'app';
    if (ADMIN_AREAS.includes(p.dominio)) return 'admin';
    return null;
  }
  const COMP_DA_INFRA = { supabase: 'supabase', backups: 'supabase', cloudflare: 'cloudflare', storage: 'storage' };

  // ------------------------------------------------------------- mudanças e correlação
  // Só entram mudanças que podem alterar produção: deploys de produção e migrations na main.
  const H = 3600000, ANTES = 6 * H, TOLERANCIA = 15 * 60000;
  const dur = (v) => { const m = Math.max(1, Math.round(Math.abs(v) / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} dias`; };
  function mudancas() {
    const c = V.changes?.ok ? V.changes.data : null; if (!c) return [];
    const out = [];
    for (const d of c.deploy?.recentes || []) if (d.target === 'production' && d.createdAt) out.push({ tipo: 'deploy', t: Number(d.createdAt), titulo: d.message || 'Deploy de produção', ref: (d.sha || '').slice(0, 7) || 'sem commit', estado: d.state, atual: d.current });
    for (const m of c.migrations?.itens || []) if (m.alteradaEm) out.push({ tipo: 'migration', t: Date.parse(m.alteradaEm), titulo: m.arquivo, ref: (m.commit || '').slice(0, 7) });
    return out.filter((x) => Number.isFinite(x.t)).sort((a, b) => b.t - a.t);
  }
  // Mudanças entre 6 h antes e 15 min depois do início (tolerância de relógio). Proximidade no tempo é pista, não prova.
  function mudancasPerto(ancora) {
    const t0 = Date.parse(ancora || ''); if (!Number.isFinite(t0)) return [];
    return mudancas().filter((m) => m.t >= t0 - ANTES && m.t <= t0 + TOLERANCIA).map((m) => ({ ...m, delta: t0 - m.t })).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  }
  const quandoRel = (m) => (m.delta == null ? quando(new Date(m.t).toISOString()) : m.delta >= 0 ? `${dur(m.delta)} antes do início` : 'junto com o início');
  const chipMudanca = (m) => `<span class="dc-ov-link-chip ${m.tipo}"><i data-lucide="${m.tipo === 'deploy' ? 'rocket' : 'database'}"></i>${m.tipo === 'deploy' ? `Deploy ${esc(m.ref)}` : esc(m.titulo.replace(/^migration_/, '').replace(/\.sql$/, ''))} · ${esc(quandoRel(m))}</span>`;

  // Causas mais comuns de cada sinal de infraestrutura (texto fixo, marcado como hipótese).
  const CAUSA_INFRA = {
    memory_usage_percent: 'Consultas pesadas, conexões demais ou dados crescendo além do que o plano do banco comporta.',
    swap_usage_percent: 'Falta de RAM: o banco passou a usar disco como memória.',
    cpu_usage_percent: 'Consultas sem índice ou alguma rotina pesada rodando.',
    disk_usage_percent: 'Crescimento de dados e logs (monitoramento, auditoria) sem limpeza.',
    oom_kills_delta: 'Memória esgotada: o banco derrubou processos.',
    postgres_restarts_delta: 'Reinício do banco (manutenção do Supabase, falta de memória ou falha).',
    worker_memory_p99_percent: 'Respostas muito grandes ou objetos acumulando em memória no Worker.',
    worker_error_rate_percent: 'Requisições falhando no Worker; os erros 5xx aparecem na Central de Problemas.',
    backup_age_hours: 'O backup automático não rodou ou o plano não tem backup diário.',
    guardian_age_hours: 'O agendador (cron da Vercel ou GitHub Actions) não está disparando a varredura, ou o CRON_SECRET não confere.',
    storage_unavailable: 'Bucket ausente, sem permissão ou credencial do Storage inválida.',
    provider_unavailable: 'A credencial da fonte de monitoramento expirou ou está errada.',
  };

  function diagnosticar(i, byId) {
    const perto = mudancasPerto(i.ancora), dep = perto.find((m) => m.tipo === 'deploy'), mig = perto.find((m) => m.tipo === 'migration');
    const sinc = V.changes?.ok ? V.changes.data.sincronia : null, s = i.http == null ? null : Number(i.http) || 0;
    const base = [], partes = [];
    let forca = 'hipotese';
    const raiz = (DEPS[i.comp] || []).map((id) => byId[id]).find((c) => c?.tone === 'bad');
    if (raiz) { partes.push(`Efeito provável de ${raiz.nome}, que está com falha: ${raiz.frase}`); base.push(`${raiz.nome} com falha agora`); forca = 'evidencia'; }
    else if (s != null) {
      base.push(s ? `resposta HTTP ${s}` : 'sem resposta do servidor');
      forca = 'evidencia';
      if (s === 0) partes.push('O servidor não respondeu a tempo: API fora do ar, travada ou lenta demais.');
      else if (s === 401 || s === 403) partes.push('Acesso negado: token do conector, permissão do cargo ou allowlist M2M. Não indica código quebrado.');
      else if (s === 404) partes.push(sinc?.estado === 'producao_atras' ? `A rota não existe na versão publicada, e a produção está ${sinc.commitsAtras} commit(s) atrás da main: ela pode existir só na main.` : 'A rota não existe na versão publicada (renomeada, removida ou ainda não publicada).');
      else if (s >= 500) partes.push('Erro dentro do servidor do Sra Luck: código ou algo de que ele depende (banco, integração).');
    } else if (i.causaBase) { partes.push(i.causaBase); forca = i.causaForca || 'hipotese'; }
    if (dep && !raiz) {
      partes.push(`Começou ${dep.delta >= 0 ? `${dur(dep.delta)} depois` : 'junto'} do deploy de produção ${dep.ref} ("${dep.titulo}"): é o principal suspeito. Compare com o deploy anterior ou faça rollback em Engenharia.`);
      base.push('proximidade no tempo com um deploy');
    }
    if (mig && !raiz && (s >= 500 || String(i.key).includes('diagnostico'))) {
      partes.push(`A migration ${mig.titulo} entrou na main ${dur(mig.delta)} antes. Se ela ainda não foi aplicada no banco, o código pode estar procurando coluna ou tabela que não existe.`);
      base.push('migration recente (a aplicação no banco não é verificável daqui)');
    }
    if (!partes.length) return { texto: 'As evidências atuais não apontam uma causa. Veja evidências e linha do tempo no detalhe.', forca: 'sem', base, perto };
    return { texto: partes.join(' '), forca, base, perto };
  }
  const FORCA = { evidencia: ['baseada em evidência', 'ok'], hipotese: ['hipótese', 'warn'], sem: ['sem causa identificada', 'neutral'] };

  // ------------------------------------------------------------- incidentes
  function incidentes(comps) {
    const itens = [], I = infra(), ch = V.changes?.ok ? V.changes.data : null, fs = fontes();
    const byId = Object.fromEntries((comps || componentes()).map((c) => [c.id, c]));
    const temProblema = (id) => problemas().some((p) => p.id === id);
    if (V.ready && !V.ready.ok && !temProblema('plataforma:ready')) itens.push({ key: 'ready', sev: 'critical', comp: 'api', http: V.ready.status || 0, titulo: 'API do Sra Luck não está pronta', contexto: `/api/ready respondeu HTTP ${V.ready.status || 'sem resposta'} agora`, impacto: 'Clientes e equipe podem não conseguir usar o App e o Admin.', passos: ['Abra Infraestrutura e confira Worker, banco e variáveis.', 'Veja em Engenharia se houve deploy recente; se sim, considere rollback.'], evid: [['/api/ready', `HTTP ${V.ready.status || '—'} · ${ms(V.ready.ms)}`]], href: 'infraestrutura.html' });
    for (const p of problemas()) {
      if (p.severidade === 'info') continue;
      const id = String(p.id), fonte = id.startsWith('funcao:') ? fs.find((x) => `funcao:${x.id}` === id) : id === 'plataforma:ready' ? fs.find((x) => x.id === 'ready') : null;
      const http = fonte ? (fonte.status || 0) : p.pacote?.status_http != null ? Number(p.pacote.status_http) : null;
      // Erros agrupados só olham as últimas 24 h: um "desde" colado no limite não é o início real.
      const ancora = id.startsWith('bug:') && p.desde && Date.now() - Date.parse(p.desde) > 23 * H ? null : p.desde || null;
      const operacional = ['operacional', 'dados', 'configuracao'].includes(p.tipo) && http == null;
      itens.push({ key: id, sev: p.severidade, comp: compDoProblema(p), http, ancora, ultima: p.ultimaVez || p.incidente?.ultimaVez || null, reaberto: p.incidente?.status === 'reopened',
        titulo: p.titulo, contexto: [p.ocorrencias > 1 ? `${p.ocorrencias} ocorrências` : null, ancora ? `desde ${quando(ancora)}` : null].filter(Boolean).join(' · '),
        impacto: p.impacto || p.explicacao?.porQue || '', passos: p.explicacao?.comoResolver || [],
        causaBase: operacional ? p.explicacao?.oQue || p.descricao : /^(bug|app:desempenho):/.test(id) ? p.explicacao?.porQue || null : null, causaForca: operacional ? 'evidencia' : 'hipotese',
        evid: [p.descricao ? ['Detalhe', p.descricao] : null, ...(p.evidencias || []).map((e) => [e.label, e.valor])].filter(Boolean), href: 'problemas.html', fix: (p.acoes || []).some((a) => a.tipo === 'seguro' || a.tipo === 'confirmar') });
    }
    for (const i of I?.incidents || []) {
      if (!['open', 'investigating', 'reopened'].includes(i.status)) continue;
      const src = i.metadata?.source, key = String(i.fingerprint || '').split(':')[2] || '', txt = INFRA_TXT[src] || ['Recurso de infraestrutura fora do normal.', 'Veja o detalhe em Infraestrutura.'], sg = signal(src, key);
      itens.push({ key: i.fingerprint || i.id, sev: i.severity === 'critical' ? 'critical' : i.severity === 'high' ? 'high' : 'warning', comp: COMP_DA_INFRA[src] || null, http: null, ancora: i.status === 'reopened' ? null : i.first_seen_at, ultima: i.last_seen_at, reaberto: i.status === 'reopened',
        titulo: i.title, contexto: `desde ${quando(i.first_seen_at)} · ${i.occurrence_count || 1} leitura(s) acima do limite · última ${quando(i.last_seen_at)}`, impacto: txt[0], passos: [txt[1]], causaBase: CAUSA_INFRA[key] ? `Causas mais comuns: ${CAUSA_INFRA[key]}` : null,
        evid: [sg ? [sg.label || key, `${sg.unit === '%' ? pct(sg.value) : sg.value} agora (alerta ${sg.warn ?? '—'}, crítico ${sg.crit ?? '—'})`] : null, ['Primeira leitura', DC.dateTimeFmt.format(new Date(i.first_seen_at))], ['Leituras acima do limite', String(i.occurrence_count || 1)]].filter(Boolean), href: 'infraestrutura.html' });
    }
    if (ch?.ci?.status === 'completed' && ch.ci.conclusion === 'failure') itens.push({ key: 'ci', sev: 'high', comp: null, http: null, ancora: ch.ci.created_at, titulo: 'CI da main do Sra Luck falhou', contexto: `${ch.ci.name} · ${quando(ch.ci.updated_at || ch.ci.created_at)}`, impacto: 'O código mais recente não passou nos testes; publicá-lo pode quebrar algo.', passos: ['Abra Engenharia e veja o log do job que falhou.', 'Corrija na main ou re-rode se a falha for de infraestrutura do GitHub.'], causaBase: `O workflow "${ch.ci.name}" falhou no commit ${(ch.ci.head_sha || '').slice(0, 7)}; a causa exata está no log do job.`, causaForca: 'evidencia', evid: [['Workflow', ch.ci.name], ['Commit', (ch.ci.head_sha || '').slice(0, 7) || '—']], href: 'engenharia.html' });
    const prodDep = ch?.deploy?.producao, ultimoProd = (ch?.deploy?.recentes || []).find((d) => d.target === 'production');
    if (ultimoProd?.state === 'ERROR') itens.push({ key: 'deploy', sev: 'high', comp: 'vercel', http: null, ancora: null, titulo: 'Último deploy de produção falhou', contexto: quando(new Date(ultimoProd.createdAt).toISOString()), impacto: 'A versão nova não entrou no ar; as clientes seguem na anterior.', passos: ['Abra Engenharia, veja o erro de build e faça redeploy depois de corrigir.'], causaBase: 'O build ou a verificação do deploy falhou; a mensagem exata está no log de build da Vercel.', causaForca: 'evidencia', evid: [['Commit', (ultimoProd.sha || '').slice(0, 7) || '—'], ['Mensagem', ultimoProd.message || '—']], href: 'engenharia.html' });
    if (ch?.sincronia?.estado === 'producao_atras') {
      const s = ch.sincronia, doMain = (ch.deploy?.recentes || []).find((d) => d.sha && d.sha === s.mainSha);
      const causa = !doMain ? 'Nenhum dos 12 últimos deploys da Vercel é do commit atual da main: o deploy automático não rodou (desligado, fila ou limite diário de deploys do plano).' : doMain.state === 'ERROR' ? `O deploy do commit da main falhou (${doMain.target === 'production' ? 'produção' : 'preview'}): veja o log de build.` : doMain.target !== 'production' ? 'Existe deploy do commit da main, mas só como preview: falta promover para produção.' : `O deploy do commit da main está em ${String(doMain.state || '').toLowerCase()}.`;
      itens.push({ key: 'sync', sev: 'warning', comp: 'vercel', http: null, ancora: null, titulo: `Produção ${s.commitsAtras} commit(s) atrás da main`, contexto: `produção ${String(s.producaoSha).slice(0, 7)} · main ${String(s.mainSha).slice(0, 7)}`, impacto: 'Correções já integradas na main ainda não chegaram às clientes.', passos: ['Em Engenharia, faça o redeploy/promoção do commit da main (confira o CI antes).'], causaBase: causa, causaForca: 'evidencia', evid: [['Produção', `${String(s.producaoSha).slice(0, 7)}${prodDep?.message ? ` · ${prodDep.message}` : ''}`], ['Main', `${String(s.mainSha).slice(0, 7)}${ch.main?.message ? ` · ${ch.main.message}` : ''}`], ['Deploy do commit da main', doMain ? `${doMain.state} · ${doMain.target}` : 'não encontrado']], href: 'engenharia.html' });
    }
    for (const i of itens) { i.diag = diagnosticar(i, byId); i.acao = i.passos[0] || ''; }
    return itens.sort((a, b) => SEV[a.sev][0] - SEV[b.sev][0] || (b.diag.perto.length - a.diag.perto.length));
  }


  // ------------------------------------------------------------- render
  function renderHero(comps, incs) {
    const bad = comps.filter((c) => c.tone === 'bad').length, warn = comps.filter((c) => c.tone === 'warn').length, sem = comps.filter((c) => c.tone === 'neutral').length;
    const crit = incs.filter((i) => i.sev === 'critical' || i.sev === 'high').length;
    const flowsBad = FLOWS.filter((f) => fontes().some((x) => f.areas.includes(x.area) && !x.ok && !x.naoConfigurado)).length;
    const tone = bad || incs.some((i) => i.sev === 'critical') ? 'bad' : warn || incs.length ? 'warn' : sem === comps.length ? 'neutral' : 'ok';
    DC.$('ovDot').className = `dc-ov-dot ${tone}`;
    DC.$('ovTitle').textContent = tone === 'ok' ? 'Tudo funcionando' : tone === 'bad' ? 'Há falha afetando o sistema' : tone === 'warn' ? (incs.length ? `${incs.length} item(ns) pedem atenção` : `${warn} componente(s) em atenção`) : 'Ainda sem dados suficientes';
    DC.$('ovSub').textContent = tone === 'ok' ? 'Nenhum componente com falha e nenhum alerta aberto.' : tone === 'neutral' ? 'Configure o conector e as integrações de monitoramento para o painel ter evidência.' : `${bad ? `${bad} componente(s) com falha. ` : ''}${crit ? `${crit} alerta(s) importante(s). ` : ''}${incs.length - crit > 0 ? `${incs.length - crit} em observação.` : ''}`.trim() || 'Nenhum alerta aberto ainda; veja os componentes marcados abaixo.';
    // A primeira coisa a fazer: o alerta mais grave (e, entre iguais, o que tem mudança suspeita por perto).
    const top = incs[0], next = DC.$('ovNext');
    next.hidden = !top;
    if (top) next.innerHTML = `<span class="dc-ov-next-label">Próxima ação</span><span class="dc-ov-next-text"><strong>${esc(top.titulo)}</strong>${esc(top.acao || top.diag.texto)}</span><button class="dc-btn primary" data-inc="${esc(top.key)}"><i data-lucide="search"></i>Investigar</button>`;
    const ch = V.changes?.ok ? V.changes.data : null;
    const sinc = ch?.sincronia?.estado === 'sincronizado' ? ['Produção = main', 'ok'] : ch?.sincronia?.estado === 'producao_atras' ? [`Produção ${ch.sincronia.commitsAtras} atrás`, 'warn'] : ['Sincronia desconhecida', 'neutral'];
    DC.$('ovCounts').innerHTML = [DC.chip(`${incs.length} alerta(s)`, incs.length ? (crit ? 'bad' : 'warn') : 'ok'), DC.chip(prob() ? `${flowsBad} fluxo(s) com falha` : 'Fluxos não testados', prob() ? (flowsBad ? 'bad' : 'ok') : 'neutral'), DC.chip(sinc[0], sinc[1])].join('');
    DC.setTopStatus(tone === 'ok' ? 'Operação normal' : tone === 'bad' ? 'Falha em andamento' : tone === 'warn' ? 'Atenção operacional' : 'Sem evidência', tone === 'neutral' ? 'warn' : tone);
    const nb = DC.$('navBadge-problemas'); if (nb) { nb.textContent = crit; nb.style.display = crit ? 'inline-flex' : 'none'; }
  }

  const marca = (c) => (c.logo ? `<img class="dc-ov-logo" src="assets/logos/${c.logo}.svg" alt="">` : `<span class="dc-ov-icon"><i data-lucide="${c.icone}"></i></span>`);
  const ORDEM_TOM = { bad: 0, warn: 1, neutral: 2, ok: 3 };
  function renderComponentes(comps) {
    const byId = Object.fromEntries(comps.map((c) => [c.id, c]));
    DC.$('components').innerHTML = comps.slice().sort((a, b) => ORDEM_TOM[a.tone] - ORDEM_TOM[b.tone]).map((c) => {
      const raiz = c.tone === 'bad' || c.tone === 'warn' ? (DEPS[c.id] || []).map((id) => byId[id]).find((d) => d?.tone === 'bad') : null;
      return `<button class="dc-ov-comp ${c.tone}" data-comp="${c.id}">${marca(c)}<span class="dc-ov-comp-main"><strong>${esc(c.nome)}</strong><small>${esc(raiz ? `Efeito provável de ${raiz.nome}. ${c.frase}` : c.frase)}</small></span><span class="dc-ov-comp-metric">${esc(c.metrica || '')}</span>${DC.chip(TONE_LABEL[c.tone], c.tone === 'neutral' ? 'neutral' : c.tone)}</button>`;
    }).join('');
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
    const ev = eventos(), cheio = ev.length >= LIMITE_EVENTOS, desde = inicioEventos() ?? from;
    const passo = h <= 24 ? 3600000 : h <= 168 ? 6 * 3600000 : 86400000;
    const areas = ['App da cliente', 'Admin', 'API e rotinas'];
    DCChart.line(card('Erros registrados', `Erros do App, do Admin e da API por ${passo === 3600000 ? 'hora' : passo === 86400000 ? 'dia' : '6 horas'}`), { series: V.errors?.ok ? areas.map((n, i) => ({ name: n, color: PAL[i], points: serieErros(n, from, to, passo) })) : [], unit: '', decimals: 0, from, to, legend: true, label: 'Erros registrados por período', empty: V.errors?.ok ? 'Sem eventos de erro.' : (V.errors?.error || 'Registro de erros indisponível.') });
    DCChart.line(card('Recursos', 'Uso de CPU, RAM e disco do banco e memória do Worker (%)'), { series: REC.map(([k, n], i) => ({ name: n, color: PAL[i], points: pts(k) })), unit: '%', yMax: 100, from, to, legend: true, references: [{ v: 80, label: 'alerta', tone: 'warn' }, { v: 90, label: 'crítico', tone: 'bad' }], label: 'Uso de recursos em porcentagem', empty: r.ok ? 'Sem leituras de recursos neste período.' : (r.error || 'Histórico indisponível.') });
    // Honestidade sobre densidade e cobertura.
    const n = pts('probe:ready').length || pts('supabase:memory_usage_percent').length, avisos = [];
    if (r.ok && n < Math.min(6, h / 4)) avisos.push(`Só ${n} leitura(s) neste período: hoje as coletas vêm do cron diário e das varreduras manuais. Ative a varredura horária (GitHub Actions, ver SCHEDULER.md) para curvas mais densas.`);
    if (cheio) avisos.push(`O gráfico de erros usa os últimos ${LIMITE_EVENTOS} eventos (desde ${DC.dateTimeFmt.format(new Date(desde))}); antes disso não há dado carregado.`);
    note.hidden = !avisos.length; note.textContent = avisos.join(' ');
  }

  // ------------------------------------------------------------- drawers
  // ------------------------------------------------------------- render de incidentes
  const incHtml = (i) => `<article class="dc-ov-inc ${SEV[i.sev][2]}"><header>${DC.chip(SEV[i.sev][1], SEV[i.sev][2])}<strong>${esc(i.titulo)}</strong>${i.reaberto ? DC.chip('Voltou', 'purple') : ''}</header>
    ${i.contexto ? `<p class="ctx">${esc(i.contexto)}</p>` : ''}
    <p><b>Causa provável:</b> ${esc(i.diag.texto)} <span class="dc-ov-forca ${FORCA[i.diag.forca][1]}">${FORCA[i.diag.forca][0]}</span></p>
    ${i.impacto ? `<p><b>Impacto:</b> ${esc(i.impacto)}</p>` : ''}
    ${i.acao ? `<p><b>Próxima ação:</b> ${esc(i.acao)}</p>` : ''}
    ${i.diag.perto.length ? `<div class="dc-ov-links">${i.diag.perto.slice(0, 3).map(chipMudanca).join('')}</div>` : ''}
    <footer><button class="dc-btn" data-inc="${esc(i.key)}"><i data-lucide="search"></i>Investigar</button><a class="dc-btn" href="${i.href}">${i.fix ? 'Corrigir na Central' : 'Abrir página'}</a></footer></article>`;
  function renderIncidentes(incs) {
    const el = DC.$('incidents');
    if (!prob() && !infra()) { el.innerHTML = '<div class="dc-empty">Ainda não há evidência suficiente: problemas e infraestrutura não puderam ser lidos.</div>'; return; }
    if (!incs.length) { el.innerHTML = '<div class="dc-ov-allclear"><i data-lucide="shield-check"></i><div><strong>Nenhum alerta aberto</strong><p>Nada pede ação agora. Os fluxos e a infraestrutura continuam sendo vigiados.</p></div></div>'; return; }
    // Só o que exige ação fica aberto; o resto vai para "Em observação", recolhido.
    const agir = incs.filter((i) => i.sev === 'critical' || i.sev === 'high'), observar = incs.filter((i) => !agir.includes(i));
    const topo = agir.slice(0, 5);
    el.innerHTML = (topo.length ? topo.map(incHtml).join('') : '<div class="dc-ov-allclear"><i data-lucide="shield-check"></i><div><strong>Nada crítico agora</strong><p>Só itens em observação, abaixo. Nenhum pede ação imediata.</p></div></div>')
      + (agir.length > topo.length ? `<a class="dc-ov-more" href="problemas.html">+ ${agir.length - topo.length} outro(s) importante(s) na Central de Problemas</a>` : '')
      + (observar.length ? `<details class="dc-ov-watch"><summary><span>Em observação</span>${DC.chip(String(observar.length), 'warn')}<small>Não exigem ação agora; acompanhe se crescerem.</small></summary>${observar.map((i) => `<button class="dc-ov-watch-row" data-inc="${esc(i.key)}"><span class="dc-fn-dot warn"></span><span class="dc-ov-comp-main"><strong>${esc(i.titulo)}</strong><small>${esc(i.impacto || i.contexto || '')}</small></span>${i.diag.perto.length ? DC.chip('mudança próxima', 'info') : ''}</button>`).join('')}</details>` : '');
  }

  // ------------------------------------------------------------- drawer de incidente
  function linhaDoTempo(i) {
    const ev = [];
    if (i.ancora) ev.push({ t: Date.parse(i.ancora), txt: 'Início detectado', tipo: 'inicio' });
    if (i.ultima) ev.push({ t: Date.parse(i.ultima), txt: 'Última ocorrência', tipo: 'ultima' });
    const t0 = Date.parse(i.ancora || i.ultima || '') || Date.now();
    for (const m of mudancas()) if (m.t >= t0 - 24 * H && m.t <= Date.now()) ev.push({ t: m.t, txt: m.tipo === 'deploy' ? `Deploy de produção ${m.ref}${m.estado && m.estado !== 'READY' ? ` (${m.estado})` : ''} · ${m.titulo}` : `Migration ${m.titulo} entrou na main`, tipo: m.tipo, perto: i.diag.perto.some((x) => x.t === m.t && x.tipo === m.tipo) });
    return ev.filter((e) => Number.isFinite(e.t)).sort((a, b) => b.t - a.t);
  }
  function resumoTexto(i) {
    return [`[${SEV[i.sev][1]}] ${i.titulo}`, i.contexto, `Causa provável (${FORCA[i.diag.forca][0]}): ${i.diag.texto}`, i.impacto ? `Impacto: ${i.impacto}` : '', i.passos.length ? `O que fazer:\n${i.passos.map((p, n) => `${n + 1}. ${p}`).join('\n')}` : '',
      i.evid.length ? `Evidências:\n${i.evid.map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : '', i.diag.perto.length ? `Mudanças próximas:\n${i.diag.perto.map((m) => `- ${m.tipo} ${m.tipo === 'deploy' ? m.ref : m.titulo} (${quandoRel(m)})`).join('\n')}` : '', `Gerado pelo Dev Console em ${new Date().toLocaleString('pt-BR')}`].filter(Boolean).join('\n\n');
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); DC.toast('Resumo copiado.'); } catch { DC.toast('Não foi possível copiar neste navegador.', true); }
  }
  function drawerIncidente(key) {
    const comps = componentes(), i = incidentes(comps).find((x) => x.key === key); if (!i) return;
    const comp = comps.find((c) => c.id === i.comp), tl = linhaDoTempo(i);
    const ov = DC.openDrawer(i.titulo, `<div class="dc-ov-drawer-head">${DC.chip(SEV[i.sev][1], SEV[i.sev][2])}${i.reaberto ? DC.chip('Voltou depois de resolvido', 'purple') : ''}${comp ? `<button class="dc-btn" data-open-comp="${comp.id}">${esc(comp.nome)} · ${esc(TONE_LABEL[comp.tone])}</button>` : ''}</div>
      ${i.contexto ? `<p class="dc-ov-p dc-muted">${esc(i.contexto)}</p>` : ''}
      <h3 class="dc-nc-h">Causa provável <span class="dc-ov-forca ${FORCA[i.diag.forca][1]}">${FORCA[i.diag.forca][0]}</span></h3><p class="dc-ov-p">${esc(i.diag.texto)}</p>
      ${i.diag.base.length ? `<p class="dc-ov-p dc-muted">Com base em: ${esc(i.diag.base.join('; '))}.</p>` : ''}
      ${i.impacto ? `<h3 class="dc-nc-h">Impacto</h3><p class="dc-ov-p">${esc(i.impacto)}</p>` : ''}
      ${i.passos.length ? `<h3 class="dc-nc-h">O que fazer, em ordem</h3><ol class="dc-ov-steps">${i.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      ${i.evid.length ? `<h3 class="dc-nc-h">Evidências</h3><div class="dc-list">${i.evid.map(([k, v]) => `<div class="dc-row" style="grid-template-columns:minmax(90px,.4fr) 1fr"><span>${esc(k)}</span><b class="dc-ov-evid">${esc(v)}</b></div>`).join('')}</div>` : ''}
      <h3 class="dc-nc-h">Linha do tempo</h3>${tl.length ? `<ol class="dc-ov-tl">${tl.map((e) => `<li class="${e.tipo}${e.perto ? ' perto' : ''}"><time>${esc(DC.dateTimeFmt.format(new Date(e.t)))}</time><span>${esc(e.txt)}</span>${e.perto ? DC.chip('suspeita', 'warn') : ''}</li>`).join('')}</ol>` : `<div class="dc-empty">${V.changes?.ok ? 'Sem início registrado e sem mudanças nas 24 h anteriores.' : 'Não foi possível ler deploys e migrations agora.'}</div>`}
      ${!i.ancora ? '<p class="dc-ov-p dc-muted">O início deste problema não está registrado, então não dá para cruzar com mudanças com segurança.</p>' : ''}`,
      { footer: `<button class="dc-btn" data-copy><i data-lucide="copy"></i>Copiar resumo</button><a class="dc-btn primary" href="${i.href}">${i.fix ? 'Corrigir na Central' : 'Abrir página'}</a>` });
    ov.querySelector('[data-copy]').onclick = () => copiar(resumoTexto(i));
    ov.querySelector('[data-open-comp]')?.addEventListener('click', (e) => drawerComponente(e.currentTarget.dataset.openComp));
  }

  // ------------------------------------------------------------- drawer de componente
  // Séries gravadas a cada varredura que descrevem cada componente (mesma fonte dos gráficos da página).
  const COMP_SERIES = {
    app: { ms: [['probe:app', 'Monitoramento do app']], erros: 'App da cliente' },
    admin: { ms: [['probe:visaoGeral', 'Visão geral'], ['probe:v46', 'Jornada V46'], ['probe:validacoes', 'Validações'], ['probe:configuracoes', 'Configurações']], erros: 'Admin' },
    api: { ms: [['probe:ready', 'Prontidão'], ['probe:erros', 'Registro de erros']], erros: 'API e rotinas' },
    supabase: { ms: [['probe:diagnostico', 'Diagnóstico do banco']], pct: [['supabase:cpu_usage_percent', 'CPU'], ['supabase:memory_usage_percent', 'RAM'], ['supabase:disk_usage_percent', 'Disco']] },
    storage: { ms: [['probe:storage', 'Teste do Storage']] },
    cloudflare: { pct: [['cloudflare:worker_memory_p99_percent', 'Memória P99'], ['cloudflare:worker_error_rate_percent', 'Taxa de erro']] },
  };
  const FONTES_DO_COMP = { app: (f) => f.area === 'app', admin: (f) => ADMIN_AREAS.includes(f.area), api: (f) => f.id === 'ready' || f.id === 'erros', supabase: (f) => f.id === 'diagnostico', storage: (f) => f.id === 'storage' };
  const MUDA_COMP = { app: ['deploy'], admin: ['deploy'], api: ['deploy', 'migration'], supabase: ['migration'], vercel: ['deploy'] };

  function causaDoComponente(c, byId, incs) {
    if (c.tone === 'ok' || c.tone === 'neutral') return null;
    const raiz = (DEPS[c.id] || []).map((id) => byId[id]).find((d) => d?.tone === 'bad');
    if (raiz) return { texto: `Efeito provável de ${raiz.nome}, que está com falha. Resolva ${raiz.nome} primeiro.`, forca: 'evidencia', raiz };
    const top = incs.find((i) => i.comp === c.id);
    return top ? { texto: top.diag.texto, forca: top.diag.forca, inc: top } : null;
  }

  async function historicoComponente(c, box) {
    const cfg = COMP_SERIES[c.id];
    if (!cfg) {
      const deps = (V.changes?.ok ? V.changes.data.deploy?.recentes || [] : []).filter((d) => d.target === 'production');
      box.innerHTML = deps.length ? `<div class="dc-ov-deploys">${deps.map((d) => `<span class="dc-ov-deploy ${d.state === 'READY' ? 'ok' : d.state === 'ERROR' ? 'bad' : 'warn'}" title="${esc(`${d.state} · ${(d.sha || '').slice(0, 7)} · ${d.message || ''} · ${DC.dateTimeFmt.format(new Date(d.createdAt))}`)}"></span>`).reverse().join('')}</div><p class="dc-ov-p dc-muted">Últimos ${deps.length} deploys de produção, do mais antigo ao mais recente (passe o mouse para ver cada um).</p>` : `<div class="dc-empty">${V.changes?.ok ? 'Sem deploys de produção recentes.' : 'Não foi possível ler os deploys.'}</div>`;
      return;
    }
    const to = Date.now(), from = to - 24 * H, keys = [...(cfg.ms || []), ...(cfg.pct || [])].map((x) => x[0]);
    const r = keys.length ? await DC.api(`/api/infra-history?series=${encodeURIComponent(keys.join(','))}&hours=24`) : { ok: true, data: { series: {} } };
    if (!box.isConnected) return;
    const data = r.ok ? r.data.series || {} : {}, pts = (k) => (data[k] || []).map((p) => ({ t: p.observed_at, v: p.metric_value }));
    const add = (titulo) => { const d = document.createElement('div'); d.className = 'dc-ov-chart'; d.innerHTML = `<header><strong>${esc(titulo)}</strong></header><div></div>`; box.appendChild(d); return d.lastElementChild; };
    box.innerHTML = '';
    if (cfg.ms) DCChart.line(add('Tempo de resposta (24 h)'), { series: cfg.ms.map(([k, n], i) => ({ name: n, color: PAL[i], points: pts(k) })), unit: ' ms', from, to, legend: cfg.ms.length > 1, label: `Tempo de resposta de ${c.nome}`, empty: r.ok ? 'Sem leituras nas últimas 24 h.' : (r.error || 'Histórico indisponível.') });
    if (cfg.pct) DCChart.line(add('Uso de recursos (24 h)'), { series: cfg.pct.map(([k, n], i) => ({ name: n, color: PAL[i], points: pts(k) })), unit: '%', yMax: 100, from, to, legend: true, references: [{ v: 80, label: 'alerta', tone: 'warn' }, { v: 90, label: 'crítico', tone: 'bad' }], label: `Recursos de ${c.nome}`, empty: r.ok ? 'Sem leituras nas últimas 24 h.' : (r.error || 'Histórico indisponível.') });
    if (cfg.erros) { const s = serieErros(cfg.erros, from, to, H); DCChart.line(add('Erros por hora (24 h)'), { series: V.errors?.ok ? [{ name: cfg.erros, color: PAL[1], points: s }] : [], unit: '', decimals: 0, from, to, label: `Erros de ${c.nome} por hora`, empty: V.errors?.ok ? 'Sem eventos de erro.' : (V.errors?.error || 'Registro de erros indisponível.') }); }
  }

  function resumoComponente(c, causa, rel, fsC) {
    return [`${c.nome}: ${TONE_LABEL[c.tone]}`, c.frase, causa ? `Causa provável (${FORCA[causa.forca][0]}): ${causa.texto}` : '', c.medidas?.length ? `Medições:\n${c.medidas.map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : '',
      fsC.length ? `Testes:\n${fsC.map((f) => `- ${f.label} ${f.path}: ${f.naoConfigurado ? 'sem conector' : f.ok ? `OK ${ms(f.ms)}` : `HTTP ${f.status || 'sem resposta'}`}`).join('\n')}` : '', rel.length ? `Problemas:\n${rel.map((p) => `- [${SEV[p.severidade]?.[1] || p.severidade}] ${p.titulo}`).join('\n')}` : '', `Gerado pelo Dev Console em ${new Date().toLocaleString('pt-BR')}`].filter(Boolean).join('\n\n');
  }

  function drawerComponente(id) {
    const comps = componentes(), c = comps.find((x) => x.id === id); if (!c) return;
    const byId = Object.fromEntries(comps.map((x) => [x.id, x])), incs = incidentes(comps), causa = causaDoComponente(c, byId, incs);
    const rel = c.relacionados || [], outros = rel.filter((p) => p.severidade === 'info'), fsC = FONTES_DO_COMP[c.id] ? fontes().filter(FONTES_DO_COMP[c.id]) : [], incC = incs.filter((i) => i.comp === c.id);
    const depRow = (d, papel) => d ? `<button class="dc-ov-dep" data-open-comp="${d.id}"><span class="dc-fn-dot ${d.tone === 'neutral' ? 'neutral' : d.tone}"></span><span class="dc-ov-comp-main"><strong>${esc(d.nome)}</strong><small>${esc(papel)} · ${esc(d.frase)}</small></span>${DC.chip(TONE_LABEL[d.tone], d.tone === 'neutral' ? 'neutral' : d.tone)}</button>` : '';
    const deps = [...(DEPS[c.id] || []).map((x) => depRow(byId[x], 'depende de')), HOSPEDAGEM[c.id] ? depRow(byId[HOSPEDAGEM[c.id]], 'publicado por') : '', ...(RELACIONADO[c.id] || []).map((x) => depRow(byId[x], 'relacionado')), ...dependentes(c.id).map((x) => depRow(byId[x], 'é usado por'))].join('');
    // Medições que repetem um teste da tabela abaixo não aparecem duas vezes.
    const medidas = (c.medidas || []).filter((m) => !(fsC.length && m[2] === 'teste'));
    const tipos = MUDA_COMP[c.id] || [], muda = mudancas().filter((m) => tipos.includes(m.tipo) && Date.now() - m.t <= 72 * H);
    const ov = DC.openDrawer(c.nome, `<div class="dc-ov-drawer-head">${marca(c)}${DC.chip(TONE_LABEL[c.tone], c.tone === 'neutral' ? 'neutral' : c.tone)}${causa?.raiz ? DC.chip(`efeito de ${causa.raiz.nome}`, 'purple') : ''}</div>
      <h3 class="dc-nc-h">O que está acontecendo</h3><p class="dc-ov-p">${esc(c.frase)}</p>
      ${causa ? `<h3 class="dc-nc-h">Causa provável <span class="dc-ov-forca ${FORCA[causa.forca][1]}">${FORCA[causa.forca][0]}</span></h3><p class="dc-ov-p">${esc(causa.texto)}</p>${causa.inc?.acao ? `<p class="dc-ov-p"><b>Próxima ação:</b> ${esc(causa.inc.acao)}</p>` : ''}` : ''}
      ${incC.length ? `<h3 class="dc-nc-h">Alertas deste componente</h3><div class="dc-ov-watch-list">${incC.map((i) => `<button class="dc-ov-watch-row" data-inc="${esc(i.key)}"><span class="dc-fn-dot ${SEV[i.sev][2] === 'bad' ? 'bad' : 'warn'}"></span><span class="dc-ov-comp-main"><strong>${esc(i.titulo)}</strong><small>${esc(i.impacto || i.contexto || '')}</small></span>${DC.chip(SEV[i.sev][1], SEV[i.sev][2])}</button>`).join('')}</div>` : ''}
      <h3 class="dc-nc-h">Histórico</h3><div class="dc-ov-drawer-charts" id="compHist"><div class="dc-empty">Carregando histórico…</div></div>
      ${deps ? `<h3 class="dc-nc-h">Dependências</h3><div class="dc-ov-deps">${deps}</div>` : ''}
      <h3 class="dc-nc-h">Evidências agora</h3>
      ${medidas.length ? `<div class="dc-list">${medidas.map(([k, v]) => `<div class="dc-row" style="grid-template-columns:1fr auto"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : fsC.length ? '' : '<div class="dc-empty">Sem medições para este componente.</div>'}
      ${fsC.length ? `<div class="dc-table-wrap" style="margin-top:8px"><table class="dc-compact-table"><thead><tr><th>Teste</th><th>Endpoint</th><th>Resultado</th><th>Tempo</th></tr></thead><tbody>${fsC.map((x) => `<tr><td>${esc(x.label)}</td><td class="dc-mono">${esc(x.path)}</td><td>${x.naoConfigurado ? DC.chip('Sem conector', 'neutral') : x.ok ? DC.chip('OK', 'ok') : DC.chip(`HTTP ${x.status || '—'}`, 'bad')}</td><td>${x.naoConfigurado ? '—' : ms(x.ms)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${tipos.length ? `<h3 class="dc-nc-h">Mudanças nas últimas 72 h</h3>${muda.length ? `<div class="dc-ov-links">${muda.map((m) => chipMudanca({ ...m, delta: null })).join('')}</div>` : `<div class="dc-empty">${V.changes?.ok ? 'Nenhum deploy ou migration nas últimas 72 h.' : 'Não foi possível ler deploys e migrations.'}</div>`}` : ''}
      ${outros.length ? `<h3 class="dc-nc-h">Outros pontos (informativos)</h3><div class="dc-ov-watch-list">${outros.slice(0, 8).map((p) => `<button class="dc-ov-watch-row" ${p.severidade === 'info' ? '' : `data-inc="${esc(p.id)}"`}><span class="dc-fn-dot ${SEV[p.severidade]?.[2] === 'bad' ? 'bad' : SEV[p.severidade]?.[2] === 'warn' ? 'warn' : 'neutral'}"></span><span class="dc-ov-comp-main"><strong>${esc(p.titulo)}</strong><small>${esc(p.explicacao?.oQue || p.descricao || '')}</small></span></button>`).join('')}</div>` : ''}
      <p class="dc-muted" style="margin-top:10px;font-size:9.5px">Verificado ${esc(new Date().toLocaleTimeString('pt-BR'))}.</p>`,
      { footer: `<button class="dc-btn" data-copy><i data-lucide="copy"></i>Copiar resumo</button><a class="dc-btn primary" href="${c.href}">Abrir ${esc(c.pagina)}</a>` });
    ov.querySelector('[data-copy]').onclick = () => copiar(resumoComponente(c, causa, rel, fsC));
    ov.addEventListener('click', (e) => { const a = e.target.closest('[data-open-comp]'); if (a) return drawerComponente(a.dataset.openComp); const b = e.target.closest('[data-inc]'); if (b) drawerIncidente(b.dataset.inc); });
    historicoComponente(c, ov.querySelector('#compHist'));
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
    const comps = componentes(), incs = incidentes(comps);
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
    const investigar = (e) => { const b = e.target.closest('[data-inc]'); if (b) drawerIncidente(b.dataset.inc); };
    DC.$('incidents').addEventListener('click', investigar);
    DC.$('ovNext').addEventListener('click', investigar);
    DC.$('flows').addEventListener('click', (e) => { const b = e.target.closest('[data-flow]'); if (b) drawerFluxo(b.dataset.flow); });
    DC.$('histRange').addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (!b) return; S.hours = Number(b.dataset.h); DC.$('histRange').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); renderHistorico(); });
    atualizar(true);
    DC.poll(() => atualizar(false), 60000);
    DC.poll(() => { carregarProblemas().then(renderTudo); }, 180000);
    DC.poll(() => { carregarMudancas().then(renderTudo); }, 300000);
  });
})();
