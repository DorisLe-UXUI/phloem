// Phloem MKT over HTTP: the relay routes, not just the db layer. Two agencies, one teammate, one review link.
// Proves: A never reads or writes B's client by id, roles gate writes, deleting needs the typed name, a review link
// opens exactly one item and its writes land only in that client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let relay;

async function call(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
}
const reg = async (name, email) => (await call('/auth/register', { method: 'POST', body: { name, email, password: 'mat-khau-dai-123' } })).body.token;

test.before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phloem-api-'));
  relay = spawn(process.execPath, ['server/src/index.mjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir + '/', AUTH_SECRET: 'test-secret-0123456789', ANTHROPIC_API_KEY: '', BACKUP_S3_BUCKET: '', RELAY_TOKEN: '' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/')).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('relay did not start');
});
test.after(() => relay?.kill());

test('clients API: isolation, roles, review links, delete', async () => {
  const A = await reg('Agency A', 'a@agency.vn');
  const B = await reg('Agency B', 'b@agency.vn');
  const T = await reg('Designer T', 't@agency.vn');
  assert.ok(A && B && T);

  // each agency creates one client and a plan in it
  assert.equal((await call('/db/clients/cA', { token: A, method: 'PUT', body: { name: 'Quán cà phê A', industry: 'F&B' } })).status, 200);
  assert.equal((await call('/db/clients/cB', { token: B, method: 'PUT', body: { name: 'Shop B' } })).status, 200);
  assert.equal((await call('/db/client/cB/items/plan/p1', { token: B, method: 'PUT', body: { data: { title: 'Kế hoạch Q1', rows: [{ id: 'r1' }, { id: 'r2' }] } } })).status, 200);

  // A cannot see, read, write, take over, export, share or delete B's client
  assert.deepEqual((await call('/db/clients', { token: A })).body.clients.map((c) => c.id), ['cA']);
  assert.equal((await call('/db/client/cB/items', { token: A })).status, 404);
  assert.equal((await call('/db/client/cB/items/plan/p1', { token: A })).status, 404);
  assert.equal((await call('/db/client/cB/items/plan/p1', { token: A, method: 'PUT', body: { data: { title: 'sửa trộm' } } })).status, 404);
  assert.equal((await call('/db/clients/cB', { token: A, method: 'PUT', body: { name: 'chiếm', updatedAt: '2999-01-01T00:00:00.000Z' } })).status, 403);
  assert.equal((await call('/db/client/cB/export', { token: A })).status, 404);
  assert.equal((await call('/db/client/cB/share', { token: A, method: 'POST', body: { kind: 'plan', itemId: 'p1' } })).status, 404);
  assert.equal((await call('/db/clients/cB?confirm=Shop%20B', { token: A, method: 'DELETE' })).status, 403);
  assert.equal((await call('/db/client/cB/items/plan/p1', { token: B })).body.item.data.title, 'Kế hoạch Q1');
  assert.equal((await call('/db/client/cA/items', { token: B })).status, 404);
  assert.equal((await call('/db/clients', {})).status, 401);

  // A adds T as designer: T sees cA (not cB), can write items, cannot manage, delete, or add members
  assert.equal((await call('/db/client/cA/members/t%40agency.vn', { token: A, method: 'PUT', body: { role: 'designer' } })).status, 200);
  const tList = (await call('/db/clients', { token: T })).body.clients;
  assert.deepEqual(tList.map((c) => [c.id, c.role]), [['cA', 'designer']]);
  assert.equal((await call('/db/client/cA/items/brand/main', { token: T, method: 'PUT', body: { data: { tone: 'ấm' } } })).status, 200);
  assert.equal((await call('/db/clients/cA', { token: T, method: 'PUT', body: { name: 'đổi tên' } })).status, 403);
  assert.equal((await call('/db/client/cA/members/b%40agency.vn', { token: T, method: 'PUT', body: { role: 'manager' } })).status, 403);
  assert.equal((await call('/db/client/cA/export', { token: T })).status, 403);
  // a viewer only reads
  assert.equal((await call('/db/client/cA/members/t%40agency.vn', { token: A, method: 'PUT', body: { role: 'client_viewer' } })).status, 200);
  assert.equal((await call('/db/client/cA/items/brand/main', { token: T, method: 'PUT', body: { data: { tone: 'x' } } })).status, 403);
  assert.equal((await call('/db/client/cA/items/brand/main', { token: T })).body.item.data.tone, 'ấm');
  assert.equal((await call('/db/client/cA/members/x%40agency.vn', { token: A, method: 'PUT', body: { role: 'owner' } })).status, 404);
  assert.equal((await call('/db/client/cA/members/t%40agency.vn', { token: A, method: 'PUT', body: { role: 'owner' } })).status, 400, 'owner is not a grantable role');

  // review link: B shares its plan; the link reads that plan only and its writes land in cB only
  const share = await call('/db/client/cB/share', { token: B, method: 'POST', body: { kind: 'plan', itemId: 'p1', days: 7 } });
  assert.equal(share.status, 200);
  const pub = await call(`/share/${share.body.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.client.name, 'Shop B');
  assert.equal(pub.body.data.title, 'Kế hoạch Q1');
  assert.equal((await call(`/share/${share.body.token}/review`, { method: 'POST', body: { rows: { r1: 'approved' } } })).status, 400, 'a name is required');
  const rv = await call(`/share/${share.body.token}/review`, { method: 'POST', body: { name: 'Chị Lan', rows: { r1: 'approved', r2: 'changes', rX: 'approved' }, comments: [{ row: 'r2', text: 'Đổi giờ đăng' }] } });
  assert.equal(rv.status, 200);
  assert.deepEqual(Object.keys(rv.body.review.rows).sort(), ['r1', 'r2'], 'unknown rows are ignored');
  const bItems = (await call('/db/client/cB/items?kind=review', { token: B })).body.items;
  assert.equal(bItems[0].data.rows.r1.status, 'approved');
  assert.equal((await call('/db/client/cB/audit', { token: B })).body.audit[0].actor, 'Khách: Chị Lan');
  assert.deepEqual((await call('/db/client/cA/items?kind=review', { token: A })).body.items, []);
  assert.equal((await call('/share/not-a-token')).status, 404);
  // revoke closes the link
  const links = (await call('/db/client/cB/share', { token: B })).body.shares;
  assert.equal(links.length, 1);
  assert.equal((await call(`/db/client/cB/share/${links[0].id}`, { token: B, method: 'DELETE' })).body.ok, true);
  assert.equal((await call(`/share/${share.body.token}`)).status, 404);

  // Phloem Design: images carry the client tag; AI images answer clearly when the relay has no image key
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const up = await fetch(`${BASE}/db/assets/a_lib1`, { method: 'PUT', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'image/png', 'X-Asset-Name': 'logo.png', 'X-Asset-W': '1', 'X-Asset-H': '1', 'X-Asset-Meta': encodeURIComponent(JSON.stringify({ src: { kind: 'upload' }, client: 'cA', project: null })) }, body: png });
  assert.equal(up.status, 200);
  assert.equal((await call('/db/assets', { token: A })).body.assets.find((x) => x.id === 'a_lib1').client, 'cA');
  const img = await call('/ai/image', { token: A, method: 'POST', body: { prompt: 'một ly cà phê' } });
  assert.ok([403, 503].includes(img.status), `ai image without key/access → ${img.status}`);

  // export carries the client's data only; delete needs the typed name
  const ex = (await call('/db/client/cA/export', { token: A })).body;
  assert.equal(ex.client.id, 'cA');
  assert.ok(ex.items.every((i) => i.kind !== 'plan'));
  assert.equal((await call('/db/clients/cA?confirm=sai', { token: A, method: 'DELETE' })).status, 400);
  assert.equal((await call('/db/clients/cA?confirm=qu%C3%A1n%20c%C3%A0%20ph%C3%AA%20a', { token: A, method: 'DELETE' })).status, 200);
  assert.deepEqual((await call('/db/clients', { token: T })).body.clients, [], 'members lose a deleted client');
  assert.equal((await call('/db/client/cB/items/plan/p1', { token: B })).status, 200, 'other agency untouched');
});
