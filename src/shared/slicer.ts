// Pure slicing engine: NNode tree -> SlicePlan. No Figma API here, so it is unit-testable.
import type { NNode, Slice, SlicePlan, SliceRow, SlicerOptions } from './types';
import { DEFAULT_SLICER_OPTIONS } from './types';
import { area, clamp, contains, intersect, iou, uniqSorted, type Rect } from './geom';

interface Region extends Rect {
  node: NNode;
  depth: number;
}

/** Depth-first list of all visible descendants (root excluded) with their depth. */
export function flatten(root: NNode): { node: NNode; depth: number }[] {
  const out: { node: NNode; depth: number }[] = [];
  const walk = (n: NNode, d: number) => {
    for (const c of n.children) {
      if (!c.visible) continue;
      out.push({ node: c, depth: d });
      walk(c, d + 1);
    }
  };
  walk(root, 1);
  return out;
}

function clipToFrame(r: Rect, W: number, H: number): Rect | null {
  return intersect(r, { x: 0, y: 0, w: W, h: H });
}

function linkRegions(root: NNode): Region[] {
  const W = root.w, H = root.h;
  const regs: Region[] = [];
  for (const { node, depth } of flatten(root)) {
    if (!node.link) continue;
    const c = clipToFrame(node, W, H);
    if (!c || c.w < 1 || c.h < 1) continue;
    regs.push({ ...c, node, depth });
  }
  return regs;
}

/** Innermost (deepest, then smallest) region containing the point. */
function pickRegion(regs: Region[], px: number, py: number): Region | null {
  let best: Region | null = null;
  for (const r of regs) {
    if (!contains(r, px, py)) continue;
    if (!best || r.depth > best.depth || (r.depth === best.depth && area(r) < area(best))) best = r;
  }
  return best;
}

interface Cell { x: number; w: number; link: string | null; linkNodeId: string | null }
interface RawRow { y: number; h: number; cells: Cell[] }

function cellsForRow(regs: Region[], y: number, h: number, W: number): Cell[] {
  const overlapping = regs.filter((r) => r.y < y + h && r.y + r.h > y);
  if (!overlapping.length) return [{ x: 0, w: W, link: null, linkNodeId: null }];
  const xs = uniqSorted([0, W, ...overlapping.flatMap((r) => [clamp(r.x, 0, W), clamp(r.x + r.w, 0, W)])]);
  const cells: Cell[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i], w = xs[i + 1] - xs[i];
    if (w <= 0) continue;
    const reg = pickRegion(overlapping, x + w / 2, y + h / 2);
    const link = reg ? reg.node.link : null;
    const linkNodeId = reg ? reg.node.id : null;
    const prev = cells[cells.length - 1];
    if (prev && prev.link === link && prev.linkNodeId === linkNodeId) prev.w += w;
    else cells.push({ x, w, link, linkNodeId });
  }
  return cells;
}

function sameStructure(a: RawRow, b: RawRow): boolean {
  if (a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) {
    const p = a.cells[i], q = b.cells[i];
    if (p.x !== q.x || p.w !== q.w || p.link !== q.link || p.linkNodeId !== q.linkNodeId) return false;
  }
  return true;
}

/** Natural cut candidates: edges of top-level children, for splitting over-tall rows nicely. */
function naturalCuts(root: NNode): number[] {
  const ys: number[] = [];
  for (const c of root.children) {
    if (!c.visible) continue;
    ys.push(c.y, c.y + c.h);
  }
  return uniqSorted(ys).filter((y) => y > 0 && y < root.h);
}

function splitTall(rows: RawRow[], maxH: number, natural: number[]): RawRow[] {
  const out: RawRow[] = [];
  for (const row of rows) {
    if (row.h <= maxH) { out.push(row); continue; }
    let y = row.y;
    const end = row.y + row.h;
    while (end - y > maxH) {
      const target = y + maxH;
      // prefer a natural edge in (y + maxH*0.5, y + maxH]
      const candidates = natural.filter((n) => n > y + maxH * 0.5 && n <= target);
      const cut = candidates.length ? candidates[candidates.length - 1] : target;
      out.push({ y, h: cut - y, cells: row.cells.map((c) => ({ ...c })) });
      y = cut;
    }
    if (end - y > 0) out.push({ y, h: end - y, cells: row.cells.map((c) => ({ ...c })) });
  }
  return out;
}

function bestAlt(root: NNode, cell: Rect, linkNode: NNode | null): { alt: string; nodeId: string | null } {
  let best: { alt: string; nodeId: string | null; score: number } | null = null;
  const texts: { node: NNode; score: number }[] = [];
  for (const { node } of flatten(root)) {
    const inter = intersect(node, cell);
    if (!inter) continue;
    const covered = area(inter) / Math.max(1, area(node)); // how much of the node sits in this cell
    if (covered < 0.5) continue;
    if (node.alt && node.alt.trim()) {
      const score = area(inter) * (node.altSource === 'field' ? 4 : node.altSource === 'name' ? 3 : 1);
      if (!best || score > best.score) best = { alt: node.alt.trim(), nodeId: node.id, score };
    }
    if (node.isText && node.text && node.text.trim()) texts.push({ node, score: area(inter) });
  }
  if (best) return { alt: best.alt, nodeId: best.nodeId };
  if (linkNode && linkNode.alt && linkNode.alt.trim()) return { alt: linkNode.alt.trim(), nodeId: linkNode.id };
  if (texts.length) {
    texts.sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
    const joined = texts.map((t) => t.node.text!.replace(/\s+/g, ' ').trim()).join(' · ');
    return { alt: joined.length > 140 ? joined.slice(0, 137).trimEnd() + '…' : joined, nodeId: texts[0].node.id };
  }
  return { alt: '', nodeId: null };
}

function ownerAndLabel(root: NNode, cell: Rect): { ownerNodeId: string | null; label: string } {
  let best: { id: string; v: number } | null = null;
  const inside: { name: string; a: number }[] = [];
  for (const { node } of flatten(root)) {
    const inter = intersect(node, cell);
    if (!inter) continue;
    const v = iou(node, cell);
    if (!best || v > best.v) best = { id: node.id, v };
    if (area(inter) / Math.max(1, area(node)) >= 0.5 && !/^(Rectangle|Frame|Group|Vector|Ellipse|Line|Image)( \d+)?$/i.test(node.name)) {
      inside.push({ name: node.name, a: area(inter) });
    }
  }
  inside.sort((a, b) => b.a - a.a);
  const label = inside.slice(0, 2).map((n) => n.name).join(' · ') || 'slice';
  return { ownerNodeId: best ? best.id : null, label };
}

export function planSlices(root: NNode, opts: Partial<SlicerOptions> = {}): SlicePlan {
  const o: SlicerOptions = { ...DEFAULT_SLICER_OPTIONS, ...opts };
  const W = Math.round(root.w), H = Math.round(root.h);
  const regs = linkRegions(root);

  // 1. horizontal cuts at every link edge
  const ys = uniqSorted([0, H, ...regs.flatMap((r) => [clamp(r.y, 0, H), clamp(r.y + r.h, 0, H)])]);
  let rows: RawRow[] = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const y = ys[i], h = ys[i + 1] - ys[i];
    if (h <= 0) continue;
    rows.push({ y, h, cells: cellsForRow(regs, y, h, W) });
  }

  // 2. swallow hairline rows into a neighbour
  const merged: RawRow[] = [];
  for (const r of rows) {
    const prev = merged[merged.length - 1];
    if (r.h < o.minRowHeight && prev) { prev.h += r.h; continue; }
    if (r.h < o.minRowHeight && !prev && rows.length > 1) { /* defer: glue to next */ merged.push(r); continue; }
    if (prev && prev.h < o.minRowHeight) { r.y = prev.y; r.h += prev.h; merged.pop(); }
    merged.push(r);
  }
  rows = merged;

  // 3. merge vertically adjacent rows with identical structure
  if (o.mergeRows) {
    const out: RawRow[] = [];
    for (const r of rows) {
      const prev = out[out.length - 1];
      if (prev && sameStructure(prev, r) && prev.h + r.h <= o.maxSliceHeight) prev.h += r.h;
      else out.push(r);
    }
    rows = out;
  }

  // 4. split rows that are too tall
  rows = splitTall(rows, o.maxSliceHeight, naturalCuts(root));

  // 5. materialise slices
  const sliceRows: SliceRow[] = [];
  const slices: Slice[] = [];
  let index = 0;
  rows.forEach((r, ri) => {
    const cells: Slice[] = [];
    r.cells.forEach((c, ci) => {
      const rect: Rect = { x: c.x, y: r.y, w: c.w, h: r.h };
      const linkNode = c.linkNodeId ? regs.find((g) => g.node.id === c.linkNodeId)?.node ?? null : null;
      const alt = bestAlt(root, rect, linkNode);
      const own = ownerAndLabel(root, rect);
      const s: Slice = {
        key: `r${ri}c${ci}`,
        index: index++,
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        link: c.link,
        linkNodeId: c.linkNodeId,
        alt: alt.alt,
        altNodeId: alt.nodeId,
        ownerNodeId: own.ownerNodeId,
        label: own.label,
      };
      cells.push(s);
      slices.push(s);
    });
    sliceRows.push({ y: r.y, h: r.h, cells });
  });

  return { frameId: root.id, frameName: root.name, width: W, height: H, rows: sliceRows, slices };
}

/** Does any node in the cell paint an image? Used by checks. */
export function cellHasImage(root: NNode, cell: Rect): boolean {
  for (const { node } of flatten(root)) {
    if (!node.hasImage) continue;
    const inter = intersect(node, cell);
    if (inter && area(inter) / Math.max(1, area(node)) >= 0.3) return true;
  }
  return false;
}
