// Reopen where the user left off: the email being edited (or Khán giả / Database), the panel tabs and the camera.
// The URL fragment names the screen (#/e/<id>, #/khan-gia, #/admin, #/) so a refresh or a bookmark lands on it, the
// browser's back button walks between screens, and several browser tabs each keep their own email; localStorage
// remembers the last screen per account for a visit that arrives without a fragment (landing page, bookmark of /studio/).
import { get, set, subscribe, toast, type LeftTab, type RightTab, type State, type Variant } from '../store';
import * as A from './actions';

type Screen = { name: 'home' } | { name: 'editor'; projectId: string } | { name: 'audience' } | { name: 'admin' };
interface Cam { zoom: number; pan: { x: number; y: number }; variant: Variant; vw: number }
interface Saved { screen: Screen; rightTab?: RightTab; leftTab?: LeftTab; cams?: Record<string, Cam> }

const RIGHT: RightTab[] = ['design', 'email', 'export', 'ai'];
const LEFT: LeftTab[] = ['layers', 'blocks', 'assets', 'design', 'apps'];
const MAX_CAMS = 40;
const key = () => `phloem.resume.${get().user?.id || 'guest'}`;
const load = (): Saved | null => { try { const v = JSON.parse(localStorage.getItem(key()) || 'null'); return v && typeof v === 'object' && v.screen ? v : null; } catch { return null; } };
const store = (v: Saved) => { try { localStorage.setItem(key(), JSON.stringify(v)); } catch { /* full or blocked: resume is a convenience */ } };

export function parseHash(hash: string): Screen | null {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (!hash || hash === '#') return null;
  if (p[0] === 'e' && p[1]) return { name: 'editor', projectId: p[1] };
  if (p[0] === 'khan-gia') return { name: 'audience' };
  if (p[0] === 'admin') return { name: 'admin' };
  return { name: 'home' };
}
export function formatHash(s: Screen): string {
  switch (s.name) {
    case 'editor': return `#/e/${encodeURIComponent(s.projectId)}`;
    case 'audience': return '#/khan-gia';
    case 'admin': return '#/admin';
    default: return '#/';
  }
}
const screenOf = (s: State): Screen => (s.route.name === 'editor' ? { name: 'editor', projectId: s.route.projectId } : { name: s.route.name });
const same = (a: Screen, b: Screen) => a.name === b.name && (a.name !== 'editor' || a.projectId === (b as { projectId: string }).projectId);

/** Go to a screen the way the user would: saves the open email first, quietly skips emails that no longer exist. */
async function show(to: Screen, cams: Record<string, Cam> = {}, announce = false): Promise<boolean> {
  const s = get();
  if (same(screenOf(s), to)) return true;
  if (to.name === 'home') { await A.goHome(); return true; }
  if (to.name === 'audience' || to.name === 'admin') {
    if (to.name === 'admin' && !s.user?.admin) return false;
    if (s.route.name === 'editor') await A.goHome();
    set({ route: to });
    return true;
  }
  let meta = s.projects.find((p) => p.id === to.projectId);
  if (!meta && s.user) { await A.syncNow().catch(() => {}); meta = get().projects.find((p) => p.id === to.projectId); } // new device: email still on the relay
  if (!meta) return false;
  if (get().dirty) await A.saveProject();
  const cam = cams[to.projectId];
  const useCam = cam && Math.abs(cam.vw - innerWidth) < 80 && Number.isFinite(cam.zoom) && cam.zoom > 0; // another window size: fit instead
  if (useCam) A.setBoardCamera({ zoom: cam.zoom, pan: cam.pan }); // CanvasView takes this instead of zoom-to-fit
  await A.openProject(to.projectId);
  if (get().project?.id !== to.projectId) { A.setBoardCamera(null); return false; }
  if (cam?.variant === 'mobile' && get().project?.mobile) set({ variant: 'mobile' });
  if (useCam) set({ zoom: cam.zoom, pan: cam.pan });
  if (announce) toast(`Mở lại email đang làm: ${meta.name}`, 'info');
  return true;
}

let booted = false, applying = false;

/** Boot: land on the screen in the URL, else the last one this account used, with its tabs and camera. */
export async function resumeOnBoot() {
  if (get().app !== 'email' || booted) return;
  booted = true;
  const saved = load();
  if (saved?.rightTab && RIGHT.includes(saved.rightTab)) set({ rightTab: saved.rightTab });
  if (saved?.leftTab && LEFT.includes(saved.leftTab)) set({ leftTab: saved.leftTab });
  const fromUrl = parseHash(location.hash);
  const to = fromUrl || saved?.screen || { name: 'home' };
  const untouched = () => get().route.name === 'home' && !get().modal; // the user may have clicked something during a slow relay sync
  applying = true;
  try { if (to.name !== 'home' && untouched()) { const ok = await show(to, saved?.cams, !fromUrl); if (!ok && fromUrl) toast('Không còn email này (đã xoá hoặc thuộc tài khoản khác).', 'err'); } }
  finally { applying = false; }
  track();
}

function track() {
  let lastHash = location.hash, lastSnap = '', timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const s = get();
    const prev = load() || { screen: { name: 'home' } as Screen };
    const cams = { ...(prev.cams || {}) };
    if (s.route.name === 'editor' && s.project) {
      delete cams[s.project.id]; // re-insert so the most recent stays last
      cams[s.project.id] = { zoom: s.zoom, pan: s.pan, variant: s.variant, vw: innerWidth };
      const ids = Object.keys(cams);
      for (const id of ids.slice(0, Math.max(0, ids.length - MAX_CAMS))) delete cams[id];
    }
    store({ screen: screenOf(s), rightTab: s.rightTab, leftTab: s.leftTab, cams });
  };
  let first = true;
  const sync = () => {
    const s = get();
    const sc = screenOf(s);
    const snap = JSON.stringify([sc, s.rightTab, s.leftTab, s.variant, s.zoom, s.pan.x, s.pan.y, s.user?.id || '']);
    if (snap !== lastSnap) { lastSnap = snap; if (timer) clearTimeout(timer); timer = setTimeout(save, 400); }
    const h = formatHash(sc);
    if (h !== location.hash && (first || (h !== lastHash && !applying))) {
      // The landing screen replaces the entry it arrived on; later screen changes are steps the back button can undo.
      try { if (first) history.replaceState(null, '', h); else history.pushState(null, '', h); } catch { /* sandboxed frame: the fragment is a convenience */ }
    }
    lastHash = h; first = false;
  };
  subscribe(sync);
  sync();
  addEventListener('popstate', () => {
    const to = parseHash(location.hash) || { name: 'home' };
    if (same(screenOf(get()), to)) return;
    applying = true;
    void show(to, load()?.cams)
      .then((ok) => { if (!ok) { toast('Không còn email này (đã xoá hoặc thuộc tài khoản khác).', 'err'); return A.goHome(); } })
      .finally(() => {
        applying = false;
        const h = formatHash(screenOf(get()));
        if (h !== location.hash) { try { history.replaceState(null, '', h); } catch { /* ignore */ } } // a dead link becomes the screen shown
        lastHash = h;
      });
  });
}
