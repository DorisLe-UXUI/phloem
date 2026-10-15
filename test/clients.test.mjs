// Phloem MKT: every client is its own workspace. These tests prove one account can never read, write, file a project
// under, or share another account's client, and that removing a client removes everything filed under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/src/db.mjs';

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'phloem-cli-')), 'app.db'));
  db.users.insert({ id: 'uA', name: 'A', email: 'a@x.vn', password: 'x' });
  db.users.insert({ id: 'uB', name: 'B', email: 'b@x.vn', password: 'x' });
  db.clients.put('uA', { id: 'cA', name: 'Khách của A', industry: 'F&B' });
  db.clients.put('uB', { id: 'cB', name: 'Khách của B', industry: 'Game' });
  db.items.put('uA', 'cA', 'brand', 'main', { tone: 'ấm áp' });
  db.items.put('uB', 'cB', 'brand', 'main', { tone: 'sôi nổi' });
  db.items.put('uB', 'cB', 'plan', 'p1', { months: 3 });
  return db;
}

test('clients: each account lists only its own clients', () => {
  const db = setup();
  assert.deepEqual(db.clients.list('uA').map((c) => c.id), ['cA']);
  assert.deepEqual(db.clients.list('uB').map((c) => c.id), ['cB']);
  assert.equal(db.clients.get('uA', 'cB'), null);
});

test('clients: an account cannot overwrite or delete another account\'s client', () => {
  const db = setup();
  const r = db.clients.put('uA', { id: 'cB', name: 'chiếm quyền', updatedAt: '2999-01-01T00:00:00.000Z' });
  assert.ok(r.forbidden || r.stale);
  assert.equal(db.clients.get('uB', 'cB').name, 'Khách của B');
  assert.equal(db.clients.remove('uA', 'cB'), false);
  assert.ok(db.clients.get('uB', 'cB'));
});

test('items: reading, writing and deleting are scoped to the owner of the client', () => {
  const db = setup();
  assert.deepEqual(db.items.list('uA', 'cB'), []);
  assert.equal(db.items.get('uA', 'cB', 'brand', 'main'), null);
  const w = db.items.put('uA', 'cB', 'brand', 'main', { tone: 'bị sửa' });
  assert.ok(w.forbidden);
  assert.equal(db.items.get('uB', 'cB', 'brand', 'main').data.tone, 'sôi nổi');
  assert.equal(db.items.remove('uA', 'cB', 'plan', 'p1'), false);
  assert.ok(db.items.get('uB', 'cB', 'plan', 'p1'));
  // and the owner sees exactly its own data
  assert.deepEqual(db.items.list('uB', 'cB').map((i) => i.kind).sort(), ['brand', 'plan']);
});

test('projects: an email project can only be filed under a client of the same owner', () => {
  const db = setup();
  const bad = db.projects.put('uA', { id: 'pX', name: 'Email', clientId: 'cB', updatedAt: '2026-10-15T00:00:00.000Z' });
  assert.ok(bad.forbidden);
  const ok = db.projects.put('uA', { id: 'pA', name: 'Email A', clientId: 'cA', updatedAt: '2026-10-15T00:00:00.000Z' });
  assert.ok(!ok.forbidden && !ok.stale);
  assert.equal(db.projects.list('uA').find((p) => p.id === 'pA').clientId, 'cA');
  assert.equal(db.projects.list('uB').length, 0);
});

test('removing a client removes its items, audit, shares and email projects, nothing else', () => {
  const db = setup();
  db.projects.put('uA', { id: 'pA', name: 'Email A', clientId: 'cA', updatedAt: '2026-10-15T00:00:00.000Z' });
  db.projects.put('uA', { id: 'pFree', name: 'Email riêng', updatedAt: '2026-10-15T00:00:00.000Z' });
  db.audit.add('uA', 'cA', 'A', 'brand.save');
  const token = db.shares.create('uA', 'cA', 'plan', 'p9');
  assert.ok(token);
  assert.equal(db.clients.remove('uA', 'cA'), true);
  assert.deepEqual(db.items.list('uA', 'cA'), []);
  assert.deepEqual(db.audit.list('uA', 'cA'), []);
  assert.equal(db.shares.resolve(token), null);
  assert.deepEqual(db.projects.list('uA').map((p) => p.id), ['pFree']);
  assert.ok(db.clients.get('uB', 'cB'), 'other accounts untouched');
});

test('review links: only the owner can create one, and it resolves to exactly that client and item', () => {
  const db = setup();
  assert.equal(db.shares.create('uA', 'cB', 'plan', 'p1'), null, 'cannot share someone else\'s client');
  const t = db.shares.create('uB', 'cB', 'plan', 'p1');
  const sh = db.shares.resolve(t);
  assert.equal(sh.clientId, 'cB'); assert.equal(sh.kind, 'plan'); assert.equal(sh.itemId, 'p1'); assert.equal(sh.owner, 'uB');
  assert.equal(db.shares.resolve('nope'), null);
  db.shares.write(sh, 'review', 'p1', { rows: { r1: { status: 'approved' } } }, 'Chị Lan', 'plan.review', '1 hàng duyệt');
  assert.equal(db.items.get('uB', 'cB', 'review', 'p1').data.rows.r1.status, 'approved');
  assert.equal(db.audit.list('uB', 'cB')[0].actor, 'Khách: Chị Lan');
  assert.deepEqual(db.items.list('uA', 'cA').map((i) => i.kind), ['brand'], 'the review did not leak into another client');
});
