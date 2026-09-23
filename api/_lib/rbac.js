const { readSession } = require('./session');
const { getProfileById } = require('./supabase');
const { json } = require('./http');

const ROLE_PERMISSIONS = {
  owner: ['*'],
  developer: [
    'monitoring.view','infrastructure.view','incidents.manage','agents.run','agents.configure','jobs.view',
    'v46.inspect','v46.correct','finance.inspect','finance.correct','app.inspect','app.correct',
    'notifications.view','notifications.manage','integrations.view','integrations.manage',
    'sra.staff.view','code.view','releases.view','releases.manage','audit.view','connectors.view'
  ],
  operator: [
    'monitoring.view','infrastructure.view','incidents.manage','agents.run','jobs.view','v46.inspect','v46.correct',
    'finance.inspect','finance.correct','app.inspect','app.correct','notifications.view','notifications.manage',
    'integrations.view','sra.staff.view','audit.view','connectors.view'
  ],
  viewer: [
    'monitoring.view','infrastructure.view','jobs.view','v46.inspect','finance.inspect','app.inspect','notifications.view',
    'integrations.view','sra.staff.view','code.view','releases.view','audit.view','connectors.view'
  ],
};

function effectivePermissions(profile) {
  const base = ROLE_PERMISSIONS[profile.role] || [];
  if (base.includes('*')) return ['*'];
  return [...new Set([...base, ...(Array.isArray(profile.permissions) ? profile.permissions : [])])];
}
function hasPermission(profile, permission) {
  const perms = effectivePermissions(profile);
  return perms.includes('*') || perms.includes(permission);
}
async function requireSession(req, res, permission = null) {
  const token = readSession(req);
  if (!token) { json(res, 401, { erro:'Sessão do Dev Console ausente ou expirada.', codigo:'DEV_SESSION_EXPIRED' }); return null; }
  let profile;
  try { profile = await getProfileById(token.sub); } catch { json(res,503,{erro:'Não foi possível validar o acesso agora.',codigo:'DEV_AUTH_UNAVAILABLE'}); return null; }
  if (!profile || !profile.active || profile.auth_user_id !== token.au) { json(res,403,{erro:'Acesso ao Dev Console inativo ou não autorizado.',codigo:'DEV_ACCESS_DENIED'}); return null; }
  profile.effectivePermissions = effectivePermissions(profile);
  if (permission && !hasPermission(profile, permission)) { json(res,403,{erro:'Seu perfil não possui permissão para esta operação.',codigo:'DEV_PERMISSION_DENIED',permission}); return null; }
  return profile;
}
module.exports = { ROLE_PERMISSIONS, effectivePermissions, hasPermission, requireSession };
