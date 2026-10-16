// Big graphic libraries loaded on demand: Microsoft Fluent Emoji 3D renders (MIT, ~1,600 objects with groups and
// keywords; index built by dev/fluent3d-index in studio/data/fluent3d.json, images straight from the GitHub repo).
import { assets } from '../storage/assets';
import type { ImageNode } from '../model/types';
import { uid } from '../model/types';

export interface Fluent3d { base: string; license: string; count: number; cats: [string, string[]][]; paths: Record<string, string>; kw: Record<string, string> }

export const CAT_VI: Record<string, string> = {
  'Smileys & Emotion': 'Cảm xúc', 'People & Body': 'Người', 'Animals & Nature': 'Động vật & thiên nhiên', 'Food & Drink': 'Đồ ăn & uống',
  'Travel & Places': 'Du lịch & nơi chốn', Activities: 'Hoạt động & lễ hội', Objects: 'Đồ vật', Symbols: 'Biểu tượng', Flags: 'Cờ', Khác: 'Khác',
};

let loaded: Fluent3d | null = null;
let loading: Promise<Fluent3d> | null = null;
/** The index (cached); tries the studio's own copy, then the published one (the claude.ai build has no data folder). */
export function loadFluent3d(): Promise<Fluent3d> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    const urls = ['data/fluent3d.json', 'https://dorisle-uxui.github.io/phloem/studio/data/fluent3d.json'];
    loading = (async () => {
      for (const u of urls) { try { const r = await fetch(u); if (r.ok) { loaded = (await r.json()) as Fluent3d; return loaded; } } catch { /* next */ } }
      throw new Error('Không tải được thư viện 3D');
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}
export const fluent3dSync = () => loaded;

/** Image URL of one 3D object (path segments encoded: folders have spaces). */
export function fluent3dUrl(idx: Fluent3d, id: string): string | null {
  const p = idx.paths[id]; if (!p) return null;
  return idx.base + p.split('/').map(encodeURIComponent).join('/');
}

/** Search names + keywords (English CLDR words; Vietnamese words map through a small dictionary). */
const VI_EN: Record<string, string> = {
  'tim': 'heart', 'trái tim': 'heart', 'quà': 'gift', 'lửa': 'fire', 'sao': 'star', 'tiền': 'money', 'cà phê': 'coffee', 'trà': 'tea', 'bánh': 'cake', 'hoa': 'flower', 'cây': 'plant', 'mèo': 'cat', 'chó': 'dog', 'xe': 'car', 'nhà': 'house', 'điện thoại': 'phone', 'máy tính': 'laptop', 'sách': 'book', 'âm nhạc': 'music', 'nhạc': 'music', 'game': 'game', 'bóng': 'ball', 'tết': 'red envelope', 'lì xì': 'red envelope', 'giáng sinh': 'christmas', 'đồng hồ': 'clock', 'lịch': 'calendar', 'giỏ hàng': 'cart', 'túi': 'bag', 'áo': 'shirt', 'giày': 'shoe', 'son': 'lipstick', 'mặt trời': 'sun', 'trăng': 'moon', 'mưa': 'rain', 'cầu vồng': 'rainbow', 'tên lửa': 'rocket', 'cúp': 'trophy', 'vương miện': 'crown', 'kim cương': 'gem', 'bóng đèn': 'light bulb', 'thư': 'envelope', 'máy ảnh': 'camera', 'pháo hoa': 'fireworks', 'bong bóng': 'balloon', 'trái cây': 'fruit', 'dâu': 'strawberry', 'chanh': 'lemon', 'kem': 'ice cream', 'pizza': 'pizza', 'bia': 'beer', 'rượu': 'wine', 'gà': 'chicken', 'cá': 'fish', 'bướm': 'butterfly', 'ong': 'bee', 'máy bay': 'airplane', 'biển': 'beach', 'núi': 'mountain', 'khiên': 'shield', 'khoá': 'lock', 'chìa khoá': 'key', 'loa': 'megaphone', 'chuông': 'bell', 'đèn': 'light', 'sách vở': 'books', 'tốt nghiệp': 'graduation', 'thể thao': 'sport', 'gym': 'muscle', 'robot': 'robot', 'ma': 'ghost', 'kỳ lân': 'unicorn',
};
/** English for a Vietnamese search word when the dictionary knows it (Iconify and Openverse search in English). */
export const enQuery = (q: string) => VI_EN[q.trim().toLowerCase()] || q.trim();

export function searchFluent3d(idx: Fluent3d, q: string): string[] {
  const t = q.trim().toLowerCase(); if (!t) return [];
  const words = [t, VI_EN[t]].filter(Boolean) as string[];
  const out: string[] = [];
  for (const id of Object.keys(idx.paths)) {
    const hay = `${id.replace(/-/g, ' ')} ${idx.kw[id] || ''}`;
    if (words.some((w) => hay.includes(w))) out.push(id);
  }
  return out.slice(0, 120);
}

/** A 3D object as a layer, centred on `at` (decoration: no alt text needed). */
export async function fluent3dLayer(id: string, at: { x: number; y: number }, size = 120, temp = false): Promise<ImageNode> {
  const idx = await loadFluent3d();
  const url = fluent3dUrl(idx, id); if (!url) throw new Error(`Không có vật thể 3D "${id}"`);
  const blob = await (await fetch(url)).blob();
  const a = await assets.add(blob, `${id.replace(/-/g, ' ')} 3D`, { src: { kind: 'graphic' }, temp });
  return { id: uid('n'), type: 'image', name: `${id.replace(/-/g, ' ')} 3D`, x: Math.round(at.x - size / 2), y: Math.round(at.y - size / 2), w: size, h: size, visible: true, locked: false, opacity: 1, link: null, alt: '', assetId: a.id, fit: 'contain', radius: 0, fill: null, overlay: null, decor: true };
}
