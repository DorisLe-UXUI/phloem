// Network layer for the UI. All provider calls go through the user's relay (CORS + OAuth broker).
// If no relay URL is set, calls go direct — most browsers will block them (no CORS on Mailchimp/Klaviyo).
import type { Auth, Provider, Settings } from '../../shared/types';

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number>;
  body?: unknown;
  headers?: Record<string, string>;
  multipart?: { fields: Record<string, string>; file?: { field: string; name: string; type: string; base64: string } };
}

export interface ApiResponse { status: number; data: any; text: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) { super(message); }
  get isPermission() { return this.status === 401 || this.status === 403; }
}

export type Caller = (req: ApiRequest) => Promise<ApiResponse>;

export const KLAVIYO_REVISION = '2025-07-15';

export function describeError(provider: Provider, status: number, data: any, text: string): string {
  let msg = '';
  if (data && typeof data === 'object') {
    if (provider === 'klaviyo' && Array.isArray(data.errors) && data.errors[0]) msg = data.errors[0].detail || data.errors[0].title || '';
    else msg = data.detail || data.title || data.error || (Array.isArray(data.errors) && data.errors[0] && (data.errors[0].message || data.errors[0].detail)) || '';
    if (Array.isArray(data.errors) && provider === 'mailchimp' && data.errors[0]?.field) msg += ` (${data.errors[0].field}: ${data.errors[0].message})`;
  }
  if (!msg) msg = text.slice(0, 200) || `HTTP ${status}`;
  msg = msg.replace(/\.+$/, '');
  if (status === 401) return `Không xác thực được: ${msg}. Kiểm tra API key / đăng nhập lại.`;
  if (status === 403) return `Tài khoản không có quyền cho thao tác này: ${msg}. Phloem chỉ làm được phần được cấp quyền.`;
  if (status === 429) return `Bị giới hạn tốc độ (429). Thử lại sau vài giây.`;
  return `${msg} (HTTP ${status})`;
}

function relayHeaders(settings: Settings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.relayToken) h['X-Phloem-Token'] = settings.relayToken;
  return h;
}

export function makeCaller(settings: Settings, provider: Provider, auth: Auth): Caller {
  return async (req) => {
    let res: Response;
    if (settings.relayUrl.trim()) {
      try {
        res = await fetch(`${settings.relayUrl.replace(/\/$/, '')}/proxy`, {
          method: 'POST',
          headers: relayHeaders(settings),
          body: JSON.stringify({ provider, auth, ...req }),
        });
      } catch (e) {
        throw new ApiError(0, `Không kết nối được relay tại ${settings.relayUrl}. Chạy "npm run relay" (hoặc deploy server/) và kiểm tra URL trong Cài đặt.`);
      }
    } else {
      res = await directFetch(provider, auth, req);
    }
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new ApiError(res.status, describeError(provider, res.status, data, text), data);
    return { status: res.status, data, text };
  };
}

async function directFetch(provider: Provider, auth: Auth, req: ApiRequest): Promise<Response> {
  let base = '', authHeader = '';
  const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers || {}) };
  if (provider === 'mailchimp') {
    const dc = auth.dc || (auth.type === 'apikey' ? auth.apiKey.split('-').pop() : '');
    base = `https://${dc}.api.mailchimp.com/3.0`;
    authHeader = auth.type === 'oauth' ? `OAuth ${auth.accessToken}` : `Basic ${btoa(`phloem:${auth.apiKey}`)}`;
  } else {
    base = 'https://a.klaviyo.com/api';
    authHeader = auth.type === 'oauth' ? `Bearer ${auth.accessToken}` : `Klaviyo-API-Key ${auth.apiKey}`;
    headers.revision = headers.revision || KLAVIYO_REVISION;
  }
  headers.Authorization = authHeader;
  const url = new URL(base + req.path);
  if (req.query) for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, String(v));
  let body: BodyInit | undefined;
  if (req.multipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(req.multipart.fields)) fd.append(k, v);
    if (req.multipart.file) {
      const bin = atob(req.multipart.file.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      fd.append(req.multipart.file.field, new Blob([bytes], { type: req.multipart.file.type }), req.multipart.file.name);
    }
    body = fd;
  } else if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(req.body);
  }
  try {
    return await fetch(url.toString(), { method: req.method, headers, body });
  } catch {
    throw new ApiError(0, `Trình duyệt chặn gọi thẳng ${provider} (CORS). Điền Relay URL trong Cài đặt.`);
  }
}

// ---- relay-only endpoints ----
export interface RelayHealth { ok: boolean; oauth: { mailchimp: boolean; klaviyo: boolean }; tokenRequired: boolean; klaviyoRevision?: string }

export async function relayHealth(settings: Settings): Promise<RelayHealth> {
  const res = await fetch(settings.relayUrl.replace(/\/$/, '') + '/', { headers: relayHeaders(settings) });
  if (!res.ok) throw new Error(`Relay trả ${res.status}`);
  return res.json();
}

export async function oauthStart(settings: Settings, provider: Provider): Promise<{ sessionId: string; url: string }> {
  const res = await fetch(settings.relayUrl.replace(/\/$/, '') + '/oauth/start', { method: 'POST', headers: relayHeaders(settings), body: JSON.stringify({ provider }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function oauthPoll(settings: Settings, sessionId: string): Promise<{ status: 'pending' | 'done' | 'error' | 'expired'; auth?: Auth & { scopes?: string }; error?: string }> {
  const res = await fetch(`${settings.relayUrl.replace(/\/$/, '')}/oauth/poll/${sessionId}`, { headers: relayHeaders(settings) });
  return res.json();
}

export async function oauthRefresh(settings: Settings, provider: Provider, refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt?: number }> {
  const res = await fetch(settings.relayUrl.replace(/\/$/, '') + '/oauth/refresh', { method: 'POST', headers: relayHeaders(settings), body: JSON.stringify({ provider, refreshToken }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || data.errors?.[0]?.detail || `HTTP ${res.status}`);
  return data;
}
