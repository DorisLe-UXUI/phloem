// Accounts, shared by the landing page (via studio/dist/auth.js) and Studio.
// Two modes: 'relay' when the Studio's relay URL answers with auth support, else 'local'
// (users live in this browser's IndexedDB, passwords hashed with PBKDF2 via WebCrypto).
export interface User { id: string; name: string; email: string; brand: string; createdAt: string; /** relay: may use the AI */ ai?: boolean; /** relay: manages AI access codes */ admin?: boolean; /** admin e-mail not yet proven by Google */ adminPending?: boolean }
export interface Session { token: string; user: User; mode: 'local' | 'relay'; relayUrl?: string }
export interface AuthOpts { relayUrl?: string; relayToken?: string }
export interface Credentials { name?: string; email: string; password: string; brand?: string }
export type AuthCode = 'name' | 'email' | 'password' | 'exists' | 'notfound' | 'badpass' | 'network' | 'secure' | 'storage' | 'server' | 'expired';

export class AuthError extends Error {
  code: AuthCode;
  constructor(code: AuthCode, message: string) { super(message); this.code = code; }
}

const MSG: Record<AuthCode, string> = {
  name: 'Tên cần ít nhất 2 ký tự.',
  email: 'Email không hợp lệ.',
  password: 'Mật khẩu cần ít nhất 8 ký tự.',
  exists: 'Email này đã có tài khoản. Hãy đăng nhập.',
  notfound: 'Chưa có tài khoản với email này.',
  badpass: 'Mật khẩu không đúng.',
  network: 'Không gọi được relay. Kiểm tra Relay URL hoặc mạng.',
  secure: 'Trình duyệt chặn mã hoá mật khẩu trên trang không https.',
  storage: 'Trình duyệt không cho lưu dữ liệu (chế độ riêng tư?).',
  server: 'Relay trả lỗi không rõ.',
  expired: 'Phiên đăng nhập hết hạn. Đăng nhập lại.',
};
const fail = (code: AuthCode, message?: string) => new AuthError(code, message || MSG[code]);

const LS_SESSION = 'phloem.session';
const LS_SETTINGS = 'phloem.studio.settings';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const listeners = new Set<(s: Session | null) => void>();

export function onAuthChange(fn: (s: Session | null) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getSession(): Session | null { try { const v = localStorage.getItem(LS_SESSION); return v ? (JSON.parse(v) as Session) : null; } catch { return null; } }
function setSession(s: Session | null) {
  try { if (s) localStorage.setItem(LS_SESSION, JSON.stringify(s)); else localStorage.removeItem(LS_SESSION); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(s));
}
/** Relay settings the Studio saved in this browser (same origin as the landing page). */
export function readStudioRelay(): AuthOpts {
  const meta = typeof document !== 'undefined' ? (document.querySelector('meta[name="phloem-relay"]') as HTMLMetaElement | null)?.content || '' : '';
  try { const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'); return { relayUrl: String(s.relayUrl || meta || '').replace(/\/$/, ''), relayToken: String(s.relayToken || '') }; } catch { return { relayUrl: meta.replace(/\/$/, ''), relayToken: '' }; }
}

export function validate(input: Credentials, register: boolean): AuthCode | null {
  if (register && String(input.name || '').trim().length < 2) return 'name';
  if (!EMAIL.test(String(input.email || '').trim())) return 'email';
  if (String(input.password || '').length < 8) return 'password';
  return null;
}

// ---------- relay mode ----------
const modeCache = new Map<string, { at: number; ok: boolean }>();
export async function relayHasAuth(relayUrl: string): Promise<boolean> {
  if (!relayUrl) return false;
  const c = modeCache.get(relayUrl); if (c && Date.now() - c.at < 60_000) return c.ok;
  let ok = false;
  try { const r = await fetch(relayUrl + '/', { signal: AbortSignal.timeout(2500) }); const j = await r.json(); ok = !!j?.auth; } catch { ok = false; }
  modeCache.set(relayUrl, { at: Date.now(), ok });
  return ok;
}
export async function detectMode(opts: AuthOpts = readStudioRelay()): Promise<'local' | 'relay'> { return (await relayHasAuth(opts.relayUrl || '')) ? 'relay' : 'local'; }

async function relayCall(opts: AuthOpts, path: string, init: RequestInit & { token?: string } = {}): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.relayToken) headers['X-Phloem-Token'] = opts.relayToken;
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let r: Response;
  try { r = await fetch(`${opts.relayUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(8000) }); } catch { throw fail('network'); }
  let j: any = null; try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const code = (j?.code as AuthCode) || 'server'; const e = fail(code in MSG ? code : 'server', j?.error); (e as AuthError & { status?: number }).status = r.status; throw e; }
  return j;
}

// ---------- local mode ----------
interface LocalUser extends User { salt: string; hash: string }
const DB = 'phloem-auth';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    let r: IDBOpenDBRequest;
    try { r = indexedDB.open(DB, 1); } catch { rej(fail('storage')); return; }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('users')) r.result.createObjectStore('users', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(fail('storage'));
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((res, rej) => { const req = fn(db.transaction('users', mode).objectStore('users')); req.onsuccess = () => res(req.result as T); req.onerror = () => rej(fail('storage')); }));
}
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
async function pbkdf2(password: string, salt: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw fail('secure');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 120_000 }, key, 256);
  return hex(bits);
}
const rand = (n = 16) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a.buffer); };
const pub = (u: LocalUser): User => ({ id: u.id, name: u.name, email: u.email, brand: u.brand, createdAt: u.createdAt });

async function localRegister(input: Credentials): Promise<Session> {
  const email = input.email.trim().toLowerCase();
  const all = await tx<LocalUser[]>('readonly', (s) => s.getAll());
  if (all.some((u) => u.email === email)) throw fail('exists');
  const salt = rand(16);
  const u: LocalUser = { id: `u_${rand(8)}`, name: input.name!.trim(), email, brand: String(input.brand || '').trim().slice(0, 80), createdAt: new Date().toISOString(), salt, hash: await pbkdf2(input.password, salt) };
  await tx('readwrite', (s) => s.put(u));
  return { token: `local_${rand(16)}`, user: pub(u), mode: 'local' };
}
async function localLogin(input: Credentials): Promise<Session> {
  const email = input.email.trim().toLowerCase();
  const u = (await tx<LocalUser[]>('readonly', (s) => s.getAll())).find((x) => x.email === email);
  if (!u) throw fail('notfound');
  if ((await pbkdf2(input.password, u.salt)) !== u.hash) throw fail('badpass');
  return { token: `local_${rand(16)}`, user: pub(u), mode: 'local' };
}

// ---------- public API ----------
export async function register(input: Credentials, opts: AuthOpts = readStudioRelay()): Promise<Session> {
  const code = validate(input, true); if (code) throw fail(code);
  const s: Session = (await relayHasAuth(opts.relayUrl || ''))
    ? { ...(await relayCall(opts, '/auth/register', { method: 'POST', body: JSON.stringify(input) })), mode: 'relay', relayUrl: opts.relayUrl }
    : await localRegister(input);
  setSession(s); return s;
}
export async function login(input: Credentials, opts: AuthOpts = readStudioRelay()): Promise<Session> {
  const code = validate(input, false); if (code) throw fail(code);
  const s: Session = (await relayHasAuth(opts.relayUrl || ''))
    ? { ...(await relayCall(opts, '/auth/login', { method: 'POST', body: JSON.stringify(input) })), mode: 'relay', relayUrl: opts.relayUrl }
    : await localLogin(input);
  setSession(s); return s;
}
/** Re-validate the stored session (relay: /auth/me, local: user still exists). Keeps the session on network errors. */
export async function restore(opts: AuthOpts = readStudioRelay()): Promise<Session | null> {
  const s = getSession(); if (!s) return null;
  try {
    if (s.mode === 'relay') {
      const url = s.relayUrl || opts.relayUrl || '';
      const j = await relayCall({ ...opts, relayUrl: url }, '/auth/me', { token: s.token });
      if (!j?.user) { setSession(null); return null; }
      const next = { ...s, user: j.user as User }; setSession(next); return next;
    }
    const u = await tx<LocalUser | undefined>('readonly', (st) => st.get(s.user.id));
    if (!u) { setSession(null); return null; }
    return s;
  } catch (e) {
    const st = (e as AuthError & { status?: number }).status;
    if (st === 401 || st === 403) { setSession(null); return null; } // expired or revoked on the relay: forget it so the UI asks to sign in again
    return s; // unreachable, 5xx, cold start: keep the session and retry later
  }
}
/** A relay route answered 401: the session is dead. Drop it and explain. */
export function expired(): Error { setSession(null); return new AuthError('expired' as AuthCode, 'Phiên đăng nhập relay đã hết hạn hoặc chưa đăng nhập. Bấm Đăng nhập để dùng AI.'); }
export function logout(): void { setSession(null); }
/** Replace the signed-in user's profile (e.g. after the relay granted AI access) without a new token. */
export function updateSessionUser(user: User): void { const s = getSession(); if (s) setSession({ ...s, user }); }
/** Relay info (auth, google client id…) for the configured relay, or null. */
export async function relayInfo(opts: AuthOpts = readStudioRelay()): Promise<{ auth?: boolean; google?: string; ai?: boolean } | null> {
  if (!opts.relayUrl) return null;
  try { const r = await fetch(opts.relayUrl + '/', { signal: AbortSignal.timeout(2500) }); return await r.json(); } catch { return null; }
}
/** Google Sign-In: hand Google's ID token to the relay, which verifies it and opens a relay session. */
export async function loginWithGoogle(credential: string, opts: AuthOpts = readStudioRelay()): Promise<Session> {
  if (!opts.relayUrl) throw fail('network', 'Cần relay để đăng nhập Google.');
  const cur = getSession(); // signed in already → the relay links this Google identity to that account
  const s: Session = { ...(await relayCall(opts, '/auth/google', { method: 'POST', body: JSON.stringify({ credential }), token: cur?.mode === 'relay' ? cur.token : undefined })), mode: 'relay', relayUrl: opts.relayUrl };
  setSession(s); return s;
}
export const messages = MSG;
