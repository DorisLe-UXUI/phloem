// Cloud sync: when the account lives on the relay, projects, assets and client profiles are mirrored to the
// relay's database. IndexedDB stays the working copy, so the editor never waits on the network.
import type { Profile } from '../../../src/shared/types';
import type { Asset } from '../model/types';
import { getSession } from '../auth/core';
import { db, type StoredProject } from './idb';
import { get, set } from '../store';

export interface RemoteProjectMeta { id: string; name: string; updatedAt: string; createdAt: string; thumb?: string; thumbMobile?: string; provider?: string; size?: number }
export interface RemoteAsset { id: string; name: string; mime: string; w: number; h: number; bytes: number; createdAt: string }
export interface SyncState { state: 'off' | 'idle' | 'syncing' | 'error'; at?: string; msg?: string }

const pending = new Map<string, ReturnType<typeof setTimeout>>();

function session() { const s = getSession(); return s && s.mode === 'relay' ? s : null; }
function base(): string { const s = session(); const url = (s?.relayUrl || get().settings.relayUrl || '').replace(/\/$/, ''); return url; }
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const s = session(); const h: Record<string, string> = { ...extra };
  if (s) h.Authorization = `Bearer ${s.token}`;
  const tok = get().settings.relayToken; if (tok) h['X-Phloem-Token'] = tok;
  return h;
}
function status(patch: SyncState) { set({ sync: patch }); }

async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${base()}${path}`, { ...init, headers: headers({ ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...((init.headers as Record<string, string>) || {}) }), signal: AbortSignal.timeout(20_000) });
  if (r.status === 401) throw new Error('Phiên đăng nhập hết hạn. Đăng nhập lại.');
  if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch { /* ignore */ } throw new Error(m); }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : (r as unknown as T);
}

export const cloud = {
  /** True when the signed-in account is a relay account (projects live in the relay database). */
  active(): boolean { return !!session() && !!base(); },

  // ---------- projects ----------
  async listProjects(): Promise<RemoteProjectMeta[]> { return (await req<{ projects: RemoteProjectMeta[] }>('/db/projects')).projects; },
  async getProject(id: string): Promise<StoredProject | null> { try { return (await req<{ project: StoredProject }>(`/db/projects/${encodeURIComponent(id)}`)).project; } catch { return null; } },
  async pushProject(p: StoredProject): Promise<void> {
    if (!this.active()) return;
    const { owner, ...rest } = p;
    await req(`/db/projects/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify(rest) });
  },
  /** Debounced push after a local save: the editor saves often, the relay should not. */
  pushProjectSoon(p: StoredProject, delay = 1500): void {
    if (!this.active()) return;
    const t = pending.get(p.id); if (t) clearTimeout(t);
    pending.set(p.id, setTimeout(() => { pending.delete(p.id); status({ state: 'syncing' }); this.pushProject(p).then(() => status({ state: 'idle', at: new Date().toISOString() })).catch((e) => status({ state: 'error', msg: (e as Error).message })); }, delay));
  },
  async deleteProject(id: string): Promise<void> { if (!this.active()) return; try { await req(`/db/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* best effort */ } },

  // ---------- assets ----------
  async listAssets(): Promise<RemoteAsset[]> { return (await req<{ assets: RemoteAsset[] }>('/db/assets')).assets; },
  async pushAsset(a: Asset, blob: Blob): Promise<void> {
    if (!this.active()) return;
    await fetch(`${base()}/db/assets/${encodeURIComponent(a.id)}`, { method: 'PUT', headers: headers({ 'Content-Type': a.mime || 'application/octet-stream', 'X-Asset-Name': encodeURIComponent(a.name), 'X-Asset-W': String(a.w), 'X-Asset-H': String(a.h) }), body: blob });
  },
  async fetchAssetBlob(id: string): Promise<Blob | null> {
    if (!this.active()) return null;
    try { const r = await fetch(`${base()}/db/assets/${encodeURIComponent(id)}`, { headers: headers() }); return r.ok ? await r.blob() : null; } catch { return null; }
  },
  async deleteAsset(id: string): Promise<void> { if (!this.active()) return; try { await req(`/db/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* best effort */ } },

  // ---------- client profiles (encrypted at rest on the relay) ----------
  async pullProfiles(): Promise<Profile[]> { return (await req<{ profiles: Profile[] }>('/db/profiles')).profiles || []; },
  async pushProfiles(profiles: Profile[]): Promise<void> { if (!this.active()) return; try { await req('/db/profiles', { method: 'PUT', body: JSON.stringify({ profiles }) }); } catch { /* best effort */ } },

  /**
   * Two-way merge, last write wins by updatedAt: newer remote projects are pulled into IndexedDB, newer local ones
   * pushed. Remote asset metadata is returned so the asset store can register lazy entries. Profiles: remote wins by id.
   */
  async syncAll(owner: string): Promise<{ pulled: number; pushed: number; assets: RemoteAsset[]; profiles: Profile[] }> {
    const out = { pulled: 0, pushed: 0, assets: [] as RemoteAsset[], profiles: [] as Profile[] };
    if (!this.active() || !owner) { status({ state: 'off' }); return out; }
    status({ state: 'syncing' });
    try {
      const [remote, local] = await Promise.all([this.listProjects(), db.allProjects(owner)]);
      const localById = new Map(local.map((p) => [p.id, p]));
      const remoteById = new Map(remote.map((p) => [p.id, p]));
      for (const r of remote) {
        const l = localById.get(r.id);
        if (!l || l.updatedAt < r.updatedAt) { const full = await this.getProject(r.id); if (full) { await db.putProject({ ...full, owner }); out.pulled++; } }
      }
      for (const l of local) {
        const r = remoteById.get(l.id);
        if (!r || r.updatedAt < l.updatedAt) { await this.pushProject(l); out.pushed++; }
      }
      out.assets = await this.listAssets();
      const remoteProfiles = await this.pullProfiles();
      const localProfiles = get().profiles;
      const merged = [...remoteProfiles, ...localProfiles.filter((p) => !remoteProfiles.some((r) => r.id === p.id))];
      out.profiles = merged;
      if (merged.length !== remoteProfiles.length) await this.pushProfiles(merged);
      status({ state: 'idle', at: new Date().toISOString() });
    } catch (e) { status({ state: 'error', msg: (e as Error).message }); }
    return out;
  },
};
