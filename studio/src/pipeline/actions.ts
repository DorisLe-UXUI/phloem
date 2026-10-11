// Editor actions: every mutation of the project goes through here (history, dirty flag, autosave).
import type { BlockKind, Check, NNode, SlicePlan, Suggestion, SuggestionAction, TemplateKind } from '../../../src/shared/types';
import { planSlices } from '../../../src/shared/slicer';
import { runChecks } from '../../../src/shared/checks';
import { suggest } from '../../../src/shared/suggestions';
import type { Asset, Brand, Color, Doc, ImageNode, Node, Project, RectNode, TextNode } from '../model/types';
import { DEFAULT_BRAND, uid } from '../model/types';
import * as ops from '../model/ops';
import { contrastToken, logoAssetFor, makeBlock, makeTemplate, text as mkText, rect as mkRect, image as mkImage } from '../model/templates';
import type { DraftRecord } from '../../../src/shared/types';
import { docToNNode } from '../model/toNNode';
import { textHeight } from '../render/textLayout';
import { thumbnail } from '../render/renderer';
import { ensureFonts } from '../render/fonts';
import { db } from '../storage/idb';
import { assets } from '../storage/assets';
import { cropRegion, removeBackground, removeBackgroundAI, splitSprites } from '../storage/imageTools';
import { imageDrawRect } from '../render/renderer';
import { get, history, set, toast, type Scrap, type Variant } from '../store';
import { downloadBytes } from '../../../src/ui/clipboard';
import * as auth from '../auth/core';
import { cloud } from '../storage/sync';

const ownerId = () => get().user?.id || '';
/** Relay settings from the Studio store (the landing reads the same values from localStorage). */
export const authOpts = () => ({ relayUrl: (get().settings.relayUrl || '').replace(/\/$/, ''), relayToken: get().settings.relayToken || '' });

// ---------- document access ----------
export function doc(): Doc {
  const s = get();
  const p = s.project!;
  return s.variant === 'mobile' && p.mobile ? p.mobile : p.desktop;
}

export function brand(): Brand { return get().project?.brand ?? DEFAULT_BRAND; }

let saveTimer: number | null = null;

/** The artboard hugs its content unless the user typed a height (autoHeight === false). Empty docs keep their size. */
export function fitHeight(d: Doc): Doc {
  if (d.autoHeight === false || !d.nodes.length) return d;
  const h = Math.max(100, ops.contentHeight(d));
  return h === d.height ? d : { ...d, height: h };
}

export function commit(next: Doc, pushHistory = true) {
  const s = get();
  if (!s.project) return;
  const cur = doc();
  if (next === cur) return;
  next = fitHeight(next);
  if (pushHistory) history.push(cur);
  const project: Project = s.variant === 'mobile' && s.project.mobile ? { ...s.project, mobile: next } : { ...s.project, desktop: next };
  set({ project, dirty: true });
  scheduleSave();
}

export function patchProject(p: Partial<Project>) {
  const s = get();
  if (!s.project) return;
  set({ project: { ...s.project, ...p }, dirty: true });
  scheduleSave();
}

function scheduleSave() {
  if (!get().settings.autosave) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void saveProject(); }, 900);
}

export async function saveProject(): Promise<void> {
  const s = get();
  if (!s.project) return;
  const p: Project = { ...s.project, updatedAt: new Date().toISOString() };
  let thumb: string | undefined, thumbMobile: string | undefined;
  try { thumb = thumbnail(p.desktop, p.brand, assets, 320); if (p.mobile) thumbMobile = thumbnail(p.mobile, p.brand, assets, 160); } catch { /* fonts/images not ready */ }
  const provider = (Object.values(p.drafts || {})[0] as DraftRecord | undefined)?.provider;
  try {
    const stored = { ...p, thumb, thumbMobile, provider, owner: ownerId() };
    await db.putProject(stored);
    cloud.pushProjectSoon(stored);
    set({ project: p, dirty: false, savedAt: p.updatedAt });
    void refreshProjects();
  } catch (e) { toast(`Không lưu được: ${(e as Error).message}`, 'err'); }
}

export async function refreshProjects() {
  try { const o = ownerId(); set({ projects: await db.listProjects(o), guestProjects: o ? await db.countProjects('') : 0 }); } catch { /* ignore */ }
}

export function undo() { const prev = history.undo(doc()); if (prev) { commit(prev, false); set({ selection: get().selection.filter((id) => ops.findNode(prev, id)) }); } }
export function redo() { const next = history.redo(doc()); if (next) commit(next, false); }

// ---------- selection ----------
export function select(ids: string[], additive = false) {
  const s = get();
  const next = additive ? Array.from(new Set([...s.selection, ...ids])) : ids;
  set({ selection: next, editingText: null });
}
export function toggleSelect(id: string) {
  const s = get();
  set({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] });
}
export function clearSelection() { set({ selection: [], editingText: null, enteredGroup: null }); }
export function selectAll() { set({ selection: doc().nodes.filter((n) => n.visible && !n.locked).map((n) => n.id) }); }

export function selectedNodes(): Node[] { const d = doc(); return get().selection.map((id) => ops.findNode(d, id)).filter((n): n is Node => !!n); }

// ---------- edits ----------
export function updateSelected(fn: (n: Node) => Node) { const s = get(); if (!s.selection.length) return; commit(ops.updateNodes(doc(), s.selection, fn)); }
export function updateNode(id: string, patch: Partial<Node> | ((n: Node) => Node)) { commit(ops.updateNode(doc(), id, patch)); }

/** Re-measure auto-height texts (after font load or text edits). */
export function fixTextHeight(n: Node): Node {
  if (n.type !== 'text' || !n.autoHeight) return n;
  const h = textHeight(n as TextNode, brand());
  return h === n.h ? n : { ...n, h };
}
/** Apply a text patch and flow the layout if the auto height changes. */
export function patchTextFlow(id: string, patch: Partial<TextNode>, pushHistory = true) {
  const d = doc();
  const n = ops.findNode(d, id);
  if (!n || n.type !== 'text') return;
  const next = { ...n, ...patch } as TextNode;
  const h = next.autoHeight ? textHeight(next, brand()) : next.h;
  let out = ops.updateNode(d, id, { ...patch, h: n.h } as Partial<Node>);
  out = ops.setHeightFlow(out, id, h);
  commit(out, pushHistory);
}

export function remeasureAll() {
  const d = doc();
  const next = ops.mapNodes(d, fixTextHeight);
  if (next !== d) commit(next, false);
}

export function deleteSelection() { const s = get(); if (s.scrapSel) { removeScrap(s.scrapSel); return; } if (!s.selection.length) return; commit(ops.removeNodes(doc(), s.selection)); set({ selection: [] }); }
export function duplicateSelection() { const s = get(); if (!s.selection.length) return; const r = ops.duplicate(doc(), topLevelIds(s.selection)); commit(r.doc); set({ selection: r.ids }); }
export function groupSelection() { const ids = topLevelIds(get().selection); if (ids.length < 2) return; const r = ops.group(doc(), ids); commit(r.doc); set({ selection: [r.id] }); }
export function ungroupSelection() {
  let d = doc(); let ids: string[] = [];
  for (const id of get().selection) { const n = ops.findNode(d, id); if (n?.type === 'group') { const r = ops.ungroup(d, id); d = r.doc; ids = ids.concat(r.ids); } else ids.push(id); }
  commit(d); set({ selection: ids });
}
/**
 * Layer order the way designers expect: stepping a free layer "down" over a block moves it INTO the block (as its top child)
 * so the next steps slide it behind the product, the text, the glow…; stepping the top child "up" moves it back OUT above the block.
 */
function reorderSmart(d: Doc, id: string, dir: 'up' | 'down' | 'top' | 'bottom'): Doc {
  const n = ops.findNode(d, id); if (!n) return d;
  const parent = ops.findParent(d, id);
  const hits = (a: ops.Rect, b: ops.Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (!parent && (dir === 'down' || dir === 'up')) {
    // Only layers that overlap matter visually: jump straight to the nearest overlapping one (down enters a block).
    const i = d.nodes.findIndex((x) => x.id === id);
    const nb = ops.bounds(n);
    if (dir === 'down') {
      for (let j = i - 1; j >= 0; j--) {
        const o = d.nodes[j]; if (!hits(ops.bounds(o), nb)) continue;
        const without = { ...d, nodes: d.nodes.filter((x) => x.id !== id) };
        if (o.type === 'group') return ops.updateNode(without, o.id, (g) => (g.type === 'group' ? ops.syncGroup({ ...g, children: [...g.children, n] }) : g));
        return ops.insertNodes(without, [n], j);
      }
      return ops.reorder(d, id, 'bottom');
    }
    for (let j = i + 1; j < d.nodes.length; j++) {
      const o = d.nodes[j]; if (!hits(ops.bounds(o), nb)) continue;
      const without = { ...d, nodes: d.nodes.filter((x) => x.id !== id) };
      return ops.insertNodes(without, [n], j); // j shifted down by one after removal → lands right above o
    }
    return ops.reorder(d, id, 'top');
  }
  if (dir === 'up' && parent) {
    const idx = parent.children.findIndex((x) => x.id === id);
    if (idx === parent.children.length - 1) {
      const stripped = ops.updateNode(d, parent.id, (g) => (g.type === 'group' ? ops.syncGroup({ ...g, children: g.children.filter((x) => x.id !== id) }) : g));
      const top = ops.topLevelOf(stripped, parent.id) ?? parent;
      const ti = stripped.nodes.findIndex((x) => x.id === top.id);
      return ops.insertNodes(stripped, [n], ti + 1);
    }
  }
  return ops.reorder(d, id, dir);
}
export function reorderSelection(dir: 'up' | 'down' | 'top' | 'bottom') { let d = doc(); for (const id of get().selection) d = reorderSmart(d, id, dir); commit(d); }
export function alignSelection(how: ops.AlignHow) { commit(ops.align(doc(), get().selection, how)); }
export function distributeSelection(axis: 'h' | 'v') { commit(ops.distribute(doc(), get().selection, axis)); }
export function nudge(dx: number, dy: number) { const s = get(); if (!s.selection.length) return; commit(ops.moveBy(doc(), s.selection, dx, dy)); }
export function toggleVisible(id: string) { updateNode(id, (n) => ({ ...n, visible: !n.visible })); }
export function toggleLocked(id: string) { updateNode(id, (n) => ({ ...n, locked: !n.locked })); }

/** Only top-level ancestors of the given ids (grouping/duplicating operate at top level). */
function topLevelIds(ids: string[]): string[] {
  const d = doc();
  return Array.from(new Set(ids.map((id) => ops.topLevelOf(d, id)?.id).filter((x): x is string => !!x)));
}

export function copySelection() { const d = doc(); const nodes = topLevelIds(get().selection).map((id) => ops.findNode(d, id)).filter(Boolean); set({ clipboard: JSON.parse(JSON.stringify(nodes)) }); toast(`Đã copy ${nodes.length} layer`, 'ok'); }
export function cutSelection() { copySelection(); deleteSelection(); }
export function pasteClipboard() {
  const s = get();
  const cb = s.clipboard as Node[] | null;
  if (!cb || !cb.length) return;
  const clones = cb.map((n) => ops.cloneNode(n)).map((n) => ({ ...n }));
  let d = ops.insertNodes(doc(), clones);
  d = ops.moveBy(d, clones.map((c) => c.id), 16, 16);
  commit(d); set({ selection: clones.map((c) => c.id) });
}

// ---------- creation ----------
export function addBlock(kind: BlockKind, at?: number) {
  const d = doc();
  const y = at ?? ops.contentHeight(d);
  const g = makeBlock(kind, brand(), y);
  if (d.width !== 600) { const s = d.width / 600; Object.assign(g, ops.fitTo(g, { x: 0, y: y, w: d.width, h: g.h * s })); }
  const next = { ...ops.insertNodes(d, [g]), height: Math.max(d.height, y + g.h) };
  commit(next); set({ selection: [g.id] });
  return g.id;
}

export function addText(x: number, y: number) {
  const n = mkText(brand(), 'Nhập chữ', { x, y, w: 240, fontSize: 18, name: 'Text' });
  n.locked = false;
  commit(ops.insertNodes(doc(), [n])); set({ selection: [n.id], editingText: n.id, tool: 'select' });
  return n.id;
}

export function addRect(r: ops.Rect) {
  const n = mkRect({ x: Math.round(r.x), y: Math.round(r.y), w: Math.max(2, Math.round(r.w)), h: Math.max(2, Math.round(r.h)), fill: { token: 'primary' }, name: 'Rectangle' });
  commit(ops.insertNodes(doc(), [n])); set({ selection: [n.id], tool: 'select' });
  return n.id;
}

/** Place an asset that is already in the library: onto an image node (replace) or as a new image node. */
export function placeAsset(id: string, at?: { x: number; y: number }, into?: string): string | null {
  const a = assets.get(id); if (!a) return null;
  const d = doc();
  if (into) { commit(ops.updateNode(d, into, (n) => (n.type === 'image' ? { ...n, assetId: a.id, name: n.name === 'Image' ? a.name : n.name } : n))); return into; }
  const w = Math.min(d.width, a.w), h = Math.round(w * (a.h / a.w));
  const n = mkImage({ x: Math.round(at ? at.x - w / 2 : (d.width - w) / 2), y: Math.round(at ? at.y - h / 2 : ops.contentHeight(d)), w, h, assetId: a.id, name: a.name, alt: a.name.replace(/\.[a-z0-9]+$/i, '') });
  commit({ ...ops.insertNodes(d, [n]), height: Math.max(d.height, n.y + n.h) }); set({ selection: [n.id], tool: 'select' });
  return n.id;
}

export async function addImageFile(file: File, at?: { x: number; y: number }, into?: string, src: Asset['src'] = { kind: 'upload' }) {
  const a = await assets.add(file, undefined, { src });
  const d = doc();
  if (into) { // drop onto an existing image node: replace its asset
    commit(ops.updateNode(d, into, (n) => (n.type === 'image' ? { ...n, assetId: a.id, name: n.name === 'Image' ? a.name : n.name } : n)));
    return into;
  }
  const w = Math.min(d.width, a.w), h = Math.round(w * (a.h / a.w));
  const n = mkImage({ x: Math.round(at ? at.x - w / 2 : (d.width - w) / 2), y: Math.round(at ? at.y - h / 2 : ops.contentHeight(d)), w, h, assetId: a.id, name: a.name, alt: a.name.replace(/\.[a-z0-9]+$/i, '') });
  commit({ ...ops.insertNodes(d, [n]), height: Math.max(d.height, n.y + n.h) }); set({ selection: [n.id], tool: 'select' });
  return n.id;
}

// ---------- cut-outs: remove background, split sprite sheets, cut a region ----------
const stem = (name: string) => name.replace(/\.[a-z0-9]+$/i, '');
/** Replace the layer's photo with a background-free cut-out; the frame shrinks to the object so nothing moves on screen. */
export async function cutoutLayer(nodeId: string, mode: 'auto' | 'ai' = 'auto') {
  const n = ops.findNode(doc(), nodeId); if (!n || n.type !== 'image' || !n.assetId) return;
  const a = assets.get(n.assetId); const blob = await assets.blob(n.assetId); if (!a || !blob) { toast('Chưa tải được ảnh gốc.', 'err'); return; }
  set({ busy: { label: mode === 'ai' ? 'Xoá nền bằng AI…' : 'Đang xoá nền…', done: 0, total: 0 } });
  try {
    const r = mode === 'ai' ? await removeBackgroundAI(blob, (m) => set({ busy: { label: m, done: 0, total: 0 } })) : await removeBackground(blob);
    const na = await assets.add(r.blob, `${stem(a.name)}-nobg.png`, { src: { kind: 'ai', host: a.src?.host, url: a.src?.url, page: a.src?.page } });
    // keep the object where it was: map the trimmed box through the current draw rect
    const cur = ops.findNode(doc(), nodeId) as ImageNode;
    const dr = imageDrawRect(cur, a.w, a.h); const k = dr.dw / a.w;
    const sx = r.w / a.w; // removal may have downscaled very large photos
    const fx = cur.x + dr.dx + (r.bbox.x / sx) * k, fy = cur.y + dr.dy + (r.bbox.y / sx) * k, fw = (r.bbox.w / sx) * k, fh = (r.bbox.h / sx) * k;
    updateNode(nodeId, (m) => (m.type === 'image' ? { ...m, assetId: na.id, fit: 'contain', crop: null, fill: null, x: Math.round(fx), y: Math.round(fy), w: Math.max(8, Math.round(fw)), h: Math.max(8, Math.round(fh)) } : m));
    toast('Đã xoá nền. Bật "Bóng nổi" nếu muốn ảnh trông như đang bay.', 'ok');
  } catch (e) { toast((e as Error).message || 'Không xoá được nền.', 'err'); }
  finally { set({ busy: null }); }
}
/** Split a sprite sheet asset into separate transparent pieces, parked beside the artboard in a grid. */
export async function splitAssetToScraps(assetId: string) {
  const a = assets.get(assetId); const blob = await assets.blob(assetId); if (!a || !blob) { toast('Chưa tải được ảnh gốc.', 'err'); return 0; }
  set({ busy: { label: 'Đang tách từng ảnh…', done: 0, total: 0 } });
  try {
    const pieces = await splitSprites(blob);
    if (!pieces.length) { toast('Không tìm thấy vật thể tách được (nền phải là trắng/xám/trong suốt).', 'err'); return 0; }
    const d = doc(); const list = [...get().scraps];
    const colW = 150, startY = Math.max(0, ...list.filter((sc) => sc.x >= d.width).map((sc) => sc.y + sc.h + 16));
    let i = 0;
    for (const b of pieces) {
      const na = await assets.add(b, `${stem(a.name)}-${i + 1}.png`, { src: { kind: 'ai', host: a.src?.host, url: a.src?.url, page: a.src?.page } });
      const w = Math.min(140, na.w), h = Math.round(w * (na.h / na.w));
      list.push({ id: uid(), assetId: na.id, x: d.width + 48 + (i % 3) * colW, y: startY + Math.floor(i / 3) * 160, w, h });
      i++;
    }
    setScraps(list);
    toast(`Đã tách ${pieces.length} ảnh, xếp cạnh artboard. Kéo vào mail, ⌘[ / ⌘] để đưa xuống dưới / lên trên.`, 'ok');
    return pieces.length;
  } catch (e) { toast((e as Error).message || 'Không tách được.', 'err'); return 0; }
  finally { set({ busy: null }); }
}
/** Cut a rectangle (doc coordinates) out of an image layer into a new layer placed exactly on top of it. */
export async function cutRegion(nodeId: string, r: { x: number; y: number; w: number; h: number }) {
  const d = doc(); const n = ops.findNode(d, nodeId); if (!n || n.type !== 'image' || !n.assetId) return;
  const a = assets.get(n.assetId); const blob = await assets.blob(n.assetId); if (!a || !blob) return;
  const dr = imageDrawRect(n, a.w, a.h); const k = dr.dw / a.w;
  const px = { x: (r.x - n.x - dr.dx) / k, y: (r.y - n.y - dr.dy) / k, w: r.w / k, h: r.h / k };
  if (px.w < 2 || px.h < 2) return;
  const piece = await cropRegion(blob, px);
  const na = await assets.add(piece, `${stem(a.name)}-cut.png`, { src: { kind: 'ai', host: a.src?.host } });
  const node = mkImage({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), assetId: na.id, name: `${n.name} · cắt`, alt: n.alt, fit: 'fill' });
  const parent = ops.findParent(d, nodeId);
  const next = parent ? ops.updateNode(d, parent.id, (g) => (g.type === 'group' ? ops.syncGroup({ ...g, children: [...g.children.slice(0, g.children.indexOf(n) + 1), node, ...g.children.slice(g.children.indexOf(n) + 1)] }) : g)) : ops.insertNodes(d, [node]);
  commit(next); set({ selection: [node.id], cutting: null, tool: 'select' });
  toast('Đã cắt thành layer riêng. Dùng "Xoá nền" để bỏ phần nền thừa.', 'ok');
}
/** Multiply the crop zoom of an image layer (1..6), keeping its focal point. */
export function zoomCrop(id: string, factor: number) {
  updateNode(id, (n) => { if (n.type !== 'image') return n; const z = Math.max(1, Math.min(6, (n.crop?.zoom ?? 1) * factor)); return { ...n, crop: { zoom: Math.round(z * 100) / 100, fx: n.crop?.fx ?? 0.5, fy: n.crop?.fy ?? 0.5 } }; });
}
export function setImageAsset(id: string, assetId: string | null) { updateNode(id, (n) => (n.type === 'image' ? { ...n, assetId } : n)); }

export function setDocHeightToContent() { const d = doc(); commit({ ...d, autoHeight: true, height: Math.max(ops.contentHeight(d), 100) }); }
export function setDocProps(p: Partial<Doc>) { commit({ ...doc(), ...p, ...('height' in p ? { autoHeight: false } : {}) }); }

// ---------- pasteboard (scraps beside the artboard) ----------
const scrapKey = (pid: string) => `phloem.scraps.${pid}`;
export function loadScraps(pid: string): Scrap[] { try { return (JSON.parse(localStorage.getItem(scrapKey(pid)) || '[]') as Scrap[]).filter((x) => x && assets.get(x.assetId) && [x.x, x.y, x.w, x.h].every((v) => Number.isFinite(v)) && x.w > 0 && x.h > 0); } catch { return []; } }
export function setScraps(list: Scrap[]) {
  set({ scraps: list });
  const pid = get().project?.id; if (!pid) return;
  try { if (list.length) localStorage.setItem(scrapKey(pid), JSON.stringify(list)); else localStorage.removeItem(scrapKey(pid)); } catch { /* ignore */ }
}
/** Park an asset beside the artboard (right side, stacked) or at a given doc point. Returns the scrap id. */
export function addScrap(assetId: string, at?: { x: number; y: number }): string | null {
  const a = assets.get(assetId); if (!a) return null;
  const d = doc(); const list = get().scraps;
  const w = Math.min(260, a.w), h = Math.round(w * (a.h / a.w));
  let x: number, y: number;
  if (at) { x = Math.round(at.x - w / 2); y = Math.round(at.y - h / 2); }
  else {
    x = d.width + 48;
    const column = list.filter((sc) => sc.x >= d.width);
    y = column.length ? Math.max(...column.map((sc) => sc.y + sc.h)) + 24 : 0;
  }
  const sc: Scrap = { id: uid(), assetId, x, y, w, h };
  setScraps([...list, sc]); set({ scrapSel: sc.id, selection: [] });
  return sc.id;
}
export function moveScrap(id: string, x: number, y: number) { setScraps(get().scraps.map((sc) => (sc.id === id ? { ...sc, x: Math.round(x), y: Math.round(y) } : sc))); }
export function removeScrap(id: string) { setScraps(get().scraps.filter((sc) => sc.id !== id)); if (get().scrapSel === id) set({ scrapSel: null }); }
/** Drop a scrap into the email: onto an image layer (replace) or as a new image layer at the scrap's position. */
export function scrapIntoDoc(id: string, into?: string, groupId?: string) {
  const sc = get().scraps.find((x) => x.id === id); if (!sc) return;
  const a = assets.get(sc.assetId); if (!a) { removeScrap(id); return; }
  const d = doc();
  if (into) { commit(ops.updateNode(d, into, (n) => (n.type === 'image' ? { ...n, assetId: a.id, name: n.name === 'Image' ? a.name : n.name } : n))); removeScrap(id); set({ selection: [into] }); return; }
  const w = Math.min(d.width, sc.w), h = Math.round(w * (sc.h / sc.w));
  const x = Math.max(0, Math.min(d.width - w, Math.round(sc.x))), y = Math.max(0, Math.round(sc.y));
  const n = mkImage({ x, y, w, h, assetId: a.id, name: a.name, alt: a.name.replace(/\.[a-z0-9]+$/i, ''), fit: 'contain', fill: null });
  // dropped on a block: become part of it (so ⌘[ can push it behind the product); else a top-level layer
  const g = groupId ? ops.findNode(d, groupId) : null;
  const next = g && g.type === 'group' ? ops.updateNode(d, g.id, (gg) => (gg.type === 'group' ? ops.syncGroup({ ...gg, children: [...gg.children, n] }) : gg)) : ops.insertNodes(d, [n]);
  commit(next); removeScrap(id); set({ selection: [n.id], tool: 'select' });
}
export async function addImageFileToScraps(file: File, at?: { x: number; y: number }, src: Asset['src'] = { kind: 'paste' }) { const a = await assets.add(file, undefined, { src }); return addScrap(a.id, at); }
/** Pull a pasted image URL (from copied HTML or a link) into the library: via the relay when configured, else directly. */
export async function addImageUrl(url: string): Promise<string | null> {
  const st = get(); const relay = (st.settings.relayUrl || '').replace(/\/$/, '');
  const ses = auth.getSession();
  const tryFetch = async (u: string, headers: Record<string, string> = {}) => { const r = await fetch(u, { headers, signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(String(r.status)); const b = await r.blob(); if (!b.type.startsWith('image/')) throw new Error('not image'); return b; };
  let blob: Blob | null = null;
  if (relay) { try { blob = await tryFetch(`${relay}/image?url=${encodeURIComponent(url)}`, { ...(ses?.mode === 'relay' ? { Authorization: `Bearer ${ses.token}` } : {}), ...(st.settings.relayToken ? { 'X-Phloem-Token': st.settings.relayToken } : {}) }); } catch { blob = null; } }
  if (!blob) { try { blob = await tryFetch(url); } catch { blob = null; } }
  if (!blob) return null;
  const name = (url.split('/').pop() || 'image').split('?')[0].slice(0, 60) || 'image';
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const a = await assets.add(new File([blob], name, { type: blob.type }), name, { src: { kind: 'paste', host, url } });
  return a.id;
}
export function reflow() { commit(ops.reflowBlocks(doc())); }
// ---------- one-click fixes ----------
const CTA_RE = /^(mua|xem|đặt|đăng ký|nhận|tải|khám phá|bắt đầu|thử|liên hệ|shop|buy|get|book|order|start|see|view|learn|try|join|subscribe|sign|download|explore|talk|claim|grab|reserve)/i;
const walkAll = (list: Node[], fn: (n: Node, parent: Node | null) => void, parent: Node | null = null) => { for (const n of list) { fn(n, parent); if (n.type === 'group') walkAll(n.children, fn, n); } };

/** Link every product card / photo that came from the crawled catalog to its real product page. */
export function linkProducts(): number {
  const b = brand(); const prods = b.links?.products || []; if (!prods.length) return 0;
  const byImage = new Map<string, { name: string; url: string }>();
  for (const pr of prods) if (pr.image) byImage.set(pr.image, pr);
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const byName = new Map(prods.map((pr) => [norm(pr.name), pr]));
  let n = 0;
  const fixGroup = (g: Node, url: string) => { if (g.type === 'group' && !g.link) { g.link = url; n++; } };
  const d = JSON.parse(JSON.stringify(doc())) as Doc;
  walkAll(d.nodes, (node, parent) => {
    if (node.type === 'image' && node.assetId) {
      const a = assets.get(node.assetId); const pr = a?.src?.url ? byImage.get(a.src.url) : undefined;
      if (pr) { if (parent && parent.type === 'group' && /product|item|card|dish|menu|zig|gallery|spotlight/i.test(parent.name)) fixGroup(parent, pr.url); else if (!node.link) { node.link = pr.url; n++; } }
    }
    if (node.type === 'text' && node.text) { const pr = byName.get(norm(node.text)); if (pr) { if (parent && parent.type === 'group' && /product|item|card|dish|menu|zig|gallery|spotlight/i.test(parent.name)) fixGroup(parent, pr.url); else if (!node.link) { node.link = pr.url; n++; } } }
  });
  if (n) commit(d);
  return n;
}

/** Resolve the Email-tab suggestions automatically; subject/preheader are written by the AI when missing. */
export async function autoFix(): Promise<string[]> {
  const changes: string[] = [];
  const p = get().project!; const b = brand(); const home = b.links?.website || b.links?.nav?.[0]?.url || '';
  let d = JSON.parse(JSON.stringify(doc())) as Doc;
  const scale = 375 / d.width;
  // 1. text that would shrink under 9px on a phone → 15px (footer excluded)
  const footerY = d.height - 220; let smalls = 0;
  walkAll(d.nodes, (n) => { if (n.type === 'text' && n.fontSize * scale < 9 && n.y < footerY && (n.text || '').trim().length > 12) { n.fontSize = Math.max(n.fontSize, 15); smalls++; } });
  if (smalls) { d = ops.mapNodes(d, fixTextHeight); d = ops.reflowBlocks(d); changes.push(`Phóng ${smalls} đoạn chữ nhỏ lên 15px`); }
  // 2. a full-bleed cover PHOTO taller than 700px → 600px (never a cut-out / product / composed image: those would be cropped)
  const hero = (() => { let best: ImageNode | null = null; walkAll(d.nodes, (n) => { if (n.type === 'image' && n.fit === 'cover' && !n.tilt && !n.floatShadow && !n.rotate && n.w >= d.width * 0.95 && n.h > 700 && (!best || n.y < (best as ImageNode).y)) best = n; }); return best as ImageNode | null; })();
  if (hero) { d = ops.setHeightFlow(d, hero.id, 600); changes.push('Hạ ảnh nền hero xuống 600px'); }
  // 3. alt text for photos
  let alts = 0; walkAll(d.nodes, (n) => { if (n.type === 'image' && n.assetId && !(n.alt || '').trim()) { const a = assets.get(n.assetId); n.alt = (a ? a.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') : n.name) || 'Ảnh'; alts++; } });
  if (alts) changes.push(`Điền alt cho ${alts} ảnh`);
  // 4. buttons / CTA texts / logos / social icons without a link
  let links = 0;
  const soc = new Map((b.links?.socials || []).map((x) => [x.label.toLowerCase(), x.url]));
  walkAll(d.nodes, (n) => {
    if (n.link) return;
    if (n.type === 'group' && /^Button ·/.test(n.name) && home) { n.link = home; links++; }
    else if (n.type === 'group' && /^Social · (\w+)/.test(n.name)) { const key = n.name.replace(/^Social · /, '').toLowerCase(); const u = soc.get(key); if (u) { n.link = u; links++; } }
    else if (n.name === 'Logo' && home) { n.link = home; links++; }
    else if (n.type === 'text' && CTA_RE.test((n.text || '').trim()) && (n.text || '').trim().split(/\s+/).length <= 5 && home) { n.link = home; links++; }
  });
  if (links) changes.push(`Gắn link cho ${links} nút / logo / icon`);
  commit(d);
  const np = linkProducts(); if (np) changes.push(`Gắn link sản phẩm thật cho ${np} ảnh/card`);
  // 5. unsubscribe / preferences lines: added INTO the existing footer-like last block (never a second footer, never a fake address)
  const dd = JSON.parse(JSON.stringify(doc())) as Doc; const bottomTexts: TextNode[] = []; walkAll(dd.nodes, (n) => { if (n.type === 'text' && n.y + n.h > dd.height - 260) bottomTexts.push(n); });
  if (!bottomTexts.some((t) => /huỷ đăng ký|hủy đăng ký|unsubscribe/i.test(t.text || ''))) {
    const last = dd.nodes[dd.nodes.length - 1];
    const lang = /[a-z]/i.test(p.fields.subject || '') && !/[ăâđêôơưàảãáạ]/i.test((p.fields.subject || '') + (p.fields.preheader || '')) ? 'en' : 'vi';
    const host = (() => { try { return b.links?.website ? new URL(b.links.website).hostname.replace(/^www\./, '') : ''; } catch { return ''; } })();
    const bandDark = last && last.type === 'group' ? (() => { const bg = last.children.find((k) => k.type === 'rect' && k.w >= dd.width * 0.9) as RectNode | undefined; return bg ? { token: contrastToken(b, bg.fill) } : { token: 'muted' as const }; })() : { token: 'muted' as const };
    const mk = (t: string, x: number, w: number, link: string | null) => mkText(b, t, { x, y: 0, w, fontSize: 12, color: bandDark, align: 'center', underline: !!link, link, name: link ? 'Unsubscribe' : 'Address' });
    if (last && last.type === 'group' && (last.block === 'footer' || /footer|social|strip/i.test(last.name) || last.h <= 260)) {
      const yy = last.y + last.h - 8; const unsub = mk(lang === 'en' ? 'Unsubscribe' : 'Huỷ đăng ký', 60, 220, '*|UNSUB|*'); const prefs = mk(lang === 'en' ? 'Update preferences' : 'Cập nhật thông tin', 320, 220, '*|UPDATE_PROFILE|*'); unsub.y = yy; prefs.y = yy;
      const addr = host ? mk(host, 24, dd.width - 48, null) : null; if (addr) { addr.y = yy + 22; addr.underline = false; }
      const extra = 22 + (addr ? 22 : 0) + 12;
      const grown = ops.updateNode(dd, last.id, (g) => (g.type === 'group' ? ops.syncGroup({ ...g, children: [...g.children.map((k) => (k.type === 'rect' && k.w >= dd.width * 0.9 ? { ...k, h: k.h + extra } : k)), unsub, prefs, ...(addr ? [addr] : [])] }) : g));
      commit(grown); changes.push('Thêm dòng huỷ đăng ký vào footer có sẵn');
    } else {
      const g = makeBlock('footer', b, ops.contentHeight(dd), { brand: b.name, social: b.links?.socials, address: host || ' ', unsubscribeUrl: '*|UNSUB|*', preferencesUrl: '*|UPDATE_PROFILE|*' });
      commit(ops.insertNodes(dd, [g])); changes.push('Chèn footer (huỷ đăng ký, social)');
    }
  }
  // 6. subject / preheader by AI
  if (!p.fields.subject.trim() || !p.fields.preheader.trim()) {
    try {
      const { askClaude, extractJson } = await import('../ai/client');
      const copy: string[] = []; walkAll(doc().nodes, (n) => { if (n.type === 'text' && n.text && n.text.length > 2) copy.push(n.text); });
      const txt = await askClaude({ system: 'Bạn là copywriter email. Trả lời CHỈ JSON {"subject":"30–55 ký tự, nói thẳng lợi ích","preheader":"40–90 ký tự nối tiếp subject"} cùng ngôn ngữ với nội dung email.', turns: [{ role: 'user', text: `Thương hiệu: ${b.name}\nNội dung email:\n${copy.slice(0, 40).join('\n')}` }], maxTokens: 400, effort: 'low' });
      const j = extractJson<{ subject?: string; preheader?: string }>(txt);
      patchProject({ fields: { ...get().project!.fields, subject: p.fields.subject.trim() || String(j.subject || ''), preheader: p.fields.preheader.trim() || String(j.preheader || '') } });
      changes.push('AI viết subject / preheader');
    } catch { changes.push('Subject/preheader: AI chưa sẵn sàng (đăng nhập relay hoặc nhập key)'); }
  }
  remeasureAll();
  toast(changes.length ? `AI đã chỉnh: ${changes.join(' · ')}` : 'Không còn gì để chỉnh.', 'ok');
  return changes;
}

/** One click to a 3D feel: extruded headline, tilted floating product, glow, this project's cut-outs as props. */
export function make3D(): string[] {
  const changes: string[] = [];
  const b = brand(); const T = b.vibe;
  const d = JSON.parse(JSON.stringify(doc())) as Doc;
  const blocks = d.nodes.filter((n) => n.type === 'group') as Extract<Node, { type: 'group' }>[];
  const top2 = blocks.slice(0, 3);
  // headline: the biggest text in the first blocks
  let head: TextNode | null = null;
  for (const g of top2) walkAll(g.children, (n) => { if (n.type === 'text' && (!head || n.fontSize > head.fontSize)) head = n; });
  if (head && (head as TextNode).fontSize >= 26) { const h = head as TextNode; h.effect = T === 'luxury' || T === 'editorial' ? { kind: 'shadow', depth: 14, angle: 50, color: { token: 'primary' } } : { kind: 'extrude', depth: 7, angle: 52, color: { token: 'accent' } }; changes.push('Chữ tiêu đề đùn khối 3D'); }
  // product / hero image
  let img: ImageNode | null = null; let imgParent: Node | null = null;
  for (const g of top2) walkAll(g.children, (n, par) => { if (n.type === 'image' && n.assetId && (!img || n.w * n.h > img.w * img.h)) { img = n; imgParent = par; } }, g);
  if (img) {
    const im = img as ImageNode;
    if (im.fit === 'contain' || /product|sản phẩm/i.test(im.name)) { im.tilt = { rx: 0, ry: 12 }; im.floatShadow = true; changes.push('Sản phẩm nghiêng phối cảnh + bóng nổi'); }
    else { im.tilt = { rx: 0, ry: 6 }; im.shadow = { blur: 40, y: 18, color: '#000000', opacity: 0.28 }; changes.push('Ảnh hero nghiêng nhẹ như tấm card'); }
    // glow behind it (inside the same group, right before the image)
    const par = imgParent as Node | null;
    const r = Math.round(Math.max(im.w, im.h) * 0.75);
    const glow = mkRect({ x: Math.round(im.x + im.w / 2 - r), y: Math.round(im.y + im.h / 2 - r), w: r * 2, h: r * 2, fill: null, gradient: { from: { token: 'primary', alpha: 0.55 }, to: { token: 'primary', alpha: 0 }, angle: 0, radial: true }, name: 'Glow' });
    if (par && par.type === 'group') { const i = par.children.indexOf(im); par.children.splice(i, 0, glow); } else { const i = d.nodes.indexOf(im); d.nodes.splice(Math.max(0, i), 0, glow); }
    changes.push('Vầng sáng sau sản phẩm');
    // props: this project's cut-outs not yet on the canvas
    const used = new Set<string>(); walkAll(d.nodes, (n) => { if (n.type === 'image' && n.assetId) used.add(n.assetId); });
    const pid = get().project!.id;
    const props = assets.all().filter((a) => a.src?.kind === 'ai' && (a.project === pid || !a.project) && !used.has(a.id) && a.id !== b.logoAssetId && a.id !== b.logoLightAssetId).slice(0, 4);
    const slots = [{ x: -0.1, y: 0.55, w: 0.3, r: -12, behind: true }, { x: 0.78, y: 0.5, w: 0.3, r: 14, behind: false }, { x: 0.02, y: 0.02, w: 0.22, r: 10, behind: true }, { x: 0.76, y: 0, w: 0.22, r: -8, behind: false }];
    props.forEach((a, i) => {
      const sl = slots[i]; const w = Math.round(im.w * sl.w); const h = Math.round(w * (a.h / a.w));
      const node = mkImage({ x: Math.round(im.x + im.w * sl.x), y: Math.round(im.y + im.h * sl.y), w, h, assetId: a.id, fit: 'contain', fill: null, rotate: sl.r, floatShadow: false, name: `Prop · ${a.name}`, alt: a.name });
      if (par && par.type === 'group') { const i2 = par.children.indexOf(im); par.children.splice(sl.behind ? i2 : i2 + 1, 0, node); } else d.nodes.push(node);
    });
    if (props.length) changes.push(`Xếp ${props.length} ảnh phụ kiện tách nền quanh sản phẩm`);
  }
  // big numbers get a soft extrude too
  let stats = 0; walkAll(d.nodes, (n) => { if (n.type === 'text' && /^Stat|^Statement|^Value$|^Big number$/.test(n.name) && n.fontSize >= 30 && !n.effect) { n.effect = { kind: 'extrude', depth: 4, angle: 52 }; stats++; } });
  if (stats) changes.push(`${stats} con số nổi khối`);
  commit(ops.mapNodes(d, (n) => (n.type === 'group' ? ops.syncGroup(n) : n)));
  toast(changes.length ? `Đã làm 3D: ${changes.join(' · ')}` : 'Không tìm thấy tiêu đề / ảnh sản phẩm để làm 3D.', 'ok');
  return changes;
}

/** One click of motion for the top of the email: headline types/slides in, copy fades, button pops, product rises, props pop, ticker scrolls. */
export function animateHero(): string[] {
  const changes: string[] = [];
  const d = JSON.parse(JSON.stringify(doc())) as Doc;
  const blocks = d.nodes.filter((n) => n.type === 'group') as Extract<Node, { type: 'group' }>[];
  const heroIdx = blocks.findIndex((g) => /hero|dark-band|statement|overlap|spotlight/.test(g.block || '') || /hero/i.test(g.name));
  const hero = blocks[heroIdx >= 0 ? heroIdx : Math.min(1, blocks.length - 1)];
  if (!hero) return changes;
  let tBtn = 1.2, props = 0;
  const texts = hero.children.filter((k) => k.type === 'text') as TextNode[];
  const headline = texts.sort((a, b) => b.fontSize - a.fontSize)[0];
  for (const k of hero.children) {
    if (k.type === 'text') {
      if (k === headline) { k.anim = k.text.length <= 48 ? { kind: 'type', delay: 0.2, dur: Math.min(1.8, 0.05 * k.text.length + 0.4) } : { kind: 'up', delay: 0.2, dur: 0.8 }; tBtn = (k.anim.delay ?? 0) + (k.anim.dur ?? 0.8) + 0.3; changes.push('Tiêu đề ' + (k.anim.kind === 'type' ? 'gõ từng chữ' : 'trượt lên')); }
      else if (/eyebrow/i.test(k.name)) k.anim = { kind: 'fade', delay: 0, dur: 0.5 };
      else if (/sub|body|paragraph/i.test(k.name)) k.anim = { kind: 'up', delay: tBtn - 0.2, dur: 0.7 };
      else if (/^Stat|^Statement|^Big number/i.test(k.name)) k.anim = { kind: 'pop', delay: 0.3, dur: 0.6 };
    } else if (k.type === 'group' && /^Button/.test(k.name)) { k.anim = { kind: 'pop', delay: tBtn + 0.3, dur: 0.6 }; changes.push('Nút nảy ra'); }
    else if (k.type === 'image' && /prop/i.test(k.name)) { k.anim = { kind: 'pop', delay: 0.9 + props * 0.15, dur: 0.5 }; props++; }
    else if (k.type === 'image' && /product|hero|spotlight|band image/i.test(k.name)) { k.anim = { kind: 'up', delay: 0.5, dur: 0.6 }; changes.push('Ảnh sản phẩm hiện lên'); }
    else if (k.type === 'rect' && /badge|pill/i.test(k.name)) k.anim = { kind: 'pop', delay: 1.0, dur: 0.5 };
    // glows stay static: fading a big soft gradient re-encodes the whole band every frame (heavy GIF, barely visible)
  }
  if (props) changes.push(`${props} phụ kiện nảy ra lần lượt`);
  const ticker = blocks.find((g) => g.block === 'ticker');
  if (ticker) { for (const k of ticker.children) if (k.type === 'text') k.anim = { kind: 'marquee' }; changes.push('Ticker chạy chữ'); }
  commit(d);
  toast(changes.length ? `Đã làm động: ${changes.join(' · ')}. Bấm ▶ Phát để xem; khi xuất, lát hero thành GIF.` : 'Không tìm thấy hero để làm động.', 'ok');
  return changes;
}

export function optimize(): string[] {
  const d = doc();
  const changes: string[] = [];
  let next = d;
  if (get().variant === 'desktop' && d.width !== 600 && d.width >= 560 && d.width <= 700) { next = ops.setDocWidth(next, 600); changes.push(`Đưa chiều rộng ${d.width} → 600px`); }
  const rounded = ops.roundAll(next); if (rounded !== next) { next = rounded; changes.push('Làm tròn toạ độ lẻ pixel'); }
  const h = Math.max(ops.contentHeight(next), 100); if (h !== next.height) { next = { ...next, height: h }; changes.push(`Chiều cao artboard khớp nội dung (${h}px)`); }
  if (next !== d) commit(next);
  return changes;
}

// ---------- variants ----------
export function setVariant(v: Variant) { const p = get().project; if (!p) return; if (v === 'mobile' && !p.mobile) return; history.clear(); set({ variant: v, selection: [], editingText: null, enteredGroup: null }); }
export function createMobileVariant() { const p = get().project; if (!p) return; const m = ops.mapNodes(ops.makeMobile(p.desktop), fixTextHeight); patchProject({ mobile: m }); setVariant('mobile'); toast('Đã tạo bản mobile 375px từ bản desktop. Chỉnh chữ/ảnh cho gọn.', 'ok'); }
export function deleteMobileVariant() { patchProject({ mobile: null }); setVariant('desktop'); }

// ---------- brand ----------
export function applyBrand(b: Partial<Brand>) {
  const st = get(); const p = st.project; if (!p) return;
  const nb = { ...p.brand, ...b };
  ensureFonts([nb.fontFamily, nb.headingFamily]);
  patchProject({ brand: nb });
  // Brand is project-wide: rewrite the active doc (with history) and the other variant (without).
  const other: 'desktop' | 'mobile' = st.variant === 'mobile' && p.mobile ? 'desktop' : 'mobile';
  const both = (fn: (d: Doc) => Doc) => {
    const d = doc(); const next = fn(d); if (next !== d) commit(next);
    const od = get().project![other]; if (od) { const on = fn(od); if (on !== od) patchProject({ [other]: on } as Partial<Project>); }
  };
  if (nb.logoAssetId !== p.brand.logoAssetId || (nb.logoLightAssetId ?? null) !== (p.brand.logoLightAssetId ?? null) || nb.name !== p.brand.name) both((d) => swapLogos(d, nb));
  if ((nb.gradient?.angle ?? null) !== (p.brand.gradient?.angle ?? null)) {
    const isBrandGrad = (n: Node) => n.type === 'rect' && !!n.gradient && typeof n.gradient.from === 'object' && n.gradient.from.token === 'primary' && typeof n.gradient.to === 'object' && n.gradient.to.token === 'accent';
    // Only full-width bands (hero band, dark band, CTA strips): buttons, pills and badges keep their flat fill.
    const isBand = (n: Node) => n.type === 'rect' && n.w >= 560;
    both((d) => ops.mapNodes(d, (n) => {
      if (n.type !== 'rect' || !isBand(n)) return n;
      const tok = n.fill && typeof n.fill === 'object' ? n.fill.token : null;
      if (nb.gradient) return (tok === 'primary' || (!n.fill && isBrandGrad(n))) && (!n.gradient || isBrandGrad(n)) ? { ...n, gradient: { from: { token: 'primary' }, to: { token: 'accent' }, angle: nb.gradient.angle } } : n;
      return isBrandGrad(n) ? { ...n, gradient: null, fill: n.fill ?? { token: 'primary' } } : n;
    }));
  }
  remeasureAll();
}

/** Replace every "Logo" layer (nav/footer) with the brand's logo image, or back to the wordmark. */
function swapLogos(d: Doc, b: Brand): Doc {
  // The band behind a logo decides the variant: the light logo (and light wordmark) on dark bands.
  const fix = (n: Node, behind: Color | null): Node => {
    if (n.name !== 'Logo' || (n.type !== 'text' && n.type !== 'image')) return n;
    const asset = logoAssetFor(b, behind);
    const cy = n.y + n.h / 2;
    const isCenter = n.type === 'text' ? n.align === 'center' : Math.abs(n.x + n.w / 2 - d.width / 2) < 4;
    if (asset) {
      if (n.type === 'image' && n.assetId === asset) return n;
      const meta = assets.get(asset); const ratio = meta ? meta.w / Math.max(1, meta.h) : 3.2;
      const h = n.type === 'image' ? n.h : (n.fontSize >= 16 ? 30 : 24); const w = Math.max(40, Math.min(220, Math.round(h * ratio)));
      const x = isCenter ? Math.round((d.width - w) / 2) : n.x;
      return { id: n.id, type: 'image', name: 'Logo', x, y: Math.round(cy - h / 2), w, h, visible: n.visible, locked: n.locked, opacity: 1, link: n.link, alt: b.name, assetId: asset, fit: 'contain', radius: 0, fill: null, overlay: null } as Node;
    }
    const color = { token: contrastToken(b, behind) } as const;
    if (n.type === 'text') return n.text === b.name.toUpperCase() ? { ...n, color } : A_fixText({ ...n, text: b.name.toUpperCase(), color });
    const t = mkText(b, b.name.toUpperCase(), { x: isCenter ? 24 : n.x, y: 0, w: isCenter ? d.width - 48 : 260, fontSize: n.h >= 28 ? 18 : 13, fontWeight: 800, letterSpacing: 1.5, name: 'Logo', link: n.link, align: isCenter ? 'center' : 'left', color });
    t.id = n.id; t.y = Math.round(cy - t.h / 2);
    return t;
  };
  const walk = (list: Node[], behind: Color | null): Node[] => list.map((n) => {
    if (n.type !== 'group') return fix(n, behind);
    const band = n.children.find((k) => k.type === 'rect' && k.w >= d.width * 0.9) as RectNode | undefined;
    return ops.syncGroup({ ...n, children: walk(n.children, band?.fill ?? behind) });
  });
  return { ...d, nodes: walk(d.nodes, d.bg) };
}
const A_fixText = (n: Node): Node => fixTextHeight(n);

// ---------- analysis (shared engine) ----------
export interface Analysis { root: NNode; plan: SlicePlan; checks: Check[]; suggestions: Suggestion[]; score: number }
let cache: { doc: Doc; brand: Brand; fields: string; mobile: boolean; a: Analysis } | null = null;
export function analyze(): Analysis | null {
  const s = get();
  if (!s.project) return null;
  const d = doc(), b = s.project.brand, f = JSON.stringify(s.project.fields), hasMobile = !!s.project.mobile;
  if (cache && cache.doc === d && cache.brand === b && cache.fields === f && cache.mobile === hasMobile) return cache.a;
  const root = docToNNode(d, b);
  const plan = planSlices(root, { maxSliceHeight: s.settings.maxSliceHeight, mergeRows: s.settings.mergeRows, keep: ops.animBlocks(d.nodes) });
  const checks = runChecks({ root, plan, fields: { ...s.project.fields, mobileFrameId: hasMobile ? 'm' : null }, hasMobile });
  // Studio-only: image layers still showing the placeholder would export as a hatched box.
  const placeholders = ops.flat(d.nodes).filter((n) => n.type === 'image' && !n.assetId && n.visible);
  if (placeholders.length) checks.unshift({ level: 'warn', code: 'placeholder', message: `${placeholders.length} ảnh placeholder chưa thay (${placeholders.slice(0, 3).map((n) => n.name).join(', ')}${placeholders.length > 3 ? '…' : ''}). Kéo ảnh thật vào trước khi gửi.`, nodeId: placeholders[0].id });
  const sg = suggest({ root, plan, fields: { ...s.project.fields, mobileFrameId: hasMobile ? 'm' : null }, hasMobile });
  const a = { root, plan, checks, suggestions: sg.suggestions, score: sg.score };
  cache = { doc: d, brand: b, fields: f, mobile: hasMobile, a };
  return a;
}

export function applySuggestion(a: SuggestionAction) {
  switch (a.kind) {
    case 'snap-width': commit(ops.setDocWidth(doc(), a.width)); break;
    case 'round-pixels': commit(ops.roundAll(doc())); break;
    case 'insert-block': addBlock(a.block); break;
    case 'focus': select([a.nodeId]); set({ rightTab: 'design' }); break;
    case 'set-field': set({ rightTab: 'email' }); setTimeout(() => (document.getElementById(`f-${a.field}`) as HTMLInputElement | null)?.focus(), 50); break;
    case 'create-mobile': createMobileVariant(); break;
  }
}

// ---------- projects ----------
export async function openProject(id: string) {
  try {
    const p = await db.getProject(id);
    if (!p) { toast('Không tìm thấy project.', 'err'); return; }
    history.clear();
    const { thumb: _t, thumbMobile: _tm, provider: _pv, ...project } = p;
    // Older / synced records can miss fields; every consumer assumes strings.
    const f0 = (project.fields || {}) as Partial<typeof project.fields>;
    project.fields = { campaignName: f0.campaignName || '', subject: f0.subject || '', preheader: f0.preheader || '' };
    const sane = (d: Doc | null, w: number): Doc | null => { if (!d) return d; const nodes = Array.isArray(d.nodes) ? d.nodes : []; const width = Number.isFinite(d.width) && d.width >= 100 ? d.width : w; const height = Number.isFinite(d.height) && d.height >= 100 ? d.height : Math.max(100, ops.contentHeight({ ...d, nodes })); return { ...d, nodes, width, height }; };
    project.desktop = sane(project.desktop, 600)!; project.mobile = sane(project.mobile, 375);
    ensureFonts([project.brand.fontFamily, project.brand.headingFamily]);
    // Parked images never rest on the artboard: anything overlapping it (older data) is moved to the right margin.
    const scraps = loadScraps(id).map((sc) => (sc.x + sc.w > 0 && sc.x < project.desktop.width && sc.y + sc.h > 0 ? { ...sc, x: project.desktop.width + 48 } : sc));
    assets.context.project = id;
    set({ route: { name: 'editor', projectId: id }, project, variant: 'desktop', selection: [], zoom: 1, pan: { x: 0, y: 0 }, modal: null, dirty: false, savedAt: project.updatedAt, result: null, log: [], scraps, scrapSel: null });
  } catch (e) { toast(`Không mở được: ${(e as Error).message}`, 'err'); }
}

export async function newProject(kind: TemplateKind, brandOverride?: Partial<Brand>, name?: string) {
  const own = get().user?.brand;
  const b = { ...DEFAULT_BRAND, ...(own ? { name: own } : {}), ...(brandOverride || {}) };
  ensureFonts([b.fontFamily, b.headingFamily]);
  await document.fonts.ready;
  const t = makeTemplate(kind, b);
  ensureFonts([t.brand.fontFamily, t.brand.headingFamily]);
  const now = new Date().toISOString();
  const p: Project = { id: uid('p'), name: name || t.name, createdAt: now, updatedAt: now, brand: t.brand, fields: t.fields, desktop: t.doc, mobile: null, drafts: {} };
  history.clear();
  set({ route: { name: 'editor', projectId: p.id }, project: p, variant: 'desktop', selection: [], zoom: 1, pan: { x: 0, y: 0 }, modal: null, dirty: true, result: null, log: [] });
  await saveProject();
}

export async function deleteProject(id: string) { try { await db.deleteProject(id); await cloud.deleteProject(id); await refreshProjects(); } catch (e) { toast((e as Error).message, 'err'); } }
export async function duplicateProject(id: string) {
  const p = await db.getProject(id); if (!p) return;
  const now = new Date().toISOString();
  await db.putProject({ ...p, id: uid('p'), name: `${p.name} (bản sao)`, createdAt: now, updatedAt: now, drafts: {}, owner: ownerId() });
  await refreshProjects();
}
export function renameProject(name: string) { patchProject({ name: name.trim() || 'Email' }); }
export async function goHome() { if (get().dirty) await saveProject(); assets.context.project = null; set({ route: { name: 'home' }, project: null, selection: [], modal: null }); await refreshProjects(); }

export function exportProjectJson() {
  const p = get().project; if (!p) return;
  const ids = ops.flat(p.desktop.nodes).concat(p.mobile ? ops.flat(p.mobile.nodes) : []).filter((n) => n.type === 'image' && n.assetId).map((n) => (n as { assetId: string }).assetId);
  Promise.all(Array.from(new Set(ids)).map(async (id) => { const a = assets.get(id); const b = await assets.blob(id); if (!a || !b) return null; return { ...a, data: await blobToDataUrl(b) }; })).then((list) => {
    const payload = { phloem: 1, project: p, assets: list.filter(Boolean) };
    void downloadBytes(`${p.name.replace(/[^\w\-]+/g, '-')}.phloem.json`, new TextEncoder().encode(JSON.stringify(payload)), 'application/json').catch((e) => toast((e as Error).message, 'err'));
  });
}

export async function importProjectJson(file: File) {
  const payload = JSON.parse(await file.text());
  if (!payload || payload.phloem !== 1 || !payload.project) throw new Error('File không phải project Phloem.');
  const idMap = new Map<string, string>();
  for (const a of payload.assets || []) {
    const blob = await (await fetch(a.data)).blob();
    const na = await assets.add(blob, a.name);
    idMap.set(a.id, na.id);
  }
  const remap = (d: Doc): Doc => ops.mapNodes(d, (n) => (n.type === 'image' && n.assetId && idMap.has(n.assetId) ? { ...n, assetId: idMap.get(n.assetId)! } : n));
  const p: Project = { ...payload.project, id: uid('p'), desktop: remap(payload.project.desktop), mobile: payload.project.mobile ? remap(payload.project.mobile) : null, updatedAt: new Date().toISOString(), drafts: {} };
  await db.putProject({ ...p, owner: ownerId() });
  await refreshProjects();
  await openProject(p.id);
}

// ---------- accounts ----------
/** Mirror this account with the relay database (no-op for local accounts). */
export async function syncNow() {
  const r = await cloud.syncAll(ownerId());
  if (r.assets.length) assets.registerRemote(r.assets);
  if (r.profiles) set({ profiles: r.profiles });
  await refreshProjects();
}
export async function signUp(input: auth.Credentials) {
  const s = await auth.register(input, authOpts());
  set({ user: s.user, modal: null });
  toast(`Chào ${s.user.name}. Tài khoản ${s.mode === 'relay' ? 'đã tạo trên relay' : 'lưu trên trình duyệt này'}.`, 'ok');
  await refreshProjects();
  await syncNow();
}
export async function signIn(input: auth.Credentials) {
  if (get().dirty) await saveProject();
  const s = await auth.login(input, authOpts());
  set({ user: s.user, modal: null, route: { name: 'home' }, project: null, selection: [] });
  toast(`Đã đăng nhập: ${s.user.name}.`, 'ok');
  await refreshProjects();
  await syncNow();
}
/** A sign-in completed outside signIn() (Google button): adopt the stored session. */
export async function afterExternalSignIn() {
  if (get().dirty) await saveProject();
  const s = auth.getSession();
  set({ user: s?.user ?? null, modal: null, route: { name: 'home' }, project: null, selection: [] });
  if (s) toast(`Đã đăng nhập: ${s.user.name}.`, 'ok');
  await refreshProjects();
  await syncNow();
}
export async function signOut() {
  if (get().dirty) await saveProject();
  await cloud.flush();
  auth.logout();
  set({ user: null, route: { name: 'home' }, project: null, selection: [], modal: null, sync: { state: 'off' } });
  toast('Đã đăng xuất.', 'ok');
  await refreshProjects();
}
/** Re-validate the stored session on boot and follow sign-in changes made in another tab or on the landing page. */
export async function restoreSession() {
  const s = await auth.restore(authOpts());
  set({ user: s?.user ?? null });
  if (s) void syncNow();
  auth.onAuthChange((n) => { if ((n?.user.id || '') !== (get().user?.id || '')) { set({ user: n?.user ?? null }); void syncNow(); } });
  addEventListener('storage', (e) => {
    if (e.key !== 'phloem.session') return;
    const n = auth.getSession();
    if ((n?.user.id || '') === (get().user?.id || '')) return;
    void (async () => {
      if (get().dirty) await saveProject(); // still stamped with the old owner
      await cloud.flush();
      set({ user: n?.user ?? null, route: { name: 'home' }, project: null, selection: [], modal: null });
      await syncNow();
    })();
  });
}
export async function claimGuestProjects() {
  const id = ownerId(); if (!id) return;
  const n = await db.claimProjects(id);
  toast(n ? `Đã chuyển ${n} email vào tài khoản.` : 'Không có email nào của khách.', 'ok');
  await refreshProjects();
  await syncNow();
}

function blobToDataUrl(b: Blob): Promise<string> { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); }); }
