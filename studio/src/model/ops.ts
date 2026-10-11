// Pure, immutable document operations. Every function returns a new Doc; nodes that did not change are reused.
import type { Doc, GroupNode, Node, TextNode } from './types';
import { uid } from './types';

export interface Rect { x: number; y: number; w: number; h: number }

export const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function containsPt(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function bounds(n: Node): Rect {
  if (n.type === 'group') {
    let r: Rect | null = null;
    for (const c of n.children) r = union(r, bounds(c));
    return r ?? { x: n.x, y: n.y, w: 0, h: 0 };
  }
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

/** Recompute stored x/y/w/h of groups from their children. */
export function syncGroup(g: GroupNode): GroupNode {
  const b = bounds(g);
  if (g.x === b.x && g.y === b.y && g.w === b.w && g.h === b.h) return g;
  return { ...g, ...b };
}

export function flat(nodes: Node[]): Node[] {
  const out: Node[] = [];
  const walk = (list: Node[]) => { for (const n of list) { out.push(n); if (n.type === 'group') walk(n.children); } };
  walk(nodes);
  return out;
}

export function findNode(doc: Doc, id: string): Node | null {
  for (const n of flat(doc.nodes)) if (n.id === id) return n;
  return null;
}

export function findParent(doc: Doc, id: string): GroupNode | null {
  let found: GroupNode | null = null;
  const walk = (list: Node[], parent: GroupNode | null) => {
    for (const n of list) {
      if (n.id === id) { found = parent; return true; }
      if (n.type === 'group' && walk(n.children, n)) return true;
    }
    return false;
  };
  walk(doc.nodes, null);
  return found;
}

/** The top-level ancestor of a node (or the node itself). */
export function topLevelOf(doc: Doc, id: string): Node | null {
  for (const n of doc.nodes) if (n.id === id || (n.type === 'group' && flat(n.children).some((c) => c.id === id))) return n;
  return null;
}

/** Map every node (depth-first, children before parent); groups get resynced. */
export function mapNodes(doc: Doc, fn: (n: Node) => Node): Doc {
  let changed = false;
  const walk = (list: Node[]): Node[] => {
    let out: Node[] | null = null;
    list.forEach((n, i) => {
      let m: Node = n;
      if (n.type === 'group') { const kids = walk(n.children); if (kids !== n.children) m = syncGroup({ ...n, children: kids }); }
      m = fn(m);
      if (m.type === 'group') m = syncGroup(m);
      if (m !== n) { if (!out) out = list.slice(); out[i] = m; changed = true; }
    });
    return out ?? list;
  };
  const nodes = walk(doc.nodes);
  return changed ? { ...doc, nodes } : doc;
}

export function updateNode(doc: Doc, id: string, patch: Partial<Node> | ((n: Node) => Node)): Doc {
  return mapNodes(doc, (n) => (n.id === id ? (typeof patch === 'function' ? patch(n) : ({ ...n, ...patch } as Node)) : n));
}

export function updateNodes(doc: Doc, ids: string[], fn: (n: Node) => Node): Doc {
  const set = new Set(ids);
  return mapNodes(doc, (n) => (set.has(n.id) ? fn(n) : n));
}

export function removeNodes(doc: Doc, ids: string[]): Doc {
  const set = new Set(ids);
  const walk = (list: Node[]): Node[] => list.filter((n) => !set.has(n.id)).map((n) => (n.type === 'group' ? syncGroup({ ...n, children: walk(n.children) }) : n)).filter((n) => n.type !== 'group' || n.children.length);
  return { ...doc, nodes: walk(doc.nodes) };
}

export function insertNodes(doc: Doc, nodes: Node[], index = doc.nodes.length): Doc {
  const list = doc.nodes.slice();
  list.splice(index, 0, ...nodes);
  return { ...doc, nodes: list };
}

function shift(n: Node, dx: number, dy: number): Node {
  if (n.type === 'group') return { ...n, x: n.x + dx, y: n.y + dy, children: n.children.map((c) => shift(c, dx, dy)) };
  return { ...n, x: n.x + dx, y: n.y + dy };
}

export function moveBy(doc: Doc, ids: string[], dx: number, dy: number): Doc {
  if (!dx && !dy) return doc;
  const set = new Set(ids);
  const walk = (list: Node[]): Node[] => list.map((n) => (set.has(n.id) ? shift(n, dx, dy) : n.type === 'group' ? syncGroup({ ...n, children: walk(n.children) }) : n));
  return { ...doc, nodes: walk(doc.nodes) };
}

/** Scale a node (and descendants) from its current bounds to `to`. */
export function fitTo(n: Node, to: Rect, scaleText = true): Node {
  const from = bounds(n);
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  const map = (m: Node): Node => {
    const x = to.x + (m.x - from.x) * sx, y = to.y + (m.y - from.y) * sy, w = m.w * sx, h = m.h * sy;
    if (m.type === 'group') return syncGroup({ ...m, children: m.children.map(map) });
    if (m.type === 'text') {
      const fs = scaleText && Math.abs(sx - sy) < 0.02 ? Math.max(6, Math.round(m.fontSize * sx * 10) / 10) : m.fontSize;
      return { ...m, x, y, w, h, fontSize: fs };
    }
    if (m.type === 'rect') return { ...m, x, y, w, h, radius: Math.round(m.radius * Math.min(sx, sy)) };
    return { ...m, x, y, w, h };
  };
  return map(n);
}

export function resizeTo(doc: Doc, id: string, to: Rect, scaleText = true): Doc {
  return updateNode(doc, id, (n) => fitTo(n, { x: to.x, y: to.y, w: Math.max(1, to.w), h: Math.max(1, to.h) }, scaleText));
}

export function cloneNode(n: Node): Node {
  const c: Node = { ...n, id: uid() } as Node;
  if (c.type === 'group') c.children = (n as GroupNode).children.map(cloneNode);
  return c;
}

export function duplicate(doc: Doc, ids: string[], dx = 16, dy = 16): { doc: Doc; ids: string[] } {
  const picked = doc.nodes.filter((n) => ids.includes(n.id));
  const clones = picked.map((n) => shift(cloneNode(n), dx, dy));
  // insert each clone right above its source
  let nodes = doc.nodes.slice();
  for (let i = picked.length - 1; i >= 0; i--) {
    const idx = nodes.indexOf(picked[i]);
    nodes.splice(idx + 1, 0, clones[i]);
  }
  return { doc: { ...doc, nodes }, ids: clones.map((c) => c.id) };
}

export function group(doc: Doc, ids: string[], name = 'Group'): { doc: Doc; id: string } {
  const members = doc.nodes.filter((n) => ids.includes(n.id));
  if (members.length < 1) return { doc, id: '' };
  const idx = doc.nodes.indexOf(members[members.length - 1]);
  const g: GroupNode = syncGroup({ id: uid('g'), type: 'group', name, x: 0, y: 0, w: 0, h: 0, visible: true, locked: false, opacity: 1, link: null, alt: '', children: members });
  const nodes = doc.nodes.filter((n) => !ids.includes(n.id));
  const insertAt = Math.min(idx - (members.length - 1), nodes.length);
  nodes.splice(Math.max(0, insertAt), 0, g);
  return { doc: { ...doc, nodes }, id: g.id };
}

export function ungroup(doc: Doc, id: string): { doc: Doc; ids: string[] } {
  const walk = (list: Node[]): { list: Node[]; ids: string[] } => {
    let ids: string[] = [];
    const out: Node[] = [];
    for (const n of list) {
      if (n.id === id && n.type === 'group') { out.push(...n.children); ids = n.children.map((c) => c.id); }
      else if (n.type === 'group') { const r = walk(n.children); ids = ids.concat(r.ids); out.push(syncGroup({ ...n, children: r.list })); }
      else out.push(n);
    }
    return { list: out, ids };
  };
  const r = walk(doc.nodes);
  return { doc: { ...doc, nodes: r.list }, ids: r.ids };
}

export function reorder(doc: Doc, id: string, dir: 'up' | 'down' | 'top' | 'bottom'): Doc {
  const walk = (list: Node[]): Node[] => {
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return list.map((n) => (n.type === 'group' ? { ...n, children: walk(n.children) } : n));
    const out = list.slice();
    const [n] = out.splice(i, 1);
    const j = dir === 'up' ? Math.min(out.length, i + 1) : dir === 'down' ? Math.max(0, i - 1) : dir === 'top' ? out.length : 0;
    out.splice(j, 0, n);
    return out;
  };
  return { ...doc, nodes: walk(doc.nodes) };
}

export function selectionBounds(doc: Doc, ids: string[]): Rect | null {
  let r: Rect | null = null;
  for (const id of ids) { const n = findNode(doc, id); if (n && n.visible) r = union(r, bounds(n)); }
  return r;
}

export type AlignHow = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function align(doc: Doc, ids: string[], how: AlignHow): Doc {
  const nodes = ids.map((id) => findNode(doc, id)).filter((n): n is Node => !!n);
  if (!nodes.length) return doc;
  const ref = nodes.length === 1 ? { x: 0, y: 0, w: doc.width, h: doc.height } : selectionBounds(doc, ids)!;
  let out = doc;
  for (const n of nodes) {
    const b = bounds(n);
    let dx = 0, dy = 0;
    if (how === 'left') dx = ref.x - b.x;
    if (how === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
    if (how === 'top') dy = ref.y - b.y;
    if (how === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
    out = moveBy(out, [n.id], Math.round(dx), Math.round(dy));
  }
  return out;
}

export function distribute(doc: Doc, ids: string[], axis: 'h' | 'v'): Doc {
  const nodes = ids.map((id) => findNode(doc, id)).filter((n): n is Node => !!n);
  if (nodes.length < 3) return doc;
  const bs = nodes.map((n) => ({ n, b: bounds(n) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = bs[0].b, last = bs[bs.length - 1].b;
  const total = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const sizes = bs.reduce((a, { b }) => a + (axis === 'h' ? b.w : b.h), 0);
  const gap = (total - sizes) / (bs.length - 1);
  let out = doc, cursor = axis === 'h' ? first.x : first.y;
  for (const { n, b } of bs) {
    const target = Math.round(cursor);
    out = moveBy(out, [n.id], axis === 'h' ? target - b.x : 0, axis === 'v' ? target - b.y : 0);
    cursor += (axis === 'h' ? b.w : b.h) + gap;
  }
  return out;
}

/** Topmost node under a point. By default returns the top-level node; `within` descends into a group. */
export function hitTest(doc: Doc, px: number, py: number, within: GroupNode | null = null, deep = false): Node | null {
  const list = within ? within.children : doc.nodes;
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (!n.visible || n.locked) continue;
    if (!containsPt(bounds(n), px, py)) continue;
    if (n.type === 'group') {
      const inner = hitTest(doc, px, py, n, deep);
      if (!inner) continue;
      return deep ? inner : n;
    }
    return n;
  }
  return null;
}

export function nodesInRect(doc: Doc, r: Rect): string[] {
  return doc.nodes.filter((n) => n.visible && !n.locked && intersects(bounds(n), r)).map((n) => n.id);
}

export function contentHeight(doc: Doc): number {
  let h = 0;
  for (const n of doc.nodes) { const b = bounds(n); h = Math.max(h, b.y + b.h); }
  return Math.round(h);
}

export function roundAll(doc: Doc): Doc {
  return mapNodes(doc, (n) => {
    if (n.type === 'group') return n;
    const x = Math.round(n.x), y = Math.round(n.y), w = Math.max(1, Math.round(n.w)), h = Math.max(1, Math.round(n.h));
    return x === n.x && y === n.y && w === n.w && h === n.h ? n : { ...n, x, y, w, h };
  });
}

/** Stack top-level block groups vertically in their current visual order, removing gaps/overlaps. */
export function reflowBlocks(doc: Doc, gap = 0): Doc {
  const ordered = doc.nodes.map((n, i) => ({ n, i, b: bounds(n) })).sort((a, b) => a.b.y - b.b.y || a.i - b.i);
  let y = 0, out = doc;
  for (const { n, b } of ordered) {
    if (!n.block) { y = Math.max(y, b.y + b.h); continue; }
    out = moveBy(out, [n.id], 0, Math.round(y - b.y));
    y += b.h + gap;
  }
  return { ...out, height: Math.max(contentHeight(out), 1) };
}

export function setDocWidth(doc: Doc, width: number): Doc {
  if (width === doc.width) return doc;
  const s = width / doc.width;
  const nodes = doc.nodes.map((n) => fitTo(n, { x: bounds(n).x * s, y: bounds(n).y * s, w: bounds(n).w * s, h: bounds(n).h * s }, true));
  return roundAll({ ...doc, width, height: Math.round(doc.height * s), nodes });
}

/** Mobile variant: scale to 375 wide, keep fonts readable (>= 13px). */
export function makeMobile(doc: Doc, width = 375): Doc {
  const m = setDocWidth(doc, width);
  return mapNodes(m, (n) => (n.type === 'text' && n.fontSize < 13 ? { ...n, fontSize: 13 } : n));
}

export function isTextNode(n: Node | null): n is TextNode { return !!n && n.type === 'text'; }

/**
 * Set a text node's height and let the layout flow: siblings below it (inside the same group) shift by the delta,
 * a background rect spanning the group grows, and top-level blocks below the group shift too. Emails are stacked,
 * so this is what people expect when copy gets longer or shorter.
 */
export function setHeightFlow(doc: Doc, id: string, newH: number): Doc {
  const n = findNode(doc, id);
  if (!n) return doc;
  const delta = Math.round(newH - n.h);
  if (!delta) return doc;
  const oldBottom = n.y + n.h;
  const parent = findParent(doc, id);
  let out = updateNode(doc, id, { h: newH } as Partial<Node>);
  const parentOldBottom = parent ? parent.y + parent.h : oldBottom;
  if (parent) {
    for (const s of parent.children) {
      if (s.id === id) continue;
      const isBg = s.type === 'rect' && s.y <= n.y && s.y + s.h >= oldBottom - 1 && s.w >= parent.w * 0.9 && s.h >= parent.h * 0.9;
      if (isBg) out = updateNode(out, s.id, { h: Math.max(1, s.h + delta) } as Partial<Node>);
      else if (s.y >= oldBottom - 1) out = moveBy(out, [s.id], 0, delta);
    }
  }
  const top = parent ? topLevelOf(doc, id) : null;
  const below = doc.nodes.filter((t) => t.id !== id && (!top || t.id !== top.id) && bounds(t).y >= parentOldBottom - 1).map((t) => t.id);
  if (below.length) out = moveBy(out, below, 0, delta);
  const ch = contentHeight(out);
  if (ch > out.height || (delta < 0 && out.height - ch < 4)) out = { ...out, height: Math.max(100, ch) };
  return out;
}
