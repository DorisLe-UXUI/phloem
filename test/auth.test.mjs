import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, hashPassword, signToken, validate, verifyPassword, verifyToken } from '../server/src/auth.mjs';
import { decrypt, encrypt, openDb } from '../server/src/db.mjs';

test('password hashes are salted and verify only the right password', async () => {
  const a = await hashPassword('correct horse'), b = await hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('correct horse', a));
  assert.ok(!(await verifyPassword('wrong horse', a)));
  assert.ok(!(await verifyPassword('correct horse', 'garbage')));
});

test('tokens round-trip, expire, and reject tampering', () => {
  const t = signToken('u_1', 'secret', 1000, 60_000);
  assert.equal(verifyToken(t, 'secret', 2000), 'u_1');
  assert.equal(verifyToken(t, 'secret', 70_000), null);
  assert.equal(verifyToken(t, 'other', 2000), null);
  assert.equal(verifyToken(t.slice(0, -2) + 'xx', 'secret', 2000), null);
  assert.equal(verifyToken('', 'secret'), null);
});

test('validate returns the first failing field', () => {
  assert.equal(validate({ name: 'A', email: 'a@b.co', password: '12345678' }, { register: true }), 'name');
  assert.equal(validate({ name: 'An', email: 'nope', password: '12345678' }, { register: true }), 'email');
  assert.equal(validate({ email: 'a@b.co', password: 'short' }), 'password');
  assert.equal(validate({ email: 'a@b.co', password: '12345678' }), null);
});

test('createAuth: register, duplicates, login, me, revocable sessions, persisted in SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phloem-auth-'));
  const auth = createAuth({ dataDir: dir });
  const s = await auth.register({ name: 'Khanh', email: 'K@Example.com ', password: 'passw0rd!', brand: 'Terra' }, 'test-agent');
  assert.equal(s.user.email, 'k@example.com');
  assert.equal(s.user.brand, 'Terra');
  assert.ok(!('password' in s.user));
  await assert.rejects(auth.register({ name: 'Dup', email: 'k@example.com', password: 'passw0rd!' }), (e) => e.status === 409 && e.code === 'exists');
  await assert.rejects(auth.login({ email: 'k@example.com', password: 'wrongpass' }), (e) => e.status === 401 && e.code === 'badpass');
  await assert.rejects(auth.login({ email: 'nobody@example.com', password: 'whatever1' }), (e) => e.code === 'notfound');
  const l = await auth.login({ email: 'k@example.com', password: 'passw0rd!' });
  assert.equal(auth.me(l.token)?.id, s.user.id);
  assert.equal(auth.me('bad.token'), null);
  assert.match(auth.db.users.byEmail('k@example.com').password, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(auth.db.sessions.list(s.user.id).length, 2);
  auth.logout(l.token);
  assert.equal(auth.me(l.token), null, 'a logged-out token is refused even though its signature is valid');
  assert.equal(auth.me(s.token)?.id, s.user.id);
  auth.logoutAll(s.user.id);
  assert.equal(auth.me(s.token), null);
  // a second instance on the same data dir reuses the generated secret and the same database
  const again = createAuth({ dataDir: dir });
  assert.equal(again.count(), 1);
  const l2 = await again.login({ email: 'k@example.com', password: 'passw0rd!' });
  assert.equal(auth.me(l2.token)?.email, 'k@example.com', 'sessions are shared through the database');
});

test('createAuth migrates a legacy users.json once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phloem-auth-legacy-'));
  writeFileSync(join(dir, 'users.json'), JSON.stringify([{ id: 'u_old', name: 'Old', email: 'old@example.com', brand: '', password: await hashPassword('oldpass123'), createdAt: '2026-01-01T00:00:00.000Z' }]));
  const auth = createAuth({ dataDir: dir });
  assert.equal(auth.count(), 1);
  assert.equal((await auth.login({ email: 'old@example.com', password: 'oldpass123' })).user.id, 'u_old');
  assert.ok(!existsSync(join(dir, 'users.json')) && existsSync(join(dir, 'users.json.migrated')));
});

test('db: projects, assets, encrypted profiles are scoped per owner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phloem-db-'));
  const db = openDb(join(dir, 'phloem.db'));
  db.users.insert({ id: 'u1', name: 'A', email: 'a@x.co', password: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
  db.users.insert({ id: 'u2', name: 'B', email: 'b@x.co', password: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
  const put = db.projects.put('u1', { id: 'p1', name: 'Promo', desktop: { nodes: [] }, mobile: null, brand: {}, fields: {}, drafts: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', thumb: 'data:x' });
  assert.equal(put.updatedAt, '2026-01-02T00:00:00.000Z');
  assert.equal(db.projects.list('u1').length, 1);
  assert.equal(db.projects.list('u2').length, 0);
  assert.equal(db.projects.get('u2', 'p1'), null, 'another owner cannot read it');
  assert.equal(db.projects.get('u1', 'p1').thumb, 'data:x');
  db.projects.put('u2', { id: 'p1', name: 'Hijack', desktop: {}, updatedAt: '2026-01-03T00:00:00.000Z' });
  assert.equal(db.projects.get('u1', 'p1').name, 'Promo', 'an upsert from another owner does not overwrite');
  const a = db.assets.put('u1', { id: 'a1', name: 'logo.png', mime: 'image/png', w: 10, h: 10 }, Buffer.from([1, 2, 3]));
  assert.equal(a.bytes, 3);
  assert.deepEqual([...db.assets.get('u1', 'a1').data], [1, 2, 3]);
  assert.equal(db.assets.get('u2', 'a1'), null);
  assert.equal(db.assets.usage('u1').bytes, 3);
  db.profiles.put('u1', 'secret', [{ id: 'pr1', provider: 'mailchimp', auth: { type: 'apikey', apiKey: 'abc-us1' } }]);
  assert.equal(db.profiles.get('u1', 'secret').profiles[0].auth.apiKey, 'abc-us1');
  assert.equal(db.profiles.get('u1', 'other-secret').profiles.length, 0, 'wrong key decrypts to nothing');
  assert.notEqual(encrypt('s', 'hello').toString('hex'), encrypt('s', 'hello').toString('hex'));
  assert.equal(decrypt('s', encrypt('s', 'hello')), 'hello');
  db.projects.remove('u1', 'p1'); db.assets.remove('u1', 'a1');
  assert.equal(db.stats('u1').projects.n, 0);
  db.close();
});

import { sign } from '../server/src/backup.mjs';
test('backup: AWS SigV4 matches the documented S3 GET example', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — GET object example
  const cfg = { endpoint: 'https://examplebucket.s3.amazonaws.com', bucket: '', key: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
  const r = sign({ ...cfg }, 'GET', 'test.txt', Buffer.alloc(0), { range: 'bytes=0-9' }, new Date('2013-05-24T00:00:00Z'));
  assert.equal(r.url.pathname, '/test.txt');
  assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});
