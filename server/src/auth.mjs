// Accounts for the relay: scrypt password hashes, HMAC-signed bearer tokens, users in a JSON file.
// Zero dependencies. The relay never stores plaintext passwords and never emails anyone.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN_TTL = 30 * 24 * 3600 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(String(password), salt, 32).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(scryptSync(String(password), salt, 32).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signToken(userId, secret, now = Date.now(), ttl = TOKEN_TTL) {
  const body = Buffer.from(JSON.stringify({ u: userId, e: now + ttl })).toString('base64url');
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
  if (!EMAIL.test(email)) return 'email';
  if (password.length < 8) return 'password';
  return null;
}

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export function createAuth({ dataDir, secret = '' }) {
  mkdirSync(dataDir, { recursive: true });
  const usersFile = join(dataDir, 'users.json');
  if (!secret) {
    const f = join(dataDir, 'auth-secret');
    if (existsSync(f)) secret = readFileSync(f, 'utf8').trim();
    else { secret = randomBytes(32).toString('hex'); writeFileSync(f, secret, { mode: 0o600 }); }
  }
  const load = () => { try { return existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : []; } catch { return []; } };
  const save = (users) => writeFileSync(usersFile, JSON.stringify(users, null, 2));
  const pub = (u) => ({ id: u.id, name: u.name, email: u.email, brand: u.brand || '', createdAt: u.createdAt });
  const session = (u) => ({ token: signToken(u.id, secret), user: pub(u) });

  return {
    register(input) {
      const code = validate(input, { register: true });
      if (code) throw fail(400, code, { name: 'Tên cần ít nhất 2 ký tự.', email: 'Email không hợp lệ.', password: 'Mật khẩu cần ít nhất 8 ký tự.' }[code]);
      const users = load();
      const email = String(input.email).trim().toLowerCase();
      if (users.some((u) => u.email === email)) throw fail(409, 'exists', 'Email này đã có tài khoản. Hãy đăng nhập.');
      const u = { id: `u_${randomBytes(8).toString('hex')}`, name: String(input.name).trim(), email, brand: String(input.brand || '').trim().slice(0, 80), password: hashPassword(input.password), createdAt: new Date().toISOString() };
      users.push(u); save(users);
      return session(u);
    },
    login(input) {
      const code = validate(input);
      if (code) throw fail(400, code, code === 'email' ? 'Email không hợp lệ.' : 'Mật khẩu cần ít nhất 8 ký tự.');
      const email = String(input.email).trim().toLowerCase();
      const u = load().find((x) => x.email === email);
      if (!u) throw fail(404, 'notfound', 'Chưa có tài khoản với email này.');
      if (!verifyPassword(input.password, u.password)) throw fail(401, 'badpass', 'Mật khẩu không đúng.');
      return session(u);
    },
    me(token) {
      const id = verifyToken(token, secret);
      if (!id) return null;
      const u = load().find((x) => x.id === id);
      return u ? pub(u) : null;
    },
    count() { return load().length; },
  };
}
