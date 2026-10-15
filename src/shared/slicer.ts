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

/** A link (social icon, small button) beside a taller picture (logo, photo) would cut that picture into a strip that
 *  sits in a multi-column row; on zoomed screens such strips show seams right through the artwork. The link's band
 *  grows to the picture's full height instead, so the picture is never cut there (its clickable area grows a little). */
function widenBesideImages(regs: Region[], root: NNode): void {
  const pics = flatten(root).map((f) => f.node).filter((n) => n.hasImage && !n.isText && n.w >= 24 && n.h >= 24 && n.h <= 420);
  if (!pics.length) return;
  for (const r of regs) {
    let a = r.y, b = r.y + r.h;
    for (let pass = 0; pass < 4; pass++) {
      let grew = false;
      for (const p of pics) {
        const beside = p.x >= r.x + r.w || p.x + p.w <= r.x; // no horizontal overlap with the link
        if (!beside) continue;
        const overlaps = p.y < b - 1 && p.y + p.h > a + 1;
        const crosses = p.y < a - 1 || p.y + p.h > b + 1;
        if (overlaps && crosses) { a = Math.min(a, p.y); b = Math.max(b, p.y + p.h); grew = true; }
      }
      if (!grew) break;
    }
    if (a < r.y || b > r.y + r.h) { r.y = Math.max(0, a); r.h = Math.min(root.h, b) - r.y; }
  }
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
interface RawRow { y: number; h: number; cells: Cell[]; keep?: number }

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
    // one destination = one cell, even when the picture, the title and the button each carry the link themselves
    if (prev && prev.link === link) prev.w += w;
    else cells.push({ x, w, link, linkNodeId });
  }
  return absorbGutters(cells);
}

/** Link-less strips that only separate things join a neighbouring cell (one request less each): card gutters under
 *  24px, and the side margins of a row of linked cards (≤ 48px; the margin then clicks through to its neighbour). */
function absorbGutters(cells: Cell[]): Cell[] {
  if (cells.length < 2) return cells;
  const out: Cell[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const edge = i === 0 || i === cells.length - 1;
    if (!c.link && (c.w < 24 || (edge && c.w <= 48))) {
      const prev = out[out.length - 1];
      if (prev) { prev.w += c.w; continue; }
      const next = cells[i + 1]; if (next) { next.x = c.x; next.w += c.w; continue; }
    }
    const prev = out[out.length - 1];
    if (prev && prev.link === c.link) { prev.w += c.w; continue; } // neighbours that met after a gutter left
    out.push({ ...c });
  }
  return out;
}

function sameStructure(a: RawRow, b: RawRow): boolean {
  if (a.keep !== undefined || b.keep !== undefined) return false; // kept (animated) rows never absorb static neighbours
  if (a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) {
    const p = a.cells[i], q = b.cells[i];
    if (p.x !== q.x || p.w !== q.w || p.link !== q.link) return false;
  }
  return true;
}

/** Merge overlapping/touching y-intervals. */
function uniteSpans(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  // strictly overlapping only: blocks that merely touch stay separate slices (each its own GIF)
  for (const sp of sorted) { const last = out[out.length - 1]; if (last && sp[0] < last[1]) last[1] = Math.max(last[1], sp[1]); else out.push([sp[0], sp[1]]); }
  return out;
}

/** The link that covers most of a rect. */
function dominantLink(regs: Region[], r: Rect): { link: string | null; linkNodeId: string | null } {
  let best: { reg: Region; a: number } | null = null;
  for (const reg of regs) { const a = area(intersect(reg, r)); if (a > 0 && (!best || a > best.a)) best = { reg, a }; }
  return best ? { link: best.reg.node.link, linkNodeId: best.reg.node.id } : { link: null, linkNodeId: null };
}

/** Link regions that behave like columns in this row (cards, nav items): they cover most of the row's height. */
function columnRegions(regs: Region[], row: Rect): Region[] {
  return regs.filter((r) => { const i = intersect(r, row); return !!i && i.h >= row.h * 0.6; });
}

/** Column cells for a kept row: a cut at every column-region edge, each column taking the link covering most of it. */
function keepCells(cols: Region[], row: Rect, W: number): Cell[] {
  const xs = uniqSorted([0, W, ...cols.flatMap((r) => [clamp(r.x, 0, W), clamp(r.x + r.w, 0, W)])]);
  const cells: Cell[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i], w = xs[i + 1] - xs[i];
    if (w <= 0) continue;
    const { link, linkNodeId } = dominantLink(cols, { x, y: row.y, w, h: row.h });
    const prev = cells[cells.length - 1];
    if (prev && prev.link === link) prev.w += w; else cells.push({ x, w, link, linkNodeId });
  }
  return absorbGutters(cells);
}

/** Rows inside a kept (animated) span: a row holding two or more column-like links (product cards, nav items, social
 *  icons) keeps its columns so every link survives; every other row merges with its neighbours into one full-width
 *  slice (a hero with one button stays one piece). All slices of a span carry its index: one clock, one frame rate. */
function keepRows(rows: RawRow[], spans: [number, number][], regs: Region[], W: number): RawRow[] {
  const out: RawRow[] = [];
  let run: RawRow | null = null;
  for (const r of rows) {
    const k = spans.findIndex(([a, b]) => r.y < b && r.y + r.h > a);
    if (k < 0) { run = null; out.push(r); continue; }
    const rect = { x: 0, y: r.y, w: W, h: r.h };
    const cols = columnRegions(regs, rect);
    if (new Set(cols.map((c) => c.node.id)).size >= 2) { out.push({ y: r.y, h: r.h, cells: keepCells(cols, rect, W), keep: k }); run = null; continue; }
    if (run && run.keep === k) { run.h += r.h; continue; }
    run = { y: r.y, h: r.h, cells: [], keep: k }; out.push(run);
  }
  for (const r of out) if (r.keep !== undefined && !r.cells.length) r.cells = [{ x: 0, w: W, ...dominantLink(regs, { x: 0, y: r.y, w: W, h: r.h }) }];
  return out;
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
  widenBesideImages(regs, root);
  const keeps = (o.keep || []).map((k) => clipToFrame(k, W, H)).filter((k): k is Rect => !!k && k.h >= 1);
  const spans = uniteSpans(keeps.map((k) => [k.y, k.y + k.h] as [number, number]));

  // 1. horizontal cuts at every link edge (and at the edges of kept regions)
  const ys = uniqSorted([0, H, ...regs.flatMap((r) => [clamp(r.y, 0, H), clamp(r.y + r.h, 0, H)]), ...spans.flat()]);
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

  // 2b. animated regions: everything a kept span touches becomes one full-width row (one GIF, always in sync)
  if (spans.length) rows = keepRows(rows, spans, regs, W);

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
        ...(r.keep !== undefined ? { keep: r.keep } : {}),
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
