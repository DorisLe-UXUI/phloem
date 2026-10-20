// E2E: local relay (:8787) -> local SMTP Worker in workerd (:8788) -> fake SMTP mailbox (:2525).
// Exercises the exact production path for a Titan / any-SMTP mailbox: save, verify (right + wrong
// password), test send, a 3-recipient campaign through the queue, a broken-password channel.
// Run (four terminals, from the repo root):
//   node tools/smtp-worker/e2e/fake-smtp.mjs /tmp/phloem-smtp-got.json
//   (cd a scratch copy of tools/smtp-worker) npx wrangler@4 dev --port 8788 --ip 127.0.0.1 --local --var RELAY:http://127.0.0.1:8787 --var ALLOW_PLAIN:1
//   SMTP_BRIDGE_URL=http://127.0.0.1:8788/send SMTP_ALLOW_PLAIN=1 node server/src/index.mjs
//   node tools/smtp-worker/e2e/run.mjs /tmp/phloem-smtp-got.json
// Plain SMTP (no TLS) is allowed only by those two dev flags, because the fake mailbox has no certificate.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const R = 'http://127.0.0.1:8787';
const GOT = process.argv[2];
const results = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
const api = async (path, opts = {}) => {
  const r = await fetch(R + path, { method: opts.body ? 'POST' : opts.method || 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { ...j, http: r.status };
};
const all = () => { try { return JSON.parse(readFileSync(GOT, 'utf8')); } catch { return []; } };
const base = all().length; // the fake server keeps earlier runs in memory
const got = () => all().slice(base);

// 1. a throwaway account on the LOCAL relay
const email = `e2e-${randomBytes(3).toString('hex')}@phloem.local`;
const reg = await api('/auth/register', { body: { email, password: randomBytes(12).toString('base64url'), name: 'E2E' } });
token = reg.token; ok('local account', !!token, reg.error || email);

// 2. a Titan-style mailbox (plain on 2525 only because the fake server has no TLS; dev-only flag)
const box = { provider: 'smtp', preset: 'custom', host: 'lvh.me', port: 2525, secure: 'none', fromEmail: 'test@lvh.me', fromName: 'Phloem Sentry Việt Nam', username: 'test@lvh.me', password: 'right-pass' };
const sv = await api('/mail/senders', { body: box });
const sid = sv.sender?.id; ok('save mailbox', !!sid, sv.error || sid);

// 3. Kiểm tra đăng nhập: saved password, then a wrong one
const v1 = await api('/mail/smtp/verify', { body: { id: sid } });
ok('verify right password (via Worker)', v1.ok === true, JSON.stringify(v1));
const v2 = await api('/mail/smtp/verify', { body: { host: 'lvh.me', port: 2525, secure: 'none', username: 'test@lvh.me', password: 'wrong-pass' } });
ok('verify wrong password is refused', v2.ok === false && /535|auth|đăng nhập|mật khẩu/i.test(v2.error || ''), v2.error);
ok('verify sent no mail', got().length === 0, `${got().length} msgs`);

// 4. test send
const t1 = await api(`/mail/senders/${sid}/test`, { body: { to: 'khach.test@example.com' } });
ok('test send', t1.ok === true, JSON.stringify(t1));
await sleep(300);
const g1 = got();
ok('test send arrived authed', g1.length === 1 && g1[0].authed && /khach\.test@example\.com/.test(g1[0].to.join()), JSON.stringify(g1.map((m) => ({ authed: m.authed, to: m.to }))));

// 5. a campaign through the server queue
const cid = `q_e2e${randomBytes(3).toString('hex')}`;
const rc = await api('/mail/campaigns', { body: { id: cid, subject: 'Ưu đãi tháng 10 — Sentry', via: 'server', project: 'e2e', links: ['https://sentryxp.com/?utm_source=phloem'], labels: ['Xem ưu đãi'] } });
ok('register campaign', rc.ok, rc.error);
const html = `<!doctype html><html><body><h1>Chào {{first_name|bạn}} ơi,</h1><p>Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ — đ Đ.</p>\n.<p>dòng bắt đầu bằng dấu chấm</p>\n<a href="__PHLOEM_CLICK_0__">Xem ưu đãi</a><p>Số 1 Lê Duẩn, Q1, TP.HCM · <a href="__PHLOEM_UNSUB__">Huỷ đăng ký</a></p></body></html>`;
const rcpts = ['an@example.com', 'binh@example.com', 'chi@example.com'];
const s1 = await api('/mail/send', { body: { campaign: cid, sender: sid, recipients: rcpts, subject: 'Ưu đãi tháng 10 — Sentry', html, text: 'Chào bạn\n.dòng chấm\nXem ưu đãi: https://sentryxp.com' } });
ok('queue campaign', s1.ok && s1.recipients === 3, JSON.stringify(s1));

let st = {};
for (let i = 0; i < 40; i++) { st = await api(`/mail/campaigns/${cid}/stats`); if (st.send?.status === 'done' || st.send?.status === 'error') break; await sleep(2000); }
ok('queue delivered 3/3', st.queue?.sent === 3, JSON.stringify({ queue: st.queue, status: st.send?.status, err: st.send?.lastError }));
ok('campaign marked done', st.send?.status === 'done', st.send?.status);

const camp = got().slice(1, 4);
ok('fake mailbox got 3 campaign mails', camp.length === 3, `${camp.length}`);
const toSet = new Set(camp.flatMap((m) => m.to.map((x) => x.replace(/[<>]/g, ''))));
ok('one mail per recipient', rcpts.every((r) => toSet.has(r)), [...toSet].join(','));
ok('all authed', camp.every((m) => m.authed && m.user === 'test@lvh.me'));
for (const [i, m] of camp.entries()) {
  const raw = m.msg.replace(/\r\n\.\./g, '\r\n.'); // undo dot-stuffing as a real server does
  const hdr = raw.split('\r\n\r\n')[0];
  const subj = /^Subject: (.*)$/m.exec(hdr)?.[1] || '';
  const dec = subj.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8')).replace(/\s+/g, ' ');
  const from = /^From: (.*)$/m.exec(hdr)?.[1] || '';
  const fromDec = from.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  const parts = [...raw.matchAll(/Content-Type: text\/(plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((x) => [x[1], Buffer.from(x[2].replace(/\r\n/g, ''), 'base64').toString('utf8')]);
  const htmlPart = parts.find((p) => p[0] === 'html')?.[1] || '';
  const textPart = parts.find((p) => p[0] === 'plain')?.[1] || '';
  if (i === 0) writeFileSync(GOT.replace('.json', '-sample.html'), htmlPart);
  ok(`#${i + 1} subject decodes`, dec.includes('Ưu đãi tháng 10 — Sentry'), dec);
  ok(`#${i + 1} From name + address`, fromDec.includes('Phloem Sentry Việt Nam') && from.includes('<test@lvh.me>'), fromDec);
  ok(`#${i + 1} Vietnamese body intact`, htmlPart.includes('ắ ằ ẳ ẵ ặ — đ Đ'), htmlPart.slice(0, 80));
  ok(`#${i + 1} merge tag filled`, /Chào bạn ơi/.test(htmlPart) && !htmlPart.includes('{{'), /<h1>[^<]*<\/h1>/.exec(htmlPart)?.[0]);
  ok(`#${i + 1} dot line survives`, htmlPart.includes('\n.<p>dòng') && textPart.includes('\n.dòng'), '');
  ok(`#${i + 1} link tracked`, /\/c\/[^"]+/.test(htmlPart) && !htmlPart.includes('href="https://sentryxp.com'), /href="([^"]+)"/.exec(htmlPart)?.[1]?.slice(0, 70));
  ok(`#${i + 1} open pixel`, /\/o\/[^"]+/.test(htmlPart));
  ok(`#${i + 1} List-Unsubscribe`, /^List-Unsubscribe: <http/m.test(hdr) && /^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m.test(hdr), /^List-Unsubscribe: (.*)$/m.exec(hdr)?.[1]?.slice(0, 60));
}

// 6. a mailbox with a wrong password: the campaign must stop with a clear error and the channel flagged
const bad = await api('/mail/senders', { body: { ...box, label: 'Titan sai mật khẩu', password: 'wrong-pass' } });
const bid = bad.sender?.id;
const cid2 = `q_e2e${randomBytes(3).toString('hex')}`;
await api('/mail/campaigns', { body: { id: cid2, subject: 'sai mật khẩu', via: 'server' } });
const s2 = await api('/mail/send', { body: { campaign: cid2, sender: bid, recipients: ['x@example.com', 'y@example.com'], subject: 'sai', html: '<p>x</p>' } });
ok('queue on bad mailbox accepted', s2.ok, JSON.stringify(s2));
let st2 = {};
for (let i = 0; i < 30; i++) { st2 = await api(`/mail/campaigns/${cid2}/stats`); if (st2.send?.status === 'error' || st2.send?.lastError) break; await sleep(2000); }
ok('bad password stops campaign with error', !!st2.send?.lastError && (st2.queue?.sent || 0) === 0, JSON.stringify({ status: st2.send?.status, err: st2.send?.lastError?.slice(0, 120), queue: st2.queue }));
const list = await api('/mail/senders');
const bs = list.senders?.find((x) => x.id === bid);
ok('bad mailbox flagged broken', bs?.health && bs.health.ok === false, JSON.stringify(bs?.health));
const s3 = await api('/mail/send', { body: { campaign: cid2, sender: bid, recipients: ['z@example.com'], subject: 'sai', html: '<p>x</p>' } });
ok('new send on broken mailbox refused (409)', s3.http === 409, s3.error?.slice(0, 80));
// Đổi kênh: resume the stuck campaign on the good mailbox
const rs = await api(`/mail/send/${cid2}/resume`, { body: { sender: sid } });
ok('resume on another mailbox', rs.ok === true && rs.http === 200, JSON.stringify(rs).slice(0, 120));
for (let i = 0; i < 30; i++) { st2 = await api(`/mail/campaigns/${cid2}/stats`); if ((st2.queue?.sent || 0) >= 2) break; await sleep(2000); }
ok('switched campaign delivered 2/2', st2.queue?.sent === 2, JSON.stringify(st2.queue));
const sch = await api('/mail/schedule');
ok('schedule board lists both', [cid, cid2].every((id) => sch.items?.some((x) => x.id === id)), `${sch.items?.length} items`);

const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
writeFileSync(GOT.replace('.json', '-results.json'), JSON.stringify(results, null, 1));
process.exit(fails.length ? 1 : 0);
