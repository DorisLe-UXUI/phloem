// HTML/CSS → Phloem layers. Claude designs an email the way a front-end designer would (free layout, real CSS); the
// browser lays it out in a hidden iframe, and every painted box, text run, photo, icon and SVG becomes an editable
// layer (rect / text / image / group per section). What Phloem renders afterwards is what gets exported, so the
// conversion reproduces geometry exactly: text baselines from font metrics, wraps from the browser's own line boxes,
// clipping from overflow:hidden, stacking from z-index.
import type { Anim, AnimKind, Color, Doc, GradStop, GroupNode, ImageNode, Node, Radii, RectNode, Shadow, TextEffect, TextNode } from '../model/types';
import { DEFAULT_BRAND, FONTS, uid } from '../model/types';
import { layoutText } from '../render/textLayout';
import { ensureFonts } from '../render/fonts';
import { renderToCanvas } from '../render/renderer';
import { assets } from '../storage/assets';
import { colorSvg, iconSvg, iconUrl, vectorAsset } from '../design/vector';
import { genSvg, svgDataUrl } from '../design/generators';
import { fluent3dSync, fluent3dUrl } from '../design/library';

export interface ConvertOptions {
  width: number;
  /** Library images the HTML may reference with data-img="…" (or src="…id"). */
  validIds: Set<string>;
  /** Called with a short status while converting (fonts, icons, layers). */
  onStage?: (m: string) => void;
  /** Keep generated graphics out of the library until the design is chosen (assets.persist). Default true. */
  temp?: boolean;
}
export interface Converted { doc: Doc; fonts: string[]; warnings: string[]; overflow: number; sections: number }

const ANIMS = new Set<AnimKind>(['fade', 'up', 'down', 'left', 'right', 'pop', 'wipe', 'marquee', 'type', 'pulse', 'float', 'spin', 'shake', 'blink']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'WBR', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'SOURCE']);
const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'PICTURE']);

// ---------------------------------------------------------------------------------------------------------------
// Prepare: sanitise, wire library images and icons, load fonts.

/** Families from the Phloem font list that the HTML mentions (so the iframe and the canvas load the same files). */
export function fontsIn(html: string): string[] {
  const low = html.toLowerCase();
  return FONTS.filter((f) => f.google && low.includes(f.family.toLowerCase())).map((f) => f.family);
}

/** Pull the HTML document out of a model reply (```html fences, or the first <!doctype / <html / <div …). */
export function extractHtml(text: string): string {
  const fenced = /```html\s*([\s\S]*?)(```|$)/i.exec(text);
  let h = fenced ? fenced[1] : text;
  const start = h.search(/<!doctype html|<html[\s>]|<head[\s>]|<style[\s>]|<body[\s>]|<div[\s>]|<table[\s>]|<main[\s>]|<section[\s>]/i);
  if (start > 0) h = h.slice(start);
  return h.trim();
}

/** The HTML as rendered in previews and in the converter: no scripts/handlers, library images and icons resolved,
 *  Phloem's fonts linked, wrapping forced greedy so line breaks match the canvas layout. */
export function prepareHtml(html: string, validIds: Set<string>, width: number): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link[rel="stylesheet"], link[rel="preconnect"], base, meta[http-equiv]').forEach((e) => e.remove());
  doc.querySelectorAll('*').forEach((el) => { for (const a of [...el.attributes]) if (/^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); });
  doc.querySelectorAll('img').forEach((img) => {
    const id = img.getAttribute('data-img') || (validIds.has(img.getAttribute('src') || '') ? img.getAttribute('src') : null);
    if (id && validIds.has(id)) { img.setAttribute('data-img', id); const u = assets.url(id); if (u) img.setAttribute('src', u); else img.removeAttribute('src'); return; }
    const icon = img.getAttribute('data-icon');
    if (icon && /^[a-z0-9-]+:[a-z0-9-]+$/.test(icon)) { img.setAttribute('src', iconUrl(icon)); return; }
    const gfx = img.getAttribute('data-gfx');
    if (gfx) { const g = genSvg(gfx, colorsOf(img), seedOf(img)); if (g) { img.setAttribute('src', svgDataUrl(g)); return; } }
    const st = img.getAttribute('data-sticker');
    if (st) { const idx = fluent3dSync(); const u = idx && fluent3dUrl(idx, st.trim().toLowerCase().replace(/[\s_]+/g, '-')); if (u) { img.setAttribute('src', u); img.setAttribute('crossorigin', 'anonymous'); return; } }
    const src = img.getAttribute('src') || '';
    if (!/^(data:image\/|blob:)/i.test(src)) { img.setAttribute('data-missing', '1'); img.removeAttribute('src'); }
  });
  const fams = fontsIn(html);
  const specs = fams.map((f) => FONTS.find((x) => x.family === f)?.google).filter(Boolean);
  const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
  if (specs.length) { const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?${specs.map((s) => `family=${s}`).join('&')}&display=block`; head.prepend(l); }
  const st = doc.createElement('style');
  st.textContent = `html,body{margin:0!important;padding:0!important;width:${width}px;-webkit-text-size-adjust:none}*{text-wrap-style:auto!important;-webkit-font-smoothing:antialiased;animation:none!important;transition:none!important}::-webkit-scrollbar{display:none}`;
  head.appendChild(st);
  if (!doc.querySelector('meta[charset]')) { const m = doc.createElement('meta'); m.setAttribute('charset', 'utf-8'); head.prepend(m); }
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

const colorsOf = (el: Element) => (el.getAttribute('data-colors') || '').split(/[\s,]+/).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
const seedOf = (el: Element) => Math.abs(parseInt(el.getAttribute('data-seed') || '7', 10)) || 7;

/** Lay the HTML out in a hidden same-origin iframe (no scripts) and resolve once fonts and images settled. */
async function mount(html: string, width: number): Promise<HTMLIFrameElement> {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-same-origin');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = `position:fixed;left:-${width + 4000}px;top:0;width:${width}px;height:1200px;border:0;opacity:0;pointer-events:none;z-index:-1`;
  const loaded = new Promise<void>((res) => { f.onload = () => res(); });
  f.srcdoc = html;
  document.body.appendChild(f);
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))]);
  const d = f.contentDocument!;
  void d.body?.offsetHeight; // kick layout so web fonts start loading
  await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 6000))]);
  await Promise.all([...d.images].map((im) => (im.complete ? Promise.resolve() : new Promise<void>((r) => { im.onload = im.onerror = () => r(); setTimeout(r, 6000); }))));
  await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
  await new Promise((r) => setTimeout(r, 60));
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// CSS value helpers

const cssCtx = (() => { let c: CanvasRenderingContext2D | null = null; return () => (c ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true })!); })();
const colorCache = new Map<string, { r: number; g: number; b: number; a: number } | null>();
/** Any CSS colour (rgb/rgba/hex/hsl/oklch/named) → rgba numbers; null for transparent or unparsable. */
function rgba(css: string): { r: number; g: number; b: number; a: number } | null {
  const k = css.trim(); if (!k || k === 'transparent' || k === 'none') return null;
  if (colorCache.has(k)) return colorCache.get(k)!;
  let out: { r: number; g: number; b: number; a: number } | null = null;
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(k);
  if (m) { const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); out = { r: +m[1], g: +m[2], b: +m[3], a }; }
  else {
    // anything else: let the canvas paint one pixel and read it back
    const c = cssCtx(); c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = k; c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data; out = { r, g, b, a: a / 255 };
  }
  if (out && out.a <= 0.003) out = null;
  colorCache.set(k, out);
  return out;
}
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const toHex = (c: { r: number; g: number; b: number }) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase();
/** Colour for a layer: opaque → #RRGGBB, translucent → rgba() (the renderer paints both). */
function colorOf(css: string): string | null { const c = rgba(css); if (!c) return null; return c.a >= 0.999 ? toHex(c) : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+c.a.toFixed(3)})`; }

/** Split on commas that are not inside parentheses. */
function splitTop(s: string, sep = ','): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Split on whitespace outside parentheses ("rgb(1, 2, 3) 40%" → ["rgb(1, 2, 3)", "40%"]). */
function splitSpace(s: string): string[] { return splitTop(s.replace(/\s+/g, ' '), ' ').filter(Boolean); }
const px = (v: string | null | undefined) => { const n = parseFloat(v || ''); return Number.isFinite(n) ? n : 0; };
const isColorTok = (t: string) => /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|^#|^transparent$|^[a-z]+$/i.test(t) && !/^(to|at|circle|ellipse|closest|farthest|left|right|top|bottom|center|deg|turn|rad)/i.test(t);

interface Grad { kind: 'linear' | 'radial'; angle: number; stops: { color: string; at: number }[]; cx?: number; cy?: number; r?: number }

/** One CSS gradient → Phloem gradient (linear angle in canvas terms: 0 = left→right). */
function parseGradient(fn: string, w: number, h: number): Grad | null {
  const m = /^(repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)$/i.exec(fn.trim()); if (!m) return null;
  const kind = m[2].toLowerCase();
  let args = splitTop(m[3]);
  let angle = 90, cx: number | undefined, cy: number | undefined, r: number | undefined, lenPx = 0;
  const first = args[0] || '';
  if (!isColorTok(splitSpace(first)[0] || '')) {
    args = args.slice(1);
    if (kind === 'linear') {
      const a = /(-?[\d.]+)(deg|turn|rad|grad)/.exec(first);
      if (a) { const v = parseFloat(a[1]); angle = a[2] === 'turn' ? v * 360 : a[2] === 'rad' ? (v * 180) / Math.PI : a[2] === 'grad' ? v * 0.9 : v; }
      else if (/^to /.test(first)) {
        const t = /top/.test(first), b = /bottom/.test(first), l = /left/.test(first), rt = /right/.test(first);
        if ((t || b) && (l || rt)) { const dx = rt ? h : -h, dy = b ? w : -w; angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90; }
        else angle = t ? 0 : b ? 180 : l ? 270 : 90;
      }
    } else if (kind === 'radial') {
      const at = /at\s+(.+)$/.exec(first);
      const pos = (v: string, size: number) => (v === 'left' || v === 'top' ? 0 : v === 'right' || v === 'bottom' ? 1 : v === 'center' ? 0.5 : v.endsWith('%') ? parseFloat(v) / 100 : px(v) / size);
      if (at) { const p = splitSpace(at[1]); cx = pos(p[0] || 'center', w); cy = pos(p[1] || 'center', h); }
      const size = (at ? first.slice(0, at.index) : first).trim();
      const sizes = splitSpace(size).filter((x) => /^[\d.]+(px|%)$/.test(x));
      const ccx = (cx ?? 0.5) * w, ccy = (cy ?? 0.5) * h;
      if (sizes.length) {
        const rx = sizes[0].endsWith('%') ? (parseFloat(sizes[0]) / 100) * w : px(sizes[0]);
        const ry = sizes[1] ? (sizes[1].endsWith('%') ? (parseFloat(sizes[1]) / 100) * h : px(sizes[1])) : rx;
        r = Math.sqrt(rx * ry) / Math.max(w, h);
      } else if (/closest-side/.test(size)) r = Math.min(ccx, w - ccx, ccy, h - ccy) / Math.max(w, h);
      else if (/farthest-side/.test(size)) r = Math.max(ccx, w - ccx, ccy, h - ccy) / Math.max(w, h);
      else if (/closest-corner/.test(size)) r = Math.min(Math.hypot(ccx, ccy), Math.hypot(w - ccx, ccy), Math.hypot(ccx, h - ccy), Math.hypot(w - ccx, h - ccy)) / Math.max(w, h);
    }
  }
  if (kind === 'linear') { const A = (angle * Math.PI) / 180; lenPx = Math.abs(w * Math.sin(A)) + Math.abs(h * Math.cos(A)); }
  else lenPx = (r ?? Math.max(Math.hypot((cx ?? 0.5) * w, (cy ?? 0.5) * h), Math.hypot(w - (cx ?? 0.5) * w, h - (cy ?? 0.5) * h)) / Math.max(w, h)) * Math.max(w, h);
  const raw: { color: string; at: number | null }[] = [];
  for (const a of args) {
    const parts = splitSpace(a); if (!parts.length) continue;
    const col = colorOf(parts[0]) ?? 'rgba(0,0,0,0)';
    const posOf = (t: string) => (t.endsWith('%') ? parseFloat(t) / 100 : lenPx ? px(t) / lenPx : 0);
    if (parts.length >= 3) { raw.push({ color: col, at: posOf(parts[1]) }); raw.push({ color: col, at: posOf(parts[2]) }); }
    else raw.push({ color: col, at: parts[1] ? posOf(parts[1]) : null });
  }
  if (raw.length < 2) return null;
  // CSS fills missing positions evenly between known ones; the first defaults to 0, the last to 1
  if (raw[0].at == null) raw[0].at = 0;
  if (raw[raw.length - 1].at == null) raw[raw.length - 1].at = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].at != null) { raw[i].at = Math.max(raw[i].at!, raw[i - 1].at!); continue; }
    let j = i; while (raw[j].at == null) j++;
    const a0 = raw[i - 1].at!, a1 = raw[j].at!;
    for (let k = i; k < j; k++) raw[k].at = a0 + ((a1 - a0) * (k - i + 1)) / (j - i + 1);
  }
  const stops = raw.map((s) => ({ color: s.color, at: Math.max(0, Math.min(1, s.at!)) }));
  if (kind === 'conic') return { kind: 'linear', angle: 0, stops: [stops[0], stops[stops.length - 1]] }; // nearest we can paint
  return { kind: kind === 'radial' ? 'radial' : 'linear', angle: angle - 90, stops, cx, cy, r };
}

function parseShadow(css: string): Shadow | null {
  if (!css || css === 'none') return null;
  for (const one of splitTop(css)) {
    if (/\binset\b/.test(one)) continue;
    const parts = splitSpace(one);
    const colTok = parts.find((p) => isColorTok(p) && !/^[\d.-]/.test(p));
    const nums = parts.filter((p) => /^-?[\d.]+px$|^0$/.test(p)).map(px);
    const c = colTok ? rgba(colTok) : { r: 0, g: 0, b: 0, a: 1 };
    if (!c || c.a <= 0.01) continue;
    const [x = 0, y = 0, blur = 0] = nums;
    if (!blur && !x && !y) continue;
    return { x: Math.round(x), y: Math.round(y), blur: Math.round(blur), color: toHex(c), opacity: +c.a.toFixed(3) };
  }
  return null;
}

function cornerRadii(cs: CSSStyleDeclaration, w: number, h: number): { radius: number; radii: Radii | null } {
  const one = (v: string) => { const t = splitSpace(v)[0] || '0'; return t.endsWith('%') ? (parseFloat(t) / 100) * Math.min(w, h) * (w === h ? 1 : 1) : px(t); };
  const pctAware = (v: string, side: number) => { const t = splitSpace(v)[0] || '0'; return t.endsWith('%') ? (parseFloat(t) / 100) * side : px(t); };
  const tl = Math.min(pctAware(cs.borderTopLeftRadius, w), pctAware(cs.borderTopLeftRadius.split(' ')[1] || cs.borderTopLeftRadius, h));
  void one;
  const tr = Math.min(pctAware(cs.borderTopRightRadius, w), pctAware(cs.borderTopRightRadius.split(' ')[1] || cs.borderTopRightRadius, h));
  const br = Math.min(pctAware(cs.borderBottomRightRadius, w), pctAware(cs.borderBottomRightRadius.split(' ')[1] || cs.borderBottomRightRadius, h));
  const bl = Math.min(pctAware(cs.borderBottomLeftRadius, w), pctAware(cs.borderBottomLeftRadius.split(' ')[1] || cs.borderBottomLeftRadius, h));
  const cap = Math.min(w, h) / 2;
  const r = [tl, tr, br, bl].map((v) => Math.round(Math.min(v, cap) * 10) / 10) as Radii;
  if (r.every((v) => v === r[0])) return { radius: r[0], radii: null };
  return { radius: Math.max(...r), radii: r };
}

function transformOf(cs: CSSStyleDeclaration): { angle: number; scale: number } {
  const t = cs.transform; if (!t || t === 'none') return { angle: 0, scale: 1 };
  const m = /matrix(3d)?\(([^)]+)\)/.exec(t); if (!m) return { angle: 0, scale: 1 };
  const v = m[2].split(',').map((x) => parseFloat(x));
  const a = v[0], b = v[1];
  return { angle: (Math.atan2(b, a) * 180) / Math.PI, scale: Math.hypot(a, b) || 1 };
}

function filterBlur(cs: CSSStyleDeclaration): number { const m = /blur\(([\d.]+)px\)/.exec(cs.filter || ''); return m ? +m[1] : 0; }

/** Phloem font family for a CSS font-family list. */
function familyOf(list: string): string {
  for (const raw of list.split(',')) {
    const f = raw.trim().replace(/^["']|["']$/g, '');
    const hit = FONTS.find((x) => x.family.toLowerCase() === f.toLowerCase());
    if (hit) return hit.family;
    if (/^(serif|ui-serif|times)/i.test(f)) return 'Georgia';
    if (/^(monospace|ui-monospace|courier)/i.test(f)) return 'Courier New';
    if (/^(arial|helvetica)/i.test(f)) return 'Helvetica';
  }
  return 'Inter';
}

const metricsCache = new Map<string, { a: number; d: number }>();
/** Font ascent/descent in px (what CSS uses to place the baseline inside a line box). */
function metrics(family: string, weight: number, size: number, italic: boolean): { a: number; d: number } {
  const key = `${family}|${weight}|${italic}`;
  let m = metricsCache.get(key);
  if (!m) {
    const c = cssCtx(); c.font = `${italic ? 'italic ' : ''}${weight} 100px "${family}", Inter, sans-serif`;
    const t = c.measureText('Hg');
    const a = (t as TextMetrics & { fontBoundingBoxAscent?: number }).fontBoundingBoxAscent, d = (t as TextMetrics & { fontBoundingBoxDescent?: number }).fontBoundingBoxDescent;
    m = { a: (a ?? 92) / 100, d: (d ?? 24) / 100 };
    metricsCache.set(key, m);
  }
  return { a: m.a * size, d: m.d * size };
}

// ---------------------------------------------------------------------------------------------------------------
// Conversion

/** Positioned descendants wait for the end of their stacking context (CSS paints them after in-flow content). */
interface Deferred { el: Element; z: number; ctx: Ctx }
interface Ctx { clip: { x: number; y: number; w: number; h: number; radii: Radii } | null; opacity: number; link: string | null; linkAlt?: string; /** one clickable thing (an <a>, or a card with a single link): its layers become one linked group */ scope?: string | null; anim: Anim | null; rot: number; scale: number; name: string | null; defer: Deferred[] | null }

export async function htmlToDoc(rawHtml: string, opt: ConvertOptions): Promise<Converted> {
  const W = opt.width;
  const warnings: string[] = [];
  const fams = fontsIn(rawHtml);
  ensureFonts(fams);
  await Promise.race([Promise.all(fams.flatMap((f) => ['400', '700', '800'].map((w) => document.fonts.load(`${w} 32px "${f}"`).catch(() => [])))), new Promise((r) => setTimeout(r, 5000))]);
  const ids = [...rawHtml.matchAll(/data-img="([^"]+)"/g)].map((m) => m[1]).filter((id) => opt.validIds.has(id));
  await assets.ensure(ids);
  opt.onStage?.('Đang dàn trang…');
  const frame = await mount(prepareHtml(rawHtml, opt.validIds, W), W);
  try {
    const d = frame.contentDocument!, win = frame.contentWindow!;
    let root: HTMLElement = (d.querySelector('[data-email]') as HTMLElement) || (d.getElementById('email') as HTMLElement) || (d.body.firstElementChild as HTMLElement) || d.body;
    const rootBg = colorOf(win.getComputedStyle(root).backgroundColor) || colorOf(win.getComputedStyle(d.body).backgroundColor) || '#FFFFFF';
    const rootStyle = win.getComputedStyle(root);
    // a single wrapper (container table/div) around everything: its children are the sections
    for (let i = 0; i < 4; i++) {
      const kids = [...root.children].filter((k) => !SKIP.has(k.tagName) && win.getComputedStyle(k).display !== 'none') as HTMLElement[];
      if (kids.length === 1 && kids[0].getBoundingClientRect().height >= root.getBoundingClientRect().height * 0.9 && !kids[0].hasAttribute('data-name')) root = kids[0]; else break;
    }
    // the parent page measures and renders: it needs every (family, weight) the layout uses, loaded before any metric
    const pairs = new Set<string>();
    for (const e of [...d.body.querySelectorAll('*')].slice(0, 4000)) { const c = win.getComputedStyle(e); pairs.add(`${/italic/.test(c.fontStyle) ? 'italic ' : ''}${parseInt(c.fontWeight, 10) || 400} 32px "${familyOf(c.fontFamily)}"`); }
    await Promise.race([Promise.all([...pairs].map((f) => document.fonts.load(f).catch(() => []))), new Promise((r2) => setTimeout(r2, 5000))]);
    metricsCache.clear();
    const R = root.getBoundingClientRect();
    const ox = R.left, oy = R.top;
    const temp = opt.temp !== false;
    const overflow = Math.max(0, Math.round(d.documentElement.scrollWidth - W));
    let sink: Node[] = [];
    // link scopes: layers of one clickable thing are grouped and the GROUP carries the link (one slice region, like
    // template buttons), instead of every rect/text being its own linked cell
    const scopeOf = new Map<string, string>(); const scopes = new Map<string, { link: string; alt: string }>();
    const pending: Promise<void>[] = [];
    const sectionEls = [...root.children].filter((k) => !SKIP.has(k.tagName)) as HTMLElement[];

    const push = (node: Node, ctx: Ctx, section: number) => {
      node.opacity = Math.max(0, Math.min(1, +(node.opacity * ctx.opacity).toFixed(3)));
      if (node.opacity < 0.01) return;
      if (ctx.scope && ctx.link) { scopeOf.set(node.id, ctx.scope); if (!scopes.has(ctx.scope)) scopes.set(ctx.scope, { link: ctx.link, alt: ctx.linkAlt || '' }); }
      else if (ctx.link && !node.link) node.link = ctx.link;
      // a linked layer speaks for its link (the slicer reads alt from whatever node owns a linked cell)
      if (node.link && !node.alt && ctx.linkAlt && node.type !== 'text') node.alt = ctx.linkAlt;
      if (ctx.anim && !node.anim) node.anim = { ...ctx.anim };
      // whole pixels: crisp slices, no "half-pixel" warnings (text keeps its measured width, rounded up)
      if (node.type === 'group' || !(node as { rotate?: number }).rotate) {
        if (node.type === 'text') { node.x = Math.round(node.x); node.y = Math.round(node.y); node.w = Math.ceil(node.w); }
        else { const x2 = Math.round(node.x + node.w), y2 = Math.round(node.y + node.h); node.x = Math.round(node.x); node.y = Math.round(node.y); node.w = Math.max(1, x2 - node.x); node.h = Math.max(1, y2 - node.y); }
      }
      sink.push(node); void section;
    };
    const boxOf = (el: Element, ctx: Ctx, cs: CSSStyleDeclaration) => {
      const r = el.getBoundingClientRect();
      if (!ctx.rot) return { x: r.left - ox, y: r.top - oy, w: r.width, h: r.height };
      const he = el as HTMLElement;
      const w = (he.offsetWidth ?? r.width) * ctx.scale, h = (he.offsetHeight ?? r.height) * ctx.scale;
      void cs;
      return { x: r.left - ox + r.width / 2 - w / 2, y: r.top - oy + r.height / 2 - h / 2, w, h };
    };
    const inClip = (b: { x: number; y: number; w: number; h: number }, ctx: Ctx) => {
      const c = ctx.clip; if (!c) return 'in' as const;
      const ix = Math.max(b.x, c.x), iy = Math.max(b.y, c.y), ax = Math.min(b.x + b.w, c.x + c.w), ay = Math.min(b.y + b.h, c.y + c.h);
      if (ax <= ix + 0.5 || ay <= iy + 0.5) return 'out' as const;
      if (ix <= b.x + 0.5 && iy <= b.y + 0.5 && ax >= b.x + b.w - 0.5 && ay >= b.y + b.h - 0.5) return 'in' as const;
      return { x: ix, y: iy, w: ax - ix, h: ay - iy };
    };
    /** A layer that touches a rounded clip at a corner takes that corner's radius (photos in cards). */
    const inherit = (n: { x: number; y: number; w: number; h: number; radius: number; radii?: Radii | null }, ctx: Ctx) => {
      const c = ctx.clip; if (!c || c.radii.every((v) => !v)) return;
      const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
      const L = near(n.x, c.x), T = near(n.y, c.y), Rr = near(n.x + n.w, c.x + c.w), B = near(n.y + n.h, c.y + c.h);
      const own: Radii = n.radii ? [...n.radii] as Radii : [n.radius, n.radius, n.radius, n.radius];
      const next: Radii = [T && L ? Math.max(own[0], c.radii[0]) : own[0], T && Rr ? Math.max(own[1], c.radii[1]) : own[1], B && Rr ? Math.max(own[2], c.radii[2]) : own[2], B && L ? Math.max(own[3], c.radii[3]) : own[3]];
      if (next.every((v) => v === next[0])) { n.radius = next[0]; n.radii = null; } else { n.radii = next; n.radius = Math.max(...next); }
    };
    /** Partially clipped decoration (a circle half outside its card): paint it with Phloem's renderer and crop. */
    const rasterClipped = (n: RectNode, part: { x: number; y: number; w: number; h: number }, ctx: Ctx, section: number) => {
      const k = 2;
      const pad = (n.blur || 0) * 2 + (n.shadow ? n.shadow.blur + Math.abs(n.shadow.y) : 0);
      const mini: Doc = { width: Math.ceil(n.w + pad * 2), height: Math.ceil(n.h + pad * 2), bg: 'rgba(0,0,0,0)', nodes: [{ ...n, x: pad, y: pad, opacity: 1 }] };
      const c = renderToCanvas(mini, DEFAULT_BRAND, assets, k);
      const sx = (part.x - (n.x - pad)) * k, sy = (part.y - (n.y - pad)) * k;
      const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(part.w * k)); out.height = Math.max(1, Math.round(part.h * k));
      const oc = out.getContext('2d')!;
      oc.drawImage(c, -sx, -sy);
      const cl = ctx.clip;
      if (cl && cl.radii.some((v) => v > 0)) {
        // follow the rounded clip exactly (a bottom stripe inside a rounded card bends with the corner)
        oc.globalCompositeOperation = 'destination-in';
        const X = (cl.x - part.x) * k, Y = (cl.y - part.y) * k, Wc = cl.w * k, Hc = cl.h * k, m = Math.min(Wc, Hc) / 2;
        const [a, b2, c2, d2] = cl.radii.map((v) => Math.min(v * k, m));
        oc.beginPath(); oc.moveTo(X + a, Y); oc.lineTo(X + Wc - b2, Y); oc.arcTo(X + Wc, Y, X + Wc, Y + b2, b2); oc.lineTo(X + Wc, Y + Hc - c2); oc.arcTo(X + Wc, Y + Hc, X + Wc - c2, Y + Hc, c2); oc.lineTo(X + d2, Y + Hc); oc.arcTo(X, Y + Hc, X, Y + Hc - d2, d2); oc.lineTo(X, Y + a); oc.arcTo(X, Y, X + a, Y, a); oc.closePath();
        oc.fillStyle = '#000'; oc.fill();
      }
      const img: ImageNode = { id: uid('n'), type: 'image', name: n.name, x: part.x, y: part.y, w: part.w, h: part.h, visible: true, locked: false, opacity: n.opacity, link: null, alt: '', assetId: null, fit: 'fill', radius: 0, fill: null, overlay: null, decor: true };
      push(img, ctx, section);
      pending.push(new Promise<void>((res) => out.toBlob(async (b) => { if (b) { try { img.assetId = (await assets.add(b, `${n.name}.png`, { src: { kind: 'graphic' }, temp })).id; } catch { /* keep empty */ } } res(); }, 'image/png')));
    };
    /** Replace each scope's layers by one linked group (at the first member's place in the stacking order). */
    const wrapScopes = (list: Node[]): Node[] => {
      const members = new Map<string, Node[]>();
      for (const n of list) { const sc = scopeOf.get(n.id); if (sc) members.set(sc, [...(members.get(sc) || []), n]); }
      const out: Node[] = []; const done = new Set<string>();
      for (const n of list) {
        const sc = scopeOf.get(n.id);
        if (!sc) { out.push(n); continue; }
        if (done.has(sc)) continue; done.add(sc);
        const kids = members.get(sc)!; const info = scopes.get(sc)!;
        if (kids.length === 1) { const k = kids[0]; k.link = info.link; if (!k.alt && k.type !== 'text') k.alt = info.alt; out.push(k); continue; }
        const g = group(`Link · ${(info.alt || info.link).slice(0, 40)}`, kids);
        g.link = info.link; g.alt = info.alt;
        out.push(g);
      }
      return out;
    };
    const pushRect = (n: RectNode, ctx: Ctx, section: number) => {
      if (ctx.rot) { n.rotate = Math.round(ctx.rot * 10) / 10; push(n, ctx, section); return; }
      const st = inClip(n, ctx);
      if (st === 'out') return;
      if (st === 'in') {
        // touching a rounded clip's corner with less room than that radius: only a raster can bend it right
        const c = ctx.clip, m = Math.min(n.w, n.h) / 2;
        const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
        const bends = !!c && ([[near(n.y, c.y) && near(n.x, c.x), c.radii[0]], [near(n.y, c.y) && near(n.x + n.w, c.x + c.w), c.radii[1]], [near(n.y + n.h, c.y + c.h) && near(n.x + n.w, c.x + c.w), c.radii[2]], [near(n.y + n.h, c.y + c.h) && near(n.x, c.x), c.radii[3]]] as [boolean, number][]).some(([t, rad]) => t && rad > m + 0.5);
        if (bends) { rasterClipped(n, { x: n.x, y: n.y, w: n.w, h: n.h }, ctx, section); return; }
        inherit(n, ctx); push(n, ctx, section); return;
      }
      const simple = !n.blur && !n.shadow && !n.gradient?.radial && (n.radius === 0 && !n.radii);
      if (simple) { Object.assign(n, st); inherit(n, ctx); push(n, ctx, section); return; }
      rasterClipped(n, st, ctx, section);
    };
    /** Show only the visible part of an image layer (same pixels on screen): shrink the frame, zoom and shift the focal point. */
    const cropTo = (n: ImageNode, st: { x: number; y: number; w: number; h: number }, iw: number, ih: number, fx0 = 0.5, fy0 = 0.5) => {
      const R0 = n.fit === 'contain' ? Math.min(n.w / iw, n.h / ih) : n.fit === 'fill' ? 0 : Math.max(n.w / iw, n.h / ih);
      if (!R0) { // stretched art: keep its aspect by treating the frame itself as the image
        const zoom = 1 / Math.max(st.w / n.w, st.h / n.h);
        const fx = Math.abs(st.w - n.w) < 0.5 ? 0.5 : (n.x - st.x) / (st.w - n.w), fy = Math.abs(st.h - n.h) < 0.5 ? 0.5 : (n.y - st.y) / (st.h - n.h);
        if (Math.abs(n.w / n.h - iw / ih) > 0.02) { Object.assign(n, st); return; } // distorted on purpose: plain crop
        n.fit = 'cover'; Object.assign(n, st); n.crop = { zoom: Math.max(1, Math.min(6, zoom)), fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) }; return;
      }
      const dw = iw * R0, dh = ih * R0;
      const ox0 = n.x + (n.w - dw) * fx0, oy0 = n.y + (n.h - dh) * fy0;
      const base = n.fit === 'contain' ? Math.min(st.w / iw, st.h / ih) : Math.max(st.w / iw, st.h / ih);
      const zoom = R0 / base;
      const fx = Math.abs(st.w - dw) < 0.5 ? 0.5 : (ox0 - st.x) / (st.w - dw), fy = Math.abs(st.h - dh) < 0.5 ? 0.5 : (oy0 - st.y) / (st.h - dh);
      Object.assign(n, st);
      n.crop = { zoom: Math.max(1, Math.min(6, zoom)), fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) };
    };
    const rectBase = (name: string, b: { x: number; y: number; w: number; h: number }): RectNode => ({ id: uid('n'), type: 'rect', name, x: b.x, y: b.y, w: b.w, h: b.h, visible: true, locked: false, opacity: 1, link: null, alt: '', fill: null, gradient: null, stroke: null, radius: 0 });

    /** Background colour + gradient layers + borders + shadow of one box. */
    const paintBox = (el: Element, cs: CSSStyleDeclaration, b: { x: number; y: number; w: number; h: number }, ctx: Ctx, section: number, name: string) => {
      if (b.w < 0.5 || b.h < 0.5) return;
      const { radius, radii } = cornerRadii(cs, b.w, b.h);
      const fill = colorOf(cs.backgroundColor);
      const layers = cs.backgroundImage && cs.backgroundImage !== 'none' ? splitTop(cs.backgroundImage).map((g) => parseGradient(g, b.w, b.h)).filter((g): g is Grad => !!g) : [];
      if (cs.backgroundImage && /url\(/.test(cs.backgroundImage) && !layers.length) warnings.push('Ảnh nền CSS (url) không được hỗ trợ: dùng <img data-img>.');
      const shadow = parseShadow(cs.boxShadow);
      const blur = filterBlur(cs);
      const bws = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
      const bcs = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(colorOf);
      const styles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
      const has = bws.map((w, i) => w > 0 && styles[i] !== 'none' && styles[i] !== 'hidden' && !!bcs[i]);
      const uniform = has.every((x) => x) && bws.every((w) => w === bws[0]) && bcs.every((c) => c === bcs[0]);
      const base = (): RectNode => ({ ...rectBase(name, b), radius, radii, ...(blur ? { blur } : {}) });
      const nodes: RectNode[] = [];
      // frosted glass (backdrop-filter: blur) on the bottom-most layer of this box
      const bf = /blur\(([\d.]+)px\)/.exec((cs as unknown as Record<string, string>).backdropFilter || (cs as unknown as Record<string, string>).webkitBackdropFilter || '');
      if (bf && +bf[1] > 0) nodes.push({ ...base(), name: `${name} · kính mờ`, backdropBlur: +bf[1], fill: null });
      if (fill) nodes.push({ ...base(), fill });
      for (const g of layers.slice().reverse()) {
        const stops: GradStop[] = g.stops.map((s) => ({ color: s.color, at: s.at }));
        nodes.push({ ...base(), name: `${name} · gradient`, gradient: { from: stops[0].color, to: stops[stops.length - 1].color, angle: Math.round(g.angle * 10) / 10, radial: g.kind === 'radial', stops, ...(g.cx != null ? { cx: g.cx } : {}), ...(g.cy != null ? { cy: g.cy } : {}), ...(g.r != null ? { r: g.r } : {}) } });
      }
      if (shadow) { if (nodes.length) nodes[0].shadow = shadow; else if (uniform) nodes.push({ ...base(), fill: null, shadow }); }
      if (uniform) {
        const top = nodes[nodes.length - 1];
        if (top && !top.gradient) top.stroke = { color: bcs[0]!, width: bws[0] };
        else nodes.push({ ...base(), name: `${name} · viền`, fill: null, stroke: { color: bcs[0]!, width: bws[0] } });
      }
      for (const n of nodes) pushRect(n, ctx, section);
      if (!uniform) {
        // single sides: dividers and accent bars
        const sides: [number, { x: number; y: number; w: number; h: number }][] = [
          [0, { x: b.x, y: b.y, w: b.w, h: bws[0] }], [1, { x: b.x + b.w - bws[1], y: b.y, w: bws[1], h: b.h }],
          [2, { x: b.x, y: b.y + b.h - bws[2], w: b.w, h: bws[2] }], [3, { x: b.x, y: b.y, w: bws[3], h: b.h }],
        ];
        for (const [i, sb] of sides) if (has[i]) {
          const line = { ...rectBase(`${name} · kẻ`, sb), fill: bcs[i]! };
          if (styles[i] === 'dashed' || styles[i] === 'dotted') line.opacity = 0.7;
          pushRect(line, ctx, section);
        }
      }
      void el;
    };

    /** Text: one layer per paragraph when it is one style; per line run when styles mix (highlighted words). */
    const styleKey = (cs: CSSStyleDeclaration) => [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.color, cs.letterSpacing, cs.textDecorationLine, cs.textTransform, cs.textShadow, (cs as unknown as Record<string, string>).webkitTextStrokeWidth].join('|');
    const isPureInline = (el: Element, cs: CSSStyleDeclaration) => cs.display === 'inline' && !REPLACED.has(el.tagName.toUpperCase());
    const textOf = (s: string, tt: string) => (tt === 'uppercase' ? s.toLocaleUpperCase('vi') : tt === 'lowercase' ? s.toLocaleLowerCase('vi') : tt === 'capitalize' ? s.replace(/(^|\s)(\S)/g, (m, a, c) => a + c.toLocaleUpperCase('vi')) : s);
    const effectOf = (cs: CSSStyleDeclaration): TextEffect | null => {
      const stroke = px((cs as unknown as Record<string, string>).webkitTextStrokeWidth);
      const fillC = rgba((cs as unknown as Record<string, string>).webkitTextFillColor || cs.color);
      if (stroke > 0 && (!fillC || fillC.a < 0.05)) return { kind: 'outline' };
      if (cs.textShadow && cs.textShadow !== 'none') {
        const parts = splitTop(cs.textShadow);
        const sh = parts.map((p) => { const t = splitSpace(p); const c = t.find((x) => isColorTok(x) && !/^[\d.-]/.test(x)); const n = t.filter((x) => /^-?[\d.]+px$/.test(x)).map(px); return { c: c ? colorOf(c) : null, x: n[0] || 0, y: n[1] || 0, b: n[2] || 0 }; });
        const glow = sh.find((s) => s.b >= 6 && Math.abs(s.x) <= 2 && Math.abs(s.y) <= 2);
        if (glow && glow.c) return { kind: 'neon', color: glow.c };
        if (parts.length >= 3 && sh.every((s) => s.b <= 1)) { const last = sh[sh.length - 1]; return { kind: 'extrude', color: last.c || undefined, depth: Math.round(Math.hypot(last.x, last.y)), angle: Math.round((Math.atan2(last.y, last.x) * 180) / Math.PI) }; }
        const flat = sh.find((s) => s.b <= 2 && (s.x || s.y));
        if (flat && flat.c) return { kind: 'shadow', color: flat.c, depth: Math.round(Math.hypot(flat.x, flat.y)), angle: Math.round((Math.atan2(flat.y, flat.x) * 180) / Math.PI) };
      }
      return null;
    };
    const mkText = (cs: CSSStyleDeclaration, text: string, x: number, firstLineTop: number, w: number, align: TextNode['align'], lines: number, ctx: Ctx): TextNode | null => {
      const size = px(cs.fontSize); if (!size || !text.trim()) return null;
      const family = familyOf(cs.fontFamily);
      const weight = parseInt(cs.fontWeight, 10) || 400, italic = /italic|oblique/.test(cs.fontStyle);
      const met = metrics(family, weight, size, italic);
      const lhPx = cs.lineHeight === 'normal' ? met.a + met.d : px(cs.lineHeight);
      const c = rgba(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
      // CSS: baseline = line top + (lineHeight − (ascent+descent))/2 + ascent. Phloem: node.y + (lineHeight − size)/2 + 0.78·size.
      const baseline = firstLineTop + (lhPx - (met.a + met.d)) / 2 + met.a;
      const y = baseline - (lhPx - size) / 2 - 0.78 * size;
      const n: TextNode = {
        id: uid('n'), type: 'text', name: text.replace(/\s+/g, ' ').trim().slice(0, 32) || 'Text', x, y, w, h: lines * lhPx, visible: true, locked: false, opacity: c.a, link: null, alt: '',
        text, fontFamily: family, fontSize: Math.round(size * 10) / 10, fontWeight: weight, italic, underline: /underline/.test(cs.textDecorationLine), strike: /line-through/.test(cs.textDecorationLine),
        color: toHex(c), align, lineHeight: +(lhPx / size).toFixed(3), letterSpacing: cs.letterSpacing === 'normal' ? 0 : Math.round(px(cs.letterSpacing) * 100) / 100, autoHeight: true, vAlign: 'top',
      };
      const fx = effectOf(cs); if (fx) n.effect = fx;
      if (ctx.rot) n.rotate = Math.round(ctx.rot * 10) / 10;
      return n;
    };
    const lineRects = (rects: DOMRect[], size: number) => {
      const lines: { top: number; left: number; right: number; bottom: number }[] = [];
      for (const r of rects) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const L = lines.find((l) => Math.abs(l.top - r.top) < size * 0.45 || (r.top < l.bottom - size * 0.3 && r.bottom > l.top + size * 0.3));
        if (L) { L.left = Math.min(L.left, r.left); L.right = Math.max(L.right, r.right); L.top = Math.min(L.top, r.top); L.bottom = Math.max(L.bottom, r.bottom); }
        else lines.push({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
      }
      return lines.sort((a, b) => a.top - b.top);
    };
    const alignOf = (cs: CSSStyleDeclaration): TextNode['align'] => (/center/.test(cs.textAlign) ? 'center' : /right|end/.test(cs.textAlign) ? 'right' : 'left');

    const textRuns = (el: Element): Text[] => {
      const out: Text[] = [];
      const walk = (n: Node | ChildNode) => {
        for (const ch of [...(n as Element).childNodes]) {
          if (ch.nodeType === 3) { if ((ch as Text).data.trim()) out.push(ch as Text); }
          else if (ch.nodeType === 1) { const e = ch as Element; if (SKIP.has(e.tagName.toUpperCase())) continue; const cs = win.getComputedStyle(e); if (cs.display === 'none') continue; if (isPureInline(e, cs)) walk(e); }
        }
      };
      walk(el as unknown as Node);
      return out;
    };
    const linkOf = (el: Element | null, stop: Element): string | null => {
      for (let e: Element | null = el; e && e !== stop.parentElement; e = e.parentElement) if (e.tagName === 'A') { const h = e.getAttribute('href') || ''; if (h && !/^#|^javascript:/i.test(h)) return h; }
      return null;
    };

    const doText = (el: Element, cs: CSSStyleDeclaration, ctx: Ctx, section: number) => {
      const runs = textRuns(el);
      if (!runs.length) return;
      const parents = new Set(runs.map((t) => t.parentElement!));
      const keys = new Set([...parents].map((p) => styleKey(win.getComputedStyle(p))));
      // inline boxes (highlight / pill spans) paint under their words
      const inlineBoxes: Element[] = [];
      const collect = (e: Element) => { for (const ch of [...e.children]) { const c2 = win.getComputedStyle(ch); if (c2.display === 'none') continue; if (isPureInline(ch, c2)) { inlineBoxes.push(ch); collect(ch); } } };
      collect(el);
      let padded = false;
      for (const ib of inlineBoxes) {
        const c2 = win.getComputedStyle(ib);
        if (px(c2.paddingLeft) + px(c2.paddingRight) + px(c2.marginLeft) + px(c2.marginRight) + px(c2.borderLeftWidth) > 0.5) padded = true;
        const paints = colorOf(c2.backgroundColor) || (c2.backgroundImage && c2.backgroundImage !== 'none') || px(c2.borderTopWidth) + px(c2.borderBottomWidth) > 0 || (c2.boxShadow && c2.boxShadow !== 'none');
        if (paints) for (const r of [...ib.getClientRects()]) paintBox(ib, c2, { x: r.left - ox, y: r.top - oy, w: r.width, h: r.height }, { ...ctx, link: linkOf(ib, el) || ctx.link }, section, ib.tagName.toLowerCase());
      }
      const hasBlockKids = [...el.children].some((k) => { const c2 = win.getComputedStyle(k); return c2.display !== 'none' && !isPureInline(k, c2) && !SKIP.has(k.tagName.toUpperCase()); });
      const one = keys.size === 1 && !padded && !hasBlockKids;
      if (one || ctx.rot) {
        const pcs = win.getComputedStyle(runs[0].parentElement!);
        const size = px(pcs.fontSize);
        const range = d.createRange();
        const rects: DOMRect[] = [];
        for (const t of runs) { range.selectNodeContents(t); rects.push(...range.getClientRects()); }
        const lines = lineRects(rects, size);
        if (!lines.length) return;
        // innerText = what the browser shows (collapsed spaces, <br> as newlines, text-transform applied)
        const tt = (hasBlockKids ? textOf(runs.map((t) => t.data).join(' '), pcs.textTransform) : ((el as HTMLElement).innerText ?? el.textContent ?? '')).replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').trim();
        const align = alignOf(cs);
        let nLines = lines.length;
        let left = Math.min(...lines.map((l) => l.left)) - ox, right = Math.max(...lines.map((l) => l.right)) - ox;
        let top = lines[0].top - oy;
        if (ctx.rot) {
          // rotated: rects are rotated; place an unrotated box of the element's content size around the same centre
          const b = boxOf(el, ctx, cs);
          const pl = px(cs.paddingLeft) * ctx.scale, pr = px(cs.paddingRight) * ctx.scale, pt = px(cs.paddingTop) * ctx.scale, pb = px(cs.paddingBottom) * ctx.scale;
          left = b.x + pl; right = b.x + b.w - pr;
          const met = metrics(familyOf(pcs.fontFamily), parseInt(pcs.fontWeight, 10) || 400, size, /italic/.test(pcs.fontStyle));
          const lhPx = pcs.lineHeight === 'normal' ? met.a + met.d : px(pcs.lineHeight);
          const inner = b.h - pt - pb; nLines = Math.max(1, Math.round(inner / lhPx));
          top = b.y + pt + (inner - nLines * lhPx) / 2 + (lhPx - (met.a + met.d)) / 2;
        }
        const width = Math.max(4, right - left);
        const slack = 2;
        let w = width + slack;
        let x = align === 'center' ? (left + right) / 2 - w / 2 : align === 'right' ? right - w : left;
        if (!ctx.rot && !hasBlockKids) {
          // room to edit: grow the box to the paragraph's content box wherever that keeps every line where it is
          const r0 = el.getBoundingClientRect();
          const cl = r0.left - ox + px(cs.borderLeftWidth) + px(cs.paddingLeft), cr = r0.right - ox - px(cs.borderRightWidth) - px(cs.paddingRight);
          if (cr - cl > w) {
            if (align === 'left' && Math.abs(left - cl) <= 1.5) { x = cl; w = cr - cl; }
            else if (align === 'right' && Math.abs(right - cr) <= 1.5) { x = cl; w = cr - cl; }
            else if (align === 'center' && Math.abs((left + right) / 2 - (cl + cr) / 2) <= 1.5) { x = cl; w = cr - cl; }
          }
        }
        // line top (CSS line box) from the run's content-area top
        const met = metrics(familyOf(pcs.fontFamily), parseInt(pcs.fontWeight, 10) || 400, size, /italic|oblique/.test(pcs.fontStyle));
        const lhPx = pcs.lineHeight === 'normal' ? met.a + met.d : px(pcs.lineHeight);
        const lineTop = ctx.rot ? top : top - (lhPx - (met.a + met.d)) / 2;
        const n = mkText(pcs, tt, x, lineTop, w, align, nLines, ctx);
        if (!n) return;
        // our wrap must not add lines the browser did not: widen a little until it matches
        const want = nLines;
        for (let i = 0; i < 12 && layoutText(n, DEFAULT_BRAND).lines.length > want; i++) { const grow = Math.max(2, n.w * 0.01); n.w += grow; if (align === 'center') n.x -= grow / 2; else if (align === 'right') n.x -= grow; }
        n.h = layoutText(n, DEFAULT_BRAND).height;
        const l = linkOf(runs[0].parentElement, el); if (l) n.link = l;
        push(n, ctx, section);
        return;
      }
      // mixed styles: one layer per (line, style) run, placed from each character's box
      const range = d.createRange();
      type Frag = { text: string; left: number; right: number; top: number; el: Element };
      const frags: Frag[] = [];
      for (const t of runs) {
        const pe = t.parentElement!; const pcs = win.getComputedStyle(pe); const size = px(pcs.fontSize);
        let cur: Frag | null = null;
        for (let i = 0; i < t.data.length; i++) {
          range.setStart(t, i); range.setEnd(t, i + 1);
          const rs = range.getClientRects(); if (!rs.length) continue;
          const r = rs[0]; const ch = t.data[i];
          if (r.width < 0.01 && /\s/.test(ch)) continue;
          if (cur && Math.abs(r.top - cur.top) < size * 0.45 && r.left >= cur.right - size * 0.6) { cur.text += /\s/.test(ch) ? ' ' : ch; cur.right = Math.max(cur.right, r.right); }
          else { if (cur) frags.push(cur); cur = { text: /\s/.test(ch) ? ' ' : ch, left: r.left, right: r.right, top: r.top, el: pe }; }
        }
        if (cur) frags.push(cur);
      }
      for (const f of frags) {
        const pcs = win.getComputedStyle(f.el);
        const lead = f.text.length - f.text.trimStart().length;
        const txt = f.text.trim(); if (!txt) continue;
        const size = px(pcs.fontSize);
        const met = metrics(familyOf(pcs.fontFamily), parseInt(pcs.fontWeight, 10) || 400, size, /italic|oblique/.test(pcs.fontStyle));
        const lhPx = pcs.lineHeight === 'normal' ? met.a + met.d : px(pcs.lineHeight);
        // character box top = baseline − ascent → back to the CSS line top for mkText's formula
        const lineTop = f.top - oy - (lhPx - (met.a + met.d)) / 2;
        const spaceW = lead ? cssCtx().measureText(' ').width : 0; void spaceW;
        const n = mkText(pcs, textOf(txt, pcs.textTransform), f.left - ox + (lead ? 0 : 0), lineTop, f.right - f.left + 3, 'left', 1, ctx);
        if (!n) continue;
        if (lead) { // skip the leading space's width: measure it in the run's font
          const c = cssCtx(); c.font = `${n.italic ? 'italic ' : ''}${n.fontWeight} ${n.fontSize}px "${n.fontFamily}"`; n.x += c.measureText(' ').width + n.letterSpacing;
        }
        const l = linkOf(f.el, el); if (l) n.link = l;
        n.h = layoutText(n, DEFAULT_BRAND).height;
        push(n, ctx, section);
      }
    };

    const doImage = (el: HTMLImageElement, cs: CSSStyleDeclaration, ctx: Ctx, section: number) => {
      const b = boxOf(el, ctx, cs);
      if (b.w < 1 || b.h < 1) return;
      const { radius, radii } = cornerRadii(cs, b.w, b.h);
      const base: ImageNode = { id: uid('n'), type: 'image', name: el.getAttribute('data-name') || el.alt || 'Ảnh', x: b.x, y: b.y, w: b.w, h: b.h, visible: true, locked: false, opacity: 1, link: null, alt: el.alt || '', assetId: null, fit: 'cover', radius, radii, fill: null, overlay: null };
      const sh = parseShadow(cs.boxShadow); if (sh) base.shadow = sh;
      const blur = filterBlur(cs); if (blur) base.blur = blur;
      if (ctx.rot) base.rotate = Math.round(ctx.rot * 10) / 10;
      // an icon or photo inside a link speaks for it: alt = the link's words when the image has none
      if (!base.alt) { const a = el.closest('a'); const words = ((a as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim(); if (words) base.alt = words.slice(0, 80); else if (a) base.alt = (a.getAttribute('aria-label') || a.getAttribute('title') || '').slice(0, 80); }
      const fitCss = cs.objectFit;
      base.fit = fitCss === 'contain' || fitCss === 'scale-down' ? 'contain' : fitCss === 'fill' ? 'fill' : 'cover';
      const id = el.getAttribute('data-img');
      const icon = el.getAttribute('data-icon');
      if (id && opt.validIds.has(id)) {
        base.assetId = id;
        const a = assets.get(id);
        const pos = splitSpace(cs.objectPosition || '50% 50%');
        const pct = (v: string | undefined) => (v && v.endsWith('%') ? parseFloat(v) / 100 : 0.5);
        let fx = pct(pos[0]), fy = pct(pos[1]);
        if (!ctx.rot && ctx.clip) {
          const st = inClip(base, ctx);
          if (st === 'out') return;
          if (st !== 'in' && a && base.fit === 'cover') { cropTo(base, st, a.w, a.h, fx, fy); fx = base.crop!.fx; fy = base.crop!.fy; }
          else if (st !== 'in') Object.assign(base, st);
          inherit(base, ctx);
        }
        if (!base.crop && (Math.abs(fx - 0.5) > 0.01 || Math.abs(fy - 0.5) > 0.01)) base.crop = { zoom: 1, fx, fy };
        push(base, ctx, section);
        return;
      }
      if (icon && /^[a-z0-9-]+:[a-z0-9-]+$/.test(icon)) {
        const c = rgba(cs.color); const color = c ? toHex(c) : null;
        base.fit = 'contain'; base.name = icon.split(':')[1]; base.alt = el.alt || base.alt;
        base.vector = { svg: '', color, kind: icon.startsWith('fluent-emoji') ? 'sticker' : 'icon' };
        if (ctx.clip && !ctx.rot) { const st = inClip(base, ctx); if (st === 'out') return; if (st !== 'in') cropTo(base, st, base.w, base.h); }
        push(base, ctx, section);
        pending.push(iconSvg(icon).then(async (svg) => { base.vector!.svg = svg; base.assetId = (await vectorAsset(svg, b.w, b.h, base.name, color, temp)).id; }).catch(() => { warnings.push(`Icon ${icon} không tồn tại`); base.visible = false; }));
        return;
      }
      const gfx = el.getAttribute('data-gfx');
      if (gfx) {
        // procedural graphic, redrawn at its real size (patterns stay crisp) and kept editable (palette / variant)
        const pal = colorsOf(el), seed = seedOf(el);
        const svg = genSvg(gfx, pal, seed, b.w, b.h);
        if (svg) {
          base.fit = 'fill'; base.name = el.getAttribute('data-name') || `Đồ hoạ ${gfx}`; base.decor = true; base.vector = { svg, color: null, kind: 'graphic', gen: { id: gfx, seed, palette: pal } };
          if (ctx.clip && !ctx.rot) { const st = inClip(base, ctx); if (st === 'out') return; if (st !== 'in') cropTo(base, st, b.w, b.h); }
          push(base, ctx, section);
          pending.push(vectorAsset(svg, b.w, b.h, base.name, null, temp).then((a) => { base.assetId = a.id; }).catch(() => { base.visible = false; }));
          return;
        }
      }
      const sticker = el.getAttribute('data-sticker');
      if (sticker && el.currentSrc) {
        base.fit = 'contain'; base.name = `${sticker} 3D`; base.decor = !base.alt;
        if (ctx.clip && !ctx.rot) { const st = inClip(base, ctx); if (st === 'out') return; }
        push(base, ctx, section);
        const src = el.currentSrc;
        pending.push((async () => { try { const blob = await (await fetch(src)).blob(); base.assetId = (await assets.add(blob, base.name, { src: { kind: 'graphic' }, temp })).id; } catch { base.visible = false; warnings.push(`Không tải được vật thể 3D "${sticker}"`); } })());
        return;
      }
      if (el.getAttribute('data-missing')) { warnings.push('Ảnh ngoài (URL) bị bỏ: chỉ dùng ảnh trong thư viện.'); return; }
      const src = el.currentSrc || el.src;
      if (src) {
        push(base, ctx, section);
        pending.push((async () => { try { const blob = await (await fetch(src)).blob(); base.assetId = (await assets.add(blob, `${base.name}.png`, { src: { kind: 'graphic' }, temp })).id; } catch { base.visible = false; } })());
      }
    };

    const SVG_PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stop-color', 'stop-opacity', 'fill-rule', 'clip-rule'];
    const doSvg = (el: SVGSVGElement, cs: CSSStyleDeclaration, ctx: Ctx, section: number) => {
      const b = boxOf(el, ctx, cs);
      if (b.w < 1 || b.h < 1) return;
      const clone = el.cloneNode(true) as SVGSVGElement;
      const src = [el, ...el.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
      src.forEach((s, i) => {
        const t = dst[i] as Element; if (!t) return;
        const c = win.getComputedStyle(s as Element);
        for (const p of SVG_PROPS) {
          const v = c.getPropertyValue(p).trim(); if (!v) continue;
          if (p === 'fill' || p === 'stroke') t.setAttribute(p, /^url\(/.test(v) ? v.replace(/^url\(["']?[^#"']*(#[^"')]+)["']?\)$/, 'url($1)') : (colorOf(v) ?? 'none'));
          else if (p === 'stop-color') t.setAttribute(p, colorOf(v) ?? 'transparent');
          else if (v !== 'none' && v !== 'normal') t.setAttribute(p, v);
        }
        t.removeAttribute('class'); t.removeAttribute('style');
      });
      const w0 = el.getAttribute('width'), h0 = el.getAttribute('height');
      if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${px(w0) || b.w} ${px(h0) || b.h}`);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const svg = new XMLSerializer().serializeToString(clone);
      const node: ImageNode = { id: uid('n'), type: 'image', name: el.getAttribute('data-name') || 'Đồ hoạ', x: b.x, y: b.y, w: b.w, h: b.h, visible: true, locked: false, opacity: 1, link: null, alt: '', assetId: null, fit: 'fill', radius: 0, fill: null, overlay: null, vector: { svg, color: null, kind: 'graphic' } };
      const blur = filterBlur(cs); if (blur) node.blur = blur;
      if (ctx.rot) node.rotate = Math.round(ctx.rot * 10) / 10;
      else if (ctx.clip) { const st = inClip(node, ctx); if (st === 'out') return; if (st !== 'in') { const bw = node.w, bh = node.h; cropTo(node, st, bw, bh); } }
      push(node, ctx, section);
      pending.push(vectorAsset(svg, b.w, b.h, node.name, null, temp).then((a) => { node.assetId = a.id; }).catch(() => { warnings.push('Một SVG không vẽ được.'); node.visible = false; }));
    };

    const visit = (el: Element, ctx0: Ctx, section: number, asContext = false) => {
      const tag = el.tagName.toUpperCase();
      if (SKIP.has(tag)) return;
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return;
      const op = parseFloat(cs.opacity); if (op < 0.01) return;
      const positioned = cs.position !== 'static';
      const z = cs.zIndex !== 'auto' ? parseInt(cs.zIndex, 10) || 0 : 0;
      // CSS painting order: a positioned element paints after the in-flow content of its stacking context
      if (positioned && !asContext && ctx0.defer) { ctx0.defer.push({ el, z, ctx: ctx0 }); return; }
      if (positioned || asContext) {
        const outer = sink; const mine: Node[] = []; sink = mine;
        const defer: Deferred[] = [];
        const bgEnd = { n: 0 };
        visitBody(el, cs, { ...ctx0, defer }, section, bgEnd);
        sink = outer;
        const run = (list: Deferred[]) => { const keep = sink; const out: Node[] = []; sink = out; for (const d0 of list) visit(d0.el, d0.ctx, section, true); sink = keep; return out; };
        const neg = defer.filter((d0) => d0.z < 0).sort((a, b) => a.z - b.z), rest = defer.filter((d0) => d0.z >= 0).sort((a, b) => a.z - b.z);
        sink.push(...mine.slice(0, bgEnd.n), ...run(neg), ...mine.slice(bgEnd.n), ...run(rest));
        return;
      }
      visitBody(el, cs, ctx0, section, null);
    };
    const visitBody = (el: Element, cs: CSSStyleDeclaration, ctx0: Ctx, section: number, bgEnd: { n: number } | null) => {
      const tag = el.tagName.toUpperCase();
      const op = parseFloat(cs.opacity);
      const tf = transformOf(cs);
      const da = (el as HTMLElement).dataset?.anim as AnimKind | undefined;
      const anim: Anim | null = da && ANIMS.has(da) ? { kind: da, delay: Math.max(0, parseFloat((el as HTMLElement).dataset.delay || '0') || 0), dur: Math.max(0.1, parseFloat((el as HTMLElement).dataset.dur || '') || (['pulse', 'shake', 'blink'].includes(da) ? 1.2 : ['float', 'spin'].includes(da) ? 2.4 : 0.8)) } : ctx0.anim;
      const href = tag === 'A' ? el.getAttribute('href') : null;
      const linkAlt = href ? (((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80) || (el.querySelector('img[alt]') as HTMLImageElement | null)?.alt || '') : undefined;
      const ctx: Ctx = { ...ctx0, opacity: ctx0.opacity * op, rot: ctx0.rot + tf.angle, scale: ctx0.scale * tf.scale, anim, link: href && !/^#|^javascript:/i.test(href) ? href : ctx0.link, ...(href ? { linkAlt } : {}), name: el.getAttribute('data-name') };
      if (href && !/^#|^javascript:/i.test(href) && !(ctx0.scope && ctx0.link === href)) ctx.scope = uid('k');
      // a card (or section) whose only destination is one link is clickable as a whole: one slice instead of thin strips
      if (!ctx.link && tag !== 'A' && !isPureInline(el, cs)) {
        const anchors = [...el.querySelectorAll('a[href]')].filter((a) => { const h = a.getAttribute('href') || ''; return h && !/^#|^javascript:/i.test(h); });
        const hrefs = new Set(anchors.map((a) => a.getAttribute('href')));
        const r0 = el.getBoundingClientRect();
        const boxed = !!colorOf(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none') || px(cs.borderTopWidth) + px(cs.borderBottomWidth) > 0 || (cs.boxShadow && cs.boxShadow !== 'none') || el.parentElement === root;
        if (hrefs.size === 1 && boxed && r0.height <= 760 && !/\*\|/.test([...hrefs][0] || '')) {
          const a0 = anchors[0] as HTMLElement;
          ctx.link = [...hrefs][0]!; ctx.scope = uid('k');
          ctx.linkAlt = (a0.innerText || a0.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80) || ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        }
      }
      if (tag === 'IMG') { doImage(el as HTMLImageElement, cs, ctx, section); return; }
      if (tag === 'SVG' || el instanceof (win as unknown as { SVGSVGElement: typeof SVGSVGElement }).SVGSVGElement) { doSvg(el as SVGSVGElement, cs, ctx, section); return; }
      if (tag === 'PICTURE') { const im = el.querySelector('img'); if (im) visit(im, ctx, section, true); return; }
      if (REPLACED.has(tag)) return;
      if (!isPureInline(el, cs)) paintBox(el, cs, boxOf(el, ctx, cs), ctx, section, ctx.name || el.getAttribute('class')?.split(/\s+/)[0] || tag.toLowerCase());
      if (bgEnd) bgEnd.n = sink.length;
      // overflow clip for everything inside
      let inner = ctx;
      if (!ctx.rot && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && tag !== 'BODY' && tag !== 'HTML') {
        const r = el.getBoundingClientRect();
        const box = { x: r.left - ox + px(cs.borderLeftWidth), y: r.top - oy + px(cs.borderTopWidth), w: r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth), h: r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) };
        const cr = cornerRadii(cs, r.width, r.height);
        const radii: Radii = cr.radii ? cr.radii : [cr.radius, cr.radius, cr.radius, cr.radius];
        const prev = ctx.clip;
        const clip = prev ? (() => { const ix = Math.max(box.x, prev.x), iy = Math.max(box.y, prev.y); return { x: ix, y: iy, w: Math.max(0, Math.min(box.x + box.w, prev.x + prev.w) - ix), h: Math.max(0, Math.min(box.y + box.h, prev.y + prev.h) - iy), radii }; })() : { ...box, radii };
        inner = { ...ctx, clip };
      }
      doText(el, cs, inner, section);
      // pure-inline wrappers were handled as text (and their boxes); anything laid out inside them still paints itself
      const kids = (e: Element, c: Ctx) => {
        for (const ch of [...e.children]) {
          if (SKIP.has(ch.tagName.toUpperCase())) continue;
          const c2 = win.getComputedStyle(ch);
          if (isPureInline(ch, c2)) { const h2 = ch.tagName === 'A' ? ch.getAttribute('href') : null; kids(ch, h2 && !/^#|^javascript:/i.test(h2) ? { ...c, link: h2, linkAlt: (ch as HTMLElement).innerText?.replace(/\s+/g, ' ').trim().slice(0, 80), scope: c.scope && c.link === h2 ? c.scope : uid('k') } : c); }
          else visit(ch, c, section);
        }
      };
      kids(el, inner);
    };

    const base: Ctx = { clip: null, opacity: 1, link: null, anim: null, rot: 0, scale: 1, name: null, defer: null };
    opt.onStage?.('Đang tách layer…');
    // the root's own gradient (if any) becomes a background layer under every section
    const bgNodes: Node[] = [];
    if (rootStyle.backgroundImage && rootStyle.backgroundImage !== 'none') { sink = bgNodes; paintBox(root, rootStyle, { x: 0, y: 0, w: W, h: R.height }, base, -1, 'Nền'); }
    const perSection = sectionEls.map((el, i) => {
      const list: Node[] = []; sink = list;
      // every section keeps its full box (transparent frame): padding below the last line survives "hug content"
      const r0 = el.getBoundingClientRect();
      list.push({ ...{ id: uid('n'), type: 'rect' as const, name: 'Khung', x: r0.left - ox, y: r0.top - oy, w: r0.width, h: r0.height, visible: true, locked: false, opacity: 1, link: null, alt: '', fill: null, gradient: null, stroke: null, radius: 0 } });
      visit(el, base, i, true);
      return wrapScopes(list);
    });
    opt.onStage?.('Đang vẽ icon và đồ hoạ…');
    await Promise.all(pending);

    const nodes: Node[] = [];
    if (bgNodes.length) nodes.push(group('Nền', bgNodes));
    sectionEls.forEach((el, i) => {
      const kids = perSection[i].filter((n) => n.visible);
      if (kids.length <= 1) return; // only the empty frame
      const name = el.getAttribute('data-name') || el.getAttribute('aria-label') || (el.querySelector('h1,h2,h3') as HTMLElement | null)?.innerText?.slice(0, 32) || `Phần ${i + 1}`;
      nodes.push(group(name, kids));
    });
    const height = Math.ceil(Math.max(R.height, ...nodes.map((n) => n.y + n.h).filter((v) => Number.isFinite(v)).map((v) => Math.min(v, R.height + 4))));
    const doc: Doc = { width: W, height: Math.max(100, height), bg: rootBg, nodes, autoHeight: true };
    return { doc, fonts: fams, warnings: [...new Set(warnings)], overflow, sections: sectionEls.length };
  } finally {
    frame.remove();
  }
}

function group(name: string, children: Node[]): GroupNode {
  const xs = children.map((c) => c.x), ys = children.map((c) => c.y), x2 = children.map((c) => c.x + c.w), y2 = children.map((c) => c.y + c.h);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { id: uid('g'), type: 'group', name, x, y, w: Math.max(...x2) - x, h: Math.max(...y2) - y, visible: true, locked: false, opacity: 1, link: null, alt: '', children, src: 'html' };
}

/** Exact-colour matches with the palette become brand tokens, so "Thương hiệu" recolours the design later. */
export function tokenize(doc: Doc, palette: Partial<Record<'primary' | 'accent' | 'ink' | 'muted' | 'bg' | 'soft' | 'line' | 'onPrimary', string>>): Doc {
  const map = new Map<string, Color>();
  for (const [k, v] of Object.entries(palette)) if (v && /^#[0-9a-f]{6}$/i.test(v) && !map.has(v.toUpperCase())) map.set(v.toUpperCase(), { token: k as 'primary' });
  const tok = (c: Color | null | undefined): Color | null | undefined => (typeof c === 'string' && map.has(c.toUpperCase()) ? map.get(c.toUpperCase())! : c);
  const walk = (n: Node): Node => {
    if (n.type === 'group') return { ...n, children: n.children.map(walk) };
    if (n.type === 'text') return { ...n, color: tok(n.color) ?? n.color };
    if (n.type === 'rect') return { ...n, fill: tok(n.fill) ?? null, stroke: n.stroke ? { ...n.stroke, color: tok(n.stroke.color) ?? n.stroke.color } : null, gradient: n.gradient ? { ...n.gradient, from: tok(n.gradient.from) ?? n.gradient.from, to: tok(n.gradient.to) ?? n.gradient.to, stops: n.gradient.stops?.map((s) => ({ ...s, color: tok(s.color) ?? s.color })) ?? null } : null };
    return n;
  };
  return { ...doc, bg: tok(doc.bg) ?? doc.bg, nodes: doc.nodes.map(walk) };
}

/** Recolouring helper for previews: an icon's SVG in a colour. */
export { colorSvg };
