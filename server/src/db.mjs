// The app database: SQLite via node:sqlite (Node ≥ 22.13), one file, WAL mode, zero dependencies.
// Tables: users, sessions, projects, assets (bytes in-row), profiles (client credentials, encrypted at rest).
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, brand TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  json TEXT NOT NULL, thumb TEXT, thumb_mobile TEXT, provider TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner, updated_at DESC);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  mime TEXT NOT NULL, w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL,
  data BLOB NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner);
CREATE TABLE IF NOT EXISTS kv (
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner, key)
);
CREATE TABLE IF NOT EXISTS profiles (
  owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enc BLOB NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_tombstones (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tombstones_owner ON project_tombstones(owner);
`;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

/** AES-256-GCM with a key derived from the relay secret; output = iv(12) | tag(16) | ciphertext. */
export function encrypt(secret, text) {
  const key = createHash('sha256').update(`${secret}|profiles`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function decrypt(secret, buf) {
  const key = createHash('sha256').update(`${secret}|profiles`).digest();
  const b = Buffer.from(buf);
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // Migrations (idempotent): asset meta (source website / project tags) added 2026-10.
  try { db.exec('ALTER TABLE assets ADD COLUMN meta TEXT'); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT'); } catch { /* column exists */ }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub) WHERE google_sub IS NOT NULL'); } catch { /* exists */ }
  // housekeeping: sessions idle for 30 days and tombstones older than 90 days are gone
  try { db.prepare("DELETE FROM sessions WHERE last_seen < ?").run(new Date(Date.now() - 30 * 86400e3).toISOString()); db.prepare('DELETE FROM project_tombstones WHERE at < ?').run(new Date(Date.now() - 90 * 86400e3).toISOString()); } catch { /* ignore */ }
  const q = (sql) => db.prepare(sql);
  const S = {
    userByEmail: q('SELECT * FROM users WHERE email = ?'), userById: q('SELECT * FROM users WHERE id = ?'), userByGoogle: q('SELECT * FROM users WHERE google_sub = ?'), userLinkGoogle: q('UPDATE users SET google_sub = ? WHERE id = ?'),
    userInsert: q('INSERT INTO users (id, name, email, brand, password, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    userCount: q('SELECT COUNT(*) AS n FROM users'),
    sessAdd: q('INSERT OR REPLACE INTO sessions (token_hash, user_id, agent, created_at, last_seen) VALUES (?, ?, ?, ?, ?)'),
    sessGet: q('SELECT * FROM sessions WHERE token_hash = ?'), sessTouch: q('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    sessDel: q('DELETE FROM sessions WHERE token_hash = ?'), sessDelUser: q('DELETE FROM sessions WHERE user_id = ?'),
    sessList: q('SELECT token_hash, agent, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC'),
    projList: q('SELECT id, name, updated_at, created_at, thumb, thumb_mobile, provider, length(json) AS size FROM projects WHERE owner = ? ORDER BY updated_at DESC'),
    projGet: q('SELECT * FROM projects WHERE owner = ? AND id = ?'),
    projPut: q(`INSERT INTO projects (id, owner, name, json, thumb, thumb_mobile, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, thumb = excluded.thumb, thumb_mobile = excluded.thumb_mobile, provider = excluded.provider, updated_at = excluded.updated_at WHERE projects.owner = excluded.owner AND excluded.updated_at >= projects.updated_at`),
    projDel: q('DELETE FROM projects WHERE owner = ? AND id = ?'),
    tombPut: q('INSERT INTO project_tombstones (id, owner, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, at = excluded.at'), tombDel: q('DELETE FROM project_tombstones WHERE id = ?'), tombList: q('SELECT id, at FROM project_tombstones WHERE owner = ?'),
    projCount: q('SELECT COUNT(*) AS n, COALESCE(SUM(length(json)), 0) AS bytes FROM projects WHERE owner = ?'),
    assetList: q('SELECT id, name, mime, w, h, bytes, meta, created_at FROM assets WHERE owner = ? ORDER BY created_at DESC'),
    assetGet: q('SELECT * FROM assets WHERE owner = ? AND id = ?'), assetMeta: q('SELECT id, name, mime, w, h, bytes, meta, created_at FROM assets WHERE owner = ? AND id = ?'),
    assetPut: q(`INSERT INTO assets (id, owner, name, mime, w, h, bytes, data, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime, w = excluded.w, h = excluded.h, bytes = excluded.bytes, data = excluded.data, meta = COALESCE(excluded.meta, assets.meta) WHERE assets.owner = excluded.owner`),
    assetPatch: q('UPDATE assets SET meta = ?, name = COALESCE(?, name) WHERE owner = ? AND id = ?'),
    assetDel: q('DELETE FROM assets WHERE owner = ? AND id = ?'), assetUsage: q('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM assets WHERE owner = ?'),
    usageAll: q('SELECT (SELECT COALESCE(SUM(bytes), 0) FROM assets) + (SELECT COALESCE(SUM(length(json)), 0) FROM projects) + (SELECT COALESCE(SUM(length(enc)), 0) FROM profiles) + (SELECT COALESCE(SUM(length(json)), 0) FROM kv) AS bytes'),
    kvGet: q('SELECT json, updated_at FROM kv WHERE owner = ? AND key = ?'),
    kvPut: q('INSERT INTO kv (owner, key, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
    profGet: q('SELECT enc, updated_at FROM profiles WHERE owner = ?'),
    profPut: q('INSERT INTO profiles (owner, enc, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at'),
  };
  const meta = (p) => ({ id: p.id, name: p.name, updatedAt: p.updated_at, createdAt: p.created_at, thumb: p.thumb || undefined, thumbMobile: p.thumb_mobile || undefined, provider: p.provider || undefined, size: p.size });
  const parseMeta = (m) => { if (!m) return {}; try { const j = typeof m === 'string' ? JSON.parse(m) : m; return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const assetMeta = (a) => ({ id: a.id, name: a.name, mime: a.mime, w: a.w, h: a.h, bytes: a.bytes, createdAt: a.created_at, ...parseMeta(a.meta) });

  return {
    file,
    raw: db,
    users: {
      byEmail: (email) => S.userByEmail.get(email) || null,
      byId: (id) => S.userById.get(id) || null,
      byGoogle: (sub) => (sub ? S.userByGoogle.get(sub) || null : null),
      linkGoogle: (id, sub) => { S.userLinkGoogle.run(sub, id); },
      insert: (u) => { S.userInsert.run(u.id, u.name, u.email, u.brand || '', u.password, u.createdAt || now()); if (u.googleSub) S.userLinkGoogle.run(u.googleSub, u.id); return u; },
      count: () => Number(S.userCount.get().n),
    },
    sessions: {
      add: (token, userId, agent = '') => { const t = now(); S.sessAdd.run(sha256(token), userId, String(agent).slice(0, 200), t, t); },
      check: (token) => { const h = sha256(token); const row = S.sessGet.get(h); if (!row) return null; S.sessTouch.run(now(), h); return row.user_id; },
      remove: (token) => { S.sessDel.run(sha256(token)); },
      removeAll: (userId) => { S.sessDelUser.run(userId); },
      list: (userId) => S.sessList.all(userId),
    },
    projects: {
      list: (owner) => S.projList.all(owner).map(meta),
      get: (owner, id) => { const p = S.projGet.get(owner, id); return p ? { ...JSON.parse(p.json), thumb: p.thumb || undefined, thumbMobile: p.thumb_mobile || undefined, provider: p.provider || undefined, updatedAt: p.updated_at, createdAt: p.created_at } : null; },
      /** Upsert; a body older than the stored copy is refused (`stale`, with the stored updatedAt) instead of silently ignored. */
      put: (owner, p) => {
        const { thumb, thumbMobile, provider, ...rest } = p;
        const updated = p.updatedAt || now();
        const r = S.projPut.run(p.id, owner, String(p.name || 'Email').slice(0, 200), JSON.stringify(rest), thumb || null, thumbMobile || null, provider || null, p.createdAt || updated, updated);
        if (!Number(r.changes)) { const cur = S.projGet.get(owner, p.id); return { id: p.id, updatedAt: cur ? cur.updated_at : updated, stale: true }; }
        S.tombDel.run(p.id); // re-saved after a delete elsewhere: it lives again
        return { id: p.id, updatedAt: updated };
      },
      remove: (owner, id) => { S.projDel.run(owner, id); S.tombPut.run(id, owner, now()); },
      tombstones: (owner) => S.tombList.all(owner),
      count: (owner) => S.projCount.get(owner),
    },
    assets: {
      list: (owner) => S.assetList.all(owner).map(assetMeta),
      meta: (owner, id) => { const a = S.assetMeta.get(owner, id); return a ? assetMeta(a) : null; },
      get: (owner, id) => { const a = S.assetGet.get(owner, id); return a ? { ...assetMeta(a), data: Buffer.from(a.data) } : null; },
      put: (owner, m, data) => { const meta = m.meta ? JSON.stringify(m.meta) : null; S.assetPut.run(m.id, owner, String(m.name || 'image').slice(0, 200), m.mime || 'application/octet-stream', m.w | 0, m.h | 0, data.length, data, meta, now()); return assetMeta({ ...m, meta, bytes: data.length, created_at: now() }); },
      patch: (owner, id, meta, name) => { S.assetPatch.run(JSON.stringify(meta || {}), name ? String(name).slice(0, 200) : null, owner, id); const a = S.assetMeta.get(owner, id); return a ? assetMeta(a) : null; },
      remove: (owner, id) => { S.assetDel.run(owner, id); },
      usage: (owner) => S.assetUsage.get(owner),
    },
    profiles: {
      get: (owner, secret) => { const r = S.profGet.get(owner); if (!r) return { profiles: [], updatedAt: null }; try { return { profiles: JSON.parse(decrypt(secret, r.enc)), updatedAt: r.updated_at }; } catch { return { profiles: [], updatedAt: r.updated_at, corrupt: true }; } }, // corrupt = secret changed: the client must keep its own copy
      put: (owner, secret, profiles) => { const t = now(); S.profPut.run(owner, encrypt(secret, JSON.stringify(profiles)), t); return { updatedAt: t }; },
    },
    kv: {
      get: (owner, key) => { const r = S.kvGet.get(owner, key); return r ? { value: JSON.parse(r.json), updatedAt: r.updated_at } : { value: null, updatedAt: null }; },
      put: (owner, key, value, updatedAt) => { const t = updatedAt || now(); S.kvPut.run(owner, String(key).slice(0, 64), JSON.stringify(value ?? null), t); return { updatedAt: t }; },
    },
    stats: (owner) => ({ projects: S.projCount.get(owner), assets: S.assetUsage.get(owner), sessions: S.sessList.all(owner).length }),
    usageAll: () => Number(S.usageAll.get().bytes),
    close: () => db.close(),
  };
}
