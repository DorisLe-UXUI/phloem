import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMail } from '../server/src/mail.mjs';
import { createSupport, cleanMeta } from '../server/src/support.mjs';
import { openDb } from '../server/src/db.mjs';

const BASE = 'https://relay.test';
const ADMIN = { id: 'u_admin', email: 'boss@phloem.vn', name: 'Boss' };
const USER = { id: 'u_1', email: 'an@shop.vn', name: 'An' };

function harness({ resendKey = '' } = {}) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'phloem-sup-')), 'p.db'));
  const sent = [];
  const fake = { send: async (s, m) => { if (s.apiKey === 'bad') throw new Error('401 invalid key'); sent.push({ ...m, from: s.fromEmail, replyTo: s.replyTo }); }, perDay: 1000, label: 'Fake' };
  const json = (res, code, obj) => { res.statusCode = code; res.obj = obj; res.end(JSON.stringify(obj)); };
  const limits = new Map();
  const throttled = (k, max) => { const n = (limits.get(k) || 0) + 1; limits.set(k, n); return n > max; };
  const common = { raw: db.raw, secret: 's', publicUrl: BASE, json, body: async (req) => req.body || {}, rawBody: async () => Buffer.from(''), requireUser: (req, res) => req.user || (json(res, 401, { error: 'login' }), null), throttled, log: () => {} };
  const mail = createMail({ ...common, env: {}, providers: { fake }, pace: 0, hooks: {} });
  const sup = createSupport({ raw: db.raw, json, body: common.body, throttled, ipOf: (r) => r.ip || '1.1.1.1', userOf: (r) => r.user || null, adminOf: (r) => (r.user?.id === ADMIN.id ? r.user : null), mail, adminEmails: [ADMIN.email], resendKey, appUrl: 'https://app.test/studio/', log: () => {} });
  const call = async (method, path, { user = null, body, ip } = {}) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(x) { this.text = String(x ?? ''); } };
    const req = { method, headers: {}, user, body, ip };
    let handled = await mail.handle(new URL(path, BASE), req, res); if (!handled) handled = await sup.handle(new URL(path, BASE), req, res);
    return { handled, ...res };
  };
  return { call, sent, sup, mail };
}
const useMailbox = async (h) => {
  const s = (await h.call('POST', '/mail/senders', { user: ADMIN, body: { provider: 'fake', fromEmail: 'care@phloem.vn', fromName: 'Phloem', apiKey: 'k' } })).obj.sender;
  const r = await h.call('POST', '/admin/support/settings', { user: ADMIN, body: { sender: s.id } });
  assert.equal(r.statusCode, 200); assert.equal(r.obj.channel, 'mailbox');
  return s;
};

test('support: a guest ticket needs an email, is mailed to the admins with Reply-To = the customer', async () => {
  const h = harness(); await useMailbox(h);
  const bad = await h.call('POST', '/support', { body: { kind: 'bug', message: 'Nút Xuất không chạy' } });
  assert.equal(bad.statusCode, 400);
  const r = await h.call('POST', '/support', { body: { kind: 'bug', message: 'Nút Xuất không chạy\nbấm hoài không ra file', email: 'Khach@Mail.vn', name: 'Khách', image: 'data:image/png;base64,iVBORw0KGgo=', meta: { route: 'editor', projectName: 'Sale 11.11', ua: 'Chrome', secret: 'x', errors: ['a', 'b'] } } });
  assert.equal(r.statusCode, 200); assert.ok(r.obj.id && r.obj.key);
  await h.sup.flush();
  assert.equal(h.sent.length, 1);
  const m = h.sent[0];
  assert.equal(m.to, ADMIN.email); assert.equal(m.replyTo, 'khach@mail.vn'); assert.equal(m.from, 'care@phloem.vn');
  assert.match(m.subject, /^\[Phloem hỗ trợ\] Báo lỗi: Nút Xuất không chạy/);
  assert.match(m.html, /bấm hoài không ra file/); assert.match(m.html, /#\/admin\/ho-tro\/t_/); assert.match(m.text, /Email đang mở: Sale 11\.11/);
  assert.ok(!m.headers['List-Unsubscribe'], 'a notification is not a newsletter');
  // guests read their thread with the key only
  const mine = await h.call('GET', `/support/mine?keys=${r.obj.id}.${r.obj.key}`);
  assert.equal(mine.obj.tickets.length, 1); assert.equal(mine.obj.tickets[0].messages[0].image, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(mine.obj.tickets[0].meta.secret, undefined, 'unknown meta keys are dropped');
  const wrong = await h.call('GET', `/support/mine?keys=${r.obj.id}.nope`);
  assert.equal(wrong.obj.tickets.length, 0);
  const stranger = await h.call('POST', `/support/${r.obj.id}/reply`, { body: { message: 'hi', key: 'nope' } });
  assert.equal(stranger.statusCode, 404);
});

test('support: signed-in users use their account email; honeypot and per-IP limit stop floods', async () => {
  const h = harness();
  const r = await h.call('POST', '/support', { user: USER, body: { kind: 'idea', message: 'Thêm mẫu Tết', email: 'other@x.vn' } });
  assert.equal(r.obj.ticket.email, USER.email); assert.equal(r.obj.ticket.owner, USER.id); assert.equal(r.obj.ticket.kind, 'idea');
  await h.sup.flush();
  assert.equal(r.obj.ticket.mailed, '');
  const mine = await h.call('GET', '/support/mine', { user: USER });
  assert.equal(mine.obj.tickets.length, 1);
  assert.equal(mine.obj.tickets[0].mailed, 'off', 'no notification channel yet: recorded, ticket still kept');
  const bot = await h.call('POST', '/support', { body: { message: 'buy now', email: 'b@b.co', website: 'http://spam' } });
  assert.equal(bot.statusCode, 200);
  const all = await h.call('GET', '/admin/support?status=all', { user: ADMIN });
  assert.equal(all.obj.tickets.length, 1, 'honeypot ticket never stored');
  let last;
  for (let i = 0; i < 9; i++) last = await h.call('POST', '/support', { ip: '9.9.9.9', body: { message: `lỗi ${i}`, email: 'g@g.co' } });
  assert.equal(last.statusCode, 429);
});

test('support: admin inbox, reply mailed to the customer, status, read flags, follow-up reopens', async () => {
  const h = harness(); await useMailbox(h);
  const t = (await h.call('POST', '/support', { user: USER, body: { kind: 'help', message: 'Gửi Titan báo sai mật khẩu' } })).obj;
  await h.sup.flush(); h.sent.length = 0;
  assert.equal((await h.call('GET', '/admin/support', { user: USER })).statusCode, 403);
  assert.equal((await h.call('GET', '/admin/support')).statusCode, 401);
  const inbox = await h.call('GET', '/admin/support', { user: ADMIN });
  assert.equal(inbox.obj.counts.new, 1); assert.equal(inbox.obj.counts.unread, 1);
  assert.equal(inbox.obj.tickets[0].messages, undefined, 'the list stays light');
  assert.equal(inbox.obj.settings.senders.length, 1);
  assert.equal(h.sup.unreadForAdmin(), 1);
  const open = await h.call('GET', `/admin/support/${t.id}`, { user: ADMIN });
  assert.equal(open.obj.ticket.messages.length, 1); assert.equal(h.sup.unreadForAdmin(), 0);
  const rep = await h.call('POST', `/admin/support/${t.id}/reply`, { user: ADMIN, body: { message: 'Titan cần bật SMTP trong cài đặt hộp mail nhé.', close: true } });
  assert.equal(rep.obj.mailed, 'ok'); assert.equal(rep.obj.ticket.status, 'done'); assert.equal(rep.obj.ticket.lastBy, 'admin');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].to, USER.email); assert.equal(h.sent[0].replyTo, ADMIN.email);
  assert.match(h.sent[0].subject, /^Phloem trả lời: Gửi Titan/); assert.match(h.sent[0].html, /bật SMTP/); assert.match(h.sent[0].html, /Gửi Titan báo sai mật khẩu/);
  assert.match(h.sent[0].text, new RegExp(`#/ho-tro/${t.id}/${t.key}`));
  let mine = await h.call('GET', '/support/mine', { user: USER });
  assert.equal(mine.obj.unread, 1); assert.equal(mine.obj.tickets[0].messages.length, 2);
  await h.call('POST', `/support/${t.id}/read`, { user: USER });
  mine = await h.call('GET', '/support/mine', { user: USER });
  assert.equal(mine.obj.unread, 0);
  const rate = await h.call('POST', `/support/${t.id}/rate`, { user: USER, body: { rating: 1 } });
  assert.equal(rate.obj.ticket.rating, 1);
  // the customer writes again: back to "Đang xử lý", unread for the admin, mailed
  h.sent.length = 0;
  const fu = await h.call('POST', `/support/${t.id}/reply`, { user: USER, body: { message: 'Đã bật, gửi được rồi, cảm ơn!' } });
  assert.equal(fu.obj.ticket.status, 'open'); assert.equal(fu.obj.ticket.adminUnread, true);
  await h.sup.flush();
  assert.match(h.sent[0].subject, /Trả lời: Gửi Titan/);
  const st = await h.call('POST', `/admin/support/${t.id}/status`, { user: ADMIN, body: { status: 'spam' } });
  assert.equal(st.obj.ticket.status, 'spam');
  assert.equal((await h.call('GET', '/support/mine', { user: USER })).obj.tickets.length, 0);
  assert.equal((await h.call('POST', `/admin/support/${t.id}/status`, { user: ADMIN, body: { status: 'x' } })).statusCode, 400);
});

test('support: a broken notification mailbox is reported, never loses the ticket; CSV export; settings ownership', async () => {
  const h = harness();
  const s = (await h.call('POST', '/mail/senders', { user: ADMIN, body: { provider: 'fake', fromEmail: 'care@phloem.vn', apiKey: 'bad' } })).obj.sender;
  assert.equal((await h.call('POST', '/admin/support/settings', { user: ADMIN, body: { sender: 'nope' } })).statusCode, 404);
  await h.call('POST', '/admin/support/settings', { user: ADMIN, body: { sender: s.id } });
  const test1 = await h.call('POST', '/admin/support/test', { user: ADMIN });
  assert.equal(test1.statusCode, 502); assert.match(test1.obj.error, /401/);
  const t = (await h.call('POST', '/support', { user: USER, body: { message: 'Xin hướng dẫn, "dấu phẩy", xuống\ndòng' } })).obj;
  await h.sup.flush();
  const one = await h.call('GET', `/admin/support/${t.id}`, { user: ADMIN });
  assert.match(one.obj.ticket.mailed, /^lỗi: .*401/);
  const csv = await h.call('GET', '/admin/support.csv', { user: ADMIN });
  assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
  assert.ok(csv.text.startsWith('﻿id,'));
  assert.ok(csv.text.includes('"Xin hướng dẫn, ""dấu phẩy"", xuống\ndòng"'));
  await h.call('POST', '/admin/support/settings', { user: ADMIN, body: { sender: '' } });
  assert.equal((await h.call('POST', '/admin/support/test', { user: ADMIN })).statusCode, 400);
});

test('support: meta is whitelisted and trimmed', () => {
  const m = cleanMeta({ route: 'x'.repeat(400), errors: ['1', '2', '3', '4', '5', '6'], token: 'secret', app: 'email' });
  assert.equal(m.route.length, 300); assert.deepEqual(m.errors, ['2', '3', '4', '5', '6']); assert.equal(m.token, undefined); assert.equal(m.app, 'email');
  assert.deepEqual(cleanMeta(null), {});
});
