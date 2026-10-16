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
import { createAssetStore, createBlobStore } from './blobs.mjs';
import { siteProfile, fetchImage, safeGet } from './site.mjs';
import { cfAccountId, fluxSize, pickLiteImageModel, sniffMime, nextUtcMidnight } from './imagegen.mjs';
import { CLIENT_KINDS, CLIENT_ROLES } from './db.mjs';
import { listDrive } from './drive.mjs';
import { createMail } from './mail.mjs';
import { createAudience } from './audience.mjs';
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
// Image generation (Phloem Design), cheapest first: Cloudflare Workers AI FLUX (free daily allowance), then Google's
// Nano Banana 2 Lite, or OpenAI images when that is the only key. Keys stay on the relay.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CF_AI_TOKEN = process.env.CF_AI_TOKEN || '';
// Pixabay API (free key): millions of vectors and illustrations usable commercially; searched through the relay so the key stays here.
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || '';
const CF_ACCOUNT = CF_AI_TOKEN ? cfAccountId() : '';
const CF_IMAGE_MODEL = process.env.CF_IMAGE_MODEL || '@cf/black-forest-labs/flux-2-klein-4b';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || (GEMINI_API_KEY ? 'google' : OPENAI_API_KEY ? 'openai' : '')).toLowerCase();
const IMAGE_AI = CF_ACCOUNT ? 'cloudflare' : IMAGE_PROVIDER; // what the app is told: anything truthy means "can paint"
let cfResting = 0; // until this time the free Workers AI allowance is used up; skip straight to Google
const DATA_DIR = process.env.DATA_DIR || decodeURIComponent(new URL('../data/', import.meta.url).pathname);
// Ephemeral hosts: pull the last database snapshot from the backup bucket before opening it (no-op without BACKUP_S3_*).
const BACKUP = backupConfig();
let RESTORED = 'off';
if (BACKUP) { const { mkdirSync } = await import('node:fs'); mkdirSync(DATA_DIR, { recursive: true }); RESTORED = await restoreBackup(BACKUP, DATA_DIR); }
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || 'vankhanh.le@sentryxp.com').toLowerCase().split(/[\s,;]+/).filter(Boolean);
const AUTH = createAuth({ dataDir: DATA_DIR, secret: process.env.AUTH_SECRET || '', adminEmails: ADMIN_EMAILS, adminNeedsGoogle: process.env.ADMIN_REQUIRE_GOOGLE !== '0' });
const STARTED_AT = new Date().toISOString();
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''; // optional: e-mail the admin when someone asks for AI access
const DB = AUTH.db;
const BACKUPS = startBackups(BACKUP, DB.raw, DATA_DIR, console.log, { paused: RESTORED === 'failed' });
// Asset bytes: files under DATA_DIR/blobs + one object each in the backup bucket; rows from before 2026-10-15 move out in the background
const ASSETS = createAssetStore({ db: DB, blobs: createBlobStore({ cfg: BACKUP, dir: join(DATA_DIR, 'blobs') }) });
if (!BACKUPS.paused) setTimeout(() => { void ASSETS.migrate(() => { try { DB.raw.exec('VACUUM'); } catch { /* busy: next boot */ } void BACKUPS.now?.('assets moved out'); }); }, 5_000).unref();
/** What health and the admin page show about durability. */
const backupInfo = () => BACKUPS.enabled ? { at: BACKUPS.at, kb: Math.round(BACKUPS.bytes / 1024), bytes: BACKUPS.bytes, ms: BACKUPS.ms, pending: BACKUPS.dirty, restore: RESTORED, error: BACKUPS.error, assetsInDb: ASSETS.migration.pending } : null;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
// Unsubscribe + suppression list, open/click tracking, hosted email images, sending accounts and the server-side queue.
const MAIL_HOOKS = {};
const MAIL = createMail({ raw: DB.raw, secret: AUTH.secret, publicUrl: PUBLIC_URL, json, body, rawBody: raw, requireUser, throttled, hooks: MAIL_HOOKS });
// Audience (lists, contacts, forms, automations): personal or per client workspace, access checked like the MKT routes
const AUD = createAudience({ raw: DB.raw, secret: AUTH.secret, publicUrl: PUBLIC_URL, json, body, rawBody: raw, requireUser, throttled, ipOf: (r) => ipOf(r), access: (userId, clientId) => DB.access(userId, clientId), can: (acc, what) => can(acc, what), mail: MAIL });
Object.assign(MAIL_HOOKS, AUD.mailHooks);

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
        imageAi: IMAGE_AI || null,
        pixabay: !!PIXABAY_API_KEY,
        imageModel: [CF_ACCOUNT ? `${CF_IMAGE_MODEL.split('/').pop()}${cfResting > Date.now() ? ' (hết lượt free hôm nay)' : ''}` : '', IMAGE_PROVIDER === 'google' ? (googleModel ? googleModel.name.replace('models/', '') : googleModel === null ? 'none' : 'auto') : IMAGE_PROVIDER === 'openai' ? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1') : ''].filter(Boolean).join(' → ') || null,
        auth: true,
        db: true,
        site: true,
        google: GOOGLE_CLIENT_ID,
        backup: backupInfo(),
        commit: String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7), // which build answers (Render sets RENDER_GIT_COMMIT)
        users: AUTH.count(),
        mail: { ...MAIL.health(), ...AUD.health() },
      });
    }
    if (url.pathname.startsWith('/oauth/callback/')) return await oauthCallback(url, res);
    // client review links: no account, no relay token, only the token in the link (it opens one item of one client)
    if (url.pathname.startsWith('/share/')) return await shareRoute(url, req, res);
    // Links inside sent emails (unsubscribe, open pixel, click): opened by recipients, so no relay token
    if (/^\/([uoc]|hooks)\//.test(url.pathname) && await MAIL.handle(url, req, res)) return;
    // signup forms and the shop's order tag (public: the page visitor is not signed in)
    if (/^\/(f|t)\//.test(url.pathname) && await AUD.handle(url, req, res)) return;
    if (RELAY_TOKEN && req.headers['x-phloem-token'] !== RELAY_TOKEN) return json(res, 401, { error: 'relay token sai hoặc thiếu' });
    if (await MAIL.handle(url, req, res)) return;
    if (await AUD.handle(url, req, res)) return;

    if (url.pathname.startsWith('/auth/')) return await authRoute(url.pathname.slice(6), req, res);
    if (url.pathname.startsWith('/db/')) return await dbRoute(url, req, res);
    if (url.pathname === '/site' && req.method === 'POST') { if (!gate(req, res)) return; return await siteRoute(await body(req), res); }
    if (url.pathname === '/drive' && req.method === 'POST') { if (!gate(req, res)) return; try { const p = await body(req); const files = await listDrive(String(p?.url || ''), async (u) => (await safeGet(u, { accept: 'text/html', limit: 3 * 1024 * 1024, timeout: 15_000, truncate: true })).buf.toString('utf8')); return json(res, 200, { files }); } catch (e) { return json(res, e.status || 502, { error: e.message }); } }
    if (url.pathname === '/csv' && req.method === 'POST') { if (!gate(req, res)) return; return await csvRoute(await body(req), res); }
    if (url.pathname === '/pixabay' && req.method === 'GET') { if (!gate(req, res)) return; return await pixabay(url.searchParams, res); }
    if (url.pathname === '/image' && req.method === 'GET') { if (!gate(req, res)) return; return await imageRoute(url.searchParams.get('url') || '', res); }
    if (url.pathname === '/proxy' && req.method === 'POST') { if (!RELAY_TOKEN && !AUTH.me(bearer(req)) && throttled(`proxy:${ipOf(req)}`, 400, 10 * 60_000)) return json(res, 429, { error: 'Quá nhiều request qua relay. Đăng nhập tài khoản relay để không bị giới hạn.' }); return await proxy(await body(req), res); }
    if (url.pathname === '/fetch' && req.method === 'GET') return await fetchAsset(url.searchParams.get('url') || '', res);
    if (url.pathname === '/ai' && req.method === 'POST') { if (!aiGate(req, res)) return; return await ai(await body(req), res); }
    if (url.pathname === '/ai/image' && req.method === 'POST') { if (!aiGate(req, res)) return; if (throttled(`img:${ipOf(req)}`, 30, 10 * 60_000)) return json(res, 429, { error: 'Tạo ảnh quá nhiều trong 10 phút. Đợi một chút.' }); return await aiImage(await body(req), res); }
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

MAIL.start();
AUD.start();
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
/** Server-side fallback (Opus 5.5 → Opus 4.8 when overloaded) exists for Opus models only; other models reject the field. */
const fallbackOpts = (model) => (/^claude-opus-5/.test(String(model)) ? { betas: ['server-side-fallback-2026-06-01'], fallbacks: [{ model: 'claude-opus-4-8' }] } : {});
// The plugin/studio sends {model, max_tokens, effort, system, messages}; the key stays on the server.
async function ai(p, res) {
  if (!anthropic) return json(res, 503, { error: 'Relay chưa có ANTHROPIC_API_KEY trong server/.env' });
  const { model = 'claude-opus-5-5', max_tokens = 16000, effort = 'medium', system = '', messages = [] } = p || {};
  if (!Array.isArray(messages) || !messages.length) return json(res, 400, { error: 'thiếu messages' });
  try {
    const r = await anthropic.beta.messages.create({
      model, max_tokens: Math.min(64000, Number(max_tokens) || 16000),
      ...fallbackOpts(model),
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
  // the browser left (tab closed, dialog stopped): stop paying for the rest of the answer. res 'close' fires on disconnect;
  // req 'close' fires as soon as the request body has been read, so it never caught a disconnect.
  res.on('close', () => { if (!res.writableFinished) { try { stream?.abort(); } catch { /* done */ } } });
  try {
    stream = anthropic.beta.messages.stream({
      model, max_tokens: Math.min(64000, Number(max_tokens) || 16000),
      ...fallbackOpts(model),
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

// ---------- AI images ----------
// {prompt, aspect: '1:1'|'3:4'|'4:3'|'9:16'|'16:9'} → {b64, mime, provider}. Google Imagen (Gemini API, model IMAGEN_MODEL)
// or OpenAI (OPENAI_IMAGE_MODEL). The browser never sees a key; the same AI access gate as /ai applies.
const ASPECTS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);
/** The image model this Google key may use, found once via ListModels: IMAGEN_MODEL when set, else Nano Banana 2 Lite
 *  (Gemini Flash-Lite Image) only: the costlier Imagen / Flash Image models are never picked on their own. Cached; cleared on a 404. */
let googleModel; // undefined = not looked up yet, null = none
async function googleImageModel() {
  if (googleModel !== undefined) return googleModel;
  if (process.env.IMAGEN_MODEL) return (googleModel = { name: `models/${process.env.IMAGEN_MODEL.replace(/^models\//, '')}`, method: /imagen/i.test(process.env.IMAGEN_MODEL) ? 'predict' : 'generateContent' });
  const all = [];
  try {
    let page = '';
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: { 'x-goog-api-key': GEMINI_API_KEY }, signal: AbortSignal.timeout(20_000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log('[image] ListModels failed:', j?.error?.message || r.status); break; }
      all.push(...(j.models || []));
      if (!j.nextPageToken) break; page = j.nextPageToken;
    }
  } catch (e) { console.log('[image] ListModels error:', e?.message || e); return null; } // network: try again next time
  const lite = pickLiteImageModel(all);
  googleModel = lite ? { name: lite.name, method: 'generateContent' } : null;
  console.log(`[image] google model: ${googleModel ? googleModel.name : 'none (no Flash-Lite Image model on this key)'} (${all.length} models listed; image models: ${all.filter((m) => /image/i.test(m.name)).map((m) => m.name.replace('models/', '')).join(', ') || 'none'})`);
  return googleModel;
}
/** FLUX on Cloudflare Workers AI → { b64, mime } or { error, status }. A used-up daily allowance rests it until 00:00 UTC. */
async function cloudflareImage(prompt, aspect, refs = []) {
  const [width, height] = fluxSize(aspect);
  const form = new FormData();
  form.set('prompt', prompt); form.set('width', String(width)); form.set('height', String(height));
  refs.forEach((r, i) => form.set(`input_image_${i}`, new Blob([Buffer.from(r.b64, 'base64')], { type: r.mime }), `ref${i}.${r.mime === 'image/png' ? 'png' : 'jpg'}`));
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${CF_IMAGE_MODEL}`, { method: 'POST', headers: { Authorization: `Bearer ${CF_AI_TOKEN}` }, body: form, signal: AbortSignal.timeout(90_000) });
  const j = await r.json().catch(() => ({}));
  const b64 = j?.result?.image;
  if (r.ok && b64) return { b64, mime: sniffMime(b64) };
  const msg = String(j?.errors?.[0]?.message || `HTTP ${r.status}`);
  if (r.status === 429 || /neuron|allocation|quota|limit/i.test(msg)) { cfResting = nextUtcMidnight(); console.log('[image] cloudflare free allowance used up until 00:00 UTC:', msg.slice(0, 160)); return { error: 'Hết lượt tạo ảnh miễn phí hôm nay (Cloudflare)', status: 429 }; }
  console.log('[image] cloudflare error:', r.status, msg.slice(0, 200));
  return { error: `Cloudflare: ${msg.slice(0, 200)}`, status: r.status === 400 ? 422 : 502 };
}
async function aiImage(p, res) {
  const prompt = String(p?.prompt || '').trim().slice(0, 2000);
  const aspect = ASPECTS.has(p?.aspect) ? p.aspect : '1:1';
  if (!prompt) return json(res, 400, { error: 'Thiếu mô tả ảnh.' });
  // reference pictures (the client's real product, place, characters) the model must keep: up to 4, JPEG/PNG/WebP, ≤ 3 MB each
  const refs = (Array.isArray(p?.refs) ? p.refs : []).slice(0, 4)
    .map((r) => ({ b64: String(r?.b64 || '').replace(/^data:[^,]+,/, ''), mime: /^image\/(png|jpeg|webp)$/.test(r?.mime) ? r.mime : 'image/jpeg' }))
    .filter((r) => r.b64.length > 100 && r.b64.length < 4_000_000);
  if (!IMAGE_AI) return json(res, 503, { error: 'Relay chưa có key tạo ảnh. Thêm CF_AI_TOKEN (Cloudflare, miễn phí theo ngày) hoặc GEMINI_API_KEY trong Render → Environment.', code: 'no_image_key' });
  let cfError = '';
  if (CF_ACCOUNT && cfResting <= Date.now()) {
    const out = await cloudflareImage(prompt, aspect, refs).catch((e) => ({ error: String(e?.message || e) }));
    if (out.b64) return json(res, 200, { ...out, provider: 'cloudflare', model: CF_IMAGE_MODEL.split('/').pop() });
    cfError = out.error;
    if (!IMAGE_PROVIDER) return json(res, out.status || 502, { error: out.error });
  }
  try {
    if (IMAGE_PROVIDER === 'google') {
      const pick = await googleImageModel();
      if (!pick) return json(res, 502, { error: `${cfError ? `Cloudflare: ${cfError}. ` : ''}Key Google này chưa có Nano Banana 2 Lite (gemini-3.1-flash-lite-image). Bật model này cho project của key trong Google AI Studio, hoặc đặt IMAGEN_MODEL trong Render.` });
      const base = `https://generativelanguage.googleapis.com/v1beta/${pick.name}`;
      const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY };
      const r = pick.method === 'predict'
        ? await fetch(`${base}:predict`, { method: 'POST', headers, body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect } }), signal: AbortSignal.timeout(110_000) })
        : await fetch(`${base}:generateContent`, { method: 'POST', headers, body: JSON.stringify({ contents: [{ role: 'user', parts: [...refs.map((r) => ({ inlineData: { mimeType: r.mime, data: r.b64 } })), { text: `${refs.length ? `The ${refs.length} attached picture(s) are the brand's REAL references: keep their subjects, characters, products and art style faithful.\n\n` : ''}${prompt}\n\nAspect ratio ${aspect}. Output one image only.` }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }), signal: AbortSignal.timeout(110_000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 404) googleModel = undefined;
        const msg = String(j?.error?.message || `HTTP ${r.status}`);
        // free-tier keys get an image quota of 0: say what to do instead of Google's raw quota dump
        if (r.status === 429 && /free_tier|limit: 0/.test(msg)) return json(res, 429, { error: 'Key Gemini đang ở gói miễn phí: Google không cho tạo ảnh ở gói này (hạn mức = 0). Vào Google AI Studio → Billing, bật thanh toán cho project của key (trả theo số ảnh), rồi thử lại. Hoặc dùng OPENAI_API_KEY.', code: 'image_billing' });
        return json(res, r.status === 429 ? 429 : 502, { error: `Google (${pick.name.replace('models/', '')}): ${msg.slice(0, 300)}` });
      }
      const pred = j?.predictions?.[0];
      const part = (j?.candidates?.[0]?.content?.parts || []).find((x) => x?.inlineData?.data || x?.inline_data?.data);
      const b64 = pred?.bytesBase64Encoded || part?.inlineData?.data || part?.inline_data?.data;
      if (!b64) return json(res, 422, { error: 'Google không trả ảnh (có thể mô tả bị bộ lọc an toàn chặn). Đổi mô tả rồi thử lại.' });
      return json(res, 200, { b64, mime: pred?.mimeType || part?.inlineData?.mimeType || part?.inline_data?.mime_type || 'image/png', provider: 'google', model: pick.name.replace('models/', '') });
    }
    const size = aspect === '1:1' ? '1024x1024' : aspect === '9:16' || aspect === '3:4' ? '1024x1536' : '1536x1024';
    const r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size, n: 1 }), signal: AbortSignal.timeout(110_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json(res, r.status === 429 ? 429 : 502, { error: `OpenAI: ${j?.error?.message || `HTTP ${r.status}`}` });
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return json(res, 422, { error: 'OpenAI không trả ảnh. Đổi mô tả rồi thử lại.' });
    return json(res, 200, { b64, mime: 'image/png', provider: 'openai' });
  } catch (e) { return json(res, 502, { error: `Không tạo được ảnh: ${e?.message || e}` }); }
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
  try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'Phloem Email <onboarding@resend.dev>', to: ADMIN_EMAILS, subject, text }), signal: AbortSignal.timeout(8000) }); return r.ok; } catch { return false; }
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
      const text = `${row.name} <${row.email}> xin mã dùng AI trong Phloem Email.${note ? `\n\nLời nhắn: ${note}` : ''}\n\nTạo mã: mở Phloem Email → Quản lý AI.`;
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
        backup: BACKUPS.enabled ? { ...backupInfo(), bucket: BACKUP?.bucket || '', every: BACKUP?.every || 0 } : null,
        relay: { commit: String(process.env.RENDER_GIT_COMMIT || '').slice(0, 7), startedAt: STARTED_AT, ai: !!anthropic, google: !!GOOGLE_CLIENT_ID, admins: ADMIN_EMAILS },
        users: DB.admin.users(), projects: DB.admin.projects(), assets: DB.admin.assets(),
      });
    }
    if (sub === '/backup' && req.method === 'POST') {
      if (!BACKUPS.enabled) return json(res, 400, { error: 'Chưa cấu hình sao lưu (BACKUP_S3_*).' });
      await BACKUPS.now('manual');
      return json(res, 200, backupInfo());
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
      const keys = ASSETS.keysOf(id); // rows cascade away with the user; their bytes are separate objects
      if (!DB.admin.deleteUser(id)) return json(res, 404, { error: 'không có người dùng này' });
      await ASSETS.removeKeys(keys);
      return json(res, 200, { ok: true });
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
  const [, kind, id, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (kind === 'clients' || kind === 'client') return await clientsRoute(u, kind, id, rest, url, req, res);
    if (kind === 'projects') {
      if (m === 'GET' && !id) return json(res, 200, { projects: DB.projects.list(u.id), deleted: DB.projects.tombstones(u.id) });
      if (m === 'GET') { const p = DB.projects.get(u.id, id); return p ? json(res, 200, { project: p }) : json(res, 404, { error: 'không có project này' }); }
      if (m === 'PUT' && id) { const p = await body(req); if (!p || p.id !== id) return json(res, 400, { error: 'id không khớp' }); const prev = DB.projects.list(u.id).find((x) => x.id === id); if (!checkQuota(res, u.id, JSON.stringify(p).length - (prev?.size || 0))) return; const r = DB.projects.put(u.id, p); return r.stale ? json(res, 409, { error: 'Bản trên relay mới hơn.', code: 'stale', updatedAt: r.updatedAt }) : json(res, 200, r); }
      if (m === 'DELETE' && id) { DB.projects.remove(u.id, id); return json(res, 200, { ok: true }); }
    }
    if (kind === 'assets') {
      if (m === 'GET' && !id) return json(res, 200, { assets: ASSETS.list(u.id) });
      if (m === 'GET') { const a = await ASSETS.get(u.id, id); if (!a) return json(res, 404, { error: 'không có ảnh này' }); res.statusCode = 200; res.setHeader('Content-Type', a.mime); res.setHeader('Content-Length', a.data.length); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); return res.end(a.data); }
      if (m === 'PUT' && id) {
        const data = await raw(req, 15 * 1024 * 1024);
        const meta = { id, name: decodeURIComponent(String(req.headers['x-asset-name'] || 'image')), mime: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0], w: Number(req.headers['x-asset-w'] || 0), h: Number(req.headers['x-asset-h'] || 0), meta: assetTags(req.headers['x-asset-meta']) };
        if (!meta.mime.startsWith('image/')) return json(res, 415, { error: 'chỉ nhận ảnh' });
        if (!checkQuota(res, u.id, data.length - (DB.assets.meta(u.id, id)?.bytes || 0))) return;
        const a = await ASSETS.put(u.id, meta, data);
        return a ? json(res, 200, { asset: a }) : json(res, 409, { error: 'id ảnh đã được dùng' });
      }
      if (m === 'PATCH' && id) { const p = await body(req); const tags = assetTagsObj(p?.meta); if (p?.meta && !tags) return json(res, 400, { error: 'meta không hợp lệ' }); const a = ASSETS.patch(u.id, id, tags, p?.name); return a ? json(res, 200, { asset: a }) : json(res, 404, { error: 'không có ảnh này' }); }
      if (m === 'DELETE' && id) { await ASSETS.remove(u.id, id); return json(res, 200, { ok: true }); }
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

// ---------- Phloem MKT: clients (one workspace per client of the agency) ----------
//  GET    /db/clients                         own clients + clients shared with me (with my role)
//  PUT    /db/clients/:id                     create / update (owner, manager)
//  DELETE /db/clients/:id?confirm=<name>      remove the client and everything filed under it (owner, name typed back)
//  GET    /db/client/:id/items[?kind=]        records of that client      PUT|DELETE /db/client/:id/items/:kind/:itemId
//  GET    /db/client/:id/audit                who did what                GET /db/client/:id/export   everything, one JSON
//  GET|POST /db/client/:id/share              review links (list / create)  DELETE /db/client/:id/share/:linkId
//  GET|PUT|DELETE /db/client/:id/members[/:email]  teammates and their role (owner only writes)
// Every request resolves the caller's access to THAT client first (owner or member) and then works as the client's
// owner on owner-scoped statements: a client id from the browser never reaches data the caller cannot open.
const ROLE_CAN = {
  owner: new Set(['read', 'write', 'manage', 'admin']),
  manager: new Set(['read', 'write', 'manage']),
  designer: new Set(['read', 'write']), content: new Set(['read', 'write']), ads: new Set(['read', 'write']),
  client_viewer: new Set(['read']),
};
const can = (acc, what) => !!acc && !!ROLE_CAN[acc.role]?.has(what);
const CLIENT_FIELDS = ['logo', 'industry', 'website', 'timezone', 'currency', 'status', 'lead', 'color', 'note', 'language', 'market'];
function cleanClient(p, id) {
  const out = { id, name: String(p?.name || '').trim().slice(0, 120) || 'Khách hàng' };
  for (const k of CLIENT_FIELDS) if (typeof p?.[k] === 'string') out[k] = p[k].slice(0, k === 'logo' ? 200_000 : 600);
  if (typeof p?.updatedAt === 'string') out.updatedAt = p.updatedAt;
  if (typeof p?.createdAt === 'string') out.createdAt = p.createdAt;
  return out;
}
async function clientsRoute(u, kind, id, rest, url, req, res) {
  const m = req.method;
  const actor = u.name || u.email;
  if (kind === 'clients') {
    if (m === 'GET' && !id) return json(res, 200, { clients: [...DB.clients.list(u.id).map((c) => ({ ...c, role: 'owner' })), ...DB.members.clientsOf(u.id)] });
    if (!id || !/^[\w-]{1,64}$/.test(id)) return json(res, 400, { error: 'id khách hàng không hợp lệ' });
    const acc = DB.access(u.id, id);
    if (m === 'PUT') {
      const body0 = await body(req);
      if (acc && !can(acc, 'manage')) return json(res, 403, { error: 'Bạn không có quyền sửa khách hàng này.' });
      const owner = acc ? acc.owner : u.id; // new id → the caller creates it and owns it
      if (!acc && DB.clients.list(u.id).length >= 500) return json(res, 400, { error: 'Tối đa 500 khách hàng mỗi tài khoản.' });
      const r = DB.clients.put(owner, cleanClient(body0, id));
      if (r.forbidden) return json(res, 403, { error: 'Không có quyền với khách hàng này.' });
      if (r.stale) return json(res, 409, { error: 'Bản trên relay mới hơn.', code: 'stale', updatedAt: r.updatedAt });
      DB.audit.add(owner, id, actor, acc ? 'client.update' : 'client.create', String(body0?.name || '').slice(0, 120));
      return json(res, 200, r);
    }
    if (m === 'DELETE') {
      if (!acc || acc.role !== 'owner') return json(res, 403, { error: 'Chỉ chủ workspace xoá được khách hàng.' });
      const c = DB.clients.get(u.id, id);
      const typed = String(url.searchParams.get('confirm') || '').trim().toLowerCase();
      if (!c || typed !== c.name.trim().toLowerCase()) return json(res, 400, { error: 'Gõ đúng tên khách hàng để xác nhận xoá.', code: 'confirm' });
      DB.clients.remove(u.id, id);
      console.log(`[mkt] client ${id} removed by ${u.email}`);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'không có route này' });
  }
  // /db/client/:id/...
  const acc = DB.access(u.id, String(id || ''));
  if (!acc) return json(res, 404, { error: 'Không có khách hàng này, hoặc bạn không có quyền xem.' });
  const owner = acc.owner, [sub, a, b] = rest;
  if (sub === 'items') {
    if (m === 'GET' && !a) { const k = url.searchParams.get('kind'); if (k && !CLIENT_KINDS.has(k)) return json(res, 400, { error: 'loại dữ liệu không hợp lệ' }); return json(res, 200, { items: DB.items.list(owner, id, k || undefined), role: acc.role }); }
    if (!CLIENT_KINDS.has(a) || !b || !/^[\w.:-]{1,80}$/.test(b)) return json(res, 400, { error: 'loại hoặc id không hợp lệ' });
    if (m === 'GET') { const i = DB.items.get(owner, id, a, b); return i ? json(res, 200, { item: i }) : json(res, 404, { error: 'không có mục này' }); }
    if (!can(acc, 'write')) return json(res, 403, { error: 'Vai trò của bạn chỉ được xem.' });
    if (m === 'PUT') {
      const p = await body(req);
      const size = JSON.stringify(p?.data ?? null).length;
      if (size > 2 * 1048576) return json(res, 413, { error: 'Dữ liệu quá lớn (>2MB).' });
      if (!checkQuota(res, owner, size)) return;
      const prev = DB.items.get(owner, id, a, b);
      const r = DB.items.put(owner, id, a, b, p?.data ?? null, typeof p?.updatedAt === 'string' ? p.updatedAt : undefined);
      if (r.forbidden) return json(res, 403, { error: 'Không có quyền.' });
      if (r.stale) return json(res, 409, { error: 'Bản trên relay mới hơn.', code: 'stale', updatedAt: DB.items.get(owner, id, a, b)?.updatedAt });
      const st = p?.data && typeof p.data === 'object' ? p.data.status : undefined;
      if (!prev) DB.audit.add(owner, id, actor, `${a}.create`, String(p?.data?.title || b).slice(0, 120));
      else if (st && st !== prev.data?.status) DB.audit.add(owner, id, actor, `${a}.status`, `${String(p?.data?.title || b).slice(0, 80)} → ${st}`);
      return json(res, 200, r);
    }
    if (m === 'DELETE') { const ok = DB.items.remove(owner, id, a, b); if (ok) DB.audit.add(owner, id, actor, `${a}.delete`, b); return json(res, 200, { ok }); }
  }
  if (sub === 'audit' && m === 'GET') return json(res, 200, { audit: DB.audit.list(owner, id) });
  if (sub === 'export' && m === 'GET') {
    if (!can(acc, 'manage')) return json(res, 403, { error: 'Chỉ chủ workspace hoặc quản lý được xuất dữ liệu.' });
    DB.audit.add(owner, id, actor, 'client.export', '');
    const projects = DB.projects.list(owner).filter((p) => p.clientId === id).map((p) => DB.projects.get(owner, p.id));
    return json(res, 200, { exportedAt: new Date().toISOString(), client: DB.clients.get(owner, id), items: DB.items.list(owner, id), audit: DB.audit.list(owner, id), members: DB.members.list(owner, id), shares: DB.shares.list(owner, id), projects });
  }
  if (sub === 'share') {
    if (!can(acc, 'write')) return json(res, 403, { error: 'Vai trò của bạn không tạo được link duyệt.' });
    if (m === 'GET') return json(res, 200, { shares: DB.shares.list(owner, id) });
    if (m === 'POST') {
      const p = await body(req); const k = String(p?.kind || ''), itemId = String(p?.itemId || '');
      if (!['brand', 'plan', 'post'].includes(k) || !DB.items.get(owner, id, k, itemId)) return json(res, 400, { error: 'Không có mục này để gửi duyệt.' });
      const days = Math.max(1, Math.min(90, Number(p?.days) || 30));
      const token = DB.shares.create(owner, id, k, itemId, days);
      if (!token) return json(res, 403, { error: 'Không tạo được link.' });
      DB.audit.add(owner, id, actor, 'share.create', `${k} ${itemId} · ${days} ngày`);
      return json(res, 200, { token, days });
    }
    if (m === 'DELETE' && a) { const ok = DB.shares.revoke(owner, id, a); if (ok) DB.audit.add(owner, id, actor, 'share.revoke', a); return json(res, 200, { ok }); }
  }
  if (sub === 'members') {
    if (m === 'GET') return json(res, 200, { members: DB.members.list(owner, id), roles: CLIENT_ROLES, me: acc.role });
    if (acc.role !== 'owner') return json(res, 403, { error: 'Chỉ chủ workspace thêm hoặc bớt thành viên.' });
    const who = DB.users.byEmail(String(a || '').trim().toLowerCase());
    if (!who) return json(res, 404, { error: 'Email này chưa có tài khoản Phloem. Nhờ họ đăng ký trước.' });
    if (m === 'PUT') { const p = await body(req); if (!DB.members.put(owner, id, who.id, String(p?.role || ''))) return json(res, 400, { error: 'Vai trò không hợp lệ.' }); DB.audit.add(owner, id, actor, 'member.set', `${who.email} → ${p.role}`); return json(res, 200, { ok: true }); }
    if (m === 'DELETE') { const ok = DB.members.remove(owner, id, who.id); if (ok) DB.audit.add(owner, id, actor, 'member.remove', who.email); return json(res, 200, { ok }); }
  }
  return json(res, 404, { error: 'không có route này' });
}

// Public review link (/share/:token): the client sees exactly one item of their own workspace, approves or asks for
// changes per row, comments. Writes go to a `review` record of that client only, each one logged as "Khách: <name>".
const REVIEW_STATUS = new Set(['approved', 'changes', 'pending']);
async function shareRoute(url, req, res) {
  const [, token, action] = url.pathname.split('/').filter(Boolean);
  if (throttled(`share:${ipOf(req)}`, req.method === 'GET' ? 240 : 60, 10 * 60_000)) return json(res, 429, { error: 'Quá nhiều yêu cầu. Thử lại sau ít phút.' });
  const sh = DB.shares.resolve(token);
  if (!sh) return json(res, 404, { error: 'Link duyệt không còn hiệu lực. Nhờ agency gửi link mới.', code: 'expired' });
  const item = DB.items.get(sh.owner, sh.clientId, sh.kind, sh.itemId);
  if (!item) return json(res, 404, { error: 'Nội dung này đã bị xoá.', code: 'gone' });
  const reviewId = `${sh.kind}-${sh.itemId}`.slice(0, 80);
  const review = DB.items.get(sh.owner, sh.clientId, 'review', reviewId)?.data || { rows: {}, comments: [], overall: null };
  if (req.method === 'GET' && !action) {
    const c = sh.client || {};
    return json(res, 200, { client: { name: sh.clientName, logo: c.logo || '', color: c.color || '', language: c.language || 'vi' }, kind: sh.kind, itemId: sh.itemId, data: item.data, updatedAt: item.updatedAt, review, expiresAt: sh.expiresAt });
  }
  if (req.method === 'POST' && action === 'review') {
    const p = await body(req);
    const name = String(p?.name || '').trim().slice(0, 80);
    if (!name) return json(res, 400, { error: 'Nhập tên của bạn trước khi gửi.' });
    const rowIds = new Set(Array.isArray(item.data?.rows) ? item.data.rows.map((r) => String(r?.id)) : []);
    const at = new Date().toISOString();
    const next = { rows: { ...(review.rows || {}) }, comments: Array.isArray(review.comments) ? review.comments.slice(-500) : [], overall: review.overall || null };
    let n = 0;
    for (const [rid, st] of Object.entries(p?.rows || {}).slice(0, 2000)) {
      if (!rowIds.has(rid) || !REVIEW_STATUS.has(st)) continue;
      next.rows[rid] = { status: st, by: name, at }; n++;
    }
    for (const c of (Array.isArray(p?.comments) ? p.comments : []).slice(0, 50)) {
      const text = String(c?.text || '').trim().slice(0, 1000); if (!text) continue;
      const row = c?.row && rowIds.has(String(c.row)) ? String(c.row) : null;
      next.comments.push({ row, text, by: name, at });
    }
    if (REVIEW_STATUS.has(p?.overall)) next.overall = { status: p.overall, by: name, at };
    const detail = [n ? `${n} hàng` : '', next.overall?.at === at ? `tổng: ${p.overall}` : '', p?.comments?.length ? `${p.comments.length} bình luận` : ''].filter(Boolean).join(' · ');
    DB.shares.write(sh, 'review', reviewId, next, name, `${sh.kind}.review`, detail || 'xem');
    return json(res, 200, { ok: true, review: next });
  }
  return json(res, 404, { error: 'không có route này' });
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
  if (j.client === null || typeof j.client === 'string') out.client = j.client === null ? null : j.client.slice(0, 64); // Phloem MKT: which client's library
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
/** Pixabay search (vectors / illustrations / photos), cached 24 h as Pixabay asks. Returns { hits:[{ id, w, h, thumb, preview, large, tags, user, page }] }. */
const pixabayCache = new Map();
async function pixabay(sp, res) {
  if (!PIXABAY_API_KEY) return json(res, 503, { error: 'Relay chưa có PIXABAY_API_KEY (lấy miễn phí ở pixabay.com/api/docs, dán vào Render → Environment).', code: 'no_pixabay' });
  const q = String(sp.get('q') || '').slice(0, 100), type = ['vector', 'illustration', 'photo', 'all'].includes(sp.get('type')) ? sp.get('type') : 'vector';
  const page = Math.max(1, Math.min(20, Number(sp.get('page')) || 1)), lang = /^[a-z]{2}$/.test(sp.get('lang') || '') ? sp.get('lang') : 'vi';
  const key = `${q}|${type}|${page}|${lang}`;
  const hit = pixabayCache.get(key);
  if (hit && hit.at > Date.now() - 24 * 3600e3) return json(res, 200, hit.body);
  const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(PIXABAY_API_KEY)}&q=${encodeURIComponent(q)}&image_type=${type}&lang=${lang}&safesearch=true&per_page=40&page=${page}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return json(res, 502, { error: `Pixabay HTTP ${r ? r.status : 'lỗi mạng'}` });
  const j = await r.json().catch(() => ({}));
  const body = { total: j.totalHits || 0, hits: (j.hits || []).map((x) => ({ id: x.id, w: x.imageWidth, h: x.imageHeight, thumb: x.previewURL, preview: x.webformatURL, large: x.largeImageURL, tags: x.tags, user: x.user, page: x.pageURL })) };
  if (pixabayCache.size > 500) pixabayCache.clear();
  pixabayCache.set(key, { at: Date.now(), body });
  return json(res, 200, body);
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
