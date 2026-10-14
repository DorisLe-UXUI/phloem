// Phloem relay. Node >= 18, no dependencies.
//  POST /proxy                 forward one API call to Mailchimp or Klaviyo with the credential the plugin supplies
//  POST /oauth/start           begin an OAuth session -> { sessionId, url }
//  GET  /oauth/callback/:p     provider redirects here; tokens are parked under the session
//  GET  /oauth/poll/:id        plugin polls; one-shot read of the parked tokens
//  POST /oauth/refresh         refresh a Klaviyo access token
//  GET  /                      health
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { createAuth } from './auth.mjs';
import { backupConfig, restoreBackup, startBackups } from './backup.mjs';
import { siteProfile, fetchImage, safeGet } from './site.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, '..', '.env'));

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '') || `http://localhost:${PORT}`).replace(/\/$/, '');
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';
const KLAVIYO_REVISION = process.env.KLAVIYO_REVISION || '2025-07-15';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DATA_DIR = process.env.DATA_DIR || decodeURIComponent(new URL('../data/', import.meta.url).pathname);
// Ephemeral hosts: pull the last database snapshot from the backup bucket before opening it (no-op without BACKUP_S3_*).
const BACKUP = backupConfig();
if (BACKUP) { const { mkdirSync } = await import('node:fs'); mkdirSync(DATA_DIR, { recursive: true }); await restoreBackup(BACKUP, DATA_DIR); }
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || 'vankhanh.le@sentryxp.com').toLowerCase().split(/[\s,;]+/).filter(Boolean);
const AUTH = createAuth({ dataDir: DATA_DIR, secret: process.env.AUTH_SECRET || '', adminEmails: ADMIN_EMAILS, adminNeedsGoogle: process.env.ADMIN_REQUIRE_GOOGLE !== '0' });
const STARTED_AT = new Date().toISOString();
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''; // optional: e-mail the admin when someone asks for AI access
const DB = AUTH.db;
const BACKUPS = startBackups(BACKUP, DB.raw, DATA_DIR);
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const OAUTH = {
  mailchimp: {
    clientId: process.env.MAILCHIMP_CLIENT_ID || '',
    clientSecret: process.env.MAILCHIMP_CLIENT_SECRET || '',
    authorize: 'https://login.mailchimp.com/oauth2/authorize',
    token: 'https://login.mailchimp.com/oauth2/token',
    metadata: 'https://login.mailchimp.com/oauth2/metadata',
  },
  klaviyo: {
    clientId: process.env.KLAVIYO_CLIENT_ID || '',
    clientSecret: process.env.KLAVIYO_CLIENT_SECRET || '',
    authorize: 'https://www.klaviyo.com/oauth/authorize',
    token: 'https://a.klaviyo.com/oauth/token',
    scopes: process.env.KLAVIYO_SCOPES || 'accounts:read campaigns:read campaigns:write templates:read templates:write images:read images:write lists:read',
  },
};

/** Endpoints that would send or schedule mail. Refused unconditionally: the human presses send. */
const FORBIDDEN = [
  /\/campaigns\/[^/]+\/actions\/(send|schedule|test|resume)\b/i, // mailchimp
  /\/automations\/[^/]+\/actions\/(start-all-emails|pause-all-emails)/i, // mailchimp automations
  /\/automations\/[^/]+\/emails\/[^/]+\/(actions\/(start|pause)|queue)\b/i, // queueing a subscriber = sending
  /\/campaign-send-jobs/i, // klaviyo
  /\/campaign-message-send/i,
  /\/campaign-recipient-estimation-jobs/i,
];
/** Writes that could switch a flow live or send through an existing object: only reads are proxied for these. */
const READ_ONLY = [/\/flows\b/i, /\/automations\b/i];

const sessions = new Map(); // id -> { provider, verifier, state, createdAt, result }
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, s] of sessions) if (s.createdAt < cutoff) sessions.delete(id);
}, 60_000).unref();

process.on('unhandledRejection', (e) => console.error('[relay] unhandled:', e?.message || e));
process.on('uncaughtException', (e) => console.error('[relay] uncaught:', e?.message || e));

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return end(res, 204);
  let url;
  try { url = new URL(req.url, PUBLIC_URL); } catch { return json(res, 400, { error: 'URL không hợp lệ' }); }
  try {
    if (url.pathname === '/' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        service: 'phloem-relay',
        oauth: { mailchimp: !!OAUTH.mailchimp.clientId, klaviyo: !!OAUTH.klaviyo.clientId },
        tokenRequired: !!RELAY_TOKEN,
        klaviyoRevision: KLAVIYO_REVISION,
        ai: !!anthropic,
        auth: true,
        db: true,
        site: true,
        google: GOOGLE_CLIENT_ID,
        backup: BACKUPS.enabled ? { at: BACKUPS.at, kb: Math.round(BACKUPS.bytes / 1024), error: BACKUPS.error } : null,
        commit: String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7), // which build answers (Render sets RENDER_GIT_COMMIT)
        users: AUTH.count(),
      });
    }
    if (url.pathname.startsWith('/oauth/callback/')) return await oauthCallback(url, res);
    if (RELAY_TOKEN && req.headers['x-phloem-token'] !== RELAY_TOKEN) return json(res, 401, { error: 'relay token sai hoặc thiếu' });

    if (url.pathname.startsWith('/auth/')) return await authRoute(url.pathname.slice(6), req, res);
    if (url.pathname.startsWith('/db/')) return await dbRoute(url, req, res);
    if (url.pathname === '/site' && req.method === 'POST') { if (!gate(req, res)) return; return await siteRoute(await body(req), res); }
    if (url.pathname === '/csv' && req.method === 'POST') { if (!gate(req, res)) return; return await csvRoute(await body(req), res); }
    if (url.pathname === '/image' && req.method === 'GET') { if (!gate(req, res)) return; return await imageRoute(url.searchParams.get('url') || '', res); }
    if (url.pathname === '/proxy' && req.method === 'POST') { if (!RELAY_TOKEN && !AUTH.me(bearer(req)) && throttled(`proxy:${ipOf(req)}`, 400, 10 * 60_000)) return json(res, 429, { error: 'Quá nhiều request qua relay. Đăng nhập tài khoản relay để không bị giới hạn.' }); return await proxy(await body(req), res); }
    if (url.pathname === '/fetch' && req.method === 'GET') return await fetchAsset(url.searchParams.get('url') || '', res);
    if (url.pathname === '/ai' && req.method === 'POST') { if (!aiGate(req, res)) return; return await ai(await body(req), res); }
    if (url.pathname === '/ai/stream' && req.method === 'POST') { if (!aiGate(req, res)) return; return await aiStream(await body(req), req, res); }
    if (url.pathname.startsWith('/aiaccess')) return await aiAccessRoute(url.pathname.slice('/aiaccess'.length) || '/', req, res);
    if (url.pathname.startsWith('/admin/')) return await adminRoute(url.pathname.slice('/admin'.length), req, res);
    if (url.pathname === '/oauth/start' && req.method === 'POST') return oauthStart(await body(req), res);
    if (url.pathname.startsWith('/oauth/poll/') && req.method === 'GET') return oauthPoll(url.pathname.split('/').pop(), res);
    if (url.pathname === '/oauth/refresh' && req.method === 'POST') return await oauthRefresh(await body(req), res);
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`phloem-relay listening on ${PUBLIC_URL}  (token ${RELAY_TOKEN ? 'required' : 'off'}; oauth mailchimp=${!!OAUTH.mailchimp.clientId} klaviyo=${!!OAUTH.klaviyo.clientId})`);
});

// ---------- proxy ----------
async function proxy(p, res) {
  const { provider, method = 'GET', path = '/', query, headers = {}, body: reqBody, multipart, auth } = p || {};
  if (!auth) return json(res, 400, { error: 'thiếu auth' });
  if (!path.startsWith('/')) return json(res, 400, { error: 'path phải bắt đầu bằng /' });
  let base, h = { Accept: 'application/json', ...headers };
  if (provider === 'mailchimp') {
    const dc = auth.dc || (auth.apiKey || '').split('-').pop();
    if (!/^[a-z]{2,3}\d{1,2}$/i.test(dc || '')) return json(res, 400, { error: `Mailchimp data center không hợp lệ ("${dc}"). API key phải có dạng xxxx-us21.` });
    base = `https://${dc}.api.mailchimp.com/3.0`;
    h.Authorization = auth.type === 'oauth' ? `OAuth ${auth.accessToken}` : `Basic ${Buffer.from(`phloem:${auth.apiKey}`).toString('base64')}`;
  } else if (provider === 'klaviyo') {
    base = 'https://a.klaviyo.com/api';
    h.Authorization = auth.type === 'oauth' ? `Bearer ${auth.accessToken}` : `Klaviyo-API-Key ${auth.apiKey}`;
    h.revision = h.revision || KLAVIYO_REVISION;
  } else return json(res, 400, { error: 'provider không hỗ trợ' });

  const target = new URL(base + path);
  // Guard on the canonical path (dot-segments resolved, percent-escapes decoded) so no spelling of a send endpoint slips through.
  let canon; try { canon = decodeURIComponent(target.pathname); } catch { return json(res, 400, { error: 'path không hợp lệ' }); }
  if (!canon.startsWith(new URL(base).pathname + '/') && canon !== new URL(base).pathname) return json(res, 400, { error: 'path ra ngoài API' });
  if (FORBIDDEN.some((re) => re.test(canon)) || /\\/.test(path)) return json(res, 403, { error: 'Phloem không bao giờ gửi email. Hãy duyệt và bấm gửi trong Mailchimp/Klaviyo.' });
  if (String(method).toUpperCase() !== 'GET' && READ_ONLY.some((re) => re.test(canon))) return json(res, 403, { error: 'Phloem chỉ đọc automation/flow, không bật hay sửa chúng.' });
  if (query) for (const [k, v] of Object.entries(query)) target.searchParams.set(k, String(v));

  let fetchBody;
  if (multipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(multipart.fields || {})) fd.append(k, String(v));
    if (multipart.file) {
      const bytes = Buffer.from(multipart.file.base64, 'base64');
      fd.append(multipart.file.field || 'file', new Blob([bytes], { type: multipart.file.type || 'application/octet-stream' }), multipart.file.name || 'file');
    }
    fetchBody = fd;
  } else if (reqBody !== undefined && method !== 'GET') {
    h['Content-Type'] = 'application/json';
    fetchBody = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
  }

  let up;
  try { up = await fetch(target, { method, headers: h, body: fetchBody }); }
  catch (e) { return json(res, 502, { error: `Không gọi được ${target.host}: ${e?.cause?.code || e?.message || e}` }); }
  const text = await up.text();
  res.statusCode = up.status;
  res.setHeader('Content-Type', up.headers.get('content-type') || 'application/json');
  res.end(text);
}

// ---------- AI (Claude) ----------
// The plugin/studio sends {model, max_tokens, effort, system, messages}; the key stays on the server.
async function ai(p, res) {
  if (!anthropic) return json(res, 503, { error: 'Relay chưa có ANTHROPIC_API_KEY trong server/.env' });
  const { model = 'claude-opus-5-5', max_tokens = 16000, effort = 'medium', system = '', messages = [] } = p || {};
  if (!Array.isArray(messages) || !messages.length) return json(res, 400, { error: 'thiếu messages' });
  try {
    const r = await anthropic.beta.messages.create({
      model, max_tokens: Math.min(64000, Number(max_tokens) || 16000),
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      output_config: { effort },
      system, messages,
    });
    if (r.stop_reason === 'refusal') return json(res, 200, { text: '', refused: true });
    json(res, 200, { text: r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), usage: r.usage });
  } catch (e) {
    const status = e?.status || 500;
    json(res, status, { error: e?.message || String(e) });
  }
}

// Same request, answered as Server-Sent Events: `data: {"t":"…delta"}` per text chunk, then `data: {"done":true,"usage":…}`
// (or `data: {"error":"…"}`). The studio shows the design being drawn live; a comment line every 15 s keeps proxies open.
async function aiStream(p, req, res) {
  if (!anthropic) return json(res, 503, { error: 'Relay chưa có ANTHROPIC_API_KEY trong server/.env' });
  const { model = 'claude-opus-5-5', max_tokens = 16000, effort = 'medium', system = '', messages = [] } = p || {};
  if (!Array.isArray(messages) || !messages.length) return json(res, 400, { error: 'thiếu messages' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch { /* client gone */ } };
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 15_000);
  let stream = null;
  req.on('close', () => { try { stream?.abort(); } catch { /* done */ } });
  try {
    stream = anthropic.beta.messages.stream({
      model, max_tokens: Math.min(64000, Number(max_tokens) || 16000),
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      output_config: { effort },
      system, messages,
    });
    stream.on('text', (delta) => send({ t: delta }));
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ error: 'Claude từ chối yêu cầu này.', refused: true });
    else send({ done: true, stop: final.stop_reason, usage: final.usage });
  } catch (e) {
    if (!res.writableEnded) send({ error: e?.message || String(e), status: e?.status || 500 });
  } finally {
    clearInterval(ping);
    try { res.end(); } catch { /* gone */ }
  }
}

// ---------- AI access codes ----------
// Everyone can sign in; the AI (which costs the relay owner money) opens only for admins, users an admin granted, and
// users who redeemed a one-time code an admin created. Requests are logged here and mailed to the admin by the user's
// own mail app (mailto), or by Resend when RESEND_API_KEY is set.
function aiGate(req, res) {
  if (RELAY_TOKEN && req.headers['x-phloem-token'] === RELAY_TOKEN) return true;
  const row = AUTH.meRow(bearer(req));
  if (!row) { json(res, 401, { error: 'Cần đăng nhập.', code: 'expired' }); return false; }
  if (AUTH.pub(row).ai) return true;
  json(res, 403, { error: `AI cần mã truy cập. Bấm "Xin mã" để gửi yêu cầu tới ${ADMIN_EMAILS[0] || 'quản trị viên'}, rồi nhập mã nhận được.`, code: 'ai_locked' });
  return false;
}
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length]; return `PHL-${s.slice(0, 4)}-${s.slice(4)}`; };
const codeHash = (c) => createHash('sha256').update(String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
async function mailAdmin(subject, text) {
  if (!RESEND_API_KEY || !ADMIN_EMAILS.length) return false;
  try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'Phloem Studio <onboarding@resend.dev>', to: ADMIN_EMAILS, subject, text }), signal: AbortSignal.timeout(8000) }); return r.ok; } catch { return false; }
}
async function aiAccessRoute(sub, req, res) {
  try {
    const row = AUTH.meRow(bearer(req));
    if (!row) return json(res, 401, { error: 'Cần đăng nhập tài khoản relay.', code: 'expired' });
    const me = AUTH.pub(row);
    const admin = ADMIN_EMAILS[0] || '';
    if (sub === '/' && req.method === 'GET') { const r = DB.aiRequests.get(row.id); return json(res, 200, { access: me.ai, admin: me.admin, requested: r ? r.status : null, adminEmail: admin }); }
    if (sub === '/request' && req.method === 'POST') {
      if (throttled(`aireq:${row.id}`, 5, 60 * 60_000)) return json(res, 429, { error: 'Đã gửi yêu cầu, đợi quản trị viên phản hồi.' });
      const p = await body(req); const note = String(p?.note || '').slice(0, 500);
      DB.aiRequests.put(row.id, note);
      const subject = `Phloem: ${row.name} xin mã dùng AI`;
      const text = `${row.name} <${row.email}> xin mã dùng AI trong Phloem Studio.${note ? `\n\nLời nhắn: ${note}` : ''}\n\nTạo mã: mở Phloem Studio → Quản lý AI.`;
      const mailed = await mailAdmin(subject, text);
      return json(res, 200, { ok: true, mailed, mailto: `mailto:${encodeURIComponent(admin)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` });
    }
    if (sub === '/redeem' && req.method === 'POST') {
      if (throttled(`airedeem:${row.id}`, 10, 10 * 60_000)) return json(res, 429, { error: 'Nhập sai quá nhiều lần. Đợi 10 phút.' });
      const p = await body(req);
      if (!DB.aiCodes.redeem(codeHash(p?.code), row.id)) return json(res, 400, { error: 'Mã không đúng hoặc đã được dùng.' });
      DB.users.setAi(row.id, true); DB.aiRequests.done(row.id);
      return json(res, 200, { ok: true, user: AUTH.pub(DB.users.byId(row.id)) });
    }
    // ---- admin ----
    if (!me.admin) return json(res, 403, { error: 'Chỉ quản trị viên (đăng nhập bằng Google với email quản trị).' });
    if (sub === '/admin' && req.method === 'GET') return json(res, 200, { requests: DB.aiRequests.list(), users: DB.users.list(), codes: DB.aiCodes.list() });
    if (sub === '/admin/code' && req.method === 'POST') {
      const p = await body(req); const code = newCode();
      DB.aiCodes.add(`c_${randomBytes(6).toString('hex')}`, codeHash(code), p?.note || '');
      return json(res, 200, { code }); // shown once; only its hash is stored
    }
    if (sub === '/admin/grant' && req.method === 'POST') {
      const p = await body(req); const u = DB.users.byId(String(p?.userId || ''));
      if (!u) return json(res, 404, { error: 'không có người dùng này' });
      DB.users.setAi(u.id, p?.on !== false); if (p?.on !== false) DB.aiRequests.done(u.id);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'không có route này' });
  } catch (e) { return json(res, e.status || 500, { error: e.message }); }
}

// ---------- database console (admins) ----------
async function adminRoute(sub, req, res) {
  try {
    const row = AUTH.meRow(bearer(req));
    if (!row) return json(res, 401, { error: 'Cần đăng nhập.', code: 'expired' });
    if (!AUTH.isAdmin(row)) return json(res, 403, { error: 'Chỉ quản trị viên.' });
    if (sub === '/db' && req.method === 'GET') {
      const { statSync } = await import('node:fs');
      const size = (f) => { try { return statSync(f).size; } catch { return 0; } };
      return json(res, 200, {
        totals: { ...DB.admin.totals(), dbBytes: size(DB.file) + size(DB.file + '-wal') },
        backup: BACKUPS.enabled ? { at: BACKUPS.at, kb: Math.round(BACKUPS.bytes / 1024), error: BACKUPS.error, bucket: BACKUP?.bucket || '', every: BACKUP?.every || 0 } : null,
        relay: { commit: String(process.env.RENDER_GIT_COMMIT || '').slice(0, 7), startedAt: STARTED_AT, ai: !!anthropic, google: !!GOOGLE_CLIENT_ID, admins: ADMIN_EMAILS },
        users: DB.admin.users(), projects: DB.admin.projects(), assets: DB.admin.assets(),
      });
    }
    if (sub === '/backup' && req.method === 'POST') {
      if (!BACKUPS.enabled) return json(res, 400, { error: 'Chưa cấu hình sao lưu (BACKUP_S3_*).' });
      await BACKUPS.now('manual');
      return json(res, 200, { at: BACKUPS.at, kb: Math.round(BACKUPS.bytes / 1024), error: BACKUPS.error });
    }
    if (sub === '/db/export' && req.method === 'GET') {
      // a consistent copy of the whole database (VACUUM INTO), for the owner to keep or inspect with any SQLite tool
      const { readFileSync, unlinkSync } = await import('node:fs');
      const tmp = join(DATA_DIR, `export-${process.pid}-${Date.now()}.db`);
      try { DB.raw.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); const buf = readFileSync(tmp); res.statusCode = 200; res.setHeader('Content-Type', 'application/vnd.sqlite3'); res.setHeader('Content-Disposition', `attachment; filename="phloem-${new Date().toISOString().slice(0, 10)}.db"`); res.setHeader('Content-Length', buf.length); return res.end(buf); }
      finally { try { unlinkSync(tmp); } catch { /* gone */ } }
    }
    if (sub === '/user/delete' && req.method === 'POST') {
      const p = await body(req); const id = String(p?.userId || '');
      if (id === row.id) return json(res, 400, { error: 'Không tự xoá tài khoản admin đang dùng.' });
      return DB.admin.deleteUser(id) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'không có người dùng này' });
    }
    return json(res, 404, { error: 'không có route admin này' });
  } catch (e) { return json(res, e.status || 500, { error: e.message }); }
}

// ---------- asset fetch (Figma renders live on S3 without CORS) ----------
const FETCH_HOSTS = [/\.figma\.com$/i, /^figma-alpha-api\.s3\.[a-z0-9-]+\.amazonaws\.com$/i, /^s3-alpha-sig\.figma\.com$/i];
async function fetchAsset(target, res) {
  let u;
  try { u = new URL(target); } catch { return json(res, 400, { error: 'url không hợp lệ' }); }
  if (u.protocol !== 'https:' || !FETCH_HOSTS.some((re) => re.test(u.hostname))) return json(res, 403, { error: 'chỉ tải ảnh từ Figma' });
  let up;
  try { up = await fetch(u); } catch (e) { return json(res, 502, { error: String(e?.message || e) }); }
  res.statusCode = up.status;
  res.setHeader('Content-Type', up.headers.get('content-type') || 'application/octet-stream');
  res.end(Buffer.from(await up.arrayBuffer()));
}

// ---------- oauth ----------
function oauthStart(p, res) {
  const provider = p?.provider;
  const cfg = OAUTH[provider];
  if (!cfg || !cfg.clientId) return json(res, 400, { error: `OAuth ${provider} chưa cấu hình trên relay (cần CLIENT_ID/SECRET).` });
  const id = randomBytes(16).toString('hex');
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirect = `${PUBLIC_URL}/oauth/callback/${provider}`;
  const u = new URL(cfg.authorize);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('state', state);
  if (provider === 'klaviyo') {
    u.searchParams.set('scope', cfg.scopes);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('code_challenge', challenge);
  }
  sessions.set(id, { provider, state, verifier, createdAt: Date.now(), result: null });
  json(res, 200, { sessionId: id, url: u.toString() });
}

async function oauthCallback(url, res) {
  const provider = url.pathname.split('/').pop();
  const cfg = OAUTH[provider];
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  const session = [...sessions.values()].find((s) => s.state === state && s.provider === provider);
  if (!cfg || !session) return page(res, 400, 'Phiên không hợp lệ hoặc đã hết hạn', 'Quay lại Figma và bấm Kết nối lần nữa.');
  if (err || !code) { session.result = { error: err || 'no code' }; return page(res, 400, 'Kết nối bị từ chối', String(err || '')); }
  const redirect = `${PUBLIC_URL}/oauth/callback/${provider}`;
  try {
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (provider === 'klaviyo') {
      form.set('code_verifier', session.verifier);
      headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`;
    } else {
      form.set('client_id', cfg.clientId);
      form.set('client_secret', cfg.clientSecret);
    }
    const tr = await fetch(cfg.token, { method: 'POST', headers, body: form });
    const tok = await tr.json();
    if (!tr.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || `token HTTP ${tr.status}`);
    const auth = { type: 'oauth', accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined };
    if (provider === 'mailchimp') {
      const mr = await fetch(cfg.metadata, { headers: { Authorization: `OAuth ${tok.access_token}` } });
      const meta = await mr.json();
      auth.dc = meta.dc;
      auth.accountName = meta.accountname || meta.login?.login_name || '';
      auth.accountId = meta.user_id ? String(meta.user_id) : '';
    } else {
      const ar = await fetch('https://a.klaviyo.com/api/accounts', { headers: { Authorization: `Bearer ${tok.access_token}`, revision: KLAVIYO_REVISION } });
      const acc = await ar.json().catch(() => ({}));
      const a = acc?.data?.[0];
      auth.accountName = a?.attributes?.contact_information?.organization_name || (a?.attributes?.test_account ? 'Test account' : '');
      auth.accountId = a?.id || '';
      auth.scopes = tok.scope || cfg.scopes;
    }
    session.result = { auth };
    page(res, 200, 'Đã kết nối ' + (auth.accountName || provider), 'Quay lại Figma — Phloem sẽ tự nhận tài khoản trong vài giây.');
  } catch (e) {
    session.result = { error: String(e.message || e) };
    page(res, 500, 'Không đổi được token', String(e.message || e));
  }
}

function oauthPoll(id, res) {
  const s = sessions.get(id);
  if (!s) return json(res, 404, { status: 'expired' });
  if (!s.result) return json(res, 200, { status: 'pending' });
  sessions.delete(id);
  if (s.result.error) return json(res, 200, { status: 'error', error: s.result.error });
  json(res, 200, { status: 'done', auth: s.result.auth });
}

async function oauthRefresh(p, res) {
  const { provider, refreshToken } = p || {};
  const cfg = OAUTH[provider];
  if (provider !== 'klaviyo') return json(res, 400, { error: 'Chỉ Klaviyo cần refresh; token Mailchimp không hết hạn.' });
  if (!cfg.clientId) return json(res, 400, { error: 'OAuth Klaviyo chưa cấu hình trên relay' });
  const r = await fetch(cfg.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const tok = await r.json();
  if (!r.ok) return json(res, r.status, tok);
  json(res, 200, { accessToken: tok.access_token, refreshToken: tok.refresh_token || refreshToken, expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined });
}

// ---------- helpers ----------
// Accounts: register / login / me / logout. Tokens are HMAC-signed, users live in DATA_DIR/users.json.
// Password guessing and mass registration are throttled per IP (in memory; a restart resets it, which is fine).
const buckets = new Map();
function throttled(key, max, windowMs) {
  const t = Date.now(); let b = buckets.get(key);
  if (!b || t > b.reset) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  if (buckets.size > 5000) for (const [k, v] of buckets) if (t > v.reset) buckets.delete(k);
  b.n++; return b.n > max;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
async function authRoute(action, req, res) {
  try {
    const agent = String(req.headers['user-agent'] || '');
    if (req.method === 'POST' && (action === 'login' || action === 'google') && throttled(`auth:${ipOf(req)}`, 30, 10 * 60_000)) return json(res, 429, { error: 'Thử quá nhiều lần. Đợi 10 phút rồi thử lại.', code: 'server' });
    if (req.method === 'POST' && action === 'register' && throttled(`reg:${ipOf(req)}`, 10, 60 * 60_000)) return json(res, 429, { error: 'Tạo quá nhiều tài khoản từ địa chỉ này. Thử lại sau 1 giờ.', code: 'server' });
    if (action === 'register' && req.method === 'POST') return json(res, 200, await AUTH.register(await body(req), agent));
    if (action === 'login' && req.method === 'POST') return json(res, 200, await AUTH.login(await body(req), agent));
    if (action === 'me' && req.method === 'GET') {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
      const user = m ? AUTH.me(m[1]) : null;
      return json(res, user ? 200 : 401, user ? { user } : { error: 'Phiên đăng nhập hết hạn.', code: 'expired' });
    }
    if (action === 'logout' && req.method === 'POST') { AUTH.logout(bearer(req)); return json(res, 200, { ok: true }); }
    if (action === 'google' && req.method === 'POST') {
      if (!GOOGLE_CLIENT_ID) return json(res, 503, { error: 'Relay chưa cấu hình GOOGLE_CLIENT_ID.' });
      const { credential } = await body(req);
      if (!credential || typeof credential !== 'string' || credential.length > 4096) return json(res, 400, { error: 'thiếu credential' });
      let info;
      try { const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(8000) }); info = await r.json(); if (!r.ok) throw new Error(info?.error_description || 'token không hợp lệ'); }
      catch (e) { return json(res, 401, { error: `Google không xác nhận được: ${e.message}`, code: 'badpass' }); }
      if (info.aud !== GOOGLE_CLIENT_ID || String(info.email_verified) !== 'true' || !info.email) return json(res, 401, { error: 'Token Google không thuộc app này.', code: 'badpass' });
      const linked = AUTH.me(bearer(req)); // signed in already → this Google identity gets linked to that account
      return json(res, 200, await AUTH.loginWithGoogle({ sub: info.sub, email: info.email, name: info.name || info.given_name || info.email.split('@')[0], picture: info.picture || '' }, agent, linked ? linked.id : ''));
    }
    return json(res, 404, { error: 'không có route auth này' });
  } catch (e) { return json(res, e.status || 500, { error: e.message, code: e.code || 'server' }); }
}

const bearer = (req) => { const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || ''); return m ? m[1] : ''; };
function requireUser(req, res) { const u = AUTH.me(bearer(req)); if (!u) json(res, 401, { error: 'Cần đăng nhập.', code: 'expired' }); return u; }
/** Routes that spend money or reach out to the internet: a signed-in user, or the relay token when one is configured. */
function gate(req, res) { if (RELAY_TOKEN && req.headers['x-phloem-token'] === RELAY_TOKEN) return true; return !!requireUser(req, res); }
const USER_QUOTA = Number(process.env.USER_QUOTA_MB || 500) * 1048576;
const TOTAL_QUOTA = Number(process.env.TOTAL_QUOTA_MB || 5000) * 1048576;
function checkQuota(res, userId, delta) {
  const used = Number(DB.assets.usage(userId).bytes) + Number(DB.projects.count(userId).bytes);
  if (used + delta > USER_QUOTA || DB.usageAll() + delta > TOTAL_QUOTA) { json(res, 413, { error: 'Hết dung lượng lưu trữ. Hãy xoá ảnh hoặc email cũ.', code: 'quota' }); return false; }
  return true;
}
function raw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error(`body quá lớn (>${Math.round(limit / 1048576)}MB)`), { status: 413 })); req.destroy(); } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// The app database, scoped to the signed-in user: projects, assets (bytes), client profiles (encrypted), stats, sessions.
async function dbRoute(url, req, res) {
  const u = requireUser(req, res); if (!u) return;
  const [, kind, id] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (kind === 'projects') {
      if (m === 'GET' && !id) return json(res, 200, { projects: DB.projects.list(u.id), deleted: DB.projects.tombstones(u.id) });
      if (m === 'GET') { const p = DB.projects.get(u.id, id); return p ? json(res, 200, { project: p }) : json(res, 404, { error: 'không có project này' }); }
      if (m === 'PUT' && id) { const p = await body(req); if (!p || p.id !== id) return json(res, 400, { error: 'id không khớp' }); const prev = DB.projects.list(u.id).find((x) => x.id === id); if (!checkQuota(res, u.id, JSON.stringify(p).length - (prev?.size || 0))) return; const r = DB.projects.put(u.id, p); return r.stale ? json(res, 409, { error: 'Bản trên relay mới hơn.', code: 'stale', updatedAt: r.updatedAt }) : json(res, 200, r); }
      if (m === 'DELETE' && id) { DB.projects.remove(u.id, id); return json(res, 200, { ok: true }); }
    }
    if (kind === 'assets') {
      if (m === 'GET' && !id) return json(res, 200, { assets: DB.assets.list(u.id) });
      if (m === 'GET') { const a = DB.assets.get(u.id, id); if (!a) return json(res, 404, { error: 'không có ảnh này' }); res.statusCode = 200; res.setHeader('Content-Type', a.mime); res.setHeader('Content-Length', a.data.length); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); return res.end(a.data); }
      if (m === 'PUT' && id) {
        const data = await raw(req, 15 * 1024 * 1024);
        const meta = { id, name: decodeURIComponent(String(req.headers['x-asset-name'] || 'image')), mime: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0], w: Number(req.headers['x-asset-w'] || 0), h: Number(req.headers['x-asset-h'] || 0), meta: assetTags(req.headers['x-asset-meta']) };
        if (!meta.mime.startsWith('image/')) return json(res, 415, { error: 'chỉ nhận ảnh' });
        if (!checkQuota(res, u.id, data.length - (DB.assets.meta(u.id, id)?.bytes || 0))) return;
        return json(res, 200, { asset: DB.assets.put(u.id, meta, data) });
      }
      if (m === 'PATCH' && id) { const p = await body(req); const tags = assetTagsObj(p?.meta); if (p?.meta && !tags) return json(res, 400, { error: 'meta không hợp lệ' }); const a = DB.assets.patch(u.id, id, tags, p?.name); return a ? json(res, 200, { asset: a }) : json(res, 404, { error: 'không có ảnh này' }); }
      if (m === 'DELETE' && id) { DB.assets.remove(u.id, id); return json(res, 200, { ok: true }); }
    }
    if (kind === 'profiles') {
      if (m === 'GET') return json(res, 200, DB.profiles.get(u.id, AUTH.secret));
      if (m === 'PUT') { const p = await body(req); if (!Array.isArray(p?.profiles)) return json(res, 400, { error: 'profiles phải là mảng' }); return json(res, 200, DB.profiles.put(u.id, AUTH.secret, p.profiles)); }
    }
    if (kind === 'sessions') {
      if (m === 'GET') return json(res, 200, { sessions: DB.sessions.list(u.id) });
      if (m === 'DELETE') { AUTH.logoutAll(u.id); return json(res, 200, { ok: true }); }
    }
    if (kind === 'kv' && id) {
      if (m === 'GET') return json(res, 200, DB.kv.get(u.id, id));
      if (m === 'PUT') { const p = await body(req); if (!checkQuota(res, u.id, JSON.stringify(p).length)) return; return json(res, 200, DB.kv.put(u.id, id, p.value, p.updatedAt)); }
    }
    if (kind === 'stats' && m === 'GET') return json(res, 200, DB.stats(u.id));
    return json(res, 404, { error: 'không có route db này' });
  } catch (e) { return json(res, e.status || 500, { error: e.message }); }
}

// Website brand profile for the AI composer (logo, colours, fonts, headings, images) + image proxy for those images.
/** Library tags an asset carries (source website, page, project). Shape-checked and size-capped; anything else is dropped. */
function assetTags(rawHeader) {
  if (!rawHeader) return null;
  let j; try { j = JSON.parse(decodeURIComponent(String(rawHeader).slice(0, 3000))); } catch { return null; }
  return assetTagsObj(j);
}
function assetTagsObj(j) {
  if (!j || typeof j !== 'object') return null;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const out = {};
  if (j.src && typeof j.src === 'object') { const k = str(j.src.kind, 16); if (k) out.src = { kind: k, host: str(j.src.host, 120), url: str(j.src.url, 600), page: str(j.src.page, 200) }; }
  if (j.project === null || typeof j.project === 'string') out.project = j.project === null ? null : j.project.slice(0, 64);
  if (typeof j.at === 'string') out.at = j.at.slice(0, 40);
  return Object.keys(out).length ? out : null;
}
let siteBusy = 0; // a deep crawl fans out to ~10 fetches; a few at once is plenty for one relay
async function siteRoute(p, res) {
  if (siteBusy >= 4) return json(res, 429, { error: 'Relay đang đọc trang khác, thử lại sau vài giây.' });
  siteBusy++;
  try { return json(res, 200, await siteProfile(p?.url, { deep: p?.deep !== false })); }
  catch (e) { return json(res, e.status || 502, { error: `Không đọc được trang: ${e.message}` }); }
  finally { siteBusy--; }
}
async function csvRoute(p, res) {
  try {
    const { type, buf } = await safeGet(String(p?.url || ''), { accept: 'text/csv,text/plain,application/csv,*/*;q=0.5', limit: 5 * 1024 * 1024, timeout: 20_000, truncate: false });
    if (!/^(text\/|application\/(csv|octet-stream|vnd\.ms-excel))/.test(type)) return json(res, 415, { error: `không phải CSV (${type}). Với Google Sheet: File → Share → Anyone with the link, hoặc File → Publish to web → CSV.` });
    return json(res, 200, { text: buf.toString('utf8').slice(0, 5 * 1024 * 1024) });
  } catch (e) { return json(res, e.status || 502, { error: e.message }); }
}
async function imageRoute(target, res) {
  try { const { type, buf } = await fetchImage(target); res.statusCode = 200; res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'public, max-age=3600'); return res.end(buf); }
  catch (e) { return json(res, e.status || 502, { error: e.message }); }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Phloem-Token, Authorization, X-Asset-Name, X-Asset-W, X-Asset-H, X-Asset-Meta');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
}
function end(res, code) { res.statusCode = code; res.end(); }
function json(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 25 * 1024 * 1024) { reject(new Error('body quá lớn (>25MB)')); req.destroy(); } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('JSON không hợp lệ')); } });
    req.on('error', reject);
  });
}
function page(res, code, title, sub) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phloem</title>
<style>html,body{height:100%;margin:0;background:#070A08;color:#E6F4EA;font:15px/1.5 -apple-system,Inter,Segoe UI,sans-serif;display:grid;place-items:center}
.c{max-width:420px;padding:32px;border:1px solid #163A22;border-radius:14px;background:#0B110D;box-shadow:0 0 0 1px #0f2416,0 0 60px -20px #39FF14}
h1{font-size:20px;margin:0 0 8px;color:#39FF14;letter-spacing:.2px}p{margin:0;color:#9DB8A6}.k{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#39FF14;opacity:.85;margin-bottom:14px;display:block}</style></head>
<body><div class="c"><span class="k">PHLOEM · RELAY</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(sub)}</p></div></body></html>`);
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
