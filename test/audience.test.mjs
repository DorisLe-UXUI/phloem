import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMail, makeToken, mergeFields, parseProviderEvents } from '../server/src/mail.mjs';
import { createAudience, matchContact, monthDay, toCsv } from '../server/src/audience.mjs';
import { openDb } from '../server/src/db.mjs';

const SECRET = 'test-secret';
const BASE = 'https://relay.test';
const U1 = { id: 'u_1', email: 'me@agency.co' }, U2 = { id: 'u_2', email: 'viewer@agency.co' }, U3 = { id: 'u_3', email: 'stranger@x.co' };
const ROLE_CAN = { owner: ['read', 'write', 'manage'], manager: ['read', 'write', 'manage'], designer: ['read', 'write'], client_viewer: ['read'] };

function harness() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'phloem-aud-')), 'p.db'));
  const sent = [];
  const fake = { send: async (s, m) => { if (m.to.startsWith('fail')) throw new Error('500 provider down'); sent.push({ ...m, from: s.fromEmail }); }, perDay: 1000, label: 'Fake' };
  const json = (res, code, obj) => { res.statusCode = code; res.obj = obj; res.end(JSON.stringify(obj)); };
  const common = { raw: db.raw, secret: SECRET, publicUrl: BASE, json, body: async (req) => req.body || {}, rawBody: async (req) => Buffer.from(req.raw || ''), requireUser: (req, res) => req.user || (json(res, 401, { error: 'login' }), null), throttled: () => false, log: () => {} };
  const hooks = {};
  const mail = createMail({ ...common, env: {}, providers: { fake }, pace: 0, hooks });
  const acl = { u_1: { c1: 'owner' }, u_2: { c1: 'client_viewer' } };
  const aud = createAudience({ ...common, ipOf: () => '1.2.3.4', access: (uid, cid) => (acl[uid]?.[cid] ? { owner: 'u_1', role: acl[uid][cid] } : null), can: (acc, w) => !!acc && ROLE_CAN[acc.role]?.includes(w), mail });
  Object.assign(hooks, aud.mailHooks);
  const call = async (method, path, { user = U1, body, raw, headers = {} } = {}) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(x) { this.text = String(x ?? ''); } };
    const url = new URL(path, BASE); const req = { method, headers, user, body, raw };
    let handled = await mail.handle(url, req, res); if (!handled) handled = await aud.handle(url, req, res);
    return { handled, ...res };
  };
  return { call, sent, mail, aud, db };
}
const sender = async (call, user = U1) => (await call('POST', '/mail/senders', { user, body: { provider: 'fake', fromEmail: 'news@shop.vn', fromName: 'Shop', apiKey: 'k' } })).obj.sender;

test('merge fields fill names and custom fields, with fallbacks, escaped in HTML', () => {
  assert.equal(mergeFields('Chào {{first_name|bạn}}!', {}), 'Chào bạn!');
  assert.equal(mergeFields('Chào {{ first_name }} {{last_name}}', { first_name: 'An', last_name: '<Lê>' }), 'Chào An &lt;Lê&gt;');
  assert.equal(mergeFields('{{city|HCM}} {{unknown}}x', { city: 'Đà Nẵng' }, false), 'Đà Nẵng x');
  assert.equal(mergeFields('{{ten}}', { first_name: 'Hà' }), 'Hà');
});

test('segment rules: tags, fields, activity, any/all', () => {
  const nowMs = Date.parse('2026-10-15T00:00:00Z');
  const c = { email: 'a@gmail.com', first_name: 'An', last_name: '', status: 'subscribed', tags: ['vip', 'hcm'], fields: { city: 'HCM' }, opens: 3, clicks: 0, lastOpenAt: '2026-09-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' };
  assert.ok(matchContact(c, [{ field: 'tag', op: 'has', value: 'VIP' }], 'all', nowMs));
  assert.ok(!matchContact(c, [{ field: 'tag', op: 'has', value: 'vip' }, { field: 'clicks', op: 'gt', value: 0 }], 'all', nowMs));
  assert.ok(matchContact(c, [{ field: 'tag', op: 'has', value: 'vip' }, { field: 'clicks', op: 'gt', value: 0 }], 'any', nowMs));
  assert.ok(matchContact(c, [{ field: 'email_domain', op: 'eq', value: 'gmail.com' }, { field: 'fields.city', op: 'eq', value: 'hcm' }], 'all', nowMs));
  assert.ok(matchContact(c, [{ field: 'days_since_open', op: 'gt', value: 30 }], 'all', nowMs));
  assert.ok(matchContact(c, [{ field: 'last_name', op: 'empty' }], 'all', nowMs));
  assert.deepEqual(monthDay('1990-10-15'), [10, 15]); assert.deepEqual(monthDay('15/10'), [10, 15]); assert.equal(monthDay('soon'), null);
  assert.equal(toCsv([['a', 'b,c'], ['"q"', 'x\ny']]), 'a,"b,c"\r\n"""q""","x\ny"');
});

test('lists and import: consent attested, invalid counted, suppressed and bounced never come back', async () => {
  const { call, mail } = harness();
  const list = (await call('POST', '/aud/lists', { body: { name: 'Khách lẻ', company: { name: 'Shop', address: '1 Lê Lợi, Q1' } } })).obj.list;
  assert.equal(list.total, 0);
  assert.equal((await call('POST', `/aud/lists/${list.id}/import`, { body: { rows: [{ email: 'a@x.co' }] } })).statusCode, 400, 'consent must be attested');
  mail.suppress('u_1', 'gone@x.co', 'unsubscribe');
  const r = await call('POST', `/aud/lists/${list.id}/import`, { body: { attest: true, tags: ['import-10'], rows: [{ email: 'A@x.co', first_name: 'An' }, { email: 'b@x.co', fields: { city: 'HCM' } }, { email: 'nope' }, { email: 'gone@x.co' }] } });
  assert.deepEqual(r.obj, { added: 2, updated: 0, invalid: 1, skipped: 0, suppressed: 1 });
  // a bounced contact is not revived by a re-import
  await call('PATCH', `/aud/lists/${list.id}/contacts/b@x.co`, { body: { status: 'bounced' } });
  await call('POST', `/aud/lists/${list.id}/import`, { body: { attest: true, rows: [{ email: 'b@x.co' }] } });
  const got = (await call('GET', `/aud/lists/${list.id}/contacts`)).obj;
  assert.equal(got.total, 2);
  assert.equal(got.contacts.find((c) => c.email === 'b@x.co').status, 'bounced');
  const a = got.contacts.find((c) => c.email === 'a@x.co');
  assert.equal(a.first_name, 'An'); assert.deepEqual(a.tags, ['import-10']); assert.equal(a.consent.method, 'import'); assert.equal(a.consent.by, 'me@agency.co');
  const lists = (await call('GET', '/aud/lists')).obj.lists;
  assert.equal(lists[0].counts.subscribed, 1); assert.equal(lists[0].counts.bounced, 1);
  const csv = await call('GET', `/aud/lists/${list.id}/export.csv`);
  assert.match(csv.text, /^﻿email,status,first_name/); assert.match(csv.text, /a@x\.co,subscribed,An/);
  // bulk tags + tag counts
  await call('POST', `/aud/lists/${list.id}/tags`, { body: { emails: ['a@x.co'], add: ['vip'], remove: ['import-10'] } });
  assert.deepEqual((await call('GET', `/aud/lists/${list.id}/contacts/a@x.co`)).obj.contact.tags, ['vip']);
  assert.deepEqual((await call('GET', `/aud/lists/${list.id}/tags`)).obj.tags.map((t) => t.tag).sort(), ['import-10', 'vip']);
  // deleting a list needs its name typed back
  assert.equal((await call('DELETE', `/aud/lists/${list.id}?confirm=sai`)).statusCode, 400);
  assert.equal((await call('DELETE', `/aud/lists/${list.id}?confirm=khách lẻ`)).statusCode, 200);
});

test('client workspaces: members see the same lists, viewers cannot write, strangers see nothing', async () => {
  const { call } = harness();
  const list = (await call('POST', '/aud/lists?client=c1', { body: { name: 'Client list' } })).obj.list;
  assert.equal((await call('GET', '/aud/lists?client=c1', { user: U2 })).obj.lists[0].id, list.id, 'viewer reads');
  assert.equal((await call('POST', `/aud/lists/${list.id}/contacts?client=c1`, { user: U2, body: { email: 'x@y.co' } })).statusCode, 403, 'viewer cannot write');
  assert.equal((await call('GET', '/aud/lists?client=c1', { user: U3 })).statusCode, 404, 'stranger');
  assert.equal((await call('GET', '/aud/lists')).obj.lists.length, 0, 'personal scope is separate');
  assert.equal((await call('GET', `/aud/lists/${list.id}/contacts`)).statusCode, 404, 'a client list is not reachable without its client');
});

test('signup form: single opt-in without a sender; double opt-in sends a confirm link; honeypot ignored', async () => {
  const { call, sent } = harness();
  const list = (await call('POST', '/aud/lists', { body: { name: 'Newsletter', company: { name: 'Shop' } } })).obj.list;
  const form = (await call('POST', '/aud/forms', { body: { list: list.id, title: 'Nhận ưu đãi', tags: ['web'], fields: { first_name: true } } })).obj.form;
  assert.match(form.url, /^https:\/\/relay\.test\/f\/[\w-]{12}$/);
  const pageR = await call('GET', `/f/${form.id}`, { user: null });
  assert.match(pageR.text, /Nhận ưu đãi/); assert.match(pageR.text, /name="first_name"/); assert.match(pageR.text, /class="hp"/);
  const sub = await call('POST', `/f/${form.id}`, { user: null, raw: 'email=Lan%40x.co&first_name=Lan', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(sub.statusCode, 200); assert.match(sub.text, /Cảm ơn/);
  let c = (await call('GET', `/aud/lists/${list.id}/contacts/lan@x.co`)).obj.contact;
  assert.equal(c.status, 'subscribed'); assert.deepEqual(c.tags, ['web']); assert.equal(c.consent.method, 'form'); assert.equal(c.consent.ip, '1.2.3.4');
  await call('POST', `/f/${form.id}`, { user: null, raw: 'email=bot%40x.co&hp=spam', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal((await call('GET', `/aud/lists/${list.id}/contacts/bot@x.co`)).statusCode, 404, 'honeypot');
  // with a sender on the list: pending + confirmation email, the link subscribes
  const s = await sender(call);
  await call('PUT', `/aud/lists/${list.id}`, { body: { sender: { id: s.id } } });
  const r = await call('POST', `/f/${form.id}`, { user: null, body: { email: 'minh@x.co' }, raw: JSON.stringify({ email: 'minh@x.co' }), headers: { 'content-type': 'application/json', accept: 'application/json' } });
  assert.equal(r.obj.pending, true);
  assert.equal((await call('GET', `/aud/lists/${list.id}/contacts/minh@x.co`)).obj.contact.status, 'pending');
  const mailMsg = sent.find((m) => m.to === 'minh@x.co');
  assert.ok(mailMsg && /Xác nhận/.test(mailMsg.subject));
  const link = /href="(https:\/\/relay\.test\/f\/[^"]+)"/.exec(mailMsg.html)[1];
  const ok = await call('GET', new URL(link).pathname, { user: null });
  assert.match(ok.text, /Đã xác nhận/);
  c = (await call('GET', `/aud/lists/${list.id}/contacts/minh@x.co`)).obj.contact;
  assert.equal(c.status, 'subscribed'); assert.ok(c.consent.confirmedAt);
  assert.equal((await call('GET', new URL(link).pathname, { user: null })).statusCode, 410, 'a confirm link works once');
});

test('automations: welcome series sends on schedule, tags, stops when the contact leaves', async () => {
  const { call, sent, aud } = harness();
  const s = await sender(call);
  const list = (await call('POST', '/aud/lists', { body: { name: 'L' } })).obj.list;
  const html = '<body>Chào {{first_name|bạn}} <a href="__PHLOEM_CLICK_0__">shop</a> <a href="__PHLOEM_UNSUB__">huỷ</a></body>';
  const a = (await call('POST', '/aud/automations', { body: { name: 'Chào mừng', list: list.id, trigger: { type: 'subscribe' }, sender: { id: s.id }, steps: [
    { type: 'email', subject: 'Chào {{first_name}}', html, links: ['https://shop.vn'] },
    { type: 'tag', delayHours: 1, add: ['welcomed'] },
    { type: 'email', subject: 'Quà cho bạn', html, delayHours: 24, links: ['https://shop.vn/qua'] },
  ] } })).obj.automation;
  assert.equal((await call('POST', `/aud/automations/${a.id}/activate`)).statusCode, 200);
  const t0 = Date.now();
  await call('POST', `/aud/lists/${list.id}/contacts`, { body: { email: 'an@x.co', first_name: 'An' } });
  await call('POST', `/aud/lists/${list.id}/contacts`, { body: { email: 'binh@x.co' } });
  await aud.tick(t0 + 1000);
  assert.deepEqual(sent.map((m) => [m.to, m.subject]), [['an@x.co', 'Chào An'], ['binh@x.co', 'Chào ']]);
  assert.match(sent[0].html, /Chào An/); assert.match(sent[0].html, /https:\/\/relay\.test\/c\//); assert.match(sent[0].headers['List-Unsubscribe'], /relay\.test\/u\//);
  await aud.tick(t0 + 2 * 3600e3);
  assert.deepEqual((await call('GET', `/aud/lists/${list.id}/contacts/an@x.co`)).obj.contact.tags, ['welcomed']);
  // binh unsubscribes through the first email's link before the second email is due
  const tok = makeToken(SECRET, 'u_1', `a_${a.id}_${a.steps[0].id}`, 'binh@x.co');
  await call('POST', `/u/${tok}`, { user: null });
  assert.equal((await call('GET', `/aud/lists/${list.id}/contacts/binh@x.co`)).obj.contact.status, 'unsubscribed');
  await aud.tick(t0 + 27 * 3600e3);
  assert.deepEqual(sent.slice(2).map((m) => m.to), ['an@x.co'], 'only the subscribed contact gets step 3');
  const stats = (await call('GET', '/aud/automations')).obj.automations[0];
  assert.equal(stats.runs.done, 1); assert.equal(stats.runs.stopped, 1);
  assert.equal(stats.steps[0].log.sent, 2); assert.ok(!('html' in stats.steps[0]));
  // opens/clicks land on the contact
  await call('GET', `/o/${makeToken(SECRET, 'u_1', `a_${a.id}_${a.steps[0].id}`, 'an@x.co')}.gif`, { user: null });
  await call('GET', `/c/${makeToken(SECRET, 'u_1', `a_${a.id}_${a.steps[0].id}`, 'an@x.co')}/0`, { user: null });
  const an = (await call('GET', `/aud/lists/${list.id}/contacts/an@x.co`)).obj.contact;
  assert.equal(an.opens, 1); assert.equal(an.clicks, 1);
});

test('birthday automation fires on the day (dd/mm or ISO), once a year', async () => {
  const { call, sent, aud } = harness();
  const s = await sender(call);
  const list = (await call('POST', '/aud/lists', { body: { name: 'L' } })).obj.list;
  const a = (await call('POST', '/aud/automations', { body: { list: list.id, trigger: { type: 'date', field: 'birthday' }, sender: { id: s.id }, steps: [{ type: 'email', subject: 'Mừng sinh nhật {{first_name}}', html: '<b>Quà</b>' }] } })).obj.automation;
  await call('POST', `/aud/automations/${a.id}/activate`);
  await call('POST', `/aud/lists/${list.id}/import`, { body: { attest: true, rows: [{ email: 'b1@x.co', first_name: 'Ba', fields: { birthday: '15/10' } }, { email: 'b2@x.co', fields: { birthday: '1990-03-01' } }] } });
  const day = Date.parse('2026-10-15T03:00:00Z');
  await aud.tick(day); await aud.tick(day + 60e3);
  assert.deepEqual(sent.map((m) => m.to), ['b1@x.co']);
  await aud.tick(day + 3600e3);
  assert.equal(sent.length, 1, 'once');
});

test('list send: segment + merge fields + company footer, opens counted on the contact; bounce webhook stays in scope', async () => {
  const { call, sent, mail } = harness();
  const s = await sender(call);
  const list = (await call('POST', '/aud/lists', { body: { name: 'VIP', company: { name: 'Shop', address: '1 Lê Lợi' } } })).obj.list;
  await call('POST', `/aud/lists/${list.id}/import`, { body: { attest: true, rows: [{ email: 'v1@x.co', first_name: 'Vy', tags: ['vip'] }, { email: 'n1@x.co', tags: ['new'] }, { email: 'v2@x.co', tags: ['vip'] }] } });
  await call('PATCH', `/aud/lists/${list.id}/contacts/v2@x.co`, { body: { status: 'unsubscribed' } });
  const seg = (await call('POST', '/aud/segments', { body: { name: 'VIP', list: list.id, rules: [{ field: 'tag', op: 'has', value: 'vip' }] } })).obj.segment;
  assert.deepEqual((await call('POST', '/aud/preview', { body: { list: list.id, rules: seg.rules } })).obj.count, 1);
  await call('POST', '/mail/campaigns', { body: { id: 'k1', subject: 'Hi', links: ['https://shop.vn'] } });
  const r = await call('POST', '/mail/send', { body: { campaign: 'k1', sender: s.id, subject: 'Ưu đãi cho {{first_name|bạn}}', html: '<body><p>Chào {{first_name}}</p><a href="__PHLOEM_UNSUB__">huỷ</a></body>', audience: { list: list.id, segment: seg.id } } });
  assert.equal(r.obj.recipients, 1);
  await mail.tick();
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'v1@x.co'); assert.equal(sent[0].subject, 'Ưu đãi cho Vy');
  assert.match(sent[0].html, /Chào Vy/); assert.match(sent[0].html, /1 Lê Lợi/);
  await call('GET', `/o/${makeToken(SECRET, 'u_1', 'k1', 'v1@x.co', 'A')}.gif`, { user: null });
  assert.equal((await call('GET', `/aud/lists/${list.id}/contacts/v1@x.co`)).obj.contact.opens, 1);
  const rep = (await call('GET', '/aud/reports')).obj;
  assert.equal(rep.campaigns[0].sent, 1); assert.equal(rep.campaigns[0].list, 'VIP'); assert.equal(rep.growth.length, 30);
  // bounce webhook: wrong token refused; right token suppresses and marks the contact, another account's lists untouched
  const other = (await call('POST', '/aud/lists', { user: U3, body: { name: 'Theirs' } })).obj.list;
  await call('POST', `/aud/lists/${other.id}/contacts`, { user: U3, body: { email: 'n1@x.co' } });
  assert.equal((await call('POST', `/hooks/resend/u_1/${s.id}/wrong`, { user: null, raw: '{}' })).statusCode, 404);
  const hook = new URL(s.webhook).pathname.replace('/hooks/fake/', '/hooks/resend/'); // the test provider stands in for Resend
  const h = await call('POST', hook, { user: null, raw: JSON.stringify({ type: 'email.bounced', data: { to: ['n1@x.co'] } }) });
  assert.equal(h.obj.handled, 1);
  assert.equal((await call('GET', `/aud/lists/${list.id}/contacts/n1@x.co`)).obj.contact.status, 'bounced');
  assert.equal((await call('GET', `/aud/lists/${other.id}/contacts/n1@x.co`, { user: U3 })).obj.contact.status, 'subscribed');
  assert.ok(mail.suppressed('u_1', 'n1@x.co'));
});

test('provider events: Resend, Brevo, SES (SNS) bounces and complaints', () => {
  assert.deepEqual(parseProviderEvents('brevo', { event: 'hard_bounce', email: 'A@x.co' }), [{ email: 'a@x.co', kind: 'bounce' }]);
  assert.deepEqual(parseProviderEvents('brevo', { event: 'soft_bounce', email: 'a@x.co' }), []);
  assert.deepEqual(parseProviderEvents('resend', { type: 'email.complained', data: { to: ['c@x.co'] } }), [{ email: 'c@x.co', kind: 'complaint' }]);
  const sns = { Type: 'Notification', Message: JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'd@x.co' }] } }) };
  assert.deepEqual(parseProviderEvents('ses', sns), [{ email: 'd@x.co', kind: 'bounce' }]);
  assert.deepEqual(parseProviderEvents('ses', { Type: 'Notification', Message: JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'e@x.co' }] } }) }), []);
});

test('orders: the click id in the link ties an order to the exact email; fallbacks and duplicates', async () => {
  const { call, mail } = harness();
  const { parseMoney } = await import('../server/src/audience.mjs');
  assert.equal(parseMoney('1.290.000đ'), 1290000); assert.equal(parseMoney('590,000'), 590000); assert.equal(parseMoney(12.5), 12.5); assert.equal(parseMoney('1.290.000,50'), 1290000.5); assert.equal(parseMoney('12.5'), 12.5);
  const s = await sender(call);
  const list = (await call('POST', '/aud/lists', { body: { name: 'Shop' } })).obj.list;
  await call('POST', `/aud/lists/${list.id}/import`, { body: { attest: true, rows: [{ email: 'mua@x.co', first_name: 'Mua' }, { email: 'xem@x.co' }] } });
  await call('POST', '/mail/campaigns', { body: { id: 'sale10', subject: 'Sale 10.10', links: ['https://shop.vn/sp?utm_source=phloem&utm_medium=email&utm_campaign=sale-10-10#top'] } });
  await call('POST', '/mail/send', { body: { campaign: 'sale10', sender: s.id, subject: 'Sale', html: '<a href="__PHLOEM_CLICK_0__">x</a>', audience: { list: list.id } } });
  await mail.tick();
  // the buyer clicks: the redirect keeps the UTM tags and adds a click id before the #hash
  const c = await call('GET', `/c/${makeToken(SECRET, 'u_1', 'sale10', 'mua@x.co', 'A')}/0`, { user: null });
  assert.equal(c.statusCode, 302);
  const loc = c.headers.location; assert.match(loc, /^https:\/\/shop\.vn\/sp\?utm_source=phloem&utm_medium=email&utm_campaign=sale-10-10&phl=[\w-]{12}#top$/);
  const phl = /phl=([\w-]+)/.exec(loc)[1];
  // the shop installs the tag (a site key for this scope) and reports orders from the thank-you page
  const site = (await call('POST', '/aud/sites', { body: { name: 'shop.vn' } })).obj.site;
  const beacon = (o) => call('POST', '/t/order', { user: null, raw: JSON.stringify({ k: site.key, ...o }) });
  assert.equal((await beacon({ order_id: '#1001', value: '590.000', phl })).obj.ok, true);
  await beacon({ order_id: '#1001', value: '590.000', phl }); // thank-you page reloaded: still one order
  await beacon({ order_id: '#1002', value: 120000, email: 'MUA@x.co' }); // no click id (other device): matched by the buyer's email click
  await beacon({ order_id: '#1003', value: 99000, email: 'walkin@x.co' }); // not from email
  assert.equal((await beacon({ order_id: '#1004', value: 1 })).obj.ok, true, 'unknown buyer still recorded');
  assert.equal((await call('POST', '/t/order', { user: null, raw: JSON.stringify({ k: 'st_wrong', order_id: 'x' }) })).obj.ok, false);
  const gif = await call('GET', `/t/order.gif?k=${site.key}&order_id=%231005&value=50000&phl=${phl}`, { user: null });
  assert.equal(gif.headers['content-type'], 'image/gif');
  const o = (await call('GET', '/aud/orders')).obj;
  assert.equal(o.totals.orders, 5);
  assert.equal(o.totals.emailOrders, 3); assert.equal(o.totals.emailRevenue, 590000 + 120000 + 50000);
  const byId = Object.fromEntries(o.orders.map((x) => [x.orderId, x]));
  assert.equal(byId['#1001'].match, 'click'); assert.equal(byId['#1001'].subject, 'Sale'); assert.equal(byId['#1001'].value, 590000);
  assert.equal(byId['#1002'].match, 'email'); assert.equal(byId['#1003'].match, '');
  assert.ok(byId['#1001'].clickedAt && byId['#1001'].at >= byId['#1001'].clickedAt);
  const rep = (await call('GET', '/aud/reports')).obj;
  assert.equal(rep.campaigns[0].orders, 3); assert.equal(rep.campaigns[0].revenue, 760000);
  // another scope's site key cannot claim this campaign's clicks
  const theirs = (await call('POST', '/aud/sites', { user: U3, body: {} })).obj.site;
  await call('POST', '/t/order', { user: null, raw: JSON.stringify({ k: theirs.key, order_id: 'T1', value: 5, phl }) });
  assert.equal((await call('GET', '/aud/orders', { user: U3 })).obj.orders[0].match, '');
});

test('groups: named tags on the list; a signup form lets people pick only those', async () => {
  const { call } = harness();
  const list = (await call('POST', '/aud/lists', { body: { name: 'Gốm', groups: [{ name: 'Đồ gốm' }, { name: 'Nến thơm', tag: 'nen' }, { name: 'Đồ gốm' }] } })).obj.list;
  assert.deepEqual(list.groups, [{ name: 'Đồ gốm', tag: 'do-gom' }, { name: 'Nến thơm', tag: 'nen' }]);
  const form = (await call('POST', '/aud/forms', { body: { list: list.id, fields: { groups: true }, groupsLabel: 'Bạn thích gì?' } })).obj.form;
  const html = (await call('GET', `/f/${form.id}`, { user: null })).text;
  assert.match(html, /Bạn thích gì\?/); assert.match(html, /name="group" value="do-gom"/); assert.match(html, /Nến thơm/);
  await call('POST', `/f/${form.id}`, { user: null, raw: 'email=g%40x.co&group=nen&group=hack', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.deepEqual((await call('GET', `/aud/lists/${list.id}/contacts/g@x.co`)).obj.contact.tags, ['nen'], 'unknown groups are ignored');
});

test('per-person campaign report: who opened, which link, what they bought; browser sends are named too', async () => {
  const { call, mail } = harness();
  const { orderKind } = await import('../server/src/audience.mjs');
  assert.equal(orderKind('Dịch vụ'), 'service'); assert.equal(orderKind('đặt lịch'), 'service'); assert.equal(orderKind('product'), 'product'); assert.equal(orderKind('hàng'), 'product'); assert.equal(orderKind('x'), '');
  const s = await sender(call);
  const list = (await call('POST', '/aud/lists', { body: { name: 'Shop' } })).obj.list;
  await call('POST', `/aud/lists/${list.id}/import`, { body: { attest: true, rows: [{ email: 'mua@x.co', first_name: 'Mua', last_name: 'Lê' }, { email: 'xem@x.co' }, { email: 'im@x.co' }] } });
  await call('POST', '/mail/campaigns', { body: { id: 'sale10', subject: 'Sale', links: ['https://shop.vn/spa?utm_content=dat-lich', 'https://shop.vn/sale'] } });
  await call('POST', '/mail/send', { body: { campaign: 'sale10', sender: s.id, subject: 'Sale', html: '<a href="__PHLOEM_CLICK_0__">x</a>', audience: { list: list.id } } });
  await mail.tick();
  const tok = (e) => makeToken(SECRET, 'u_1', 'sale10', e, '');
  await call('GET', `/o/${tok('xem@x.co')}.gif`, { user: null });
  await call('GET', `/o/${tok('mua@x.co')}.gif`, { user: null });
  const loc = (await call('GET', `/c/${tok('mua@x.co')}/0`, { user: null })).headers.location;
  const phl = /phl=([\w-]+)/.exec(loc)[1];
  const site = (await call('POST', '/aud/sites', { body: { name: 'shop.vn' } })).obj.site;
  const beacon = (o) => call('POST', '/t/order', { user: null, raw: JSON.stringify({ k: site.key, ...o }) });
  await beacon({ order_id: 'B1', value: '590.000', phl, kind: 'dịch vụ', items: [{ name: 'Gói spa 60 phút' }] }); // booked a service, no email given
  await beacon({ order_id: 'B2', value: 120000, email: 'MUA@x.co', kind: 'hàng', items: 'Kem dưỡng' });
  const r = (await call('GET', '/mail/campaigns/sale10/people')).obj;
  assert.equal(r.campaign.subject, 'Sale'); assert.equal(r.campaign.via, 'server');
  assert.equal(r.totals.totalOpens, 2); assert.equal(r.totals.totalClicks, 1);
  assert.ok(r.timeline.length >= 1 && r.timeline.every((t) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(t.h)));
  assert.equal(r.timeline.reduce((a, t) => a + t.openers, 0), 2); assert.equal(r.timeline.reduce((a, t) => a + t.clicks, 0), 1);
  assert.deepEqual({ ...r.totals, unknownOpens: 0, unknownClicks: 0, totalOpens: 0, totalClicks: 0 }, { totalOpens: 0, totalClicks: 0, recipients: 3, opened: 2, clicked: 1, buyers: 1, orders: 2, revenue: 710000, unsubscribed: 0, bounced: 0, failed: 0, unknownOpens: 0, unknownClicks: 0 });
  const by = Object.fromEntries(r.people.map((x) => [x.email, x]));
  assert.equal(by['mua@x.co'].name, 'Mua Lê'); assert.equal(by['mua@x.co'].opens, 1); assert.equal(by['mua@x.co'].links[0].url, 'https://shop.vn/spa?utm_content=dat-lich');
  assert.deepEqual(by['mua@x.co'].orders.map((o) => [o.orderId, o.kind, o.items, o.value]).sort(), [['B1', 'service', 'Gói spa 60 phút', 590000], ['B2', 'product', 'Kem dưỡng', 120000]]);
  assert.equal(by['mua@x.co'].orders.find((o) => o.orderId === 'B1').link, 0, 'the order remembers which link sold it');
  assert.equal(by['xem@x.co'].opens, 1); assert.equal(by['xem@x.co'].clicks, 0); assert.equal(by['im@x.co'].opens, 0); assert.equal(by['im@x.co'].status, 'sent');
  const st = (await call('GET', '/mail/campaigns/sale10/stats')).obj;
  assert.equal(st.orders, 2); assert.equal(st.revenue, 710000); assert.equal(st.buyers, 1);
  assert.equal((await call('GET', '/mail/campaigns/sale10/people', { user: U3 })).statusCode, 404, 'only the sender sees its recipients');
  // a Gmail send from the browser: recipients are recorded when their tokens are issued
  await call('POST', '/mail/campaigns', { body: { id: 'g1', via: 'gmail', subject: 'Bản tin', links: ['https://shop.vn'] } });
  await call('POST', '/mail/tokens', { body: { campaign: 'g1', emails: ['A@b.co', 'c@d.co'] } });
  await call('GET', `/o/${makeToken(SECRET, 'u_1', 'g1', 'a@b.co', '')}.gif`, { user: null });
  const g = (await call('GET', '/mail/campaigns/g1/people')).obj;
  assert.equal(g.campaign.via, 'gmail'); assert.equal(g.totals.recipients, 2); assert.equal(g.totals.opened, 1);
  const rep = (await call('GET', '/aud/reports')).obj;
  const gr = rep.campaigns.find((c) => c.id === 'g1'); assert.equal(gr.via, 'gmail'); assert.equal(gr.sent, 2); assert.equal(gr.opens, 1);
  assert.equal(rep.campaigns.find((c) => c.id === 'sale10').buyers, 1);
});
