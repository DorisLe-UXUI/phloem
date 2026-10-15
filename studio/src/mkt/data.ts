// Phloem MKT storage. A relay account keeps every client on the relay (SQLite, per-client access checked server-side);
// a local account (no relay) keeps them in this browser, scoped to that account, so the app still works offline.
// Review links, teammates and export from the relay need a relay account.
import { getSession, expired } from '../auth/core';
import { wakeRelay } from '../ai/client';
import { get, set } from '../store';
import type { AuditRow, Client, Item, ItemKind, Member, Role, ShareLink } from './types';

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const newId = uid;
const now = () => new Date().toISOString();
/** Bumped on every change to clients or items; stored in state.clientsAt so memoised views recompute. */
let rev = 0;

function relaySession() { const s = getSession(); return s && s.mode === 'relay' ? s : null; }
function base(): string { const s = relaySession(); return (s?.relayUrl || get().settings.relayUrl || '').replace(/\/$/, ''); }
export const isRelay = () => !!relaySession() && !!base();

let woke = 0;
async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const s = relaySession(); if (!s) throw new Error('Cần đăng nhập tài khoản relay.');
  if (Date.now() - woke > 9 * 60_000) { await wakeRelay(base(), { Authorization: `Bearer ${s.token}` }); woke = Date.now(); }
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}`, ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(`${base()}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  if (r.status === 401) throw expired();
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Relay trả HTTP ${r.status}`), { status: r.status, code: j.code });
  return j as T;
}
const enc = encodeURIComponent;

// ---------- local store (per account, this browser only) ----------
interface LocalDb { clients: Client[]; items: Record<string, Item[]>; audit: Record<string, AuditRow[]> }
const lsKey = () => `phloem.mkt.v1.${get().user?.id || 'guest'}`;
function readLocal(): LocalDb { try { const v = localStorage.getItem(lsKey()); if (v) return JSON.parse(v); } catch { /* fresh */ } return { clients: [], items: {}, audit: {} }; }
function writeLocal(d: LocalDb) {
  try { localStorage.setItem(lsKey(), JSON.stringify(d)); }
  catch { throw new Error('Bộ nhớ trình duyệt đã đầy. Đăng nhập tài khoản relay để lưu khách hàng trên máy chủ.'); }
}
function localAudit(d: LocalDb, clientId: string, action: string, detail = '') {
  (d.audit[clientId] ||= []).unshift({ actor: get().user?.name || 'Bạn', action, detail, at: now() });
  d.audit[clientId] = d.audit[clientId].slice(0, 200);
}

// ---------- clients ----------
export async function loadClients(): Promise<Client[]> {
  let list: Client[];
  if (isRelay()) list = (await req<{ clients: Client[] }>('/db/clients')).clients;
  else list = readLocal().clients.map((c) => ({ ...c, role: 'owner' as Role }));
  set({ clients: list, clientsAt: `${now()}#${++rev}` });
  return list;
}

export async function saveClient(c: Partial<Client> & { name: string; id?: string }): Promise<Client> {
  const id = c.id || uid('c');
  const prev = get().clients.find((x) => x.id === id);
  const full: Client = { ...(prev || {}), ...c, id, createdAt: prev?.createdAt || now(), updatedAt: now() } as Client;
  if (isRelay()) {
    const { role: _r, shared: _s, ...body } = full;
    await req(`/db/clients/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    const d = readLocal();
    const i = d.clients.findIndex((x) => x.id === id);
    if (i >= 0) d.clients[i] = full; else d.clients.unshift(full);
    localAudit(d, id, prev ? 'client.update' : 'client.create', full.name);
    writeLocal(d);
  }
  set((s) => ({ clients: prev ? s.clients.map((x) => (x.id === id ? { ...full, role: x.role } : x)) : [{ ...full, role: 'owner' }, ...s.clients], clientsAt: `${now()}#${++rev}` }));
  return full;
}

/** Permanently removes a client with everything under it. `typedName` must match the client's name (checked again on the relay). */
export async function deleteClient(id: string, typedName: string): Promise<void> {
  const c = get().clients.find((x) => x.id === id);
  if (!c || typedName.trim().toLowerCase() !== c.name.trim().toLowerCase()) throw new Error('Gõ đúng tên khách hàng để xác nhận xoá.');
  if (isRelay()) await req(`/db/clients/${enc(id)}?confirm=${enc(typedName.trim())}`, { method: 'DELETE' });
  else { const d = readLocal(); d.clients = d.clients.filter((x) => x.id !== id); delete d.items[id]; delete d.audit[id]; writeLocal(d); }
  set((s) => ({ clients: s.clients.filter((x) => x.id !== id) }));
}

// ---------- items ----------
const cache = new Map<string, Item[]>(); // clientId -> items, newest first
export function cachedItems(clientId: string): Item[] | undefined { return cache.get(clientId); }

export async function listItems(clientId: string): Promise<Item[]> {
  const list = isRelay() ? (await req<{ items: Item[] }>(`/db/client/${enc(clientId)}/items`)).items : (readLocal().items[clientId] || []);
  cache.set(clientId, list);
  bump();
  return list;
}
export async function putItem<T>(clientId: string, kind: ItemKind, id: string, data: T): Promise<Item<T>> {
  const it: Item<T> = { kind, id, data, updatedAt: now() };
  if (isRelay()) {
    const r = await req<{ updatedAt: string }>(`/db/client/${enc(clientId)}/items/${kind}/${enc(id)}`, { method: 'PUT', body: JSON.stringify({ data, updatedAt: it.updatedAt }) });
    it.updatedAt = r.updatedAt;
  } else {
    const d = readLocal(); const arr = (d.items[clientId] ||= []);
    const i = arr.findIndex((x) => x.kind === kind && x.id === id);
    const prev = i >= 0 ? arr[i] : null;
    if (i >= 0) arr.splice(i, 1);
    arr.unshift(it as Item);
    const st = (data as { status?: string } | null)?.status, title = (data as { title?: string } | null)?.title || id;
    if (!prev) localAudit(d, clientId, `${kind}.create`, title);
    else if (st && st !== (prev.data as { status?: string } | null)?.status) localAudit(d, clientId, `${kind}.status`, `${title} → ${st}`);
    writeLocal(d);
  }
  const arr = (cache.get(clientId) || []).filter((x) => !(x.kind === kind && x.id === id));
  cache.set(clientId, [it as Item, ...arr]);
  bump();
  return it;
}
export async function deleteItem(clientId: string, kind: ItemKind, id: string): Promise<void> {
  if (isRelay()) await req(`/db/client/${enc(clientId)}/items/${kind}/${enc(id)}`, { method: 'DELETE' });
  else { const d = readLocal(); d.items[clientId] = (d.items[clientId] || []).filter((x) => !(x.kind === kind && x.id === id)); localAudit(d, clientId, `${kind}.delete`, id); writeLocal(d); }
  cache.set(clientId, (cache.get(clientId) || []).filter((x) => !(x.kind === kind && x.id === id)));
  bump();
}
/** Items changed: re-render whoever reads the cache. */
export const itemsRev = () => rev;
function bump() { rev++; set({ clientsAt: `${now()}#${rev}` }); } // a fresh value so memoised views recompute

// ---------- audit, export, review links, members ----------
export async function listAudit(clientId: string): Promise<AuditRow[]> {
  return isRelay() ? (await req<{ audit: AuditRow[] }>(`/db/client/${enc(clientId)}/audit`)).audit : (readLocal().audit[clientId] || []);
}
export async function exportClient(clientId: string): Promise<unknown> {
  if (isRelay()) return req(`/db/client/${enc(clientId)}/export`);
  const d = readLocal();
  const { db } = await import('../storage/idb');
  const projects = (await db.allProjects(get().user?.id || '')).filter((p) => p.clientId === clientId);
  return { exportedAt: now(), client: d.clients.find((c) => c.id === clientId), items: d.items[clientId] || [], audit: d.audit[clientId] || [], projects };
}
export async function listShares(clientId: string): Promise<ShareLink[]> { return isRelay() ? (await req<{ shares: ShareLink[] }>(`/db/client/${enc(clientId)}/share`)).shares : []; }
/** A review link for one item; the token goes in the URL fragment so it never reaches a server log. */
export async function createShare(clientId: string, kind: ItemKind, itemId: string, days = 30): Promise<string> {
  if (!isRelay()) throw new Error('Link duyệt cần tài khoản relay (đăng nhập bằng tài khoản Phloem trên relay).');
  const { token } = await req<{ token: string }>(`/db/client/${enc(clientId)}/share`, { method: 'POST', body: JSON.stringify({ kind, itemId, days }) });
  return reviewUrl(token);
}
export function reviewUrl(token: string): string {
  const here = new URL(location.href); here.hash = `#/review/${token}`; here.search = '';
  if (!/\/mkt\/?(index\.html)?$/.test(here.pathname)) here.pathname = here.pathname.replace(/\/(studio\/?)?(index\.html)?$/, '/') + 'mkt/';
  return here.toString();
}
export async function revokeShare(clientId: string, id: string): Promise<void> { await req(`/db/client/${enc(clientId)}/share/${enc(id)}`, { method: 'DELETE' }); }
export async function listMembers(clientId: string): Promise<{ members: Member[]; me: Role }> {
  if (!isRelay()) return { members: [], me: 'owner' };
  return req(`/db/client/${enc(clientId)}/members`);
}
export async function setMember(clientId: string, email: string, role: Role): Promise<void> { await req(`/db/client/${enc(clientId)}/members/${enc(email.trim().toLowerCase())}`, { method: 'PUT', body: JSON.stringify({ role }) }); }
export async function removeMember(clientId: string, email: string): Promise<void> { await req(`/db/client/${enc(clientId)}/members/${enc(email)}`, { method: 'DELETE' }); }

// ---------- public review (no account) ----------
export interface SharedItem { client: { name: string; logo: string; color: string }; kind: ItemKind; itemId: string; data: any; updatedAt: string; review: any; expiresAt: string }
function publicBase(): string { return (get().settings.relayUrl || '').replace(/\/$/, ''); }
export async function openShare(token: string): Promise<SharedItem> {
  await wakeRelay(publicBase());
  const r = await fetch(`${publicBase()}/share/${enc(token)}`, { signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Không mở được link (HTTP ${r.status}).`);
  return j;
}
export async function sendReview(token: string, body: { name: string; rows?: Record<string, string>; comments?: { row?: string | null; text: string }[]; overall?: string }): Promise<any> {
  const r = await fetch(`${publicBase()}/share/${enc(token)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Gửi không được (HTTP ${r.status}).`);
  return j.review;
}

/** Shrink an image file to a small square-ish PNG data URL for client logos. */
export async function logoDataUrl(src: Blob | string, max = 160): Promise<string> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
}
