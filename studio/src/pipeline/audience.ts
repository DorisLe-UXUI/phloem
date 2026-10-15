// Audience on the relay (server/src/audience.mjs): lists, contacts, segments, signup forms, automations, reports.
// Every call is scoped to a client workspace (?client=) or the personal space.
import { relayApi } from './mailServer';

export type ContactStatus = 'subscribed' | 'pending' | 'unsubscribed' | 'bounced' | 'complained';
export const STATUS_LABEL: Record<ContactStatus, string> = { subscribed: 'Đang nhận', pending: 'Chờ xác nhận', unsubscribed: 'Đã huỷ', bounced: 'Thư dội', complained: 'Báo spam' };
export interface FieldDef { key: string; label: string; type: 'text' | 'date' | 'number' }
export interface Group { name: string; tag: string }
export interface AudList { id: string; name: string; company: { name: string; address: string }; sender: { owner: string; id: string } | null; fields: FieldDef[]; groups: Group[]; counts: Record<ContactStatus, number>; total: number; createdAt: string }
export interface Contact { email: string; status: ContactStatus; first_name: string; last_name: string; tags: string[]; fields: Record<string, string>; source: string; consent: Record<string, string>; createdAt: string; subscribedAt?: string | null; unsubscribedAt?: string | null; lastOpenAt?: string | null; lastClickAt?: string | null; opens: number; clicks: number }
export interface Rule { field: string; op: string; value: string }
export interface Segment { id: string; name: string; list: string; match: 'all' | 'any'; rules: Rule[] }
export interface SignupForm { id: string; list: string; name: string; title: string; intro: string; button: string; success: string; redirect: string; doubleOptIn: boolean; tags: string[]; consentText: string; fields: { first_name: boolean; last_name: boolean; phone: boolean; birthday: boolean; groups?: boolean }; groupsLabel?: string; colors: { bg: string; accent: string; text: string }; url: string }
export interface Step { id?: string; type: 'email' | 'tag'; delayHours: number; subject?: string; project?: string; projectName?: string; html?: string; text?: string; links?: string[]; hasHtml?: boolean; add?: string[]; remove?: string[]; log?: Record<string, number>; stats?: { opens: number; clicks: number; unsubscribes: number } | null }
export interface Automation { id: string; name: string; list: string; trigger: { type: 'subscribe' | 'tag' | 'date' | 'inactive'; tag?: string; field?: string; days?: number }; steps: Step[]; sender: { owner: string; id: string } | null; status: 'draft' | 'active' | 'paused'; runs?: Record<string, number> }
export interface Report { days: number; growth: { day: string; subscribed: number; unsubscribed: number }[]; lists: { id: string; name: string; counts: Record<ContactStatus, number>; total: number }[]; campaigns: { id: string; subject: string; at: string; status: string; list: string; segment: string; sent: number; opens: number; clicks: number; unsubscribes: number; failed: number; orders: number; revenue: number }[] }
export interface SenderRef { id: string; label: string; fromEmail: string; fromName: string }

const q = (client: string | null | undefined, extra = '') => { const p = new URLSearchParams(extra); if (client) p.set('client', client); const s = p.toString(); return s ? `?${s}` : ''; };
const e = encodeURIComponent;

export const audLists = (client?: string | null) => relayApi<{ lists: AudList[]; role: string; senders: SenderRef[] }>(`/aud/lists${q(client)}`);
export const createList = (client: string | null | undefined, body: Partial<AudList>) => relayApi<{ list: AudList }>(`/aud/lists${q(client)}`, { body });
export const updateList = (client: string | null | undefined, id: string, body: Partial<AudList> | Record<string, unknown>) => relayApi<{ list: AudList }>(`/aud/lists/${e(id)}${q(client)}`, { method: 'PUT', body });
export const deleteList = (client: string | null | undefined, id: string, name: string) => relayApi<{ ok: true }>(`/aud/lists/${e(id)}${q(client, `confirm=${e(name)}`)}`, { method: 'DELETE' });
export const contacts = (client: string | null | undefined, list: string, f: { q?: string; status?: string; tag?: string; segment?: string; offset?: number; limit?: number } = {}) =>
  relayApi<{ contacts: Contact[]; total: number }>(`/aud/lists/${e(list)}/contacts${q(client, new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString())}`);
export const addContact = (client: string | null | undefined, list: string, c: Partial<Contact>) => relayApi<{ created?: boolean; updated?: boolean; contact: Contact }>(`/aud/lists/${e(list)}/contacts${q(client)}`, { body: c });
export const patchContact = (client: string | null | undefined, list: string, email: string, c: Partial<Contact> & { confirmConsent?: boolean }) => relayApi<{ contact: Contact }>(`/aud/lists/${e(list)}/contacts/${e(email)}${q(client)}`, { method: 'PATCH', body: c });
export const deleteContact = (client: string | null | undefined, list: string, email: string) => relayApi<{ ok: true }>(`/aud/lists/${e(list)}/contacts/${e(email)}${q(client)}`, { method: 'DELETE' });
export const importContacts = (client: string | null | undefined, list: string, body: { rows: Partial<Contact>[]; tags: string[]; attest: true; mode?: 'add' | 'update'; triggerAutomations?: boolean; note?: string }) => relayApi<{ added: number; updated: number; invalid: number; skipped: number; suppressed: number }>(`/aud/lists/${e(list)}/import${q(client)}`, { body });
export const bulkTags = (client: string | null | undefined, list: string, emails: string[], add: string[], remove: string[]) => relayApi<{ updated: number }>(`/aud/lists/${e(list)}/tags${q(client)}`, { body: { emails, add, remove } });
export const listTags = (client: string | null | undefined, list: string) => relayApi<{ tags: { tag: string; n: number }[] }>(`/aud/lists/${e(list)}/tags${q(client)}`);
export const exportUrl = (relay: string, client: string | null | undefined, list: string) => `${relay}/aud/lists/${e(list)}/export.csv${q(client)}`;
export const segments = (client?: string | null) => relayApi<{ segments: Segment[] }>(`/aud/segments${q(client)}`);
export const saveSegment = (client: string | null | undefined, s: Partial<Segment>) => relayApi<{ segment: Segment }>(s.id ? `/aud/segments/${e(s.id)}${q(client)}` : `/aud/segments${q(client)}`, { method: s.id ? 'PUT' : 'POST', body: s });
export const deleteSegment = (client: string | null | undefined, id: string) => relayApi<{ ok: true }>(`/aud/segments/${e(id)}${q(client)}`, { method: 'DELETE' });
export const previewRules = (client: string | null | undefined, list: string, match: 'all' | 'any', rules: Rule[]) => relayApi<{ count: number; of: number; sample: string[] }>(`/aud/preview${q(client)}`, { body: { list, match, rules } });
export const forms = (client?: string | null) => relayApi<{ forms: SignupForm[] }>(`/aud/forms${q(client)}`);
export const saveForm = (client: string | null | undefined, f: Partial<SignupForm>) => relayApi<{ form: SignupForm }>(f.id ? `/aud/forms/${e(f.id)}${q(client)}` : `/aud/forms${q(client)}`, { method: f.id ? 'PUT' : 'POST', body: f });
export const deleteForm = (client: string | null | undefined, id: string) => relayApi<{ ok: true }>(`/aud/forms/${e(id)}${q(client)}`, { method: 'DELETE' });
export const automations = (client?: string | null) => relayApi<{ automations: Automation[] }>(`/aud/automations${q(client)}`);
export const saveAutomation = (client: string | null | undefined, a: Partial<Automation>) => relayApi<{ automation: Automation }>(a.id ? `/aud/automations/${e(a.id)}${q(client)}` : `/aud/automations${q(client)}`, { method: a.id ? 'PUT' : 'POST', body: a });
export const automationAction = (client: string | null | undefined, id: string, action: 'activate' | 'pause' | 'test', body?: unknown) => relayApi<{ ok: true; status?: string; to?: string }>(`/aud/automations/${e(id)}/${action}${q(client)}`, { method: 'POST', body: body ?? {} });
export const deleteAutomation = (client: string | null | undefined, id: string) => relayApi<{ ok: true }>(`/aud/automations/${e(id)}${q(client)}`, { method: 'DELETE' });
export const reports = (client: string | null | undefined, days = 30) => relayApi<Report>(`/aud/reports${q(client, `days=${days}`)}`);

/** Minimal RFC 4180 CSV reader (quotes, commas, newlines in quotes; ; or tab separated files too). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; continue; }
    if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const norm = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Which contact field a CSV column header means (Vietnamese and English headers). */
export function guessColumn(h: string): string {
  const n = norm(h);
  if (/^(e_?mail|email_address|dia_chi_email|thu_dien_tu|mail)$/.test(n)) return 'email';
  if (/^(first_?name|ten|given_name|fname)$/.test(n)) return 'first_name';
  if (/^(last_?name|ho|surname|family_name|lname)$/.test(n)) return 'last_name';
  if (/^(name|full_?name|ho_ten|ho_va_ten|ten_khach_hang|khach_hang)$/.test(n)) return 'full_name';
  if (/^(tags?|nhan|the)$/.test(n)) return 'tags';
  if (/^(phone|sdt|so_dien_thoai|dien_thoai|mobile|tel)$/.test(n)) return 'fields.phone';
  if (/^(birthday|ngay_sinh|sinh_nhat|dob|date_of_birth)$/.test(n)) return 'fields.birthday';
  if (/^(city|thanh_pho|tinh|tinh_thanh)$/.test(n)) return 'fields.city';
  return n ? `fields.${n.slice(0, 40)}` : '';
}
/** CSV rows → contacts with the chosen column mapping (full names split on the last space, Vietnamese order). */
export function rowsToContacts(rows: string[][], map: string[]): Partial<Contact>[] {
  return rows.map((r) => {
    const c: Partial<Contact> & { fields: Record<string, string> } = { fields: {} };
    map.forEach((m, i) => {
      const v = (r[i] || '').trim(); if (!m || !v) return;
      if (m === 'email') c.email = v;
      else if (m === 'first_name') c.first_name = v;
      else if (m === 'last_name') c.last_name = v;
      else if (m === 'full_name') { const parts = v.split(/\s+/); c.first_name = parts.pop() || ''; c.last_name = parts.join(' '); }
      else if (m === 'tags') c.tags = v.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
      else if (m.startsWith('fields.')) c.fields[m.slice(7)] = v;
    });
    return c;
  });
}

// ---------- orders (the shop's order tag) ----------
export interface Order { orderId: string; value: number; currency: string; email: string; at: string; receivedAt: string; match: '' | 'click' | 'email'; campaign: string; subject: string; clickedAt: string | null; source: string }
export interface OrdersReport { days: number; attributionDays: number; orders: Order[]; totals: { orders: number; revenue: number; emailOrders: number; emailRevenue: number } }
export interface Site { key: string; name: string; domain: string; createdAt: string }
export const orders = (client: string | null | undefined, days = 30) => relayApi<OrdersReport>(`/aud/orders${q(client, `days=${days}`)}`);
export const sites = (client?: string | null) => relayApi<{ sites: Site[]; relay: string; days: number }>(`/aud/sites${q(client)}`);
export const createSite = (client: string | null | undefined, name: string, domain = '') => relayApi<{ site: Site }>(`/aud/sites${q(client)}`, { body: { name, domain } });

/** Every page of the shop: remembers the click id from the email link (7 days) and exposes phloemOrder({...}). */
export function tagSnippet(relay: string, key: string): string {
  return `<!-- Phloem Email: đo đơn hàng từ email (dán trước </body> ở MỌI trang) -->
<script>
(function(){var R='${relay}',K='${key}';
try{var q=new URLSearchParams(location.search).get('phl');if(q){document.cookie='phl='+q+';path=/;max-age=604800;SameSite=Lax';localStorage.setItem('phl',q);}}catch(e){}
window.phloemOrder=function(o){try{var c=(document.cookie.match(/(?:^|; )phl=([^;]+)/)||[])[1]||localStorage.getItem('phl')||'';var d=JSON.stringify(Object.assign({k:K,phl:c},o||{}));if(navigator.sendBeacon)navigator.sendBeacon(R+'/t/order',new Blob([d],{type:'text/plain'}));else fetch(R+'/t/order',{method:'POST',body:d,keepalive:true,mode:'no-cors'});}catch(e){}};
})();
</script>`;
}
/** The thank-you page: one call with the order's numbers (placeholders replaced by the platform's variables). */
export const thankYouSnippet = `<script>
  phloemOrder({ order_id: 'MÃ_ĐƠN', value: TỔNG_TIỀN, currency: 'VND', email: 'EMAIL_KHÁCH' });
</script>`;
/** Shopify → Settings → Customer events → Add custom pixel. */
export function shopifyPixel(relay: string, key: string): string {
  return `// Phloem Email: Shopify → Cài đặt → Sự kiện khách hàng → Thêm pixel tuỳ chỉnh
analytics.subscribe('checkout_completed', async (event) => {
  const c = event.data.checkout;
  let phl = '';
  try { phl = (await browser.cookie.get('phl')) || (await browser.localStorage.getItem('phl')) || ''; } catch (e) {}
  fetch('${relay}/t/order', { method: 'POST', keepalive: true, body: JSON.stringify({
    k: '${key}', phl, order_id: String(c.order?.id || c.token), value: c.totalPrice?.amount, currency: c.currencyCode, email: c.email,
  }) });
});`;
}
