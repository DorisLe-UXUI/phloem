import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMail, imageConfig, makeToken, personalize, readToken } from '../server/src/mail.mjs';
import { openDb } from '../server/src/db.mjs';

const SECRET = 'test-secret';
const BASE = 'https://relay.test';

test('tokens are signed per owner, campaign and address', () => {
  const t = makeToken(SECRET, 'u_1', 'c1', 'An@Example.com', 'B');
  assert.deepEqual(readToken(SECRET, t), { owner: 'u_1', campaign: 'c1', email: 'an@example.com', variant: 'B' });
  assert.equal(readToken('other', t), null);
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ o: 'u_1', c: 'c1', e: 'victim@example.com' })).toString('base64url');
  assert.equal(readToken(SECRET, `${forged}.${sig}`), null);
  assert.equal(readToken(SECRET, `${body}.${sig.slice(0, -1)}x`), null);
  assert.equal(readToken(SECRET, 'garbage'), null);
});

test('personalize fills unsubscribe, click and name placeholders and appends the pixel', () => {
  const html = '<html><body><a href="__PHLOEM_CLICK_0__">A</a><a href="__PHLOEM_CLICK_12__">B</a><a href="__PHLOEM_UNSUB__">Huỷ</a>Chào {{first_name}}</body></html>';
  const out = personalize(html, BASE, 'tok', '<Lan>');
  assert.ok(out.html.includes(`href="${BASE}/c/tok/0"`));
  assert.ok(out.html.includes(`href="${BASE}/c/tok/12"`));
  assert.ok(out.html.includes(`href="${BASE}/u/tok"`));
  assert.ok(out.html.includes('Chào &lt;Lan&gt;'));
  assert.match(out.html, /<img src="https:\/\/relay\.test\/o\/tok\.gif"[^>]*><\/body>/);
  assert.equal(out.unsub, `${BASE}/u/tok`);
});

test('imageConfig needs a bucket and a public URL, borrowing backup credentials', () => {
  assert.equal(imageConfig({ BACKUP_S3_ENDPOINT: 'https://x', BACKUP_S3_KEY: 'k', BACKUP_S3_SECRET: 's' }), null);
  const c = imageConfig({ BACKUP_S3_ENDPOINT: 'https://x/', BACKUP_S3_KEY: 'k', BACKUP_S3_SECRET: 's', IMG_S3_BUCKET: 'img', IMG_PUBLIC_URL: 'https://pub.example/' });
  assert.equal(c.bucket, 'img'); assert.equal(c.key, 'k'); assert.equal(c.endpoint, 'https://x'); assert.equal(c.publicUrl, 'https://pub.example');
});

// ---------- routes, with fake req/res ----------
function harness(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'phloem-mail-'));
  const db = openDb(join(dir, 'p.db'));
  const sent = [];
  const fake = { send: async (s, m) => { if (m.to.startsWith('bad')) throw new Error('400 rejected'); sent.push({ ...m, from: s.fromEmail }); }, perDay: 1000, label: 'Fake' };
  const json = (res, code, obj) => { res.statusCode = code; res.obj = obj; res.end(JSON.stringify(obj)); };
  const mail = createMail({
    raw: db.raw, secret: SECRET, publicUrl: BASE, json, body: async (req) => req.body || {}, rawBody: async (req) => req.bytes,
    requireUser: (req, res) => req.user || (json(res, 401, { error: 'login' }), null), throttled: () => false,
    env: {}, log: () => {}, providers: { fake }, pace: 0, ...extra,
  });
  const call = async (method, path, { user = { id: 'u_1', email: 'me@x.co' }, body } = {}) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(x) { this.text = String(x ?? ''); } };
    const handled = await mail.handle(new URL(path, BASE), { method, headers: {}, user, body }, res);
    return { handled, ...res };
  };
  return { mail, call, sent, db };
}

test('unsubscribe: GET asks, POST suppresses; tokens report suppressed addresses', async () => {
  const { call } = harness();
  await call('POST', '/mail/campaigns', { body: { id: 'c1', subject: 'Hi', fromName: 'HappyTown', links: ['https://happy.town/a'] } });
  const tk = await call('POST', '/mail/tokens', { body: { campaign: 'c1', emails: ['a@x.co', 'not-an-email', 'B@x.co'] } });
  assert.deepEqual(Object.keys(tk.obj.tokens), ['a@x.co', 'b@x.co']);
  const t = tk.obj.tokens['a@x.co'];
  const ask = await call('GET', `/u/${t}`, { user: null });
  assert.equal(ask.statusCode, 200); assert.match(ask.text, /<form method="post">/); assert.match(ask.text, /HappyTown/);
  let sup = await call('GET', '/mail/suppressions');
  assert.equal(sup.obj.suppressions.length, 0, 'a prefetch of the GET must not unsubscribe');
  const done = await call('POST', `/u/${t}`, { user: null });
  assert.match(done.text, /Đã huỷ đăng ký/);
  sup = await call('GET', '/mail/suppressions');
  assert.deepEqual(sup.obj.suppressions.map((r) => r.email), ['a@x.co']);
  const tk2 = await call('POST', '/mail/tokens', { body: { campaign: 'c1', emails: ['a@x.co', 'b@x.co'] } });
  assert.deepEqual(tk2.obj.suppressed, ['a@x.co']);
  const bad = await call('GET', '/u/forged.token', { user: null });
  assert.equal(bad.statusCode, 404);
  // another user's suppression list is separate
  const other = await call('GET', '/mail/suppressions', { user: { id: 'u_2' } });
  assert.equal(other.obj.suppressions.length, 0);
  await call('DELETE', '/mail/suppressions/A%40x.co');
  assert.equal((await call('GET', '/mail/suppressions')).obj.suppressions.length, 0);
});

test('open pixel and click redirect count unique people, and only redirect to registered links', async () => {
  const { call } = harness();
  await call('POST', '/mail/campaigns', { body: { id: 'c1', links: ['https://happy.town/a', 'javascript:alert(1)'] } });
  const t = makeToken(SECRET, 'u_1', 'c1', 'a@x.co');
  const px = await call('GET', `/o/${t}.gif`, { user: null });
  assert.equal(px.headers['content-type'], 'image/gif');
  await call('GET', `/o/${t}.gif`, { user: null }); // Gmail prefetch: still one open
  const c = await call('GET', `/c/${t}/0`, { user: null });
  assert.equal(c.statusCode, 302); assert.equal(c.headers.location, 'https://happy.town/a');
  assert.equal((await call('GET', `/c/${t}/1`, { user: null })).statusCode, 404, 'non-http link never redirects');
  assert.equal((await call('GET', `/c/${t}/9`, { user: null })).statusCode, 404);
  const other = makeToken(SECRET, 'u_2', 'c1', 'a@x.co'); // same campaign id, another owner: no such campaign
  assert.equal((await call('GET', `/c/${other}/0`, { user: null })).statusCode, 404);
  const st = await call('GET', '/mail/campaigns/c1/stats');
  assert.equal(st.obj.opens, 1); assert.equal(st.obj.clicks, 1);
  assert.deepEqual(st.obj.links, [{ url: 'https://happy.town/a', clicks: 1 }]);
  // a broken token still serves the gif
  assert.equal((await call('GET', '/o/nope.gif', { user: null })).headers['content-type'], 'image/gif');
});

test('private routes need a signed-in user; senders never return their keys', async () => {
  const { call } = harness();
  assert.equal((await call('GET', '/mail/suppressions', { user: null })).statusCode, 401);
  assert.equal((await call('POST', '/img', {})).statusCode, 503, 'no bucket configured');
  const bad = await call('POST', '/mail/senders', { body: { provider: 'fake', fromEmail: 'news@happy.town' } });
  assert.equal(bad.statusCode, 400);
  const s = await call('POST', '/mail/senders', { body: { provider: 'fake', fromEmail: 'news@happy.town', apiKey: 'sk_live_secret' } });
  assert.equal(s.obj.sender.hasKey, true); assert.ok(!JSON.stringify(s.obj).includes('sk_live_secret'));
  const list = await call('GET', '/mail/senders');
  assert.ok(!JSON.stringify(list.obj).includes('sk_live_secret'));
  assert.equal((await call('GET', '/mail/senders', { user: { id: 'u_2' } })).obj.senders.length, 0);
  assert.equal((await call('GET', '/nope')).handled, false);
});

test('server queue: skips suppressed, respects the daily cap, adds List-Unsubscribe, and A/B picks a winner', async () => {
  const { call, mail, sent, db } = harness();
  const sender = (await call('POST', '/mail/senders', { body: { provider: 'fake', fromEmail: 'news@happy.town', apiKey: 'k', perDay: 3 } })).obj.sender;
  await call('POST', '/mail/campaigns', { body: { id: 'c1', subject: 'S', links: ['https://happy.town'] } });
  await call('POST', '/mail/suppressions', { body: { emails: ['b@x.co'] } });
  const html = '<body><a href="__PHLOEM_CLICK_0__">x</a><a href="__PHLOEM_UNSUB__">u</a></body>';
  const cidHtml = await call('POST', '/mail/send', { body: { campaign: 'c1', sender: sender.id, html: '<img src="cid:a">', recipients: ['a@x.co'] } });
  assert.equal(cidHtml.statusCode, 400, 'attachments cannot go through the queue');
  const r = await call('POST', '/mail/send', { body: { campaign: 'c1', sender: sender.id, subject: 'Xin chào', html, recipients: ['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co', 'e@x.co', 'a@x.co'] } });
  assert.equal(r.obj.recipients, 5);
  await mail.tick();
  // cap 3 per day: suppressed b is skipped (does not count), a c d sent, e waits for tomorrow
  assert.deepEqual(sent.map((m) => m.to), ['a@x.co', 'c@x.co', 'd@x.co']);
  assert.match(sent[0].headers['List-Unsubscribe'], /^<https:\/\/relay\.test\/u\/.+>$/);
  assert.equal(sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(sent[0].html.includes(`${BASE}/c/`) && sent[0].html.includes(`${BASE}/o/`));
  const st = await call('GET', '/mail/send/c1');
  assert.equal(st.obj.counts.sent, 3); assert.equal(st.obj.counts.skipped, 1); assert.equal(st.obj.counts.queued, 1);
  assert.equal(st.obj.send.status, 'waiting'); assert.ok(!('html' in st.obj.send));
  await call('POST', '/mail/send/c1/cancel');
  assert.equal((await call('GET', '/mail/send/c1')).obj.counts.cancelled, 1);

  // A/B: 10 recipients, split 0.4 → 4 test (A,B,A,B), B wins on opens, the rest go out with subject B
  sent.length = 0;
  const big = (await call('POST', '/mail/senders', { body: { provider: 'fake', fromEmail: 'news@happy.town', apiKey: 'k', perDay: 1000 } })).obj.sender;
  await call('POST', '/mail/campaigns', { body: { id: 'ab', subject: 'A', links: [] } });
  const people = Array.from({ length: 10 }, (_, i) => `p${i}@x.co`);
  await call('POST', '/mail/send', { body: { campaign: 'ab', sender: big.id, subject: 'Subject A', html, recipients: people, ab: { subjectB: 'Subject B', split: 0.4, metric: 'opens', waitHours: 1 } } });
  await mail.tick();
  assert.deepEqual(sent.map((m) => m.subject), ['Subject A', 'Subject B', 'Subject A', 'Subject B']);
  await mail.tick(); // test group done → wait phase
  // two B recipients open, one A recipient opens
  for (const [to, v] of [['p1@x.co', 'B'], ['p3@x.co', 'B'], ['p0@x.co', 'A']]) await call('GET', `/o/${makeToken(SECRET, 'u_1', 'ab', to, v)}.gif`, { user: null });
  await mail.tick();
  assert.equal(sent.length, 4, 'still waiting for the test window');
  // jump the clock: pretend the test went out 2 hours ago
  const row = (await call('GET', '/mail/send/ab')).obj.send; assert.equal(row.ab.phase, 'wait');
  const raw = db.raw.prepare('SELECT json FROM mail_campaigns WHERE owner = ? AND id = ?').get('u_1', 'ab');
  const c = JSON.parse(raw.json); c.send.testSentAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  db.raw.prepare('UPDATE mail_campaigns SET json = ? WHERE owner = ? AND id = ?').run(JSON.stringify(c), 'u_1', 'ab');
  await mail.tick();
  assert.equal(sent.length, 10);
  assert.ok(sent.slice(4).every((m) => m.subject === 'Subject B'));
  const fin = (await call('GET', '/mail/send/ab')).obj.send;
  assert.equal(fin.ab.winner, 'B'); assert.deepEqual(fin.ab.scores, { A: 1, B: 2 });
  await mail.tick();
  assert.equal((await call('GET', '/mail/send/ab')).obj.send.status, 'done');
  const stats = await call('GET', '/mail/campaigns/ab/stats');
  assert.deepEqual(stats.obj.byVariant.B, { opens: 2, clicks: 0 });
});

test('recall: a withdrawn campaign\'s links show an apology instead of the destination; env list works too; reversible', async () => {
  const { createMail: cm, makeToken: mk } = await import('../server/src/mail.mjs');
  const { openDb } = await import('../server/src/db.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'phloem-recall-')), 'p.db'));
  const json = (res, code, obj) => { res.statusCode = code; res.obj = obj; res.end(JSON.stringify(obj)); };
  const mail = cm({ raw: db.raw, secret: 's', publicUrl: 'https://r.test', json, body: async (req) => req.body || {}, rawBody: async () => Buffer.alloc(0), requireUser: (req, res) => req.user || (json(res, 401, {}), null), throttled: () => false, env: { RECALLED_CAMPAIGNS: 'old1' }, log: () => {} });
  const call = async (method, path, { user = { id: 'u' }, body } = {}) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(x) { this.text = String(x ?? ''); } }; await mail.handle(new URL(path, 'https://r.test'), { method, headers: {}, user, body }, res); return res; };
  for (const id of ['c1', 'old1']) await call('POST', '/mail/campaigns', { body: { id, subject: 'Oops', links: ['https://shop.test/x'] } });
  assert.equal((await call('GET', `/c/${mk('s', 'u', 'c1', 'a@b.co', '')}/0`, { user: null })).statusCode, 302);
  assert.equal((await call('POST', '/mail/campaigns/c1/recall', { body: { on: true } })).obj.recalled, true);
  const r = await call('GET', `/c/${mk('s', 'u', 'c1', 'a@b.co', '')}/0`, { user: null });
  assert.equal(r.statusCode, 410); assert.match(r.text, /withdrawn/); assert.ok(!r.headers.location);
  assert.equal((await call('GET', `/c/${mk('s', 'u', 'old1', 'a@b.co', '')}/0`, { user: null })).statusCode, 410, 'env list');
  assert.equal((await call('GET', `/u/${mk('s', 'u', 'c1', 'a@b.co', '')}`, { user: null })).statusCode, 200, 'unsubscribe still works');
  await call('POST', '/mail/campaigns/c1/recall', { body: { on: false } });
  assert.equal((await call('GET', `/c/${mk('s', 'u', 'c1', 'a@b.co', '')}/0`, { user: null })).statusCode, 302, 'reversible');
});

test('SMTP mailbox sender (Titan & co.): EHLO, AUTH, MAIL/RCPT/DATA with a UTF-8 MIME message; wrong password says so', async () => {
  const { createServer } = await import('node:net');
  const { smtpSend, buildMessage } = await import('../server/src/smtp.mjs');
  const got = [];
  const srv = createServer((sock) => {
    let buf = '', data = false, msg = '';
    sock.write('220 fake.smtp ready\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; got.push({ msg }); sock.write('250 2.0.0 queued as X1\r\n'); } else msg += `${line}\r\n`; continue; }
        if (/^EHLO/.test(line)) sock.write('250-fake.smtp\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
        else if (/^AUTH PLAIN /.test(line)) { const [, u, p] = Buffer.from(line.slice(11), 'base64').toString().split('\0'); got.push({ auth: [u, p] }); sock.write(p === 'right' ? '235 ok\r\n' : '535 5.7.8 bad credentials\r\n'); }
        else if (/^MAIL FROM/.test(line)) { got.push({ from: line }); sock.write('250 ok\r\n'); }
        else if (/^RCPT TO/.test(line)) { got.push({ to: line }); sock.write('250 ok\r\n'); }
        else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('500 ?\r\n');
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cfg = { host: '127.0.0.1', port: srv.address().port, secure: 'none', username: 'doris@intac.co', password: 'right' };
  const msg = { from: 'doris@intac.co', fromName: 'Doris · Intac', to: 'khach@shop.vn', subject: 'Ưu đãi tháng 10', html: '<p>Xin chào</p>\n.dot line', text: 'Xin chào', headers: { 'List-Unsubscribe': '<https://r.test/u/x>' } };
  try {
    const r = await smtpSend(cfg, msg);
    assert.equal(r.ok, true);
    assert.deepEqual(got.find((x) => x.auth).auth, ['doris@intac.co', 'right']);
    assert.match(got.find((x) => x.from).from, /<doris@intac\.co>/); assert.match(got.find((x) => x.to).to, /<khach@shop\.vn>/);
    const body = got.find((x) => x.msg).msg;
    assert.match(body, /Subject: =\?UTF-8\?B\?/); assert.match(body, /From: =\?UTF-8\?B\?.+\?= <doris@intac\.co>/); assert.match(body, /List-Unsubscribe: <https:\/\/r\.test\/u\/x>/);
    assert.match(body, /multipart\/alternative/);
    const html64 = body.split('text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
    assert.equal(Buffer.from(html64, 'base64').toString(), '<p>Xin chào</p>\n.dot line');
    await assert.rejects(smtpSend({ ...cfg, password: 'wrong' }, msg), /sai tài khoản hoặc mật khẩu/);
    assert.ok(!/\r\n\.\r\n/.test(buildMessage(msg).replace(/(^|\r\n)\./g, '$1..')), 'dot-stuffed');
  } finally { srv.close(); }
});

test('mailbox detection: consumer domains directly, company domains by MX (Google, Microsoft, Titan, cPanel fallback)', async () => {
  const { detectSmtp } = await import('../server/src/smtp.mjs');
  const mx = (rec) => async () => rec.map((exchange, i) => ({ exchange, priority: i }));
  assert.equal((await detectSmtp('a@gmail.com')).host, 'smtp.gmail.com');
  assert.equal((await detectSmtp('a@yahoo.com.vn')).preset, 'yahoo');
  assert.equal((await detectSmtp('a@corp.vn', { mxLookup: mx(['aspmx.l.google.com']) })).preset, 'google');
  assert.equal((await detectSmtp('a@corp.vn', { mxLookup: mx(['corp-vn.mail.protection.outlook.com']) })).preset, 'outlook');
  assert.equal((await detectSmtp('a@corp.vn', { mxLookup: mx(['mx1.titan.email']) })).host, 'smtp.titan.email');
  assert.equal((await detectSmtp('a@shop.vn', { mxLookup: mx(['mx1.matbao.net']) })).host, 'mail.shop.vn');
  const unknown = await detectSmtp('a@shop.vn', { mxLookup: mx(['mail.shop.vn']) }); assert.equal(unknown.preset, 'custom'); assert.equal(unknown.host, 'mail.shop.vn');
  assert.equal(await detectSmtp('not-an-email'), null);
});

test('SMTP through the Cloudflare bridge: a one-time job the bridge fetches back; never reusable; errors come back', async () => {
  const { createServer } = await import('node:http');
  const { createMail: cm } = await import('../server/src/mail.mjs');
  const { openDb } = await import('../server/src/db.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'phloem-bridge-')), 'p.db'));
  const json = (res, code, obj) => { res.statusCode = code; res.obj = obj; res.end(JSON.stringify(obj)); };
  let mail; const seen = [];
  const call = async (method, path, { user = null, body } = {}) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(x) { this.text = String(x ?? ''); } }; await mail.handle(new URL(path, 'https://r.test'), { method, headers: {}, user, body }, res); return res; };
  const bridge = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', async () => {
    const id = JSON.parse(b).job; const j1 = await call('GET', `/mail/smtp-job/${id}`); const j2 = await call('GET', `/mail/smtp-job/${id}`);
    seen.push({ first: j1.statusCode, again: j2.statusCode, job: j1.obj });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(j1.obj.password === 'right' ? { ok: true, id: '250 queued' } : { ok: false, error: 'SMTP: sai tài khoản hoặc mật khẩu (535)' }));
  }); });
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  try {
    mail = cm({ raw: db.raw, secret: 's', publicUrl: 'https://r.test', json, body: async (req) => req.body || {}, rawBody: async () => Buffer.alloc(0), requireUser: (req, res) => req.user || (json(res, 401, {}), null), throttled: () => false, env: { SMTP_BRIDGE_URL: `http://127.0.0.1:${bridge.address().port}/send` }, log: () => {} });
    const u = { id: 'u1', email: 'me@x.co' };
    const s = (await call('POST', '/mail/senders', { user: u, body: { provider: 'smtp', preset: 'titan', host: 'smtp.titan.email', port: 465, secure: 'ssl', fromEmail: 'hello@intac.co', fromName: 'Intac', password: 'right' } })).obj.sender;
    const t = await call('POST', `/mail/senders/${s.id}/test`, { user: u, body: { to: 'khach@shop.vn' } });
    assert.equal(t.statusCode, 200);
    assert.equal(seen[0].first, 200); assert.equal(seen[0].again, 404, 'single use');
    assert.equal(seen[0].job.host, 'smtp.titan.email'); assert.equal(seen[0].job.to, 'khach@shop.vn'); assert.match(seen[0].job.raw, /^From: Intac <hello@intac\.co>/m);
    assert.equal((await call('GET', '/mail/smtp-job/AAAAAAAAAAAAAAAAAAAAAAAA')).statusCode, 404);
    const v = await call('POST', '/mail/smtp/verify', { user: u, body: { host: 'smtp.titan.email', port: 465, secure: 'ssl', username: 'hello@intac.co', password: 'wrong' } });
    assert.equal(v.obj.ok, false); assert.match(v.obj.error, /mật khẩu/); assert.equal(seen[1].job.raw, null, 'verify sends nothing');
  } finally { bridge.close(); }
});

test('a campaign stopped by a blocked SMTP connection resumes (rows back in the queue); one stopped by a wrong password does not', async () => {
  const { createMail: cm } = await import('../server/src/mail.mjs');
  const { openDb } = await import('../server/src/db.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'phloem-resume-')), 'p.db'));
  const json = (res, code, obj) => { res.statusCode = code; res.obj = obj; res.end(JSON.stringify(obj)); };
  const mail = cm({ raw: db.raw, secret: 's', publicUrl: 'https://r.test', json, body: async (req) => req.body || {}, rawBody: async () => Buffer.alloc(0), requireUser: (req, res) => req.user || (json(res, 401, {}), null), throttled: () => false, env: {}, log: () => {} });
  const now = new Date().toISOString();
  for (const [id, err] of [['blocked', 'SMTP: không kết nối được smtp.titan.email:465 (ETIMEDOUT)'], ['badpass', 'SMTP: sai tài khoản hoặc mật khẩu (535)']]) {
    mail.saveCampaign('u1', id, { createdAt: now, links: [], send: { status: 'error', lastError: err, sendAt: now, sender: 's1', perDay: 100, subject: 'x', html: '<p>x</p>' } });
    db.raw.prepare("INSERT INTO mail_queue (owner, campaign, email, variant, status, error, sent_at) VALUES ('u1', ?, 'a@b.co', '', 'failed', ?, ?)").run(id, err, now);
  }
  assert.equal(mail.resumeBlocked(), 1);
  assert.equal(mail.campaign('u1', 'blocked').send.status, 'sending'); assert.equal(mail.campaign('u1', 'badpass').send.status, 'error');
  const st = (id) => db.raw.prepare("SELECT status FROM mail_queue WHERE owner = 'u1' AND campaign = ?").get(id).status;
  assert.equal(st('blocked'), 'queued'); assert.equal(st('badpass'), 'failed');
});

test('resume with another channel: the campaign switches sender and undelivered rows (bad key) go again', async () => {
  const { createMail: cm } = await import('../server/src/mail.mjs');
  const { openDb } = await import('../server/src/db.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'phloem-switch-')), 'p.db'));
  const json = (res, code, obj) => { res.statusCode = code; res.obj = obj; res.end(JSON.stringify(obj)); };
  const sent = [];
  const providers = { resend: { label: 'Resend', perDay: 100, send: async () => { throw new Error('Resend 401: API key is invalid'); } }, smtp: { label: 'SMTP', perDay: 300, send: async (s, m) => { sent.push([s.fromEmail, m.to]); } } };
  const mail = cm({ raw: db.raw, secret: 's', publicUrl: 'https://r.test', json, body: async (req) => req.body || {}, rawBody: async () => Buffer.alloc(0), requireUser: (req, res) => req.user || (json(res, 401, {}), null), throttled: () => false, env: {}, log: () => {}, providers, pace: 0 });
  const u = { id: 'u1', email: 'me@x.co' };
  const call = async (method, path, body) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(x) { this.text = String(x ?? ''); } }; await mail.handle(new URL(path, 'https://r.test'), { method, headers: {}, user: u, body }, res); return res; };
  const bad = (await call('POST', '/mail/senders', { provider: 'resend', fromEmail: 'news@shop.vn', apiKey: 're_wrong' })).obj.sender;
  const titan = (await call('POST', '/mail/senders', { provider: 'smtp', preset: 'titan', host: 'smtp.titan.email', port: 465, secure: 'ssl', fromEmail: 'hello@shop.vn', password: 'p' })).obj.sender;
  await call('POST', '/mail/campaigns', { id: 'c1', subject: 'Hi', links: [] });
  await call('POST', '/mail/send', { campaign: 'c1', sender: bad.id, subject: 'Hi', html: '<p>Hi</p>', recipients: ['a@b.co', 'c@d.co'] });
  await mail.tick();
  assert.equal(mail.campaign('u1', 'c1').send.status, 'error');
  assert.equal((await call('POST', '/mail/send/c1/resume', { sender: 'nope' })).statusCode, 404);
  assert.equal((await call('POST', '/mail/send/c1/resume', { sender: titan.id })).obj.status, 'scheduled');
  await mail.tick();
  assert.deepEqual(sent.map((x) => x[1]).sort(), ['a@b.co', 'c@d.co'], 'everyone gets it from the new channel, once');
  assert.ok(sent.every((x) => x[0] === 'hello@shop.vn'));
  await mail.tick(); assert.equal(mail.campaign('u1', 'c1').send.status, 'done');
});
