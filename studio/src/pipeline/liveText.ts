// Live HTML text: plain copy on a solid background leaves the picture slices and goes out as real text (spam filters
// weigh the text/image ratio, screen readers and search read it, it stays sharp at any zoom). Conservative on purpose:
// only paragraphs up to 24px, no effects, no rotation, nothing else drawn in that area; display type stays a picture.
// Paragraph bands inside bigger slices (a section mixing pictures and copy) are carved out so the copy can go live.
import type { LiveText, LiveTextRun, Slice, SlicePlan, SliceRow } from '../../../src/shared/types';
import type { Brand, Doc, Node, RectNode, TextNode } from '../model/types';
import { FONTS, resolveColor } from '../model/types';
import { bounds, flat } from '../model/ops';

const MAX_LIVE = 24;
type R = { x: number; y: number; w: number; h: number };
const inter = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: R, b: R, tol = 0.5) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
const covers = (a: R, b: R) => inside(b, a, 0.5);

const FALLBACK: Record<string, string> = { serif: "Georgia, 'Times New Roman', serif", mono: "'Courier New', Courier, monospace", script: "Georgia, 'Times New Roman', serif" };
function fontStack(family: string): string {
  const cat = FONTS.find((f) => f.family === family)?.cat || 'sans';
  return `'${family.replace(/'/g, '')}', ${FALLBACK[cat] || "Helvetica, Arial, sans-serif"}`;
}
export function familyOf(n: TextNode, brand: Brand): string { return n.fontFamily === 'brand' ? brand.fontFamily : n.fontFamily === 'heading' ? brand.headingFamily : n.fontFamily; }

let liveBrand: Brand | null = null; // the brand being exported (font tokens resolve against it)
/** A text layer that reads the same as live text: body copy (small, flat, upright, opaque, not animated). Bold display
 *  sizes and decorative faces (wordmarks, badges) keep their pixels: a fallback font would change their look. */
function liveable(n: TextNode): boolean {
  if (n.fontSize > MAX_LIVE || n.effect || n.rotate || n.blur || n.opacity < 0.99 || n.anim || n.strike || !n.text.trim()) return false;
  const cat = FONTS.find((f) => f.family === (liveBrand ? familyOf(n, liveBrand) : n.fontFamily))?.cat || 'sans';
  if ((cat === 'display' || cat === 'script' || cat === 'rounded') && n.fontSize > 14) return false;
  return n.fontWeight < 700 || n.fontSize <= 16;
}
/** A flat, square-cornered, opaque fill: something a table cell's bgcolor can reproduce. */
function flatFill(n: RectNode, brand: Brand): string | null {
  if (n.gradient || n.blur || n.backdropBlur || n.rotate || n.opacity < 0.99 || n.stroke) return null;
  const c = resolveColor(n.fill, brand);
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
}

interface Leaf { n: Node; b: R }
/** Layers that put pixels on the page (block frames and empty placeholders paint nothing). */
function paints(n: Node, brand: Brand): boolean {
  if (n.type !== 'rect') return true;
  const f = resolveColor(n.fill, brand);
  return !!(n.gradient || n.stroke || n.shadow || n.blur || n.backdropBlur || (f && !/^(transparent|rgba\([^)]*,\s*0\))$/i.test(f)));
}
const leavesOf = (doc: Doc, brand: Brand): Leaf[] => flat(doc.nodes).filter((n) => n.type !== 'group' && n.visible && n.opacity > 0 && paints(n, brand)).map((n) => ({ n, b: bounds(n) }));

/** What a rect of the email holds: the solid background and the text layers in it, or null when anything else is drawn there. */
function contentOf(area: R, leaves: Leaf[], doc: Doc, brand: Brand): { bg: string; texts: TextNode[] } | null {
  let bg = resolveColor(doc.bg, brand) || '#ffffff';
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return null;
  const texts: TextNode[] = [];
  for (const { n, b } of leaves) {
    if (!inter(b, area)) continue;
    if (n.type === 'text') { if (!inside(b, area) || !liveable(n)) return null; texts.push(n); continue; }
    if (n.type === 'rect' && covers(b, area)) {
      const f = flatFill(n, brand); if (!f) return null;
      // rounded corners or a shadow only matter when they reach into this area
      const r = Math.max(n.radius || 0, ...(n.radii || [0]));
      if ((r > 0 && (b.y + r > area.y || b.y + b.h - r < area.y + area.h)) || (n.shadow && (b.y >= area.y - 1 || b.y + b.h <= area.y + area.h + 1))) return null;
      bg = f; texts.length = 0; // painted over everything listed before it
      continue;
    }
    return null; // a picture, an icon, a divider, a card edge…: keep the pixels
  }
  return { bg, texts };
}

function runOf(n: TextNode, b: R, cell: R, brand: Brand): LiveTextRun {
  const c = resolveColor(n.color, brand) || '#111111';
  return {
    text: n.text, x: Math.round(b.x - cell.x), y: Math.round(b.y - cell.y), w: Math.round(b.w), h: Math.round(b.h),
    font: fontStack(familyOf(n, brand)), size: n.fontSize, weight: n.fontWeight, italic: n.italic, color: /^#[0-9a-f]{6}$/i.test(c) ? c : '#111111',
    align: n.align, lineHeight: n.lineHeight, letterSpacing: n.letterSpacing, underline: n.underline,
  };
}

/** Text layers that belong to one paragraph: lines and style runs of the same size and family, stacked or side by
 *  side with less than ~one line of gap. Union-find over the text layers. */
function paragraphs(texts: { n: TextNode; b: R }[]): Map<Node, { n: TextNode; b: R }[]> {
  const parent = texts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const A = texts[i], B = texts[j];
    if (Math.abs(A.n.fontSize - B.n.fontSize) > 0.5 || A.n.fontFamily !== B.n.fontFamily) continue;
    const lh = A.n.fontSize * Math.max(A.n.lineHeight, B.n.lineHeight);
    const sameLine = Math.abs(A.b.y - B.b.y) < A.n.fontSize * 0.5 && (A.b.x < B.b.x ? B.b.x - (A.b.x + A.b.w) : A.b.x - (B.b.x + B.b.w)) < A.n.fontSize * 1.5;
    const stacked = A.b.x < B.b.x + B.b.w && B.b.x < A.b.x + A.b.w && (A.b.y < B.b.y ? B.b.y - (A.b.y + A.b.h) : A.b.y - (B.b.y + B.b.h)) < lh * 0.6;
    if (sameLine || stacked) parent[find(i)] = find(j);
  }
  const groups = new Map<number, { n: TextNode; b: R }[]>();
  texts.forEach((t, i) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), t]); });
  const out = new Map<Node, { n: TextNode; b: R }[]>();
  for (const g of groups.values()) for (const t of g) out.set(t.n, g);
  return out;
}

/** Carve full-width bands that hold only plain copy on a flat background out of a bigger slice (a section mixing
 *  pictures and paragraphs): each paragraph band becomes its own row, cut in the empty background around it.
 *  Returns the row's bands top to bottom, or null when no band can go live. */
function carveBands(row: SliceRow, leaves: Leaf[], doc: Doc, brand: Brand): { y: number; h: number; live: boolean }[] | null {
  const W = doc.width, top = row.y, bot = row.y + row.h;
  const here = leaves.filter(({ b }) => b.y < bot && b.y + b.h > top);
  const isCover = (n: Node, b: R) => n.type === 'rect' && b.x <= 0.5 && b.x + b.w >= W - 0.5 && !!flatFill(n, brand) && !(n.radius || (n.radii && n.radii.some((v) => v > 0))) && !n.shadow;
  const bands: [number, number][] = [];
  const paraOf = paragraphs(here.filter(({ n }) => n.type === 'text').map(({ n, b }) => ({ n: n as TextNode, b })));
  for (const { n, b } of here) {
    if (n.type !== 'text' || !liveable(n) || b.y < top - 0.5 || b.y + b.h > bot + 0.5) continue;
    // start from the whole paragraph (its part inside this row): its lines go live together
    const para = (paraOf.get(n) || [{ n, b }]).filter((m) => m.b.y >= top - 0.5 && m.b.y + m.b.h <= bot + 0.5);
    if (para.some((m) => !liveable(m.n))) continue;
    let a = Math.min(b.y, ...para.map((m) => m.b.y)), z = Math.max(b.y + b.h, ...para.map((m) => m.b.y + m.b.h)), ok = true;
    for (let pass = 0; pass < 6 && ok; pass++) {
      let grew = false;
      for (const o of here) {
        if (o.b.y >= z || o.b.y + o.b.h <= a) continue; // not in the band
        if (o.n.type === 'text' && liveable(o.n)) { if (o.b.y < a - 0.5 || o.b.y + o.b.h > z + 0.5) { a = Math.min(a, o.b.y); z = Math.max(z, o.b.y + o.b.h); grew = true; } continue; }
        if (isCover(o.n, o.b) && o.b.y <= a + 0.5 && o.b.y + o.b.h >= z - 0.5) continue; // the band's background
        ok = false; break; // a picture, a card edge, display type, a decoration…
      }
      if (!grew) break;
    }
    if (ok && a >= top - 0.5 && z <= bot + 0.5) bands.push([Math.max(top, a), Math.min(bot, z)]);
  }
  if (!bands.length) return null;
  bands.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const bd of bands) { const last = merged[merged.length - 1]; if (last && bd[0] <= last[1] + 1) last[1] = Math.max(last[1], bd[1]); else merged.push([...bd]); }
  // breathe into the empty background on both sides (half the gap, ≤ 24px), so the cut never grazes a neighbour
  const others = here.filter(({ n, b }) => !(isCover(n, b)) && !merged.some(([a, z]) => b.y >= a - 0.5 && b.y + b.h <= z + 0.5));
  for (const m of merged) {
    const above = Math.max(top, ...others.filter(({ b }) => b.y + b.h <= m[0] + 0.5).map(({ b }) => b.y + b.h));
    const below = Math.min(bot, ...others.filter(({ b }) => b.y >= m[1] - 0.5).map(({ b }) => b.y));
    m[0] = Math.round(Math.max(above, m[0] - Math.min(24, (m[0] - above) / 2)));
    m[1] = Math.round(Math.min(below, m[1] + Math.min(24, (below - m[1]) / 2)));
  }
  const out: { y: number; h: number; live: boolean }[] = [];
  let y = top;
  for (const [a0, z] of merged) {
    let a = a0;
    if (a - y >= 2) out.push({ y, h: a - y, live: false }); // the picture part above
    else if (out.length) out[out.length - 1].h += a - y; // a sliver: the previous band takes it
    else a = y; // a sliver at the top: the live band starts at the row's top
    out.push({ y: a, h: z - a, live: true }); y = z;
  }
  if (bot - y >= 2) out.push({ y, h: bot - y, live: false }); else if (out.length) out[out.length - 1].h += bot - y;
  return out.filter((b) => b.h > 0);
}

/** Mark (and where useful, cut out) the slices that go out as live text. Keys are renumbered; the plan is copied. */
export function applyLiveText(plan: SlicePlan, doc: Doc, brand: Brand): SlicePlan {
  liveBrand = brand;
  const leaves = leavesOf(doc, brand);
  const rows: SliceRow[] = [];
  for (const row of plan.rows) {
    const only = row.cells.length === 1 ? row.cells[0] : null;
    const bands = only && only.keep === undefined ? carveBands(row, leaves, doc, brand) : null;
    if (only && bands && bands.length > 1) { for (const b of bands) rows.push({ y: b.y, h: b.h, cells: [{ ...only, y: b.y, h: b.h }] }); continue; }
    rows.push({ ...row, cells: row.cells.map((c) => ({ ...c })) });
  }
  const paraOf = paragraphs(leaves.filter(({ n }) => n.type === 'text').map(({ n, b }) => ({ n: n as TextNode, b })));
  let index = 0; const slices: Slice[] = [];
  rows.forEach((row, ri) => row.cells.forEach((c, ci) => {
    c.key = `r${ri}c${ci}`; c.index = index++; delete c.text;
    if (c.keep === undefined) {
      const area = { x: c.x, y: c.y, w: c.w, h: c.h };
      const got = contentOf(area, leaves, doc, brand);
      if (got) c.text = { bg: got.bg, runs: got.texts.map((t) => runOf(t, bounds(t), area, brand)) } satisfies LiveText;
    }
    slices.push(c);
  }));
  // one font per paragraph in every inbox: a paragraph with any line left as a picture puts its live lines back too
  const sliceOf = (b: R) => slices.find((c) => b.x + b.w / 2 >= c.x && b.x + b.w / 2 < c.x + c.w && b.y + b.h / 2 >= c.y && b.y + b.h / 2 < c.y + c.h);
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    for (const para of new Set(paraOf.values())) {
      const homes = para.map((m) => sliceOf(m.b));
      if (homes.every((c) => c?.text) || homes.every((c) => !c?.text)) continue;
      for (const c of homes) if (c?.text) { delete c.text; changed = true; }
    }
  }
  return { ...plan, rows, slices };
}

/** Google Fonts stylesheet for the families live text uses (clients that support web fonts show the design face). */
export function liveFontLinks(plans: (SlicePlan | null | undefined)[]): string[] {
  const fams = new Set<string>();
  for (const p of plans) for (const s of p?.slices || []) for (const r of s.text?.runs || []) { const m = /^'([^']+)'/.exec(r.font); if (m) fams.add(m[1]); }
  const specs = [...fams].map((f) => FONTS.find((x) => x.family === f)?.google).filter(Boolean);
  return specs.length ? [`https://fonts.googleapis.com/css2?${specs.map((s) => `family=${s}`).join('&')}&display=swap`] : [];
}

/** Why each small text layer can or cannot go live (dev checks). */
export function explainLive(doc: Doc, brand: Brand): { text: string; size: number; why: string }[] {
  liveBrand = brand;
  const leaves = leavesOf(doc, brand);
  const out: { text: string; size: number; why: string }[] = [];
  for (const { n, b } of leaves) {
    if (n.type !== 'text' || n.fontSize > MAX_LIVE) continue;
    const t = n.text.replace(/\s+/g, ' ').slice(0, 40);
    if (!liveable(n)) { out.push({ text: t, size: n.fontSize, why: `layer: ${n.effect ? 'effect ' : ''}${n.rotate ? 'rotate ' : ''}${n.blur ? 'blur ' : ''}${n.opacity < 0.99 ? `opacity ${n.opacity} ` : ''}${n.anim ? 'anim ' : ''}${n.strike ? 'strike' : ''}${n.fontWeight >= 700 ? `bold ${n.fontWeight} ` : ''}${familyOf(n, brand)}` }); continue; }
    const blockers = leaves.filter((o) => o.n !== n && o.b.y < b.y + b.h && o.b.y + o.b.h > b.y && !(o.n.type === 'text' && liveable(o.n)) && !(o.n.type === 'rect' && o.b.x <= 0.5 && o.b.x + o.b.w >= doc.width - 0.5 && flatFill(o.n, brand) && !(o.n.radius || (o.n.radii && o.n.radii.some((v) => v > 0))) && !o.n.shadow && o.b.y <= b.y + 0.5 && o.b.y + o.b.h >= b.y + b.h - 0.5));
    out.push({ text: t, size: n.fontSize, why: blockers.length ? `band: ${blockers.slice(0, 3).map((o) => `${o.n.type}:${o.n.name.slice(0, 24)}${o.n.type === 'rect' ? (flatFill(o.n, brand) ? '' : ' (not flat)') : ''}`).join(', ')}` : 'ok' });
  }
  return out;
}
