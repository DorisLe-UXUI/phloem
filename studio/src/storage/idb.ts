// IndexedDB persistence: projects (JSON) + assets (blobs). No dependencies.
import type { Asset, Project } from '../model/types';

const DB = 'phloem-studio', VER = 2;

export interface ProjectMeta { id: string; name: string; updatedAt: string; thumb?: string; thumbMobile?: string; provider?: string; clientId?: string }

let conn: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (conn) return conn;
  conn = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('tombstones')) db.createObjectStore('tombstones', { keyPath: 'id' }); // projects deleted here, until the relay knows
    };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); conn = null; }; db.onclose = () => { conn = null; }; res(db); };
    r.onerror = () => { conn = null; rej(r.error); };
    r.onblocked = () => { conn = null; rej(new Error('IndexedDB đang bị tab khác giữ')); };
  });
  return conn;
}

/** One transaction over one or more stores; resolves only when it COMMITS (a quota abort after request success is still a failure). */
function txAll<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | IDBRequest | void): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(stores, mode);
    let result: T | undefined;
    const req = fn(t);
    if (req) req.onsuccess = () => { result = req.result as T; };
    t.oncomplete = () => res(result as T);
    t.onerror = () => rej(t.error || new Error('IndexedDB lỗi'));
    t.onabort = () => rej(t.error || new Error('IndexedDB huỷ giao dịch (hết dung lượng?)'));
  }));
}
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest): Promise<T> {
  return txAll<T>([store], mode, (t) => fn(t.objectStore(store)));
}

export interface StoredProject extends Project { thumb?: string; thumbMobile?: string; provider?: string; /** account id, '' for guest */ owner?: string }

export const db = {
  putProject: (p: StoredProject) => tx<IDBValidKey>('projects', 'readwrite', (s) => s.put(p)),
  getProject: (id: string) => tx<StoredProject | undefined>('projects', 'readonly', (s) => s.get(id)),
  deleteProject: (id: string) => txAll<undefined>(['projects', 'tombstones'], 'readwrite', (t) => { t.objectStore('projects').delete(id); t.objectStore('tombstones').put({ id, at: new Date().toISOString() }); }),
  tombstones: () => tx<{ id: string; at: string }[]>('tombstones', 'readonly', (s) => s.getAll()),
  clearTombstone: (id: string) => tx<undefined>('tombstones', 'readwrite', (s) => s.delete(id)),
  listProjects: async (owner = ''): Promise<ProjectMeta[]> => {
    const all = await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll());
    return all.filter((p) => (p.owner || '') === owner).map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, thumb: p.thumb, thumbMobile: p.thumbMobile, provider: p.provider, clientId: p.clientId })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  allProjects: async (owner = ''): Promise<StoredProject[]> => (await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll())).filter((p) => (p.owner || '') === owner),
  countProjects: async (owner = ''): Promise<number> => (await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll())).filter((p) => (p.owner || '') === owner).length,
  /** Move every project of `from` (default: guest) to `to`. Returns how many moved. */
  claimProjects: async (to: string, from = ''): Promise<number> => {
    const all = (await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll())).filter((p) => (p.owner || '') === from);
    for (const p of all) await tx('projects', 'readwrite', (s) => s.put({ ...p, owner: to }));
    return all.length;
  },
  putAsset: (a: Asset, blob: Blob) => txAll<void>(['assets', 'blobs'], 'readwrite', (t) => { t.objectStore('assets').put(a); t.objectStore('blobs').put(blob, a.id); }), // one commit: never a meta row without its bytes
  putAssetMeta: (a: Asset) => tx('assets', 'readwrite', (s) => s.put(a)),
  getBlob: (id: string) => tx<Blob | undefined>('blobs', 'readonly', (s) => s.get(id)),
  listAssets: () => tx<Asset[]>('assets', 'readonly', (s) => s.getAll()),
  deleteAsset: (id: string) => txAll<void>(['assets', 'blobs'], 'readwrite', (t) => { t.objectStore('assets').delete(id); t.objectStore('blobs').delete(id); }),
};
