// Canvas renderer: one code path for the editor artboard, project thumbnails and slice export.
import type { Anim, Brand, Color, Doc, ImageNode, Node, Radii, RectNode, TextNode } from '../model/types';
import { LOOP_CYCLE, LOOP_KINDS, loopPeriod, resolveColor } from '../model/types';
import { layoutText } from './textLayout';

export interface ImageSource { image(id: string): HTMLImageElement | ImageBitmap | undefined }

export interface RenderOptions {
  scale: number;
  /** Offset in device pixels where the artboard's (0,0) lands. */
  ox?: number;
  oy?: number;
  /** Draw placeholders (editor) or plain fill (export). */
  editor?: boolean;
  /** Skip these node ids (e.g. while editing text in an overlay). */
  skip?: Set<string>;
  /** Animation time in seconds; undefined = final (static) state. */
  t?: number;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
/** Progress 0..1 of an entrance animation at time t (undefined → finished). */
export function animProgress(a: Anim | null | undefined, t: number | undefined): number {
  if (!a || t === undefined) return 1;
  const d = a.delay ?? 0, dur = Math.max(0.05, a.dur ?? 0.8);
  return Math.max(0, Math.min(1, (t - d) / dur));
}
/** Total length of one animation cycle for a doc (seconds), plus a hold on the final frame. */
export function animCycle(nodes: Node[]): number {
  let end = 0, loop = false;
  const walk = (list: Node[]) => { for (const n of list) { if (n.anim) { if (LOOP_KINDS.has(n.anim.kind)) loop = true; else end = Math.max(end, (n.anim.delay ?? 0) + (n.anim.dur ?? 0.8)); } if (n.type === 'group') walk(n.children); } };
  walk(nodes);
  // loops alone: one seamless cycle; with entrances: play them, hold, and keep a whole number of loop cycles
  return end > 0 ? (loop ? Math.ceil((end + 1.4) / LOOP_CYCLE) * LOOP_CYCLE : end + 1.4) : loop ? LOOP_CYCLE * 2 : 0;
}
export function hasAnim(nodes: Node[]): boolean { return nodes.some((n) => !!n.anim || (n.type === 'group' && hasAnim(n.children))); }

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (!rad) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Rounded rectangle with one radius per corner (tl, tr, br, bl). */
function rr4(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: Radii) {
  const m = Math.min(w / 2, h / 2);
  const [a, b, c, d] = r.map((v) => Math.max(0, Math.min(v, m)));
  ctx.beginPath();
  ctx.moveTo(x + a, y);
  ctx.lineTo(x + w - b, y); if (b) ctx.arcTo(x + w, y, x + w, y + b, b); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - c); if (c) ctx.arcTo(x + w, y + h, x + w - c, y + h, c); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + d, y + h); if (d) ctx.arcTo(x, y + h, x, y + h - d, d); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + a); if (a) ctx.arcTo(x, y, x + a, y, a); else ctx.lineTo(x, y);
  ctx.closePath();
}
/** The node's outline path at scale s (single radius or per-corner radii). */
function shapePath(ctx: CanvasRenderingContext2D, n: { radius: number; radii?: Radii | null }, x: number, y: number, w: number, h: number, s: number) {
  if (n.radii && n.radii.some((v) => v > 0)) rr4(ctx, x, y, w, h, n.radii.map((v) => v * s) as Radii);
  else rr(ctx, x, y, w, h, n.radius * s);
}

function col(c: Color | null | undefined, brand: Brand): string | null { return resolveColor(c, brand); }

function withShadow(ctx: CanvasRenderingContext2D, sh: { blur: number; y: number; color: string; opacity: number; x?: number } | null | undefined, s: number, draw: () => void) {
  if (!sh || sh.opacity <= 0) { draw(); return; }
  ctx.save();
  const [r, g, b] = hexRgb(sh.color);
  ctx.shadowColor = `rgba(${r},${g},${b},${Math.min(1, sh.opacity)})`; ctx.shadowBlur = sh.blur * s; ctx.shadowOffsetX = (sh.x ?? 0) * s; ctx.shadowOffsetY = sh.y * s;
  draw();
  ctx.restore();
}

function rotated(ctx: CanvasRenderingContext2D, deg: number | undefined, cx: number, cy: number, draw: () => void) {
  if (!deg) { draw(); return; }
  ctx.save(); ctx.translate(cx, cy); ctx.rotate((deg * Math.PI) / 180); ctx.translate(-cx, -cy); draw(); ctx.restore();
}

function drawRect(ctx: CanvasRenderingContext2D, n: RectNode, brand: Brand, s: number) {
  const x = n.x * s, y = n.y * s, w = n.w * s, h = n.h * s;
  if (n.rotate) { rotated(ctx, n.rotate, x + w / 2, y + h / 2, () => drawRect(ctx, { ...n, rotate: 0 }, brand, s)); return; }
  if (n.blur && n.blur > 0) {
    ctx.save();
    try { ctx.filter = `blur(${n.blur * s}px)`; } catch { /* unsupported: drawn sharp */ }
    drawRect(ctx, { ...n, blur: 0 }, brand, s);
    ctx.restore(); return;
  }
  const path = () => shapePath(ctx, n, x, y, w, h, s);
  const fill = col(n.fill, brand);
  const g0 = n.gradient;
  const firstStop = g0 ? (g0.stops && g0.stops.length >= 2 ? g0.stops[0].color : g0.from) : null;
  if (fill) withShadow(ctx, n.shadow, s, () => { path(); ctx.fillStyle = fill; ctx.fill(); });
  else if (n.shadow && g0) withShadow(ctx, n.shadow, s, () => { path(); ctx.fillStyle = col(firstStop, brand) || '#000'; ctx.fill(); });
  if (g0) {
    const stops = g0.stops && g0.stops.length >= 2 ? g0.stops : [{ color: g0.from, at: 0 }, { color: g0.to, at: 1 }];
    let g: CanvasGradient;
    if (g0.radial) {
      const cx = x + w * (g0.cx ?? 0.5), cy = y + h * (g0.cy ?? 0.5);
      const far = Math.max(Math.hypot(cx - x, cy - y), Math.hypot(x + w - cx, cy - y), Math.hypot(cx - x, y + h - cy), Math.hypot(x + w - cx, y + h - cy));
      const rad = g0.r != null ? Math.max(1, g0.r * Math.max(w, h)) : g0.stops ? far : Math.max(w, h) / 2;
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      if (g0.stops && g0.stops.length >= 2) for (const st of stops) g.addColorStop(Math.max(0, Math.min(1, st.at)), col(st.color, brand) || 'rgba(0,0,0,0)');
      else {
        // legacy two-colour glow: a mid stop at 42% keeps the falloff soft instead of plateauing
        const from = g0.from;
        const fromCss = col(from, brand) || 'rgba(0,0,0,0)';
        const mid = typeof from === 'object' ? (col({ token: from.token, alpha: (from.alpha ?? 1) * 0.42 }, brand) || fromCss) : fadeCss(fromCss, 0.42);
        g.addColorStop(0, fromCss); g.addColorStop(0.5, mid); g.addColorStop(1, col(g0.to, brand) || 'rgba(0,0,0,0)');
      }
    } else {
      const cx = x + w / 2, cy = y + h / 2;
      const a = ((g0.angle || 0) * Math.PI) / 180;
      const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
      g = ctx.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
      for (const st of stops) g.addColorStop(Math.max(0, Math.min(1, st.at)), col(st.color, brand) || '#000');
    }
    path(); ctx.fillStyle = g; ctx.fill();
  }
  if (n.stroke && n.stroke.width > 0) {
    const sc = col(n.stroke.color, brand);
    if (sc) {
      const sw = n.stroke.width * s, inset = sw / 2;
      if (n.radii && n.radii.some((v) => v > 0)) rr4(ctx, x + inset, y + inset, w - sw, h - sw, n.radii.map((v) => Math.max(0, v * s - inset)) as Radii);
      else rr(ctx, x + inset, y + inset, w - sw, h - sw, Math.max(0, n.radius * s - inset));
      ctx.strokeStyle = sc; ctx.lineWidth = sw; ctx.stroke();
    }
  }
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a), B = hexRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
/** Multiply a CSS colour's alpha (hex 6/8 digits or rgb/rgba) so radial glows fade smoothly instead of plateauing. */
function fadeCss(c: string, f: number): string {
  const m8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c); if (m8) { const [r, g, b] = hexRgb('#' + m8[1]); return `rgba(${r},${g},${b},${((parseInt(m8[2], 16) / 255) * f).toFixed(3)})`; }
  const m6 = /^#([0-9a-f]{6})$/i.exec(c); if (m6) { const [r, g, b] = hexRgb(c); return `rgba(${r},${g},${b},${f.toFixed(3)})`; }
  const mr = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c); if (mr) return `rgba(${mr[1]},${mr[2]},${mr[3]},${((mr[4] ? +mr[4] : 1) * f).toFixed(3)})`;
  return c;
}
/** Darken an rgb/hex colour by t (0..1) for extrusion sides. */
function shade(c: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(c); if (m) { const [r, g, b] = hexRgb(c).map((v) => Math.round(v * (1 - t))); return `rgb(${r},${g},${b})`; }
  const mm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); if (mm) return `rgb(${Math.round(+mm[1] * (1 - t))},${Math.round(+mm[2] * (1 - t))},${Math.round(+mm[3] * (1 - t))})`;
  return c;
}
function seedOf(id: string): number { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

/** Placeholder "art": a brand-tinted gradient with soft lit shapes, a highlight sweep and a fine grid, so templates look
 *  designed before real photos arrive. Deterministic per node id. */
function drawArt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number, brand: Brand, seed: number, editor: boolean) {
  const r = (k: number) => ((seed >>> (k * 5)) & 31) / 31; // 0..1 pseudo-random per slot
  const light = mix(brand.primary, brand.bg, 0.86), mid = mix(brand.primary, brand.bg, 0.55), deep = mix(brand.primary, brand.accent, 0.35);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, light); g.addColorStop(0.55, mid); g.addColorStop(1, deep);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // soft lit orbs (radial gradients read as blurred shapes)
  for (let i = 0; i < 3; i++) {
    const cx = x + w * (0.15 + 0.7 * r(i)), cy = y + h * (0.2 + 0.6 * r(i + 3)), rad = Math.min(w, h) * (0.22 + 0.3 * r(i + 6));
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const c = i === 2 ? mix(brand.accent, brand.bg, 0.25) : mix(brand.bg, brand.primary, 0.1 + 0.15 * i);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = i === 2 ? 0.55 : 0.75; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
  }
  // diagonal highlight sweep
  ctx.globalAlpha = 0.18;
  const sw = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  sw.addColorStop(0.35, 'rgba(255,255,255,0)'); sw.addColorStop(0.5, 'rgba(255,255,255,0.9)'); sw.addColorStop(0.65, 'rgba(255,255,255,0)');
  ctx.fillStyle = sw; ctx.fillRect(x, y, w, h);
  // thin ring + fine dot grid for texture
  ctx.globalAlpha = 0.22; ctx.strokeStyle = brand.bg; ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.beginPath(); ctx.arc(x + w * (0.7 + 0.2 * r(9)), y + h * (0.3 + 0.3 * r(10)), Math.min(w, h) * 0.28, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.1; ctx.fillStyle = brand.ink;
  const step = 22 * s;
  for (let gx = x + step / 2; gx < x + w; gx += step) for (let gy = y + step / 2; gy < y + h; gy += step) { ctx.beginPath(); ctx.arc(gx, gy, 0.8 * s, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  if (editor && h > 56 * s && w > 120 * s) {
    const label = `Ảnh ${Math.round(w / s)}×${Math.round(h / s)} · kéo ảnh vào`;
    ctx.font = `600 ${11 * s}px Inter, sans-serif`;
    const tw = ctx.measureText(label).width + 16 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, x + w / 2 - tw / 2, y + h / 2 - 11 * s, tw, 22 * s, 11 * s); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
  }
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number, label: string) {
  ctx.save();
  ctx.fillStyle = '#E6EBE7';
  ctx.fillRect(x, y, w, h);
  // diagonal hatch
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1 * s;
  const step = 14 * s;
  ctx.beginPath();
  for (let d = -h; d < w; d += step) { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
  ctx.stroke();
  // icon + label
  const cx = x + w / 2, cy = y + h / 2;
  const sz = Math.min(28 * s, w * 0.3, h * 0.3);
  if (sz > 8) {
    ctx.strokeStyle = '#8A948C'; ctx.lineWidth = 1.5 * s;
    rr(ctx, cx - sz / 2, cy - sz / 2 - 6 * s, sz, sz * 0.8, 3 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - sz / 2 + 4 * s, cy + sz * 0.3 - 6 * s); ctx.lineTo(cx - sz * 0.15, cy - 4 * s); ctx.lineTo(cx + sz * 0.05, cy + sz * 0.1 - 6 * s); ctx.lineTo(cx + sz * 0.2, cy - 2 * s); ctx.lineTo(cx + sz / 2 - 4 * s, cy + sz * 0.3 - 6 * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + sz * 0.22, cy - sz * 0.25 - 6 * s, sz * 0.08, 0, Math.PI * 2); ctx.fillStyle = '#8A948C'; ctx.fill();
    if (h > 60 * s && w > 90 * s) {
      ctx.fillStyle = '#6E786F'; ctx.font = `${11 * s}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(label, cx, cy + sz * 0.5);
    }
  }
  ctx.restore();
}

/** Where the photo lands inside its frame (crop zoom + focal point). Returns frame-relative draw rect. */
export function imageDrawRect(n: ImageNode, iw: number, ih: number): { dx: number; dy: number; dw: number; dh: number } {
  const w = n.w, h = n.h;
  if (n.fit === 'fill') return { dx: 0, dy: 0, dw: w, dh: h };
  const zoom = Math.max(1, Math.min(6, n.crop?.zoom ?? 1));
  const r = (n.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)) * zoom;
  const dw = iw * r, dh = ih * r;
  const fx = n.crop?.fx ?? 0.5, fy = n.crop?.fy ?? 0.5;
  return { dx: (w - dw) * fx, dy: (h - dh) * fy, dw, dh };
}

/** Draw the photo (with crop, flips, overlay) into its frame at scale s; used directly and for the tilt warp. */
function paintImage(ctx: CanvasRenderingContext2D, n: ImageNode, brand: Brand, s: number, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const { dx, dy, dw, dh } = imageDrawRect(n, img.width, img.height);
  ctx.save();
  if (n.flipX || n.flipY) { ctx.translate(x + w / 2, y + h / 2); ctx.scale(n.flipX ? -1 : 1, n.flipY ? -1 : 1); ctx.translate(-(x + w / 2), -(y + h / 2)); }
  if (n.blur && n.blur > 0) {
    // blur bleeds transparent edges inward: draw slightly larger so the frame edge stays filled
    try { ctx.filter = `blur(${n.blur * s}px)`; } catch { /* unsupported */ }
    const grow = n.blur * s * 1.5;
    ctx.drawImage(img, x + dx * s - grow, y + dy * s - grow, dw * s + grow * 2, dh * s + grow * 2);
  } else ctx.drawImage(img, x + dx * s, y + dy * s, dw * s, dh * s);
  ctx.restore();
}

/** Pseudo-3D: paint the finished frame to an offscreen canvas, then redraw it in strips whose height follows the tilt. */
function drawTilted(ctx: CanvasRenderingContext2D, n: ImageNode, brand: Brand, s: number, src: ImageSource, editor: boolean, x: number, y: number, w: number, h: number) {
  const off = document.createElement('canvas'); off.width = Math.max(1, Math.round(w)); off.height = Math.max(1, Math.round(h));
  const oc = off.getContext('2d')!;
  oc.translate(-x, -y);
  drawImage(oc, { ...n, tilt: null, shadow: null, rotate: 0, floatShadow: false }, brand, s, src, editor);
  const ry = n.tilt?.ry || 0, rx = n.tilt?.rx || 0;
  const N = 48;
  if (Math.abs(ry) >= Math.abs(rx)) {
    const k = Math.sin((ry * Math.PI) / 180) * 0.38, cw = Math.cos((ry * Math.PI) / 180);
    const tw = w * (0.86 + 0.14 * cw), x0 = x + (w - tw) / 2, cy = y + h / 2;
    for (let i = 0; i < N; i++) {
      const u = i / N, sw = off.width / N, sx = i * sw;
      const scale = 1 + (u - 0.5) * 2 * k;
      const dh = h * scale, dx = x0 + u * tw;
      ctx.drawImage(off, sx, 0, sw, off.height, dx, cy - dh / 2, tw / N + 1, dh);
    }
  } else {
    const k = Math.sin((rx * Math.PI) / 180) * 0.38, ch = Math.cos((rx * Math.PI) / 180);
    const th = h * (0.86 + 0.14 * ch), y0 = y + (h - th) / 2, cx = x + w / 2;
    for (let i = 0; i < N; i++) {
      const u = i / N, sh = off.height / N, sy = i * sh;
      const scale = 1 - (u - 0.5) * 2 * k;
      const dw = w * scale, dy = y0 + u * th;
      ctx.drawImage(off, 0, sy, off.width, sh, cx - dw / 2, dy, dw, th / N + 1);
    }
  }
}

function drawImage(ctx: CanvasRenderingContext2D, n: ImageNode, brand: Brand, s: number, src: ImageSource, editor: boolean) {
  const x = n.x * s, y = n.y * s, w = n.w * s, h = n.h * s;
  if (n.rotate) { rotated(ctx, n.rotate, x + w / 2, y + h / 2, () => drawImage(ctx, { ...n, rotate: 0 }, brand, s, src, editor)); return; }
  const img = n.assetId ? src.image(n.assetId) : undefined;
  if (n.floatShadow) {
    // elliptical pool of shadow under the frame: a floating cut-out product
    const ew = w * 0.7, eh = Math.max(8 * s, h * 0.11), ecx = x + w / 2, ecy = y + h - eh * 0.25;
    ctx.save(); ctx.translate(ecx, ecy); ctx.scale(1, eh / ew);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ew / 2); g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(0.6, 'rgba(0,0,0,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ew / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (n.tilt && (n.tilt.rx || n.tilt.ry) && img && (img as HTMLImageElement).width) {
    if (!n.shadow) { drawTilted(ctx, n, brand, s, src, editor, x, y, w, h); return; }
    // composite the strips once, then cast a single shadow (per-strip shadows would stack into dark banding)
    const pad = Math.ceil(Math.max(w, h) * 0.3);
    const off = document.createElement('canvas'); off.width = Math.max(1, Math.round(w + pad * 2)); off.height = Math.max(1, Math.round(h + pad * 2));
    const oc = off.getContext('2d')!; oc.translate(pad - x, pad - y);
    drawTilted(oc, { ...n, floatShadow: false }, brand, s, src, editor, x, y, w, h);
    withShadow(ctx, n.shadow, s, () => ctx.drawImage(off, x - pad, y - pad));
    return;
  }
  if (n.shadow) withShadow(ctx, n.shadow, s, () => { shapePath(ctx, n, x, y, w, h, s); ctx.fillStyle = col(n.fill, brand) || (n.vector ? 'rgba(0,0,0,0)' : '#ffffff'); ctx.fill(); });
  ctx.save();
  shapePath(ctx, n, x, y, w, h, s);
  ctx.clip();
  const fill = col(n.fill, brand);
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (img && (img as HTMLImageElement).width) {
    paintImage(ctx, n, brand, s, img as CanvasImageSource & { width: number; height: number }, x, y, w, h);
  } else if (!fill) {
    drawArt(ctx, x, y, w, h, s, brand, seedOf(n.id), editor);
  } else if (editor && h > 40 * s && w > 80 * s) {
    drawPlaceholder(ctx, x, y, w, h, s, `Ảnh ${Math.round(n.w)}×${Math.round(n.h)} · kéo ảnh vào`);
  }
  if (n.overlay && n.overlay.opacity > 0) {
    ctx.globalAlpha = n.overlay.opacity;
    if (n.overlay.gradient) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,0)'); g.addColorStop(1, n.overlay.color); ctx.fillStyle = g; }
    else ctx.fillStyle = n.overlay.color;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, n: TextNode, brand: Brand, s: number) {
  if (n.rotate) { const hh = n.autoHeight ? layoutText(n, brand, ctx, s).height : n.h * s; rotated(ctx, n.rotate, (n.x + n.w / 2) * s, n.y * s + hh / 2, () => drawText(ctx, { ...n, rotate: 0 }, brand, s)); return; }
  const lay = layoutText(n, brand, ctx, s);
  const color = col(n.color, brand) || '#000';
  ctx.save();
  ctx.font = lay.font;
  try { (ctx as any).letterSpacing = `${n.letterSpacing * s}px`; } catch { /* unsupported */ }
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const x = n.x * s, w = n.w * s, h = n.h * s;
  let y0 = n.y * s;
  if (!n.autoHeight) {
    if (n.vAlign === 'middle') y0 += (h - lay.height) / 2;
    else if (n.vAlign === 'bottom') y0 += h - lay.height;
  }
  const ascent = n.fontSize * s * 0.78; // approximate cap baseline inside the line box
  const pad = (lay.lineHeight - n.fontSize * s) / 2;
  const fx = n.effect && n.effect.kind ? n.effect : null;
  const fxColor = fx ? (col(fx.color, brand) || (fx.kind === 'neon' ? color : shade(color, fx.kind === 'extrude' ? 0.45 : 0.25))) : '';
  const depth = fx ? Math.max(1, Math.round((fx.depth ?? (fx.kind === 'shadow' ? 18 : 7)) * s)) : 0;
  const ang = ((fx?.angle ?? 50) * Math.PI) / 180;
  lay.lines.forEach((ln, i) => {
    let lx = x;
    if (n.align === 'center') lx = x + (w - ln.width) / 2;
    else if (n.align === 'right') lx = x + w - ln.width;
    const ly = y0 + i * lay.lineHeight + pad + ascent;
    if (fx?.kind === 'extrude' || fx?.kind === 'shadow') {
      // stacked offset copies read as an extruded block (or one long flat shadow)
      ctx.save(); ctx.fillStyle = fxColor; if (fx.kind === 'shadow') ctx.globalAlpha *= 0.35;
      for (let d = depth; d >= 1; d--) ctx.fillText(ln.text, lx + Math.cos(ang) * d, ly + Math.sin(ang) * d);
      ctx.restore();
    }
    if (fx?.kind === 'neon') { ctx.save(); ctx.shadowColor = fxColor; ctx.shadowBlur = 26 * s; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.fillText(ln.text, lx, ly); ctx.fillText(ln.text, lx, ly); ctx.restore(); }
    if (fx?.kind === 'outline') { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, 1.6 * s); ctx.lineJoin = 'round'; ctx.strokeText(ln.text, lx, ly); ctx.restore(); }
    else ctx.fillText(ln.text, lx, ly);
    if (n.underline && ln.width) { ctx.fillRect(lx, ly + 2 * s, ln.width, Math.max(1, s)); }
    if (n.strike && ln.width) { ctx.fillRect(lx, ly - n.fontSize * s * 0.3, ln.width, Math.max(1, 1.2 * s)); }
  });
  ctx.restore();
}

export function drawNode(ctx: CanvasRenderingContext2D, n: Node, brand: Brand, s: number, src: ImageSource, editor: boolean, skip?: Set<string>, t?: number) {
  if (!n.visible || (skip && skip.has(n.id))) return;
  ctx.save();
  if (n.opacity < 1) ctx.globalAlpha *= n.opacity;
  let node: Node = n;
  if (n.anim && t !== undefined) {
    const a = n.anim; const p = easeOut(animProgress(a, t));
    const cx = (n.x + n.w / 2) * s, cy = (n.y + n.h / 2) * s;
    if (a.kind === 'fade') ctx.globalAlpha *= p;
    else if (a.kind === 'up') { ctx.globalAlpha *= p; ctx.translate(0, (1 - p) * 28 * s); }
    else if (a.kind === 'down') { ctx.globalAlpha *= p; ctx.translate(0, -(1 - p) * 28 * s); }
    else if (a.kind === 'left') { ctx.globalAlpha *= p; ctx.translate(-(1 - p) * 48 * s, 0); }
    else if (a.kind === 'right') { ctx.globalAlpha *= p; ctx.translate((1 - p) * 48 * s, 0); }
    else if (a.kind === 'wipe') { ctx.beginPath(); ctx.rect((n.x - 2) * s, (n.y - 2) * s, (n.w + 4) * s, (n.h + 4) * s * p); ctx.clip(); } // reveal top→bottom: only the new strip changes per frame
    else if (a.kind === 'pop') { const k = p < 1 ? 0.6 + 0.4 * p + (p > 0.6 ? Math.sin((p - 0.6) / 0.4 * Math.PI) * 0.06 : 0) : 1; ctx.globalAlpha *= Math.min(1, p * 1.6); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }
    else if (LOOP_KINDS.has(a.kind) && a.kind !== 'marquee') {
      // seamless loops: t = 0 (and every whole period) is the untouched design
      const per = loopPeriod(a), ph = ((t % per) + per) % per / per;
      if (a.kind === 'pulse') { const k = 1 + 0.07 * Math.sin(ph * Math.PI) ** 2; ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }
      else if (a.kind === 'float') ctx.translate(0, -7 * s * Math.sin(ph * Math.PI * 2));
      else if (a.kind === 'spin') { ctx.translate(cx, cy); ctx.rotate(ph * Math.PI * 2); ctx.translate(-cx, -cy); }
      else if (a.kind === 'shake') { const r = ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI * 4) * 7 * (1 - ph / 0.45) : 0; ctx.translate(cx, cy); ctx.rotate((r * Math.PI) / 180); ctx.translate(-cx, -cy); }
      else if (a.kind === 'blink') ctx.globalAlpha *= 0.3 + 0.7 * (Math.cos(ph * Math.PI * 2) + 1) / 2;
    }
    else if (a.kind === 'type' && n.type === 'text') { const raw = animProgress(a, t); node = { ...n, text: n.text.slice(0, Math.ceil(n.text.length * raw)) + (raw < 1 && Math.floor(t * 3) % 2 === 0 ? '|' : '') }; }
    else if (a.kind === 'marquee' && n.type === 'text') {
      // endless scroll: the line drawn twice, shifted by time
      const lay = layoutText(n, brand, ctx, s); const lineW = Math.max(...lay.lines.map((l) => l.width)) / s + 40;
      const speed = 60; const off = (t * speed) % lineW;
      ctx.save(); ctx.beginPath(); ctx.rect(n.x * s, (n.y - 4) * s, n.w * s, (n.h + 8) * s); ctx.clip();
      const nn = { ...n, w: Math.max(n.w, lineW * 2), align: 'left' as const };
      drawText(ctx, { ...nn, x: n.x - off }, brand, s); drawText(ctx, { ...nn, x: n.x - off + lineW }, brand, s);
      ctx.restore(); ctx.restore(); return;
    }
  }
  switch (node.type) {
    case 'rect': drawRect(ctx, node, brand, s); break;
    case 'image': drawImage(ctx, node, brand, s, src, editor); break;
    case 'text': drawText(ctx, node, brand, s); break;
    case 'group': for (const c of node.children) drawNode(ctx, c, brand, s, src, editor, skip, t); break;
  }
  ctx.restore();
}

export function renderDoc(ctx: CanvasRenderingContext2D, doc: Doc, brand: Brand, src: ImageSource, o: RenderOptions) {
  const s = o.scale;
  ctx.save();
  ctx.translate(o.ox ?? 0, o.oy ?? 0);
  ctx.beginPath(); ctx.rect(0, 0, doc.width * s, doc.height * s); ctx.clip();
  const bg = col(doc.bg, brand) || '#ffffff';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, doc.width * s, doc.height * s);
  for (const n of doc.nodes) drawNode(ctx, n, brand, s, src, !!o.editor, o.skip, o.t);
  ctx.restore();
}

/** Render the whole doc to an offscreen canvas at `scale`. */
export function renderToCanvas(doc: Doc, brand: Brand, src: ImageSource, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(doc.width * scale));
  c.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = c.getContext('2d')!;
  renderDoc(ctx, doc, brand, src, { scale, editor: false });
  return c;
}

export function thumbnail(doc: Doc, brand: Brand, src: ImageSource, width = 240, ratio = 1.6): string {
  const scale = width / doc.width;
  const c = renderToCanvas({ ...doc, height: Math.min(doc.height, doc.width * ratio) }, brand, src, scale);
  return c.toDataURL('image/jpeg', 0.8);
}
