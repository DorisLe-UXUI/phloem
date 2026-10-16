// The app database: SQLite via node:sqlite (Node ≥ 22.13), one file, WAL mode, zero dependencies.
// Tables: users, sessions, projects (thumbnail bytes in blobs.mjs), assets (metadata + blob key; bytes live in blobs.mjs), profiles (client credentials, encrypted at rest).
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
CREATE TABLE IF NOT EXISTS ai_codes (
  id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_requests (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS project_tombstones (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tombstones_owner ON project_tombstones(owner);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_owner ON clients(owner, updated_at DESC);
CREATE TABLE IF NOT EXISTS client_items (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL,
  json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (client_id, kind, id)
);
CREATE TABLE IF NOT EXISTS client_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS client_audit_client ON client_audit(client_id, at DESC);
CREATE TABLE IF NOT EXISTS client_shares (
  token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS client_members (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (client_id, user_id)
);
CREATE INDEX IF NOT EXISTS client_members_user ON client_members(user_id);
`;
/** Roles a teammate can hold in one client's workspace (the agency account that created the client is its owner). */
export const CLIENT_ROLES = ['manager', 'designer', 'content', 'ads', 'client_viewer'];
/** Kinds of per-client records the API accepts (anything else is refused). */
export const CLIENT_KINDS = new Set(['brand', 'plan', 'review', 'post', 'campaign', 'report', 'note']);

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
  // 2026-10-15: asset bytes moved out of the row (data = x'') to the blob store; `blob` is their key there
  try { db.exec('ALTER TABLE assets ADD COLUMN blob TEXT'); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT'); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN ai_access INTEGER NOT NULL DEFAULT 0'); } catch { /* column exists */ }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub) WHERE google_sub IS NOT NULL'); } catch { /* exists */ }
  // Phloem MKT (2026-10): an email project may belong to one client of its owner
  try { db.exec('ALTER TABLE projects ADD COLUMN client_id TEXT'); } catch { /* column exists */ }
  // 2026-10-16: thumbnails (base64 JPEG, barely compressible) moved to the blob store; `thumb` stays for legacy/non-image values
  try { db.exec('ALTER TABLE projects ADD COLUMN thumb_blob TEXT'); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN thumb_mobile_blob TEXT'); } catch { /* column exists */ }
  // housekeeping: sessions idle for 30 days and tombstones older than 90 days are gone
  try { db.prepare("DELETE FROM sessions WHERE last_seen < ?").run(new Date(Date.now() - 30 * 86400e3).toISOString()); db.prepare('DELETE FROM project_tombstones WHERE at < ?').run(new Date(Date.now() - 90 * 86400e3).toISOString()); } catch { /* ignore */ }
  const q = (sql) => db.prepare(sql);
  const S = {
    userByEmail: q('SELECT * FROM users WHERE email = ?'), userById: q('SELECT * FROM users WHERE id = ?'), userByGoogle: q('SELECT * FROM users WHERE google_sub = ?'), userLinkGoogle: q('UPDATE users SET google_sub = ? WHERE id = ?'),
    userSetPassword: q('UPDATE users SET password = ? WHERE id = ?'), userSetAi: q('UPDATE users SET ai_access = ? WHERE id = ?'),
    userList: q('SELECT id, name, email, created_at, ai_access, google_sub IS NOT NULL AS google FROM users ORDER BY created_at DESC LIMIT 500'),
    codeAdd: q('INSERT INTO ai_codes (id, hash, note, created_at) VALUES (?, ?, ?, ?)'), codeUse: q('UPDATE ai_codes SET used_by = ?, used_at = ? WHERE hash = ? AND used_by IS NULL'),
    codeList: q('SELECT c.id, c.note, c.created_at, c.used_at, u.email AS used_by FROM ai_codes c LEFT JOIN users u ON u.id = c.used_by ORDER BY c.created_at DESC LIMIT 200'),
    reqPut: q("INSERT INTO ai_requests (user_id, note, at, status) VALUES (?, ?, ?, 'pending') ON CONFLICT(user_id) DO UPDATE SET note = excluded.note, at = excluded.at, status = 'pending'"),
    reqDone: q("UPDATE ai_requests SET status = 'done' WHERE user_id = ?"), reqGet: q('SELECT * FROM ai_requests WHERE user_id = ?'),
    admUsers: q(`SELECT u.id, u.name, u.email, u.brand, u.created_at, u.ai_access, u.google_sub IS NOT NULL AS google,
      (SELECT COUNT(*) FROM projects p WHERE p.owner = u.id) AS projects, (SELECT COALESCE(SUM(length(json)), 0) FROM projects p WHERE p.owner = u.id) AS project_bytes,
      (SELECT COUNT(*) FROM assets a WHERE a.owner = u.id) AS assets, (SELECT COALESCE(SUM(bytes), 0) FROM assets a WHERE a.owner = u.id) AS asset_bytes,
      (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS last_seen, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
      FROM users u ORDER BY u.created_at DESC LIMIT 1000`),
    admProjects: q('SELECT p.id, p.name, p.created_at, p.updated_at, length(p.json) AS size, p.provider, u.email FROM projects p JOIN users u ON u.id = p.owner ORDER BY p.updated_at DESC LIMIT 500'),
    admAssets: q('SELECT a.id, a.name, a.mime, a.w, a.h, a.bytes, a.created_at, a.meta, u.email FROM assets a JOIN users u ON u.id = a.owner ORDER BY a.created_at DESC LIMIT 500'),
    admTotals: q(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE ai_access = 1) AS ai_users, (SELECT COUNT(*) FROM users WHERE google_sub IS NOT NULL) AS google_users,
      (SELECT COUNT(*) FROM projects) AS projects, (SELECT COALESCE(SUM(length(json)), 0) FROM projects) AS project_bytes,
      (SELECT COUNT(*) FROM assets) AS assets, (SELECT COALESCE(SUM(bytes), 0) FROM assets) AS asset_bytes,
      (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM ai_codes) AS codes, (SELECT COUNT(*) FROM ai_codes WHERE used_by IS NOT NULL) AS codes_used,
      (SELECT COUNT(*) FROM ai_requests WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM profiles) AS profiles, (SELECT COUNT(*) FROM project_tombstones) AS tombstones`),
    userDelete: q('DELETE FROM users WHERE id = ?'),
    reqList: q("SELECT r.user_id, r.note, r.at, r.status, u.email, u.name FROM ai_requests r JOIN users u ON u.id = r.user_id ORDER BY r.status = 'pending' DESC, r.at DESC LIMIT 200"),
    userInsert: q('INSERT INTO users (id, name, email, brand, password, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    userCount: q('SELECT COUNT(*) AS n FROM users'),
    sessAdd: q('INSERT OR REPLACE INTO sessions (token_hash, user_id, agent, created_at, last_seen) VALUES (?, ?, ?, ?, ?)'),
    sessGet: q('SELECT * FROM sessions WHERE token_hash = ?'), sessTouch: q('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    sessDel: q('DELETE FROM sessions WHERE token_hash = ?'), sessDelUser: q('DELETE FROM sessions WHERE user_id = ?'),
    sessList: q('SELECT token_hash, agent, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC'),
    // no thumbnails in the list: no client reads them there (each device keeps its own from the full project), and they were most of its bytes
    projList: q('SELECT id, name, updated_at, created_at, provider, client_id, length(json) AS size FROM projects WHERE owner = ? ORDER BY updated_at DESC'),
    projSetClient: q('UPDATE projects SET client_id = ? WHERE owner = ? AND id = ?'),
    // ---- clients: every statement below carries the owner, so one account can never touch another's client ----
    cliList: q('SELECT * FROM clients WHERE owner = ? ORDER BY updated_at DESC'),
    cliGet: q('SELECT * FROM clients WHERE owner = ? AND id = ?'),
    cliPut: q(`INSERT INTO clients (id, owner, name, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, updated_at = excluded.updated_at WHERE clients.owner = excluded.owner AND excluded.updated_at >= clients.updated_at`),
    cliDel: q('DELETE FROM clients WHERE owner = ? AND id = ?'),
    cliProjDel: q('DELETE FROM projects WHERE owner = ? AND client_id = ?'),
    itemList: q('SELECT i.kind, i.id, i.json, i.updated_at FROM client_items i JOIN clients c ON c.id = i.client_id WHERE c.owner = ? AND i.client_id = ? ORDER BY i.updated_at DESC'),
    itemListKind: q('SELECT i.kind, i.id, i.json, i.updated_at FROM client_items i JOIN clients c ON c.id = i.client_id WHERE c.owner = ? AND i.client_id = ? AND i.kind = ? ORDER BY i.updated_at DESC'),
    itemGet: q('SELECT i.kind, i.id, i.json, i.updated_at FROM client_items i JOIN clients c ON c.id = i.client_id WHERE c.owner = ? AND i.client_id = ? AND i.kind = ? AND i.id = ?'),
    itemPut: q(`INSERT INTO client_items (client_id, kind, id, json, updated_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND owner = ?)
      ON CONFLICT(client_id, kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at WHERE excluded.updated_at >= client_items.updated_at`),
    itemDel: q('DELETE FROM client_items WHERE client_id = ? AND kind = ? AND id = ? AND EXISTS (SELECT 1 FROM clients WHERE id = ? AND owner = ?)'),
    auditAdd: q('INSERT INTO client_audit (client_id, actor, action, detail, at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND owner = ?)'),
    auditList: q('SELECT a.actor, a.action, a.detail, a.at FROM client_audit a JOIN clients c ON c.id = a.client_id WHERE c.owner = ? AND a.client_id = ? ORDER BY a.at DESC LIMIT 200'),
    shareAdd: q('INSERT INTO client_shares (token_hash, client_id, kind, item_id, created_at, expires_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND owner = ?)'),
    shareGet: q('SELECT s.*, c.owner, c.name AS client_name, c.json AS client_json FROM client_shares s JOIN clients c ON c.id = s.client_id WHERE s.token_hash = ? AND s.revoked = 0'),
    shareItemPut: q('INSERT INTO client_items (client_id, kind, id, json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_id, kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
    shareAudit: q('INSERT INTO client_audit (client_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)'),
    shareList: q('SELECT s.token_hash, s.kind, s.item_id, s.created_at, s.expires_at FROM client_shares s JOIN clients c ON c.id = s.client_id WHERE c.owner = ? AND s.client_id = ? AND s.revoked = 0 ORDER BY s.created_at DESC'),
    shareRevoke: q('UPDATE client_shares SET revoked = 1 WHERE client_id = ? AND substr(token_hash, 1, 16) = ? AND EXISTS (SELECT 1 FROM clients WHERE id = ? AND owner = ?)'),
    memList: q('SELECT m.user_id, m.role, m.added_at, u.name, u.email FROM client_members m JOIN clients c ON c.id = m.client_id JOIN users u ON u.id = m.user_id WHERE c.owner = ? AND m.client_id = ? ORDER BY m.added_at'),
    memPut: q('INSERT INTO client_members (client_id, user_id, role, added_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND owner = ? AND owner <> ?) ON CONFLICT(client_id, user_id) DO UPDATE SET role = excluded.role'),
    memDel: q('DELETE FROM client_members WHERE client_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM clients WHERE id = ? AND owner = ?)'),
    memOf: q('SELECT c.*, m.role FROM client_members m JOIN clients c ON c.id = m.client_id WHERE m.user_id = ? ORDER BY c.updated_at DESC'),
    access: q("SELECT c.owner, CASE WHEN c.owner = ? THEN 'owner' ELSE m.role END AS role FROM clients c LEFT JOIN client_members m ON m.client_id = c.id AND m.user_id = ? WHERE c.id = ? AND (c.owner = ? OR m.user_id IS NOT NULL)"),
    projGet: q('SELECT * FROM projects WHERE owner = ? AND id = ?'),
    projPut: q(`INSERT INTO projects (id, owner, name, json, thumb, thumb_mobile, provider, created_at, updated_at, thumb_blob, thumb_mobile_blob) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, thumb = excluded.thumb, thumb_mobile = excluded.thumb_mobile, provider = excluded.provider, updated_at = excluded.updated_at, thumb_blob = excluded.thumb_blob, thumb_mobile_blob = excluded.thumb_mobile_blob WHERE projects.owner = excluded.owner AND excluded.updated_at >= projects.updated_at`),
    projThumbs: q('SELECT owner, thumb, thumb_mobile, thumb_blob, thumb_mobile_blob FROM projects WHERE owner = ? AND id = ?'),
    projThumbKeys: q('SELECT thumb_blob, thumb_mobile_blob FROM projects WHERE owner = ? AND (thumb_blob IS NOT NULL OR thumb_mobile_blob IS NOT NULL)'),
    projThumbKeysClient: q('SELECT thumb_blob, thumb_mobile_blob FROM projects WHERE owner = ? AND client_id = ? AND (thumb_blob IS NOT NULL OR thumb_mobile_blob IS NOT NULL)'),
    // in-row image thumbnails worth moving (blobs.mjs keeps ones under 1 KB in-row), walked by rowid so a skipped one can't stall the walk
    projInlineCount: q("SELECT (SELECT COUNT(*) FROM projects WHERE thumb LIKE 'data:image/%' AND length(thumb) >= 1024) + (SELECT COUNT(*) FROM projects WHERE thumb_mobile LIKE 'data:image/%' AND length(thumb_mobile) >= 1024) AS n"),
    projInlineNext: q("SELECT rowid AS rid, owner, id, thumb AS value FROM projects WHERE rowid > ? AND thumb LIKE 'data:image/%' AND length(thumb) >= 1024 ORDER BY rowid LIMIT 1"),
    projInlineNextMobile: q("SELECT rowid AS rid, owner, id, thumb_mobile AS value FROM projects WHERE rowid > ? AND thumb_mobile LIKE 'data:image/%' AND length(thumb_mobile) >= 1024 ORDER BY rowid LIMIT 1"),
    projDropThumb: q('UPDATE projects SET thumb = NULL, thumb_blob = ? WHERE owner = ? AND id = ? AND thumb = ?'),
    projDropThumbMobile: q('UPDATE projects SET thumb_mobile = NULL, thumb_mobile_blob = ? WHERE owner = ? AND id = ? AND thumb_mobile = ?'),
    projDel: q('DELETE FROM projects WHERE owner = ? AND id = ?'),
    tombPut: q('INSERT INTO project_tombstones (id, owner, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, at = excluded.at'), tombDel: q('DELETE FROM project_tombstones WHERE id = ?'), tombList: q('SELECT id, at FROM project_tombstones WHERE owner = ?'),
    projCount: q('SELECT COUNT(*) AS n, COALESCE(SUM(length(json)), 0) AS bytes FROM projects WHERE owner = ?'),
    assetList: q('SELECT id, name, mime, w, h, bytes, meta, created_at FROM assets WHERE owner = ? ORDER BY created_at DESC'),
    assetGet: q('SELECT * FROM assets WHERE owner = ? AND id = ?'), assetMeta: q('SELECT id, name, mime, w, h, bytes, meta, created_at FROM assets WHERE owner = ? AND id = ?'),
    assetPut: q(`INSERT INTO assets (id, owner, name, mime, w, h, bytes, data, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime, w = excluded.w, h = excluded.h, bytes = excluded.bytes, data = excluded.data, meta = COALESCE(excluded.meta, assets.meta) WHERE assets.owner = excluded.owner`),
    assetPatch: q('UPDATE assets SET meta = ?, name = COALESCE(?, name) WHERE owner = ? AND id = ?'),
    assetRow: q("SELECT id, owner, name, mime, w, h, bytes, meta, created_at, blob, CASE WHEN length(data) > 0 THEN data END AS inline FROM assets WHERE owner = ? AND id = ?"),
    assetPutBlob: q(`INSERT INTO assets (id, owner, name, mime, w, h, bytes, data, meta, created_at, blob) VALUES (?, ?, ?, ?, ?, ?, ?, x'', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime, w = excluded.w, h = excluded.h, bytes = excluded.bytes, data = x'', blob = excluded.blob, meta = COALESCE(excluded.meta, assets.meta) WHERE assets.owner = excluded.owner`),
    assetInlineCount: q('SELECT COUNT(*) AS n FROM assets WHERE length(data) > 0'), assetInlineNext: q('SELECT owner, id, data FROM assets WHERE length(data) > 0 LIMIT 1'),
    assetDropInline: q("UPDATE assets SET data = x'', blob = ? WHERE owner = ? AND id = ? AND length(data) > 0"), assetKeys: q('SELECT blob FROM assets WHERE owner = ? AND blob IS NOT NULL'),
    assetDel: q('DELETE FROM assets WHERE owner = ? AND id = ?'), assetUsage: q('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM assets WHERE owner = ?'),
    usageAll: q('SELECT (SELECT COALESCE(SUM(bytes), 0) FROM assets) + (SELECT COALESCE(SUM(length(json)), 0) FROM projects) + (SELECT COALESCE(SUM(length(enc)), 0) FROM profiles) + (SELECT COALESCE(SUM(length(json)), 0) FROM kv) AS bytes'),
    kvGet: q('SELECT json, updated_at FROM kv WHERE owner = ? AND key = ?'),
    kvPut: q('INSERT INTO kv (owner, key, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
    profGet: q('SELECT enc, updated_at FROM profiles WHERE owner = ?'),
    profPut: q('INSERT INTO profiles (owner, enc, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at'),
  };
  const meta = (p) => ({ id: p.id, name: p.name, updatedAt: p.updated_at, createdAt: p.created_at, thumb: p.thumb || undefined, thumbMobile: p.thumb_mobile || undefined, provider: p.provider || undefined, clientId: p.client_id || undefined, size: p.size });
  const cli = (c) => ({ ...JSON.parse(c.json), id: c.id, name: c.name, createdAt: c.created_at, updatedAt: c.updated_at });
  const item = (i) => ({ kind: i.kind, id: i.id, data: JSON.parse(i.json), updatedAt: i.updated_at });
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
      setPassword: (id, hash) => { S.userSetPassword.run(hash, id); },
      setAi: (id, on) => { S.userSetAi.run(on ? 1 : 0, id); },
      list: () => S.userList.all().map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.created_at, ai: !!u.ai_access, google: !!u.google })),
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
      /** Upsert; a body older than the stored copy is refused (`stale`, with the stored updatedAt) instead of silently ignored.
       *  `keys` = blob-store keys of thumbnails already stored (blobs.mjs createProjectStore); such a thumbnail is not kept in-row. */
      put: (owner, p, keys = {}) => {
        const { thumb, thumbMobile, provider, ...rest } = p;
        // a project can only be filed under a client of the same owner
        if (p.clientId && !S.cliGet.get(owner, String(p.clientId))) return { id: p.id, forbidden: true };
        const updated = p.updatedAt || now();
        const r = S.projPut.run(p.id, owner, String(p.name || 'Email').slice(0, 200), JSON.stringify(rest), keys.thumb ? null : thumb || null, keys.thumbMobile ? null : thumbMobile || null, provider || null, p.createdAt || updated, updated, keys.thumb || null, keys.thumbMobile || null);
        if (!Number(r.changes)) { const cur = S.projGet.get(owner, p.id); return { id: p.id, updatedAt: cur ? cur.updated_at : updated, stale: true }; }
        S.projSetClient.run(p.clientId ? String(p.clientId) : null, owner, p.id);
        S.tombDel.run(p.id); // re-saved after a delete elsewhere: it lives again
        return { id: p.id, updatedAt: updated };
      },
      remove: (owner, id) => { S.projDel.run(owner, id); S.tombPut.run(id, owner, now()); },
      tombstones: (owner) => S.tombList.all(owner),
      /** Where each thumbnail is: in-row (`thumb`, legacy or not an image data URL) or a blob-store key (`thumbBlob`). */
      thumbs: (owner, id) => { const r = S.projThumbs.get(owner, id); return r ? { thumb: r.thumb || null, thumbMobile: r.thumb_mobile || null, thumbBlob: r.thumb_blob || null, thumbMobileBlob: r.thumb_mobile_blob || null } : null; },
      thumbKeysOf: (owner, clientId) => (clientId ? S.projThumbKeysClient.all(owner, clientId) : S.projThumbKeys.all(owner)).flatMap((r) => [r.thumb_blob, r.thumb_mobile_blob]).filter(Boolean),
      inlineThumbCount: () => Number(S.projInlineCount.get().n),
      /** The next in-row thumbnail after rowid `after` (desktop or mobile column), with its rowid as the cursor for the next call. */
      inlineThumbNext: (mobile, after = 0) => { const r = (mobile ? S.projInlineNextMobile : S.projInlineNext).get(after); return r ? { rid: Number(r.rid), owner: r.owner, id: r.id, mobile, value: r.value } : null; },
      /** Swap an in-row thumbnail for its key, only if the row still holds that exact value (a save meanwhile wins). */
      dropInlineThumb: (owner, id, mobile, value, key) => Number((mobile ? S.projDropThumbMobile : S.projDropThumb).run(key, owner, id, value).changes) > 0,
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
      /** Blob-store side (see blobs.mjs): metadata plus where the bytes are — `inline` for rows not migrated yet, else `blob`. */
      row: (owner, id) => { const a = S.assetRow.get(owner, id); return a ? { owner: a.owner, meta: assetMeta(a), blob: a.blob || null, inline: a.inline ? Buffer.from(a.inline) : null } : null; },
      /** Metadata + blob key (bytes already stored); null when the id belongs to another owner. */
      putBlob: (owner, m, bytes, key) => { const meta = m.meta ? JSON.stringify(m.meta) : null; const t = now(); const r = S.assetPutBlob.run(m.id, owner, String(m.name || 'image').slice(0, 200), m.mime || 'application/octet-stream', m.w | 0, m.h | 0, bytes, meta, t, key); return Number(r.changes) ? assetMeta({ ...m, meta, bytes, created_at: t }) : null; },
      inlineCount: () => Number(S.assetInlineCount.get().n),
      inlineNext: () => { const r = S.assetInlineNext.get(); return r ? { owner: r.owner, id: r.id, data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength) } : null; },
      dropInline: (owner, id, key) => Number(S.assetDropInline.run(key, owner, id).changes) > 0,
      keysOf: (owner) => S.assetKeys.all(owner).map((r) => r.blob),
    },
    profiles: {
      get: (owner, secret) => { const r = S.profGet.get(owner); if (!r) return { profiles: [], updatedAt: null }; try { return { profiles: JSON.parse(decrypt(secret, r.enc)), updatedAt: r.updated_at }; } catch { return { profiles: [], updatedAt: r.updated_at, corrupt: true }; } }, // corrupt = secret changed: the client must keep its own copy
      put: (owner, secret, profiles) => { const t = now(); S.profPut.run(owner, encrypt(secret, JSON.stringify(profiles)), t); return { updatedAt: t }; },
    },
    clients: {
      list: (owner) => S.cliList.all(owner).map(cli),
      get: (owner, id) => { const c = S.cliGet.get(owner, id); return c ? cli(c) : null; },
      put: (owner, c) => {
        const updated = c.updatedAt || now();
        const { id, name, createdAt, updatedAt, owner: _o, ...rest } = c;
        const r = S.cliPut.run(String(id), owner, String(name || 'Khách hàng').slice(0, 120), JSON.stringify(rest), createdAt || updated, updated);
        if (!Number(r.changes)) { const cur = S.cliGet.get(owner, String(id)); return cur && cur.owner === owner ? { id, updatedAt: cur.updated_at, stale: true } : { id, forbidden: true }; }
        return { id, updatedAt: updated };
      },
      /** Remove a client with everything filed under it (items, audit, shares cascade; its email projects too). */
      remove: (owner, id) => { if (!S.cliGet.get(owner, id)) return false; S.cliProjDel.run(owner, id); S.cliDel.run(owner, id); return true; },
    },
    items: {
      list: (owner, clientId, kind) => (kind ? S.itemListKind.all(owner, clientId, kind) : S.itemList.all(owner, clientId)).map(item),
      get: (owner, clientId, kind, id) => { const i = S.itemGet.get(owner, clientId, kind, id); return i ? item(i) : null; },
      put: (owner, clientId, kind, id, data, updatedAt) => { const t = updatedAt || now(); const r = S.itemPut.run(clientId, kind, String(id).slice(0, 80), JSON.stringify(data ?? null), t, clientId, owner); return Number(r.changes) ? { updatedAt: t } : (S.cliGet.get(owner, clientId) ? { updatedAt: t, stale: true } : { forbidden: true }); },
      remove: (owner, clientId, kind, id) => Number(S.itemDel.run(clientId, kind, id, clientId, owner).changes) > 0,
    },
    audit: {
      add: (owner, clientId, actor, action, detail = '') => { S.auditAdd.run(clientId, String(actor).slice(0, 120), String(action).slice(0, 60), String(detail).slice(0, 500), now(), clientId, owner); },
      list: (owner, clientId) => S.auditList.all(owner, clientId),
    },
    shares: {
      /** A review link for one item: the raw token is returned once, only its hash is stored. */
      create: (owner, clientId, kind, itemId, days = 30) => { const token = randomBytes(18).toString('base64url'); const r = S.shareAdd.run(sha256(token), clientId, kind, itemId, now(), new Date(Date.now() + days * 86400e3).toISOString(), clientId, owner); return Number(r.changes) ? token : null; },
      resolve: (token) => { const s0 = S.shareGet.get(sha256(String(token || ''))); if (!s0 || s0.expires_at < now()) return null; return { clientId: s0.client_id, owner: s0.owner, kind: s0.kind, itemId: s0.item_id, clientName: s0.client_name, client: JSON.parse(s0.client_json || '{}'), expiresAt: s0.expires_at }; },
      /** Writes made through a review link: only to that link's client, logged as the reviewer. */
      write: (sh, kind, id, data, actor, action, detail) => { const t = now(); S.shareItemPut.run(sh.clientId, kind, id, JSON.stringify(data), t); S.shareAudit.run(sh.clientId, `Khách: ${String(actor).slice(0, 80)}`, action, String(detail).slice(0, 500), t); return { updatedAt: t }; },
      /** Live links of one client; `id` is a short prefix of the token hash, enough to revoke it, useless to open it. */
      list: (owner, clientId) => S.shareList.all(owner, clientId).map((r) => ({ id: r.token_hash.slice(0, 16), kind: r.kind, itemId: r.item_id, createdAt: r.created_at, expiresAt: r.expires_at })),
      revoke: (owner, clientId, id) => Number(S.shareRevoke.run(clientId, String(id).slice(0, 16), clientId, owner).changes) > 0,
    },
    members: {
      list: (owner, clientId) => S.memList.all(owner, clientId).map((m) => ({ userId: m.user_id, name: m.name, email: m.email, role: m.role, addedAt: m.added_at })),
      /** Only the client's owner adds teammates, never itself, only with a known role. */
      put: (owner, clientId, userId, role) => CLIENT_ROLES.includes(role) && Number(S.memPut.run(clientId, userId, role, now(), clientId, owner, userId).changes) > 0,
      remove: (owner, clientId, userId) => Number(S.memDel.run(clientId, userId, clientId, owner).changes) > 0,
      /** Clients shared with this user by another account, with the role it holds there. */
      clientsOf: (userId) => S.memOf.all(userId).map((c) => ({ ...cli(c), role: c.role, shared: true })),
    },
    /** Who may open a client: { owner, role } when `userId` owns it or is a member, else null. Every route resolves this first
     *  and then talks to the tables as the client's owner, so the owner-scoped statements above stay the only gate. */
    access: (userId, clientId) => { const r = S.access.get(userId, userId, String(clientId || ''), userId); return r ? { owner: r.owner, role: r.role } : null; },
    kv: {
      get: (owner, key) => { const r = S.kvGet.get(owner, key); return r ? { value: JSON.parse(r.json), updatedAt: r.updated_at } : { value: null, updatedAt: null }; },
      put: (owner, key, value, updatedAt) => { const t = updatedAt || now(); S.kvPut.run(owner, String(key).slice(0, 64), JSON.stringify(value ?? null), t); return { updatedAt: t }; },
    },
    aiCodes: {
      add: (id, hash, note) => { S.codeAdd.run(id, hash, String(note || '').slice(0, 200), now()); },
      redeem: (hash, userId) => Number(S.codeUse.run(userId, now(), hash).changes) > 0,
      list: () => S.codeList.all().map((c) => ({ id: c.id, note: c.note, createdAt: c.created_at, usedBy: c.used_by || null, usedAt: c.used_at || null })),
    },
    aiRequests: {
      put: (userId, note) => { S.reqPut.run(userId, String(note || '').slice(0, 500), now()); },
      done: (userId) => { S.reqDone.run(userId); },
      get: (userId) => S.reqGet.get(userId) || null,
      list: () => S.reqList.all().map((r) => ({ userId: r.user_id, email: r.email, name: r.name, note: r.note, at: r.at, status: r.status })),
    },
    admin: {
      totals: () => { const t = S.admTotals.get(); return Object.fromEntries(Object.entries(t).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), Number(v)])); },
      users: () => S.admUsers.all().map((u) => ({ id: u.id, name: u.name, email: u.email, brand: u.brand, createdAt: u.created_at, ai: !!u.ai_access, google: !!u.google, projects: Number(u.projects), projectBytes: Number(u.project_bytes), assets: Number(u.assets), assetBytes: Number(u.asset_bytes), lastSeen: u.last_seen || null, sessions: Number(u.sessions) })),
      projects: () => S.admProjects.all().map((p) => ({ id: p.id, name: p.name, owner: p.email, createdAt: p.created_at, updatedAt: p.updated_at, size: Number(p.size), provider: p.provider || null })),
      assets: () => S.admAssets.all().map((a) => { const m = parseMeta(a.meta); return { id: a.id, name: a.name, mime: a.mime, w: a.w, h: a.h, bytes: Number(a.bytes), createdAt: a.created_at, owner: a.email, source: m.src?.host || m.src?.kind || null }; }),
      deleteUser: (id) => Number(S.userDelete.run(id).changes) > 0,
    },
    stats: (owner) => ({ projects: S.projCount.get(owner), assets: S.assetUsage.get(owner), sessions: S.sessList.all(owner).length }),
    usageAll: () => Number(S.usageAll.get().bytes),
    close: () => db.close(),
  };
}
