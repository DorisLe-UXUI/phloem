// Library organisation: assets grouped by what they are used for and where they came from.
import type { Asset, Node, Project } from '../model/types';

const walk = (list: Node[], fn: (n: Node) => void) => { for (const n of list) { fn(n); if (n.type === 'group') walk(n.children, fn); } };

export interface AssetGroup { key: string; label: string; kind: 'used' | 'project' | 'web' | 'upload' | 'other'; items: Asset[]; mine: boolean }

/** Every asset id the project references (both variants + brand logos). */
export function usedAssetIds(p: Project | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!p) return out;
  for (const d of [p.desktop, p.mobile]) if (d) walk(d.nodes, (n) => { if (n.type === 'image' && n.assetId) out.add(n.assetId); });
  if (p.brand.logoAssetId) out.add(p.brand.logoAssetId);
  if (p.brand.logoLightAssetId) out.add(p.brand.logoLightAssetId);
  return out;
}

const newest = (a: Asset, b: Asset) => (b.at || '').localeCompare(a.at || '') || a.name.localeCompare(b.name);

/**
 * Groups, in display order: used in this email → tagged with this project → one group per website (project-related first)
 * → uploads & pastes → untagged. `scope: 'project'` keeps only groups that touch the open project.
 */
export function groupAssets(all: Asset[], opts: { projectId: string | null; usedIds: Set<string>; scope?: 'project' | 'all'; query?: string }): AssetGroup[] {
  const q = (opts.query || '').trim().toLowerCase();
  const list = q ? all.filter((a) => `${a.name} ${a.src?.host || ''} ${a.src?.page || ''} ${a.src?.kind || ''}`.toLowerCase().includes(q)) : all;
  const used: Asset[] = [], proj: Asset[] = [], uploads: Asset[] = [], other: Asset[] = [], graphics: Asset[] = [];
  const web = new Map<string, Asset[]>();
  for (const a of list) {
    if (opts.projectId && opts.usedIds.has(a.id)) used.push(a);
    else if (a.src?.kind === 'web' || a.src?.kind === 'logo') { const h = a.src.host || 'web'; if (!web.has(h)) web.set(h, []); web.get(h)!.push(a); }
    else if (a.src?.kind === 'graphic') graphics.push(a); // icons, stickers and shapes from the Thiết kế tab: their own shelf, not mixed with photos
    else if (opts.projectId && a.project === opts.projectId) proj.push(a);
    else if (a.src) uploads.push(a);
    else other.push(a);
  }
  const groups: AssetGroup[] = [];
  if (used.length) groups.push({ key: 'used', label: 'Đang dùng trong email', kind: 'used', items: used.sort(newest), mine: true });
  if (proj.length) groups.push({ key: 'project', label: 'Dự án này', kind: 'project', items: proj.sort(newest), mine: true });
  const webGroups = [...web.entries()].map(([host, items]) => ({ key: `web:${host}`, label: `Web · ${host}`, kind: 'web' as const, items: items.sort(newest), mine: !!opts.projectId && items.some((a) => a.project === opts.projectId) }));
  webGroups.sort((a, b) => Number(b.mine) - Number(a.mine) || b.items.length - a.items.length);
  groups.push(...webGroups);
  if (uploads.length) groups.push({ key: 'uploads', label: 'Tải lên & dán', kind: 'upload', items: uploads.sort(newest), mine: !!opts.projectId && uploads.some((a) => a.project === opts.projectId) });
  if (graphics.length) groups.push({ key: 'graphics', label: 'Đồ hoạ & icon', kind: 'other', items: graphics.sort(newest), mine: !!opts.projectId && graphics.some((a) => a.project === opts.projectId) });
  if (other.length) groups.push({ key: 'other', label: 'Khác', kind: 'other', items: other.sort(newest), mine: false });
  return opts.scope === 'project' && opts.projectId ? groups.filter((g) => g.mine) : groups;
}

export const pageLabel = (a: Asset) => (a.src?.kind === 'web' && a.src.page && a.src.page !== '/' ? a.src.page : '');
