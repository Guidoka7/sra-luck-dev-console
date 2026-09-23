// Análise por IA opcional e gratuita: Google Gemini (camada gratuita do AI Studio).
// Sem GEMINI_API_KEY, os agentes continuam funcionando só com regras.
// Nunca envia nome, CPF, e-mail ou telefone: só dados técnicos do problema.

const TECH_TYPES = new Set(['codigo', 'infra', 'configuracao', 'permissao']);

function configured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

function safeContext(p) {
  const t = p.pacote || {};
  return {
    titulo: p.titulo,
    area: p.dominio,
    tipo: p.tipo,
    gravidade: p.severidade,
    ocorrencias: p.ocorrencias,
    descricao: p.descricao,
    impacto: p.impacto,
    // Evidências de problemas operacionais trazem nomes de clientes: ficam de fora.
    evidencias: TECH_TYPES.has(p.tipo) ? (p.evidencias || []).map((e) => `${e.label}: ${e.valor}`) : [],
    tecnico: t.rota ? { rota: t.rota, metodo: t.metodo, status_http: t.status_http, codigo: t.codigo, componente: t.componente, mensagem: String(t.mensagem || '').slice(0, 600), amostras: (t.amostras || []).slice(0, 3).map((a) => ({ acao: a.action, duracao_ms: a.duration_ms, detalhes: a.detalhes })) } : null,
  };
}

const SYSTEM = [
  'Você é o agente de suporte técnico do Dev Console da Sra. Luck (clínica que usa um app React + Cloudflare Workers/Vercel + Supabase).',
  'Explique em português do Brasil, de forma informal, curta e clara, para alguém que não é programador experiente.',
  'Responda em Markdown simples com exatamente estas seções:',
  '**O que está acontecendo** (2-3 frases), **Causa mais provável** (lista curta, da mais para a menos provável),',
  '**Como resolver** (passos numerados, práticos), **Se for bug de código** (onde procurar no código e um exemplo de correção, se fizer sentido).',
  'Não invente dados que não estão no contexto. Se faltar informação, diga o que olhar para confirmar.',
].join(' ');

async function analisar(problema) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return { ok: false, codigo: 'AI_NOT_CONFIGURED', erro: 'Configure GEMINI_API_KEY (gratuita no Google AI Studio) na Vercel do Dev Console para ativar a análise por IA.' };
  const model = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/[^a-z0-9.\-]/gi, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: `Problema detectado pelo monitoramento:\n${JSON.stringify(safeContext(problema), null, 2)}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
      }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, codigo: 'AI_UPSTREAM_ERROR', erro: r.status === 429 ? 'Limite gratuito do Gemini atingido por agora. Tente de novo em alguns minutos.' : (data?.error?.message || `Gemini respondeu HTTP ${r.status}.`) };
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('').trim();
    if (!text) return { ok: false, codigo: 'AI_EMPTY', erro: 'A IA não retornou resposta.' };
    return { ok: true, modelo: model, texto: text.slice(0, 8000) };
  } catch (e) {
    return { ok: false, codigo: 'AI_UNREACHABLE', erro: e?.name === 'AbortError' ? 'A IA demorou demais para responder.' : 'Não foi possível falar com a IA agora.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { configured, analisar, safeContext };
