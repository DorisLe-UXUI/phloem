// The customer board: every email made for the same customer sits on the canvas as a frame next to the one being
// edited (like frames on a Figma page). Other frames are rendered once (and again when they change) and drawn as
// pictures; clicking one makes it the email being edited, without moving the camera.
import type { Doc } from '../model/types';
import type { ProjectMeta } from '../storage/idb';
import { db } from '../storage/idb';
import { renderToCanvas } from '../render/renderer';
import { prepareDoc } from '../render/exportSlices';
import { get, set } from '../store';
import * as A from '../pipeline/actions';

export interface Frame { id: string; name: string; x: number; w: number; h: number; meta: ProjectMeta | null; kind: 'email' | 'add' }

const GAP = 160;
const cache = new Map<string, { key: string; canvas: HTMLCanvasElement | null; w: number; h: number; loading: boolean }>();

/** Frames beside the active artboard (doc coordinates; the active email is always at x = 0). */
export function boardFrames(): Frame[] {
  const st = get(); const p = st.project;
  if (!p?.clientId) return [];
  const list = A.boardOf(p.clientId);
  const doc = A.doc();
  const slot = Math.max(600, doc.width);
  const scrapRight = st.scraps.reduce((m, sc) => Math.max(m, sc.x + sc.w), doc.width);
  let ai = list.findIndex((m) => m.id === p.id); if (ai < 0) ai = list.length;
  const out: Frame[] = [];
  const size = (m: ProjectMeta) => { const c = cache.get(m.id); return { w: c?.w || (st.variant === 'mobile' ? 375 : 600), h: c?.h || m.height || 1600 }; };
  for (let i = 0; i < ai; i++) { const m = list[i]; const z = size(m); out.push({ id: m.id, name: m.name, x: -(ai - i) * (slot + GAP) + (slot - z.w), w: z.w, h: z.h, meta: m, kind: 'email' }); }
  const r0 = Math.max(slot + GAP, scrapRight + GAP);
  let k = 0;
  for (let i = ai + 1; i < list.length; i++, k++) { const m = list[i]; const z = size(m); out.push({ id: m.id, name: m.name, x: r0 + k * (slot + GAP), w: z.w, h: z.h, meta: m, kind: 'email' }); }
  out.push({ id: '+', name: 'Email mới', x: r0 + k * (slot + GAP), w: st.variant === 'mobile' ? 375 : 600, h: 420, meta: null, kind: 'add' });
  return out;
}

/** The frame picture, rendering it in the background the first time (or after the email changed). */
export function framePicture(f: Frame): HTMLCanvasElement | null {
  if (!f.meta) return null;
  const variant = get().variant;
  const key = `${f.meta.updatedAt}:${variant}`;
  const c = cache.get(f.id);
  if (c && c.key === key) return c.canvas;
  if (c?.loading) return c.canvas;
  cache.set(f.id, { key: c?.key || '', canvas: c?.canvas || null, w: c?.w || f.w, h: c?.h || f.h, loading: true });
  void (async () => {
    try {
      const p = await db.getProject(f.id); if (!p) { cache.delete(f.id); return; }
      const doc: Doc = (variant === 'mobile' && p.mobile) || p.desktop;
      await prepareDoc(doc, p.brand);
      const scale = doc.height > 5000 ? 0.6 : 1;
      const canvas = renderToCanvas(doc, p.brand, (await import('../storage/assets')).assets, scale);
      cache.set(f.id, { key, canvas, w: doc.width, h: doc.height, loading: false });
    } catch { cache.set(f.id, { key, canvas: null, w: f.w, h: f.h, loading: false }); }
    set({}); // redraw
  })();
  return c?.canvas || null;
}

export function frameAt(x: number, y: number): Frame | null {
  for (const f of boardFrames()) if (x >= f.x && x <= f.x + f.w && y >= -40 && y <= f.h) return f;
  return null;
}

/** Click on a frame: edit that email (the camera keeps the frame where it is), or start a new one for this customer. */
export async function openFrame(f: Frame) {
  const st = get();
  if (f.kind === 'add') { set({ modal: 'templates' }); return; }
  await A.switchBoardFrame(f.id, { zoom: st.zoom, pan: { x: st.pan.x + f.x * st.zoom, y: st.pan.y } });
}
