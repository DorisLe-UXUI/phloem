// AI access codes (relay /aiaccess): ask the admin for a code, redeem it, and the admin's console.
import { get, set } from '../store';
import * as auth from '../auth/core';
import { relayAuth, wakeRelay } from './client';

export interface AccessState { access: boolean; admin: boolean; requested: 'pending' | 'done' | null; adminEmail: string }
export interface AdminData {
  requests: { userId: string; email: string; name: string; note: string; at: string; status: 'pending' | 'done' }[];
  users: { id: string; name: string; email: string; createdAt: string; ai: boolean; google: boolean }[];
  codes: { id: string; note: string; createdAt: string; usedBy: string | null; usedAt: string | null }[];
}

const base = () => (auth.getSession()?.relayUrl || get().settings.relayUrl || '').replace(/\/$/, '');
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = base(); if (!url) throw new Error('Chưa có relay (Cài đặt → Relay URL).');
  if (auth.getSession()?.mode !== 'relay') throw new Error('Cần đăng nhập tài khoản (relay) trước.');
  await wakeRelay(url, relayAuth());
  const r = await fetch(url + '/aiaccess' + path, { ...init, headers: { 'Content-Type': 'application/json', ...relayAuth() }, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw auth.expired();
  if (!r.ok) throw new Error(j.error || `Relay trả ${r.status}`);
  return j as T;
}

export const aiAccess = () => call<AccessState>('/');
export async function requestAi(note: string): Promise<{ mailto: string; mailed: boolean }> { return call('/request', { method: 'POST', body: JSON.stringify({ note }) }); }
/** Redeem a code; on success the session's user gets ai=true (no re-login needed). */
export async function redeemAi(code: string): Promise<void> {
  const r = await call<{ ok: boolean; user: auth.User }>('/redeem', { method: 'POST', body: JSON.stringify({ code }) });
  const s = auth.getSession();
  if (s && r.user) { auth.updateSessionUser(r.user); set({ user: r.user }); }
}
export const adminData = () => call<AdminData>('/admin');
export const adminCode = (note: string) => call<{ code: string }>('/admin/code', { method: 'POST', body: JSON.stringify({ note }) });
export const adminGrant = (userId: string, on: boolean) => call<{ ok: boolean }>('/admin/grant', { method: 'POST', body: JSON.stringify({ userId, on }) });
