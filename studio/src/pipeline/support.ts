// "Hỗ trợ": the customer-care bubble and the admin inbox talk to the relay (server/src/support.mjs). Guests can write
// too: their tickets are found again with a key kept in this browser (and in the link of the reply email).
import { get, recentErrors } from '../store';
import { getSession, expired } from '../auth/core';
import { relayAuth, wakeRelay } from '../ai/client';

export type Kind = 'bug' | 'idea' | 'help' | 'other';
export type Status = 'new' | 'open' | 'done' | 'spam';
export interface Msg { id: string; author: 'user' | 'admin'; name: string; body: string; image: string | null; at: string }
export interface Ticket {
  id: string; kind: Kind; status: Status; subject: string; email: string; name: string; owner: string | null;
  createdAt: string; updatedAt: string; lastBy: 'user' | 'admin'; adminUnread: boolean; userUnread: boolean;
  /** notification email: 'ok' | 'off' (no mailbox chosen) | 'lỗi: …' | '' (sending) */
  mailed: string; rating: 1 | -1 | null; meta: Record<string, string | string[]>; count?: number;
  last: { author: 'user' | 'admin'; body: string; at: string } | null; messages?: Msg[];
}
export interface Inbox {
  tickets: Ticket[]; counts: { new: number; open: number; done: number; spam: number; unread: number };
  settings: { sender: string; senderOwner: string; channel: '' | 'mailbox' | 'resend'; admins: string[]; senders: { id: string; label: string; fromEmail: string }[] };
}
export const KIND_VI: Record<Kind, string> = { bug: 'Báo lỗi', idea: 'Góp ý', help: 'Cần hỗ trợ', other: 'Khác' };
export const STATUS_VI: Record<Status, string> = { new: 'Mới', open: 'Đang xử lý', done: 'Xong', spam: 'Rác' };

const base = () => (getSession()?.relayUrl || get().settings.relayUrl || '').trim().replace(/\/$/, '');
const LS_KEYS = 'phloem.support.keys';
const keys = (): { id: string; key: string }[] => { try { const v = JSON.parse(localStorage.getItem(LS_KEYS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export function rememberKey(id: string, key: string) { try { localStorage.setItem(LS_KEYS, JSON.stringify([{ id, key }, ...keys().filter((x) => x.id !== id)].slice(0, 30))); } catch { /* private mode: the email link still opens it */ } }
const keyOf = (id: string) => keys().find((x) => x.id === id)?.key || '';
export const signedIn = () => getSession()?.mode === 'relay';
/** Anything to look for: an account, or tickets sent from this browser as a guest. */
export const hasTickets = () => signedIn() || keys().length > 0;

async function call<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const url = base(); if (!url) throw new Error('Chưa kết nối máy chủ Phloem (Cài đặt → Relay URL).');
  await wakeRelay(url, relayAuth());
  let r: Response;
  try { r = await fetch(url + path, { ...init, headers: { 'Content-Type': 'application/json', ...relayAuth() }, signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Không gửi được tới máy chủ Phloem (mất mạng?). Thử lại sau giây lát.'); }
  if (admin && r.status === 401) throw expired();
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Máy chủ trả ${r.status}`);
  return j as T;
}

/** What the admin needs to reproduce a bug: screen, open email, build, browser, last error toasts. */
export function context(): Record<string, string | string[]> {
  const s = get();
  const v = (document.querySelector('script[src*="studio.js"]') as HTMLScriptElement | null)?.getAttribute('src')?.match(/v=(\d+)/)?.[1] || '';
  const ua = navigator.userAgent;
  const browser = (/Edg\/([\d]+)/.exec(ua) && `Edge ${/Edg\/([\d]+)/.exec(ua)![1]}`) || (/Chrome\/([\d]+)/.exec(ua) && `Chrome ${/Chrome\/([\d]+)/.exec(ua)![1]}`) || (/Version\/([\d.]+).*Safari/.exec(ua) && `Safari ${/Version\/([\d.]+)/.exec(ua)![1]}`) || (/Firefox\/([\d]+)/.exec(ua) && `Firefox ${/Firefox\/([\d]+)/.exec(ua)![1]}`) || ua.slice(0, 80);
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return {
    app: s.app === 'mkt' ? 'MKT' : 'Email',
    route: s.route.name === 'editor' ? `Editor${s.rightTab ? ` · tab ${s.rightTab}` : ''}` : s.route.name,
    ...(s.project ? { project: s.project.id, projectName: s.project.name } : {}),
    url: `${location.pathname}${location.hash.replace(/#\/ho-tro.*$/, '')}`,
    version: v, ua: `${browser}${os ? ` · ${os}` : ''}`, screen: `${innerWidth}×${innerHeight}`, lang: navigator.language,
    relay: (() => { try { return new URL(base()).host; } catch { return ''; } })(),
    errors: [...recentErrors],
  };
}

export async function sendTicket(t: { kind: Kind; message: string; email?: string; name?: string; image?: string | null; meta: boolean; website?: string }): Promise<Ticket> {
  const r = await call<{ id: string; key: string; ticket: Ticket }>('/support', { method: 'POST', body: JSON.stringify({ kind: t.kind, message: t.message, email: t.email, name: t.name, image: t.image || undefined, meta: t.meta ? context() : undefined, website: t.website }) });
  if (r.key) rememberKey(r.id, r.key);
  return r.ticket;
}
export async function myTickets(): Promise<{ tickets: Ticket[]; unread: number }> {
  const k = keys().map((x) => `${x.id}.${x.key}`).join(',');
  return call(`/support/mine${k ? `?keys=${encodeURIComponent(k)}` : ''}`);
}
export const replyTicket = (id: string, message: string, image?: string | null) => call<{ ticket: Ticket }>(`/support/${id}/reply`, { method: 'POST', body: JSON.stringify({ message, image: image || undefined, key: keyOf(id) }) }).then((r) => r.ticket);
export const readTicket = (id: string) => call(`/support/${id}/read`, { method: 'POST', body: JSON.stringify({ key: keyOf(id) }) }).catch(() => {});
export const rateTicket = (id: string, rating: 1 | -1) => call<{ ticket: Ticket }>(`/support/${id}/rate`, { method: 'POST', body: JSON.stringify({ rating, key: keyOf(id) }) }).then((r) => r.ticket);

// ---------- admin ----------
export const adminInbox = (status = 'active') => call<Inbox>(`/admin/support?status=${status}`, {}, true);
export const adminTicket = (id: string) => call<{ ticket: Ticket }>(`/admin/support/${id}`, {}, true).then((r) => r.ticket);
export const adminReply = (id: string, message: string, close: boolean) => call<{ ticket: Ticket; mailed: string }>(`/admin/support/${id}/reply`, { method: 'POST', body: JSON.stringify({ message, close }) }, true);
export const adminStatus = (id: string, status: Status) => call<{ ticket: Ticket }>(`/admin/support/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }, true).then((r) => r.ticket);
export const adminNotifySender = (sender: string) => call<{ channel: Inbox['settings']['channel'] }>('/admin/support/settings', { method: 'POST', body: JSON.stringify({ sender }) }, true);
export const adminTestMail = () => call<{ to: string[] }>('/admin/support/test', { method: 'POST' }, true);
export async function adminCsv(): Promise<Uint8Array> {
  const url = base(); const r = await fetch(`${url}/admin/support.csv`, { headers: relayAuth() });
  if (!r.ok) throw new Error(`Máy chủ trả ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** A picture small enough for a ticket (≤ ~1 MB as a data URL): the longest side 1600 px, JPEG. */
export async function shrinkImage(src: CanvasImageSource & { width: number; height: number }, w0 = src.width, h0 = src.height): Promise<string> {
  for (const [side, q] of [[1600, 0.82], [1280, 0.75], [1000, 0.7], [800, 0.65]] as const) {
    const k = Math.min(1, side / Math.max(w0, h0)); const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q); if (url.length < 1_300_000) return url;
  }
  throw new Error('Ảnh quá lớn.');
}
export async function imageFromFile(f: Blob): Promise<string> {
  if (!/^image\//.test(f.type)) throw new Error('Chỉ đính kèm ảnh (PNG, JPG…).');
  const bmp = await createImageBitmap(f);
  try { return await shrinkImage(bmp); } finally { bmp.close(); }
}
/** One frame of this tab (the browser asks which screen to share; Chrome offers "this tab" first). */
export async function captureScreen(): Promise<string> {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (o: unknown) => Promise<MediaStream> };
  if (!md?.getDisplayMedia) throw new Error('Trình duyệt này không chụp màn hình được: dùng Đính kèm ảnh.');
  const stream = await md.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' } as unknown);
  try {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream; await v.play();
    await new Promise((r) => setTimeout(r, 350)); // let the share bar settle and the first real frame arrive
    return await shrinkImage(v, v.videoWidth, v.videoHeight);
  } finally { stream.getTracks().forEach((t) => t.stop()); }
}
