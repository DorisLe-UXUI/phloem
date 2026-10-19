// Durable data on ephemeral hosts (Render free, Fly without volumes…): the SQLite file and the auth secret are
// restored from an S3-compatible bucket at boot and a consistent, gzipped snapshot is uploaded ~10 min after writes and on
// shutdown, only when something changed (Render's free plan allows 5 GB of outbound traffic a month: full uploads on every
// wake-up and sleep used it up). Asset bytes are separate objects in the same bucket (blobs.mjs). Zero dependencies: AWS Signature V4 by hand. Works with Cloudflare R2 (free 10 GB), Backblaze B2, AWS S3, MinIO.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

export function backupConfig(env = process.env) {
  const endpoint = String(env.BACKUP_S3_ENDPOINT || '').replace(/\/$/, '');
  const bucket = env.BACKUP_S3_BUCKET, key = env.BACKUP_S3_KEY, secret = env.BACKUP_S3_SECRET;
  if (!endpoint || !bucket || !key || !secret) return null;
  return { endpoint, bucket, key, secret, region: env.BACKUP_S3_REGION || 'auto', prefix: String(env.BACKUP_S3_PREFIX || 'phloem/').replace(/^\/+/, ''), every: Math.max(1, Number(env.BACKUP_EVERY_MIN || 60)), debounce: Math.max(1, Number(env.BACKUP_DEBOUNCE_SEC || 60)) }; // ≤ 1 min behind: a crash or deploy loses at most that
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const encPath = (p) => p.split('/').map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

/** SigV4 headers for one request (path-style: /bucket/key). `payload` is the bytes, or `{ hash }` for a file streamed from disk. `when` is injectable for tests. */
export function sign(cfg, method, objectKey, payload, extraHeaders = {}, when = new Date()) {
  const url = new URL(`${cfg.endpoint}/${encPath([cfg.bucket, objectKey].filter(Boolean).join('/'))}`); // path-style; an empty bucket means the endpoint already names it
  const amzDate = when.toISOString().replace(/[:-]|\.\d{3}/g, ''); const date = amzDate.slice(0, 8);
  const payloadHash = payload?.hash || sha(payload);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders };
  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = names.map((k) => `${k}:${String(headers[k] ?? headers[Object.keys(headers).find((h) => h.toLowerCase() === k)]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + cfg.secret, date), cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return { url, headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${cfg.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, signature };
}

/** sha256 of a file, read in chunks (a snapshot can be large: never hold it in memory). */
export async function hashFile(file) { const h = createHash('sha256'); for await (const c of createReadStream(file)) h.update(c); return h.digest('hex'); }

export function s3Call(cfg, method, objectKey, payload = Buffer.alloc(0), extra = {}, opts = {}) { return call(cfg, method, objectKey, payload, extra, opts); }
/** One request. `payload` = Buffer, or `{ file, size, hash }` to stream a file up; `opts.toFile` streams a 200 response body
 *  to that path (via a temp file, renamed when complete) instead of buffering it. Error bodies are always small and buffered. */
function call(cfg, method, objectKey, payload = Buffer.alloc(0), extra = {}, opts = {}) {
  const { url, headers } = sign(cfg, method, objectKey, payload, extra);
  const streamed = !Buffer.isBuffer(payload);
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = mod({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method, headers: { ...headers, 'content-length': streamed ? payload.size : payload.length }, timeout: 60_000 }, (res) => {
      if (opts.toFile && res.statusCode === 200) {
        const part = `${opts.toFile}.part`;
        pipeline(res, createWriteStream(part)).then(() => { renameSync(part, opts.toFile); resolve({ status: 200, body: Buffer.alloc(0), size: statSync(opts.toFile).size, headers: res.headers }); }, (e) => { try { unlinkSync(part); } catch { /* none */ } reject(e); });
        return;
      }
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts), headers: res.headers })); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (streamed) pipeline(createReadStream(payload.file), req).catch(reject);
    else req.end(payload);
  });
}

/** Fresh container (no database file yet) → pull the last snapshot and the auth secret from the bucket.
 *  Returns 'restored' | 'empty' (bucket has no snapshot) | 'local' (a database file is already here) | 'failed' | 'off'. */
/** Which container wrote the snapshot this one booted from, and why (a shutdown snapshot is final; an interval one may
 *  be followed by the old container's last upload while both run during a deploy). */
export const restoredFrom = { instance: '', reason: '', etag: '', at: 0 };
/** This container's id, stamped on every upload so a newer instance can tell its own uploads from the old one's. */
export const INSTANCE = randomBytes(6).toString('hex');
export async function restoreBackup(cfg, dataDir, log = console.log, { tries = 3, wait = 2000 } = {}) {
  if (!cfg) return 'off';
  const dbFile = join(dataDir, 'phloem.db');
  if (existsSync(dbFile)) return 'local'; // a persistent disk or a warm container: local wins
  for (let i = 1; i <= tries; i++) {
    try {
      const t0 = Date.now();
      // gzipped snapshot first (current format), the plain one from older relays otherwise; streamed to disk either way
      let db = await call(cfg, 'GET', cfg.prefix + 'phloem.db.gz', undefined, {}, { toFile: `${dbFile}.gz` });
      if (db.status === 200) { await pipeline(createReadStream(`${dbFile}.gz`), createGunzip(), createWriteStream(dbFile)); unlinkSync(`${dbFile}.gz`); db = { ...db, size: statSync(dbFile).size }; Object.assign(restoredFrom, { instance: String(db.headers?.['x-amz-meta-phloem-instance'] || ''), reason: String(db.headers?.['x-amz-meta-phloem-reason'] || ''), etag: String(db.headers?.etag || ''), at: Date.now() }); }
      else if (db.status === 404) db = await call(cfg, 'GET', cfg.prefix + 'phloem.db', undefined, {}, { toFile: dbFile });
      if (db.status === 404) { log('[backup] no snapshot in the bucket yet'); return 'empty'; }
      if (db.status !== 200) throw new Error(`GET phloem.db → HTTP ${db.status} ${db.body.toString('utf8').slice(0, 160)}`);
      const sec = await call(cfg, 'GET', cfg.prefix + 'auth-secret');
      if (sec.status === 200 && !process.env.AUTH_SECRET) writeFileSync(join(dataDir, 'auth-secret'), sec.body, { mode: 0o600 });
      log(`[backup] restored phloem.db (${(db.size / 1024).toFixed(0)} KB) from ${cfg.bucket} in ${Date.now() - t0} ms`);
      return 'restored';
    } catch (e) { log(`[backup] restore attempt ${i}/${tries} failed:`, e?.message || e); if (i < tries) await new Promise((r) => setTimeout(r, wait * i)); }
  }
  return 'failed';
}

/** Snapshot (VACUUM INTO = consistent even in WAL mode) and upload when it changed: ~`debounce` seconds after any write
 *  (SQLite's total_changes() on the app connection, polled), every `every` minutes as a safety net, and on shutdown.
 *  Asset bytes are not in the database (blobs.mjs), so the snapshot is small and the shutdown upload finishes in time.
 *  `paused` (the boot restore failed): never upload, so an empty fresh database can't overwrite the good copy. */
export function startBackups(cfg, db, dataDir, log = console.log, opts = {}) {
  const debounce = Math.max(0, Number(opts.debounceSec ?? cfg?.debounce ?? 600)) * 1000;
  // the bucket already holds this database (just restored, or a warm container): nothing to upload until a write
  const inBucket = opts.restored === 'restored' || opts.restored === 'local';
  const state = { enabled: !!cfg, at: null, error: null, bytes: 0, ms: 0, dirty: false, uploading: null, paused: !!opts.paused, daily: '' };
  const me = opts.instance || INSTANCE;
  state.settled = Promise.resolve(); // senders start at once unless a deploy handover is being watched (below)
  if (!cfg) return state;
  if (state.paused) state.error = 'restore failed at boot; uploads paused so the bucket copy is not overwritten (redeploy to retry)';
  let lastHash = '';
  const changes = () => { try { return Number(db.prepare('SELECT total_changes() AS n').get().n); } catch { return 0; } };
  let seen = changes(), timer = null;
  let handover = false; // a deploy's old container may still upload: ours would overwrite its last word, so wait
  const snapshot = async (reason, force = false) => {
    if (state.paused) return;
    if (handover && !force && !/^SIG/.test(String(reason))) { state.dirty = true; return; }
    if (!force && !state.dirty && (lastHash || inBucket)) return; // unchanged since the last upload (or the restore)
    if (state.uploading) { await state.uploading; if (!state.dirty) return; if (state.uploading) return state.uploading; } // a write landed during that upload: go again
    state.uploading = (async () => {
      const t0 = Date.now();
      const tmp = join(dataDir, `snapshot-${process.pid}.db`);
      const gz = `${tmp}.gz`;
      try {
        state.dirty = false; seen = changes();
        try { unlinkSync(tmp); } catch { /* none */ }
        db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
        const h = await hashFile(tmp); // streamed from disk, never read whole
        if (h === lastHash) return;
        await pipeline(createReadStream(tmp), createGzip({ level: 9 }), createWriteStream(gz));
        const snap = { file: gz, size: statSync(gz).size, hash: await hashFile(gz) };
        const r = await call(cfg, 'PUT', cfg.prefix + 'phloem.db.gz', snap, { 'content-type': 'application/gzip', 'x-amz-meta-phloem-instance': me, 'x-amz-meta-phloem-reason': String(reason).replace(/[^\w -]/g, '').slice(0, 40) });
        if (r.status < 200 || r.status >= 300) throw new Error(`PUT phloem.db.gz → HTTP ${r.status} ${r.body.toString('utf8').slice(0, 160)}`);
        const secFile = join(dataDir, 'auth-secret');
        if (existsSync(secFile) && !process.env.AUTH_SECRET) { const s = await call(cfg, 'PUT', cfg.prefix + 'auth-secret', readFileSync(secFile), { 'content-type': 'text/plain' }); if (s.status < 200 || s.status >= 300) throw new Error(`PUT auth-secret → HTTP ${s.status}`); }
        // one dated copy a day, so a bad snapshot can't wipe out the only good one
        const day = new Date().toISOString().slice(0, 10);
        if (state.daily !== day) {
          const key = `${cfg.prefix}snapshots/${day}.db.gz`;
          const head = await call(cfg, 'HEAD', key); // a container that woke up today may already have made it
          if (head.status === 200) state.daily = day;
          else { const d = await call(cfg, 'PUT', key, snap, { 'content-type': 'application/gzip' }); if (d.status >= 200 && d.status < 300) state.daily = day; }
        }
        lastHash = h; state.at = new Date().toISOString(); state.bytes = snap.size; state.ms = Date.now() - t0; state.error = null;
        log(`[backup] uploaded ${(snap.size / 1024).toFixed(0)} KB gzipped (${(statSync(tmp).size / 1024).toFixed(0)} KB raw) in ${state.ms} ms (${reason})`);
      } catch (e) { state.dirty = true; state.error = String(e?.message || e); log('[backup] upload failed:', state.error); }
      finally { for (const f of [tmp, gz]) { try { unlinkSync(f); } catch { /* gone */ } } state.uploading = null; }
    })();
    return state.uploading;
  };
  const markDirty = () => {
    state.dirty = true;
    if (!timer) timer = setTimeout(() => { timer = null; void snapshot('after writes'); }, debounce);
    timer.unref?.();
  };
  const poll = setInterval(() => { const n = changes(); if (n !== seen) { seen = n; markDirty(); } }, Math.max(50, Number(opts.pollMs ?? 2000)));
  poll.unref();
  const first = setTimeout(() => { void snapshot('first run'); }, Number(opts.firstMs ?? 20_000)); first.unref();
  const every = setInterval(() => { void snapshot('interval'); }, cfg.every * 60_000); every.unref();
  const bye = (sig) => {
    const t0 = Date.now();
    snapshot(sig).finally(() => { log(`[backup] shutdown snapshot finished in ${Date.now() - t0} ms`); process.exit(0); });
    setTimeout(() => { log(`[backup] shutdown snapshot still running after ${Date.now() - t0} ms; exiting`); process.exit(0); }, 25_000).unref();
  };
  if (opts.signals !== false) { process.once('SIGTERM', () => bye('SIGTERM')); process.once('SIGINT', () => bye('SIGINT')); }
  // Deploys overlap: the new container restores the last upload while the old one still records opens, clicks and
  // sends, then uploads once more on SIGTERM. Watch the bucket for that final upload and merge what it adds, and hold
  // the senders (state.settled) until then so both containers never work the same queue.
  if (opts.restored === 'restored' && !state.paused && !/^SIG/.test(restoredFrom.reason)) {
    const watchMs = Number(opts.lateWatchMs ?? 240_000), every = Number(opts.latePollMs ?? 10_000);
    handover = true;
    state.settled = new Promise((done0) => {
      const done = () => { handover = false; if (state.dirty) void snapshot('after handover'); done0(); };
      const t0 = Date.now(); let seenTag = restoredFrom.etag;
      const tick = async () => {
        try {
          const h = await call(cfg, 'HEAD', cfg.prefix + 'phloem.db.gz');
          const who = String(h.headers?.['x-amz-meta-phloem-instance'] || ''), why = String(h.headers?.['x-amz-meta-phloem-reason'] || ''), tag = String(h.headers?.etag || '');
          if (h.status === 200 && who !== me && tag && tag !== seenTag) { // the other container uploaded after our restore
            seenTag = tag;
            const file = join(dataDir, `late-${process.pid}.db`);
            const g = await call(cfg, 'GET', cfg.prefix + 'phloem.db.gz', undefined, {}, { toFile: `${file}.gz` });
            if (g.status === 200) {
              await pipeline(createReadStream(`${file}.gz`), createGunzip(), createWriteStream(file));
              const n = mergeLate(db, file);
              log(`[backup] merged ${n} row(s) from the previous container's last snapshot (${why || 'upload'})`);
              markDirty(); void snapshot('after late merge', true);
            }
            for (const f of [file, `${file}.gz`]) { try { unlinkSync(f); } catch { /* gone */ } }
            if (/^SIG/.test(why)) return done(); // that was its final word
          }
        } catch (e) { log('[backup] late check failed:', e?.message || e); }
        if (Date.now() - t0 >= watchMs) return done();
        setTimeout(tick, every).unref?.();
      };
      setTimeout(tick, Math.min(every, 3000)).unref?.();
    });
  }
  state.now = snapshot;
  state.markDirty = markDirty;
  state.stop = () => { clearInterval(poll); clearInterval(every); clearTimeout(first); if (timer) clearTimeout(timer); };
  return state;
}

/** Rows the other database has and this one does not, table by table (shared columns). Tables with a key keep this
 *  side's version of a row; append-only ones (events, logs) gain the missing rows. A queued send the old container
 *  already sent is marked sent here, so it is never sent twice. */
export function mergeLate(db, file) {
  db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS late`);
  let added = 0;
  try {
    const q = (s0) => `"${String(s0).replace(/"/g, '""')}"`;
    const tables = db.prepare("SELECT name FROM late.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    for (const t of tables) {
      const mine = db.prepare(`PRAGMA main.table_info(${q(t)})`).all().map((c) => c.name); if (!mine.length) continue;
      const theirs = new Set(db.prepare(`PRAGMA late.table_info(${q(t)})`).all().map((c) => c.name));
      const cols = mine.filter((c) => theirs.has(c)); if (!cols.length) continue;
      const list = cols.map(q).join(', ');
      try { added += Number(db.prepare(`INSERT OR IGNORE INTO main.${q(t)} (${list}) SELECT ${list} FROM late.${q(t)} EXCEPT SELECT ${list} FROM main.${q(t)}`).run().changes) || 0; } catch { /* odd table: skip */ }
    }
    if (tables.includes('mail_queue')) {
      try { added += Number(db.prepare("UPDATE main.mail_queue AS m SET status = l.status, error = l.error, sent_at = l.sent_at FROM late.mail_queue AS l WHERE m.owner = l.owner AND m.campaign = l.campaign AND m.email = l.email AND m.status = 'queued' AND l.status <> 'queued'").run().changes) || 0; } catch { /* older SQLite: inserts still merged */ }
    }
  } finally { db.exec('DETACH DATABASE late'); }
  return added;
}
