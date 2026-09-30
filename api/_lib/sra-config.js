const { getSecret } = require('./secrets');

// Endereço que não recebe mais clientes. Se ainda estiver configurado, o
// Console avisa em vez de consultar silenciosamente o sistema errado.
const LEGACY_HOSTS = new Set(['sra-luck-react.vercel.app']);

/**
 * Normaliza a URL base do Sra Luck: só HTTPS (ou localhost em desenvolvimento),
 * sem caminho. Valor inválido ou ausente = não configurado (sem fallback).
 */
function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Configuração efetiva do conector com o Sra Luck, a MESMA para todos os
 * módulos (proxy M2M, Central de Problemas, Guardian e status): cofre do Dev
 * primeiro, variável de ambiente como reserva — via getSecret.
 */
async function sraConnection() {
  // Deploy de Preview (validação isolada, ex.: Conta Azul com o ERP de teste): quando a Vercel
  // define SRA_LUCK_PREVIEW_BASE_URL para o Preview, ele aponta SÓ para o Sra Luck de teste,
  // sem ler nem alterar o cofre compartilhado com a produção. Produção não muda.
  if (process.env.VERCEL_ENV === 'preview' && String(process.env.SRA_LUCK_PREVIEW_BASE_URL || '').trim()) {
    const baseRaw = String(process.env.SRA_LUCK_PREVIEW_BASE_URL).trim();
    const base = normalizeBaseUrl(baseRaw);
    const token = String(process.env.SRA_LUCK_PREVIEW_SERVICE_TOKEN || '').trim();
    return { base, token, configured: Boolean(base), tokenConfigured: Boolean(token), legacy: false, invalid: !base, alvo: 'preview' };
  }
  const [baseRaw, tokenRaw] = await Promise.all([getSecret('SRA_LUCK_BASE_URL'), getSecret('SRA_LUCK_SERVICE_TOKEN')]);
  const base = normalizeBaseUrl(baseRaw);
  const token = String(tokenRaw || '').trim();
  const host = base ? new URL(base).host : null;
  return {
    base,
    token,
    configured: Boolean(base),
    tokenConfigured: Boolean(token),
    legacy: Boolean(host && LEGACY_HOSTS.has(host)),
    invalid: Boolean(String(baseRaw || '').trim() && !base),
  };
}

/** Mensagem única para quando a URL do Sra Luck não está pronta para uso. */
function baseProblem(conn) {
  if (conn.invalid) return 'SRA_LUCK_BASE_URL inválida: use a URL HTTPS do app (ex.: https://sraluckapp.vercel.app).';
  if (!conn.configured) return 'SRA_LUCK_BASE_URL não configurada no cofre do Dev nem na Vercel.';
  return null;
}

module.exports = { sraConnection, normalizeBaseUrl, baseProblem, LEGACY_HOSTS };
