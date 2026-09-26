const crypto = require('crypto');

function json(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

async function body(req, maxBytes = 64 * 1024) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 }); }
}

async function rawBody(req, maxBytes = 12 * 1024 * 1024) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function cookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`, `SameSite=${options.sameSite || 'Lax'}`];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name, req) {
  setCookie(res, name, '', { maxAge: 0, secure: isHttps(req), httpOnly: true, sameSite: 'Lax' });
}

function codespacesOriginAllowed(req, origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || !url.hostname.toLowerCase().endsWith('.app.github.dev')) return false;

    // Esta exceção existe somente para o preview local servido por `vercel dev` dentro
    // do Codespaces. Em deployments da Vercel (preview/production), o same-origin
    // continua estrito e uma origem *.app.github.dev é rejeitada.
    const vercelEnv = String(process.env.VERCEL_ENV || '').trim().toLowerCase();
    if (vercelEnv && vercelEnv !== 'development') return false;

    const host = String(req.headers.host || '').split(',')[0].trim().toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
    const localHost = host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1' || host.startsWith('127.0.0.1:');
    const localForwardedHost = forwardedHost === 'localhost' || forwardedHost.startsWith('localhost:') || forwardedHost === '127.0.0.1' || forwardedHost.startsWith('127.0.0.1:');
    const publicCodespacesHost = host.endsWith('.app.github.dev') || forwardedHost.endsWith('.app.github.dev');

    return localHost || localForwardedHost || publicCodespacesHost;
  } catch {
    return false;
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const proto = isHttps(req) ? 'https' : 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin === `${proto}://${host}`) return true;
  // GitHub Codespaces termina TLS fora do `vercel dev`: o navegador usa
  // https://<codespace>-<porta>.app.github.dev enquanto a Function pode enxergar
  // localhost internamente. A exceção abaixo é limitada ao ambiente development.
  return codespacesOriginAllowed(req, origin);
}

function requestId(req) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  return incoming && incoming.length <= 120 ? incoming : crypto.randomUUID();
}

function clientIp(req) {
  return String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return json(res, 405, { erro: 'Método não suportado.' });
}

module.exports = { json, body, rawBody, cookies, isHttps, setCookie, clearCookie, sameOrigin, requestId, clientIp, methodNotAllowed };
