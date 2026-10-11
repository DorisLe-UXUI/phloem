// IndexedDB persistence: projects (JSON) + assets (blobs). No dependencies.
import type { Asset, Project } from '../model/types';

const DB = 'phloem-studio', VER = 1;

export interface ProjectMeta { id: string; name: string; updatedAt: string; thumb?: string; thumbMobile?: string; provider?: string }

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
  }));
}

export interface StoredProject extends Project { thumb?: string; thumbMobile?: string; provider?: string; /** account id, '' for guest */ owner?: string }

export const db = {
  putProject: (p: StoredProject) => tx<IDBValidKey>('projects', 'readwrite', (s) => s.put(p)),
  getProject: (id: string) => tx<StoredProject | undefined>('projects', 'readonly', (s) => s.get(id)),
  deleteProject: (id: string) => tx<undefined>('projects', 'readwrite', (s) => s.delete(id)),
  listProjects: async (owner = ''): Promise<ProjectMeta[]> => {
    const all = await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll());
    return all.filter((p) => (p.owner || '') === owner).map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, thumb: p.thumb, thumbMobile: p.thumbMobile, provider: p.provider })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  countProjects: async (owner = ''): Promise<number> => (await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll())).filter((p) => (p.owner || '') === owner).length,
  /** Move every project of `from` (default: guest) to `to`. Returns how many moved. */
  claimProjects: async (to: string, from = ''): Promise<number> => {
    const all = (await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll())).filter((p) => (p.owner || '') === from);
    for (const p of all) await tx('projects', 'readwrite', (s) => s.put({ ...p, owner: to }));
    return all.length;
  },
  putAsset: async (a: Asset, blob: Blob) => { await tx('assets', 'readwrite', (s) => s.put(a)); await tx('blobs', 'readwrite', (s) => s.put(blob, a.id)); },
  getBlob: (id: string) => tx<Blob | undefined>('blobs', 'readonly', (s) => s.get(id)),
  listAssets: () => tx<Asset[]>('assets', 'readonly', (s) => s.getAll()),
  deleteAsset: async (id: string) => { await tx('assets', 'readwrite', (s) => s.delete(id)); await tx('blobs', 'readwrite', (s) => s.delete(id)); },
};
