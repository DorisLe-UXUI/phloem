// People and characters, Canva-style: DiceBear's avatar styles drawn by independent artists (CC0 or CC BY 4.0, credited in
// docs/CREDITS.md). Every seed is a new person, so the library never runs out; inserted as a vector sticker layer.
import type { ImageNode } from '../model/types';
import { vec } from './elements';

const API = 'https://api.dicebear.com/10.x';
export interface PeopleStyle { v: string; label: string; lic: 'CC0' | 'CC BY 4.0'; by: string }
export const PEOPLE_STYLES: PeopleStyle[] = [
  { v: 'open-peeps', label: 'Vẽ tay', lic: 'CC0', by: 'Pablo Stanley' },
  { v: 'notionists', label: 'Notion', lic: 'CC0', by: 'Zoish' },
  { v: 'micah', label: 'Phẳng màu', lic: 'CC BY 4.0', by: 'Micah Lanier' },
  { v: 'personas', label: 'Nhân vật', lic: 'CC BY 4.0', by: 'Draftbit' },
  { v: 'adventurer', label: 'Hoạt hình', lic: 'CC BY 4.0', by: 'Lisa Wischofsky' },
  { v: 'big-smile', label: 'Cười tươi', lic: 'CC BY 4.0', by: 'Ashley Seo' },
  { v: 'toon-head', label: 'Chibi', lic: 'CC BY 4.0', by: 'Johan Melin' },
  { v: 'dylan', label: 'Năng động', lic: 'CC BY 4.0', by: 'Natalia Spivak' },
  { v: 'lorelei', label: 'Line art', lic: 'CC0', by: 'Lisa Wischofsky' },
  { v: 'miniavs', label: 'Mini', lic: 'CC BY 4.0', by: 'Webpixels' },
  { v: 'big-ears', label: 'Tai to', lic: 'CC BY 4.0', by: 'The Visual Team' },
  { v: 'croodles', label: 'Nguệch ngoạc', lic: 'CC BY 4.0', by: 'vijay verma' },
  { v: 'clay', label: 'Đất sét 3D', lic: 'CC0', by: 'DiceBear' },
  { v: 'voxel-art', label: 'Voxel 3D', lic: 'CC0', by: 'DiceBear' },
  { v: 'voxel-bot', label: 'Robot voxel', lic: 'CC0', by: 'DiceBear' },
  { v: 'critters', label: 'Quái vật nhỏ', lic: 'CC0', by: 'DiceBear' },
  { v: 'fun-emoji', label: 'Emoji vui', lic: 'CC BY 4.0', by: 'Davis Uche' },
  { v: 'moods', label: 'Tâm trạng', lic: 'CC0', by: 'DiceBear' },
  { v: 'sprouts', label: 'Cây cảnh', lic: 'CC0', by: 'DiceBear' },
  { v: 'thumbs', label: 'Bong bóng', lic: 'CC0', by: 'DiceBear' },
  { v: 'pixel-art', label: 'Pixel', lic: 'CC0', by: 'DiceBear' },
  { v: 'planets', label: 'Hành tinh', lic: 'CC0', by: 'DiceBear' },
  { v: 'landscape', label: 'Phong cảnh', lic: 'CC0', by: 'DiceBear' },
];

/** Preview / source URL of one character. */
export const peopleUrl = (style: string, seed: string) => `${API}/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;

/** Seeds for a page of characters: stable per (style, round) so tiles don't reshuffle on every render. */
export function peopleSeeds(round: number, n: number, offset = 0): string[] {
  return Array.from({ length: n }, (_, i) => `p${round}-${offset + i}`);
}

/** One character as a vector layer centred on `at`. */
export async function peopleLayer(style: string, seed: string, at: { x: number; y: number }, size = 180): Promise<ImageNode> {
  const r = await fetch(peopleUrl(style, seed));
  if (!r.ok) throw new Error(`Không tải được nhân vật (HTTP ${r.status}).`);
  const svg = await r.text();
  const label = PEOPLE_STYLES.find((s) => s.v === style)?.label || style;
  return vec(`${label} · ${seed}`, svg, Math.round(at.x - size / 2), Math.round(at.y - size / 2), size, size, null, 'sticker');
}
