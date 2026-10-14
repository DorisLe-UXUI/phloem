// Durable data on ephemeral hosts (Render free, Fly without volumes…): the SQLite file and the auth secret are
// restored from an S3-compatible bucket at boot and a consistent snapshot is uploaded every few minutes and on
// shutdown. Zero dependencies: AWS Signature V4 by hand. Works with Cloudflare R2 (free 10 GB), Backblaze B2, AWS S3, MinIO.
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

export function backupConfig(env = process.env) {
  const endpoint = String(env.BACKUP_S3_ENDPOINT || '').replace(/\/$/, '');
  const bucket = env.BACKUP_S3_BUCKET, key = env.BACKUP_S3_KEY, secret = env.BACKUP_S3_SECRET;
  if (!endpoint || !bucket || !key || !secret) return null;
  return { endpoint, bucket, key, secret, region: env.BACKUP_S3_REGION || 'auto', prefix: String(env.BACKUP_S3_PREFIX || 'phloem/').replace(/^\/+/, ''), every: Math.max(1, Number(env.BACKUP_EVERY_MIN || 10)) };
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const encPath = (p) => p.split('/').map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

/** SigV4 headers for one request (path-style: /bucket/key). `when` is injectable for tests. */
export function sign(cfg, method, objectKey, payload, extraHeaders = {}, when = new Date()) {
  const url = new URL(`${cfg.endpoint}/${encPath([cfg.bucket, objectKey].filter(Boolean).join('/'))}`); // path-style; an empty bucket means the endpoint already names it
  const amzDate = when.toISOString().replace(/[:-]|\.\d{3}/g, ''); const date = amzDate.slice(0, 8);
  const payloadHash = sha(payload);
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

function call(cfg, method, objectKey, payload = Buffer.alloc(0), extra = {}) {
  const { url, headers } = sign(cfg, method, objectKey, payload, extra);
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = mod({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method, headers: { ...headers, 'content-length': payload.length }, timeout: 60_000 }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

/** Fresh container (no database file yet) → pull the last snapshot and the auth secret from the bucket. */
export async function restoreBackup(cfg, dataDir, log = console.log) {
  if (!cfg) return false;
  const dbFile = join(dataDir, 'phloem.db');
  if (existsSync(dbFile)) return false; // a persistent disk or a warm container: local wins
  try {
    const db = await call(cfg, 'GET', cfg.prefix + 'phloem.db');
    if (db.status === 404) { log('[backup] no snapshot in the bucket yet'); return false; }
    if (db.status !== 200) throw new Error(`GET phloem.db → HTTP ${db.status} ${db.body.toString('utf8').slice(0, 160)}`);
    writeFileSync(dbFile, db.body);
    const sec = await call(cfg, 'GET', cfg.prefix + 'auth-secret');
    if (sec.status === 200 && !process.env.AUTH_SECRET) writeFileSync(join(dataDir, 'auth-secret'), sec.body, { mode: 0o600 });
    log(`[backup] restored phloem.db (${(db.body.length / 1024).toFixed(0)} KB) from ${cfg.bucket}`);
    return true;
  } catch (e) { log('[backup] restore failed:', e?.message || e); return false; }
}

/** Snapshot (VACUUM INTO = consistent even in WAL mode) and upload when it changed; every `every` minutes and on shutdown. */
export function startBackups(cfg, db, dataDir, log = console.log) {
  const state = { enabled: !!cfg, at: null, error: null, bytes: 0, uploading: null };
  if (!cfg) return state;
  let lastHash = '';
  const snapshot = async (reason) => {
    if (state.uploading) return state.uploading;
    state.uploading = (async () => {
      const tmp = join(dataDir, `snapshot-${process.pid}.db`);
      try {
        try { unlinkSync(tmp); } catch { /* none */ }
        db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
        const buf = readFileSync(tmp); unlinkSync(tmp);
        const h = sha(buf);
        if (h === lastHash) return;
        const r = await call(cfg, 'PUT', cfg.prefix + 'phloem.db', buf, { 'content-type': 'application/octet-stream' });
        if (r.status < 200 || r.status >= 300) throw new Error(`PUT phloem.db → HTTP ${r.status} ${r.body.toString('utf8').slice(0, 160)}`);
        const secFile = join(dataDir, 'auth-secret');
        if (existsSync(secFile) && !process.env.AUTH_SECRET) { const s = await call(cfg, 'PUT', cfg.prefix + 'auth-secret', readFileSync(secFile), { 'content-type': 'text/plain' }); if (s.status < 200 || s.status >= 300) throw new Error(`PUT auth-secret → HTTP ${s.status}`); }
        lastHash = h; state.at = new Date().toISOString(); state.bytes = buf.length; state.error = null;
        log(`[backup] uploaded ${(buf.length / 1024).toFixed(0)} KB (${reason})`);
      } catch (e) { state.error = String(e?.message || e); log('[backup] upload failed:', state.error); }
      finally { state.uploading = null; }
    })();
    return state.uploading;
  };
  setTimeout(() => { void snapshot('first run'); }, 20_000).unref();
  setInterval(() => { void snapshot('interval'); }, cfg.every * 60_000).unref();
  const bye = (sig) => { snapshot(sig).finally(() => process.exit(0)); setTimeout(() => process.exit(0), 25_000).unref(); };
  process.once('SIGTERM', () => bye('SIGTERM'));
  process.once('SIGINT', () => bye('SIGINT'));
  state.now = snapshot;
  return state;
}
