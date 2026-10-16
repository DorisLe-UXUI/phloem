// Asset bytes live outside SQLite: one file per asset under DATA_DIR/blobs and, when a backup bucket is configured, one
// object per asset in that bucket (`<prefix>assets/<key>`). The database keeps only metadata plus the blob key, so the
// snapshot that backup.mjs uploads stays small enough to finish inside a host's shutdown window.
// Each write gets a fresh key (never overwrite in place), so a replaced or migrated asset can't clobber a newer upload.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { s3Call } from './backup.mjs';

const newKey = () => randomBytes(20).toString('hex');
const okKey = (k) => /^[0-9a-f]{40}$/.test(String(k || ''));
/** Same salt + same bytes → same key, so storing an unchanged thumbnail again is a no-op. */
const contentKey = (salt, data) => createHash('sha256').update(salt).update(data).digest('hex').slice(0, 40);

/** Bytes by key: local disk first, then the bucket (cached on disk after the first read on a fresh container). */
export function createBlobStore({ cfg = null, dir, call = s3Call, log = console.log }) {
  mkdirSync(dir, { recursive: true });
  const file = (k) => join(dir, k);
  const objectKey = (k) => `${cfg.prefix}assets/${k}`;
  const stats = { uploads: 0, downloads: 0, errors: 0 };
  return {
    stats,
    /** Stores `data` under a new key and returns it; resolves only once the bucket has it, so a later snapshot never points at missing bytes. */
    async put(data) {
      const k = newKey();
      writeFileSync(file(k), data);
      if (cfg) {
        try {
          const r = await call(cfg, 'PUT', objectKey(k), data, { 'content-type': 'application/octet-stream' });
          if (r.status < 200 || r.status >= 300) throw new Error(`PUT asset → HTTP ${r.status} ${r.body.toString('utf8').slice(0, 160)}`);
          stats.uploads++;
        } catch (e) { stats.errors++; try { unlinkSync(file(k)); } catch { /* gone */ } throw e; }
      }
      return k;
    },
    /** Migration: stores `data` under a key derived from (owner, id, bytes), so a run that crashed half-way and starts over
     *  finds what it already uploaded (HEAD) and skips it. Not cached on disk: the container's disk already holds the old DB. */
    async putMigrated(owner, id, data) {
      const k = contentKey(`${owner}\0${id}\0`, data);
      await this.putAt(k, data, { head: true, cache: false });
      return k;
    },
    /** Stores `data` under a caller-chosen (content-derived) key. `head`: skip the upload when the bucket already has it. */
    async putAt(k, data, { head = false, cache = true } = {}) {
      if (!okKey(k)) throw new Error('bad blob key');
      if (cache || !cfg) writeFileSync(file(k), data);
      if (!cfg) return k;
      try {
        if (head && (await call(cfg, 'HEAD', objectKey(k))).status === 200) return k;
        const r = await call(cfg, 'PUT', objectKey(k), data, { 'content-type': 'application/octet-stream' });
        if (r.status < 200 || r.status >= 300) throw new Error(`PUT blob → HTTP ${r.status} ${r.body.toString('utf8').slice(0, 160)}`);
        stats.uploads++;
      } catch (e) { stats.errors++; if (cache) { try { unlinkSync(file(k)); } catch { /* gone */ } } throw e; }
      return k;
    },
    async get(k) {
      if (!okKey(k)) return null;
      if (existsSync(file(k))) return readFileSync(file(k));
      if (!cfg) return null;
      const r = await call(cfg, 'GET', objectKey(k));
      if (r.status === 404) return null;
      if (r.status !== 200) { stats.errors++; throw new Error(`GET asset → HTTP ${r.status}`); }
      stats.downloads++;
      try { writeFileSync(file(k), r.body); } catch { /* cache only */ }
      return r.body;
    },
    /** Best effort: a leftover object costs storage, never correctness. */
    async remove(k) {
      if (!okKey(k)) return;
      try { unlinkSync(file(k)); } catch { /* not cached */ }
      if (!cfg) return;
      try { const r = await call(cfg, 'DELETE', objectKey(k)); if (r.status >= 300 && r.status !== 404) throw new Error(`HTTP ${r.status}`); }
      catch (e) { stats.errors++; log('[blobs] delete failed:', k, e?.message || e); }
    },
  };
}

/** The asset API the routes use: SQLite metadata (db.assets) + bytes in the blob store. Rows written before 2026-10-15 may
 *  still carry their bytes in-row until `migrate()` moves them out. */
export function createAssetStore({ db, blobs, log = console.log }) {
  const A = db.assets;
  const migration = { pending: A.inlineCount(), moved: 0, running: false, error: null };
  // Crash mid-migration is safe: a row is cleared only after its object is in the bucket, so any snapshot taken meanwhile
  // (rows cleared or not) is self-consistent; the next boot restores it and carries on, skipping objects already uploaded.
  return {
    migration,
    list: (owner) => A.list(owner),
    meta: (owner, id) => A.meta(owner, id),
    async get(owner, id) {
      const row = A.row(owner, id); if (!row) return null;
      const data = row.inline?.length ? row.inline : await blobs.get(row.blob);
      return data ? { ...row.meta, data } : null;
    },
    async put(owner, m, data) {
      const prev = A.row(owner, String(m?.id || ''));
      const k = await blobs.put(data);
      const r = A.putBlob(owner, m, data.length, k);
      if (!r) { await blobs.remove(k); return null; } // the id belongs to someone else
      if (prev?.blob && prev.blob !== k) await blobs.remove(prev.blob);
      return r;
    },
    patch: (owner, id, meta, name) => A.patch(owner, id, meta, name),
    async remove(owner, id) { const row = A.row(owner, id); A.remove(owner, id); if (row?.blob) await blobs.remove(row.blob); },
    /** Every blob key of one user (read before deleting the account, whose rows cascade away). */
    keysOf: (owner) => A.keysOf(owner),
    removeKeys: async (keys) => { for (const k of keys) await blobs.remove(k); },
    /** Move in-row bytes to the blob store, one asset at a time; a row is cleared only after its bytes are safely stored. */
    async migrate(onDone) {
      if (migration.running) return;
      migration.running = true; migration.error = null;
      try {
        // one row in memory at a time (the relay has 512 MB; the old database held ~140 MB of images)
        for (let r = A.inlineNext(); r; r = A.inlineNext()) {
          let k = await blobs.putMigrated(r.owner, r.id, r.data);
          if (!A.dropInline(r.owner, r.id, k)) await blobs.remove(k); // replaced meanwhile: the new upload already has its own key
          r = null; k = null;
          migration.moved++; migration.pending = Math.max(0, migration.pending - 1);
        }
        migration.pending = 0;
        if (migration.moved) { log(`[blobs] moved ${migration.moved} asset(s) out of the database`); onDone?.(); }
      } catch (e) { migration.error = String(e?.message || e); log('[blobs] migration paused:', migration.error); }
      finally { migration.running = false; }
    },
  };
}

// ---------- project thumbnails ----------
// The studio sends each project with `thumb` / `thumbMobile` as base64 data URLs (~40 KB JPEG each). Base64 JPEG barely
// gzips, so in-row they were most of the snapshot. Now the bytes are blobs keyed by (owner, project id, slot, bytes) and the
// row keeps the key; the API still takes and returns data URLs, so clients don't change.

const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const MIN_OUT = 1024; // smaller thumbnails stay in-row: not worth a bucket object
/** The image type from its first bytes (the row stores only the key). */
export function sniffImage(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}
/** Bytes of a data URL that round-trips exactly through (bytes → sniffed type → base64), else null (kept in-row as is). */
export function thumbBytes(v) {
  const m = typeof v === 'string' && v.length >= MIN_OUT ? DATA_URL.exec(v) : null; if (!m) return null;
  const b = Buffer.from(m[2], 'base64');
  return sniffImage(b) === m[1] && b.toString('base64') === m[2] ? b : null;
}
const toDataUrl = (b) => `data:${sniffImage(b)};base64,${b.toString('base64')}`;

/** The project API the routes use: rows in SQLite (db.projects), thumbnail bytes in the blob store. */
export function createProjectStore({ db, blobs, log = console.log }) {
  const P = db.projects;
  const migration = { pending: P.inlineThumbCount(), moved: 0, running: false, error: null };
  // one write at a time per project: a save and the migration (or two saves) must not drop each other's blob
  const locks = new Map();
  const locked = (owner, id, fn) => {
    const k = `${owner}\0${id}`;
    const run = (locks.get(k) || Promise.resolve()).catch(() => {}).then(fn);
    const tail = run.catch(() => {}); locks.set(k, tail);
    tail.then(() => { if (locks.get(k) === tail) locks.delete(k); });
    return run;
  };
  const keyOf = (owner, id, mobile, b) => contentKey(`${owner}\0${id}\0${mobile ? 'thumb_mobile' : 'thumb'}\0`, b);
  const read = async (inline, key) => {
    if (inline) return inline;
    if (!key) return undefined;
    try { const b = await blobs.get(key); return b && sniffImage(b) ? toDataUrl(b) : undefined; }
    catch (e) { log('[projects] thumbnail unavailable:', key, e?.message || e); return undefined; } // the next save from the studio stores a new one
  };
  return {
    migration,
    list: (owner) => P.list(owner),
    tombstones: (owner) => P.tombstones(owner),
    async get(owner, id) {
      const p = P.get(owner, id); if (!p) return null;
      const t = P.thumbs(owner, id);
      const [thumb, thumbMobile] = await Promise.all([read(t.thumb, t.thumbBlob), read(t.thumbMobile, t.thumbMobileBlob)]);
      return { ...p, thumb, thumbMobile };
    },
    /** Same contract as db.projects.put. A thumbnail is uploaded only when its bytes changed; the old one is deleted after the row moves on. */
    put(owner, p) {
      return locked(owner, String(p.id), async () => {
        const prev = P.thumbs(owner, String(p.id)); // null for a new id (or another owner's, which the db then refuses)
        const keys = {}; const fresh = [];
        for (const [slot, mobile] of [['thumb', false], ['thumbMobile', true]]) {
          const b = thumbBytes(p[slot]); if (!b) continue;
          const k = keyOf(owner, p.id, mobile, b);
          const cur = mobile ? prev?.thumbMobileBlob : prev?.thumbBlob;
          if (k !== cur) { await blobs.putAt(k, b); fresh.push(k); }
          keys[slot] = k;
        }
        const r = P.put(owner, p, keys);
        const now = P.thumbs(owner, String(p.id));
        const live = new Set([now?.thumbBlob, now?.thumbMobileBlob].filter(Boolean));
        // refused (stale / forbidden) → drop what we just uploaded; accepted → drop the replaced ones
        const gone = r.stale || r.forbidden ? fresh : [prev?.thumbBlob, prev?.thumbMobileBlob].filter(Boolean);
        for (const k of new Set(gone)) if (!live.has(k)) await blobs.remove(k);
        return r;
      });
    },
    remove(owner, id) {
      return locked(owner, id, async () => {
        const t = P.thumbs(owner, id);
        P.remove(owner, id);
        for (const k of [t?.thumbBlob, t?.thumbMobileBlob]) if (k) await blobs.remove(k);
      });
    },
    /** Thumbnail keys of a user (or of one client's projects): read before rows cascade away. */
    keysOf: (owner, clientId) => P.thumbKeysOf(owner, clientId),
    removeKeys: async (keys) => { for (const k of keys) await blobs.remove(k); },
    /** Move in-row thumbnails to the blob store, one at a time; a row is changed only after its bytes are stored. */
    async migrate(onDone) {
      if (migration.running) return;
      migration.running = true; migration.error = null;
      try {
        for (const mobile of [false, true]) {
          // one thumbnail in memory at a time; the cursor moves past rows it can't move (odd data URLs stay in-row)
          for (let r = P.inlineThumbNext(mobile, 0), after = 0; r; r = P.inlineThumbNext(mobile, after)) {
            const { rid, owner, id, value } = r; r = null; after = rid;
            await locked(owner, id, async () => {
              const b = thumbBytes(value); if (!b) return;
              const k = keyOf(owner, id, mobile, b);
              await blobs.putAt(k, b, { head: true });
              if (!P.dropInlineThumb(owner, id, mobile, value, k)) { // saved meanwhile: that save stored its own (maybe this very key)
                const t = P.thumbs(owner, id); if (k !== t?.thumbBlob && k !== t?.thumbMobileBlob) await blobs.remove(k);
              }
              migration.moved++;
            });
            migration.pending = Math.max(0, migration.pending - 1);
          }
        }
        migration.pending = P.inlineThumbCount(); // what is left can't be moved (not a plain image data URL)
        if (migration.moved) { log(`[projects] moved ${migration.moved} thumbnail(s) out of the database`); onDone?.(); }
      } catch (e) { migration.error = String(e?.message || e); log('[projects] thumbnail migration paused:', migration.error); }
      finally { migration.running = false; }
    },
  };
}
