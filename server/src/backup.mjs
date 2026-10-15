// Durable data on ephemeral hosts (Render free, Fly without volumes…): the SQLite file and the auth secret are
// restored from an S3-compatible bucket at boot and a consistent snapshot is uploaded ~30 s after writes, every few
// minutes, and on shutdown. Asset bytes are separate objects in the same bucket (blobs.mjs). Zero dependencies: AWS Signature V4 by hand. Works with Cloudflare R2 (free 10 GB), Backblaze B2, AWS S3, MinIO.
import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

export function backupConfig(env = process.env) {
  const endpoint = String(env.BACKUP_S3_ENDPOINT || '').replace(/\/$/, '');
  const bucket = env.BACKUP_S3_BUCKET, key = env.BACKUP_S3_KEY, secret = env.BACKUP_S3_SECRET;
  if (!endpoint || !bucket || !key || !secret) return null;
  return { endpoint, bucket, key, secret, region: env.BACKUP_S3_REGION || 'auto', prefix: String(env.BACKUP_S3_PREFIX || 'phloem/').replace(/^\/+/, ''), every: Math.max(1, Number(env.BACKUP_EVERY_MIN || 10)), debounce: Math.max(1, Number(env.BACKUP_DEBOUNCE_SEC || 30)) };
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
        pipeline(res, createWriteStream(part)).then(() => { renameSync(part, opts.toFile); resolve({ status: 200, body: Buffer.alloc(0), size: statSync(opts.toFile).size }); }, (e) => { try { unlinkSync(part); } catch { /* none */ } reject(e); });
        return;
      }
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) })); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (streamed) pipeline(createReadStream(payload.file), req).catch(reject);
    else req.end(payload);
  });
}

/** Fresh container (no database file yet) → pull the last snapshot and the auth secret from the bucket.
 *  Returns 'restored' | 'empty' (bucket has no snapshot) | 'local' (a database file is already here) | 'failed' | 'off'. */
export async function restoreBackup(cfg, dataDir, log = console.log, { tries = 3, wait = 2000 } = {}) {
  if (!cfg) return 'off';
  const dbFile = join(dataDir, 'phloem.db');
  if (existsSync(dbFile)) return 'local'; // a persistent disk or a warm container: local wins
  for (let i = 1; i <= tries; i++) {
    try {
      const t0 = Date.now();
      const db = await call(cfg, 'GET', cfg.prefix + 'phloem.db', undefined, {}, { toFile: dbFile }); // streamed to disk: the snapshot may be bigger than the RAM
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
  const debounce = Math.max(0, Number(opts.debounceSec ?? cfg?.debounce ?? 30)) * 1000;
  const state = { enabled: !!cfg, at: null, error: null, bytes: 0, ms: 0, dirty: false, uploading: null, paused: !!opts.paused, daily: '' };
  if (!cfg) return state;
  if (state.paused) state.error = 'restore failed at boot; uploads paused so the bucket copy is not overwritten (redeploy to retry)';
  let lastHash = '';
  const changes = () => { try { return Number(db.prepare('SELECT total_changes() AS n').get().n); } catch { return 0; } };
  let seen = changes(), timer = null;
  const snapshot = async (reason) => {
    if (state.paused) return;
    if (state.uploading) { await state.uploading; if (!state.dirty) return; if (state.uploading) return state.uploading; } // a write landed during that upload: go again
    state.uploading = (async () => {
      const t0 = Date.now();
      const tmp = join(dataDir, `snapshot-${process.pid}.db`);
      try {
        state.dirty = false; seen = changes();
        try { unlinkSync(tmp); } catch { /* none */ }
        db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
        const snap = { file: tmp, size: statSync(tmp).size, hash: await hashFile(tmp) }; // streamed from disk, never read whole
        const h = snap.hash;
        if (h === lastHash) return;
        const r = await call(cfg, 'PUT', cfg.prefix + 'phloem.db', snap, { 'content-type': 'application/octet-stream' });
        if (r.status < 200 || r.status >= 300) throw new Error(`PUT phloem.db → HTTP ${r.status} ${r.body.toString('utf8').slice(0, 160)}`);
        const secFile = join(dataDir, 'auth-secret');
        if (existsSync(secFile) && !process.env.AUTH_SECRET) { const s = await call(cfg, 'PUT', cfg.prefix + 'auth-secret', readFileSync(secFile), { 'content-type': 'text/plain' }); if (s.status < 200 || s.status >= 300) throw new Error(`PUT auth-secret → HTTP ${s.status}`); }
        // one dated copy a day, so a bad snapshot can't wipe out the only good one
        const day = new Date().toISOString().slice(0, 10);
        if (state.daily !== day) { const d = await call(cfg, 'PUT', `${cfg.prefix}snapshots/${day}.db`, snap, { 'content-type': 'application/octet-stream' }); if (d.status >= 200 && d.status < 300) state.daily = day; }
        lastHash = h; state.at = new Date().toISOString(); state.bytes = snap.size; state.ms = Date.now() - t0; state.error = null;
        log(`[backup] uploaded ${(snap.size / 1024).toFixed(0)} KB in ${state.ms} ms (${reason})`);
      } catch (e) { state.dirty = true; state.error = String(e?.message || e); log('[backup] upload failed:', state.error); }
      finally { try { unlinkSync(tmp); } catch { /* gone */ } state.uploading = null; }
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
  state.now = snapshot;
  state.markDirty = markDirty;
  state.stop = () => { clearInterval(poll); clearInterval(every); clearTimeout(first); if (timer) clearTimeout(timer); };
  return state;
}
