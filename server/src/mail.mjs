// Phloem Email sending infrastructure on the relay:
//   POST /img                         host an email image on the public bucket (small emails, no attachments)
//   POST /mail/campaigns              register a campaign's links (click redirects only ever go to these)
//   POST /mail/tokens                 signed per-recipient tokens (unsubscribe, open pixel, click) for browser sends
//   GET|POST /u/:token                unsubscribe page / one-click unsubscribe (RFC 8058) → suppression list
//   GET /o/:token.gif                 open pixel          GET /c/:token/:i   click redirect
//   /mail/suppressions                list / add / remove suppressed addresses
//   /mail/campaigns/:id/stats         opens, clicks, unsubscribes, sends, orders
//   /mail/campaigns/:id/people        each recipient: opened, which links, what they bought (orders matched to this email)
//   /mail/senders                     sending accounts (Resend, Brevo, Amazon SES), credentials encrypted at rest
//   /mail/send                        server-side queue: schedule, daily cap, A/B subject test, pause/resume/cancel
// Zero dependencies. Tokens are HMAC-signed so a link can never be forged for another address or campaign.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { encrypt, decrypt } from './db.mjs';
import { s3Call } from './backup.mjs';
import { buildMessage, detectSmtp, smtpSend, smtpVerify, SMTP_PRESETS } from './smtp.mjs';

const now = () => new Date().toISOString();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_suppressions (owner TEXT NOT NULL, email TEXT NOT NULL, at TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', campaign TEXT NOT NULL DEFAULT '', PRIMARY KEY (owner, email));
CREATE TABLE IF NOT EXISTS mail_campaigns (id TEXT NOT NULL, owner TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner, id));
CREATE TABLE IF NOT EXISTS mail_events (owner TEXT NOT NULL, campaign TEXT NOT NULL, email_hash TEXT NOT NULL, kind TEXT NOT NULL, link INTEGER, variant TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS mail_events_c ON mail_events(owner, campaign, kind);
CREATE TABLE IF NOT EXISTS mail_senders (owner TEXT NOT NULL, id TEXT NOT NULL, enc BLOB NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner, id));
CREATE TABLE IF NOT EXISTS mail_queue (owner TEXT NOT NULL, campaign TEXT NOT NULL, email TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', error TEXT NOT NULL DEFAULT '', sent_at TEXT, PRIMARY KEY (owner, campaign, email));
CREATE INDEX IF NOT EXISTS mail_queue_s ON mail_queue(owner, campaign, status);
CREATE TABLE IF NOT EXISTS mail_rcpt (owner TEXT NOT NULL, campaign TEXT NOT NULL, email TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, PRIMARY KEY (owner, campaign, email));
`;

/** Image bucket: its own bucket + public URL; credentials default to the backup token (scope it to both buckets). */
export function imageConfig(env = process.env) {
  const endpoint = String(env.IMG_S3_ENDPOINT || env.BACKUP_S3_ENDPOINT || '').replace(/\/$/, '');
  const bucket = env.IMG_S3_BUCKET, key = env.IMG_S3_KEY || env.BACKUP_S3_KEY, secret = env.IMG_S3_SECRET || env.BACKUP_S3_SECRET;
  const publicUrl = String(env.IMG_PUBLIC_URL || '').replace(/\/$/, '');
  if (!endpoint || !bucket || !key || !secret || !publicUrl) return null;
  return { endpoint, bucket, key, secret, region: env.IMG_S3_REGION || 'auto', publicUrl };
}

// ---------- tokens ----------
export function makeToken(secret, owner, campaign, email, variant = '') {
  const body = b64u(JSON.stringify({ o: owner, c: campaign, e: String(email).toLowerCase(), v: variant || undefined }));
  return `${body}.${b64u(createHmac('sha256', secret).update(body).digest()).slice(0, 22)}`;
}
export function readToken(secret, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = b64u(createHmac('sha256', secret).update(body).digest()).slice(0, 22);
  if (sig.length !== want.length || !timingSafe(sig, want)) return null;
  try { const j = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return j && j.o && j.c && j.e ? { owner: j.o, campaign: j.c, email: j.e, variant: j.v || '' } : null; } catch { return null; }
}
function timingSafe(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/** Merge fields: {{first_name}}, {{last_name}}, {{email}}, {{any_custom_field}}, with a fallback after a bar:
 *  {{first_name|bạn}}. Unknown fields without a fallback become empty (never a raw {{tag}} in an inbox). */
export function mergeFields(text, fields = {}, html = true) {
  const f = Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k.toLowerCase(), v == null ? '' : String(v)]));
  if (f.first_name === undefined && f.firstname !== undefined) f.first_name = f.firstname;
  f.ten ??= f.first_name; f.name ??= [f.first_name, f.last_name].filter(Boolean).join(' ');
  return String(text).replace(/\{\{\s*([a-z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (_, k, dflt) => { const v = f[k.toLowerCase()] || dflt || ''; return html ? esc(v) : v; });
}

/** Per-recipient HTML: the campaign HTML carries placeholders (set by the studio), filled with this recipient's links
 *  and merge fields (`fields` may also be a plain first-name string, as before). */
export function personalize(html, base, token, fields = '') {
  const unsub = `${base}/u/${token}`;
  const fl = typeof fields === 'string' ? { first_name: fields } : fields || {};
  let out = mergeFields(String(html).replace(/__PHLOEM_UNSUB__/g, unsub).replace(/__PHLOEM_CLICK_(\d+)__/g, (_, i) => `${base}/c/${token}/${i}`), fl);
  const pixel = `<img src="${base}/o/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
  return { html: out, unsub };
}

// ---------- providers ----------
async function sendResend(s, m) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: s.fromName ? `${s.fromName} <${s.fromEmail}>` : s.fromEmail, to: [m.to], subject: m.subject, html: m.html, text: m.text || undefined, reply_to: s.replyTo || undefined, headers: m.headers }), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
async function sendBrevo(s, m) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': s.apiKey, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sender: { name: s.fromName || undefined, email: s.fromEmail }, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text || undefined, replyTo: s.replyTo ? { email: s.replyTo } : undefined, headers: m.headers }), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
/** Amazon SES v2 call, SigV4 by hand (service "ses"). */
async function sesCall(s, method, path, body) {
  const region = s.region || 'ap-southeast-1';
  const host = `email.${region}.amazonaws.com`;
  const payload = body === undefined ? '' : JSON.stringify(body);
  const amzDate = now().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
  const canon = [method, path.split('?')[0], '', `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`, 'content-type;host;x-amz-date', sha(payload)].join('\n');
  const scope = `${date}/${region}/ses/aws4_request`;
  const h = (k, v) => createHmac('sha256', k).update(v).digest();
  const sig = createHmac('sha256', h(h(h(h('AWS4' + s.secret, date), region), 'ses'), 'aws4_request')).update(['AWS4-HMAC-SHA256', amzDate, scope, sha(canon)].join('\n')).digest('hex');
  const r = await fetch(`https://${host}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Amz-Date': amzDate, Authorization: `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=content-type;host;x-amz-date, Signature=${sig}` }, body: payload || undefined, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`SES ${r.status}: ${text.slice(0, 200)}`), { status: r.status });
  return text ? JSON.parse(text) : {};
}
async function sendSes(s, m) {
  await sesCall(s, 'POST', '/v2/email/outbound-emails', { FromEmailAddress: s.fromName ? `${s.fromName} <${s.fromEmail}>` : s.fromEmail, Destination: { ToAddresses: [m.to] }, ReplyToAddresses: s.replyTo ? [s.replyTo] : undefined, Content: { Simple: { Subject: { Data: m.subject, Charset: 'UTF-8' }, Body: { Html: { Data: m.html, Charset: 'UTF-8' }, ...(m.text ? { Text: { Data: m.text, Charset: 'UTF-8' } } : {}) }, Headers: Object.entries(m.headers || {}).map(([Name, Value]) => ({ Name, Value })) } } });
}

// ---------- sending domains: ask the provider for the DNS records, then check them ----------
const dmarcHint = (domain) => ({ type: 'TXT', name: `_dmarc.${domain}`, value: 'v=DMARC1; p=none;', status: 'recommended', note: 'Khuyên dùng: báo cáo DMARC; đổi p=quarantine khi đã gửi ổn định' });
async function jsonFetch(url, init) { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); const text = await r.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { message: text.slice(0, 200) }; } if (!r.ok) throw Object.assign(new Error(j.message || j.error || `HTTP ${r.status}`), { status: r.status }); return j; }
const DOMAINS = {
  resend: {
    async add(s, domain) {
      const H = { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' };
      let d;
      try { d = await jsonFetch('https://api.resend.com/domains', { method: 'POST', headers: H, body: JSON.stringify({ name: domain }) }); }
      catch (e) { const list = await jsonFetch('https://api.resend.com/domains', { headers: H }); const hit = (list.data || []).find((x) => x.name === domain); if (!hit) throw e; d = await jsonFetch(`https://api.resend.com/domains/${hit.id}`, { headers: H }); }
      return { id: d.id, ...await DOMAINS.resend.status(s, domain, d.id) };
    },
    async status(s, domain, id) {
      const H = { Authorization: `Bearer ${s.apiKey}` };
      try { await jsonFetch(`https://api.resend.com/domains/${id}/verify`, { method: 'POST', headers: H }); } catch { /* verify is best effort */ }
      const d = await jsonFetch(`https://api.resend.com/domains/${id}`, { headers: H });
      return { verified: d.status === 'verified', status: d.status, records: [...(d.records || []).map((r) => ({ type: r.type, name: r.name.endsWith(domain) ? r.name : `${r.name}.${domain}`, value: r.value, priority: r.priority, status: r.status })), dmarcHint(domain)] };
    },
  },
  brevo: {
    async add(s, domain) {
      const H = { 'api-key': s.apiKey, 'Content-Type': 'application/json', accept: 'application/json' };
      try { await jsonFetch('https://api.brevo.com/v3/senders/domains', { method: 'POST', headers: H, body: JSON.stringify({ name: domain }) }); } catch (e) { if (!/exist/i.test(e.message)) throw e; }
      return { id: domain, ...await DOMAINS.brevo.status(s, domain) };
    },
    async status(s, domain) {
      const H = { 'api-key': s.apiKey, accept: 'application/json' };
      try { await jsonFetch(`https://api.brevo.com/v3/senders/domains/${encodeURIComponent(domain)}/authenticate`, { method: 'PUT', headers: H }); } catch { /* not ready yet */ }
      const d = await jsonFetch(`https://api.brevo.com/v3/senders/domains/${encodeURIComponent(domain)}`, { headers: H });
      const recs = Object.values(d.dns_records || {}).map((r) => ({ type: r.type, name: r.host_name ? (r.host_name.endsWith(domain) ? r.host_name : `${r.host_name}.${domain}`) : domain, value: r.value, status: r.status ? 'verified' : 'pending' }));
      return { verified: !!(d.verified && d.authenticated), status: d.authenticated ? 'verified' : 'pending', records: [...recs, dmarcHint(domain)] };
    },
  },
  ses: {
    async add(s, domain) {
      try { await sesCall(s, 'POST', '/v2/email/identities', { EmailIdentity: domain }); } catch (e) { if (e.status !== 409 && !/AlreadyExists/i.test(e.message)) throw e; }
      return { id: domain, ...await DOMAINS.ses.status(s, domain) };
    },
    async status(s, domain) {
      const d = await sesCall(s, 'GET', `/v2/email/identities/${encodeURIComponent(domain)}`);
      const tokens = d.DkimAttributes?.Tokens || [];
      const ok = d.VerifiedForSendingStatus === true || d.DkimAttributes?.Status === 'SUCCESS';
      return { verified: ok, status: d.DkimAttributes?.Status || 'PENDING', records: [...tokens.map((t) => ({ type: 'CNAME', name: `${t}._domainkey.${domain}`, value: `${t}.dkim.amazonses.com`, status: ok ? 'verified' : 'pending' })), { type: 'TXT', name: domain, value: 'v=spf1 include:amazonses.com ~all', status: 'recommended', note: 'Gộp vào bản ghi SPF sẵn có nếu có' }, dmarcHint(domain)] };
    },
  },
};

/** Bounce / complaint notifications from the providers' webhooks → [{ email, kind: 'bounce'|'complaint' }]. */
export function parseProviderEvents(provider, payload) {
  const out = [];
  const add = (email, kind) => { const e = String(email || '').toLowerCase().trim(); if (EMAIL_RE.test(e)) out.push({ email: e, kind }); };
  const list = Array.isArray(payload) ? payload : [payload];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    if (provider === 'resend') {
      const kind = p.type === 'email.bounced' ? 'bounce' : p.type === 'email.complained' ? 'complaint' : null;
      if (kind) for (const e of [].concat(p.data?.to || [])) add(e, kind);
    } else if (provider === 'brevo') {
      const kind = ['hard_bounce', 'invalid_email', 'blocked'].includes(p.event) ? 'bounce' : ['spam', 'complaint'].includes(p.event) ? 'complaint' : null;
      if (kind) add(p.email, kind);
    } else if (provider === 'ses') {
      let m = p.Message ?? p; if (typeof m === 'string') { try { m = JSON.parse(m); } catch { continue; } }
      const t = m.notificationType || m.eventType;
      if (t === 'Bounce' && (m.bounce?.bounceType || 'Permanent') === 'Permanent') for (const r of m.bounce?.bouncedRecipients || []) add(r.emailAddress, 'bounce');
      if (t === 'Complaint') for (const r of m.complaint?.complainedRecipients || []) add(r.emailAddress, 'complaint');
    }
  }
  return out;
}
/** Set by createMail when SMTP goes through the Cloudflare bridge (hosts that block SMTP ports, like Render free). */
let smtpBridge = null;
/** A mailbox over SMTP (Titan, Google Workspace with an app password, Zoho, Outlook / M365, Hostinger…). */
async function sendSmtp(s, m) {
  const cfg = { host: s.host, port: s.port, secure: s.secure, username: s.username || s.fromEmail, password: s.password };
  const msg = { from: s.fromEmail, fromName: s.fromName, to: m.to, subject: m.subject, html: m.html, text: m.text, replyTo: s.replyTo, headers: m.headers };
  if (smtpBridge) { await smtpBridge(cfg, msg); return; }
  await smtpSend(cfg, msg);
}
/** A provider call that never answers must not freeze the whole queue (the worker runs one send at a time). */
const capped = (p, ms = 60_000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`không phản hồi sau ${Math.round(ms / 1000)} giây (máy chủ gửi bị chặn hoặc treo)`)), ms).unref?.())]);
const PROVIDERS = { resend: { send: sendResend, perDay: 100, label: 'Resend' }, brevo: { send: sendBrevo, perDay: 300, label: 'Brevo' }, ses: { send: sendSes, perDay: 50000, label: 'Amazon SES' }, smtp: { send: sendSmtp, perDay: 300, label: 'Hộp mail (SMTP: Titan, Google Workspace, Zoho, Outlook…)' } };
export { SMTP_PRESETS };

/** Mount the mail routes on the relay. Returns { handle(url, req, res) → true when handled, health(), start() }. */
export function createMail({ raw: db, secret, publicUrl, json, body, rawBody, requireUser, throttled, env = process.env, log = console.log, providers = PROVIDERS, pace = 150, hooks = {}, domains = DOMAINS }) {
  db.exec(SCHEMA);
  try { db.exec('ALTER TABLE mail_queue ADD COLUMN data TEXT'); } catch { /* column exists */ }
  const PROV = providers;
  const img = imageConfig(env);
  const q = (sql) => db.prepare(sql);
  const S = {
    supAdd: q('INSERT INTO mail_suppressions (owner, email, at, source, campaign) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, email) DO NOTHING'),
    supList: q('SELECT email, at, source, campaign FROM mail_suppressions WHERE owner = ? ORDER BY at DESC'),
    supDel: q('DELETE FROM mail_suppressions WHERE owner = ? AND email = ?'),
    supHas: q('SELECT 1 FROM mail_suppressions WHERE owner = ? AND email = ?'),
    campPut: q('INSERT INTO mail_campaigns (id, owner, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
    campGet: q('SELECT json FROM mail_campaigns WHERE owner = ? AND id = ?'),
    campDue: q('SELECT owner, id, json FROM mail_campaigns'),
    evAdd: q('INSERT INTO mail_events (owner, campaign, email_hash, kind, link, variant, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    evRecent: q('SELECT 1 FROM mail_events WHERE owner = ? AND campaign = ? AND email_hash = ? AND kind = ? AND COALESCE(link, -1) = ? AND at > ? LIMIT 1'),
    evStats: q('SELECT kind, variant, COUNT(*) AS n, COUNT(DISTINCT email_hash) AS u FROM mail_events WHERE owner = ? AND campaign = ? GROUP BY kind, variant'),
    evTotals: q('SELECT kind, COUNT(DISTINCT email_hash) AS u FROM mail_events WHERE owner = ? AND campaign = ? GROUP BY kind'),
    evReaders: q("SELECT COUNT(DISTINCT email_hash) AS u FROM mail_events WHERE owner = ? AND campaign = ? AND kind IN ('open', 'click')"),
    evLinks: q("SELECT link, COUNT(*) AS n, COUNT(DISTINCT email_hash) AS u FROM mail_events WHERE owner = ? AND campaign = ? AND kind = 'click' GROUP BY link"),
    senderPut: q('INSERT INTO mail_senders (owner, id, enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner, id) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at'),
    senderList: q('SELECT id, enc, updated_at FROM mail_senders WHERE owner = ?'),
    senderGet: q('SELECT enc FROM mail_senders WHERE owner = ? AND id = ?'),
    senderDel: q('DELETE FROM mail_senders WHERE owner = ? AND id = ?'),
    qAdd: q("INSERT INTO mail_queue (owner, campaign, email, variant, status, data) VALUES (?, ?, ?, ?, 'queued', ?) ON CONFLICT(owner, campaign, email) DO NOTHING"),
    qNext: q("SELECT email, variant, data FROM mail_queue WHERE owner = ? AND campaign = ? AND status = 'queued' AND variant IN (?, ?) LIMIT ?"),
    qMark: q('UPDATE mail_queue SET status = ?, error = ?, sent_at = ?, variant = COALESCE(NULLIF(?, \'\'), variant) WHERE owner = ? AND campaign = ? AND email = ?'),
    qCounts: q('SELECT status, variant, COUNT(*) AS n FROM mail_queue WHERE owner = ? AND campaign = ? GROUP BY status, variant'),
    qSentToday: q("SELECT COUNT(*) AS n FROM mail_queue WHERE owner = ? AND campaign = ? AND status = 'sent' AND sent_at >= ?"),
    qCancel: q("UPDATE mail_queue SET status = 'cancelled' WHERE owner = ? AND campaign = ? AND status = 'queued'"),
    qSkipSup: q("UPDATE mail_queue SET status = 'skipped', error = 'đã huỷ đăng ký', sent_at = ? WHERE owner = ? AND campaign = ? AND status = 'queued' AND email IN (SELECT email FROM mail_suppressions WHERE owner = ?)"),
    qRelabel: q("UPDATE mail_queue SET variant = ? WHERE owner = ? AND campaign = ? AND status = 'queued' AND variant = 'rest'"),
    qAll: q('SELECT email, variant, status, error, sent_at FROM mail_queue WHERE owner = ? AND campaign = ? LIMIT 100000'),
    rcptAdd: q('INSERT INTO mail_rcpt (owner, campaign, email, variant, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, campaign, email) DO NOTHING'),
    rcptAll: q('SELECT email, variant, at FROM mail_rcpt WHERE owner = ? AND campaign = ? LIMIT 100000'),
    rcptCount: q('SELECT COUNT(*) AS n FROM mail_rcpt WHERE owner = ? AND campaign = ?'),
    evHourly: q("SELECT strftime('%Y-%m-%dT%H', at, '+7 hours') AS h, kind, COUNT(*) AS n, COUNT(DISTINCT email_hash) AS u FROM mail_events WHERE owner = ? AND campaign = ? AND kind IN ('open', 'click') GROUP BY h, kind ORDER BY h"),
    evPeople: q('SELECT email_hash AS h, kind, link, COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM mail_events WHERE owner = ? AND campaign = ? GROUP BY email_hash, kind, link'),
  };
  const camp = (owner, id) => { const r = S.campGet.get(owner, id); return r ? JSON.parse(r.json) : null; };
  // ---- SMTP through the Cloudflare Worker (tools/smtp-worker): one-time jobs the Worker fetches back from here ----
  const BRIDGE = env.SMTP_BRIDGE_URL !== undefined ? String(env.SMTP_BRIDGE_URL) : env.RENDER ? 'https://phloem-smtp.vankhanh-le.workers.dev/send' : '';
  const smtpJobs = new Map();
  const viaBridge = async (cfg, msg) => {
    const id = randomBytes(18).toString('base64url');
    smtpJobs.set(id, { exp: Date.now() + 120e3, job: { host: cfg.host, port: Number(cfg.port) || 465, secure: cfg.secure === 'starttls' ? 'starttls' : 'ssl', username: cfg.username || '', password: cfg.password || '', from: msg?.from || '', to: msg?.to || '', raw: msg ? buildMessage(msg) : null } });
    try {
      const r = await fetch(BRIDGE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: id }), signal: AbortSignal.timeout(55_000) });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || `SMTP qua Cloudflare: HTTP ${r.status}`);
      return j;
    } finally { smtpJobs.delete(id); }
  };
  smtpBridge = BRIDGE ? viaBridge : null;
  const verifyMailbox = (cfg, opts) => (BRIDGE ? viaBridge(cfg, null) : smtpVerify(cfg, opts));
  // campaigns withdrawn after a wrong send: their links lead nowhere (env RECALLED_CAMPAIGNS, comma-separated, or the campaign's own flag)
  const recalled = new Set([...String(env.RECALLED_CAMPAIGNS || '').split(/[\s,]+/).filter(Boolean),
    'q_mvfgzb0i', 'q_mvfehw9t', 'q_mvanyhfi', 'q_mv9q8mow', // Intac emails withdrawn 2026-10-20 after a wrong send (Gmail sends, owner u_766f…)
  ]);
  const saveCamp = (owner, id, c) => { const t = now(); S.campPut.run(id, owner, JSON.stringify(c), c.createdAt || t, t); };
  const event = (t, kind, link = null) => {
    const eh = sha(`${t.owner}|${t.email}`).slice(0, 24);
    // Gmail/Apple prefetch can hit the pixel several times: count a person once per hour per kind+link
    if (S.evRecent.get(t.owner, t.campaign, eh, kind, link ?? -1, new Date(Date.now() - 3600e3).toISOString())) return;
    S.evAdd.run(t.owner, t.campaign, eh, kind, link, t.variant || '', now());
    try { hooks.onEvent?.(t, kind, camp(t.owner, t.campaign)); } catch (e) { log('[mail] hook:', e?.message || e); }
  };
  const senders = (owner) => S.senderList.all(owner).map((r) => { try { const s = JSON.parse(decrypt(secret, r.enc)); return { ...s, id: r.id, updatedAt: r.updated_at }; } catch { return null; } }).filter(Boolean);
  const hookToken = (owner, sid) => b64u(createHmac('sha256', secret).update(`hook:${owner}:${sid}`).digest()).slice(0, 24);
  const publicSender = (s, owner) => ({ webhook: owner && s.provider !== 'smtp' ? `${publicUrl}/hooks/${s.provider}/${owner}/${s.id}/${hookToken(owner, s.id)}` : undefined, domain: s.domain || null, id: s.id, provider: s.provider, label: s.label || PROV[s.provider]?.label || s.provider, fromEmail: s.fromEmail, fromName: s.fromName || '', replyTo: s.replyTo || '', region: s.region || '', perDay: s.perDay || PROV[s.provider]?.perDay || 100, updatedAt: s.updatedAt, hasKey: !!(s.apiKey || s.secret || s.password), ...(s.provider === 'smtp' ? { preset: s.preset || 'custom', host: s.host, port: s.port, secure: s.secure, username: s.username } : {}) });

  /** Every recipient of a campaign with what they did: opens, which links, unsubscribe/bounce, and orders matched to
   *  this email by the shop's order tag. Events are stored per hashed address, so they are named by hashing the
   *  campaign's own recipient list (queue for server sends, mail_rcpt for browser sends); nothing outside it is revealed. */
  function people(owner, id) {
    const c = camp(owner, id); if (!c) return null;
    const rows = new Map();
    const row = (email) => { let r = rows.get(email); if (!r) { r = { email, name: '', status: '', sentAt: null, variant: '', error: '', opens: 0, firstOpen: null, lastOpen: null, clicks: 0, lastClick: null, links: [], orders: [], unsubAt: null, bounced: '' }; rows.set(email, r); } return r; };
    for (const r of S.rcptAll.all(owner, id)) { const x = row(r.email); x.status = 'sent'; x.sentAt = r.at; x.variant = r.variant; }
    for (const r of S.qAll.all(owner, id)) { const x = row(r.email); x.status = r.status; x.sentAt = r.sent_at || x.sentAt; x.variant = r.variant || x.variant; x.error = r.error || ''; }
    // older browser sends never listed their recipients: the audience side still knows who clicked and who bought
    const extra = hooks.campaignExtras?.(owner, id, c) || { clicks: [], orders: [] };
    for (const k of extra.clicks) if (k.email && !rows.has(k.email)) row(k.email).status = 'unknown';
    for (const o of extra.orders) if (o.email && !rows.has(o.email)) row(o.email).status = 'unknown';
    const byHash = new Map(); for (const e of rows.keys()) byHash.set(sha(`${owner}|${e}`).slice(0, 24), e);
    const unknown = { open: new Set(), click: new Set() };
    for (const ev of S.evPeople.all(owner, id)) {
      const email = byHash.get(ev.h);
      if (!email) { unknown[ev.kind]?.add(ev.h); continue; }
      const x = rows.get(email);
      if (ev.kind === 'open') { x.opens += ev.n; x.firstOpen = !x.firstOpen || ev.first < x.firstOpen ? ev.first : x.firstOpen; x.lastOpen = !x.lastOpen || ev.last > x.lastOpen ? ev.last : x.lastOpen; }
      else if (ev.kind === 'click') { x.clicks += ev.n; x.lastClick = !x.lastClick || ev.last > x.lastClick ? ev.last : x.lastClick; x.links.push({ i: ev.link, url: c.links?.[ev.link] || '', n: ev.n, last: ev.last }); }
      else if (ev.kind === 'unsub') x.unsubAt = ev.last;
    }
    const lost = [];
    for (const o of extra.orders) { const { email, ...ord } = o; if (email) rows.get(email).orders.push(ord); else lost.push(ord); }
    const sup = new Map(S.supList.all(owner).map((r) => [r.email, r]));
    for (const x of rows.values()) { const s0 = sup.get(x.email); if (s0 && (s0.source === 'bounce' || s0.source === 'complaint')) x.bounced = s0.source; if (s0 && s0.source === 'unsubscribe' && s0.campaign === id && !x.unsubAt) x.unsubAt = s0.at; }
    const names = hooks.namesOf?.(owner, c, [...rows.keys()]) || {};
    for (const x of rows.values()) x.name = names[x.email] || '';
    const list = [...rows.values()];
    const got = list.filter((x) => x.status === 'sent' || x.status === 'unknown');
    const opened = list.filter((x) => x.opens || x.clicks), clicked = list.filter((x) => x.clicks), bought = list.filter((x) => x.orders.length);
    const orders = extra.orders.length, revenue = extra.orders.reduce((a, o) => a + (o.value || 0), 0);
    const send = c.send || {};
    return {
      campaign: { id, subject: send.subject || c.subject || '', from: c.fromName || c.from || '', via: c.send ? 'server' : c.via || 'gmail', at: send.sendAt || c.createdAt, links: c.links || [], labels: c.labels || [], list: c.audience?.listName || '', segment: c.audience?.segmentName || '' },
      totals: { totalOpens: list.reduce((a, x) => a + x.opens, 0), totalClicks: list.reduce((a, x) => a + x.clicks, 0), recipients: got.length, opened: opened.length, clicked: clicked.length, buyers: bought.length, orders, revenue, unsubscribed: list.filter((x) => x.unsubAt).length, bounced: list.filter((x) => x.bounced).length, failed: list.filter((x) => x.status === 'failed').length, unknownOpens: unknown.open.size, unknownClicks: unknown.click.size },
      lostOrders: lost, // matched to this email by click id but the buyer's address is not known
      // activity by hour, Vietnam time: opens/clicks (all events) and people (unique in that hour)
      timeline: (() => { const by = new Map(); for (const r of S.evHourly.all(owner, id)) { const t = by.get(r.h) || { h: r.h, opens: 0, openers: 0, clicks: 0, clickers: 0 }; if (r.kind === 'open') { t.opens = r.n; t.openers = r.u; } else { t.clicks = r.n; t.clickers = r.u; } by.set(r.h, t); } return [...by.values()]; })(),
      people: list,
    };
  }

  const page = (title, msg, extra = '') => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f3;font:16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#141714}main{max-width:440px;margin:24px;padding:32px;background:#fff;border-radius:16px;box-shadow:0 18px 40px -20px rgba(0,0,0,.25);text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#555;margin:0 0 18px}button{font:inherit;font-weight:700;padding:12px 22px;border:0;border-radius:999px;background:#111;color:#fff;cursor:pointer}small{display:block;margin-top:18px;color:#999}</style></head><body><main><h1>${esc(title)}</h1><p>${msg}</p>${extra}<small>Gửi bằng Phloem Email</small></main></body></html>`;
  const html = (res, code, s) => { res.statusCode = code; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(s); };

  async function handle(url, req, res) {
    const p = url.pathname, m = req.method;
    // ---------- public endpoints (the signed token is the permission) ----------
    if (p.startsWith('/u/')) {
      const token = p.slice(3); const t = readToken(secret, token);
      if (!t) { html(res, 404, page('Link không hợp lệ', 'Link huỷ đăng ký này không đúng hoặc đã bị sửa.')); return true; }
      const c = camp(t.owner, t.campaign); const from = c?.fromName || c?.from || 'người gửi';
      if (m === 'POST') { // the button on our page, or a mail client's one-click (List-Unsubscribe-Post)
        S.supAdd.run(t.owner, t.email, now(), 'unsubscribe', t.campaign); event(t, 'unsub');
        try { hooks.onUnsubscribe?.(t, c); } catch (e) { log('[mail] hook:', e?.message || e); }
        html(res, 200, page('Đã huỷ đăng ký', `${esc(t.email)} sẽ không nhận email từ ${esc(from)} nữa.`)); return true;
      }
      // GET shows a confirm button: link scanners that prefetch URLs never unsubscribe anyone by themselves
      html(res, 200, page('Huỷ đăng ký?', `Ngừng nhận email từ ${esc(from)} tới <b>${esc(t.email)}</b>.`, `<form method="post"><button type="submit">Huỷ đăng ký</button></form>`)); return true;
    }
    if (p.startsWith('/o/') && m === 'GET') {
      const t = readToken(secret, p.slice(3).replace(/\.gif$/, '')); if (t) { try { event(t, 'open'); } catch { /* never break the image */ } }
      res.statusCode = 200; res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'no-store, private'); res.end(GIF); return true;
    }
    if (p.startsWith('/c/') && m === 'GET') {
      const [, , token, idx] = p.split('/'); const t = readToken(secret, token);
      const c = t ? camp(t.owner, t.campaign) : null; const i = Number(idx);
      const dest = c && Array.isArray(c.links) && Number.isInteger(i) ? c.links[i] : null;
      if (c && (c.recalled || recalled.has(t.campaign))) { // withdrawn after a wrong send: no destination, an apology (unsubscribe still works)
        html(res, 410, page('This email was withdrawn', 'It was sent by mistake. Please disregard it, and sorry for the trouble.')); return true;
      }
      if (!dest || !/^https?:\/\//i.test(dest)) { html(res, 404, page('Link không còn', 'Link này không tồn tại hoặc chiến dịch đã bị xoá.')); return true; }
      try { event(t, 'click', i); } catch { /* still redirect */ }
      // a per-click id rides along (?phl=…): the shop's order tag sends it back, so an order is matched to this exact email
      let to = dest;
      try { const cid = hooks.onClickId?.(t, i, c); if (cid) { const [base, hash] = dest.split('#'); to = `${base}${base.includes('?') ? '&' : '?'}phl=${encodeURIComponent(cid)}${hash !== undefined ? `#${hash}` : ''}`; } } catch { /* plain redirect */ }
      res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); return true;
    }
    const sj = /^\/mail\/smtp-job\/([A-Za-z0-9_-]{20,64})$/.exec(p);
    if (sj && m === 'GET') { // the Cloudflare SMTP Worker picks up a job (single use, 2 minutes)
      const e = smtpJobs.get(sj[1]); smtpJobs.delete(sj[1]);
      if (!e || e.exp < Date.now()) { json(res, 404, { error: 'not found' }); return true; }
      res.setHeader('Cache-Control', 'no-store'); json(res, 200, e.job); return true;
    }
    if (p === '/diag/smtp' && m === 'GET') { // can this host reach mailbox SMTP servers at all? (some clouds block the ports)
      if (throttled(`diag:${req.socket?.remoteAddress || ''}`, 10, 3600e3)) { json(res, 429, { error: 'busy' }); return true; }
      const probe = [['smtp.gmail.com', 465, 'ssl'], ['smtp.gmail.com', 587, 'starttls'], ['smtp.titan.email', 465, 'ssl'], ['smtp.office365.com', 587, 'starttls']];
      const out = await Promise.all(probe.map(async ([host, port, secure]) => { const t0 = Date.now(); try { await verifyMailbox({ host, port, secure }, { timeout: 8000 }); return { host, port, ok: true, ms: Date.now() - t0 }; } catch (e) { return { host, port, ok: false, error: String(e?.message || e).slice(0, 120) }; } }));
      json(res, 200, { via: BRIDGE ? 'cloudflare' : 'direct', smtp: out }); return true;
    }
    const hk = /^\/hooks\/(resend|brevo|ses)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(p);
    if (hk && m === 'POST') {
      const [, prov, owner, sid, tok] = hk;
      if (tok !== hookToken(owner, sid)) { json(res, 404, { error: 'not found' }); return true; }
      let payload; try { payload = JSON.parse((await rawBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}'); } catch { json(res, 400, { error: 'JSON không hợp lệ' }); return true; }
      // Amazon SNS asks once to confirm the subscription: only ever follow an amazonaws.com URL
      if (prov === 'ses' && payload?.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
        try { const u2 = new URL(payload.SubscribeURL); if (u2.protocol === 'https:' && /(^|\.)amazonaws\.com$/.test(u2.hostname)) await fetch(u2, { signal: AbortSignal.timeout(10_000) }); } catch { /* ignore */ }
        json(res, 200, { ok: true }); return true;
      }
      const evs = parseProviderEvents(prov, payload);
      for (const e of evs) { S.supAdd.run(owner, e.email, now(), e.kind, ''); try { hooks.onBounce?.(owner, e.email, e.kind); } catch (er) { log('[mail] hook:', er?.message || er); } }
      json(res, 200, { ok: true, handled: evs.length }); return true;
    }
    if (p === '/img' || p.startsWith('/mail/')) {
      const u = requireUser(req, res); if (!u) return true;
      try {
        if (p === '/img' && m === 'POST') {
          if (!img) { json(res, 503, { error: 'Relay chưa cấu hình kho ảnh (IMG_S3_BUCKET, IMG_PUBLIC_URL).' }); return true; }
          if (throttled(`img:${u.id}`, 3000, 24 * 3600e3)) { json(res, 429, { error: 'Đã tải quá nhiều ảnh hôm nay.' }); return true; }
          const type = String(req.headers['content-type'] || '').split(';')[0];
          const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[type];
          if (!ext) { json(res, 415, { error: 'chỉ nhận PNG/JPG/GIF/WebP' }); return true; }
          const data = await rawBody(req, 8 * 1024 * 1024);
          const key = `e/${sha(data).slice(0, 32)}.${ext}`; // content-addressed: the same slice is stored once, forever
          const r = await s3Call(img, 'PUT', key, data, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' });
          if (r.status >= 300) { json(res, 502, { error: `Kho ảnh trả HTTP ${r.status}` }); return true; }
          json(res, 200, { url: `${img.publicUrl}/${key}`, bytes: data.length }); return true;
        }
        if (p === '/mail/tokens' && m === 'POST') {
          const b = await body(req); const cid = String(b?.campaign || '').slice(0, 80);
          if (!cid || !camp(u.id, cid)) { json(res, 404, { error: 'Đăng ký chiến dịch trước (POST /mail/campaigns).' }); return true; }
          const out = {}; const at = now();
          for (const e of (Array.isArray(b?.emails) ? b.emails : []).slice(0, 1000)) { const em = String(e).toLowerCase().trim(); if (EMAIL_RE.test(em)) { out[em] = makeToken(secret, u.id, cid, em, String(b?.variant || '')); S.rcptAdd.run(u.id, cid, em, String(b?.variant || ''), at); } } // who got it: the per-person report names them
          const sup = new Set(S.supList.all(u.id).map((r) => r.email));
          json(res, 200, { base: publicUrl, tokens: out, suppressed: Object.keys(out).filter((e) => sup.has(e)) }); return true;
        }
        if (p === '/mail/campaigns' && m === 'GET') { // this account's sent campaigns (any browser), newest first
          const proj = url.searchParams.get('project') || '';
          const list = S.campDue.all().filter((r) => r.owner === u.id && !/^(a_|test_)/.test(r.id)).map((r) => ({ id: r.id, ...JSON.parse(r.json) }))
            .filter((c) => !proj || c.project === proj)
            .map((c) => ({ id: c.id, subject: c.send?.subject || c.subject || '', via: c.send ? 'server' : c.via || 'gmail', project: c.project || '', at: c.send?.sendAt || c.createdAt, recipients: c.send ? Object.values(Object.fromEntries(S.qCounts.all(u.id, c.id).map((x) => [x.status + x.variant, x.n]))).reduce((a, n) => a + n, 0) : Number(S.rcptCount.get(u.id, c.id).n) || c.recipients || 0 }))
            .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100);
          json(res, 200, { campaigns: list }); return true;
        }
        if (p === '/mail/campaigns' && m === 'POST') {
          const b = await body(req); const id = String(b?.id || '').slice(0, 80); if (!id) { json(res, 400, { error: 'thiếu id' }); return true; }
          const prev = camp(u.id, id) || { createdAt: now() };
          saveCamp(u.id, id, { ...prev, recipients: Number.isFinite(Number(b.recipients)) && Number(b.recipients) > 0 ? Math.min(1e6, Math.round(Number(b.recipients))) : prev.recipients, via: ['gmail', 'server'].includes(b.via) ? b.via : prev.via, project: b.project ? String(b.project).slice(0, 80) : prev.project, subject: String(b.subject || prev.subject || '').slice(0, 300), from: String(b.from || prev.from || '').slice(0, 200), fromName: String(b.fromName || prev.fromName || '').slice(0, 120), links: Array.isArray(b.links) ? b.links.map((x) => String(x).slice(0, 2000)).slice(0, 300) : prev.links || [], labels: Array.isArray(b.labels) ? b.labels.map((x) => String(x ?? '').slice(0, 80)).slice(0, 300) : prev.labels || [] });
          json(res, 200, { ok: true }); return true;
        }
        const st = /^\/mail\/campaigns\/([^/]+)\/stats$/.exec(p);
        if (st && m === 'GET') {
          const id = decodeURIComponent(st[1]); const c = camp(u.id, id); if (!c) { json(res, 404, { error: 'không có chiến dịch' }); return true; }
          const tot = Object.fromEntries(S.evTotals.all(u.id, id).map((r) => [r.kind, r.u]));
          const byVariant = {}; for (const r of S.evStats.all(u.id, id)) { const v = r.variant || '-'; byVariant[v] ||= { opens: 0, clicks: 0 }; if (r.kind === 'open') byVariant[v].opens = r.u; else if (r.kind === 'click') byVariant[v].clicks = r.u; }
          const qc = S.qCounts.all(u.id, id); const queue = {}; for (const r of qc) queue[r.status] = (queue[r.status] || 0) + r.n;
          const { html: _h, text: _t, ...send } = c.send || {};
          const ord = hooks.ordersSummary?.(u.id, id) || { orders: 0, revenue: 0, buyers: 0 };
          json(res, 200, { opens: Number(S.evReaders.get(u.id, id).u) || 0, clicks: tot.click || 0, unsubscribes: tot.unsub || 0, links: S.evLinks.all(u.id, id).map((r) => ({ url: c.links?.[r.link] || '', clicks: r.u })), byVariant, queue, send: c.send ? send : null, ...ord }); return true;
        }
        const wd = /^\/mail\/campaigns\/([^/]+)\/recall$/.exec(p);
        if (wd && m === 'POST') { // "Thu hồi": links of a sent campaign stop working (reversible with {on:false})
          const id = decodeURIComponent(wd[1]); const c = camp(u.id, id); if (!c) { json(res, 404, { error: 'không có chiến dịch' }); return true; }
          const b = await body(req); saveCamp(u.id, id, { ...c, recalled: b?.on !== false, recalledAt: b?.on !== false ? now() : null });
          json(res, 200, { ok: true, recalled: b?.on !== false }); return true;
        }
        const rc = /^\/mail\/campaigns\/([^/]+)\/recipients$/.exec(p);
        if (rc && m === 'POST') { // a browser send's recipient list, sent after the fact (sends from before the relay kept it)
          const id = decodeURIComponent(rc[1]); const c = camp(u.id, id); if (!c) { json(res, 404, { error: 'không có chiến dịch' }); return true; }
          const b = await body(req); const at = String(b?.at || c.createdAt || now()).slice(0, 40); let n = 0;
          for (const e of (Array.isArray(b?.emails) ? b.emails : []).slice(0, 10000)) { const em = String(e).toLowerCase().trim(); if (EMAIL_RE.test(em)) { S.rcptAdd.run(u.id, id, em, '', at); n++; } }
          json(res, 200, { ok: true, recorded: n }); return true;
        }
        const pp = /^\/mail\/campaigns\/([^/]+)\/people$/.exec(p);
        if (pp && m === 'GET') {
          const r = people(u.id, decodeURIComponent(pp[1]));
          if (!r) { json(res, 404, { error: 'không có chiến dịch' }); return true; }
          json(res, 200, r); return true;
        }
        if (p === '/mail/suppressions') {
          if (m === 'GET') { json(res, 200, { suppressions: S.supList.all(u.id) }); return true; }
          if (m === 'POST') { const b = await body(req); let n = 0; for (const e of (Array.isArray(b?.emails) ? b.emails : []).slice(0, 20000)) { const em = String(e).toLowerCase().trim(); if (EMAIL_RE.test(em)) { S.supAdd.run(u.id, em, now(), String(b?.source || 'manual').slice(0, 30), ''); n++; } } json(res, 200, { added: n }); return true; }
        }
        const sd = /^\/mail\/suppressions\/(.+)$/.exec(p);
        if (sd && m === 'DELETE') { S.supDel.run(u.id, decodeURIComponent(sd[1]).toLowerCase()); json(res, 200, { ok: true }); return true; }
        // ---------- sending accounts ----------
        if (p === '/mail/senders') {
          if (m === 'GET') { json(res, 200, { senders: senders(u.id).map((x) => publicSender(x, u.id)), providers: Object.entries(PROV).map(([k, v]) => ({ id: k, label: v.label, perDay: v.perDay })), smtpPresets: Object.fromEntries(Object.entries(SMTP_PRESETS).map(([k, { mx: _m, ...v }]) => [k, v])) }); return true; }
          if (m === 'POST') {
            const b = await body(req); const prov = String(b?.provider || ''); if (!PROV[prov]) { json(res, 400, { error: 'nhà cung cấp không hỗ trợ' }); return true; }
            if (!EMAIL_RE.test(String(b?.fromEmail || ''))) { json(res, 400, { error: 'Email người gửi không hợp lệ' }); return true; }
            const id = String(b?.id || `s_${randomBytes(5).toString('hex')}`).slice(0, 40);
            const prev = senders(u.id).find((s) => s.id === id) || {};
            const s = { provider: prov, label: String(b.label || (prov === 'smtp' ? SMTP_PRESETS[b.preset]?.label?.split(' (')[0] : '') || '').slice(0, 60), fromEmail: String(b.fromEmail).trim(), fromName: String(b.fromName || '').slice(0, 120), replyTo: String(b.replyTo || '').slice(0, 200), region: String(b.region || '').slice(0, 30), perDay: Math.max(1, Math.min(100000, Number(b.perDay) || PROV[prov].perDay)), apiKey: b.apiKey ? String(b.apiKey).trim() : prev.apiKey, accessKeyId: b.accessKeyId ? String(b.accessKeyId).trim() : prev.accessKeyId, secret: b.secret ? String(b.secret).trim() : prev.secret };
            if (prov === 'smtp') { // a mailbox: server, port, TLS mode, login (password encrypted at rest with the rest of the record)
              Object.assign(s, { preset: String(b.preset || prev.preset || 'custom').slice(0, 20), host: String(b.host ?? prev.host ?? '').trim().toLowerCase().slice(0, 120), port: Math.max(1, Math.min(65535, Number(b.port ?? prev.port) || 465)), secure: ['ssl', 'starttls'].includes(b.secure) ? b.secure : prev.secure || 'ssl', username: String(b.username ?? prev.username ?? s.fromEmail).trim().slice(0, 200), password: b.password ? String(b.password) : prev.password });
              if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s.host)) { json(res, 400, { error: 'Máy chủ SMTP không hợp lệ' }); return true; }
              if (!s.password) { json(res, 400, { error: 'Thiếu mật khẩu hộp mail' }); return true; }
            } else if (prov === 'ses' ? !(s.accessKeyId && s.secret) : !s.apiKey) { json(res, 400, { error: 'Thiếu khoá API' }); return true; }
            if (prev.domain) s.domain = prev.domain;
            S.senderPut.run(u.id, id, encrypt(secret, JSON.stringify(s)), now());
            json(res, 200, { sender: publicSender({ ...s, id, updatedAt: now() }, u.id) }); return true;
          }
        }
        // a mailbox from its address: SMTP settings by domain / MX records
        if (p === '/mail/smtp/detect' && m === 'GET') { json(res, 200, { detected: await detectSmtp(url.searchParams.get('email') || '') }); return true; }
        // log in without sending (the form's "Kiểm tra đăng nhập"); a saved sender is checked with its stored password
        if (p === '/mail/smtp/verify' && m === 'POST') {
          if (throttled(`smtpv:${u.id}`, 20, 3600e3)) { json(res, 429, { error: 'Thử quá nhiều lần, đợi một lúc.' }); return true; }
          const b = await body(req); const saved = b?.id ? senders(u.id).find((x) => x.id === String(b.id)) : null;
          const host = String(b?.host || saved?.host || '').trim().toLowerCase();
          if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) { json(res, 400, { error: 'Máy chủ SMTP không hợp lệ' }); return true; }
          try { const r = await verifyMailbox({ host, port: Number(b?.port || saved?.port) || 465, secure: ['ssl', 'starttls'].includes(b?.secure) ? b.secure : saved?.secure || 'ssl', username: String(b?.username || saved?.username || saved?.fromEmail || ''), password: b?.password ? String(b.password) : saved?.password }, { timeout: 15_000 }); json(res, 200, { ok: true, auth: r.auth }); }
          catch (e) { json(res, 200, { ok: false, error: String(e?.message || e) }); }
          return true;
        }
        const sdel = /^\/mail\/senders\/([^/]+)$/.exec(p);
        if (sdel && m === 'DELETE') { S.senderDel.run(u.id, decodeURIComponent(sdel[1])); json(res, 200, { ok: true }); return true; }
        const stest = /^\/mail\/senders\/([^/]+)\/test$/.exec(p);
        if (stest && m === 'POST') {
          const s = senders(u.id).find((x) => x.id === decodeURIComponent(stest[1])); if (!s) { json(res, 404, { error: 'không có kênh gửi này' }); return true; }
          const b = await body(req); const to = String(b?.to || u.email);
          await capped(PROV[s.provider].send(s, { to, subject: 'Phloem Email: kiểm tra kênh gửi', html: '<p>Kênh gửi hoạt động. Email này được gửi từ Phloem Email.</p>', text: 'Kênh gửi hoạt động.', headers: {} }), 45_000);
          json(res, 200, { ok: true, to }); return true;
        }
        const sdom = /^\/mail\/senders\/([^/]+)\/domain$/.exec(p);
        if (sdom) {
          const sid = decodeURIComponent(sdom[1]); const s = senders(u.id).find((x) => x.id === sid); if (!s) { json(res, 404, { error: 'không có kênh gửi này' }); return true; }
          const D = domains[s.provider]; if (!D) { json(res, 400, { error: 'nhà cung cấp chưa hỗ trợ' }); return true; }
          const save = (domain) => { const { id: _i, updatedAt: _u, ...rest } = s; S.senderPut.run(u.id, sid, encrypt(secret, JSON.stringify({ ...rest, domain })), now()); };
          try {
            if (m === 'POST') {
              const b = await body(req); const name = String(b?.domain || s.fromEmail.split('@')[1] || '').toLowerCase().trim();
              if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) { json(res, 400, { error: 'Tên miền không hợp lệ' }); return true; }
              const r = await D.add(s, name); save({ name, id: r.id, verified: r.verified, checkedAt: now() });
              json(res, 200, { domain: { name, ...r } }); return true;
            }
            if (m === 'GET') {
              if (!s.domain) { json(res, 200, { domain: null }); return true; }
              const r = await D.status(s, s.domain.name, s.domain.id); save({ ...s.domain, verified: r.verified, checkedAt: now() });
              json(res, 200, { domain: { name: s.domain.name, ...r } }); return true;
            }
          } catch (e) { json(res, 502, { error: `${PROV[s.provider]?.label || s.provider}: ${e.message}${e.status === 401 || e.status === 403 ? ' (khoá API cần quyền quản lý tên miền)' : ''}` }); return true; }
        }
        // ---------- server-side queue ----------
        if (p === '/mail/send' && m === 'POST') {
          const b = await body(req); const id = String(b?.campaign || '').slice(0, 80);
          const c = camp(u.id, id); if (!c) { json(res, 404, { error: 'Đăng ký chiến dịch trước.' }); return true; }
          const s = senders(u.id).find((x) => x.id === String(b?.sender || '')); if (!s) { json(res, 400, { error: 'Chọn kênh gửi (Resend / Brevo / Amazon SES).' }); return true; }
          const htmlBody = String(b?.html || ''); if (!htmlBody || htmlBody.length > 600_000) { json(res, 400, { error: 'HTML trống hoặc quá lớn (ảnh phải lưu trên host).' }); return true; }
          if (/cid:/i.test(htmlBody)) { json(res, 400, { error: 'HTML còn ảnh đính kèm (cid:): bật lưu ảnh trên host trước.' }); return true; }
          // recipients: a pasted list, or a list/segment of the audience (resolved here, subscribed contacts only)
          let rows = null;
          if (b?.audience && hooks.resolveRecipients) { const r = await hooks.resolveRecipients(u, b.audience); if (r.error) { json(res, r.status || 400, { error: r.error }); return true; } rows = r.rows; c.audience = { ...r.info }; }
          const fieldsOf = new Map((rows || []).map((x) => [x.email, x.fields || null]));
          const list = [...new Set((rows ? rows.map((x) => x.email) : Array.isArray(b?.recipients) ? b.recipients : []).map((e) => String(e).toLowerCase().trim()).filter((e) => EMAIL_RE.test(e)))].slice(0, 50000);
          if (!list.length) { json(res, 400, { error: rows ? 'Danh sách/phân nhóm này chưa có ai đang đăng ký.' : 'Chưa có người nhận hợp lệ.' }); return true; }
          const ab = b?.ab && b.ab.subjectB ? { subjectB: String(b.ab.subjectB).slice(0, 300), split: Math.max(0.05, Math.min(0.5, Number(b.ab.split) || 0.2)), metric: b.ab.metric === 'clicks' ? 'clicks' : 'opens', waitHours: Math.max(1, Math.min(72, Number(b.ab.waitHours) || 4)), phase: 'test', winner: null } : null;
          // A/B: the first split×N recipients get A/B halves, the rest wait for the winner
          const nTest = ab ? Math.max(2, Math.round(list.length * ab.split)) : 0;
          list.forEach((e, i) => { const f = fieldsOf.get(e); S.qAdd.run(u.id, id, e, ab ? (i < nTest ? (i % 2 ? 'B' : 'A') : 'rest') : 'A', f ? JSON.stringify(f) : null); });
          c.send = { sender: s.id, subject: String(b.subject || c.subject || ''), html: c.audience?.footerHtml ? (/<\/body>/i.test(htmlBody) ? htmlBody.replace(/<\/body>/i, `${c.audience.footerHtml}</body>`) : htmlBody + c.audience.footerHtml) : htmlBody, text: String(b.text || '').slice(0, 100000), sendAt: b.sendAt && !Number.isNaN(Date.parse(b.sendAt)) ? new Date(b.sendAt).toISOString() : now(), status: 'scheduled', perDay: Math.max(1, Math.min(s.perDay, Number(b.perDay) || s.perDay)), ab, createdAt: now(), testSentAt: null, lastError: '' };
          saveCamp(u.id, id, c);
          json(res, 200, { ok: true, recipients: list.length, test: nTest, sendAt: c.send.sendAt }); return true;
        }
        const sc = /^\/mail\/send\/([^/]+)(?:\/(pause|resume|cancel))?$/.exec(p);
        if (sc) {
          const id = decodeURIComponent(sc[1]); const c = camp(u.id, id); if (!c?.send) { json(res, 404, { error: 'Chiến dịch chưa có lịch gửi.' }); return true; }
          if (m === 'POST' && sc[2]) {
            if (sc[2] === 'pause') c.send.status = 'paused';
            if (sc[2] === 'resume') c.send.status = 'scheduled';
            if (sc[2] === 'cancel') { c.send.status = 'cancelled'; S.qCancel.run(u.id, id); }
            saveCamp(u.id, id, c); json(res, 200, { ok: true, status: c.send.status }); return true;
          }
          if (m === 'GET') { const qc = S.qCounts.all(u.id, id); const counts = {}; for (const r of qc) counts[r.status] = (counts[r.status] || 0) + r.n; const { html: _h, text: _t, ...info } = c.send; json(res, 200, { send: info, counts }); return true; }
        }
        json(res, 404, { error: 'không có route này' }); return true;
      } catch (e) { json(res, e.status || 500, { error: e.message }); return true; }
    }
    return false;
  }

  // ---------- worker: sends due campaigns a little at a time (respecting each account's daily cap) ----------
  let busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      for (const row of S.campDue.all()) {
        const c = JSON.parse(row.json); const s0 = c.send;
        if (!s0 || !['scheduled', 'sending', 'waiting'].includes(s0.status) || s0.sendAt > now()) continue;
        const owner = row.owner, id = row.id;
        const sender = senders(owner).find((x) => x.id === s0.sender); if (!sender) { s0.status = 'error'; s0.lastError = 'Kênh gửi đã bị xoá'; saveCamp(owner, id, c); continue; }
        // A/B: after the test group, wait, then pick the winner and release the rest under its subject
        let variants = ['A', 'B'];
        if (s0.ab) {
          if (s0.ab.phase === 'test') variants = ['A', 'B'];
          if (s0.ab.phase === 'wait') {
            if (Date.now() - Date.parse(s0.testSentAt || now()) < s0.ab.waitHours * 3600e3) continue;
            const rows = S.evStats.all(owner, id); const score = (v) => rows.find((r) => r.variant === v && r.kind === (s0.ab.metric === 'clicks' ? 'click' : 'open'))?.u || 0;
            s0.ab.winner = score('B') > score('A') ? 'B' : 'A'; s0.ab.scores = { A: score('A'), B: score('B') }; s0.ab.phase = 'rest';
            S.qRelabel.run(s0.ab.winner, owner, id); saveCamp(owner, id, c);
          }
          if (s0.ab.phase === 'rest') variants = [s0.ab.winner, s0.ab.winner];
        }
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const left = s0.perDay - Number(S.qSentToday.get(owner, id, dayStart.toISOString()).n);
        if (left <= 0) { if (s0.status !== 'waiting') { s0.status = 'waiting'; saveCamp(owner, id, c); } continue; }
        S.qSkipSup.run(now(), owner, id, owner); // unsubscribed since the list was queued: never sent, never counted
        const batch = S.qNext.all(owner, id, variants[0], variants[1], Math.min(left, 20));
        if (!batch.length) {
          if (s0.ab && s0.ab.phase === 'test') { s0.ab.phase = 'wait'; s0.testSentAt = now(); s0.status = 'waiting'; saveCamp(owner, id, c); continue; }
          s0.status = 'done'; saveCamp(owner, id, c); log(`[mail] ${id} done`); continue;
        }
        if (s0.status !== 'sending') log(`[mail] ${id} sending via ${sender.provider} (${batch.length} in this batch)`);
        s0.status = 'sending';
        for (const r of batch) {
          if (S.supHas.get(owner, r.email)) { S.qMark.run('skipped', 'đã huỷ đăng ký', now(), '', owner, id, r.email); continue; }
          const token = makeToken(secret, owner, id, r.email, r.variant);
          let fields = { email: r.email }; try { if (r.data) fields = { ...JSON.parse(r.data), email: r.email }; } catch { /* plain row */ }
          const per = personalize(s0.html, publicUrl, token, fields);
          const subject = mergeFields(r.variant === 'B' && s0.ab ? s0.ab.subjectB : s0.subject, fields, false);
          try {
            await capped(PROV[sender.provider].send(sender, { to: r.email, subject, html: per.html, text: s0.text ? `${mergeFields(s0.text, fields, false)}\n\nHuỷ đăng ký: ${per.unsub}` : '', headers: { 'List-Unsubscribe': `<${per.unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }));
            S.qMark.run('sent', '', now(), '', owner, id, r.email);
            try { hooks.onSent?.(owner, c, r.email); } catch { /* stats only */ }
          } catch (e) {
            const msg = String(e.message || e).slice(0, 300); S.qMark.run('failed', msg, now(), '', owner, id, r.email); s0.lastError = msg;
            log(`[mail] ${id} → ${sender.provider}: ${msg}`);
            // bad key / wrong password / blocked port: stop instead of failing every address
            if (/401|403|invalid|unauthor|sai tài khoản|mật khẩu|535|không kết nối được|không phản hồi|hết thời gian kết nối/i.test(msg)) { s0.status = 'error'; break; }
          }
          await new Promise((rr) => setTimeout(rr, pace));
        }
        if (s0.status === 'sending' && s0.perDay - Number(S.qSentToday.get(owner, id, dayStart.toISOString()).n) <= 0) s0.status = 'waiting'; // cap reached: resumes tomorrow
        saveCamp(owner, id, c);
      }
    } catch (e) { log('[mail] worker:', e?.message || e); }
    finally { busy = false; }
  }
  /** One message through a stored sending account, with signed links (automations, confirmations). */
  async function sendOne(owner, senderId, { campaign, to, subject, html, text = '', fields = {}, variant = '', tracked = true }) {
    const sender = senders(owner).find((x) => x.id === senderId); if (!sender) throw new Error('Kênh gửi không còn');
    const f = { ...fields, email: to };
    let h = mergeFields(html, f), unsub = '';
    if (tracked) { const per = personalize(html, publicUrl, makeToken(secret, owner, campaign, to, variant), f); h = per.html; unsub = per.unsub; }
    await capped(PROV[sender.provider].send(sender, { to, subject: mergeFields(subject, f, false), html: h, text: text ? mergeFields(text, f, false) + (unsub ? `\n\nHuỷ đăng ký: ${unsub}` : '') : '', headers: unsub ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {} }));
    if (tracked) S.rcptAdd.run(owner, campaign, String(to).toLowerCase(), variant, now()); // automation emails get a per-person report too
  }
  return {
    handle,
    sendOne,
    campaign: camp,
    saveCampaign: saveCamp,
    suppressed: (owner, email) => !!S.supHas.get(owner, String(email).toLowerCase()),
    suppress: (owner, email, source, campaign = '') => S.supAdd.run(owner, String(email).toLowerCase(), now(), source, campaign),
    senderIds: (owner) => senders(owner).map((x) => ({ id: x.id, label: x.label || PROV[x.provider]?.label, fromEmail: x.fromEmail, fromName: x.fromName })),
    stats: (owner, id) => { const tot = Object.fromEntries(S.evTotals.all(owner, id).map((r) => [r.kind, r.u])); const qc = {}; for (const r of S.qCounts.all(owner, id)) qc[r.status] = (qc[r.status] || 0) + r.n; return { opens: Number(S.evReaders.get(owner, id).u) || 0, clicks: tot.click || 0, unsubscribes: tot.unsub || 0, queue: qc, browserSent: Number(S.rcptCount.get(owner, id).n) || 0 }; },
    people,
    campaigns: (owner) => S.campDue.all().filter((r) => r.owner === owner).map((r) => ({ id: r.id, ...JSON.parse(r.json) })),
    health: () => ({ img: !!img, tracking: true, queue: true }),
    start: () => { const t = setInterval(() => { void tick(); }, 20_000); t.unref?.(); },
    tick,
  };
}
