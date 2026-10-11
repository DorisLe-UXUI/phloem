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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, '..', '.env'));

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';
const KLAVIYO_REVISION = process.env.KLAVIYO_REVISION || '2025-07-15';

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
  /\/campaign-send-jobs/i, // klaviyo
  /\/campaign-message-send/i,
];

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
  const url = new URL(req.url, PUBLIC_URL);
  try {
    if (url.pathname === '/' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        service: 'phloem-relay',
        oauth: { mailchimp: !!OAUTH.mailchimp.clientId, klaviyo: !!OAUTH.klaviyo.clientId },
        tokenRequired: !!RELAY_TOKEN,
        klaviyoRevision: KLAVIYO_REVISION,
      });
    }
    if (url.pathname.startsWith('/oauth/callback/')) return await oauthCallback(url, res);
    if (RELAY_TOKEN && req.headers['x-phloem-token'] !== RELAY_TOKEN) return json(res, 401, { error: 'relay token sai hoặc thiếu' });

    if (url.pathname === '/proxy' && req.method === 'POST') return await proxy(await body(req), res);
    if (url.pathname === '/fetch' && req.method === 'GET') return await fetchAsset(url.searchParams.get('url') || '', res);
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
  if (FORBIDDEN.some((re) => re.test(path))) return json(res, 403, { error: 'Phloem không bao giờ gửi email. Hãy duyệt và bấm gửi trong Mailchimp/Klaviyo.' });

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
      auth.accountName = a?.attributes?.contact_information?.organization_name || a?.attributes?.test_account ? 'Test account' : (a?.attributes?.contact_information?.organization_name || '');
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
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Phloem-Token');
  res.setHeader('Access-Control-Max-Age', '600');
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
