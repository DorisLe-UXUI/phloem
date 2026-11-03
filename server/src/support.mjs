// Customer care ("Hỗ trợ" bubble): people send a bug / idea / question from any screen, signed in or not; every
// ticket is a thread kept here, mailed to the admins (Reply-To = the customer, so a reply from the inbox reaches them),
// answered from Database → Hỗ trợ (the answer is mailed to the customer and shows in their bubble).
//
//   POST /support                       new ticket {kind, message, email?, name?, image?, meta?}; guests get a key
//   GET  /support/mine?keys=id.key,…    my tickets with their messages (signed in: by account; guests: by key)
//   POST /support/:id/reply|read|rate   the customer's follow-up, "seen", 👍/👎 once it is done
//   GET  /admin/support[?status=]       admin inbox (+ counts, notification settings)
//   GET  /admin/support/:id             one thread (marks it read)
//   POST /admin/support/:id/reply       answer {message, close?}; /status {status}
//   POST /admin/support/settings        which mailbox sends the notifications {sender}
//   POST /admin/support/test            a test notification to the admins
//   GET  /admin/support.csv             every ticket, for a spreadsheet
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const KINDS = { bug: 'Báo lỗi', idea: 'Góp ý', help: 'Cần hỗ trợ', other: 'Khác' };
export const STATUSES = ['new', 'open', 'done', 'spam'];
const STATUS_VI = { new: 'Mới', open: 'Đang xử lý', done: 'Xong', spam: 'Rác' };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE = 1_400_000; // chars of data URL (~1 MB picture): the studio shrinks screenshots before sending
const META_KEYS = ['app', 'route', 'url', 'project', 'projectName', 'version', 'ua', 'screen', 'lang', 'relay', 'errors'];
const now = () => new Date().toISOString();
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The meta block the studio attaches (screen, email, browser): known keys only, short strings. */
export function cleanMeta(m) {
  const out = {};
  if (!m || typeof m !== 'object') return out;
  for (const k of META_KEYS) {
    const v = m[k]; if (v == null || v === '') continue;
    out[k] = k === 'errors' ? (Array.isArray(v) ? v.slice(-5).map((x) => String(x).slice(0, 300)) : []) : String(v).slice(0, 300);
  }
  return out;
}

/** A plain, readable notification email (no tracking, no images). */
export function mailHtml(title, lines, button) {
  const body = lines.filter(Boolean).map((l) => (typeof l === 'string' ? `<p style="margin:0 0 12px">${esc(l).replace(/\n/g, '<br>')}</p>` : l.html)).join('');
  const btn = button ? `<p style="margin:20px 0 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:999px">${esc(button.label)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5f3"><div style="max-width:560px;margin:0 auto;padding:24px 16px;font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#141714"><div style="background:#fff;border-radius:14px;padding:24px"><div style="font:600 12px/1 ui-monospace,Menlo,monospace;color:#2f9e44;letter-spacing:.06em;margin-bottom:10px">PHLOEM · HỖ TRỢ</div><h1 style="font-size:19px;margin:0 0 14px">${esc(title)}</h1>${body}${btn}</div><p style="color:#8a918c;font-size:12px;margin:12px 4px 0">Phloem Email · thư tự động từ hộp hỗ trợ</p></div></body></html>`;
}
const quote = (t) => ({ html: `<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid #2f9e44;background:#f4f7f4;border-radius:6px;white-space:pre-wrap">${esc(t)}</blockquote>` });

export function createSupport({ raw, json, body, throttled = () => false, ipOf = () => '', userOf, adminOf, mail = null, adminEmails = [], resendKey = '', resendFrom = '', appUrl = '', log = console.log }) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY, owner TEXT, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', subject TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', key TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_by TEXT NOT NULL DEFAULT 'user',
      admin_unread INTEGER NOT NULL DEFAULT 1, user_unread INTEGER NOT NULL DEFAULT 0,
      mailed TEXT NOT NULL DEFAULT '', rating INTEGER, rated_at TEXT);
    CREATE INDEX IF NOT EXISTS support_by_owner ON support_tickets(owner, updated_at);
    CREATE INDEX IF NOT EXISTS support_by_status ON support_tickets(status, updated_at);
    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY, ticket TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL, image TEXT, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS support_msg_by_ticket ON support_messages(ticket, at);
    CREATE TABLE IF NOT EXISTS support_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  const q = (s) => raw.prepare(s);
  const S = {
    add: q('INSERT INTO support_tickets (id, owner, email, name, kind, status, subject, meta, key, created_at, updated_at, last_by, admin_unread, user_unread) VALUES (?, ?, ?, ?, ?, \'new\', ?, ?, ?, ?, ?, \'user\', 1, 0)'),
    get: q('SELECT * FROM support_tickets WHERE id = ?'),
    mine: q('SELECT * FROM support_tickets WHERE owner = ? AND status <> \'spam\' ORDER BY updated_at DESC LIMIT 30'),
    list: q('SELECT t.*, (SELECT COUNT(*) FROM support_messages m WHERE m.ticket = t.id) AS n FROM support_tickets t ORDER BY t.updated_at DESC LIMIT 500'),
    counts: q('SELECT status, COUNT(*) AS n, SUM(admin_unread) AS unread FROM support_tickets GROUP BY status'),
    msgAdd: q('INSERT INTO support_messages (id, ticket, author, name, body, image, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    msgs: q('SELECT id, author, name, body, image, at FROM support_messages WHERE ticket = ? ORDER BY at, id'),
    last: q('SELECT author, body, at FROM support_messages WHERE ticket = ? ORDER BY at DESC, id DESC LIMIT 1'),
    firstUser: q('SELECT body FROM support_messages WHERE ticket = ? AND author = \'user\' ORDER BY at, id LIMIT 1'),
    touchUser: q('UPDATE support_tickets SET updated_at = ?, last_by = \'user\', admin_unread = 1, status = CASE WHEN status IN (\'done\', \'spam\') THEN \'open\' ELSE status END WHERE id = ?'),
    touchAdmin: q('UPDATE support_tickets SET updated_at = ?, last_by = \'admin\', user_unread = 1, admin_unread = 0, status = ? WHERE id = ?'),
    status: q('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?'),
    adminRead: q('UPDATE support_tickets SET admin_unread = 0 WHERE id = ?'),
    userRead: q('UPDATE support_tickets SET user_unread = 0 WHERE id = ?'),
    mailed: q('UPDATE support_tickets SET mailed = ? WHERE id = ?'),
    rate: q('UPDATE support_tickets SET rating = ?, rated_at = ? WHERE id = ?'),
    setGet: q('SELECT v FROM support_settings WHERE k = ?'),
    setPut: q('INSERT INTO support_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
  };
  const setting = (k) => { try { return JSON.parse(S.setGet.get(k)?.v || 'null'); } catch { return null; } };
  const newId = (p) => `${p}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const link = (hash) => `${String(appUrl || '').replace(/#.*$/, '')}${hash}`;
  const pending = new Set(); // notification sends in flight (tests wait for them)
  const later = (p) => { const x = p.catch((e) => log('[support] mail:', e?.message || e)).finally(() => pending.delete(x)); pending.add(x); return x; };

  /** One notification email: through the admin-chosen mailbox, else Resend (env), else nowhere. */
  async function send({ to, subject, html, text, replyTo }) {
    const via = setting('sender');
    if (via?.owner && via?.id && mail?.notify) return mail.notify(via.owner, via.id, { to, subject, html, text, replyTo });
    if (resendKey) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: resendFrom || 'Phloem Email <onboarding@resend.dev>', to: [to], subject, html, text, reply_to: replyTo || undefined }), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Resend ${r.status}`);
      return;
    }
    throw Object.assign(new Error('chưa chọn hộp mail gửi thông báo'), { off: true });
  }
  const channel = () => { const via = setting('sender'); return via?.id ? 'mailbox' : resendKey ? 'resend' : ''; };
  async function toAdmins(t, msg, first) {
    if (!adminEmails.length) return 'off';
    const kind = KINDS[t.kind] || t.kind;
    const subject = `[Phloem hỗ trợ] ${first ? kind : 'Trả lời'}: ${t.subject}`.slice(0, 160);
    const meta = (() => { try { return JSON.parse(t.meta || '{}'); } catch { return {}; } })();
    const tech = [meta.app && `App: ${meta.app}`, meta.route && `Màn hình: ${meta.route}`, meta.projectName && `Email đang mở: ${meta.projectName}`, meta.version && `Bản: ${meta.version}`, meta.screen && `Màn hình máy: ${meta.screen}`, meta.ua && `Trình duyệt: ${meta.ua}`, meta.errors?.length ? `Lỗi gần nhất: ${meta.errors.join(' | ')}` : ''].filter(Boolean).join('\n');
    const who = `${t.name || 'Khách'} <${t.email}>${t.owner ? '' : ' (chưa đăng nhập)'}`;
    const html = mailHtml(`${first ? `${kind} mới` : 'Khách trả lời'} từ ${t.name || t.email}`, [`${who} · ${STATUS_VI[t.status] || t.status}`, quote(msg.body), msg.image ? 'Có ảnh chụp màn hình đính kèm: xem trong Database → Hỗ trợ.' : '', first && tech ? { html: `<p style="margin:0 0 12px;color:#6b726d;font-size:13px;white-space:pre-wrap">${esc(tech)}</p>` } : '', 'Bấm Trả lời trong hộp thư này là thư tới thẳng khách; hoặc trả lời trong Phloem để lưu vào lịch sử hỗ trợ.'], { label: 'Mở trong Phloem', url: link(`#/admin/ho-tro/${t.id}`) });
    const text = `${who}\n\n${msg.body}\n\n${first && tech ? `${tech}\n\n` : ''}Mở: ${link(`#/admin/ho-tro/${t.id}`)}`;
    for (const to of adminEmails) await send({ to, subject, html, text, replyTo: t.email });
    return 'ok';
  }
  async function toCustomer(t, msg) {
    const subject = `Phloem trả lời: ${t.subject}`.slice(0, 160);
    const first = S.msgs.all(t.id).find((m) => m.author === 'user');
    const open = link(`#/ho-tro/${t.id}/${t.key}`);
    const html = mailHtml(`Chào ${t.name || 'bạn'}, Phloem đã trả lời`, [quote(msg.body), first ? { html: `<p style="margin:16px 0 6px;color:#6b726d;font-size:13px">Bạn đã gửi:</p><p style="margin:0 0 12px;color:#6b726d;font-size:13px;white-space:pre-wrap">${esc(first.body.slice(0, 600))}</p>` } : '', 'Trả lời thẳng email này, hoặc mở Phloem để xem toàn bộ trao đổi.'], { label: 'Xem trong Phloem', url: open });
    const text = `${msg.body}\n\n---\nBạn đã gửi: ${first ? first.body.slice(0, 600) : ''}\n\nXem trong Phloem: ${open}`;
    await send({ to: t.email, subject, html, text, replyTo: adminEmails[0] || '' });
    return 'ok';
  }
  const mailedAs = (id, p) => later(p.then((r) => S.mailed.run(r || 'ok', id), (e) => { S.mailed.run(e?.off ? 'off' : `lỗi: ${String(e?.message || e).slice(0, 160)}`, id); throw e; }));

  const view = (t, withMsgs = true) => {
    let meta = {}; try { meta = JSON.parse(t.meta || '{}'); } catch { /* old row */ }
    const last = S.last.get(t.id);
    return { id: t.id, kind: t.kind, status: t.status, subject: t.subject, email: t.email, name: t.name, owner: t.owner || null, createdAt: t.created_at, updatedAt: t.updated_at, lastBy: t.last_by, adminUnread: !!t.admin_unread, userUnread: !!t.user_unread, mailed: t.mailed, rating: t.rating ?? null, meta, count: t.n ?? undefined, last: last ? { author: last.author, body: last.body.slice(0, 200), at: last.at } : null, ...(withMsgs ? { messages: S.msgs.all(t.id) } : {}) };
  };
  const canSee = (t, user, key) => !!t && ((user && t.owner === user.id) || (key && same(key, t.key)));
  const text = (v, max = 5000) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
  const image = (v) => (v && typeof v === 'string' && v.length <= MAX_IMAGE && IMAGE_RE.test(v) ? v : null);

  async function handle(url, req, res) {
    const p = url.pathname, m = req.method;
    if (p === '/admin/support' || p.startsWith('/admin/support/') || p === '/admin/support.csv') return admin(url, req, res);
    if (p !== '/support' && !p.startsWith('/support/')) return false;
    const user = userOf(req);
    if (p === '/support' && m === 'POST') {
      const b = await body(req);
      if (b?.website) { json(res, 200, { ok: true }); return true; } // honeypot: bots fill every field
      if (throttled(user ? `sup:u:${user.id}` : `sup:${ipOf(req)}`, user ? 30 : 8, 3600e3)) { json(res, 429, { error: 'Bạn đã gửi nhiều lần trong 1 giờ. Đợi một chút rồi gửi tiếp nhé.' }); return true; }
      const msg = text(b?.message); if (msg.length < 3) { json(res, 400, { error: 'Viết vài chữ để mình hiểu vấn đề nhé.' }); return true; }
      const email = (user?.email || String(b?.email || '')).trim().toLowerCase().slice(0, 200);
      if (!EMAIL_RE.test(email)) { json(res, 400, { error: 'Cần email để Phloem trả lời bạn.' }); return true; }
      const kind = KINDS[b?.kind] ? b.kind : 'other';
      const id = newId('t'), key = randomBytes(16).toString('base64url'), at = now();
      const name = text(user?.name || b?.name, 120);
      const subject = msg.split('\n').find((l) => l.trim())?.trim().slice(0, 90) || KINDS[kind];
      S.add.run(id, user?.id || null, email, name, kind, subject, JSON.stringify(cleanMeta(b?.meta)), key, at, at);
      const mm = { id: newId('m'), body: msg, image: image(b?.image) };
      S.msgAdd.run(mm.id, id, 'user', name, mm.body, mm.image, at);
      void mailedAs(id, toAdmins(S.get.get(id), mm, true));
      json(res, 200, { ok: true, id, key, ticket: view(S.get.get(id)) }); return true;
    }
    if (p === '/support/mine' && m === 'GET') {
      const keys = String(url.searchParams.get('keys') || '').split(',').map((x) => x.split('.')).filter((x) => x[0] && x[1]).slice(0, 30);
      const seen = new Map();
      if (user) for (const t of S.mine.all(user.id)) seen.set(t.id, t);
      for (const [id, key] of keys) { const t = S.get.get(id); if (t && !seen.has(id) && canSee(t, null, key) && t.status !== 'spam') seen.set(id, t); }
      const tickets = [...seen.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map((t) => view(t));
      json(res, 200, { tickets, unread: tickets.filter((t) => t.userUnread).length, admin: adminEmails[0] || '' }); return true;
    }
    const one = /^\/support\/([A-Za-z0-9_]+)\/(reply|read|rate)$/.exec(p);
    if (one && m === 'POST') {
      const b = await body(req); const t = S.get.get(one[1]);
      if (!canSee(t, user, b?.key)) { json(res, 404, { error: 'Không tìm thấy yêu cầu hỗ trợ này.' }); return true; }
      if (one[2] === 'read') { S.userRead.run(t.id); json(res, 200, { ok: true }); return true; }
      if (one[2] === 'rate') { const r = Number(b?.rating); if (![1, -1].includes(r)) { json(res, 400, { error: 'rating 1 hoặc -1' }); return true; } S.rate.run(r, now(), t.id); json(res, 200, { ok: true, ticket: view(S.get.get(t.id)) }); return true; }
      if (throttled(`supr:${t.id}`, 20, 3600e3)) { json(res, 429, { error: 'Gửi nhiều quá, đợi một chút nhé.' }); return true; }
      const msg = text(b?.message); if (msg.length < 1) { json(res, 400, { error: 'Tin nhắn trống.' }); return true; }
      const at = now(); const mm = { id: newId('m'), body: msg, image: image(b?.image) };
      S.msgAdd.run(mm.id, t.id, 'user', t.name, mm.body, mm.image, at); S.touchUser.run(at, t.id); S.userRead.run(t.id);
      void mailedAs(t.id, toAdmins(S.get.get(t.id), mm, false));
      json(res, 200, { ok: true, ticket: view(S.get.get(t.id)) }); return true;
    }
    json(res, 404, { error: 'not found' }); return true;
  }

  async function admin(url, req, res) {
    const p = url.pathname, m = req.method;
    const me = adminOf(req);
    if (!me) { json(res, userOf(req) ? 403 : 401, { error: 'Chỉ quản trị viên.', ...(userOf(req) ? {} : { code: 'expired' }) }); return true; }
    if (p === '/admin/support' && m === 'GET') {
      const want = url.searchParams.get('status') || 'active';
      const all = S.list.all();
      const rows = all.filter((t) => (want === 'all' ? true : want === 'active' ? ['new', 'open'].includes(t.status) : t.status === want));
      const counts = { new: 0, open: 0, done: 0, spam: 0, unread: 0 }; for (const r of S.counts.all()) { counts[r.status] = r.n; if (r.status !== 'spam') counts.unread += Number(r.unread) || 0; }
      const via = setting('sender');
      json(res, 200, { tickets: rows.map((t) => view(t, false)), counts, settings: { sender: via?.owner === me.id ? via.id : via?.id ? 'other' : '', senderOwner: via?.owner === me.id ? 'me' : via?.id ? 'other admin' : '', channel: channel(), admins: adminEmails, senders: mail?.senderIds ? mail.senderIds(me.id) : [] } }); return true;
    }
    if (p === '/admin/support.csv' && m === 'GET') {
      const head = ['id', 'tạo lúc', 'cập nhật', 'loại', 'trạng thái', 'tên', 'email', 'tài khoản', 'tiêu đề', 'số tin', 'tin cuối của', 'đánh giá', 'màn hình', 'email đang mở', 'nội dung đầu'];
      const lines = [head.join(',')];
      for (const t of S.list.all()) {
        const v = view(t, false); const first = S.firstUser.get(t.id);
        lines.push([v.id, v.createdAt, v.updatedAt, KINDS[v.kind] || v.kind, STATUS_VI[v.status] || v.status, v.name, v.email, v.owner || '', v.subject, t.n, v.lastBy === 'admin' ? 'admin' : 'khách', v.rating === 1 ? 'hài lòng' : v.rating === -1 ? 'chưa hài lòng' : '', v.meta.route || '', v.meta.projectName || '', first?.body || ''].map(csvCell).join(','));
      }
      res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="phloem-ho-tro-${now().slice(0, 10)}.csv"`);
      res.end('﻿' + lines.join('\r\n')); return true;
    }
    if (p === '/admin/support/settings' && m === 'POST') {
      const b = await body(req); const id = String(b?.sender || '');
      if (!id) { S.setPut.run('sender', 'null'); json(res, 200, { ok: true, channel: channel() }); return true; }
      if (!mail?.senderIds?.(me.id).some((x) => x.id === id)) { json(res, 404, { error: 'Không có hộp mail này trong tài khoản của bạn.' }); return true; }
      S.setPut.run('sender', JSON.stringify({ owner: me.id, id })); json(res, 200, { ok: true, channel: channel() }); return true;
    }
    if (p === '/admin/support/test' && m === 'POST') {
      try {
        if (!adminEmails.length) throw new Error('chưa có email admin (ADMIN_EMAILS)');
        for (const to of adminEmails) await send({ to, subject: 'Phloem hỗ trợ: thư thử', html: mailHtml('Thông báo hỗ trợ hoạt động', ['Góp ý và yêu cầu hỗ trợ mới sẽ về hộp thư này.']), text: 'Thông báo hỗ trợ hoạt động.' });
        json(res, 200, { ok: true, to: adminEmails });
      } catch (e) { json(res, e?.off ? 400 : 502, { error: e?.off ? 'Chưa chọn hộp mail gửi thông báo.' : String(e?.message || e) }); }
      return true;
    }
    const one = /^\/admin\/support\/([A-Za-z0-9_]+)(?:\/(reply|status))?$/.exec(p);
    if (one) {
      const t = S.get.get(one[1]); if (!t) { json(res, 404, { error: 'không có yêu cầu này' }); return true; }
      if (!one[2] && m === 'GET') { S.adminRead.run(t.id); json(res, 200, { ticket: view(S.get.get(t.id)) }); return true; }
      if (one[2] === 'status' && m === 'POST') { const b = await body(req); if (!STATUSES.includes(b?.status)) { json(res, 400, { error: 'trạng thái không hợp lệ' }); return true; } S.status.run(b.status, now(), t.id); json(res, 200, { ok: true, ticket: view(S.get.get(t.id)) }); return true; }
      if (one[2] === 'reply' && m === 'POST') {
        const b = await body(req); const msg = text(b?.message); if (!msg) { json(res, 400, { error: 'Viết câu trả lời trước.' }); return true; }
        const at = now(); const mm = { id: newId('m'), body: msg, image: image(b?.image) };
        S.msgAdd.run(mm.id, t.id, 'admin', me.name || 'Phloem', mm.body, mm.image, at); S.touchAdmin.run(at, b?.close ? 'done' : 'open', t.id);
        let mailed = 'ok';
        try { await toCustomer(S.get.get(t.id), mm); } catch (e) { mailed = e?.off ? 'off' : `lỗi: ${String(e?.message || e).slice(0, 160)}`; }
        json(res, 200, { ok: true, mailed, ticket: view(S.get.get(t.id)) }); return true;
      }
    }
    json(res, 404, { error: 'không có route hỗ trợ này' }); return true;
  }

  return {
    handle,
    /** wait for notification emails still being sent (tests) */
    flush: () => Promise.allSettled([...pending]),
    unreadForAdmin: () => { let n = 0; for (const r of S.counts.all()) if (r.status !== 'spam') n += Number(r.unread) || 0; return n; },
  };
}
