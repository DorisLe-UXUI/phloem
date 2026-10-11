// In-memory asset registry backed by IndexedDB. Hands the renderer decoded images and notifies on load.
import type { Asset } from '../model/types';
import { uid } from '../model/types';
import { db } from './idb';
import type { ImageSource } from '../render/renderer';
import { cloud, type RemoteAsset } from './sync';

type Listener = () => void;

export class AssetStore implements ImageSource {
  private meta = new Map<string, Asset>();
  private blobs = new Map<string, Blob>();
  private urls = new Map<string, string>();
  private images = new Map<string, HTMLImageElement>();
  private listeners = new Set<Listener>();
  ready: Promise<void>;

  constructor() { this.ready = this.load(); }

  private async load() {
    try {
      const list = await db.listAssets();
      for (const a of list) this.meta.set(a.id, a);
    } catch { /* idb unavailable (private mode) */ }
  }

  onChange(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit() { for (const l of this.listeners) l(); }

  /** Project currently open in the editor: new assets are tagged with it. */
  context: { project: string | null } = { project: null };

  all(): Asset[] { return [...this.meta.values()].sort((a, b) => (b.at || '').localeCompare(a.at || '') || a.name.localeCompare(b.name)); }
  get(id: string): Asset | undefined { return this.meta.get(id); }

  async add(file: File | Blob, name = (file as File).name || 'image', extra: { src?: Asset['src']; project?: string | null } = {}): Promise<Asset> {
    const bmp = await createImageBitmap(file);
    const a: Asset = { id: uid('a'), name, mime: file.type || 'image/png', w: bmp.width, h: bmp.height, bytes: file.size, src: extra.src ?? { kind: 'upload' }, project: extra.project === undefined ? this.context.project : extra.project, at: new Date().toISOString() };
    bmp.close();
    this.meta.set(a.id, a);
    this.blobs.set(a.id, file);
    try { await db.putAsset(a, file); } catch { /* keep in memory */ }
    this.emit();
    void cloud.pushAsset(a, file).catch(() => { /* offline: the next full sync retries */ });
    return a;
  }

  /** Update library tags (project / source) on existing assets; persisted locally and mirrored to the relay. */
  tag(ids: string[], patch: { project?: string | null; src?: Asset['src'] }) {
    let changed = 0;
    for (const id of ids) {
      const a = this.meta.get(id); if (!a) continue;
      const next: Asset = { ...a, ...(patch.project !== undefined ? { project: patch.project } : {}), ...(patch.src ? { src: patch.src } : {}) };
      if (next.project === a.project && next.src === a.src) continue;
      this.meta.set(id, next); changed++;
      void db.putAssetMeta(next).catch(() => { /* keep in memory */ });
      void cloud.pushAssetMeta(next).catch(() => { /* offline */ });
    }
    if (changed) this.emit();
  }

  async addFromUrl(url: string, name: string): Promise<Asset> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return this.add(await res.blob(), name);
  }

  async remove(id: string) {
    this.meta.delete(id); this.blobs.delete(id); this.images.delete(id);
    const u = this.urls.get(id); if (u) URL.revokeObjectURL(u); this.urls.delete(id);
    try { await db.deleteAsset(id); } catch { /* ignore */ }
    this.emit();
    void cloud.deleteAsset(id);
  }

  /** Register assets that exist on the relay but not here; bytes are fetched lazily on first use. */
  registerRemote(list: RemoteAsset[]) {
    let added = 0;
    for (const r of list) {
      const cur = this.meta.get(r.id);
      if (!cur) { this.meta.set(r.id, { id: r.id, name: r.name, mime: r.mime, w: r.w, h: r.h, bytes: r.bytes, src: r.src, project: r.project ?? null, at: r.at || r.createdAt }); added++; }
      else if ((r.src || r.project) && !cur.src && !cur.project) { this.meta.set(r.id, { ...cur, src: r.src, project: r.project ?? null, at: cur.at || r.at || r.createdAt }); added++; }
    }
    if (added) this.emit();
  }

  async blob(id: string): Promise<Blob | undefined> {
    if (this.blobs.has(id)) return this.blobs.get(id);
    try { const b = await db.getBlob(id); if (b) { this.blobs.set(id, b); return b; } } catch { /* fall through to the cloud */ }
    const cb = await cloud.fetchAssetBlob(id);
    if (cb) { this.blobs.set(id, cb); const m = this.meta.get(id); if (m) { try { await db.putAsset(m, cb); } catch { /* ignore */ } } }
    return cb || undefined;
  }

  /** Object URL for <img>/preview use. */
  url(id: string): string | undefined {
    const u = this.urls.get(id);
    if (u) return u;
    const b = this.blobs.get(id);
    if (b) { const nu = URL.createObjectURL(b); this.urls.set(id, nu); return nu; }
    void this.blob(id).then((bb) => {
      if (bb) { this.urls.set(id, URL.createObjectURL(bb)); this.emit(); }
      else { const img = this.images.get(id); if (img && !img.src) this.images.delete(id); } // offline / relay error: the next draw retries
    });
    return undefined;
  }

  /** Decoded image for canvas drawing; kicks off loading and emits when ready. */
  image(id: string): HTMLImageElement | undefined {
    const img = this.images.get(id);
    if (img) return img.complete && img.naturalWidth ? img : undefined;
    const el = new Image();
    this.images.set(id, el);
    el.onload = () => this.emit();
    const u = this.url(id);
    if (u) el.src = u;
    else { const check = () => { if (this.images.get(id) !== el) { off(); return; } const uu = this.urls.get(id); if (uu) { el.src = uu; off(); } }; const off = this.onChange(check); }
    return undefined;
  }

  /** Make sure every asset used by the doc is decoded before rendering for export. */
  async ensure(ids: string[]): Promise<void> {
    await Promise.all(ids.map(async (id) => {
      if (!this.meta.has(id)) return;
      await this.blob(id);
      const u = this.url(id);
      const img = this.images.get(id) ?? new Image();
      this.images.set(id, img);
      if (!img.src && u) img.src = u;
      if (img.complete && img.naturalWidth) return;
      await new Promise<void>((res) => { img.onload = () => { this.emit(); res(); }; img.onerror = () => res(); });
    }));
  }
}

export const assets = new AssetStore();
