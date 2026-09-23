const net = require('net');
const { rest } = require('./supabase');

// APIs personalizadas: o Dev Console só faz GET/HEAD de saúde em URLs HTTPS
// públicas. O segredo opcional vem de uma variável CUSTOM_API_* (nunca de outra
// variável do servidor, para não vazar credenciais do próprio console).

const FIELDS = 'id,name,description,base_url,health_path,method,expected_status,timeout_ms,header_name,header_env,enabled,last_check_at,last_ok,last_status,last_ms,last_error,created_at,updated_at';
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost|metadata\.google\.internal)$/i;

function isPrivateIp(host) {
  const v = net.isIP(host);
  if (v === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return /^(::1?|fc|fd|fe80)/i.test(host.replace(/^\[|\]$/g, ''));
  return false;
}

function validate(input) {
  const errors = [];
  const name = String(input?.name || '').trim();
  if (name.length < 2 || name.length > 80) errors.push('Nome deve ter entre 2 e 80 caracteres.');
  let url;
  try { url = new URL(String(input?.base_url || '').trim()); } catch { errors.push('URL base inválida.'); }
  if (url) {
    if (url.protocol !== 'https:') errors.push('Use uma URL HTTPS.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (PRIVATE_HOST.test(host) || isPrivateIp(host)) errors.push('Endereços internos ou privados não são permitidos.');
    if (url.username || url.password) errors.push('Não coloque usuário/senha na URL; use uma variável CUSTOM_API_*.');
  }
  const healthPath = String(input?.health_path || '/').trim() || '/';
  if (!healthPath.startsWith('/') || healthPath.startsWith('//')) errors.push('Rota de saúde deve começar com "/".');
  const method = String(input?.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) errors.push('Método deve ser GET ou HEAD.');
  const expected = Number(input?.expected_status ?? 200);
  if (!Number.isInteger(expected) || expected < 100 || expected > 599) errors.push('Status esperado inválido.');
  const timeout = Number(input?.timeout_ms ?? 8000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 20000) errors.push('Tempo limite deve ficar entre 1000 e 20000 ms.');
  const headerName = String(input?.header_name || '').trim() || null;
  const headerEnv = String(input?.header_env || '').trim() || null;
  if (headerName && !/^[A-Za-z0-9-]{1,60}$/.test(headerName)) errors.push('Nome de cabeçalho inválido.');
  if (headerEnv && !/^CUSTOM_API_[A-Z0-9_]{1,60}$/.test(headerEnv)) errors.push('A variável do segredo precisa começar com CUSTOM_API_.');
  if (Boolean(headerName) !== Boolean(headerEnv)) errors.push('Informe o cabeçalho e a variável juntos (ou nenhum dos dois).');
  return {
    errors,
    row: {
      name, description: String(input?.description || '').trim().slice(0, 300) || null,
      base_url: url ? url.origin + url.pathname.replace(/\/$/, '') : null, health_path: healthPath,
      method, expected_status: expected, timeout_ms: timeout, header_name: headerName, header_env: headerEnv,
      enabled: input?.enabled !== false,
    },
  };
}

async function list() {
  return rest(`dev_custom_apis?select=${FIELDS}&order=name.asc`, { method: 'GET' });
}

async function check(api) {
  const started = Date.now();
  const url = api.base_url + api.health_path;
  const headers = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'SraLuck-DevConsole/1.0' };
  if (api.header_name && api.header_env) {
    const secret = String(process.env[api.header_env] || '');
    if (!secret) return { ok: false, status: 0, ms: 0, error: `Variável ${api.header_env} não configurada na Vercel.` };
    headers[api.header_name] = secret;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), api.timeout_ms || 8000);
  try {
    // redirect manual: evita que um redirecionamento leve o teste para a rede interna.
    const r = await fetch(url, { method: api.method || 'GET', headers, signal: controller.signal, redirect: 'manual', cache: 'no-store' });
    const ok = r.status === Number(api.expected_status || 200);
    return { ok, status: r.status, ms: Date.now() - started, error: ok ? null : `Esperado HTTP ${api.expected_status}, recebido HTTP ${r.status}.` };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, error: e?.name === 'AbortError' ? 'Tempo limite excedido.' : (e?.cause?.code || e?.message || 'Falha de rede.') };
  } finally {
    clearTimeout(timer);
  }
}

async function checkAndStore(api) {
  const result = await check(api);
  const patch = { last_check_at: new Date().toISOString(), last_ok: result.ok, last_status: result.status || null, last_ms: result.ms, last_error: result.error };
  try { await rest(`dev_custom_apis?id=eq.${encodeURIComponent(api.id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); } catch { /* resultado segue válido mesmo sem persistir */ }
  return { ...api, ...patch };
}

async function checkAll() {
  let apis = [];
  try { apis = await list(); } catch { return { available: false, apis: [] }; }
  const enabled = apis.filter((a) => a.enabled);
  const checked = await Promise.all(enabled.map(checkAndStore));
  const byId = new Map(checked.map((a) => [a.id, a]));
  return { available: true, apis: apis.map((a) => byId.get(a.id) || a) };
}

module.exports = { validate, list, check, checkAndStore, checkAll, FIELDS };
