// Tiny observable store for Preact. Subscribers are notified once per animation frame.
import { getSession, type User } from './auth/core';
import type { CatalogItem } from './catalog/catalog';
import type { SiteProduct } from './ai/site';
import { useEffect, useState } from 'preact/hooks';
import type { Profile, Settings } from '../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import type { Project } from './model/types';
import { History } from './model/history';
import type { ProjectMeta } from './storage/idb';

export type Tool = 'select' | 'rect' | 'text' | 'image' | 'hand';
export type Variant = 'desktop' | 'mobile';
export type Modal = null | 'templates' | 'clients' | 'settings' | 'preview' | 'export' | 'shortcuts' | 'figma' | 'brand' | 'rename' | 'ai' | 'auth' | 'catalog';
export type RightTab = 'design' | 'email' | 'export' | 'ai';
export type LeftTab = 'layers' | 'blocks' | 'assets';

export interface Toast { id: number; text: string; kind: 'ok' | 'err' | 'info' }

export interface StudioSettings extends Settings { snap: boolean; grid: boolean; autosave: boolean; anthropicKey: string; aiModel: string }

export interface State {
  route: { name: 'home' } | { name: 'editor'; projectId: string };
  projects: ProjectMeta[];
  project: Project | null;
  variant: Variant;
  selection: string[];
  hover: string | null;
  tool: Tool;
  zoom: number;
  pan: { x: number; y: number };
  editingText: string | null;
  /** Group the user has "entered" by double-clicking. */
  enteredGroup: string | null;
  modal: Modal;
  rightTab: RightTab;
  leftTab: LeftTab;
  /** Phone layout: panels become bottom sheets over the canvas; this says which one is up. */
  mobilePane: 'canvas' | 'left' | 'right';
  profiles: Profile[];
  settings: StudioSettings;
  toasts: Toast[];
  dirty: boolean;
  savedAt: string | null;
  busy: { label: string; done: number; total: number } | null;
  log: { t: string; k?: 'ok' | 'er' }[];
  result: { text: string; url?: string } | null;
  clipboard: unknown[] | null;
  fontsLoaded: number;
  /** Signed-in account (local or relay). Projects are listed per account. */
  user: User | null;
  authTab: 'login' | 'register';
  /** Projects created while signed out, offered for claiming after sign-in. */
  guestProjects: number;
  /** Cloud sync status (relay accounts only). */
  sync: { state: 'off' | 'idle' | 'syncing' | 'error'; at?: string; msg?: string };
  /** Kho hàng: imported products; persisted locally and mirrored to the relay kv store. */
  catalog: CatalogItem[];
  catalogAt: string | null;
  /** Products handed to the AI composer from the catalog (consumed when the AI modal opens). */
  aiSeed: { products: SiteProduct[]; goal?: string; brief?: string } | null;
  /** Pasteboard: images parked beside the artboard (doc coordinates), dragged into the email when needed. */
  scraps: Scrap[];
  scrapSel: string | null;
  /** Image layer in crop mode (double-click): drag pans the photo, wheel zooms. */
  cropping: string | null;
  /** Image layer in "cut a region" mode: drag a rectangle on it to make a new layer from that part. */
  cutting: string | null;
  /** Preview the layer animations on the canvas (looping). */
  playing: boolean;
}

export interface Scrap { id: string; assetId: string; x: number; y: number; w: number; h: number }

const LS_PROFILES = 'phloem.studio.profiles', LS_SETTINGS = 'phloem.studio.settings', LS_CATALOG = 'phloem.catalog';

function loadLS<T>(k: string, fb: T): T { try { const v = localStorage.getItem(k); return v ? { ...fb, ...JSON.parse(v) } : fb; } catch { return fb; } }

export const initialState: State = {
  route: { name: 'home' },
  projects: [],
  project: null,
  variant: 'desktop',
  selection: [],
  hover: null,
  tool: 'select',
  zoom: 1,
  pan: { x: 0, y: 0 },
  editingText: null,
  enteredGroup: null,
  modal: null,
  user: getSession()?.user ?? null,
  authTab: 'login',
  guestProjects: 0,
  sync: { state: 'off' },
  catalog: loadLS<{ items: CatalogItem[]; at: string | null }>(LS_CATALOG, { items: [], at: null }).items,
  catalogAt: loadLS<{ items: CatalogItem[]; at: string | null }>(LS_CATALOG, { items: [], at: null }).at,
  aiSeed: null,
  scraps: [],
  scrapSel: null,
  cropping: null,
  cutting: null,
  playing: false,
  rightTab: 'design',
  leftTab: 'layers',
  mobilePane: 'canvas',
  profiles: (() => { try { return JSON.parse(localStorage.getItem(LS_PROFILES) || '[]'); } catch { return []; } })(),
  settings: loadLS<StudioSettings>(LS_SETTINGS, { ...DEFAULT_SETTINGS, relayUrl: (typeof document !== 'undefined' && (document.querySelector('meta[name="phloem-relay"]') as HTMLMetaElement | null)?.content) || DEFAULT_SETTINGS.relayUrl, snap: true, grid: false, autosave: true, anthropicKey: '', aiModel: 'claude-opus-5-5' }),
  toasts: [],
  dirty: false,
  savedAt: null,
  busy: null,
  log: [],
  result: null,
  clipboard: null,
  fontsLoaded: 0,
};

let state: State = initialState;
const subs = new Set<() => void>();
let scheduled = false;

export const history = new History();

export function get(): State { return state; }

// Re-render on the next frame; a timer fallback keeps state flowing while the tab is hidden (rAF pauses there:
// phones switching apps mid-generation, background tabs) so nothing waits on the next paint to settle.
let tick = 0;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  const id = ++tick;
  const run = () => { if (id !== tick || !scheduled) return; scheduled = false; for (const s of subs) s(); };
  requestAnimationFrame(run);
  setTimeout(run, 200);
}

export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if ('profiles' in p) { try { localStorage.setItem(LS_PROFILES, JSON.stringify(state.profiles)); } catch { /* ignore */ } }
  if ('settings' in p) { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch { /* ignore */ } }
  if ('catalog' in p) { try { localStorage.setItem(LS_CATALOG, JSON.stringify({ items: state.catalog, at: state.catalogAt })); } catch { /* ignore */ } }
  schedule();
}

export function subscribe(fn: () => void): () => void { subs.add(fn); return () => subs.delete(fn); }

export function useStore(): State {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return state;
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'err' ? 7000 : 3500);
}

export function log(t: string, k?: 'ok' | 'er') { set((s) => ({ log: [...s.log.slice(-40), { t, k }] })); }

/** Phone-sized viewport (matches the `@media (max-width: 820px)` layout in styles.css). */
export const isMobile = () => typeof matchMedia === 'function' && matchMedia('(max-width: 820px)').matches;
