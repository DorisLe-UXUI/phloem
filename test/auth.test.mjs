import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, hashPassword, signToken, validate, verifyPassword, verifyToken } from '../server/src/auth.mjs';

test('password hashes are salted and verify only the right password', () => {
  const a = hashPassword('correct horse'), b = hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.ok(verifyPassword('correct horse', a));
  assert.ok(!verifyPassword('wrong horse', a));
  assert.ok(!verifyPassword('correct horse', 'garbage'));
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

test('createAuth registers, refuses duplicates, logs in, resolves me, persists to disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phloem-auth-'));
  const auth = createAuth({ dataDir: dir });
  const s = auth.register({ name: 'Khanh', email: 'K@Example.com ', password: 'passw0rd!', brand: 'Terra' });
  assert.equal(s.user.email, 'k@example.com');
  assert.equal(s.user.brand, 'Terra');
  assert.ok(!('password' in s.user));
  assert.throws(() => auth.register({ name: 'Dup', email: 'k@example.com', password: 'passw0rd!' }), (e) => e.status === 409 && e.code === 'exists');
  assert.throws(() => auth.login({ email: 'k@example.com', password: 'wrongpass' }), (e) => e.status === 401 && e.code === 'badpass');
  assert.throws(() => auth.login({ email: 'nobody@example.com', password: 'whatever1' }), (e) => e.code === 'notfound');
  const l = auth.login({ email: 'k@example.com', password: 'passw0rd!' });
  assert.equal(auth.me(l.token)?.id, s.user.id);
  assert.equal(auth.me('bad.token'), null);
  const onDisk = JSON.parse(readFileSync(join(dir, 'users.json'), 'utf8'));
  assert.equal(onDisk.length, 1);
  assert.match(onDisk[0].password, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
  // a second instance with the same data dir reuses the generated secret, so old tokens stay valid
  const again = createAuth({ dataDir: dir });
  assert.equal(again.me(l.token)?.email, 'k@example.com');
  assert.equal(again.count(), 1);
});
