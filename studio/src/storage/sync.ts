// Cloud sync: when the account lives on the relay, projects, assets and client profiles are mirrored to the
// relay's database. IndexedDB stays the working copy, so the editor never waits on the network.
import type { Profile } from '../../../src/shared/types';
import type { Asset } from '../model/types';
import { expired, getSession } from '../auth/core';
import { db, type StoredProject } from './idb';
import { get, set, history, type State } from '../store';
import { normalizeProject } from '../pipeline/actions';

export interface RemoteProjectMeta { id: string; name: string; updatedAt: string; createdAt: string; thumb?: string; thumbMobile?: string; provider?: string; size?: number }
export interface RemoteAsset { id: string; name: string; mime: string; w: number; h: number; bytes: number; createdAt: string; src?: Asset['src']; project?: string | null; client?: string | null; at?: string }
export interface SyncState { state: 'off' | 'idle' | 'syncing' | 'error'; at?: string; msg?: string }

const pending = new Map<string, { t: ReturnType<typeof setTimeout>; p: StoredProject }>();
const inflight = new Map<string, Promise<void>>();
const AT_KEY = 'phloem.profiles.at'; // relay updatedAt of the profiles array this device last pulled or pushed
let syncing: Promise<SyncResult> | null = null;

export interface SyncResult { pulled: number; pushed: number; assets: RemoteAsset[]; profiles: Profile[] | null }

function session() { const s = getSession(); return s && s.mode === 'relay' ? s : null; }
function base(): string { const s = session(); return (s?.relayUrl || get().settings.relayUrl || '').replace(/\/$/, ''); }
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const s = session(); const h: Record<string, string> = { ...extra };
  if (s) h.Authorization = `Bearer ${s.token}`;
  const tok = get().settings.relayToken; if (tok) h['X-Phloem-Token'] = tok;
  return h;
}
function status(patch: SyncState) { set({ sync: patch }); }
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${base()}${path}`, { ...init, headers: headers({ ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...((init.headers as Record<string, string>) || {}) }), signal: AbortSignal.timeout(20_000) });
  if (r.status === 401) throw expired(); // the relay revoked or expired the session: forget it so the UI asks to sign in
  if (!r.ok) { let m = `HTTP ${r.status}`; let j: any = null; try { j = await r.json(); m = j.error || m; } catch { /* ignore */ } throw Object.assign(new Error(m), { status: r.status, code: j?.code, updatedAt: j?.updatedAt }); }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : (r as unknown as T);
}

export const cloud = {
  /** True when the signed-in account is a relay account (projects live in the relay database). */
  active(): boolean { return !!session() && !!base(); },

  // ---------- projects ----------
  async listProjects(): Promise<{ projects: RemoteProjectMeta[]; deleted: { id: string; at: string }[] }> { const r = await req<{ projects: RemoteProjectMeta[]; deleted?: { id: string; at: string }[] }>('/db/projects'); return { projects: r.projects, deleted: r.deleted || [] }; },
  async getProject(id: string): Promise<StoredProject | null> { try { return (await req<{ project: StoredProject }>(`/db/projects/${encodeURIComponent(id)}`)).project; } catch { return null; } },
  async pushProject(p: StoredProject): Promise<void> {
    const s = session(); if (!s || !base()) return;
    if (p.owner && p.owner !== s.user.id) return; // never push a body that belongs to another account
    const { owner, ...rest } = p;
    try { await req(`/db/projects/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify(rest) }); }
    catch (e) {
      if ((e as { status?: number }).status !== 409) throw e;
      // the relay holds a newer copy (another device): take it unless this editor has unsaved edits
      const full = await this.getProject(p.id); if (!full) return;
      if (get().project?.id === p.id) { if (get().dirty) return; const { thumb: _a, thumbMobile: _b, provider: _c, owner: _d, ...proj } = full; history.clear(); set({ project: normalizeProject(proj), savedAt: proj.updatedAt, selection: [], editingText: null, enteredGroup: null, cropping: null, cutting: null }); }
      await db.putProject({ ...full, owner: s.user.id });
    }
  },
  /** Debounced push after a local save: the editor saves often, the relay should not. Pushes for one id are chained in order. */
  pushProjectSoon(p: StoredProject, delay = 1500): void {
    if (!this.active()) return;
    const cur = pending.get(p.id); if (cur) clearTimeout(cur.t);
    pending.set(p.id, { p, t: setTimeout(() => { pending.delete(p.id); this.pushNow(p); }, delay) });
  },
  pushNow(p: StoredProject): Promise<void> {
    status({ state: 'syncing' });
    const next = (inflight.get(p.id) || Promise.resolve()).catch(() => { /* earlier failure already reported */ }).then(() => this.pushProject(p));
    inflight.set(p.id, next);
    next.then(() => status({ state: 'idle', at: new Date().toISOString() })).catch((e) => status({ state: 'error', msg: (e as Error).message })).finally(() => { if (inflight.get(p.id) === next) inflight.delete(p.id); });
    return next;
  },
  /** Push every debounced project now (call before the session goes away). */
  async flush(): Promise<void> {
    const items = [...pending.values()]; pending.clear();
    for (const { t } of items) clearTimeout(t);
    await Promise.allSettled(items.map(({ p }) => this.pushNow(p)));
    await Promise.allSettled([...inflight.values()]);
  },
  async deleteProject(id: string): Promise<void> { if (!this.active()) return; const cur = pending.get(id); if (cur) { clearTimeout(cur.t); pending.delete(id); } try { await req(`/db/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); await db.clearTombstone(id); } catch { /* the local tombstone makes the next sync retry */ } },

  // ---------- assets ----------
  async listAssets(): Promise<RemoteAsset[]> { return (await req<{ assets: RemoteAsset[] }>('/db/assets')).assets; },
  async pushAsset(a: Asset, blob: Blob): Promise<void> {
    if (!this.active()) return;
    const r = await fetch(`${base()}/db/assets/${encodeURIComponent(a.id)}`, { method: 'PUT', headers: headers({ 'Content-Type': a.mime || 'application/octet-stream', 'X-Asset-Name': encodeURIComponent(a.name), 'X-Asset-W': String(a.w), 'X-Asset-H': String(a.h), 'X-Asset-Meta': encodeURIComponent(JSON.stringify({ src: a.src, project: a.project ?? null, client: a.client ?? null, at: a.at })) }), body: blob });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  },
  /** Tags only (project / source) for an asset the relay already has. */
  async pushAssetMeta(a: Asset): Promise<void> {
    if (!this.active()) return;
    await req(`/db/assets/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify({ meta: { src: a.src, project: a.project ?? null, client: a.client ?? null, at: a.at } }) });
  },
  async fetchAssetBlob(id: string): Promise<Blob | null> {
    if (!this.active()) return null;
    try { const r = await fetch(`${base()}/db/assets/${encodeURIComponent(id)}`, { headers: headers() }); return r.ok ? await r.blob() : null; } catch { return null; }
  },
  async deleteAsset(id: string): Promise<void> { if (!this.active()) return; try { await req(`/db/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* best effort */ } },

  // ---------- key/value (catalog…) ----------
  async kvGet<T = unknown>(key: string): Promise<{ value: T | null; updatedAt: string | null }> { if (!this.active()) return { value: null, updatedAt: null }; try { return await req(`/db/kv/${encodeURIComponent(key)}`); } catch { return { value: null, updatedAt: null }; } },
  async kvPut(key: string, value: unknown, updatedAt?: string): Promise<void> { if (!this.active()) return; try { await req(`/db/kv/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value, updatedAt }) }); } catch { /* best effort */ } },

  // ---------- client profiles (encrypted at rest on the relay) ----------
  async pullProfiles(): Promise<{ profiles: Profile[]; updatedAt: string | null; corrupt?: boolean }> { const r = await req<{ profiles: Profile[]; updatedAt: string | null; corrupt?: boolean }>('/db/profiles'); return { profiles: r.profiles || [], updatedAt: r.updatedAt ?? null, corrupt: !!r.corrupt }; },
  async pushProfiles(profiles: Profile[]): Promise<void> {
    if (!this.active()) return;
    try { const { updatedAt } = await req<{ updatedAt: string }>('/db/profiles', { method: 'PUT', body: JSON.stringify({ profiles }) }); lsSet(AT_KEY, updatedAt); } catch { /* best effort */ }
  },

  /**
   * Two-way merge, last write wins by updatedAt. Newer remote projects are pulled into IndexedDB (and into the open editor
   * unless it has unsaved edits), newer local ones pushed. Local assets the relay lacks are uploaded; remote asset metadata is
   * returned so the asset store can register lazy entries. Profiles: whole-array last-write-wins keyed on the relay's updatedAt.
   */
  syncAll(owner: string): Promise<SyncResult> {
    if (syncing) return syncing;
    syncing = this.syncOnce(owner).finally(() => { syncing = null; });
    return syncing;
  },
  async syncOnce(owner: string): Promise<SyncResult> {
    const out: SyncResult = { pulled: 0, pushed: 0, assets: [], profiles: null };
    if (!this.active() || !owner) { status({ state: 'off' }); return out; }
    status({ state: 'syncing' });
    try {
      const [{ projects: remote, deleted }, local0, tombs] = await Promise.all([this.listProjects(), db.allProjects(owner), db.tombstones()]);
      // deletes travel both ways: ours reach the relay (retried until they do), the relay's reach this device
      const remoteById = new Map(remote.map((p) => [p.id, p]));
      for (const t of tombs) { if (remoteById.has(t.id)) { try { await req(`/db/projects/${encodeURIComponent(t.id)}`, { method: 'DELETE' }); } catch { continue; } remoteById.delete(t.id); } await db.clearTombstone(t.id); }
      const localGone = new Set<string>();
      for (const d of deleted) {
        const l = local0.find((p) => p.id === d.id);
        if (!l || l.updatedAt > d.at) continue; // edited here after the delete elsewhere: it lives again (pushed below)
        if (get().project?.id === d.id && get().dirty) continue;
        await db.deleteProject(d.id); await db.clearTombstone(d.id); localGone.add(d.id);
        if (get().project?.id === d.id) set({ route: { name: 'home' }, project: null, selection: [], modal: null });
      }
      const local = local0.filter((p) => !localGone.has(p.id));
      const localById = new Map(local.map((p) => [p.id, p]));
      for (const r of [...remoteById.values()]) {
        const l = localById.get(r.id);
        if (l && l.updatedAt >= r.updatedAt) continue;
        const lNow = await db.getProject(r.id); if (lNow && lNow.updatedAt >= r.updatedAt) continue; // a save landed while we were pulling
        const full = await this.getProject(r.id); if (!full) continue;
        if (get().project?.id === r.id) {
          if (get().dirty) continue; // mid-edit here: keep local, the autosave pushes it as the newer copy
          const cur = pending.get(r.id); if (cur) { clearTimeout(cur.t); pending.delete(r.id); }
          const { thumb: _a, thumbMobile: _b, provider: _c, owner: _d, ...proj } = full;
          history.clear(); set({ project: normalizeProject(proj), savedAt: proj.updatedAt, selection: [], editingText: null, enteredGroup: null, cropping: null, cutting: null });
        }
        await db.putProject({ ...full, owner }); out.pulled++;
      }
      for (const l of local) {
        const r = remoteById.get(l.id);
        if (!r || r.updatedAt < l.updatedAt) { await this.pushProject(l); out.pushed++; }
      }
      out.assets = await this.listAssets();
      const remoteIds = new Set(out.assets.map((a) => a.id));
      for (const a of await db.listAssets()) {
        if (remoteIds.has(a.id)) continue;
        const b = await db.getBlob(a.id);
        if (b) { try { await this.pushAsset(a, b); } catch { /* oversized, non-image or transient: retried next sync */ } }
      }
      const kv = await this.kvGet<unknown[]>('catalog');
      const st = get();
      if (kv.updatedAt && (!st.catalogAt || kv.updatedAt > st.catalogAt) && Array.isArray(kv.value)) set({ catalog: kv.value as State['catalog'], catalogAt: kv.updatedAt });
      else if (st.catalogAt && (!kv.updatedAt || st.catalogAt > kv.updatedAt) && st.catalog.length) await this.kvPut('catalog', st.catalog, st.catalogAt);
      const remoteP = await this.pullProfiles();
      const seenAt = lsGet(AT_KEY);
      const localProfiles = get().profiles;
      if (remoteP.corrupt) { if (localProfiles.length) await this.pushProfiles(localProfiles); } // relay secret changed: our copy is the only readable one
      else if (remoteP.updatedAt && remoteP.updatedAt !== seenAt && remoteP.profiles.length) {
        // someone else wrote since we last synced: remote wins per client id, ours that the relay lacks are kept and pushed
        const byId = new Map(localProfiles.map((p) => [p.id, p])); for (const p of remoteP.profiles) byId.set(p.id, p);
        const merged = [...byId.values()]; out.profiles = merged; lsSet(AT_KEY, remoteP.updatedAt);
        if (merged.length !== remoteP.profiles.length) await this.pushProfiles(merged);
      }
      else if (localProfiles.length) { await this.pushProfiles(localProfiles); } // never replace a non-empty local list with an empty remote one
      status({ state: 'idle', at: new Date().toISOString() });
    } catch (e) { status({ state: 'error', msg: (e as Error).message }); }
    return out;
  },
};
