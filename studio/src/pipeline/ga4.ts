// Google Analytics 4, read-only, from the browser: the signed-in Google account's properties and the purchases whose
// session came from email (utm_medium=email). Token stays in memory; nothing is stored on the relay.
import { relayInfo } from '../auth/core';
import { loadGis } from '../ui/GoogleButton';

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
let tok: { token: string; exp: number } | null = null;
export const gaConnected = () => !!tok && tok.exp > Date.now() + 30_000;

export async function connectGA(): Promise<void> {
  const clientId = (await relayInfo())?.google;
  if (!clientId) throw new Error('Relay chưa cấu hình Google (GOOGLE_CLIENT_ID).');
  await loadGis();
  const g = (window as unknown as { google?: any }).google;
  const t: { access_token: string; expires_in: number } = await new Promise((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE, include_granted_scopes: true,
      callback: (r: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => (r.access_token ? resolve(r as { access_token: string; expires_in: number }) : reject(new Error(r.error_description || r.error || 'Google từ chối'))),
      error_callback: (e: { type?: string; message?: string }) => reject(new Error(e?.type === 'popup_closed' ? 'Đã đóng cửa sổ Google.' : e?.message || 'Không mở được cửa sổ Google (trình duyệt chặn popup?)')),
    });
    client.requestAccessToken();
  });
  tok = { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 };
}

/** Readable errors, including the one-click link Google gives when an API is not enabled for the project yet. */
async function call<T>(url: string, body?: unknown): Promise<T> {
  if (!gaConnected()) throw new Error('Kết nối Google Analytics trước.');
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${tok!.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j as T;
  const msg: string = j?.error?.message || `HTTP ${r.status}`;
  const link = (j?.error?.details || []).flatMap((d: { metadata?: { activationUrl?: string }; links?: { url: string }[] }) => [d.metadata?.activationUrl, ...(d.links || []).map((l) => l.url)]).find(Boolean) || (/https:\/\/console\.developers\.google\.com\/\S+/.exec(msg) || [])[0];
  if (r.status === 401) { tok = null; throw new Error('Phiên Google hết hạn. Kết nối lại.'); }
  if (r.status === 403 && /has not been used|disabled/i.test(msg)) throw Object.assign(new Error('API Google Analytics chưa được bật cho dự án Google của Phloem.'), { link });
  if (r.status === 403) throw new Error('Tài khoản Google này không có quyền xem property đó.');
  throw Object.assign(new Error(`Google Analytics: ${msg}`), { status: r.status });
}

export interface GaProperty { id: string; name: string; account: string }
export async function gaProperties(): Promise<GaProperty[]> {
  const j = await call<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[] }>('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200');
  return (j.accountSummaries || []).flatMap((a) => (a.propertySummaries || []).map((p) => ({ id: p.property.replace('properties/', ''), name: p.displayName, account: a.displayName })));
}
export async function gaPropertyInfo(id: string): Promise<{ timeZone: string; currencyCode: string }> {
  const j = await call<{ timeZone?: string; currencyCode?: string }>(`https://analyticsadmin.googleapis.com/v1beta/properties/${id}`);
  return { timeZone: j.timeZone || 'Asia/Ho_Chi_Minh', currencyCode: j.currencyCode || 'VND' };
}

export interface GaOrder { transactionId: string; at: string; campaign: string; sourceMedium: string; revenue: number }
/** Purchases whose session came from email in the last `days` days, newest first. dateHourMinute is in the property's time zone. */
export async function gaEmailOrders(id: string, days = 30, source = ''): Promise<GaOrder[]> {
  const filter = source
    ? { andGroup: { expressions: [{ filter: { fieldName: 'sessionMedium', stringFilter: { matchType: 'EXACT', value: 'email' } } }, { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'EXACT', value: source } } }] } }
    : { filter: { fieldName: 'sessionMedium', stringFilter: { matchType: 'EXACT', value: 'email' } } };
  const body = { dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }], dimensions: [{ name: 'transactionId' }, { name: 'dateHourMinute' }, { name: 'sessionCampaignName' }, { name: 'sessionSourceMedium' }], metrics: [{ name: 'purchaseRevenue' }], dimensionFilter: filter, orderBys: [{ dimension: { dimensionName: 'dateHourMinute' }, desc: true }], limit: 1000 };
  const j = await call<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] }>(`https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, body);
  return (j.rows || []).filter((r) => r.dimensionValues[0].value && r.dimensionValues[0].value !== '(not set)').map((r) => {
    const d = r.dimensionValues[1].value; // yyyyMMddHHmm
    return { transactionId: r.dimensionValues[0].value, at: `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)} ${d.slice(8, 10)}:${d.slice(10, 12)}`, campaign: r.dimensionValues[2].value, sourceMedium: r.dimensionValues[3].value, revenue: Number(r.metricValues[0].value) || 0 };
  });
}
