// Editor actions: every mutation of the project goes through here (history, dirty flag, autosave).
import type { BlockKind, Check, NNode, SlicePlan, Suggestion, SuggestionAction, TemplateKind } from '../../../src/shared/types';
import { planSlices } from '../../../src/shared/slicer';
import { runChecks } from '../../../src/shared/checks';
import { suggest } from '../../../src/shared/suggestions';
import type { Asset, Brand, Color, Doc, Node, Project, RectNode, TextNode } from '../model/types';
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
export function reorderSelection(dir: 'up' | 'down' | 'top' | 'bottom') { let d = doc(); for (const id of get().selection) d = ops.reorder(d, id, dir); commit(d); }
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
export function scrapIntoDoc(id: string, into?: string) {
  const sc = get().scraps.find((x) => x.id === id); if (!sc) return;
  const a = assets.get(sc.assetId); if (!a) { removeScrap(id); return; }
  const d = doc();
  if (into) { commit(ops.updateNode(d, into, (n) => (n.type === 'image' ? { ...n, assetId: a.id, name: n.name === 'Image' ? a.name : n.name } : n))); removeScrap(id); set({ selection: [into] }); return; }
  const w = Math.min(d.width, sc.w), h = Math.round(w * (sc.h / sc.w));
  const x = Math.max(0, Math.min(d.width - w, Math.round(sc.x))), y = Math.max(0, Math.round(sc.y));
  const n = mkImage({ x, y, w, h, assetId: a.id, name: a.name, alt: a.name.replace(/\.[a-z0-9]+$/i, '') });
  commit(ops.insertNodes(d, [n])); removeScrap(id); set({ selection: [n.id], tool: 'select' });
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
  const plan = planSlices(root, { maxSliceHeight: s.settings.maxSliceHeight, mergeRows: s.settings.mergeRows });
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
