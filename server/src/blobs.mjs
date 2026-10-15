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
        for (;;) {
          const batch = A.inlineBatch(20); if (!batch.length) break;
          for (const r of batch) {
            const k = await blobs.put(r.data);
            if (!A.dropInline(r.owner, r.id, k)) await blobs.remove(k); // replaced meanwhile: the new upload already has its own key
            migration.moved++;
          }
          migration.pending = A.inlineCount();
        }
        migration.pending = 0;
        if (migration.moved) { log(`[blobs] moved ${migration.moved} asset(s) out of the database`); onDone?.(); }
      } catch (e) { migration.error = String(e?.message || e); log('[blobs] migration paused:', migration.error); }
      finally { migration.running = false; }
    },
  };
}
