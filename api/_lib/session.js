const crypto = require('crypto');
const { cookies } = require('./http');

const COOKIE_NAME = 'dc_session';
const SESSION_SECONDS = 8 * 60 * 60;

function secret() {
  const value = process.env.DEV_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('DEV_SESSION_SECRET_MISSING');
  return value;
}
function b64(value) { return Buffer.from(value).toString('base64url'); }
function unb64(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function sign(data) { return crypto.createHmac('sha256', secret()).update(data).digest('base64url'); }
function safeEqual(a,b){try{return crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));}catch{return false}}

function issueSession(profile) {
  const now = Math.floor(Date.now()/1000);
  const payload = {
    v: 1,
    sub: profile.id,
    au: profile.auth_user_id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    iat: now,
    exp: now + SESSION_SECONDS,
    jti: crypto.randomUUID(),
  };
  const encoded = b64(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !safeEqual(sign(encoded), signature)) return null;
  try {
    const payload = JSON.parse(unb64(encoded));
    if (payload.v !== 1 || !payload.sub || !payload.au || !payload.exp || payload.exp <= Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

function readSession(req) { return verifyToken(cookies(req)[COOKIE_NAME]); }
module.exports = { COOKIE_NAME, SESSION_SECONDS, issueSession, verifyToken, readSession };
