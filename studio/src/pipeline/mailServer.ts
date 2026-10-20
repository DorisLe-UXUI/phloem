// Phloem Email on the relay (server/src/mail.mjs): hosted images, real unsubscribe links + suppression list,
// open/click tracking, sending accounts (Resend / Brevo / Amazon SES) and the server-side queue (schedule, daily cap,
// A/B subject test). Everything needs a signed-in relay account; without one the Gmail path falls back to cid: images
// and a mailto: unsubscribe, exactly as before.
import { fnv1a } from '../../../src/shared/hash';
import { getSession, expired } from '../auth/core';
import { relayAuth } from '../ai/client';
import { get } from '../store';

export interface MailHealth { img: boolean; tracking: boolean; queue: boolean }
export interface Sender { webhook?: string; domain?: { name: string; verified?: boolean; checkedAt?: string } | null; id: string; provider: 'resend' | 'brevo' | 'ses' | 'smtp'; label: string; fromEmail: string; fromName: string; replyTo: string; region: string; perDay: number; updatedAt: string; hasKey: boolean; preset?: string; host?: string; port?: number; secure?: 'ssl' | 'starttls'; username?: string; health?: { ok: boolean; error: string; at: string } | null }
export interface ProviderInfo { id: Sender['provider']; label: string; perDay: number }
export interface SendInfo { sender: string; subject: string; sendAt: string; status: 'scheduled' | 'sending' | 'waiting' | 'paused' | 'cancelled' | 'done' | 'error'; perDay: number; lastError: string; testSentAt: string | null; ab: null | { subjectB: string; split: number; metric: 'opens' | 'clicks'; waitHours: number; phase: 'test' | 'wait' | 'rest'; winner: 'A' | 'B' | null; scores?: { A: number; B: number } } }
export interface CampaignStats { opens: number; clicks: number; unsubscribes: number; links: { url: string; clicks: number }[]; byVariant: Record<string, { opens: number; clicks: number }>; queue: Record<string, number>; send: SendInfo | null; orders?: number; revenue?: number; buyers?: number }
export interface PersonOrder { orderId: string; value: number; currency: string; at: string; match: 'click' | 'email'; kind: '' | 'product' | 'service'; items: string; clickedAt: string | null; link: number | null }
export interface CampaignPerson { email: string; name: string; status: '' | 'sent' | 'queued' | 'failed' | 'skipped' | 'cancelled' | 'unknown'; sentAt: string | null; variant: string; error: string; opens: number; firstOpen: string | null; lastOpen: string | null; clicks: number; lastClick: string | null; links: { i: number; url: string; n: number; last: string }[]; orders: PersonOrder[]; unsubAt: string | null; bounced: '' | 'bounce' | 'complaint' }
export interface CampaignPeople {
  campaign: { id: string; subject: string; from: string; via: 'gmail' | 'server'; at: string; links: string[]; labels: string[]; list: string; segment: string };
  totals: { totalOpens: number; totalClicks: number; recipients: number; opened: number; clicked: number; buyers: number; orders: number; revenue: number; unsubscribed: number; bounced: number; failed: number; unknownOpens: number; unknownClicks: number };
  lostOrders: PersonOrder[];
  /** Activity by hour (Vietnam time, 'YYYY-MM-DDTHH'). */
  timeline: { h: string; opens: number; openers: number; clicks: number; clickers: number }[];
  people: CampaignPerson[];
}

const base = () => get().settings.relayUrl.trim().replace(/\/$/, '');
/** Signed in to a relay account (the mail routes are per user). */
export const mailSignedIn = () => !!base() && getSession()?.mode === 'relay';

let health: { url: string; at: number; v: MailHealth | null } = { url: '', at: 0, v: null };
/** What this relay offers (null: old relay or unreachable). Cached for a minute. */
export async function mailHealth(force = false): Promise<MailHealth | null> {
  const u = base(); if (!u) return null;
  if (!force && health.url === u && Date.now() - health.at < 60_000) return health.v;
  try { const r = await fetch(`${u}/`, { signal: AbortSignal.timeout(8000) }); const j = await r.json(); health = { url: u, at: Date.now(), v: j?.mail || null }; }
  catch { health = { url: u, at: Date.now(), v: null }; }
  return health.v;
}
export const mailHealthCached = (): MailHealth | null => (health.url === base() ? health.v : null);

/** Signed-in call to the relay (JSON in/out), shared by the mail and audience clients. */
export function relayApi<T>(path: string, init: { method?: string; body?: unknown; raw?: Blob; type?: string } = {}): Promise<T> { return api<T>(path, init); }
async function api<T>(path: string, init: { method?: string; body?: unknown; raw?: Blob; type?: string } = {}): Promise<T> {
  const u = base(); if (!u) throw new Error('Chưa có relay (Cài đặt → Relay).');
  if (getSession()?.mode !== 'relay') throw new Error('Đăng nhập tài khoản Phloem để dùng ảnh host, huỷ đăng ký và thống kê.');
  let r: Response;
  try {
    r = await fetch(u + path, {
      method: init.method || (init.body !== undefined || init.raw ? 'POST' : 'GET'),
      headers: { ...relayAuth(), ...(init.raw ? { 'Content-Type': init.type || 'application/octet-stream' } : init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.raw || (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: AbortSignal.timeout(60_000),
    });
  } catch { throw new Error('Không gọi được relay (đang khởi động hoặc mất mạng). Thử lại sau vài giây.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw expired();
  if (!r.ok) throw new Error(j?.error || `Relay trả HTTP ${r.status}`);
  return j as T;
}

// ---------- hosted images ----------
const hosted = new Map<string, string>(); // fnv(bytes)+size → public URL (content-addressed on the relay too)
/** Upload slices to the relay's public bucket (4 at a time); returns key → https URL. Re-uploads nothing it has seen. */
export async function hostImages(items: { key: string; bytes: Uint8Array; mime: string }[], onProgress?: (done: number, total: number) => void): Promise<Record<string, string>> {
  const out: Record<string, string> = {}; let done = 0; let next = 0;
  const work = async () => {
    while (next < items.length) {
      const it = items[next++];
      const id = `${fnv1a(it.bytes)}:${it.bytes.length}`;
      let url = hosted.get(id);
      if (!url) { url = (await api<{ url: string }>('/img', { raw: new Blob([it.bytes as BlobPart], { type: it.mime }), type: it.mime })).url; hosted.set(id, url); }
      out[it.key] = url; onProgress?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, work));
  return out;
}

// ---------- campaigns, tokens, stats ----------
export const registerCampaign = (id: string, c: { subject: string; from: string; fromName: string; links: string[]; labels?: string[]; via?: 'gmail' | 'server'; project?: string; recipients?: number }) => api<{ ok: true }>('/mail/campaigns', { body: { id, ...c } });
export const recipientTokens = (campaign: string, emails: string[], variant = '') => api<{ base: string; tokens: Record<string, string>; suppressed: string[] }>('/mail/tokens', { body: { campaign, emails, variant } });
export const campaignStats = (id: string) => api<CampaignStats>(`/mail/campaigns/${encodeURIComponent(id)}/stats`);
/** Record who a browser send went to (sends from before the relay kept the list), so the report can name them. */
export async function backfillRecipients(id: string, emails: string[], at?: string): Promise<void> {
  const key = `phloem.mail.rcpt.${id}`; try { if (localStorage.getItem(key)) return; } catch { /* ignore */ }
  for (let i = 0; i < emails.length; i += 2000) await api<{ ok: true }>(`/mail/campaigns/${encodeURIComponent(id)}/recipients`, { body: { emails: emails.slice(i, i + 2000), at } });
  try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
}
/** Each recipient of a campaign: opened, which links, what they bought (orders the shop's tag matched to this email). */
export const campaignPeople = (id: string) => api<CampaignPeople>(`/mail/campaigns/${encodeURIComponent(id)}/people`);

// ---------- suppression list ----------
export const listSuppressions = () => api<{ suppressions: { email: string; at: string; source: string; campaign: string }[] }>('/mail/suppressions');
export const addSuppressions = (emails: string[], source = 'manual') => api<{ added: number }>('/mail/suppressions', { body: { emails, source } });
export const removeSuppression = (email: string) => api<{ ok: true }>(`/mail/suppressions/${encodeURIComponent(email)}`, { method: 'DELETE' });

// ---------- sending accounts ----------
export const listSenders = () => api<{ senders: Sender[]; providers: ProviderInfo[] }>('/mail/senders');
export const saveSender = (s: Partial<Sender> & { apiKey?: string; accessKeyId?: string; secret?: string; password?: string }) => api<{ sender: Sender }>('/mail/senders', { body: s });
export interface SmtpDetected { preset: string; label: string; host: string; port: number; secure: 'ssl' | 'starttls'; perDay: number; app?: boolean; domain: string; mx: string }
/** SMTP settings from an address (consumer domains, else the domain's MX records). */
export const detectSmtp = (email: string) => api<{ detected: SmtpDetected | null }>(`/mail/smtp/detect?email=${encodeURIComponent(email)}`);
/** Log in to a mailbox without sending (settings + password check). */
export const verifySmtp = (b: { id?: string; host?: string; port?: number; secure?: string; username?: string; password?: string }) => api<{ ok: boolean; error?: string; auth?: string }>('/mail/smtp/verify', { body: b });
export const deleteSender = (id: string) => api<{ ok: true }>(`/mail/senders/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const testSender = (id: string, to: string) => api<{ ok: true; to: string }>(`/mail/senders/${encodeURIComponent(id)}/test`, { body: { to } });

// ---------- server-side queue ----------
export interface ServerSendInput { audience?: { client?: string; list: string; segment?: string; tags?: string[] }; campaign: string; sender: string; subject: string; html: string; text: string; recipients: string[]; sendAt?: string; perDay?: number; ab?: { subjectB: string; split: number; metric: 'opens' | 'clicks'; waitHours: number } | null }
export interface ScheduleItem {
  id: string; project: string; subject: string; status: SendInfo['status']; sendAt: string; createdAt: string; lastError: string; perDay: number; sentToday: number; nextAt: string | null;
  firstSentAt: string | null; lastSentAt: string | null; counts: Record<string, number>; total: number; ab: { phase: string; winner: string | null; waitHours: number } | null;
  sender: { id: string; label: string; fromEmail: string; provider: string; health: Sender['health'] }; audience: { list: string; segment: string } | null;
}
/** Every server send of the account for the "Lịch gửi" board. */
export const sendSchedule = () => api<{ now: string; dayResetAt: string; items: ScheduleItem[] }>('/mail/schedule');
export const startServerSend = (b: ServerSendInput) => api<{ ok: true; recipients: number; test: number; sendAt: string }>('/mail/send', { body: b });
export const serverSendStatus = (id: string) => api<{ send: SendInfo; counts: Record<string, number> }>(`/mail/send/${encodeURIComponent(id)}`);
export const serverSendControl = (id: string, action: 'pause' | 'resume' | 'cancel', sender?: string) => api<{ ok: true; status: string }>(`/mail/send/${encodeURIComponent(id)}/${action}`, { body: sender ? { sender } : {} });

// ---------- campaigns this browser started (so stats survive a reload) ----------
export interface CampaignRef { id: string; projectId: string; subject: string; via: 'gmail' | 'server'; at: string; recipients: number }
const LS = 'phloem.mail.campaigns';
export function myCampaigns(projectId?: string): CampaignRef[] { try { const all = JSON.parse(localStorage.getItem(LS) || '[]') as CampaignRef[]; return projectId ? all.filter((c) => c.projectId === projectId) : all; } catch { return []; } }
export function rememberCampaign(c: CampaignRef) { try { const all = myCampaigns().filter((x) => x.id !== c.id); all.unshift(c); localStorage.setItem(LS, JSON.stringify(all.slice(0, 60))); } catch { /* ignore */ } }
/** Hide from the list (the numbers stay on the relay); hidden ones can be shown again. */
const LS_HIDDEN = 'phloem.mail.hidden';
export function hiddenCampaigns(): string[] { try { return JSON.parse(localStorage.getItem(LS_HIDDEN) || '[]'); } catch { return []; } }
export function forgetCampaign(id: string) { try { localStorage.setItem(LS_HIDDEN, JSON.stringify([id, ...hiddenCampaigns().filter((x) => x !== id)].slice(0, 300))); } catch { /* ignore */ } }
export function unhideCampaigns(ids: string[]) { try { localStorage.setItem(LS_HIDDEN, JSON.stringify(hiddenCampaigns().filter((x) => !ids.includes(x)))); } catch { /* ignore */ } }
/** Campaigns of this account on the relay (any browser); `project` narrows to one email's sends. */
export const serverCampaigns = (project?: string) => api<{ campaigns: (Omit<CampaignRef, 'projectId'> & { project: string })[] }>(`/mail/campaigns${project ? `?project=${encodeURIComponent(project)}` : ''}`);

// ---------- sending domain ----------
export interface DnsRecord { type: string; name: string; value: string; priority?: number; status?: string; note?: string }
export interface DomainState { name: string; verified: boolean; status: string; records: DnsRecord[] }
export const addSenderDomain = (id: string, domain: string) => api<{ domain: DomainState }>(`/mail/senders/${encodeURIComponent(id)}/domain`, { body: { domain } });
export const senderDomain = (id: string) => api<{ domain: DomainState | null }>(`/mail/senders/${encodeURIComponent(id)}/domain`);
