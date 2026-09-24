const crypto = require('crypto');
const { rest, audit } = require('./supabase');
const { hasPermission } = require('./rbac');
const customApis = require('./custom-apis');
const { explicar } = require('./explain');

// Central de Problemas: detecta falhas do Admin, App da cliente, notificações,
// V46, financeiro e integrações usando somente as APIs oficiais do Sra Luck, e
// executa correções pelo backend (nunca pelo navegador). Regras:
// - L2 (seguro): ação idempotente/deduplicada no Sra Luck; pode rodar sozinha.
// - L3 (confirmar): muda estado de cliente; exige clique + confirmação humana.
// - Sem endpoint oficial = sem botão de correção (fica link/pacote técnico).

const DAY = 86400000;
const HOUR = 3600000;
const PERF_CODES = new Set(['APP_MEMORY_PRESSURE', 'APP_MAIN_THREAD_BLOCKED', 'APP_SLOW_LOAD']);
const SEVERITY_RANK = { critical: 0, high: 1, warning: 2, info: 3 };
const WRITE_BLOCK_CODES = {
  DEV_CONSOLE_M2M_READ_ONLY: 'O Sra Luck ainda está em modo somente leitura para o Dev Console. Ative DEV_CONSOLE_M2M_WRITE=1 na Vercel do sra-luck-react.',
  DEV_CONSOLE_MUTATION_NOT_ALLOWED: 'Esta correção não está liberada no conector do Sra Luck.',
  DEV_CONSOLE_ROLE_INSUFFICIENT: 'Seu papel no Dev Console não permite esta correção.',
};

function sraConfig() {
  return {
    base: String(process.env.SRA_LUCK_BASE_URL || 'https://sra-luck-react.vercel.app').replace(/\/$/, ''),
    token: String(process.env.SRA_LUCK_SERVICE_TOKEN || '').trim(),
  };
}

async function sraFetch(path, { method = 'GET', body, actor, requestId, timeoutMs = 15000 } = {}) {
  const { base, token } = sraConfig();
  const publicProbe = path === '/api/health' || path === '/api/ready';
  if (!publicProbe && !token) return { ok: false, status: 0, data: null, notConfigured: true, erro: 'Conector server-to-server com o Sra Luck não configurado.' };
  const headers = { Accept: 'application/json', 'x-request-id': requestId || crypto.randomUUID() };
  if (token) Object.assign(headers, { 'x-dev-console-token': token, 'x-dev-actor-id': actor?.id || 'problem-center', 'x-dev-actor-role': actor?.role || 'viewer' });
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store', redirect: 'manual' });
    const data = await response.json().catch(() => null);
    const codigo = data?.codigo || null;
    return { ok: response.ok, status: response.status, data, ms: Date.now() - started, codigo, erro: response.ok ? null : (WRITE_BLOCK_CODES[codigo] || data?.erro || `HTTP ${response.status}`) };
  } catch (e) {
    return { ok: false, status: 0, data: null, ms: Date.now() - started, erro: e?.name === 'AbortError' ? 'Tempo limite excedido.' : (e?.message || 'Falha de rede.') };
  } finally {
    clearTimeout(timer);
  }
}

// Cada fonte é também uma função espelhada do Admin: se a rota falha, a
// tela correspondente do Dev Console (e do Admin) está quebrada.
function monthRange() {
  const today = new Date().toISOString().slice(0, 10);
  return `inicio=${today.slice(0, 7)}-01&fim=${today}`;
}
const SOURCES = [
  ['ready', 'Prontidão da API', '/api/ready', 'plataforma'],
  ['diagnostico', 'Diagnóstico do banco', '/api/admin/diagnostico', 'plataforma'],
  ['storage', 'Storage de arquivos', '/api/admin/monitoramento-storage', 'plataforma'],
  ['erros', 'Erros do Admin e App', '/api/admin/monitoramento-erros?limite=300', 'plataforma'],
  ['visaoGeral', 'Visão geral do Admin', '/api/admin/visao-geral', 'admin'],
  ['configuracoes', 'Configurações do Admin', '/api/admin/configuracoes', 'admin'],
  ['staff', 'Equipe e permissões', '/api/admin/staff', 'admin'],
  ['v46', 'Jornada V46', '/api/admin/central/visao-geral', 'v46'],
  ['previsoes', 'Previsão de liberações', '/api/admin/previsao-liberacoes', 'v46'],
  ['validacoes', 'Validações financeiras', '/api/admin/financeiro/validacoes', 'financeiro'],
  ['financeiroResumo', 'Resumo financeiro', () => `/api/admin/financeiro/resumo?${monthRange()}`, 'financeiro'],
  ['app', 'App da cliente', '/api/admin/monitoramento-app', 'app'],
  ['clube', 'Clube de vantagens', '/api/admin/credit-ops/club/overview', 'clube'],
  ['recompensas', 'Catálogo de recompensas', '/api/admin/credit-ops/rewards', 'clube'],
  ['notificacoes', 'Notificações', '/api/admin/notificacoes/automacao', 'notificacoes'],
  ['vapid', 'Web Push (VAPID)', '/api/admin/integrations/web-push/vapid', 'notificacoes'],
  ['integracoes', 'Integrações', '/api/admin/integrations/status', 'integracoes'],
];

async function collect(actor) {
  const reader = { id: actor?.id || 'problem-center', role: 'viewer' };
  const paths = SOURCES.map(([, , path]) => (typeof path === 'function' ? path() : path));
  const results = await Promise.all(paths.map((path) => sraFetch(path, { actor: reader })));
  const data = {};
  const fontes = SOURCES.map(([id, label, , area], i) => {
    const r = results[i];
    // Storage e ready respondem 503 com corpo útil quando degradados.
    data[id] = r.data && (r.ok || r.status === 503) ? r.data : null;
    return { id, label, area, path: paths[i].split('?')[0], ok: r.ok, status: r.status, ms: r.ms ?? null, erro: r.erro || null, naoConfigurado: Boolean(r.notConfigured) };
  });
  return { data, fontes };
}

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function normalizeRoute(value) {
  return String(value || 'sem rota').split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 200);
}
function ageMs(iso) { const t = new Date(iso || 0).getTime(); return Number.isFinite(t) && t > 0 ? Date.now() - t : Infinity; }
function one(value) { return Array.isArray(value) ? value[0] : value; }

function problem(p) {
  return { ocorrencias: 1, evidencias: [], acoes: [], ...p, fingerprint: p.fingerprint || p.id };
}

const HANDLED_BY_DETECTOR = new Set(['ready', 'storage']);
function detectFunctions(fontes, out) {
  for (const f of fontes) {
    if (f.ok || f.naoConfigurado || HANDLED_BY_DETECTOR.has(f.id)) continue;
    const auth = f.status === 401 || f.status === 403;
    out.push(problem({ id: `funcao:${f.id}`, dominio: f.area === 'v46' || f.area === 'financeiro' || f.area === 'app' || f.area === 'notificacoes' || f.area === 'integracoes' ? f.area : 'admin', tipo: auth ? 'configuracao' : 'codigo', severidade: auth ? 'warning' : 'high', titulo: `Função "${f.label}" ${auth ? 'sem acesso pelo conector' : 'falhando'}`, descricao: `${f.path} respondeu ${f.status ? 'HTTP ' + f.status : 'sem resposta'}: ${f.erro || 'erro desconhecido'}.`, impacto: auth ? 'O Dev Console não consegue ler esta área; verifique token e allowlist do conector.' : 'A tela correspondente do Admin e do Dev Console pode estar quebrada.', evidencias: [{ label: 'Latência', valor: f.ms != null ? `${f.ms} ms` : '—' }], acoes: [{ id: 'link', label: 'Ver conexões', tipo: 'link', href: 'conexoes.html' }] }));
  }
}

function detectPlatform(data, fontes, out) {
  const ready = fontes.find(f => f.id === 'ready');
  if (ready && !ready.ok && !ready.naoConfigurado) {
    out.push(problem({ id: 'plataforma:ready', dominio: 'plataforma', tipo: 'infra', severidade: 'critical', titulo: 'Sra Luck não está pronto para atender', descricao: ready.status ? `/api/ready respondeu HTTP ${ready.status}.` : ready.erro, impacto: 'Clientes e equipe podem não conseguir usar o sistema.', acoes: [{ id: 'link', label: 'Ver infraestrutura', tipo: 'link', href: 'infraestrutura.html' }] }));
  }
  for (const check of data.diagnostico?.checks || []) {
    if (check.ok) continue;
    out.push(problem({ id: `plataforma:diagnostico:${hash(check.nome)}`, dominio: 'plataforma', tipo: 'infra', severidade: 'critical', titulo: `Falha no diagnóstico: ${check.nome}`, descricao: check.detalhe || 'Falha no serviço.', impacto: 'Leituras e gravações dessa tabela podem estar falhando.', evidencias: [{ label: 'Latência', valor: `${check.ms} ms` }], acoes: [{ id: 'link', label: 'Ver infraestrutura', tipo: 'link', href: 'infraestrutura.html' }] }));
  }
  const storage = data.storage;
  if (storage && storage.ok === false) {
    const bad = (storage.checks || []).filter(c => !(c.existe && c.acessivel && c.privado === true));
    out.push(problem({ id: 'plataforma:storage', dominio: 'plataforma', tipo: 'configuracao', severidade: bad.some(c => c.privado === false) ? 'critical' : 'high', titulo: 'Storage de arquivos com bucket crítico irregular', descricao: bad.map(c => `${c.id}: ${c.detalhe}`).join(' · ') || storage.erro || 'Storage indisponível.', impacto: 'Boletos, comprovantes, fotos e vouchers podem falhar no upload/download.', evidencias: bad.map(c => ({ label: c.id, valor: c.detalhe })), acoes: [{ id: 'link', label: 'Ver infraestrutura', tipo: 'link', href: 'infraestrutura.html' }] }));
  }
}

function detectBugs(data, out) {
  const eventos = (data.erros?.eventos || []).filter(e => ageMs(e.criado_em) <= DAY && e.nivel !== 'info');
  const groups = new Map();
  for (const e of eventos) {
    const perf = PERF_CODES.has(e.codigo);
    const route = normalizeRoute(e.detalhes?.url || e.rota);
    const key = perf ? `perf|${e.codigo}` : `${e.origem}|${e.codigo || ''}|${e.metodo || ''}|${e.status_http || ''}|${route}|${String(e.mensagem || '').replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, '#').slice(0, 80)}`;
    const g = groups.get(key) || { key, perf, codigo: e.codigo, origem: e.origem, metodo: e.metodo, status: e.status_http, rota: route, mensagem: e.mensagem, componente: e.componente, eventos: [] };
    g.eventos.push(e);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const total = g.eventos.length;
    const lastHour = g.eventos.filter(e => ageMs(e.criado_em) <= HOUR).length;
    const fatal = g.eventos.some(e => e.nivel === 'fatal');
    const server = Number(g.status) >= 500;
    const actors = new Set(g.eventos.map(e => e.actor_id).filter(Boolean)).size;
    const ordered = g.eventos.slice().sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
    const requestIds = ordered.map(e => e.request_id).filter(Boolean).slice(0, 10);
    const dominio = g.perf ? 'app' : /\/admin/.test(g.rota) ? 'admin' : /cliente|\/app|\/agenda|\/boletos|\/inicio/.test(g.rota) ? 'app' : 'plataforma';
    if (g.perf) {
      const maxDetalhe = (field) => Math.max(0, ...g.eventos.map(e => Number(e.detalhes?.[field]) || 0));
      const titulos = { APP_MEMORY_PRESSURE: 'App da cliente com pressão de memória', APP_MAIN_THREAD_BLOCKED: 'App da cliente travando a tela', APP_SLOW_LOAD: 'App da cliente carregando devagar' };
      const evid = g.codigo === 'APP_MEMORY_PRESSURE' ? [{ label: 'Maior uso de memória', valor: `${maxDetalhe('uso_pct')}% (${maxDetalhe('heap_usado_mb')} MB)` }]
        : g.codigo === 'APP_MAIN_THREAD_BLOCKED' ? [{ label: 'Maior travamento', valor: `${maxDetalhe('duracao_ms')} ms` }]
        : [{ label: 'Pior carregamento (LCP)', valor: `${maxDetalhe('lcp_ms')} ms` }];
      out.push(problem({ id: `app:desempenho:${g.codigo}`, dominio: 'app', tipo: 'codigo', severidade: total >= 5 || actors >= 3 ? 'high' : 'warning', titulo: titulos[g.codigo], descricao: `${total} ocorrência(s) nas últimas 24h em ${actors || 'pelo menos 1'} sessão(ões).`, impacto: 'A cliente percebe lentidão ou travamento no app.', ocorrencias: total, desde: ordered.at(-1)?.criado_em, ultimaVez: ordered[0]?.criado_em, evidencias: [...evid, { label: 'Telas afetadas', valor: [...new Set(g.eventos.map(e => normalizeRoute(e.rota)))].slice(0, 5).join(', ') }], pacote: pacoteTecnico(g, ordered), acoes: [{ id: 'pacote', label: 'Pacote técnico', tipo: 'pacote' }, { id: 'issue', label: 'Abrir issue no GitHub', tipo: 'issue' }] }));
      continue;
    }
    const severidade = fatal || server || lastHour >= 3 || total >= 10 ? 'high' : 'warning';
    const label = g.status ? `HTTP ${g.status}` : g.codigo || 'Erro';
    out.push(problem({
      id: `bug:${hash(g.key)}`, dominio, tipo: server || fatal ? 'codigo' : Number(g.status) === 401 || Number(g.status) === 403 ? 'permissao' : 'codigo', severidade,
      titulo: `${label} · ${g.metodo ? g.metodo + ' ' : ''}${g.rota}`,
      descricao: String(g.mensagem || '').slice(0, 300), impacto: actors > 1 ? `${actors} pessoas diferentes afetadas.` : 'Afeta quem passa por esta tela/rota.',
      ocorrencias: total, desde: ordered.at(-1)?.criado_em, ultimaVez: ordered[0]?.criado_em,
      evidencias: [{ label: 'Última hora', valor: String(lastHour) }, { label: 'Origem', valor: g.origem }, { label: 'Código', valor: g.codigo || '—' }, { label: 'Request IDs', valor: requestIds.slice(0, 3).join(', ') || '—' }],
      pacote: pacoteTecnico(g, ordered),
      acoes: [{ id: 'pacote', label: 'Pacote técnico', tipo: 'pacote' }, { id: 'issue', label: 'Abrir issue no GitHub', tipo: 'issue' }],
    }));
  }
}

function pacoteTecnico(g, ordered) {
  return {
    origem: g.origem, codigo: g.codigo, metodo: g.metodo, status_http: g.status, rota: g.rota, componente: g.componente,
    mensagem: g.mensagem, ocorrencias: ordered.length, primeiro: ordered.at(-1)?.criado_em, ultimo: ordered[0]?.criado_em,
    request_ids: ordered.map(e => e.request_id).filter(Boolean).slice(0, 20),
    amostras: ordered.slice(0, 5).map(e => ({ criado_em: e.criado_em, nivel: e.nivel, action: e.action, duration_ms: e.duration_ms, ambiente: e.ambiente, detalhes: e.detalhes })),
  };
}

function detectNotifications(data, out) {
  const n = data.notificacoes;
  const vapid = data.vapid;
  if (vapid && (vapid.configurado === false || vapid.validado === false)) {
    out.push(problem({ id: 'notificacoes:vapid', dominio: 'notificacoes', tipo: 'configuracao', severidade: 'critical', titulo: 'Web Push sem chave VAPID válida', descricao: vapid.detalhe || 'As chaves VAPID não estão configuradas ou não passam na validação.', impacto: 'Nenhuma notificação push chega às clientes.', acoes: [{ id: 'link', label: 'Abrir integrações', tipo: 'link', href: 'integracoes.html' }] }));
  }
  if (!n) return;
  const logs = (n.logs || []).filter(l => ageMs(l.created_at) <= DAY);
  const enviadas = logs.reduce((s, l) => s + (Number(l.push_enviadas) || 0), 0);
  const falhas = logs.reduce((s, l) => s + (Number(l.push_falhas) || 0), 0);
  const comErro = logs.filter(l => l.erro_mensagem || (l.status && l.status !== 'enviada'));
  if (falhas >= 3 && falhas / Math.max(1, enviadas + falhas) >= 0.2) {
    out.push(problem({ id: 'notificacoes:entrega', dominio: 'notificacoes', tipo: 'operacional', severidade: falhas / Math.max(1, enviadas + falhas) >= 0.5 ? 'critical' : 'high', titulo: 'Falha na entrega de notificações push', descricao: `${falhas} falha(s) contra ${enviadas} entrega(s) nas últimas 24h.`, impacto: 'Clientes deixam de receber lembretes de parcela e avisos da jornada.', ocorrencias: falhas, evidencias: [{ label: 'Taxa de falha', valor: `${Math.round(falhas / Math.max(1, enviadas + falhas) * 100)}%` }, ...comErro.slice(0, 3).map(l => ({ label: l.tipo || 'notificação', valor: String(l.erro_mensagem || l.push_status || l.status).slice(0, 160) }))], acoes: [{ id: 'link', label: 'Abrir notificações', tipo: 'link', href: 'notificacoes.html' }] }));
  }
  if (Number(n.pushSubscriptions) === 0 && (n.clientes || []).length > 0) {
    out.push(problem({ id: 'notificacoes:sem-inscricoes', dominio: 'notificacoes', tipo: 'operacional', severidade: 'warning', titulo: 'Nenhuma cliente com push ativo', descricao: 'Não existe nenhuma inscrição Web Push registrada.', impacto: 'Notificações só aparecem dentro do app.', acoes: [{ id: 'link', label: 'Ver App da cliente', tipo: 'link', href: 'app-cliente.html' }] }));
  }
  if (n.config?.atraso_habilitado === false && Number(n.atrasadas) > 0) {
    out.push(problem({ id: 'notificacoes:atraso-desligado', dominio: 'notificacoes', tipo: 'configuracao', severidade: 'warning', titulo: 'Lembrete de parcela atrasada está desligado', descricao: `${n.atrasadas} parcela(s) atrasada(s) sem lembrete automático porque a automação foi desligada.`, impacto: 'Confirme se é intencional; clientes em atraso não são avisadas.', acoes: [{ id: 'link', label: 'Abrir configuração', tipo: 'link', href: 'notificacoes.html' }] }));
  }
  const allLogs = n.logs || [];
  const lastOf = (tipo) => allLogs.filter(l => l.tipo === tipo).reduce((m, l) => (!m || new Date(l.created_at) > new Date(m) ? l.created_at : m), null);
  const freq = Math.max(1, Number(n.config?.frequencia_atraso_horas) || 24);
  if (n.config?.atraso_habilitado !== false && Number(n.atrasadas) > 0 && ageMs(lastOf('parcela_atrasada')) > (freq + 2) * HOUR) {
    out.push(problem({ id: 'notificacoes:rotina-atraso', dominio: 'notificacoes', tipo: 'operacional', severidade: 'high', titulo: 'Rotina de lembrete de parcela atrasada parada', descricao: `${n.atrasadas} parcela(s) atrasada(s) e nenhum lembrete enviado nas últimas ${freq + 2}h.`, impacto: 'Clientes em atraso não estão sendo lembradas.', evidencias: [{ label: 'Último envio', valor: lastOf('parcela_atrasada') || 'nunca' }], acoes: [{ id: 'notificacoes.verificar_atrasos', label: 'Rodar rotina agora', tipo: 'confirmar', descricao: 'Envia lembretes reais às clientes em atraso (hoje: um por parcela). Só roda com a sua confirmação.' }] }));
  }
  if (Number(n.aVencer) > 0 && ageMs(lastOf('parcela_vencer')) > 26 * HOUR) {
    out.push(problem({ id: 'notificacoes:rotina-vencimento', dominio: 'notificacoes', tipo: 'operacional', severidade: 'warning', titulo: 'Rotina de lembrete de vencimento sem execução recente', descricao: `${n.aVencer} parcela(s) vencem em até 2 dias e não houve lembrete nas últimas 26h.`, impacto: 'Clientes podem esquecer o vencimento.', evidencias: [{ label: 'Último envio', valor: lastOf('parcela_vencer') || 'nunca' }], acoes: [{ id: 'notificacoes.verificar_vencimentos', label: 'Rodar rotina agora', tipo: 'confirmar', descricao: 'Envia lembretes reais de vencimento (hoje: um por parcela). Só roda com a sua confirmação.' }] }));
  }
}

function v46Cards(data) {
  const filas = data.v46?.filas || {};
  return Object.entries(filas).flatMap(([fila, items]) => (items || []).map(c => ({ ...c, fila })));
}

function detectApp(data, out) {
  const cards = v46Cards(data);
  const aptas = cards.filter(c => c.ativo && !c.acessoAppLiberado && c.appAccess?.canRelease);
  if (aptas.length) {
    out.push(problem({ id: 'app:aptas-sem-acesso', dominio: 'app', tipo: 'operacional', severidade: aptas.length >= 5 ? 'high' : 'warning', titulo: 'Clientes aptas sem acesso ao app', descricao: `${aptas.length} cliente(s) já cumprem os requisitos (nome, CPF, nascimento e financeiro) e ainda não têm o app liberado.`, impacto: 'A cliente não consegue acompanhar parcelas e agenda pelo app.', ocorrencias: aptas.length, evidencias: aptas.slice(0, 8).map(c => ({ label: c.nome || c.id, valor: c.fila })), alvo: aptas.map(c => ({ id: c.id, nome: c.nome })), acoes: [{ id: 'app.liberar_acesso', label: `Liberar acesso (${Math.min(aptas.length, 25)})`, tipo: 'confirmar', descricao: 'A API oficial valida os requisitos de cada cliente antes de liberar.' }] }));
  }
  const incompletas = cards.filter(c => c.ativo && c.acessoAppLiberado && c.appAccess && !c.appAccess.canRelease);
  if (incompletas.length) {
    out.push(problem({ id: 'app:liberadas-cadastro-incompleto', dominio: 'app', tipo: 'dados', severidade: 'warning', titulo: 'App liberado com cadastro incompleto', descricao: `${incompletas.length} cliente(s) com acesso liberado, mas sem algum requisito obrigatório.`, impacto: 'Telas do app podem quebrar ou mostrar dados vazios.', ocorrencias: incompletas.length, evidencias: incompletas.slice(0, 8).map(c => ({ label: c.nome || c.id, valor: `falta: ${(c.appAccess.missing || []).join(', ')}` })), acoes: [{ id: 'link', label: 'Abrir Jornada V46', tipo: 'link', href: 'jornada-v46.html' }] }));
  }
  const cadastro = cards.filter(c => c.ativo && !c.acessoAppLiberado && c.appAccess && !c.appAccess.canRelease);
  if (cadastro.length) {
    const nomes = { nome: 'nome', cpf: 'CPF válido', data_nascimento: 'data de nascimento', financeiro: 'parcelas' };
    out.push(problem({ id: 'app:cadastro-incompleto', dominio: 'app', tipo: 'dados', severidade: 'info', titulo: 'Clientes com cadastro incompleto para o app', descricao: `${cadastro.length} cliente(s) ativas não podem receber acesso ao app porque falta algum dado obrigatório.`, impacto: 'Essas clientes não conseguem entrar no app até o cadastro ser completado no Admin.', ocorrencias: cadastro.length, evidencias: cadastro.slice(0, 8).map(c => ({ label: c.nome || c.id, valor: `falta: ${(c.appAccess.missing || []).map(m => nomes[m] || m).join(', ')}` })), acoes: [{ id: 'link', label: 'Abrir Jornada V46', tipo: 'link', href: 'jornada-v46.html' }] }));
  }
  const app = data.app;
  if (app?.resumo) {
    const liberadas = new Set(cards.filter(c => c.acessoAppLiberado).map(c => c.id));
    const nuncaAbriram = app.resumo.filter(r => liberadas.has(r.cliente_id) && !r.last_access_at);
    if (nuncaAbriram.length) {
      out.push(problem({ id: 'app:liberadas-sem-uso', dominio: 'app', tipo: 'operacional', severidade: 'info', titulo: 'Clientes com app liberado que nunca abriram', descricao: `${nuncaAbriram.length} cliente(s) ainda não acessaram o app após a liberação.`, impacto: 'Pode indicar problema de login ou falta de orientação.', ocorrencias: nuncaAbriram.length, evidencias: nuncaAbriram.slice(0, 8).map(r => ({ label: r.cliente?.nome_completo || r.cliente_id, valor: 'sem acesso registrado' })), acoes: [{ id: 'link', label: 'Ver App da cliente', tipo: 'link', href: 'app-cliente.html' }] }));
    }
    const bloqueadas = Number(app.metricas?.notificacoesBloqueadas) || 0;
    if (bloqueadas) {
      out.push(problem({ id: 'app:push-bloqueado', dominio: 'app', tipo: 'operacional', severidade: 'info', titulo: 'Clientes bloquearam notificações', descricao: `${bloqueadas} cliente(s) negaram permissão de notificação no aparelho.`, impacto: 'Só a própria cliente consegue reativar nas configurações do aparelho.', ocorrencias: bloqueadas, acoes: [{ id: 'link', label: 'Ver App da cliente', tipo: 'link', href: 'app-cliente.html' }] }));
    }
  }
}

function detectV46(data, out) {
  const hoje = data.v46?.hoje;
  if (!hoje) return;
  const cards = v46Cards(data);
  const semComparecimento = cards.filter(c => c.fila === 'financialRelease' && c.dataTermos && c.dataTermos < hoje && (c.comparecimentoStatus || 'pendente') === 'pendente');
  if (semComparecimento.length) {
    out.push(problem({ id: 'v46:comparecimento-pendente', dominio: 'v46', tipo: 'operacional', severidade: 'high', titulo: 'Termos já passaram sem comparecimento registrado', descricao: `${semComparecimento.length} cliente(s) com data de termos no passado e comparecimento ainda pendente.`, impacto: 'A jornada fica parada: prazo cirúrgico e quitação não avançam.', ocorrencias: semComparecimento.length, evidencias: semComparecimento.slice(0, 8).map(c => ({ label: c.nome || c.id, valor: `termos em ${c.dataTermos}` })), acoes: [{ id: 'link', label: 'Resolver na Jornada V46', tipo: 'link', href: 'jornada-v46.html' }] }));
  }
  const semQuitacao = cards.filter(c => c.comparecimentoStatus === 'compareceu' && (c.quitacaoStatus || 'pendente') === 'pendente' && c.dataTermos && ageMs(c.dataTermos) > 7 * DAY);
  if (semQuitacao.length) {
    out.push(problem({ id: 'v46:quitacao-pendente', dominio: 'v46', tipo: 'operacional', severidade: 'warning', titulo: 'Quitação pendente há mais de 7 dias após os termos', descricao: `${semQuitacao.length} cliente(s) compareceram, mas a quitação não foi registrada.`, impacto: 'Agenda cirúrgica não é liberada para essas clientes.', ocorrencias: semQuitacao.length, evidencias: semQuitacao.slice(0, 8).map(c => ({ label: c.nome || c.id, valor: `termos em ${c.dataTermos}` })), acoes: [{ id: 'link', label: 'Resolver na Jornada V46', tipo: 'link', href: 'jornada-v46.html' }] }));
  }
}

function detectFinance(data, out) {
  const itens = data.validacoes?.itens || [];
  const antigas = itens.filter(x => ageMs(x.updatedAt || x.createdAt || x.vencimento) > 2 * DAY);
  if (antigas.length) {
    out.push(problem({ id: 'financeiro:validacoes-atrasadas', dominio: 'financeiro', tipo: 'operacional', severidade: antigas.length >= 10 ? 'high' : 'warning', titulo: 'Comprovantes aguardando validação há mais de 48h', descricao: `${antigas.length} de ${itens.length} comprovante(s) pendentes estão parados.`, impacto: 'A parcela da cliente continua em aberto e pode gerar lembrete de atraso indevido.', ocorrencias: antigas.length, evidencias: antigas.slice(0, 8).map(x => ({ label: (typeof x.cliente === 'string' ? x.cliente : x.cliente?.nome) || x.id, valor: `vencimento ${x.vencimento || '—'}` })), acoes: [{ id: 'link', label: 'Validar no Financeiro', tipo: 'link', href: 'financeiro.html' }] }));
  }
}

function detectIntegrations(data, out) {
  for (const i of data.integracoes?.integracoes || []) {
    if (i.estado === 'base_incompleta') {
      out.push(problem({ id: `integracoes:base:${i.id}`, dominio: 'integracoes', tipo: 'configuracao', severidade: 'warning', titulo: `${i.nome}: base de dados incompleta`, descricao: i.detalhes || 'Tabelas/persistência necessárias não estão prontas.', impacto: 'A integração não consegue registrar eventos.', acoes: [{ id: 'link', label: 'Abrir integrações', tipo: 'link', href: 'integracoes.html' }] }));
    } else if (i.credenciaisConfiguradas && !i.conexaoLiveVerificada && i.estado !== 'planejado') {
      out.push(problem({ id: `integracoes:nao-verificada:${i.id}`, dominio: 'integracoes', tipo: 'configuracao', severidade: 'warning', titulo: `${i.nome}: conexão nunca verificada`, descricao: 'Há credenciais, mas nenhum teste de conexão bem-sucedido registrado.', impacto: 'Uma credencial inválida só seria percebida quando a integração falhar.', alvo: [{ id: i.id, nome: i.nome }], acoes: [{ id: 'integracoes.testar', label: 'Testar conexão', tipo: 'seguro' }] }));
    }
  }
}

function detectCustomApis(apis, out) {
  for (const a of apis || []) {
    if (!a.enabled || a.last_ok !== false) continue;
    out.push(problem({ id: `integracoes:custom:${a.id}`, dominio: 'integracoes', tipo: 'infra', severidade: 'high', titulo: `API "${a.name}" fora do ar`, descricao: a.last_error || `Resposta HTTP ${a.last_status}.`, impacto: a.description || 'Funções que dependem desta API podem falhar.', evidencias: [{ label: 'Endereço', valor: a.base_url + a.health_path }, { label: 'Latência', valor: a.last_ms != null ? `${a.last_ms} ms` : '—' }], acoes: [{ id: 'link', label: 'Abrir integrações', tipo: 'link', href: 'integracoes.html' }] }));
  }
}

// Números do dia que viram "boas notícias" (ou contexto) no feed dos agentes.
function sinaisPositivos(data, fontes, custom) {
  const ativas = fontes.filter((f) => !f.naoConfigurado);
  const eventos = data.erros?.eventos || [];
  const logs = (data.notificacoes?.logs || []).filter((l) => ageMs(l.created_at) <= DAY);
  const resumoApp = data.app?.resumo || [];
  const filas = data.v46?.filas || {};
  return {
    funcoesOk: ativas.filter((f) => f.ok).length,
    funcoesTotal: ativas.length,
    latenciaMedia: ativas.length ? Math.round(ativas.reduce((s, f) => s + (f.ms || 0), 0) / ativas.length) : null,
    erros24h: data.erros ? eventos.filter((e) => ageMs(e.criado_em) <= DAY && e.nivel !== 'info').length : null,
    erros1h: data.erros ? eventos.filter((e) => ageMs(e.criado_em) <= HOUR && e.nivel !== 'info').length : null,
    pushEnviadas24h: data.notificacoes ? logs.reduce((s, l) => s + (Number(l.push_enviadas) || 0), 0) : null,
    pushFalhas24h: data.notificacoes ? logs.reduce((s, l) => s + (Number(l.push_falhas) || 0), 0) : null,
    notificacoes24h: data.notificacoes ? logs.length : null,
    pushInscritos: data.notificacoes ? Number(data.notificacoes.pushSubscriptions) || 0 : null,
    clientesApp: data.app ? resumoApp.length : null,
    clientesAtivas7d: data.app ? resumoApp.filter((r) => ageMs(r.last_access_at) <= 7 * DAY).length : null,
    clientesHoje: data.app ? resumoApp.filter((r) => ageMs(r.last_access_at) <= DAY).length : null,
    appInstalado: data.app ? resumoApp.filter((r) => r.is_pwa_installed).length : null,
    jornada: data.v46 ? Object.fromEntries(Object.entries(filas).map(([k, v]) => [k, (v || []).length])) : null,
    validacoesPendentes: data.validacoes ? (data.validacoes.itens || []).length : null,
    integracoesConectadas: data.integracoes ? (data.integracoes.integracoes || []).filter((i) => i.conexaoLiveVerificada).length : null,
    apisNoAr: custom.apis.filter((a) => a.enabled && a.last_ok).length,
    apisTotal: custom.apis.filter((a) => a.enabled).length,
  };
}

async function detect(actor) {
  const [{ data, fontes }, custom] = await Promise.all([collect(actor), customApis.checkAll().catch(() => ({ available: false, apis: [] }))]);
  const problemas = [];
  detectFunctions(fontes, problemas);
  detectPlatform(data, fontes, problemas);
  detectBugs(data, problemas);
  detectNotifications(data, problemas);
  detectApp(data, problemas);
  detectV46(data, problemas);
  detectFinance(data, problemas);
  detectIntegrations(data, problemas);
  detectCustomApis(custom.apis, problemas);
  for (const p of problemas) p.explicacao = explicar(p);
  problemas.sort((a, b) => (SEVERITY_RANK[a.severidade] - SEVERITY_RANK[b.severidade]) || (b.ocorrencias - a.ocorrencias));
  const count = (s) => problemas.filter(p => p.severidade === s).length;
  const configurado = Boolean(sraConfig().token);
  return {
    ok: true, geradoEm: new Date().toISOString(), configurado,
    funcoes: { total: fontes.length, ok: fontes.filter(f => f.ok).length, falhando: fontes.filter(f => !f.ok && !f.naoConfigurado).length, naoConfiguradas: fontes.filter(f => f.naoConfigurado).length },
    resumo: { total: problemas.length, critical: count('critical'), high: count('high'), warning: count('warning'), info: count('info'), corrigiveis: problemas.filter(p => p.acoes.some(a => a.tipo === 'seguro' || a.tipo === 'confirmar')).length, fontesComFalha: fontes.filter(f => !f.ok && !f.naoConfigurado).length },
    fontes, problemas,
    sinais: sinaisPositivos(data, fontes, custom),
    apisPersonalizadas: { disponivel: custom.available, total: custom.apis.length, falhando: custom.apis.filter(a => a.enabled && a.last_ok === false).length },
  };
}

// Registro fechado de correções. O cliente só escolhe o id; rota e corpo são daqui.
const ACTIONS = {
  // Cobrança financeira nunca roda sozinha: exige confirmação humana (sem autoResolve).
  'notificacoes.verificar_atrasos': { permissao: 'notifications.manage', seguro: false, run: (ctx) => sraFetch('/api/admin/notificacoes/automacao', { method: 'POST', body: { acao: 'verificar_atrasos' }, ...ctx }) },
  'notificacoes.verificar_vencimentos': { permissao: 'notifications.manage', seguro: false, run: (ctx) => sraFetch('/api/admin/notificacoes/automacao', { method: 'POST', body: { acao: 'verificar_momentos_especiais' }, ...ctx }) },
  'integracoes.testar': {
    permissao: 'integrations.manage', seguro: true,
    run: async (ctx, prob) => {
      const alvo = prob.alvo?.[0];
      return sraFetch('/api/admin/integrations/testar-conexao', { method: 'POST', body: { provedor: alvo.id }, ...ctx });
    },
  },
  'app.liberar_acesso': {
    permissao: 'app.correct', seguro: false,
    run: async (ctx, prob, params) => {
      const allowed = new Map((prob.alvo || []).map(c => [c.id, c]));
      const ids = (Array.isArray(params?.clienteIds) && params.clienteIds.length ? params.clienteIds : [...allowed.keys()]).filter(id => allowed.has(id)).slice(0, 25);
      const itens = [];
      for (const id of ids) {
        const r = await sraFetch(`/api/admin/clientes/${encodeURIComponent(id)}/liberar-acesso-app`, { method: 'POST', body: {}, ...ctx });
        itens.push({ id, nome: allowed.get(id)?.nome || null, ok: r.ok, status: r.status, erro: r.erro });
        if (r.codigo && WRITE_BLOCK_CODES[r.codigo]) break;
      }
      const failed = itens.filter(x => !x.ok);
      return { ok: itens.length > 0 && failed.length === 0, status: failed[0]?.status || 200, erro: failed[0]?.erro || null, data: { itens } };
    },
  },
};

async function persistIncidents(result, observedAt) {
  const active = result.problemas.filter(p => p.severidade === 'critical' || p.severidade === 'high');
  const activeKeys = new Set(active.map(p => `problem:${p.fingerprint}`));
  let opened = 0, mitigated = 0;
  for (const p of active) {
    const fingerprint = `problem:${p.fingerprint}`;
    const severity = p.severidade;
    const metadata = { dominio: p.dominio, tipo: p.tipo, descricao: p.descricao, impacto: p.impacto, evidencias: p.evidencias, acoes: p.acoes.map(a => a.id) };
    let existing = [];
    try { existing = await rest(`dev_incidents?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=id,status,occurrence_count&limit=1`, { method: 'GET' }); } catch { continue; }
    try {
      if (existing[0]) {
        const row = existing[0];
        await rest(`dev_incidents?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ status: row.status === 'resolved' || row.status === 'mitigated' ? 'reopened' : row.status, severity, title: p.titulo, occurrence_count: Math.max(Number(row.occurrence_count || 0) + 1, p.ocorrencias || 1), last_seen_at: observedAt, metadata }) });
      } else {
        const created = await rest('dev_incidents', { method: 'POST', body: JSON.stringify({ fingerprint, title: p.titulo, module: p.dominio, severity, status: 'open', occurrence_count: p.ocorrencias || 1, affected_entities: p.alvo?.length || 0, first_seen_at: p.desde || observedAt, last_seen_at: observedAt, source: 'problems', source_reference: p.id, metadata }) });
        if (created?.[0]) await rest('dev_incident_events', { method: 'POST', body: JSON.stringify({ incident_id: created[0].id, event_type: 'opened', message: 'Central de Problemas detectou a falha.', details: { evidencias: p.evidencias } }) }).catch(() => undefined);
        opened++;
      }
    } catch { /* persistência é complementar à detecção */ }
  }
  try {
    const open = await rest('dev_incidents?source=eq.problems&status=in.(open,investigating,reopened)&select=id,fingerprint&limit=200', { method: 'GET' });
    for (const row of open || []) {
      if (activeKeys.has(row.fingerprint)) continue;
      await rest(`dev_incidents?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'mitigated', last_seen_at: observedAt }) });
      await rest('dev_incident_events', { method: 'POST', body: JSON.stringify({ incident_id: row.id, event_type: 'signal_recovered', message: 'O problema não foi mais detectado. Marcado como mitigado; confirme a resolução.' }) }).catch(() => undefined);
      mitigated++;
    }
  } catch { /* idem */ }
  return { opened, mitigated };
}

async function recordAction({ actor, problema, actionId, response, verificado, auto }) {
  const details = { problema: problema.id, acao: actionId, auto: Boolean(auto), status: response.status, ok: response.ok, erro: response.erro || null, verificado };
  await audit({ actor_user_id: actor?.uuid || null, action: auto ? 'problems.autofix' : 'problems.fix', resource: problema.dominio, resource_id: problema.id, details });
  try {
    const rows = await rest(`dev_incidents?fingerprint=eq.${encodeURIComponent(`problem:${problema.fingerprint}`)}&select=id&limit=1`, { method: 'GET' });
    if (rows?.[0]) await rest('dev_incident_events', { method: 'POST', body: JSON.stringify({ incident_id: rows[0].id, event_type: auto ? 'autofix_applied' : 'fix_applied', actor_user_id: actor?.uuid || null, message: `${auto ? 'Correção automática' : 'Correção'} "${actionId}" ${response.ok ? 'executada' : 'falhou'}${verificado ? ' e verificada' : ''}.`, details }) });
  } catch { /* idem */ }
}

async function applyAction({ actor, problemaId, actionId, params, auto = false }) {
  const def = ACTIONS[actionId];
  if (!def) return { status: 400, body: { erro: 'Correção desconhecida.', codigo: 'PROBLEM_ACTION_UNKNOWN' } };
  if (!auto && !hasPermission(actor, def.permissao)) return { status: 403, body: { erro: 'Seu perfil não possui permissão para esta correção.', codigo: 'DEV_PERMISSION_DENIED', permission: def.permissao } };
  const antes = await detect(actor);
  const problema = antes.problemas.find(p => p.id === problemaId);
  if (!problema) return { status: 409, body: { erro: 'Este problema não está mais ativo. Atualize a lista.', codigo: 'PROBLEM_NOT_ACTIVE', resolvido: true } };
  if (!problema.acoes.some(a => a.id === actionId)) return { status: 400, body: { erro: 'Esta correção não se aplica a este problema.', codigo: 'PROBLEM_ACTION_MISMATCH' } };
  const m2mActor = auto ? { id: 'problem-autofix', role: 'operator' } : { id: actor.id, role: actor.role };
  const response = await def.run({ actor: m2mActor, requestId: crypto.randomUUID() }, problema, params);
  let depois = null, verificado = false;
  if (response.ok) {
    depois = await detect(actor);
    verificado = !depois.problemas.some(p => p.id === problemaId);
  }
  await recordAction({ actor: auto ? null : { uuid: actor.id }, problema, actionId, response, verificado, auto });
  const body = { ok: response.ok, acao: actionId, problema: problemaId, verificado, erro: response.erro || null, codigo: response.codigo || null, resultado: response.data || null, pendenteVerificacao: response.ok && !verificado };
  return { status: response.ok ? 200 : (response.status >= 400 ? response.status : 502), body };
}

async function autoResolve() {
  const started = Date.now();
  const observedAt = new Date().toISOString();
  const result = await detect(null);
  const aplicadas = [];
  for (const p of result.problemas) {
    for (const a of p.acoes) {
      if (a.tipo !== 'seguro' || !ACTIONS[a.id]?.seguro) continue;
      const r = await applyAction({ actor: null, problemaId: p.id, actionId: a.id, auto: true });
      aplicadas.push({ problema: p.id, acao: a.id, ok: Boolean(r.body.ok), verificado: Boolean(r.body.verificado), erro: r.body.erro || null });
    }
  }
  const final = aplicadas.length ? await detect(null) : result;
  const incidents = await persistIncidents(final, observedAt);
  const summary = { detectados: result.resumo.total, restantes: final.resumo.total, aplicadas, incidents };
  try {
    await rest('dev_job_runs', { method: 'POST', body: JSON.stringify({ agent_key: 'problem-center', job_key: 'problems.autofix', status: aplicadas.some(a => !a.ok) ? 'warning' : 'ok', started_at: observedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - started, processed_count: result.resumo.total, success_count: aplicadas.filter(a => a.ok).length, failure_count: aplicadas.filter(a => !a.ok).length, details: summary }) });
  } catch { /* idem */ }
  return summary;
}

module.exports = { detect, applyAction, autoResolve, persistIncidents, ACTIONS, normalizeRoute, sraFetch };
