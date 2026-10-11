// Import a Figma frame through the REST API (personal access token). Best effort:
// text/rect/solid-fill frames become editable nodes; everything else is rasterised through /v1/images.
import type { Doc, Node, Project } from '../model/types';
import { DEFAULT_BRAND, uid } from '../model/types';
import { group as mkGroup, image as mkImage, rect as mkRect, text as mkText } from '../model/templates';
import { syncGroup } from '../model/ops';
import { assets } from '../storage/assets';
import { get } from '../store';

export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } | null {
  const m = /figma\.com\/(?:file|design|board)\/([A-Za-z0-9]+)/.exec(url);
  if (!m) return null;
  const nid = /node-id=([^&]+)/.exec(url)?.[1];
  return { fileKey: m[1], nodeId: nid ? decodeURIComponent(nid).replace('-', ':') : null };
}

async function figmaGet(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.figma.com/v1${path}`, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) {
    const t = await res.text();
    let msg = '';
    try { const j = JSON.parse(t); msg = j.err || j.message || ''; } catch { msg = t.slice(0, 160); }
    if (res.status === 403 && /scope/i.test(msg)) throw new Error('Token thiếu quyền "File content: Read". Vào Figma → Settings → Security → Personal access tokens → Generate new token, tick File content: Read (thêm Dev resources: Read nếu có), rồi dán token mới vào đây.');
    if (res.status === 403 && /token/i.test(msg)) throw new Error('Token Figma không hợp lệ hoặc đã bị thu hồi (403). Tạo token mới trong Figma → Settings → Security → Personal access tokens.');
    if (res.status === 403) throw new Error('Figma từ chối (403): bạn không có quyền xem file này, hoặc token không đúng tài khoản.');
    if (res.status === 404) throw new Error('Không tìm thấy file/frame (404): kiểm tra link có node-id và file đã được chia sẻ với tài khoản của token.');
    if (res.status === 429) throw new Error('Figma giới hạn tốc độ (429). Đợi một phút rồi thử lại.');
    throw new Error(`Figma ${res.status}: ${msg || 'lỗi không rõ'}`);
  }
  return res.json();
}

async function fetchImage(url: string): Promise<Blob> {
  try { const r = await fetch(url); if (r.ok) return r.blob(); } catch { /* CORS — go via relay */ }
  const s = get().settings;
  if (!s.relayUrl) throw new Error('Không tải được ảnh từ Figma (CORS). Bật relay trong Cài đặt.');
  const r = await fetch(`${s.relayUrl.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`, { headers: s.relayToken ? { 'X-Phloem-Token': s.relayToken } : {} });
  if (!r.ok) throw new Error(`Relay không tải được ảnh (${r.status})`);
  return r.blob();
}

function hex(c: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
function solid(fills: any[] | undefined): string | null {
  const f = (fills || []).find((x) => x.type === 'SOLID' && x.visible !== false);
  return f ? hex(f.color) : null;
}
const hasImageFill = (fills: any[] | undefined) => (fills || []).some((x) => x.type === 'IMAGE' && x.visible !== false);
const RASTER = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'REGULAR_POLYGON', 'ELLIPSE']);

export interface ImportProgress { (msg: string): void }

export async function importFromFigma(url: string, token: string, onProgress: ImportProgress = () => undefined): Promise<Project> {
  const parsed = parseFigmaUrl(url);
  if (!parsed) throw new Error('Link Figma không hợp lệ. Dùng link có node-id của frame email.');
  onProgress('Đang lấy cấu trúc frame…');
  let rootNode: any;
  if (parsed.nodeId) {
    const r = await figmaGet(`/files/${parsed.fileKey}/nodes?ids=${encodeURIComponent(parsed.nodeId)}&geometry=paths`, token);
    rootNode = Object.values(r.nodes)[0] && (Object.values(r.nodes)[0] as any).document;
  } else {
    const r = await figmaGet(`/files/${parsed.fileKey}?depth=2`, token);
    rootNode = r.document.children[0]?.children?.find((c: any) => c.type === 'FRAME');
    if (rootNode) { const rr = await figmaGet(`/files/${parsed.fileKey}/nodes?ids=${encodeURIComponent(rootNode.id)}`, token); rootNode = (Object.values(rr.nodes)[0] as any).document; }
  }
  if (!rootNode || !rootNode.absoluteBoundingBox) throw new Error('Không tìm thấy frame. Chọn frame trong Figma rồi copy link (có node-id).');
  const ox = rootNode.absoluteBoundingBox.x, oy = rootNode.absoluteBoundingBox.y;
  const W = Math.round(rootNode.absoluteBoundingBox.width), H = Math.round(rootNode.absoluteBoundingBox.height);
  const rasterIds: { id: string; node: Node }[] = [];
  const brand = { ...DEFAULT_BRAND };

  const conv = (n: any): Node | null => {
    if (n.visible === false || !n.absoluteBoundingBox) return null;
    const b = n.absoluteBoundingBox;
    const x = Math.round(b.x - ox), y = Math.round(b.y - oy), w = Math.max(1, Math.round(b.width)), h = Math.max(1, Math.round(b.height));
    const link: string | null = /#link=(\S+)/i.exec(n.name)?.[1] || n.style?.hyperlink?.url || (n.interactions || []).flatMap((i: any) => i.actions || []).find((a: any) => a.type === 'URL')?.url || null;
    const alt: string = /#alt=(.+?)(?=\s+#\w+=|$)/i.exec(n.name)?.[1]?.trim() || '';
    const common = { x, y, w, h, name: n.name, link, alt, opacity: n.opacity ?? 1 };
    if (n.type === 'TEXT') {
      const st = n.style || {};
      const t = mkText(brand, n.characters || '', {
        ...common, fontFamily: st.fontFamily || 'Inter', fontSize: st.fontSize || 14, fontWeight: st.fontWeight || 400, italic: !!st.italic,
        color: solid(n.fills) || '#111111', align: (st.textAlignHorizontal || 'LEFT').toLowerCase() as 'left' | 'center' | 'right',
        lineHeight: st.lineHeightPx && st.fontSize ? st.lineHeightPx / st.fontSize : 1.4, letterSpacing: st.letterSpacing || 0, autoHeight: false, vAlign: 'top', h,
      });
      t.underline = st.textDecoration === 'UNDERLINE';
      return t;
    }
    if (hasImageFill(n.fills) || RASTER.has(n.type) || (n.exportSettings && n.exportSettings.length)) {
      const img = mkImage({ ...common, radius: n.cornerRadius || 0, fit: 'fill', alt: alt || n.name });
      rasterIds.push({ id: n.id, node: img });
      return img;
    }
    if (n.type === 'RECTANGLE') return mkRect({ ...common, fill: solid(n.fills), radius: n.cornerRadius || 0, stroke: n.strokes?.length && solid(n.strokes) ? { color: solid(n.strokes)!, width: n.strokeWeight || 1 } : null });
    if (n.children && n.children.length) {
      const kids = n.children.map(conv).filter((k: Node | null): k is Node => !!k);
      const fill = solid(n.fills);
      if (fill) kids.unshift(mkRect({ x, y, w, h, fill, radius: n.cornerRadius || 0, name: `${n.name} bg` }));
      if (!kids.length) return null;
      return mkGroup(n.name, kids, { link, alt });
    }
    const fill = solid(n.fills);
    if (fill) return mkRect({ ...common, fill, radius: n.cornerRadius || 0 });
    return null;
  };

  const nodes: Node[] = (rootNode.children || []).map(conv).filter((n: Node | null): n is Node => !!n);
  if (rasterIds.length) {
    onProgress(`Đang render ${rasterIds.length} layer ảnh/vector…`);
    for (let i = 0; i < rasterIds.length; i += 40) {
      const chunk = rasterIds.slice(i, i + 40);
      const r = await figmaGet(`/images/${parsed.fileKey}?ids=${encodeURIComponent(chunk.map((c) => c.id).join(','))}&format=png&scale=2`, token);
      for (const c of chunk) {
        const u = r.images?.[c.id];
        if (!u) continue;
        try { const blob = await fetchImage(u); const a = await assets.add(blob, `${c.node.name}.png`); (c.node as { assetId: string | null }).assetId = a.id; } catch (e) { onProgress(`Bỏ qua "${c.node.name}": ${(e as Error).message}`); }
      }
    }
  }
  const doc: Doc = { width: W, height: H, bg: solid(rootNode.fills) || '#ffffff', nodes: nodes.map((n) => (n.type === 'group' ? syncGroup(n) : n)) };
  const now = new Date().toISOString();
  return { id: uid('p'), name: rootNode.name || 'Figma import', createdAt: now, updatedAt: now, brand, fields: { campaignName: rootNode.name || 'Email', subject: '', preheader: '' }, desktop: doc, mobile: null, drafts: {} };
}
