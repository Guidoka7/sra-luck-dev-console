function config() {
  const url = String(process.env.DEV_SUPABASE_URL || '').replace(/\/$/, '');
  const service = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || '';
  const anon = process.env.DEV_SUPABASE_ANON_KEY || '';
  if (!url) throw new Error('DEV_SUPABASE_URL_MISSING');
  return { url, service, anon };
}

async function rest(path, init = {}) {
  const { url, service } = config();
  if (!service) throw new Error('DEV_SUPABASE_SERVICE_ROLE_KEY_MISSING');
  const headers = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(init.headers || {}),
  };
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(data?.message || data?.hint || `Supabase REST ${r.status}`);
    e.status = r.status; e.data = data; throw e;
  }
  return data;
}

async function authPassword(email, password) {
  const { url, anon } = config();
  if (!anon) throw new Error('DEV_SUPABASE_ANON_KEY_MISSING');
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function authRecover(email, redirectTo) {
  const { url, anon } = config();
  if (!anon) throw new Error('DEV_SUPABASE_ANON_KEY_MISSING');
  const endpoint = `${url}/auth/v1/recover${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''}`;
  const r = await fetch(endpoint, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

async function authUpdatePassword(accessToken, password) {
  const { url, anon } = config();
  const r = await fetch(`${url}/auth/v1/user`, { method: 'PUT', headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

async function adminCreateUser({ email, password, name }) {
  const { url, service } = config();
  const r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.msg || data?.message || 'Falha ao criar usuário.'); e.status = r.status; throw e; }
  return data;
}

async function adminDeleteUser(authUserId) {
  const { url, service } = config();
  await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } }).catch(() => undefined);
}

async function getProfileByAuth(authUserId) {
  const rows = await rest(`dev_users?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id,auth_user_id,email,name,role,active,permissions,last_login_at,created_at,updated_at&limit=1`, { method: 'GET' });
  return rows?.[0] || null;
}
async function getProfileById(id) {
  const rows = await rest(`dev_users?id=eq.${encodeURIComponent(id)}&select=id,auth_user_id,email,name,role,active,permissions,last_login_at,created_at,updated_at&limit=1`, { method: 'GET' });
  return rows?.[0] || null;
}
async function audit(entry) {
  try { await rest('dev_audit_logs', { method:'POST', body:JSON.stringify(entry) }); } catch (_) {}
}

module.exports = { config, rest, authPassword, authRecover, authUpdatePassword, adminCreateUser, adminDeleteUser, getProfileByAuth, getProfileById, audit };
