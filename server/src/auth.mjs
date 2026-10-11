// Accounts for the relay: scrypt password hashes, HMAC-signed bearer tokens, revocable sessions, users in SQLite.
// Zero dependencies. The relay never stores plaintext passwords and never emails anyone.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.mjs';

const TOKEN_TTL = 30 * 24 * 3600 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await scryptAsync(String(password), salt, 32)).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = await scryptAsync(String(password), salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signToken(userId, secret, now = Date.now(), ttl = TOKEN_TTL) {
  const body = Buffer.from(JSON.stringify({ u: userId, e: now + ttl, n: randomBytes(6).toString('hex') })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', secret).update(body).digest('base64url');
  if (expect.length !== sig.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
  try {
    const j = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return j && typeof j.u === 'string' && typeof j.e === 'number' && j.e > now ? j.u : null;
  } catch { return null; }
}

/** Returns an error code or null. Codes match the client: name, email, password. */
export function validate(input, { register = false } = {}) {
  const name = String(input?.name || '').trim(), email = String(input?.email || '').trim().toLowerCase(), password = String(input?.password || '');
  if (register && name.length < 2) return 'name';
  if (!EMAIL.test(email) || email.length > 254) return 'email';
  if (password.length < 8 || password.length > 1024) return 'password';
  return null;
}

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export function createAuth({ dataDir, secret = '' }) {
  mkdirSync(dataDir, { recursive: true });
  if (!secret) {
    const f = join(dataDir, 'auth-secret');
    if (existsSync(f)) secret = readFileSync(f, 'utf8').trim();
    else { secret = randomBytes(32).toString('hex'); writeFileSync(f, secret, { mode: 0o600 }); }
  }
  const db = openDb(join(dataDir, 'phloem.db'));
  // One-time migration from the JSON store the first version used.
  const legacy = join(dataDir, 'users.json');
  if (existsSync(legacy)) {
    try {
      for (const u of JSON.parse(readFileSync(legacy, 'utf8'))) if (!db.users.byEmail(u.email)) db.users.insert({ id: u.id, name: u.name, email: u.email, brand: u.brand || '', password: u.password, createdAt: u.createdAt });
      renameSync(legacy, `${legacy}.migrated`);
    } catch (e) { console.error('[auth] users.json migration failed:', e?.message || e); }
  }
  const pub = (u) => ({ id: u.id, name: u.name, email: u.email, brand: u.brand || '', createdAt: u.created_at || u.createdAt });
  const session = (u, agent) => { const token = signToken(u.id, secret); db.sessions.add(token, u.id, agent); return { token, user: pub(u) }; };

  return {
    db,
    secret,
    async register(input, agent = '') {
      const code = validate(input, { register: true });
      if (code) throw fail(400, code, { name: 'Tên cần ít nhất 2 ký tự.', email: 'Email không hợp lệ.', password: 'Mật khẩu cần ít nhất 8 ký tự.' }[code]);
      const email = String(input.email).trim().toLowerCase();
      if (db.users.byEmail(email)) throw fail(409, 'exists', 'Email này đã có tài khoản. Hãy đăng nhập.');
      const u = db.users.insert({ id: `u_${randomBytes(8).toString('hex')}`, name: String(input.name).trim().slice(0, 80), email, brand: String(input.brand || '').trim().slice(0, 80), password: await hashPassword(input.password), createdAt: new Date().toISOString() });
      return session(u, agent);
    },
    async login(input, agent = '') {
      const code = validate(input);
      if (code) throw fail(400, code, code === 'email' ? 'Email không hợp lệ.' : 'Mật khẩu cần ít nhất 8 ký tự.');
      const u = db.users.byEmail(String(input.email).trim().toLowerCase());
      if (!u) throw fail(404, 'notfound', 'Chưa có tài khoản với email này.');
      if (!(await verifyPassword(input.password, u.password))) throw fail(401, 'badpass', 'Mật khẩu không đúng.');
      return session(u, agent);
    },
    /** Token → user, or null when the signature, expiry or the session row (revoked) fails. */
    me(token) {
      const id = verifyToken(token, secret);
      if (!id) return null;
      if (db.sessions.check(token) !== id) return null;
      const u = db.users.byId(id);
      return u ? pub(u) : null;
    },
    logout(token) { db.sessions.remove(token); },
    logoutAll(userId) { db.sessions.removeAll(userId); },
    count() { return db.users.count(); },
  };
}
