// Durable data on an ephemeral host: asset bytes are separate bucket objects, the SQLite snapshot stays small and is
// uploaded shortly after writes, and a fresh container gets everything back. A tiny in-memory S3 stands in for R2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/src/db.mjs';
import { restoreBackup, startBackups } from '../server/src/backup.mjs';
import { createAssetStore, createBlobStore } from '../server/src/blobs.mjs';

/** In-memory S3: PUT/GET/DELETE /<bucket>/<key>; refuses unsigned calls; `fail` forces an HTTP status. */
async function mockS3() {
  const objects = new Map(); const log = [];
  const s = { objects, log, fail: 0 };
  const srv = createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const key = decodeURIComponent(req.url.split('?')[0]).replace(/^\/bucket\//, '');
      log.push(`${req.method} ${key}`);
      if (s.fail) { res.statusCode = s.fail; return res.end('nope'); }
      if (!/^AWS4-HMAC-SHA256 Credential=k\//.test(req.headers.authorization || '')) { res.statusCode = 403; return res.end('unsigned'); }
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(parts)); res.statusCode = 200; return res.end(); }
      if (req.method === 'DELETE') { objects.delete(key); res.statusCode = 204; return res.end(); }
      if (req.method === 'GET') { const b = objects.get(key); res.statusCode = b ? 200 : 404; return res.end(b || 'NoSuchKey'); }
      if (req.method === 'HEAD') { res.statusCode = objects.has(key) ? 200 : 404; return res.end(); }
      res.statusCode = 405; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  s.port = srv.address().port;
  s.cfg = { endpoint: `http://127.0.0.1:${s.port}`, bucket: 'bucket', key: 'k', secret: 's', region: 'auto', prefix: 'phloem/', every: 10, debounce: 1 };
  s.close = () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); });
  return s;
}
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timed out'); await sleep(50); } }
const quiet = () => {};

test('blob store: bytes go to the bucket, a fresh container reads them back lazily, delete removes them', async () => {
  const s3 = await mockS3();
  try {
    const a = createBlobStore({ cfg: s3.cfg, dir: join(tmp('blobs-a-'), 'blobs'), log: quiet });
    const k = await a.put(Buffer.from('png bytes'));
    assert.match(k, /^[0-9a-f]{40}$/);
    assert.deepEqual(s3.objects.get(`phloem/assets/${k}`), Buffer.from('png bytes'));
    // a new container: empty disk, same bucket
    const b = createBlobStore({ cfg: s3.cfg, dir: join(tmp('blobs-b-'), 'blobs'), log: quiet });
    assert.equal(String(await b.get(k)), 'png bytes');
    assert.equal(b.stats.downloads, 1);
    assert.equal(String(await b.get(k)), 'png bytes');
    assert.equal(b.stats.downloads, 1, 'second read comes from the disk cache');
    assert.equal(await b.get('../../etc/passwd'), null, 'keys are hex only');
    await b.remove(k);
    assert.equal(s3.objects.has(`phloem/assets/${k}`), false);
    // the bucket refusing a write fails the put (the route then answers 500 and writes no row)
    s3.fail = 500;
    await assert.rejects(a.put(Buffer.from('x')));
  } finally { await s3.close(); }
});

test('asset store: put/get/replace/remove, and old in-row bytes migrate out without losing a concurrent replace', async () => {
  const s3 = await mockS3();
  const dir = tmp('assets-');
  const db = openDb(join(dir, 'phloem.db'));
  try {
    db.raw.exec("INSERT OR IGNORE INTO users (id, name, email, password, created_at) VALUES ('u1', 'U', 'u@x.vn', 'h', '2026'), ('u2', 'V', 'v@x.vn', 'h', '2026')");
    // three legacy rows with bytes in-row (as before 2026-10-15)
    for (const id of ['old1', 'old2', 'old3']) db.assets.put('u1', { id, name: id, mime: 'image/png' }, Buffer.from(`bytes of ${id}`));
    const store = createAssetStore({ db, blobs: createBlobStore({ cfg: s3.cfg, dir: join(dir, 'blobs'), log: quiet }), log: quiet });
    assert.equal(store.migration.pending, 3);
    assert.equal(String((await store.get('u1', 'old1')).data), 'bytes of old1', 'legacy rows still read before the migration');

    // new writes never put bytes in the row
    const a = await store.put('u1', { id: 'n1', name: 'logo', mime: 'image/png', w: 2, h: 2 }, Buffer.from('new bytes'));
    assert.equal(a.bytes, 9);
    assert.equal(db.raw.prepare("SELECT length(data) AS n FROM assets WHERE id = 'n1'").get().n, 0);
    assert.equal(String((await store.get('u1', 'n1')).data), 'new bytes');
    assert.equal(await store.get('u2', 'n1'), null);
    assert.equal(await store.put('u2', { id: 'n1', name: 'steal', mime: 'image/png' }, Buffer.from('x')), null, "another owner's id is refused");
    const firstKey = db.assets.row('u1', 'n1').blob;
    await store.put('u1', { id: 'n1', name: 'logo v2', mime: 'image/png' }, Buffer.from('v2'));
    assert.equal(s3.objects.has(`phloem/assets/${firstKey}`), false, 'replacing deletes the old object');

    // a user replaces old2 while the migration has already read it: the replace must win
    const next = db.assets.inlineNext;
    db.assets.inlineNext = () => { db.assets.inlineNext = next; const r = db.raw.prepare("SELECT owner, id, data FROM assets WHERE id = 'old2'").get(); return { ...r, data: Buffer.from(r.data) }; };
    const migrating = store.migrate();
    await store.put('u1', { id: 'old2', name: 'old2', mime: 'image/png' }, Buffer.from('replaced'));
    await migrating;
    assert.equal(store.migration.pending, 0);
    assert.equal(db.assets.inlineCount(), 0);
    assert.equal(String((await store.get('u1', 'old1')).data), 'bytes of old1');
    assert.equal(String((await store.get('u1', 'old2')).data), 'replaced');
    assert.equal(String((await store.get('u1', 'old3')).data), 'bytes of old3');
    // bucket holds exactly the live keys (no orphans from the race)
    const live = db.raw.prepare('SELECT blob FROM assets').all().map((r) => `phloem/assets/${r.blob}`).sort();
    assert.deepEqual([...s3.objects.keys()].filter((k) => k.includes('/assets/')).sort(), live);

    await store.remove('u1', 'old1');
    assert.equal(await store.get('u1', 'old1'), null);
    assert.equal(s3.objects.size, 3);
  } finally { db.close(); await s3.close(); }
});

test('snapshots: uploaded shortly after a write, small, skipped when unchanged, never while paused', async () => {
  const s3 = await mockS3();
  const dir = tmp('snap-');
  const db = openDb(join(dir, 'phloem.db'));
  const st = startBackups(s3.cfg, db.raw, dir, quiet, { debounceSec: 0.1, pollMs: 50, firstMs: 1e9, signals: false });
  try {
    db.raw.exec("INSERT INTO users (id, name, email, password, created_at) VALUES ('u1', 'U', 'u@x.vn', 'h', '2026')");
    await until(() => s3.objects.has('phloem/phloem.db.gz'));
    await until(() => st.at && !st.uploading);
    assert.ok(st.bytes > 0 && st.bytes < 1024 * 1024, `snapshot ${st.bytes} B`);
    assert.ok(s3.objects.has(`phloem/snapshots/${new Date().toISOString().slice(0, 10)}.db.gz`), 'daily copy');
    assert.equal(st.dirty, false);
    // a client created right after is in the next snapshot, without waiting for the 10-minute interval
    const puts = () => s3.log.filter((l) => l === 'PUT phloem/phloem.db.gz').length;
    const before = puts();
    db.raw.exec("INSERT INTO clients (id, owner, name, json, created_at, updated_at) VALUES ('c1', 'u1', 'Quán A', '{}', '2026', '2026')");
    await until(() => puts() > before && !st.uploading);
    const restored = tmp('snap-restore-');
    assert.equal(await restoreBackup(s3.cfg, restored, quiet), 'restored');
    const db2 = openDb(join(restored, 'phloem.db'));
    assert.equal(db2.raw.prepare("SELECT name FROM clients WHERE id = 'c1'").get().name, 'Quán A');
    db2.close();
    // nothing changed → no upload
    const n = puts(); await st.now('manual'); assert.equal(puts(), n);
  } finally { st.stop(); db.close(); }

  const dir2 = tmp('snap-paused-');
  const db3 = openDb(join(dir2, 'phloem.db'));
  const paused = startBackups(s3.cfg, db3.raw, dir2, quiet, { paused: true, signals: false, firstMs: 1e9 });
  try {
    const n = s3.log.length; await paused.now('manual');
    assert.equal(s3.log.length, n, 'a failed restore never uploads the empty database');
    assert.match(paused.error, /paused/);
  } finally { paused.stop(); db3.close(); await s3.close(); }
});

test('restore: empty bucket, local file wins, bucket errors are reported as failed', async () => {
  const s3 = await mockS3();
  try {
    assert.equal(await restoreBackup(s3.cfg, tmp('r-'), quiet), 'empty');
    assert.equal(await restoreBackup(null, tmp('r-'), quiet), 'off');
    const d = tmp('r-'); openDb(join(d, 'phloem.db')).close();
    assert.equal(await restoreBackup(s3.cfg, d, quiet), 'local');
    s3.fail = 503;
    const f = tmp('r-');
    assert.equal(await restoreBackup(s3.cfg, f, quiet, { tries: 2, wait: 10 }), 'failed');
    assert.equal(existsSync(join(f, 'phloem.db')), false);
  } finally { await s3.close(); }
});

test('relay: a client and an image created seconds before the container dies are there after a restart', async () => {
  const s3 = await mockS3();
  const PORT = 20000 + Math.floor(Math.random() * 2000);
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, PORT: String(PORT), AUTH_SECRET: 'test-secret-0123456789', ANTHROPIC_API_KEY: '', RELAY_TOKEN: '', BACKUP_S3_ENDPOINT: s3.cfg.endpoint, BACKUP_S3_BUCKET: 'bucket', BACKUP_S3_KEY: 'k', BACKUP_S3_SECRET: 's', BACKUP_DEBOUNCE_SEC: '1' };
  const boot = async (dir) => {
    const p = spawn(process.execPath, ['server/src/index.mjs'], { env: { ...env, DATA_DIR: dir + '/' }, stdio: 'ignore' });
    await until(async () => { try { return (await fetch(BASE + '/')).ok; } catch { return false; } });
    return p;
  };
  const dirs = [tmp('relay-a-'), tmp('relay-b-')];
  let relay;
  try {
    relay = await boot(dirs[0]);
    const call = async (path, { token, method = 'GET', body, raw, headers = {} } = {}) => {
      const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
      return r;
    };
    const token = (await (await call('/auth/register', { method: 'POST', body: { name: 'Agency A', email: 'a@agency.vn', password: 'mat-khau-dai-123' } })).json()).token;
    assert.equal((await call('/db/assets/img1', { token, method: 'PUT', raw: Buffer.from('fake png'), headers: { 'Content-Type': 'image/png', 'X-Asset-Name': 'logo.png' } })).status, 200);
    assert.equal((await call('/db/clients/c1', { token, method: 'PUT', body: { name: 'Quán cà phê A' } })).status, 200);
    // the debounced snapshot lands within a few seconds; health reports its size
    const health = await until(async () => { const h = (await (await fetch(BASE + '/')).json()).backup; return h?.at && !h.pending && s3.log.some((l) => l === 'PUT phloem/phloem.db.gz') ? h : null; });
    assert.ok(health.bytes > 0 && health.bytes < 2 * 1024 * 1024, `snapshot ${health.bytes} B`);
    assert.equal(health.assetsInDb, 0);
    assert.equal(typeof health.ms, 'number');
    // the container dies without a graceful shutdown
    relay.kill('SIGKILL'); await new Promise((r) => relay.once('exit', r));
    relay = await boot(dirs[1]);
    assert.equal((await (await fetch(BASE + '/')).json()).backup.restore, 'restored');
    const clients = (await (await call('/db/clients', { token })).json()).clients;
    assert.deepEqual(clients.map((c) => c.name), ['Quán cà phê A']);
    const img = await call('/db/assets/img1', { token });
    assert.equal(img.status, 200);
    assert.equal(Buffer.from(await img.arrayBuffer()).toString(), 'fake png');
  } finally {
    relay?.kill('SIGKILL'); await s3.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test('relay: boot on a big legacy database (~120 MB of in-row images) stays well under 250 MB RSS and resumes after a crash', async () => {
  const s3 = await mockS3();
  const N = 120, SIZE = 1024 * 1024;
  const legacy = tmp('legacy-');
  const db = openDb(join(legacy, 'phloem.db'));
  db.raw.exec("INSERT INTO users (id, name, email, password, created_at) VALUES ('u1', 'U', 'u@x.vn', 'h', '2026')");
  for (let i = 0; i < N; i++) db.assets.put('u1', { id: `img${i}`, name: `img${i}.png`, mime: 'image/png' }, randomBytes(SIZE));
  db.close();
  s3.objects.set('phloem/phloem.db', readFileSync(join(legacy, 'phloem.db')));
  assert.ok(s3.objects.get('phloem/phloem.db').length > N * SIZE);
  const PORT = 22000 + Math.floor(Math.random() * 2000);
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, PORT: String(PORT), AUTH_SECRET: 'test-secret-0123456789', ANTHROPIC_API_KEY: '', RELAY_TOKEN: '', BACKUP_S3_ENDPOINT: s3.cfg.endpoint, BACKUP_S3_BUCKET: 'bucket', BACKUP_S3_KEY: 'k', BACKUP_S3_SECRET: 's', BACKUP_DEBOUNCE_SEC: '1' };
  const health = async () => { try { return (await (await fetch(BASE + '/')).json()).backup; } catch { return null; } };
  let peak = 0, relay = null;
  const rss = () => { if (!relay?.pid) return; try { const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(relay.pid)]).toString().trim()); if (kb > peak) peak = kb; } catch { /* exited */ } };
  const sampler = setInterval(rss, 50);
  const boot = async (dir) => { relay = spawn(process.execPath, ['server/src/index.mjs'], { env: { ...env, DATA_DIR: dir + '/' }, stdio: 'ignore' }); await until(health, 20000); };
  const dirs = [tmp('big-a-'), tmp('big-b-')];
  try {
    await boot(dirs[0]);
    // crash half-way through the migration
    await until(async () => { const h = await health(); return h && h.assetsInDb < N / 2; }, 60000);
    relay.kill('SIGKILL'); await new Promise((r) => relay.once('exit', r));
    await boot(dirs[1]);
    const done = await until(async () => { const h = await health(); return h && h.assetsInDb === 0 && h.at && !h.pending && h.bytes < 2 * 1024 * 1024 ? h : null; }, 90000);
    rss();
    assert.ok(peak < 250 * 1024, `peak RSS ${Math.round(peak / 1024)} MB`);
    const objs = [...s3.objects.keys()].filter((k) => k.startsWith('phloem/assets/'));
    assert.equal(objs.length, N, 'every image exactly once in the bucket (the resumed run reused what the crashed one uploaded)');
    assert.ok(s3.objects.get('phloem/phloem.db.gz').length < 2 * 1024 * 1024, `snapshot ${s3.objects.get('phloem/phloem.db.gz').length} B`);
    console.log(`# big legacy DB: peak RSS ${Math.round(peak / 1024)} MB, final snapshot ${Math.round(done.bytes / 1024)} KB`);
  } finally {
    clearInterval(sampler); relay?.kill('SIGKILL'); await s3.close();
    for (const d of [...dirs, legacy]) rmSync(d, { recursive: true, force: true });
  }
});
