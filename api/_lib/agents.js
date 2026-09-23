const { rest } = require('./supabase');
const { detect } = require('./problems');
const { getInfraOverview } = require('./infra');
const { explicarSinal } = require('./explain');
const ai = require('./ai');

// Agentes do Dev Console: cada um cuida de uma parte do Sra Luck, usa os
// detectores da Central (regras, custo zero), aplica as correções seguras na
// varredura agendada e conta o que viu em linguagem simples.
const AGENTS = [
  { id: 'saude', nome: 'Agente de Saúde', icone: 'heart-pulse', missao: 'Vigia se o Sra Luck e cada função do Admin estão respondendo.' },
  { id: 'bugs', nome: 'Agente de Bugs', icone: 'bug', missao: 'Junta erros repetidos, lentidão e travamentos e prepara o pacote para corrigir.' },
  { id: 'app', nome: 'Agente do App', icone: 'smartphone', missao: 'Cuida do acesso das clientes ao app: liberação, cadastro e uso.' },
  { id: 'notificacoes', nome: 'Agente de Notificações', icone: 'bell', missao: 'Garante que lembretes e avisos cheguem no celular das clientes.' },
  { id: 'jornada', nome: 'Agente da Jornada & Financeiro', icone: 'route', missao: 'Acha clientes paradas na V46 e comprovantes esperando validação.' },
  { id: 'integracoes', nome: 'Agente de Integrações', icone: 'workflow', missao: 'Testa as integrações e as suas APIs personalizadas.' },
  { id: 'infra', nome: 'Agente de Infraestrutura', icone: 'server', missao: 'Olha memória, CPU, disco, backups e servidores.' },
];

function agentOf(p) {
  if (p.id.startsWith('bug:') || p.id.startsWith('app:desempenho:')) return 'bugs';
  if (p.dominio === 'plataforma' || p.dominio === 'admin' || p.id.startsWith('funcao:')) return 'saude';
  if (p.dominio === 'v46' || p.dominio === 'financeiro') return 'jornada';
  if (p.dominio === 'app') return 'app';
  if (p.dominio === 'notificacoes') return 'notificacoes';
  if (p.dominio === 'integracoes') return 'integracoes';
  return 'saude';
}

const n = (v) => Number(v || 0);
const pl = (v, um, varios) => `${v} ${v === 1 ? um : varios}`;

function boasNoticias(s, problemas) {
  const out = [];
  const add = (agente, texto) => out.push({ tipo: 'boa', agente, texto });
  if (s.funcoesTotal && s.funcoesOk === s.funcoesTotal) add('saude', `Todas as ${s.funcoesTotal} funções do Admin responderam${s.latenciaMedia != null ? ` (média de ${s.latenciaMedia} ms)` : ''}. 👌`);
  if (s.erros24h === 0) add('bugs', 'Nenhum erro registrado no Admin nem no app nas últimas 24h. 🎉');
  else if (s.erros1h === 0 && s.erros24h > 0) add('bugs', `Última hora sem erros novos (foram ${pl(s.erros24h, 'erro', 'erros')} nas últimas 24h).`);
  if (s.clientesHoje) add('app', `${pl(s.clientesHoje, 'cliente usou', 'clientes usaram')} o app hoje${s.clientesAtivas7d ? ` e ${s.clientesAtivas7d} nos últimos 7 dias` : ''}.`);
  if (s.appInstalado) add('app', `${pl(s.appInstalado, 'cliente já tem', 'clientes já têm')} o app instalado no celular.`);
  if (s.pushEnviadas24h && (s.pushFalhas24h || 0) / Math.max(1, s.pushEnviadas24h + (s.pushFalhas24h || 0)) < 0.1) add('notificacoes', `${pl(s.pushEnviadas24h, 'notificação entregue', 'notificações entregues')} nas últimas 24h, quase sem falhas.`);
  if (s.validacoesPendentes === 0) add('jornada', 'Nenhum comprovante esperando validação. Financeiro em dia! ✅');
  if (s.jornada) {
    const total = Object.values(s.jornada).reduce((a, b) => a + b, 0);
    if (total && !problemas.some((p) => p.dominio === 'v46')) add('jornada', `${pl(total, 'cliente em andamento', 'clientes em andamento')} na Jornada V46, sem ninguém travado.`);
  }
  if (s.integracoesConectadas) add('integracoes', `${pl(s.integracoesConectadas, 'integração conectada', 'integrações conectadas')} e verificada${s.integracoesConectadas === 1 ? '' : 's'}.`);
  if (s.apisTotal && s.apisNoAr === s.apisTotal) add('integracoes', `Todas as suas ${s.apisTotal} APIs personalizadas estão no ar.`);
  return out;
}

function saudacao() {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function resumoDoDia(found, infraRuins, boas, configurado) {
  const r = found.resumo;
  const graves = r.critical + r.high + infraRuins.filter((x) => x.severidade === 'critical').length;
  if (!configurado) return `${saudacao()}! Ainda não consigo olhar o Sra Luck por dentro: falta configurar o conector (SRA_LUCK_SERVICE_TOKEN). Por enquanto só vejo se ele está no ar.`;
  if (!graves && !r.warning && !infraRuins.length) return `${saudacao()}! Dei uma volta completa: está tudo funcionando. ${boas[0]?.texto || ''}`.trim();
  const partes = [];
  if (r.critical) partes.push(`${pl(r.critical, 'problema crítico', 'problemas críticos')} (resolve primeiro!)`);
  if (r.high) partes.push(pl(r.high, 'problema importante', 'problemas importantes'));
  if (r.warning) partes.push(pl(r.warning, 'ponto de atenção', 'pontos de atenção'));
  if (infraRuins.length) partes.push(pl(infraRuins.length, 'alerta de infraestrutura', 'alertas de infraestrutura'));
  const fixaveis = r.corrigiveis ? ` ${pl(r.corrigiveis, 'deles dá', 'deles dão')} para resolver aqui mesmo com um clique.` : '';
  return `${saudacao()}! Encontrei ${partes.join(', ')}.${fixaveis} Abaixo cada agente explica o que viu e como resolver.`;
}

async function historicoCorrecoes() {
  try {
    const [runs, fixes] = await Promise.all([
      rest('dev_job_runs?job_key=eq.problems.autofix&select=status,started_at,duration_ms,success_count,failure_count,details&order=started_at.desc&limit=5', { method: 'GET' }),
      rest('dev_audit_logs?action=in.(problems.fix,problems.autofix)&select=action,resource,resource_id,details,created_at&order=created_at.desc&limit=30', { method: 'GET' }),
    ]);
    return { ultimaVarredura: runs?.[0] || null, correcoes: fixes || [] };
  } catch {
    return { ultimaVarredura: null, correcoes: [] };
  }
}

async function briefing(actor) {
  const [found, infra, hist] = await Promise.all([
    detect(actor),
    getInfraOverview({ includeLogs: false }).catch(() => null),
    historicoCorrecoes(),
  ]);
  const infraRuins = (infra?.signals || []).filter((s) => s.state === 'warning' || s.state === 'critical').map((s) => {
    const e = explicarSinal(s);
    return { id: `infra:${s.source}:${s.key}`, titulo: e.titulo, severidade: s.state === 'critical' ? 'critical' : 'warning', dominio: 'infra', tipo: 'infra', explicacao: e, acoes: [{ id: 'link', label: 'Ver infraestrutura', tipo: 'link', href: 'infraestrutura.html' }] };
  });
  const NOMES = { supabase: 'o banco do Sra Luck (Supabase)', devSupabase: 'o banco do Dev Console', cloudflare: 'o servidor Cloudflare', vercel: 'a Vercel', storage: 'o Storage de arquivos', backups: 'os backups do banco', guardian: 'a varredura automática' };
  for (const [key, prov] of Object.entries(infra?.providers || {})) {
    if (!prov || prov.configured === false || prov.ok !== false || key === 'runtime') continue;
    const nome = NOMES[key] || key;
    infraRuins.push({ id: `infra:provider:${key}`, titulo: `Não consegui ler ${nome}`, severidade: 'warning', dominio: 'infra', tipo: 'infra', explicacao: { oQue: `Tentei consultar ${nome} e não tive resposta${prov.message ? `: ${prov.message}` : '.'}`, porQue: 'Enquanto isso, essa parte fica sem monitoramento (ponto cego).', comoResolver: ['Confira a credencial dessa fonte na Vercel do Dev Console (veja Conexões).', 'Se a credencial está certa, o serviço pode estar fora do ar: veja o status dele.'] }, acoes: [{ id: 'link', label: 'Ver infraestrutura', tipo: 'link', href: 'infraestrutura.html' }] });
  }
  const boas = boasNoticias(found.sinais || {}, found.problemas);
  const memoria = infra?.signals?.find((s) => s.source === 'supabase' && s.key === 'memory_usage_percent');
  if (memoria && memoria.state === 'healthy') boas.push({ tipo: 'boa', agente: 'infra', texto: `Memória do banco tranquila: ${Math.round(memoria.value)}% em uso.` });
  if (infra && !infraRuins.length && infra.overall === 'healthy') boas.push({ tipo: 'boa', agente: 'infra', texto: 'Servidores e banco sem nenhum alerta de recurso.' });

  const correcoesPorProblema = new Map();
  for (const c of hist.correcoes) if (!correcoesPorProblema.has(c.resource_id)) correcoesPorProblema.set(c.resource_id, c);

  const agentes = AGENTS.map((a) => {
    const achados = a.id === 'infra' ? infraRuins : found.problemas.filter((p) => agentOf(p) === a.id);
    const graves = achados.filter((p) => p.severidade === 'critical' || p.severidade === 'high').length;
    const status = achados.some((p) => p.severidade === 'critical') ? 'critico' : graves ? 'atencao' : achados.some((p) => p.severidade === 'warning') ? 'aviso' : 'ok';
    const corrigidos = hist.correcoes.filter((c) => a.id === 'infra' ? false : agentOf({ id: c.resource_id || '', dominio: c.resource }) === a.id && c.details?.ok);
    const boasDoAgente = boas.filter((b) => b.agente === a.id);
    const fala = status === 'ok'
      ? (boasDoAgente[0]?.texto || 'Tudo certo por aqui.')
      : `${pl(achados.length, 'coisa precisa', 'coisas precisam')} de atenção. ${achados[0].explicacao?.oQue || achados[0].titulo}`;
    return { ...a, status, fala, achados: achados.map((p) => ({ ...p, ultimaCorrecao: correcoesPorProblema.get(p.id) || null })), corrigidos: corrigidos.slice(0, 10), boas: boasDoAgente };
  });

  const ruins = [...found.problemas, ...infraRuins].filter((p) => p.severidade !== 'info').map((p) => ({ tipo: p.severidade === 'critical' || p.severidade === 'high' ? 'ruim' : 'atencao', agente: p.dominio === 'infra' ? 'infra' : agentOf(p), texto: p.explicacao?.oQue || p.titulo, problema: p.id }));
  return {
    ok: true,
    geradoEm: new Date().toISOString(),
    configurado: found.configurado,
    ia: { configurada: ai.configured(), provedor: 'Google Gemini (camada gratuita)' },
    resumo: resumoDoDia(found, infraRuins, boas, found.configurado),
    contagem: { ...found.resumo, infra: infraRuins.length },
    agentes,
    novidades: [...ruins, ...boas],
    ultimaVarredura: hist.ultimaVarredura,
    correcoesRecentes: hist.correcoes.slice(0, 15),
  };
}

async function analisarComIA(actor, problemaId) {
  const found = await detect(actor);
  const p = found.problemas.find((x) => x.id === problemaId);
  if (!p) return { ok: false, status: 409, codigo: 'PROBLEM_NOT_ACTIVE', erro: 'Este problema não está mais ativo.' };
  const r = await ai.analisar(p);
  return { ...r, status: r.ok ? 200 : r.codigo === 'AI_NOT_CONFIGURED' ? 400 : 502 };
}

module.exports = { AGENTS, briefing, analisarComIA, agentOf };
